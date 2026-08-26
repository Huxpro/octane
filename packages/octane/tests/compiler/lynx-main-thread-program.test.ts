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
 * A card: two bound props on one node, a static class beside a tap, two text
 * holes.
 *
 * Both props are on the root deliberately. With one binding per node a plan slot
 * and the node that reads it happen to share an index, and a map that returned
 * either would look right — so the fixture makes them disagree, which is the only
 * way the wiring assertion below is an assertion at all.
 */
const CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
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
};

function compileCard(source: string, options: CompileShape = {}): { code: string; map: any } {
	const { target = 'lynx', thread = 'main-thread', backend } = options;
	return compile(source, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: { ...lynxMainThreadRenderer, target, id: 'lynx' },
		universalRuntime: { runtime: 'lynx', thread },
		...(backend === undefined ? null : { mainThreadProgramBackend: backend }),
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
	const renderer = {
		universalPlan: (_renderer: string, root: unknown) => {
			roots.push(root);
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
	return { roots, card: card as EvaluatedModule['card'] };
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
	root.bind(papi)(page.id, page, ...args);
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
		// description.
		expect(root.slots).toEqual(['p:class', 'p:id', 'e:bindtap', 'r', 'r']);
	});

	it('maps each create-function parameter back to the plan slot it reads', () => {
		const { roots, card } = evaluate(compiled(CARD, { backend: Backend }));
		const [root] = roots;
		// The component's own value array is the reference: whatever order the
		// compiler chose for `v0..vN` and `e0..eM`, these say how to index it.
		// Plan slots, not node indices: `v0` and `v1` are both written onto node 0,
		// and `e0` sits on node 1 while reading plan slot 2.
		expect(root.values).toEqual([0, 1]);
		// An event site carries what routing a tap needs and nothing a walk could
		// recover: the driver's event type rather than the authored `bindtap`, and
		// the priority the driver classified it at.
		expect(root.events).toEqual([{ slot: 2, node: 1, type: 'bindtap', priority: 'discrete' }]);
		// Both text holes are keyed ranges — a cast is erased before lowering, so
		// no plan the compiler builds claims a hole holds a string — and each names
		// the emitted node its members are appended into.
		//
		// `id` is where the range sat in the plan's pre-order, which is the one
		// thing the node list cannot say because the program dropped it. Counting
		// the program's four nodes and its two ranges: view(0), card-label(1),
		// its range(2), card-body(3), the `d` text(4), its range(5).
		expect(root.ranges).toEqual([
			{ slot: 3, node: 1, id: 2 },
			{ slot: 4, node: 3, id: 5 },
		]);
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

	it('compiles a literal text child but leaves a dynamic one a range site', () => {
		// The line #163's C2 has to answer, pinned here because it is the one thing
		// a build cannot decide for itself. A literal is a `kind: 'text'` node with
		// a value, so it compiles into the create function as a `#text` the emitted
		// code makes. A `{expr as string}` is a `kind: 'slot'` node like any other
		// dynamic child, because the cast is erased and nothing at build time knows
		// the value will be a string — so the text a row actually shows is a range,
		// and the compiled create paints structure and scalar props around it.
		const MIXED = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string }) @{
	<view class="a"><text class="fixed">{'tail'}</text><text class="live">{props.label as string}</text></view>
}
`;
		const [root] = evaluate(compiled(MIXED, { backend: Backend })).roots;
		expect(root.kind).toBe('program');
		// Node 3, not 2: the literal is its own `#text` node in the compiled
		// program, which is exactly the contrast this test is drawing.
		// Position 4, after view(0), the `fixed` text(1), its literal `#text`(2)
		// and the `live` text(3): the literal is a program node and the dynamic
		// hole is not, which is the contrast this test is drawing.
		expect(root.ranges).toEqual([{ slot: 0, node: 3, id: 4 }]);
		const papi = createHost();
		createLynxHostContainer(papi, { root: 1 });
		const page = papi.pages[0]!;
		root.bind(papi)(page.id, page);
		// The literal is painted; nothing paints the dynamic one.
		expect(JSON.stringify(shape(papi.pages[0]!))).toContain('tail');
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
			/takes 99 value and 1 listener parameters, but its derivation declares 2 values and 1 events/,
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
