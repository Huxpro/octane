// Issue-#163 C2c, C2d and C3: a compiled main-thread program's whole first
// screen, and the one shape inside it this renderer refuses to paint.
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
	prepareLynxHostBatch,
	resolveLynxHostNativeEvent,
	type LynxHostContainer,
} from '../../lynx/src/core/host-driver.js';
import {
	createFakePAPI,
	shape,
	type FakeNode,
} from '../../lynx/tests/_fixtures/fake-element-papi.js';

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

/**
 * The same tree, the same hosts, the same IDs — and a different event on one of
 * them. What a background describing some *other* component looks like at its
 * most similar to this one, which is the case adoption has to catch without a
 * tree to compare.
 */
const OTHER_CARD = CARD.replace('<text class="d" bindtap=', '<text class="d" bindlongpress=');

/**
 * The same again, and the other way a description can disagree: same tree, same
 * IDs, same number of events on the page — moved onto a different host.
 *
 * `OTHER_CARD` is caught because a host declares an event main never installed
 * there. This one is caught because a host main *did* install one on declares
 * none, which is the half a per-type lookup alone would walk straight past.
 */
const SHIFTED_CARD = CARD.replace(
	'<text class="card-label" bindtap={props.onPick}>',
	'<text class="card-label">',
).replace('<view class="card-body">', '<view class="card-body" bindtap={props.onPick}>');

/**
 * `CARD` flattened, so its first painted hole is numbered immediately before a
 * host that carries a listener.
 *
 * A hole the program paints takes an ID of its own, between the hosts either
 * side of it. In `CARD` the host after the first hole is the `card-body`
 * `<view>`, which has no listener — so a reader that answered the hole with the
 * nearest host would count zero events for it and agree with the background by
 * accident. Removing that wrapper is the smallest change that puts a listening
 * `<text>` there instead.
 */
const FLAT_CARD = CARD.replace(
	'<view class="card-body"><text class="d" bindtap={props.onHold}>{props.detail as string}</text></view>',
	'<text class="d" bindtap={props.onHold}>{props.detail as string}</text>',
);

/**
 * A program with nothing but a text hole, so it can sit inside another
 * component's tree as a row does.
 */
const INNER = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Inner(props: { note: string }) @{
	<view class="inner"><text class="note">{props.note as string}</text></view>
}
`;

/**
 * An ordinary component holding a described host of its own and then whatever
 * its caller passes — the shell shape, and the one that puts several programs
 * side by side under a parent that is not one.
 */
const LIST = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function List(props: { rows: unknown }) @{
	<view class="list"><text class="head">Head</text>{props.rows}</view>
}
`;

/**
 * A shell that stays described however it is compiled, holding rows that do not.
 *
 * `scroll-view` is a host type the main-thread backend has no intrinsic factory
 * for, so this component emits no create function even with the backend on —
 * silently, as an ordinary compile rather than a refusal anyone sees. Any prop
 * outside `class`/`className`/`id` does the same. So this is not a contrived
 * arrangement: it is what a shell looks like the moment it scrolls or carries a
 * style, while its rows go on compiling.
 *
 * A described sibling sits on *both* sides of the hole, because the rows take
 * one position among the parent's children rather than the tail of them. A
 * linkage that added them once the walk was done would put `foot` in front of
 * every row while still holding exactly the right nodes.
 */
const SCROLL_SHELL = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Shell(props: { rows: unknown }) @{
	<scroll-view class="list"><text class="head">Head</text>{props.rows}<text class="foot">Foot</text></scroll-view>
}
`;

/** `CARD`, with its first hole opened to hold a component instead of a string. */
const HOSTING_CARD = CARD.replace('props: { label: string;', 'props: { label: unknown;').replace(
	'{props.label as string}',
	'{props.label}',
);

type CardComponent = Parameters<typeof MainRenderer.renderLynxFirstScreen>[0];

function compiled(
	program: boolean,
	source = CARD,
	thread: 'main-thread' | 'background' = 'main-thread',
): string {
	return compile(source, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target: 'lynx', id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread },
		...(program ? { mainThreadProgramBackend: Backend } : null),
	}).code;
}

function componentFor(program: boolean, source = CARD, name = 'Card'): CardComponent {
	const rewritten = compiled(program, source)
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx(?:\/[\w-]+)?["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __universal;`,
		)
		.replace(`export const ${name} =`, `const ${name} =`);
	return new Function('__universal', `${rewritten}\nreturn ${name};`)({
		...MainRenderer,
		...MainWorklets,
	}) as CardComponent;
}

function cardFor(program: boolean, source = CARD): CardComponent {
	return componentFor(program, source);
}

const PROPS = {
	label: 'Label',
	detail: 'Detail',
	tone: 'card active',
	onPick: () => {},
	onHold: () => {},
};

function render(
	program: boolean,
	source = CARD,
	props: unknown = PROPS,
): MainRenderer.LynxFirstScreenRenderResult {
	return MainRenderer.renderLynxFirstScreen(cardFor(program, source), props as never);
}

describe('a compiled main-thread program on the first-screen path', () => {
	it('compiles the fixture to both encodings', () => {
		// Guards the premise. If eligibility ever declined this shape the cells
		// below would compare the interpreted arm against itself and prove
		// nothing.
		expect(compiled(true)).toContain('"kind": "program"');
		expect(compiled(false)).not.toContain('"kind": "program"');
		expect(compiled(false)).toContain('"kind": "template"');
		// And the premise the whole handoff rests on: the *background* compile of
		// the same source, with the same backend available, still emits an
		// ordinary template. A program object is emitted only into the main-thread
		// layer, which is why the background can describe a component main painted
		// from a program — it never saw the program at all.
		expect(compiled(true, CARD, 'background')).toContain('"kind": "template"');
		expect(compiled(true, CARD, 'background')).not.toContain('"kind": "program"');
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

	it("refuses a row of a program's range that nothing compiled, rather than faulting", () => {
		// Issue #163 C3's boundary, on the shape it is actually about.
		//
		// A program's declared holes are `kind: 'slot'` nodes, so what fills one
		// is decided at render time and can be anything renderable — including a
		// component, which is how rows reach a page. The compiler never sees that
		// component: it declines any plan whose *static* structure holds one, so a
		// plan that became a program has holes and nothing else. That makes the
		// row the one place a program's first screen can meet something it cannot
		// paint, and #163 says what it costs — the command path, not the launch.
		//
		// Classified here rather than handled: this renderer's callers include the
		// background's own describe pass, which wants the throw. Turning a refusal
		// into a declined first screen is the receiver's job, and is asserted
		// against the real receiver in `packages/lynx/tests/first-screen.test.ts`.
		const row = (() => null) as never;
		let thrown: unknown;
		try {
			MainRenderer.renderLynxFirstScreen(cardFor(true), {
				...PROPS,
				label: MainRenderer.universalComponent('lynx', row, null, 'row-0'),
			} as never);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(MainRenderer.LynxFirstScreenRefusalError);
		// The interpreted arm answers the same way about the same row, which is
		// what keeps the boundary a property of the page rather than of the
		// encoding it was compiled to.
		expect(() =>
			MainRenderer.renderLynxFirstScreen(cardFor(false), {
				...PROPS,
				label: MainRenderer.universalComponent('lynx', row, null, 'row-0'),
			} as never),
		).toThrow(MainRenderer.LynxFirstScreenRefusalError);
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
function paint(
	program: boolean,
	props: unknown = PROPS,
	component?: CardComponent,
): {
	readonly tree: unknown;
	readonly page: unknown;
	readonly inserts: readonly [unknown, unknown][];
	readonly removes: readonly [unknown, unknown][];
	readonly events: readonly unknown[][];
	readonly reads: readonly unknown[];
	readonly made: readonly unknown[];
	readonly container: LynxHostContainer<FakeNode>;
	readonly papi: ReturnType<typeof createHost>;
} {
	const host = createHost();
	const inserts: [unknown, unknown][] = [];
	const removes: [unknown, unknown][] = [];
	const events: unknown[][] = [];
	const reads: unknown[] = [];
	const made: unknown[] = [];
	// The one seam that separates the two populations without begging the
	// question. A compiled create makes its nodes through `papi.intrinsics`; the
	// renderer makes everything else — a keyed range's members included — through
	// `createElement`. So "the program made this" is recorded here rather than
	// inferred from which nodes ended up with a record, which is the very thing
	// the assertions below are about.
	const tracked =
		<Args extends readonly unknown[]>(factory: (...args: Args) => unknown) =>
		(...args: Args) => {
			const node = factory(...args);
			made.push(node);
			return node;
		};
	const papi = {
		...host,
		intrinsics: {
			view: tracked(host.intrinsics!.view),
			text: tracked(host.intrinsics!.text),
			rawText: tracked(host.intrinsics!.rawText),
		} as typeof host.intrinsics,
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
		getUniqueId(node: never) {
			reads.push(node);
			return host.getUniqueId(node);
		},
	};
	const container = createLynxHostContainer(papi, { root: 1 });
	const rendered =
		component === undefined
			? render(program, CARD, props)
			: MainRenderer.renderLynxFirstScreen(component, props as never);
	expect(applyLynxFirstScreenDirect(container, rendered.nodes, rendered.envelope)).toBe(true);
	return {
		tree: shape(papi.pages[0]!),
		page: papi.pages[0]!,
		inserts,
		removes,
		events,
		reads,
		made,
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
		// terminal cleanup walks the runs rather than only the ownership set: a
		// program's nodes have no record and are not added to `ownedNodes`, so the
		// run is where teardown finds them. Teardown removes the one external edge
		// above an owned subtree and lets the host release the rest; a node the
		// walk misses is not recognised as owned, so its children each become
		// their own boundary and each pay a removal. `complete` is true either
		// way, which is exactly why this is counted rather than inferred from the
		// page emptying.
		const { container, page, removes } = paint(true);
		// Read before teardown empties it: the one edge that should be cut.
		const root = (page as { children: readonly unknown[] }).children[0];
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(removes).toEqual([[page, root]]);
	});

	it("adopts the program's own nodes rather than repainting them", () => {
		// The inverted handoff, end to end and as node identity.
		//
		// Adoption is *background describes, main supplies the node per ID*. For an
		// ordinary host main supplies it from a record; a program writes none, so
		// it supplies it from the run the mount kept, searched by ID — and that run
		// is the whole of main's contribution. There is no capture walk over the
		// program's subtree and nothing of main's for the comparator to check the
		// background's description against, which is exactly #163's "the handoff
		// class disappears".
		//
		// What makes that sound is established elsewhere and by construction: C2c
		// proved the two arms number the same source identically, which is why the
		// background's description can be trusted to be *about* these nodes.
		const painted = paint(true);
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		// The painted tree, and within it the nodes the compiled create itself
		// made, both read before adoption moves anything.
		const paintedNodes = nodesOf(painted.page).slice(1);
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBeGreaterThan(0);

		// The background's own description of the same component: the interpreted
		// arm's batch is exactly what the background thread produces, because the
		// program object is emitted only into the main-thread layer.
		const background = render(false);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		const prepared = prepareLynxHostBatch(target, background.batch, {
			firstTree: captured!,
		});
		// Adopted, not repaired. A repair would repaint the page from the
		// background's batch, which is the outcome this whole train exists to
		// avoid, and it is a different word rather than a failure — so assert it.
		expect(prepared.firstTreeAction).toBe('adopt');
		prepared.apply();

		// Identity, not equality: the adopted tree must be the *same* elements that
		// were painted. A repaint would produce a tree that compares equal and
		// shares no node with this set.
		const adopted = new Set(nodesOf(painted.page).slice(1));
		expect(adopted.size).toBe(paintedNodes.length);
		for (const node of paintedNodes) expect(adopted.has(node)).toBe(true);
		// And specifically the program's own nodes, which are the ones adoption
		// had no record to resolve — the range members would survive a handoff
		// that dropped every undescribed host on the floor.
		for (const node of madeByProgram) expect(adopted.has(node)).toBe(true);
	});

	/**
	 * Adopt `painted` from a background arm and return the nodes that came out,
	 * so a cell can assert identity over them.
	 *
	 * Split out because the two cells below differ only in the tree they hand it,
	 * and what they are about is which nodes come back, not how adoption is
	 * driven.
	 */
	const adoptInto = (
		painted: ReturnType<typeof paint>,
		background: MainRenderer.LynxFirstScreenRenderResult,
	): { readonly before: readonly unknown[]; readonly after: readonly unknown[] } => {
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		const before = nodesOf(painted.page).slice(1);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		const prepared = prepareLynxHostBatch(target, background.batch, { firstTree: captured! });
		expect(prepared.firstTreeAction).toBe('adopt');
		prepared.apply();
		return { before, after: nodesOf(painted.page).slice(1) };
	};

	it('adopts a page of sibling programs, resolving each row to its own nodes', () => {
		// The shape the whole train is aimed at, and the one an ID lookup can get
		// subtly wrong without the page looking broken at paint: rows side by side,
		// each its own program.
		//
		// Every program's IDs sit in one run, and here the runs do not overlap —
		// the shell's hole is the last thing it declares, so nothing of the shell's
		// is numbered after its rows. That is what lets main answer *which node
		// wears this ID* by finding the run that covers it, with no table built per
		// node (issue #215 D1). Four runs is the smallest count that makes that a
		// search rather than a comparison or two, and the gaps between them — the
		// range each row is wrapped in — are where a search that rounded to the
		// wrong run would hand adoption a node belonging to another row.
		const rows = (inner: CardComponent) =>
			['a', 'b', 'c'].map((note) => MainRenderer.universalComponent('lynx', inner, { note }, note));
		const painted = paint(
			true,
			{ rows: rows(componentFor(true, INNER, 'Inner')) },
			componentFor(true, LIST, 'List'),
		);
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBe(12);

		// The background never saw a program: it describes the same page from the
		// interpreted encoding of both components, which is what makes the IDs it
		// names the ones main assigned.
		const background = MainRenderer.renderLynxFirstScreen(componentFor(false, LIST, 'List'), {
			rows: rows(componentFor(false, INNER, 'Inner')),
		} as never);

		const { before, after } = adoptInto(painted, background);
		const adopted = new Set(after);
		expect(adopted.size).toBe(before.length);
		for (const node of before) expect(adopted.has(node)).toBe(true);
		// And each row's own nodes specifically: these are the ones with no record
		// to resolve them, so a lookup that answered from a neighbouring run would
		// fault here rather than anywhere else.
		for (const node of madeByProgram) expect(adopted.has(node)).toBe(true);
	});

	it('adopts rows that are programs under a parent the renderer described', () => {
		// The production shape, and the one no cell above reaches: a shell the
		// backend has no factory for, so it stays described while its rows compile
		// to programs. The bench app escapes this only by being spartan enough to
		// compile whole — `view` and `text` with nothing but `class` on them.
		//
		// Every node of the shell has a record here, the parent the rows go into
		// included, so the background's description of *that parent's children* is
		// something the captured tree has to agree with. A row's program root is a
		// child of it in the background and a node with no record of its own in
		// the captured tree, and only the mount walk knows those are the same
		// child. Getting it wrong does not break the page: it paints correctly and
		// is then refused, which is a full repaint on every launch.
		const rows = (inner: CardComponent) =>
			['a', 'b', 'c'].map((note) => MainRenderer.universalComponent('lynx', inner, { note }, note));
		const painted = paint(
			true,
			{ rows: rows(componentFor(true, INNER, 'Inner')) },
			// Compiled *with* the backend, and described anyway. That is the whole
			// point: nothing about this app opted out of programs.
			componentFor(true, SCROLL_SHELL, 'Shell'),
		);
		// The premise, so the cell cannot pass by losing the shape it is about:
		// the rows painted through a compiled create and the shell did not, which
		// is what puts described and undescribed children under one parent.
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBe(9);

		const background = MainRenderer.renderLynxFirstScreen(
			componentFor(false, SCROLL_SHELL, 'Shell'),
			{ rows: rows(componentFor(false, INNER, 'Inner')) } as never,
		);

		const { before, after } = adoptInto(painted, background);
		const adopted = new Set(after);
		expect(adopted.size).toBe(before.length);
		for (const node of before) expect(adopted.has(node)).toBe(true);
		for (const node of madeByProgram) expect(adopted.has(node)).toBe(true);
	});

	it('adopts a page mixing programs with hosts the renderer described', () => {
		// The reader #215 D1 names last and the one the two cells above never
		// reach: an ordinary host inside a program, whose physical parent is a node
		// the program made and so has no record to resolve it.
		//
		// A component the compiler did not turn into a program still renders into
		// a program's hole, and its hosts take IDs in the middle of the page. The
		// shell here holds four rows — a card whose own hole holds such a
		// component, then such a component on its own, then two more programs — so
		// the IDs run: shell 1-3, card 5-6 and 11-13 with the described 8-10 inside
		// it, described 15-17, then programs at 19-21 and 23-25.
		//
		// Three things about the lookup only this shape asks for. The card's first
		// hole is a hole with members and its second is text it painted, so a run
		// carries an empty range entry *before* a filled one and a scan that
		// stopped at the empty one would lose ID 13. Row b's hosts are described
		// but their parent is the shell, two runs back, while two more runs sit
		// ahead — so the answer is neither the run that answered last nor the one
		// after it, and both of those shortcuts have to give way to a real search.
		// And every ID between the runs — the ranges, and the described hosts —
		// has to come back empty from a lookup with no per-ID table to miss in.
		const uc = MainRenderer.universalComponent;
		const rows = (program: boolean) => {
			const described = componentFor(false, INNER, 'Inner');
			return [
				uc(
					'lynx',
					componentFor(program, HOSTING_CARD),
					{ ...PROPS, label: uc('lynx', described, { note: 'in-card' }, 'in-card') },
					'a',
				),
				uc('lynx', described, { note: 'plain' }, 'b'),
				uc('lynx', componentFor(program, INNER, 'Inner'), { note: 'c' }, 'c'),
				uc('lynx', componentFor(program, INNER, 'Inner'), { note: 'd' }, 'd'),
			];
		};
		const painted = paint(true, { rows: rows(true) }, componentFor(true, LIST, 'List'));
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBe(14);

		const background = MainRenderer.renderLynxFirstScreen(componentFor(false, LIST, 'List'), {
			rows: rows(false),
		} as never);

		const { before, after } = adoptInto(painted, background);
		const adopted = new Set(after);
		expect(adopted.size).toBe(before.length);
		for (const node of before) expect(adopted.has(node)).toBe(true);
		for (const node of madeByProgram) expect(adopted.has(node)).toBe(true);
	});

	it("adopts a program in another program's hole, whose IDs interleave with its parent's", () => {
		// The case that stops "find the run covering this ID" from being the whole
		// answer, and the reason the runs say which of the two they are.
		//
		// A hole's members are numbered where the hole sits, not after the
		// program — so a program filling a hole that has hosts after it takes IDs
		// *inside* its parent's span. Here the outer program owns 1, 2, 7, 8 and
		// the text it painted at 9, while the inner one owns 4, 5 and 6. Two runs,
		// overlapping, and "the last run starting at or before this ID" answers 4
		// for ID 7 — a node the inner program never made.
		//
		// Nothing about the page says this at paint time, which is why the mount
		// records it: a program starting inside the previous one's span is what a
		// nested program looks like from the ledger, and adoption then resolves
		// every ID through the per-ID table instead of the search.
		const Inner = componentFor(true, INNER, 'Inner');
		const hosting = componentFor(true, HOSTING_CARD);
		const props = {
			...PROPS,
			label: MainRenderer.universalComponent('lynx', Inner, { note: 'N' }, 'inner'),
		};
		const painted = paint(true, props, hosting);
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBe(8);

		const backgroundInner = componentFor(false, INNER, 'Inner');
		const background = MainRenderer.renderLynxFirstScreen(componentFor(false, HOSTING_CARD), {
			...PROPS,
			label: MainRenderer.universalComponent('lynx', backgroundInner, { note: 'N' }, 'inner'),
		} as never);

		const { before, after } = adoptInto(painted, background);
		const adopted = new Set(after);
		expect(adopted.size).toBe(before.length);
		for (const node of before) expect(adopted.has(node)).toBe(true);
		for (const node of madeByProgram) expect(adopted.has(node)).toBe(true);
	});

	it('adopts a program whose painted hole is numbered just before a listening host', () => {
		// A hole the program painted is a `#text` and not a host, so nothing was
		// installed on it — and the ID it wears sits *between* two hosts rather
		// than on either of them.
		//
		// The comparison asks the run what it bound on an ID by finding where that
		// ID sits among the program's own hosts, and a hole sits at none of them:
		// the answer is no host, therefore no events, which is what the background
		// describes for a `#text` too. A reader that answered with the nearest
		// host instead would hand the hole that host's listeners, count one event
		// against a node the background declares none on, and refuse a page that
		// is correct. That refusal is not a wrong page — it is a repaint on every
		// launch, which is the whole cost this train exists to remove, and it
		// happens only where a listening host follows a painted hole.
		const painted = paint(true, PROPS, componentFor(true, FLAT_CARD, 'Card'));
		// The premise, so the cell cannot pass by losing the shape it is about:
		// both listeners installed, and every node on the page made by the program
		// — which is what says both holes were painted rather than materialized.
		expect(painted.events).toHaveLength(2);
		const paintedByProgram = new Set(painted.made);
		const onPage = nodesOf(painted.page).slice(1);
		expect(onPage).toHaveLength(5);
		for (const node of onPage) expect(paintedByProgram.has(node)).toBe(true);

		const { before, after } = adoptInto(painted, render(false, FLAT_CARD));
		const flatAdopted = new Set(after);
		expect(flatAdopted.size).toBe(before.length);
		for (const node of before) expect(flatAdopted.has(node)).toBe(true);
	});

	it('leaves the adopted page alone when the container that painted it is disposed', () => {
		// After adoption the background journal is the only disposal authority, so
		// the container that painted must be inert against the page it handed on —
		// including the nodes it made for a program, which live in its run rather
		// than in the ordinary ownership set. A source that still claimed them is
		// not visibly wrong at handoff: the page is right, the taps work, and both
		// containers are alive. It goes wrong at the next teardown of a container
		// the app has finished with, which cuts the program's root out of a page
		// another container now owns.
		//
		// Two independent things enforce that, and this asserts the property they
		// jointly hold rather than either one: the handoff marks the source
		// disposed, and it empties every journal including the run. Removing
		// either alone leaves this green, because the other still makes the walk
		// find nothing; removing both turns it red. That is the honest reach of
		// this test, and the reason no single-line mutation of the clearing block
		// is claimed to be caught here.
		const painted = paint(true);
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		const background = render(false);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		const prepared = prepareLynxHostBatch(target, background.batch, { firstTree: captured! });
		expect(prepared.firstTreeAction).toBe('adopt');
		prepared.apply();
		const adopted = nodesOf(painted.page);
		const madeByProgram = new Set(painted.made);
		expect(madeByProgram.size).toBeGreaterThan(0);
		const removedBefore = painted.removes.length;

		expect(disposeLynxHostContainer(painted.container).complete).toBe(true);

		// Not merely "the page still has children": the same nodes, in the same
		// tree, and no native removal attempted against any of them.
		expect(nodesOf(painted.page)).toEqual(adopted);
		expect(painted.removes.slice(removedBefore)).toEqual([]);
		// And the target is still the container that owns them, so the app's own
		// teardown still works afterwards.
		expect(disposeLynxHostContainer(target).complete).toBe(true);
		expect((painted.page as { children: readonly unknown[] }).children).toHaveLength(0);
	});

	it('adopts a program whose optional handler this render did not supply', () => {
		// A program's event journal is now the plan and the tokens the mount
		// installed for it, index-aligned, rather than a map written per node
		// (issue #215 D3) — and the plan lists every site the *component* declares,
		// including one this render passed no handler to and so never installed.
		//
		// That is a way of being wrong the map did not have. A map simply held no
		// entry for an unbound site; a count taken off the plan has to ask which
		// sites were bound, and one that forgot would report two where the
		// background describes one and decline a page that is correct. The other
		// half is the handoff: an unbound site must not acquire a listener on the
		// way through, or the target would own a tuple nothing ever set.
		const unbound = { ...PROPS, onHold: undefined };
		const painted = paint(true, unbound);
		const installed = painted.events.filter((call) => call[3] !== undefined);
		// The premise: two sites declared, one supplied. Without it this cell would
		// be an ordinary adoption test that proves nothing about either half.
		expect(installed).toHaveLength(1);
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		const background = MainRenderer.renderLynxFirstScreen(cardFor(false), unbound as never);
		expect(background.envelope.events).toHaveLength(1);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		const prepared = prepareLynxHostBatch(target, background.batch, { firstTree: captured! });
		expect(prepared.firstTreeAction).toBe('adopt');
		prepared.apply();
		// The bound site crosses the handoff as an ordinary listener the target
		// owns: a tap carrying the token the paint wrote resolves to the listener
		// the background registered.
		const resolved = resolveLynxHostNativeEvent(target, installed[0]![3] as string);
		expect(resolved).not.toBeNull();
		expect(resolved!.listener).toBe(background.envelope.events[0]!.listener.id);
		// And the unbound site is not invented on the way through. Counted at the
		// host boundary rather than read off the tree, because a journal carrying
		// an entry for the unsupplied site clears to the same empty tree — it just
		// spends a crossing telling the host to remove a listener it never had.
		const before = painted.events.length;
		expect(disposeLynxHostContainer(target).complete).toBe(true);
		expect(painted.events.slice(before)).toHaveLength(1);
		for (const node of nodesOf(painted.page)) {
			expect((node as { events: Map<string, unknown> }).events.size).toBe(0);
		}
	});

	it('clears each site with its own PAPI tuple when a program binds two kinds', () => {
		// The journal resolves a site's `(type, name)` pair once per plan now
		// (issue #215 D3) and indexes that table per site. Both sites of the main
		// fixture are `bindtap`, so a table read at the wrong index would answer
		// correctly there and only there. This one binds a tap and a long press,
		// on different hosts, so the wrong index clears `bindEvent:tap` twice and
		// leaves the long press installed on a node teardown has finished with.
		const { container, page } = paint(true, PROPS, componentFor(true, OTHER_CARD, 'Card'));
		const painted = nodesOf(page);
		const kinds = new Set<string>();
		for (const node of painted) {
			for (const key of (node as { events: Map<string, unknown> }).events.keys()) kinds.add(key);
		}
		// The premise: two different PAPI tuples really are installed, so the
		// assertion below is not the single-tuple case restated.
		expect(kinds).toEqual(new Set(['bindEvent:tap', 'bindEvent:longpress']));
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		for (const node of painted) {
			expect((node as { events: Map<string, unknown> }).events.size).toBe(0);
		}
	});

	it('retries only the tuples a failed teardown left behind', () => {
		// Terminal cleanup is retry-safe because `removeNativeEvent` deletes an
		// entry on success and leaves it on failure, and the runs are filled into
		// that journal once (issue #215 D3). A fill that ran again on the retry
		// would put back the entries the first attempt had already cleared, and
		// the page would still end up right — the host would just be told a second
		// time to remove listeners that are already gone. So this counts the
		// crossings rather than the tree.
		const host = createHost();
		let failures = 1;
		const clears: unknown[][] = [];
		const papi = {
			...host,
			setEvent(target: never, kind: never, name: never, listener: never) {
				if (listener === undefined) {
					clears.push([target, kind, name]);
					if (failures > 0) {
						failures -= 1;
						throw new Error('native unbind failed');
					}
				}
				host.setEvent(target, kind, name, listener);
			},
		};
		const container = createLynxHostContainer(papi, { root: 1 });
		const rendered = MainRenderer.renderLynxFirstScreen(cardFor(true), PROPS as never);
		expect(applyLynxFirstScreenDirect(container, rendered.nodes, rendered.envelope)).toBe(true);
		// Two sites installed, one unbind refused: the attempt cannot finish and
		// says so rather than reporting a teardown it did not complete.
		expect(disposeLynxHostContainer(container).complete).toBe(false);
		expect(clears).toHaveLength(2);
		const afterFirst = clears.length;
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(clears.slice(afterFirst)).toHaveLength(1);
		for (const node of nodesOf(papi.pages[0]!)) {
			expect((node as { events: Map<string, unknown> }).events.size).toBe(0);
		}
	});

	it('refuses a description whose taps go somewhere else than the ones it installed', () => {
		// The hole the event check closes, and the reason it is worth its cost.
		//
		// Nothing about a program's subtree is compared — main never had a
		// description of it — so two components agreeing on host count and IDs
		// would otherwise adopt against each other, and every tap on the adopted
		// page would reach a handler the user never wired to that node. Silently,
		// because there is no tree for the difference to show up in.
		//
		// Events are the one thing main does know, because the mount installed a
		// token per announced site. `OTHER_CARD` is that near-miss made concrete:
		// same tree, same IDs, one host carrying a long-press where this one
		// carries a tap.
		const painted = paint(true);
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		const other = render(false, OTHER_CARD);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		let mismatch: string | null = null;
		const prepared = prepareLynxHostBatch(target, other.batch, {
			firstTree: captured!,
			onMismatch: (error) => {
				mismatch = error.message;
			},
		});
		expect(prepared.firstTreeAction).toBe('repair');
		// By the event binding, not by something incidental. A shape difference
		// would also repair, and would prove nothing about this check.
		expect(mismatch).toMatch(/event binding/);
	});

	it('refuses a description that moved a tap onto a host it never installed one on', () => {
		// The other direction, and not a duplicate of the case above. There, a
		// host declares an event main never installed on it, which any per-type
		// lookup catches. Here every event the background declares *is* one main
		// installed somewhere — it has simply moved up a level — so the host that
		// lost it declares nothing, and only comparing how many each side has on
		// that host says so. A tap on the label would otherwise reach nobody, and
		// a tap on the body would reach a handler the page never wired there.
		const painted = paint(true);
		const captured = captureLynxFirstTree(painted.container);
		expect(captured).not.toBeNull();
		const shifted = render(false, SHIFTED_CARD);
		// The premise: the two descriptions really are the same size, so the count
		// that catches this is the per-host one and not a total.
		expect(shifted.envelope.events).toHaveLength(render(false).envelope.events.length);
		expect(shifted.hostCount).toBe(render(false).hostCount);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		let mismatch: string | null = null;
		const prepared = prepareLynxHostBatch(target, shifted.batch, {
			firstTree: captured!,
			onMismatch: (error) => {
				mismatch = error.message;
			},
		});
		expect(prepared.firstTreeAction).toBe('repair');
		expect(mismatch).toMatch(/event binding count/);
	});

	it('routes a tap on a node the program painted to the listener the background registered', () => {
		// The handoff as the user meets it. Adoption moved nodes main made into a
		// container that describes them, and the token the program wrote onto one
		// of those nodes has to keep meaning what it meant — otherwise the first
		// screen is live, looks right, and drops every tap.
		const painted = paint(true);
		const captured = captureLynxFirstTree(painted.container);
		const background = render(false);
		const target = createLynxHostContainer(painted.papi, {
			root: 1,
			page: painted.page as never,
		});
		const prepared = prepareLynxHostBatch(target, background.batch, { firstTree: captured! });
		expect(prepared.firstTreeAction).toBe('adopt');
		prepared.apply();

		// The tokens as the host received them — the fourth argument of every
		// `setEvent` the paint made — rather than anything read out of the
		// container. A tap arrives carrying exactly this string.
		const tokens = painted.events.map((call) => call[3]).filter((value) => value !== undefined);
		expect(tokens).toHaveLength(background.envelope.events.length);
		expect(tokens.length).toBeGreaterThan(0);
		// Every announced binding must be reachable by its token, and reach the
		// listener the background registered for that host.
		const announced = new Map(
			background.envelope.events.map((binding) => [binding.listener.id, binding.listener.priority]),
		);
		for (const token of tokens) {
			const resolved = resolveLynxHostNativeEvent(target, token as string);
			expect(resolved).not.toBeNull();
			expect(announced.get(resolved!.listener)).toBe(resolved!.priority);
		}
		// Distinct listeners, so a container that resolved every token to the same
		// handler could not pass the loop above.
		expect(
			new Set(tokens.map((token) => resolveLynxHostNativeEvent(target, token as string)!.listener))
				.size,
		).toBe(tokens.length);
	});

	it('paints a hole holding a string itself, leaving the page nothing to describe', () => {
		// C5, stated as the population it moves rather than as a count of
		// milliseconds. Both of this fixture's holes hold a string under `PROPS`,
		// and a hole holding a string is a `#text` either way — the only question
		// is which arm makes it. The compiled create makes it, so *every* node on
		// this page came from the program, and a capture that describes a record
		// by reading its physical identity back off the host has nothing to read.
		//
		// Both halves are set membership rather than arithmetic: the first says no
		// node on the page came from the renderer's `createElement`, the second
		// that the capture touched none of them. An arm that left the text holes
		// on the command path satisfies neither, and it is red here rather than
		// merely slower.
		const painted = paint(true);
		const madeByProgram = new Set(painted.made);
		const onPage = nodesOf(painted.page).slice(1);
		expect(onPage.length).toBeGreaterThan(0);
		for (const node of onPage) expect(madeByProgram.has(node)).toBe(true);
		const before = painted.reads.length;
		expect(captureLynxFirstTree(painted.container)).not.toBeNull();
		for (const node of painted.reads.slice(before)) expect(madeByProgram.has(node)).toBe(false);

		// And the interpreted arm over the same source is the control: the same
		// six nodes, none of them made by a program, every one of them read back.
		const interpreted = paint(false);
		const interpretedOnPage = nodesOf(interpreted.page).slice(1);
		expect(interpretedOnPage).toHaveLength(onPage.length);
		expect(interpreted.made).toHaveLength(0);
	});

	it('reads back no node the program made, to describe the tree it hands on', () => {
		// The cost the inverted handoff removes, stated as host crossings.
		//
		// A capture describes a record by reading its physical identity back off
		// the host, once per record. A program writes no record for any node it
		// makes — the run the mount kept is what adoption resolves against
		// instead — so those hosts are described by nothing and read back for
		// nothing. What remains is a keyed range's members where the program left
		// the hole open, which the renderer materialized through the ordinary path
		// and which therefore do have records.
		//
		// `detail` is a number here for exactly that reason. C5 compiles a hole
		// whose value arrives as a *string*, and both of this fixture's holes hold
		// one under `PROPS` — so with the default props the program paints the
		// whole tree and the described population is empty, which would make the
		// first half of the disjointness vacuously true rather than checked. A
		// number is a value the compiled test declines and `materialize` still
		// renders as text, so it is the smallest fixture that keeps one described
		// node while changing nothing about what the program does with the other
		// hole.
		//
		// #163's "no capture walk, no read-backs" is exactly this, and it is a
		// disjointness rather than a count: a capture that walked the program's
		// subtree would be red here however many nodes it happened to touch.
		const NUMERIC_DETAIL = { ...PROPS, detail: 7 };
		const painted = paint(true, NUMERIC_DETAIL);
		const madeByProgram = new Set(painted.made);
		const described = nodesOf(painted.page)
			.slice(1)
			.filter((node) => !madeByProgram.has(node));
		const before = painted.reads.length;
		expect(captureLynxFirstTree(painted.container)).not.toBeNull();
		const readBack = new Set(painted.reads.slice(before));
		// Both halves, so neither can hold alone. A capture that read nothing at
		// all would satisfy the second on its own.
		expect(described.length).toBeGreaterThan(0);
		expect(madeByProgram.size).toBeGreaterThan(0);
		for (const node of described) expect(readBack.has(node)).toBe(true);
		for (const node of madeByProgram) expect(readBack.has(node)).toBe(false);

		// The differential: the same capture, over the same component, reads every
		// painted node back when every painted node is described. Nothing about
		// the walk changed — what changed is how much of the tree it is asked
		// about.
		const interpreted = paint(false, NUMERIC_DETAIL);
		expect(interpreted.made).toHaveLength(0);
		const interpretedNodes = nodesOf(interpreted.page).slice(1);
		const interpretedBefore = interpreted.reads.length;
		expect(captureLynxFirstTree(interpreted.container)).not.toBeNull();
		const interpretedReadBack = new Set(interpreted.reads.slice(interpretedBefore));
		for (const node of interpretedNodes) expect(interpretedReadBack.has(node)).toBe(true);
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
		let thrown: unknown;
		try {
			applyLynxFirstScreenDirect(container, [chrome, ...rendered.nodes], rendered.envelope);
		} catch (error) {
			thrown = error;
		}
		expect((thrown as Error).message).toMatch(/intrinsic element factories/);
		expect(papi.pages[0]!.children).toHaveLength(0);
		// And *which kind* of refusal, which is the other half of the answer (#163
		// C3). A host with no intrinsics is a capability of the host rather than a
		// defect in the page: the same source renders correctly on the command
		// path, so this costs the first screen and not the launch.
		expect(thrown).toBeInstanceOf(MainRenderer.LynxFirstScreenRefusalError);
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
