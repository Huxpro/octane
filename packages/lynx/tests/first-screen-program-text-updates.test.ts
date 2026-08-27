import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { defineUniversalComponent, universalPlan, universalValue } from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';
import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { root as firstScreenRoot } from '../src/first-screen.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	universalPlan as firstScreenPlan,
	universalValue as firstScreenValue,
} from '../src/main-renderer.js';

/*
 * Issue #163 C5 and #215 D3: the text a compiled main-thread program painted
 * for its own hole takes ordinary updates, over the real transport.
 *
 * `first-screen-program-updates.test.ts` is the same handoff for a hole the
 * program declared and left *open* — its members are ordinary described hosts
 * that main created through the renderer and journalled with records. A hole
 * the program *paints* is the other half and a different population: a `#text`
 * the compiled create made itself, numbered beside the hole rather than by any
 * walk, and returned in the trailing half of the create's result. Nothing of
 * main's holds it but the run, and the run's own arithmetic — hosts first, then
 * one entry per range — is the only thing that says which node wears its ID.
 *
 * Adoption is where that arithmetic is spent, and an update is the only place
 * its answer is observable: a wrong node there is still a correct-looking page
 * at first screen and at handoff, and goes wrong on the first prop that
 * changes. So this file adopts and then updates the painted text.
 *
 * It is a separate file for the reason the other one is. Main paints before any
 * background root exists, so it addresses its first-screen container to the id
 * the *first* background root of the realm will take, and in a test file the
 * realm is the file. At most one test per file can adopt over the wire and it
 * has to be the file's first `createLynxRoot()`; this file spends that one
 * adoption here.
 */

interface TextSceneProps {
	readonly id: string;
	readonly tone: string;
	readonly label: string;
}

/**
 * A first screen a compiled main-thread program paints whole, hole included.
 *
 * Hand-written rather than compiled, like the sibling file's: what is under
 * test is the *runtime* handoff. That the compiler numbers both arms
 * identically is C2c's claim, pinned on a real component in
 * `packages/octane/tests/lynx-main-thread-program-first-screen.test.ts`.
 *
 * `paintsText` is the build's half of the answer and `typeof value === 'string'`
 * is the run time's, exactly as the emitter compiles them: a hole under a
 * `<text>` can hold raw text, so the create tests the value and paints it when
 * it is a string. The renderer makes the same test on the same value, which is
 * what lets the two agree about who filled the hole — and the mount compares
 * the two answers rather than trusting either.
 */
const textScenePlan = firstScreenPlan('lynx', {
	kind: 'program',
	slots: [],
	nodes: 2,
	values: [0, 1],
	events: [],
	// Pre-order over the program's own nodes and its holes: the `<view>` is 0,
	// the `<text>` is 1, and the hole inside that `<text>` is 2.
	ranges: [{ slot: 2, node: 1, id: 2, paintsText: true }],
	bind: (host: unknown) => {
		const papi = host as {
			readonly intrinsics?: {
				view(pageId: number): object;
				text(pageId: number): object;
				rawText(text: string): object;
			};
			readonly append?: (parent: object, child: object) => void;
			insertBefore(parent: object, child: object, before: object | null): void;
			setId(node: object, id: string | null): void;
			setClasses(node: object, value: string): void;
		};
		const intrinsics = papi.intrinsics;
		if (intrinsics === undefined) {
			throw new TypeError(
				'Octane main-thread programs need a host with intrinsic element factories.',
			);
		}
		const append =
			papi.append ?? ((parent: object, child: object) => papi.insertBefore(parent, child, null));
		return (...args: unknown[]): readonly unknown[] => {
			const pageId = args[0] as number;
			const view = intrinsics.view(pageId);
			papi.setId(view, args[1] as string);
			const text = intrinsics.text(pageId);
			papi.setClasses(text, args[2] as string);
			append(view, text);
			// Last, after the values, exactly as the emission orders its parameters:
			// one argument per declared range saying what this first screen handed
			// the program to paint. The nodes, then one entry per range saying what
			// the create painted there — `undefined` where it declined.
			const painted = args[3];
			let raw: object | undefined;
			if (typeof painted === 'string') {
				raw = intrinsics.rawText(painted);
				append(text, raw);
			}
			return [view, text, raw];
		};
	},
});

const TextScene = defineFirstScreenComponent('lynx', (props: TextSceneProps) =>
	firstScreenValue(textScenePlan, [props.id, props.tone, props.label]),
);

/**
 * The background's ordinary description of the tree the program above paints.
 *
 * Two hosts and a hole, exactly as the program declares them, because the
 * background compiles the same source to an ordinary template regardless — the
 * program object is emitted only into the main-thread chunk. The hole's string
 * is an ordinary renderable there, and the renderer materializes it as the
 * `#text` host that takes the third id: the same node, from the other side.
 */
const backgroundTextScenePlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			bindings: [['class', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

const BackgroundTextScene = defineUniversalComponent('lynx', (props: TextSceneProps) =>
	universalValue(backgroundTextScenePlan, [props.id, props.tone, props.label]),
);

interface InstalledEnvironment {
	readonly dom: JSDOM;
	readonly main: LynxMainThreadController;
}

let installed: InstalledEnvironment | null = null;
let backgroundRoot: LynxRoot | null = null;

function installEnvironment(): InstalledEnvironment {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const main = installLynxMainThread({ firstScreen: true, firstScreenSync: 'manual' });
	return (installed = { dom, main });
}

afterEach(async () => {
	if (backgroundRoot !== null) {
		await backgroundRoot.unmount();
		backgroundRoot = null;
	}
	if (installed !== null) {
		installed.main.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		installed.dom.window.close();
	}
	installed = null;
});

describe.sequential('Lynx main-thread program first-screen text updates', () => {
	it('updates the text a compiled main-thread program painted for its own hole', async () => {
		const { dom, main } = installEnvironment();
		const props: TextSceneProps = { id: 'text-page', tone: 'calm', label: 'Label' };

		const painted = firstScreenRoot.render(TextScene, props);
		// Three: the two hosts the program declares and the `#text` it painted for
		// its hole, which is counted like a node the program made because that is
		// what it is.
		expect(painted).toMatchObject({ hostCount: 3 });
		const page = dom.window.document.querySelector('#text-page');
		const label = page?.querySelector('text');
		const text = label?.firstChild;
		expect(page).not.toBeNull();
		expect(label?.getAttribute('class')).toBe('calm');
		expect(text?.nodeValue).toBe('Label');

		// And a program painted every node of it, the hole included: main's own
		// snapshot of the page it just painted describes nothing at all. The
		// sibling file's program leaves its hole open and its members are
		// described; here there is no described population, so the text below is
		// updated through a record whose node came from the run and from nowhere
		// else.
		//
		// Without this the test would hold just as well on a first screen that was
		// declined and repainted from the background.
		const snapshot = main.firstScreenSnapshot();
		expect(snapshot?.nodes).toHaveLength(0);
		expect(snapshot?.roots).toHaveLength(1);

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const background = (backgroundRoot = createLynxRoot());
		const rendering = background.render(BackgroundTextScene, props);
		globalThis.lynxTestingEnv.switchToMainThread();
		main.markFirstScreenSyncReady();
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await rendering;

		// Adopted rather than repaired: the same elements, still in the page. A
		// repair would build a tree that compares equal and shares no node with
		// this one, so identity is what separates them — and a repair reports the
		// typed mismatch that says which of the two happened.
		expect(main.diagnostics()).toEqual([]);
		expect(dom.window.document.querySelector('#text-page')).toBe(page);
		expect(page?.querySelector('text')).toBe(label);
		expect(label?.firstChild).toBe(text);

		// The update this file is for. The background has a record for the hole's
		// id and no memory of ever creating anything there; the node in that
		// record is whatever the run answered for that id at handoff. A run that
		// answered with one of its *hosts* instead — the two tables are one array,
		// hosts first and painted holes after — is not visibly wrong until here,
		// and then it writes the new text onto the wrong element and leaves this
		// one saying `Label`.
		await background.render(BackgroundTextScene, { ...props, label: 'Changed' });
		expect(label?.firstChild).toBe(text);
		expect(text?.nodeValue).toBe('Changed');
		expect(label?.getAttribute('class')).toBe('calm');
		expect(page?.getAttribute('id')).toBe('text-page');

		// The neighbouring band, so a handoff that resolved every id to the same
		// node cannot pass the one above: a prop on the host *containing* the
		// painted text still lands on that host.
		await background.render(BackgroundTextScene, { ...props, tone: 'alert', label: 'Changed' });
		expect(page?.querySelector('text')).toBe(label);
		expect(label?.getAttribute('class')).toBe('alert');
		expect(text?.nodeValue).toBe('Changed');

		// And the last band: adoption moved these nodes into the background's
		// ownership, so tearing the root down takes them with it — a program root
		// left standing after unmount is a leak nothing else in this file sees.
		await background.unmount();
		backgroundRoot = null;
		expect(dom.window.document.querySelector('#text-page')).toBeNull();
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
		expect(dom.window.document.querySelectorAll('text')).toHaveLength(0);
		expect(main.diagnostics()).toEqual([]);
	});
});
