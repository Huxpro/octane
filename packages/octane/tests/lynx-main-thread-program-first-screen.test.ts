// Issue-#163 C2c and C2d: a compiled main-thread program's whole first screen.
//
// C1 made the `target: 'lynx'` main-thread compile emit a compiled create
// function in place of the description an interpreter walks. Two questions the
// emission alone cannot answer follow from that, and this file is the
// differential for both: same source, both encodings, compared.
//
// C2c is everything about a first screen that is not painting. It is the IDs
// the background will independently assign to the same tree, and the listener
// bindings it announces so a tap reaches a handler. Those have to come out of
// the compiled arm exactly as they come out of the interpreted one, or the two
// threads disagree about which node is which and the page is unadoptable — it
// repaints on every launch and drops the taps in between.
//
// C2d is the painting. The direct applier binds the host once per program,
// calls the create, and puts the assembled subtree in the page with one append
// — after a keyed range's members, which are the renderer's to materialize and
// go into a node the program made. The oracle is the painted host tree and the
// native event tokens on it, which are the same numbers on both arms because
// C2c made the IDs the same.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../lynx/src/config.js';
import * as Backend from '../../lynx/src/compiler/index.js';
import * as MainRenderer from '../../lynx/src/main-renderer.js';
import * as MainWorklets from '../../lynx/src/main-worklets.js';
import {
	applyLynxFirstScreenDirect,
	captureLynxFirstTree,
	createLynxHostContainer,
	disposeLynxHostContainer,
} from '../../lynx/src/core/host-driver.js';
import { createFakePAPI, shape } from '../../lynx/tests/_fixtures/fake-element-papi.js';

/**
 * Two events and two ranges, arranged so an interleaving mistake shows.
 *
 * `onPick` sits on a node *before* the first range and `onHold` on a node
 * *after* it. A program that numbered its own nodes first and its ranges'
 * members afterwards would still agree about `onPick`, about how many hosts
 * there are, and about every listener ID — and would put `onHold` on the wrong
 * node. That is the mistake worth a fixture, so both text holes carry a value
 * and each range therefore has a member that consumes an ID of its own.
 */
const CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string; detail: string; tone: string; onPick: () => void; onHold: () => void }) @{
	<view class={props.tone}>
		<text class="card-label" bindtap={props.onPick}>{props.label as string}</text>
		<view class="card-body"><text class="d" bindtap={props.onHold}>{props.detail as string}</text></view>
	</view>
}
`;

type CardComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compiled(program: boolean): string {
	return compile(CARD, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target: 'lynx', id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
		...(program ? { mainThreadProgramBackend: Backend } : null),
	}).code;
}

function cardFor(program: boolean): CardComponent {
	const rewritten = compiled(program)
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx(?:\/[\w-]+)?["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace('export const Card =', 'const Card =');
	return new Function('__universal', `${rewritten}\nreturn Card;`)({
		...MainRenderer,
		...MainWorklets,
	}) as CardComponent;
}

const PROPS = {
	label: 'Label',
	detail: 'Detail',
	tone: 'card active',
	onPick: () => {},
	onHold: () => {},
};

function render(program: boolean): MainRenderer.LynxFirstScreenRenderResult {
	return MainRenderer.renderLynxFirstScreen(cardFor(program), PROPS as never);
}

describe('a compiled main-thread program on the first-screen path', () => {
	it('compiles the fixture to both encodings', () => {
		// Guards the premise. If eligibility ever declined this shape the cells
		// below would compare the interpreted arm against itself and prove
		// nothing.
		expect(compiled(true)).toContain('"kind": "program"');
		expect(compiled(false)).not.toContain('"kind": "program"');
		expect(compiled(false)).toContain('"kind": "template"');
	});

	it('takes the same first-screen IDs as the interpreted encoding', () => {
		const program = render(true);
		const interpreted = render(false);

		// Four hosts the program creates, plus the one text member each of its two
		// holes turned out to hold. The program does not paint the members — that
		// is what makes them holes — but it does have to leave room for them.
		expect(program.hostCount).toBe(interpreted.hostCount);
		expect(program.hostCount).toBe(6);
		// The number the background counts to. A hole takes no ID of its own on
		// either arm: the interpreted arm splices a hole's members into their
		// parent, so a program that wrapped its holes in a node would land here one
		// higher per hole and shift every ID after the first one.
		expect(program.logicalCount).toBe(interpreted.logicalCount);
		expect(program.logicalCount).toBe(6);
	});

	it('announces the same listener bindings as the interpreted encoding', () => {
		const program = render(true);
		const interpreted = render(false);

		expect(program.envelope).toEqual(interpreted.envelope);
		// Spelled out rather than only compared, because "equal to each other" is
		// also true of two arms wrong in the same way. Pre-order over the painted
		// tree: view 1, the label text 2, its member 3, the body view 4, the detail
		// text 5, its member 6. So the second `bindtap` is host 5 — 5 and not 4,
		// which is the assertion that the first hole's member was numbered on its
		// way past rather than after the program.
		expect(program.envelope.events).toEqual([
			{ id: 2, type: 'bindtap', listener: { id: 1_000_000, priority: 'discrete' } },
			{ id: 5, type: 'bindtap', listener: { id: 1_000_001, priority: 'discrete' } },
		]);
	});

	it('announces no binding for an event site whose handler is not callable', () => {
		// An event-named prop that arrives holding nothing callable installs no
		// listener on an authored host, so a program's event site must behave the
		// same way: its table says where the sites are, the values say which ones
		// are bound. A program that announced its whole table would hand the
		// background a listener for a handler that does not exist.
		const unbound = { ...PROPS, onHold: undefined };
		const program = MainRenderer.renderLynxFirstScreen(cardFor(true), unbound as never);
		const interpreted = MainRenderer.renderLynxFirstScreen(cardFor(false), unbound as never);
		expect(program.envelope).toEqual(interpreted.envelope);
		expect(program.envelope.events).toEqual([
			{ id: 2, type: 'bindtap', listener: { id: 1_000_000, priority: 'discrete' } },
		]);
	});

	it('has no command batch, permanently', () => {
		// A batch is commands, and a program exists so its first screen is not
		// commands. This refusal is not a "not yet": the staged path is the
		// fallback for a tree the direct applier declines, and there is no version
		// of it that carries a program — building one would mean re-describing the
		// subtree the program was compiled to stop describing.
		expect(() => render(true).batch).toThrow(/has no command batch/);
	});
});

/** The fake host with the intrinsic factories a real PAPI always publishes. */
function createHost(): ReturnType<typeof createFakePAPI> {
	const papi = createFakePAPI();
	return {
		...papi,
		intrinsics: {
			view: (pageId: number) => papi.createElement('view', pageId, ''),
			text: (pageId: number) => papi.createElement('text', pageId, ''),
			rawText: (value: string) => papi.createElement('#text', 0, value),
		},
	};
}

/**
 * Blank every nodes-ref selector, which is the one thing the two arms are
 * *supposed* to disagree about.
 *
 * The interpreted arm writes one `setRefSelector` per host on the paint path so
 * the background can find that node by CSS selector later; a program's caller
 * already holds the nodes it created, so nothing has to be findable. That is
 * #163's inverted handoff, and it is asserted directly below rather than hidden
 * in this normalization. Native event tokens are deliberately *not* stripped:
 * they encode the host id and the listener id, and C2c made both the same on
 * either arm, so they have to match exactly.
 */
function withoutSelectors(node: unknown): unknown {
	const value = node as { readonly children: readonly unknown[] };
	return { ...(value as object), selector: '', children: value.children.map(withoutSelectors) };
}

function selectorCount(node: unknown): number {
	const value = node as { readonly selector: string; readonly children: readonly unknown[] };
	return (
		(value.selector === '' ? 0 : 1) +
		value.children.reduce<number>((total, child) => total + selectorCount(child), 0)
	);
}

/**
 * Paint one encoding through the direct applier, recording every host crossing
 * this file makes a claim about: insertions, removals, and event installs.
 *
 * Recorded rather than read back off the tree because each claim is about the
 * crossing itself. A tree comparison cannot see that a subtree entered the page
 * in one append rather than per node, that teardown detached it with one
 * removal rather than one per keyed range member, or that a site nobody
 * supplied a handler for was skipped instead of being sent an undefined
 * listener the host would treat as a delete.
 */
function paint(program: boolean): {
	readonly tree: unknown;
	readonly page: unknown;
	readonly inserts: readonly [unknown, unknown][];
	readonly removes: readonly [unknown, unknown][];
	readonly events: readonly unknown[][];
	readonly container: ReturnType<typeof createLynxHostContainer>;
	readonly papi: ReturnType<typeof createHost>;
} {
	const host = createHost();
	const inserts: [unknown, unknown][] = [];
	const removes: [unknown, unknown][] = [];
	const events: unknown[][] = [];
	const papi = {
		...host,
		insertBefore(parent: never, child: never, before: never) {
			inserts.push([parent, child]);
			host.insertBefore(parent, child, before);
		},
		remove(parent: never, child: never) {
			removes.push([parent, child]);
			host.remove(parent, child);
		},
		setEvent(target: never, kind: never, name: never, listener: never) {
			events.push([target, kind, name, listener]);
			host.setEvent(target, kind, name, listener);
		},
	};
	const container = createLynxHostContainer(papi, { root: 1 });
	const rendered = render(program);
	expect(applyLynxFirstScreenDirect(container, rendered.nodes, rendered.envelope)).toBe(true);
	return {
		tree: shape(papi.pages[0]!),
		page: papi.pages[0]!,
		inserts,
		removes,
		events,
		container,
		papi,
	};
}

/** Every node in a painted tree, so teardown can be asked about each of them. */
function nodesOf(node: unknown): unknown[] {
	const value = node as { readonly children: readonly unknown[] };
	return [value, ...value.children.flatMap(nodesOf)];
}

describe('the direct applier mounting a compiled main-thread program', () => {
	it('paints the tree the interpreted encoding paints, with the same event tokens', () => {
		const program = paint(true);
		const interpreted = paint(false);
		// Tokens included. They encode the root, the host id, the generation, the
		// listener id and the priority — every one of which C2c made agree — so an
		// arm that mounted the right tree and bound a tap to the wrong host is red
		// here rather than equal.
		expect(withoutSelectors(program.tree)).toEqual(withoutSelectors(interpreted.tree));
	});

	it('writes a nodes-ref selector for no node the program made', () => {
		// The #157 per-node cost this inverts, on a real component rather than a
		// hand-built program. The interpreted arm writes one `setRefSelector` per
		// non-raw-text host so the background can find that node by CSS selector
		// later; the program's caller already holds every node it created, so
		// nothing has to be findable. The two text members of the keyed ranges are
		// raw text, which takes no selector on either arm, so this fixture's
		// program arm writes none at all.
		expect(selectorCount(paint(false).tree)).toBe(4);
		expect(selectorCount(paint(true).tree)).toBe(0);
	});

	it('enters the page once, after every keyed range member is in place', () => {
		const { page, inserts } = paint(true);
		const intoPage = inserts.filter(([parent]) => parent === page);
		expect(intoPage).toHaveLength(1);
		// Last, not merely once. The program assembles its own subtree detached
		// and hands its root back precisely so that the members — which go into a
		// node it made — are in before any of it is live. An arm that attached
		// inside the create would make each member its own insertion into the
		// page, which is the cost detached assembly exists to avoid and which no
		// comparison of the painted trees can see.
		expect(inserts[inserts.length - 1]![0]).toBe(page);
	});

	it('clears every event the program installed, at teardown', () => {
		// Disposal reads the native event journal, not records — and a program
		// writes no record for any node it made, so journalling the tuples the
		// program set is the only thing that can clear them. `complete` cannot
		// see the difference: it goes true either way, because a journal that was
		// never written is also an empty one. The nodes are asked directly.
		const { container, page } = paint(true);
		const painted = nodesOf(page);
		const bound = painted.filter((node) => (node as { events: Map<string, unknown> }).events.size);
		// The premise: this fixture really does install taps, so the assertion
		// below is not vacuous on a tree that never had any.
		expect(bound).toHaveLength(2);
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect((page as { children: readonly unknown[] }).children).toHaveLength(0);
		for (const node of painted) {
			expect((node as { events: Map<string, unknown> }).events.size).toBe(0);
		}
	});

	it('detaches the painted program with one removal, not one per range member', () => {
		// The other half of what a program owes the container, and the reason
		// every node it returns goes into the physical ownership journal even
		// though none of them has a record. Teardown removes the one external
		// edge above an owned subtree and lets the host release the rest; a node
		// missing from that journal is not recognised as owned, so its children
		// each become their own boundary and each pay a removal. `complete` is
		// true either way, which is exactly why this is counted rather than
		// inferred from the page emptying.
		const { container, page, removes } = paint(true);
		// Read before teardown empties it: the one edge that should be cut.
		const root = (page as { children: readonly unknown[] }).children[0];
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(removes).toEqual([[page, root]]);
	});

	it('refuses to describe the painted tree it did not describe', () => {
		// A capture is assembled from records, and a program has none. Journalling
		// what the records can see would hand adoption a tree missing everything
		// the program painted. Adoption for a program is slot state off the keyed
		// slot map (C2e), which is what replaces this refusal.
		const { container } = paint(true);
		expect(() => captureLynxFirstTree(container)).toThrow(/cannot be captured as a described tree/);
	});

	it('refuses a host with no intrinsic element factories before painting any root', () => {
		// Unlike a `<list>` there is nothing to fall back to: the staged path is
		// commands, and a program exists so its first screen is not commands. So
		// the question is not whether this is refused — the emitted create refuses
		// a host with no intrinsics itself, the moment it is bound — but *when*.
		// A page whose first root is an ordinary host is the only fixture that can
		// tell the two apart: refused in the pre-walk, nothing is painted; refused
		// at bind, that root is already in the page and the screen is half a
		// screen with no way back.
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		const rendered = render(true);
		const chrome: (typeof rendered.nodes)[number] = {
			kind: 'host',
			id: 9001,
			type: 'view',
			props: {},
			children: [],
		};
		expect(() =>
			applyLynxFirstScreenDirect(container, [chrome, ...rendered.nodes], rendered.envelope),
		).toThrow(/intrinsic element factories/);
		expect(papi.pages[0]!.children).toHaveLength(0);
	});

	it('crosses to the host for no event site whose handler is not callable', () => {
		// The envelope already says so (above); this is the paint answering to it.
		// The create takes every declared site positionally, so the site whose
		// handler was not callable is passed `undefined` — which a host reads as
		// *remove this event*, a no-op on a node one statement old. The tree
		// therefore looks identical whether the crossing is skipped or spent, and
		// the crossing is the whole point on this path, so it is counted.
		const unbound = { ...PROPS, onHold: undefined };
		const host = createHost();
		const crossings: unknown[][] = [];
		const papi = {
			...host,
			setEvent(target: never, kind: never, name: never, listener: never) {
				crossings.push([target, kind, name, listener]);
				host.setEvent(target, kind, name, listener);
			},
		};
		const container = createLynxHostContainer(papi, { root: 1 });
		const rendered = MainRenderer.renderLynxFirstScreen(cardFor(true), unbound as never);
		applyLynxFirstScreenDirect(container, rendered.nodes, rendered.envelope);
		// Two sites declared, one handler supplied, one crossing spent — and no
		// crossing carrying an undefined listener.
		expect(crossings).toHaveLength(1);
		expect(crossings[0]![3]).not.toBeUndefined();
		const taps: unknown[] = [];
		const collect = (node: {
			events: Map<string, unknown>;
			children: readonly unknown[];
		}): void => {
			for (const value of node.events.values()) taps.push(value);
			for (const child of node.children) collect(child as never);
		};
		collect(papi.pages[0]! as never);
		expect(taps).toHaveLength(1);
	});
});
