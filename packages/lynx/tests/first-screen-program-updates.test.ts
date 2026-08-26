import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import {
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalProps,
	universalValue,
} from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';
import { createLynxRoot, type LynxRoot } from '../src/index.js';
import { root as firstScreenRoot } from '../src/first-screen.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	universalFor as firstScreenFor,
	universalPlan as firstScreenPlan,
	universalProps as firstScreenProps,
	universalValue as firstScreenValue,
} from '../src/main-renderer.js';

/*
 * Issue #163 C4: a page a compiled main-thread program painted takes ordinary
 * updates, over the real transport.
 *
 * This lives in its own file rather than beside the rest of the first-screen
 * suite, and the file boundary is load-bearing. Main paints before any
 * background root exists, so it cannot ask which root it is painting for: it
 * addresses its first-screen container to the id the *first* background root
 * of the realm will take. Any later root in the same realm therefore finds no
 * first tree addressed to it and repairs — correct, because the first screen
 * was painted for one root and a second one is a different tree, and quiet,
 * because a repair is a slower right answer rather than a wrong one. In a test
 * file the realm is the file, so at most one test per file can adopt over the
 * wire and it has to be the file's first `createLynxRoot()`. Vitest isolates
 * each file; this file spends that one adoption on this test.
 */

interface ProgramSceneProps {
	readonly id: string;
	readonly tone: string;
	readonly rows: readonly string[];
	readonly onLabelTap?: (payload: unknown) => void;
}

/** The keyed member a program's range holds, painted by the renderer. */
const memberPlan = firstScreenPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

/**
 * A first screen a compiled main-thread program paints.
 *
 * `bind` takes the host once and returns a create that drives the Element PAPI
 * directly — no description of this subtree exists anywhere, which is the whole
 * point of a program. Written by hand rather than compiled because what this
 * file tests is the *runtime* handoff: that the background can update nodes it
 * never painted. That the compiler numbers both arms identically is C2c's
 * claim, pinned on a real component in
 * `packages/octane/tests/lynx-main-thread-program-first-screen.test.ts`.
 *
 * The keyed hole is the part that matters most. A program declares its ranges
 * rather than painting them, so their members are ordinary described hosts
 * living inside a node the program made — the one place where "a host the
 * background describes" and "a host main painted with no record" meet as parent
 * and child.
 */
const programScenePlan = firstScreenPlan('lynx', {
	kind: 'program',
	slots: [],
	nodes: 2,
	values: [0, 1],
	events: [],
	// Pre-order over the program's own nodes and its holes: the `<view>` is 0,
	// the `<text>` is 1, and the hole after them is 2.
	ranges: [{ slot: 2, node: 0, id: 2 }],
	bind: (host: unknown) => {
		const papi = host as {
			readonly intrinsics?: {
				view(pageId: number): object;
				text(pageId: number): object;
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
			// The nodes, then one entry per declared range saying what this create
			// painted there. This one paints nothing for its hole — it takes no
			// range argument at all — so the entry is `undefined` and the renderer
			// fills the hole itself, which is what makes the members below ordinary
			// described hosts.
			return [view, text, undefined];
		};
	},
});

const ProgramScene = defineFirstScreenComponent('lynx', (props: ProgramSceneProps) =>
	firstScreenValue(programScenePlan, [
		props.id,
		props.tone,
		firstScreenFor(
			props.rows,
			(row) => row,
			(row) => firstScreenValue(memberPlan, [firstScreenProps([['set', 'id', row]])]),
			null,
			true,
			true,
		),
	]),
);

const backgroundMemberPlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	propsSlot: 0,
});

/**
 * The background's ordinary description of the tree the program above paints.
 *
 * Two hosts and a keyed hole, exactly as the program declares them, because the
 * background compiles the same source to an ordinary template regardless — the
 * program object is emitted only into the main-thread chunk. Numbering follows
 * from that: the `<view>` takes the first id, the `<text>` the next, and the
 * hole's members the ones after, which is what the program's own ids agree with.
 *
 * The tap on the `<text>` is deliberately a slot the first render leaves
 * undefined. A program installs only the event sites its plan declares, and this
 * one declares none, so an update that supplies the handler is a listener bound
 * onto a node the background never created.
 */
const backgroundProgramScenePlan = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [['id', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			bindings: [
				['class', 1],
				['bindtap', 3],
			],
		},
		{ kind: 'slot', slot: 2 },
	],
});

const BackgroundProgramScene = defineUniversalComponent('lynx', (props: ProgramSceneProps) =>
	universalValue(backgroundProgramScenePlan, [
		props.id,
		props.tone,
		universalFor(
			props.rows,
			(row) => row,
			(row) => universalValue(backgroundMemberPlan, [universalProps([['set', 'id', row]])]),
			null,
			true,
			true,
		),
		props.onLabelTap,
	]),
);

interface EventRegistration {
	readonly listener: string | undefined;
}

interface InstalledEnvironment {
	readonly dom: JSDOM;
	readonly main: LynxMainThreadController;
	readonly registrations: EventRegistration[];
}

let installed: InstalledEnvironment | null = null;
let backgroundRoot: LynxRoot | null = null;

function installEnvironment(): InstalledEnvironment {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	const target = globalThis as unknown as Record<string, unknown>;
	const registrations: EventRegistration[] = [];
	const addEvent = target.__AddEvent as (
		node: object,
		kind: string,
		name: string,
		listener: string | undefined,
	) => void;
	target.__AddEvent = (node, kind, name, listener) => {
		registrations.push(Object.freeze({ listener }));
		addEvent(node, kind, name, listener);
	};
	const main = installLynxMainThread({ firstScreen: true, firstScreenSync: 'manual' });
	return (installed = { dom, main, registrations });
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

describe.sequential('Lynx main-thread program first-screen updates', () => {
	it('updates a page a compiled main-thread program painted, on the nodes it painted', async () => {
		// The first screen is straight-line compiled code driving the Element PAPI;
		// it writes no record for anything it made, so nothing of main's describes
		// this page. Adoption inverts — main hands over one `id -> node` map and the
		// background's own description resolves against it — and from that moment
		// the background owns hosts it never created. This is the test that the
		// ownership is real: ordinary updates reach them.
		const { dom, main, registrations } = installEnvironment();
		const props: ProgramSceneProps = { id: 'program-page', tone: 'calm', rows: ['a', 'b'] };

		const painted = firstScreenRoot.render(ProgramScene, props);
		// Two hosts the program made plus one per keyed member, which is the count
		// that says the range was materialized by the renderer and not by the
		// program.
		expect(painted).toMatchObject({ hostCount: 4 });
		const page = dom.window.document.querySelector('#program-page');
		const label = page?.querySelector('text');
		const rowA = dom.window.document.querySelector('#a');
		const rowB = dom.window.document.querySelector('#b');
		expect(page).not.toBeNull();
		expect(label?.getAttribute('class')).toBe('calm');
		expect(rowA).not.toBeNull();
		expect(rowB).not.toBeNull();
		// And a program is what painted it, rather than the renderer describing the
		// same tree: main's own snapshot of the page it just painted holds the two
		// keyed members and nothing else. Both are parented to a root the
		// description never mentions, because that root is a node the program made
		// and no description of a program's subtree exists anywhere.
		//
		// Without this the test would hold just as well on a first screen that was
		// declined and repainted from the background — every assertion below would
		// pass, and none of them would be about a program.
		const snapshot = main.firstScreenSnapshot();
		const programRoot = snapshot?.roots[0];
		expect(programRoot).toBeTypeOf('number');
		expect(snapshot?.nodes).toHaveLength(2);
		expect(snapshot?.nodes.map((node) => node.parent)).toEqual([programRoot, programRoot]);
		expect(snapshot?.nodes.map((node) => node.id)).not.toContain(programRoot);

		globalThis.lynxTestingEnv.switchToBackgroundThread();
		const background = (backgroundRoot = createLynxRoot());
		const rendering = background.render(BackgroundProgramScene, props);
		globalThis.lynxTestingEnv.switchToMainThread();
		main.markFirstScreenSyncReady();
		globalThis.lynxTestingEnv.switchToBackgroundThread();
		await rendering;

		// Adopted rather than repaired: the same elements, still in the page. A
		// repair would build a tree that compares equal and shares no node with
		// this one, so identity is what separates them — and a repair reports the
		// typed mismatch that says which of the two happened.
		expect(main.diagnostics()).toEqual([]);
		expect(dom.window.document.querySelector('#program-page')).toBe(page);
		expect(page?.querySelector('text')).toBe(label);
		expect(dom.window.document.querySelector('#a')).toBe(rowA);

		// The update the whole slice is for: a prop on a host *the program made*,
		// which the background has no record of ever creating.
		await background.render(BackgroundProgramScene, { ...props, tone: 'alert' });
		expect(page?.querySelector('text')).toBe(label);
		expect(label?.getAttribute('class')).toBe('alert');
		expect(dom.window.document.querySelector('#program-page')).toBe(page);

		// And the keyed hole the program declared rather than painted: a member
		// inserted into, then one removed from and the survivors reordered inside,
		// a node the program owns. This is the parent link that has no record
		// behind it on either side.
		await background.render(BackgroundProgramScene, {
			...props,
			tone: 'alert',
			rows: ['a', 'b', 'c'],
		});
		const rowC = dom.window.document.querySelector('#c');
		expect(rowC).not.toBeNull();
		expect(rowC?.parentElement).toBe(page);
		expect(dom.window.document.querySelector('#a')).toBe(rowA);
		expect(dom.window.document.querySelector('#b')).toBe(rowB);

		await background.render(BackgroundProgramScene, {
			...props,
			tone: 'alert',
			rows: ['c', 'a'],
		});
		expect(dom.window.document.querySelector('#b')).toBeNull();
		expect(dom.window.document.querySelector('#c')).toBe(rowC);
		expect(dom.window.document.querySelector('#a')).toBe(rowA);
		expect([...(page?.children ?? [])].map((child) => child.getAttribute('id'))).toEqual([
			null,
			'c',
			'a',
		]);

		// The last band a program-painted host can be on the receiving end of: an
		// event the program never installed, arriving after adoption. The mount
		// journalled only the sites the plan declared — none here — so this
		// listener is the background's alone, bound onto a node it did not create.
		const taps: unknown[] = [];
		await background.render(BackgroundProgramScene, {
			...props,
			tone: 'alert',
			rows: ['c', 'a'],
			onLabelTap: (payload) => taps.push(payload),
		});
		expect(page?.querySelector('text')).toBe(label);
		const labelListener = registrations.at(-1)?.listener;
		expect(labelListener).toBeTypeOf('string');
		main.dispatchNativeEvent(labelListener!, { type: 'tap', detail: { on: 'label' } });
		expect(taps).toEqual([{ type: 'tap', detail: { on: 'label' } }]);
		expect(main.diagnostics()).toEqual([]);

		// The last band, and the only one where "main painted it" could still
		// plausibly mean "main owns it": the background has to be able to give back
		// what it never made. Adoption moved these nodes into its ownership, so
		// tearing the root down takes them with it — a program root left standing
		// after unmount is a leak nothing else in this file would see.
		await background.unmount();
		backgroundRoot = null;
		expect(dom.window.document.querySelector('#program-page')).toBeNull();
		expect(dom.window.document.querySelectorAll('view')).toHaveLength(0);
		expect(dom.window.document.querySelectorAll('text')).toHaveLength(0);
		expect(main.diagnostics()).toEqual([]);
	});
});
