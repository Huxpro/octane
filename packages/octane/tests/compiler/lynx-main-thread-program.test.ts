// Issue-#163 C1c: the `target: 'lynx'` main-thread compile emits the compiled
// create function instead of a description an interpreter walks.
//
// The emission itself is the renderer's, and its agreement with the dense
// applier is proven in `@octanejs/lynx`'s own suites. What is proven here is the
// join, which is the part neither package can test alone:
//
//   * the gate. Nothing changes unless a backend is supplied *and* the compile is
//     the main-thread one, because #163 keeps the background chunk and the
//     universal bundle byte-identical across the switch, and that claim must not
//     rest on a caller passing the option to exactly one layer.
//   * the wiring. The create function takes its values and listeners
//     positionally, so the maps beside it are the only thing that says which plan
//     slot each position reads. A compile that emitted a correct function and a
//     shifted map would paint a plausible wrong tree.
//   * the seam. A backend hands over source text and a pair of counts; the
//     compiler parses the source and is entitled to disbelieve the counts.
import { describe, expect, it } from 'vitest';

import { compile } from '../../src/compiler/compile.js';
import { lynxMainThreadRenderer } from '../../../lynx/src/config.js';
import * as Backend from '../../../lynx/src/compiler/index.js';
import {
	compileLynxBlockTemplate,
	createLynxBlockCore,
} from '../../../lynx/src/core/block-core.js';
import {
	createLynxHostContainer,
	prepareLynxHostBatch,
} from '../../../lynx/src/core/host-driver.js';
import {
	createFakePAPI,
	shape,
	withoutAllocatorIdentity,
} from '../../../lynx/tests/_fixtures/fake-element-papi.js';

/**
 * A card: two bound props on one node, a static class beside a tap, and both
 * shapes of text hole.
 *
 * Both props are on the root deliberately. With one binding per node a plan slot
 * and the node that reads it happen to share an index, and a map that returned
 * either would look right — so the fixture makes them disagree, which is the only
 * way the wiring assertion below is an assertion at all.
 *
 * The two text holes disagree deliberately too. `{props.label as string}` is the
 * form the author uses to assert a scalar, so it folds onto its `<text>` as a
 * bound `text` prop and costs the program no node (#242 Cause B / #246 B2);
 * `{props.detail}` asserts nothing, so it stays a range site whose members the
 * renderer instantiates. Keeping one of each is what lets the assertions below
 * distinguish the two rather than describe whichever one the fixture happened to
 * use.
 */
const CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string; detail: unknown; tone: string; ident: string; onPick: () => void }) @{
	<view class={props.tone} id={props.ident}>
		<text class="card-label" bindtap={props.onPick}>{props.label as string}</text>
		<view class="card-body"><text class="d">{props.detail}</text></view>
	</view>
}
`;

/** The same program with every child hole proved scalar, so its wire is complete. */
const ADDRESSABLE_CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string; detail: string; tone: string; ident: string; onPick: () => void }) @{
	<view class={props.tone} id={props.ident}>
		<text class="card-label" bindtap={props.onPick}>{props.label as string}</text>
		<view class="card-body"><text class="d">{props.detail as string}</text></view>
	</view>
}
`;

type CompileShape = {
	readonly target?: 'lynx' | 'universal';
	readonly thread?: 'main-thread' | 'background';
	readonly backend?: unknown;
	/**
	 * The package-relative module id an addressing build assigns (issue #246
	 * §6.2). Its presence is what turns the addressing on, in both compiles.
	 */
	readonly module?: string;
};

function compileCard(source: string, options: CompileShape = {}): { code: string; map: any } {
	const { target = 'lynx', thread = 'main-thread', backend, module } = options;
	return compile(source, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread },
		...(backend === undefined ? null : { mainThreadProgramBackend: backend }),
		...(module === undefined ? null : { programModuleId: module }),
	}) as { code: string; map: any };
}

function compiled(source: string, options: CompileShape = {}): string {
	return compileCard(source, options).code;
}

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Every authored line the map points at, decoded the way
 * `compiler-map-coverage.test.ts` decodes it.
 *
 * Only the source-line field is kept, because the property under test is whether
 * the emitted program is attributed to the template it came from at all — not
 * which column of it.
 */
function originalLinesOf(mappings: string): number[] {
	const lines: number[] = [];
	let sourceLine = 0;
	for (const group of mappings.split(';')) {
		for (const segment of group.split(',')) {
			if (segment === '') continue;
			const fields: number[] = [];
			let value = 0;
			let shift = 0;
			for (const char of segment) {
				const digit = VLQ_CHARS.indexOf(char);
				value += (digit & 31) << shift;
				if (digit & 32) {
					shift += 5;
				} else {
					fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
					value = 0;
					shift = 0;
				}
			}
			if (fields.length < 4) continue;
			sourceLine += fields[2]!;
			lines.push(sourceLine);
		}
	}
	return lines;
}

interface EvaluatedModule {
	/** Every plan root the module declared, in declaration order. */
	readonly roots: readonly any[];
	/** The address each of those plans was declared with, `undefined` for none. */
	readonly addresses: readonly any[];
	/** The module's `Card`, which returns its plan and that plan's value array. */
	readonly card: (props: unknown) => { readonly values: readonly unknown[] };
}

/**
 * Run the emitted module against a stand-in renderer that records plan roots.
 *
 * The renderer is a stand-in rather than `@octanejs/lynx/main-renderer` because
 * nothing consumes a compiled program yet: teaching the renderer to freeze,
 * adopt and update one is #163's C2, and this slice deliberately lands the
 * emission ahead of it. Recording the root is also the sharper observation —
 * it is the artifact this compile produces, and the assertions below are about
 * that artifact rather than about what some later renderer does with it.
 */
function evaluate(code: string): EvaluatedModule {
	const roots: any[] = [];
	const addresses: any[] = [];
	const renderer = {
		universalPlan: (_renderer: string, root: unknown, address?: unknown) => {
			roots.push(root);
			addresses.push(address);
			return root;
		},
		universalValue: (plan: unknown, values: readonly unknown[]) => ({ plan, values }),
		defineUniversalComponent: (_renderer: string, render: unknown) => render,
		firstScreenEvent: Symbol('firstScreenEvent'),
	};
	const rewritten = code
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/main-renderer["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __renderer;`,
		)
		.replace('export const Card =', 'const Card =');
	const card = new Function('__renderer', `${rewritten}\nreturn Card;`)(renderer);
	return { roots, addresses, card: card as EvaluatedModule['card'] };
}

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

function withoutNodesRefSelector(node: unknown): unknown {
	const value = node as { readonly children: readonly unknown[] };
	return { ...value, selector: '', children: value.children.map(withoutNodesRefSelector) };
}

function paintedTree(node: unknown): unknown {
	return withoutAllocatorIdentity(withoutNodesRefSelector(node));
}

/** The tree the compiled create function paints for one instance. */
function throughCompiledProgram(root: any, values: readonly unknown[]): unknown {
	const papi = createHost();
	// The container is what opens the page; after that the compiled code drives
	// the PAPI directly, which is the entire claim.
	createLynxHostContainer(papi, { root: 1 });
	const page = papi.pages[0]!;
	const args = [
		...root.values.map((slot: number) => values[slot]),
		...root.events.map(() => () => undefined),
	];
	// The compiled create returns an unattached subtree and leaves the single
	// append to its caller, so that a keyed range's members can go into a node it
	// made before any of it is live.
	const nodes = root.bind(papi)(page.id, ...args) as readonly never[];
	papi.insertBefore(page as never, nodes[0]!, null);
	return shape(papi.pages[0]!);
}

/** The same instance, painted by the dense applier from the same plan. */
function throughApplier(planRoot: unknown, values: readonly unknown[]): unknown {
	const derived = Backend.deriveLynxMainThreadProgram(planRoot as never)!;
	const papi = createHost();
	const container = createLynxHostContainer(papi, { root: 1 });
	const core = createLynxBlockCore();
	core.mount(
		null,
		null,
		compileLynxBlockTemplate(derived.wire),
		derived.values.map((value) => values[value.slot]) as never,
	);
	const batch = core.flush();
	if (batch !== null) prepareLynxHostBatch(container, batch).apply();
	return shape(papi.pages[0]!);
}

describe('emitting a compiled create function from the lynx main-thread compile', () => {
	it('changes nothing unless a backend is supplied', () => {
		expect(compiled(CARD, { backend: Backend })).not.toBe(compiled(CARD));
		// The plan the module declares is the same plan either way; only its
		// representation moved. If that stops being true, the two compiles have
		// diverged about something other than the emission.
		expect(evaluate(compiled(CARD, { backend: Backend })).roots[0].slots).toEqual(
			evaluate(compiled(CARD)).roots[0].slots,
		);
	});

	it('changes nothing outside the main-thread lynx compile', () => {
		// The background layer and the universal bundle are byte-identical across
		// the switch by construction, not by the caller remembering where to pass
		// the option. Both gates are asserted, because either one alone would let
		// a mis-wired build change a chunk #163 promises not to touch.
		for (const shapeOptions of [
			{ target: 'lynx', thread: 'background' },
			{ target: 'universal', thread: 'main-thread' },
			{ target: 'universal', thread: 'background' },
		] as const) {
			expect(
				compiled(CARD, { ...shapeOptions, backend: Backend }),
				JSON.stringify(shapeOptions),
			).toBe(compiled(CARD, shapeOptions));
		}
	});

	it('replaces the interpreted description with a compiled create function', () => {
		const code = compiled(CARD, { backend: Backend });
		// The thesis, stated as an assertion: the main-thread chunk carries no
		// `create(env, values)` for this plan, because there is nothing left to
		// interpret.
		expect(code).not.toContain('"create"');
		const [root] = evaluate(code).roots;
		expect(root.kind).toBe('program');
		expect(typeof root.bind).toBe('function');
		// The keyed slot map survives unchanged: it is the contract, not the
		// description. `p:text` is the proved-scalar hole folded onto its `<text>`
		// and `r` the bare one that stayed a range site.
		expect(root.slots).toEqual(['p:class', 'p:id', 'e:bindtap', 'p:text', 'r']);
	});

	it('maps each create-function parameter back to the plan slot it reads', () => {
		const { roots, card } = evaluate(compiled(CARD, { backend: Backend }));
		const [root] = roots;
		// The component's own value array is the reference: whatever order the
		// compiler chose for `v0..vN` and `e0..eM`, these say how to index it.
		// Plan slots, not node indices: `v0` and `v1` are both written onto node 0,
		// and `e0` sits on node 1 while reading plan slot 2. `v2` reads plan slot 3
		// — the folded text — and is written onto node 1 beside the listener, which
		// is the shape a proved-scalar hole takes once it is a prop rather than a
		// range (#246 B2).
		expect(root.values).toEqual([0, 1, 3]);
		// An event site carries what routing a tap needs and nothing a walk could
		// recover: the driver's event type rather than the authored `bindtap`, and
		// the priority the driver classified it at.
		expect(root.events).toEqual([{ slot: 2, node: 1, type: 'bindtap', priority: 'discrete' }]);
		// One range, not two: the `card-label` hole proved itself scalar and folded
		// into `values` above, and only the bare `{props.detail}` is still a site
		// whose members the renderer instantiates. It names the emitted node they
		// are appended into.
		//
		// `id` is where the range sat in the plan's pre-order, which is the one
		// thing the node list cannot say because the program dropped it. Counting
		// the program's four nodes and its one range: view(0), card-label(1),
		// card-body(2), the `d` text(3), its range(4).
		expect(root.ranges).toEqual([{ slot: 4, node: 3, id: 4, paintsText: true }]);
		// The count the create function makes, which is what a consumer claiming
		// first-screen IDs needs and all it needs: the nodes come back from `bind`
		// in this order, so nothing walks anything to pair them up.
		expect(root.nodes).toBe(4);
		const value = card({
			tone: 'card active',
			ident: 'card-1',
			label: 'Label',
			detail: 'Detail',
			onPick: () => {},
		});
		expect(value.values[root.values[0]]).toBe('card active');
		expect(value.values[root.values[1]]).toBe('card-1');
	});

	it('compiles a literal text child but leaves an unproved one a range site', () => {
		// The line #163's C2 has to answer, pinned here because it is the one thing
		// a build cannot decide for itself. A literal is a `kind: 'text'` node with
		// a value, so it folds onto its host and costs the program nothing. A bare
		// `{expr}` asserts nothing about its value — it can be an array or a
		// component just as a directive can — so it stays a `kind: 'slot'` node,
		// the text a row actually shows is a range, and the compiled create paints
		// structure and scalar props around it. (`{expr as string}` is the third
		// case and folds like the literal; it has its own coverage below.)
		const MIXED = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: unknown }) @{
	<view class="a"><text class="fixed">{'tail'}</text><text class="live">{props.label}</text></view>
}
`;
		const [root] = evaluate(compiled(MIXED, { backend: Backend })).roots;
		expect(root.kind).toBe('program');
		// Node 2, after view(0) and the `fixed` text(1). The literal is no longer
		// a node at all: #242 Cause A folds it onto its host as a `text` prop, so
		// the carrier the program used to carry is gone and the `live` text moved
		// up one. That sharpens the contrast rather than blurring it — a literal
		// costs the program no node, and a dynamic hole costs it a range site.
		// `paintsText` is the fourth member and the one C5 added: the hole stays a
		// range at build time, and the create function carries the run-time test
		// that paints it when the value turns out to be a string. It is true here
		// because the hole's host is a `text`; a hole under a `view` is the
		// ordinary keyed list at every value and would read `false`.
		expect(root.ranges).toEqual([{ slot: 0, node: 2, id: 3, paintsText: true }]);
		const papi = createHost();
		createLynxHostContainer(papi, { root: 1 });
		const page = papi.pages[0]!;
		const create = root.bind(papi);
		const nodes = create(page.id) as readonly never[];
		papi.insertBefore(page as never, nodes[0]!, null);
		// The literal is painted; a hole sent no string is left open. One entry
		// per range follows the program's nodes either way, so the position of an
		// answer never depends on what the answer is.
		expect(nodes).toHaveLength(4);
		expect(nodes[3]).toBeUndefined();
		expect(JSON.stringify(shape(papi.pages[0]!))).toContain('tail');
		expect(JSON.stringify(shape(papi.pages[0]!))).not.toContain('Live');

		// And the same create, handed the string the hole turned out to hold: the
		// text is painted by the program, behind the `fixed` cell that now carries
		// its own literal, and comes back in the range's slot so a caller can own
		// the node it now has.
		const second = createHost();
		createLynxHostContainer(second, { root: 1 });
		const secondPage = second.pages[0]!;
		const painted = root.bind(second)(secondPage.id, 'Live') as readonly never[];
		second.insertBefore(secondPage as never, painted[0]!, null);
		expect(painted).toHaveLength(4);
		expect(painted[3]).toBeDefined();
		const shaped = JSON.stringify(shape(second.pages[0]!));
		expect(shaped).toContain('tail');
		expect(shaped).toContain('Live');
	});

	it('paints what the dense applier paints from the same plan', () => {
		const values = ['card active', 'card-1', null, 'Label', 'Detail'];
		const [programRoot] = evaluate(compiled(CARD, { backend: Backend })).roots;
		// The universal target serializes the plan IR verbatim, which is the same
		// object the backend was handed inside the compile — so the applier arm
		// starts from the compiler's plan rather than from a fixture rebuilt to
		// look like it.
		const [planRoot] = evaluate(compiled(CARD, { target: 'universal' })).roots;
		expect(paintedTree(throughCompiledProgram(programRoot, values))).toEqual(
			paintedTree(throughApplier(planRoot, values)),
		);
	});

	it('attributes the compiled create function to the template it came from', () => {
		// The map is a published artifact, and the emitted program is source the
		// compiler parsed rather than built — so it arrives carrying positions into
		// the string it was parsed from, which mean nothing here. Left alone they
		// would aim a debugger at whatever happens to sit at that offset of the
		// authored module, or past its end.
		const withBackend = compileCard(CARD, { backend: Backend });
		const map = typeof withBackend.map === 'string' ? JSON.parse(withBackend.map) : withBackend.map;
		const authoredLines = CARD.split('\n').length;
		const lines = originalLinesOf(map.mappings as string);
		expect(lines.length).toBeGreaterThan(0);
		expect(Math.max(...lines)).toBeLessThan(authoredLines);
		// And the assertion is being exercised over the new code, not only over the
		// module that would have been emitted anyway.
		expect(withBackend.code.split('\n').length).toBeGreaterThan(compiled(CARD).split('\n').length);
	});

	it('leaves a plan the backend declines on the interpreted encoding', () => {
		// A renderable hole that is not its parent's last child cannot be lifted out
		// as a range without moving the siblings after it, so the backend declines
		// the whole plan and the compile keeps the encoding it had before the
		// backend existed. "Not describable as a program" is the ordinary answer for
		// most plans, so it has to be silent rather than fatal.
		const AHEAD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string }) @{
	<text class="l">{props.label as string}{'tail'}</text>
}
`;
		expect(compiled(AHEAD, { backend: Backend })).toBe(compiled(AHEAD));
		expect(evaluate(compiled(AHEAD, { backend: Backend })).roots[0].kind).toBe('template');
	});

	it('fails the build when the backend refuses a plan it can describe', () => {
		// An inline style is written by the general prop-patch path and by nothing
		// the emission can call, so emitting the program anyway would paint a first
		// screen that differs from the one the command path paints. Naming the prop
		// at build time is the whole point of a refusal being an error.
		const STYLED = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { tone: string; label: string }) @{
	<view class={props.tone} style="color:red"><text class="l">{props.label as string}</text></view>
}
`;
		expect(() => compiled(STYLED, { backend: Backend })).toThrowError(/"style"/);
	});

	it("copies each site's paint answer from the emission rather than assuming it", () => {
		// Both kinds of *range site* in one program, because the contrast is the
		// point. `{props.label}` sits under a `text`, where a string is raw text
		// and the create function paints it. `{props.rows}` sits under a `view`,
		// where a hole is the ordinary keyed list at every value it can hold — a
		// `rawText` there is the one thing the emitter's node loop already refuses
		// — so it keeps its parameter and compiles nothing.
		//
		// Both are bare holes, so neither folds: this is about what the emission
		// does with a site that survived to the program, and a proved-scalar hole
		// never reaches one.
		//
		// The compiler cannot tell those apart without asking: it holds the
		// derivation, not the emitted source. Assuming `true` is invisible until
		// a `view` hole happens to hold a string, and then the renderer skips
		// materializing a member the program never painted.
		const BOTH = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { rows: unknown; label: unknown }) @{
	<view class="a"><text class="l">{props.label}</text><view class="rows">{props.rows}</view></view>
}
`;
		const [root] = evaluate(compiled(BOTH, { backend: Backend })).roots;
		expect(root.kind).toBe('program');
		expect(root.ranges).toEqual([
			{ slot: 0, node: 1, id: 2, paintsText: true },
			{ slot: 1, node: 2, id: 4, paintsText: false },
		]);
	});

	it('fails the build when a backend contradicts itself about its own arity', () => {
		// The two halves of a backend can be versioned apart, and a create function
		// taking fewer parameters than its map declares would read its values from
		// shifted positions — a first screen that is wrong rather than absent. The
		// compiler takes the source on trust and the counts on evidence.
		const lying = {
			deriveLynxMainThreadProgram: Backend.deriveLynxMainThreadProgram,
			emitLynxMainThreadProgram: (program: never, options: { readonly name: string }) => ({
				...Backend.emitLynxMainThreadProgram(program, options),
				valueCount: 99,
			}),
		};
		expect(() => compiled(CARD, { backend: lying })).toThrowError(
			/takes 99 value, 1 listener and 1 range parameters, but its derivation declares 3 values, 1 events and 1 ranges/,
		);
	});

	it('fails the build when a backend returns more than a single expression', () => {
		// Source shaped like `fn); (trailer` parses to two statements inside the
		// compiler's `(source);` wrapper. Embedding only the first would silently
		// truncate the backend's output — a shorter create function instead of a
		// build error naming the backend.
		const trailing = {
			deriveLynxMainThreadProgram: Backend.deriveLynxMainThreadProgram,
			emitLynxMainThreadProgram: (program: never, options: { readonly name: string }) => {
				const emission = Backend.emitLynxMainThreadProgram(program, options);
				return { ...emission, source: `${emission.source}); (0` };
			},
		};
		expect(() => compiled(CARD, { backend: trailing })).toThrowError(/not a single expression/);
	});
});

// Issue-#246 E1 — how a background-originated mount names a resident program.
//
// #163's join is first-screen-shaped: the main thread *renders*, so it holds the
// plan object whose `bind` produces the create, and the applier keys its
// `boundPrograms` cache on that object. Nothing has to be named because nothing
// crosses a realm.
//
// E1 inverts that. The background renders a keyed range and asks the main thread
// to instantiate a resident program, so it has to name one. These two tests were
// written for #238 to pin the *absence* of that name; §5 of #246 said they must
// be converted rather than deleted when the addressing lands, because their
// value is that the change cannot happen quietly. Converted, they now pin the
// name itself and the price it is allowed to cost.
describe('naming a resident program from the background (issue #246 E1)', () => {
	it('declines an address when runtime text ranges can change the background wire', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { row: { id: number; label: string }; isSelected: boolean; onSelect: (id: number) => void; onRemove: (id: number) => void }) @{
	<view class={['row', props.isSelected && 'danger']}>
		<text class="col-id">{String(props.row.id)}</text>
		<text class="col-label" bindtap={() => props.onSelect(props.row.id)}>{props.row.label}</text>
		<text class="col-remove" bindtap={() => props.onRemove(props.row.id)}>{'x'}</text>
	</view>
}
`;
		const main = evaluate(compiled(source, { backend: Backend, module: 'src/Row.lynx.tsrx' }));
		const background = evaluate(
			compiled(source, { thread: 'background', backend: Backend, module: 'src/Row.lynx.tsrx' }),
		);

		// This is the real-device #275 shape. The compiled create keeps the two
		// unproved children as runtime ranges, while the background can observe
		// their current string values and lower a denser descriptor. Naming the
		// resident one would make its one value slot validate the background's
		// three values and reject the dynamic commit before it paints.
		expect(main.roots[0].values).toEqual([0]);
		expect(main.roots[0].ranges).toHaveLength(2);
		expect(main.roots[0]).not.toHaveProperty('wire');
		expect(main.addresses).toEqual([undefined]);
		expect(background.addresses).toEqual([undefined]);
	});
	it('compiles one plan to a program on the main thread and a template on the background', () => {
		const [mainThread] = evaluate(compiled(ADDRESSABLE_CARD, { backend: Backend })).roots;
		const [background] = evaluate(
			compiled(ADDRESSABLE_CARD, { thread: 'background', backend: Backend }),
		).roots;
		// Same source, same backend, same plan — two node kinds. The background's
		// is the interpreted description it has always had, because
		// `lynxMainThreadProgramObjectAst` returns null off the main-thread compile
		// and the caller falls back to `lynxTemplateObjectAst`.
		expect(mainThread.kind).toBe('program');
		expect(background.kind).toBe('template');
		// The slot map is the contract both representations keep, which is what
		// makes them two encodings of one plan rather than two plans. B2 is why
		// this is worth re-checking: a proved-scalar hole folds onto its host, and
		// it has to fold identically in both compiles or the two encodings would
		// describe different plans while claiming to be one.
		expect(background.slots).toEqual(mainThread.slots);
		expect(mainThread.slots).toContain('p:text');
	});

	it('gives both sides the same identifier, and only when the build assigns one', () => {
		// Without a module id nothing is addressed, which is #246 §6.3's refusal
		// reaching the compiler: a build that cannot cross-check its two layers
		// emits no name for either of them to trust.
		expect(evaluate(compiled(ADDRESSABLE_CARD, { backend: Backend })).addresses).toEqual([
			undefined,
		]);

		const module = 'src/Card.lynx.tsrx';
		const mainThread = evaluate(compiled(ADDRESSABLE_CARD, { backend: Backend, module }));
		const background = evaluate(
			compiled(ADDRESSABLE_CARD, { thread: 'background', backend: Backend, module }),
		);

		// The address is what crosses the realm, and it is positional plus a
		// digest: `(module id, plan index)` is what a `mount-program-run` carries,
		// and the digest is what the build compares (#246 §6.1's A+B split).
		expect(Object.keys(mainThread.addresses[0]).sort()).toEqual(['digest', 'index', 'module']);
		expect(mainThread.addresses[0].module).toBe(module);
		expect(mainThread.addresses[0].index).toBe(0);
		// The whole point: the two compiles independently produced the same name
		// for the same plan. They agree by construction rather than by luck —
		// both run `deriveLynxMainThreadProgram` as a pure oracle over the same
		// plan root, and the digest covers exactly the surface it produced.
		expect(background.addresses).toEqual(mainThread.addresses);
		expect(mainThread.addresses[0].digest).toMatch(/^[0-9a-f]{16}$/);

		// What each side carries beyond the address. `bind` and `create` are
		// functions, so they stay realm-local; `wire` is the descriptor a command
		// -path mount walks, resident on the main thread instead of being sent.
		expect(Object.keys(mainThread.roots[0]).sort()).toEqual([
			'bind',
			'events',
			'kind',
			'nodes',
			'ranges',
			'slots',
			'values',
			'wire',
		]);
		expect(Object.keys(background.roots[0]).sort()).toEqual(['create', 'kind', 'slots']);
	});

	it('changes the background chunk by exactly the addressing, and nothing else', () => {
		// #246 §5. #163's gate for the background chunk was "changes nothing
		// outside the main-thread lynx compile", and the addressing breaks it by
		// design: the background has to learn the name or it cannot say it. §5 said
		// to replace that gate with a narrower one rather than delete it, and this
		// is it — the background compile changes by the address argument and by
		// nothing else at all.
		const module = 'src/Card.lynx.tsrx';
		const plain = compiled(ADDRESSABLE_CARD, { thread: 'background', backend: Backend });
		const addressed = compiled(ADDRESSABLE_CARD, {
			thread: 'background',
			backend: Backend,
			module,
		});
		expect(addressed).not.toBe(plain);
		// Whitespace around punctuation is normalized first, and that is the one
		// concession: a `universalPlan` call with a third argument no longer fits
		// on one line, so the printer wraps it and re-indents everything inside it.
		// Every token is the same token; the gate is about what the chunk says, not
		// how it is laid out. The structural comparison at the end of this test is
		// what covers the difference a normalization like this could hide.
		const collapse = (code: string) =>
			code
				.replace(/\s+/g, ' ')
				.replace(/\s*([(){}[\],;])\s*/g, '$1')
				.trim();
		// Strip exactly the third argument of every `universalPlan` call and the
		// two chunks must be identical again. Nothing else may differ: not the plan
		// encoding, not the module's imports, not a token of the component bodies.
		const withoutAddress = collapse(addressed).replace(
			/,\{"module": ?"[^"]*","index": ?\d+,"digest": ?"[0-9a-f]{16}"\}/g,
			'',
		);
		expect(withoutAddress).toBe(collapse(plain));
		// The strip is not vacuous: it really removed something.
		expect(withoutAddress).not.toBe(collapse(addressed));
		// And the plan the background declares is the same plan either way, which
		// is the property the token comparison stands in for.
		const [plainRoot] = evaluate(plain).roots;
		const [addressedRoot] = evaluate(addressed).roots;
		expect(addressedRoot.slots).toEqual(plainRoot.slots);
		expect(collapse(addressedRoot.create.toString())).toBe(collapse(plainRoot.create.toString()));
	});
});
