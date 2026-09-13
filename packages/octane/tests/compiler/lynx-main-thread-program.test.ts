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
	type FakeNode,
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

/** A fixed shell whose keyed members remain a structural range. */
const STRUCTURAL_ADDRESSABLE_CARD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { items: readonly { id: number; label: string }[] }) @{
	<view class="page">
		<view class="rows">
			@for (const item of props.items; key item.id) {
				<view id={String(item.id)}><text>{item.label as string}</text></view>
			}
		</view>
	</view>
}
`;

type CompileShape = {
	readonly target?: 'lynx' | 'universal';
	readonly thread?: 'main-thread' | 'background';
	readonly backend?: unknown;
	/** Emit the compiler-owned background program consumed by the Block core. */
	readonly backgroundProgram?: boolean;
	/**
	 * The package-relative module id an addressing build assigns (issue #246
	 * §6.2). Its presence is what turns the addressing on, in both compiles.
	 */
	readonly module?: string;
};

function compileCard(
	source: string,
	options: CompileShape = {},
): {
	code: string;
	map: any;
	mainThreadProgramCoverage?: { total: number; addressed: number };
	lynxBlockSemanticRequirements?: {
		version: number;
		runtimeUses: readonly { name: string; line: number; column: number }[];
		runtimeExports: readonly { name: string; line: number; column: number }[];
		opaqueRuntimeAccesses: readonly { name: string; line: number; column: number }[];
		components: readonly {
			name: string;
			exportKind: string | null;
			line: number;
			column: number;
			hooks: readonly { name: string; line: number; column: number }[];
		}[];
	};
	lynxBlockFeatureRequirements?: {
		version: number;
		threadFunctions: readonly {
			kind: string;
			id: string;
			line: number;
			column: number;
			captures: readonly string[];
		}[];
		mainThreadProps: readonly { name: string; line: number; column: number }[];
		templateFeatures: readonly {
			kind: string;
			name: string | null;
			line: number;
			column: number;
		}[];
		keyedRanges: readonly {
			line: number;
			column: number;
			empty: boolean;
			nested: boolean;
			lastChild: boolean;
			row: Readonly<Record<string, unknown>>;
		}[];
	};
} {
	const { target = 'lynx', thread = 'main-thread', backend, module, backgroundProgram } = options;
	return compile(source, '/src/Card.lynx.tsrx', {
		hmr: false,
		renderer: {
			...lynxMainThreadRenderer,
			target,
			id: 'lynx',
			...(backgroundProgram
				? {
						module: '@octanejs/lynx/renderer',
						capabilities: [...lynxMainThreadRenderer.capabilities, 'compiler-program-ir'],
					}
				: null),
		},
		universalRuntime: { runtime: 'lynx', thread },
		...(backend === undefined ? null : { mainThreadProgramBackend: backend }),
		...(module === undefined ? null : { programModuleId: module }),
	}) as {
		code: string;
		map: any;
		mainThreadProgramCoverage?: { total: number; addressed: number };
		lynxBlockSemanticRequirements?: {
			version: number;
			runtimeUses: readonly { name: string; line: number; column: number }[];
			runtimeExports: readonly { name: string; line: number; column: number }[];
			opaqueRuntimeAccesses: readonly { name: string; line: number; column: number }[];
			components: readonly {
				name: string;
				exportKind: string | null;
				line: number;
				column: number;
				hooks: readonly { name: string; line: number; column: number }[];
			}[];
		};
		lynxBlockFeatureRequirements?: {
			version: number;
			threadFunctions: readonly {
				kind: string;
				id: string;
				line: number;
				column: number;
				captures: readonly string[];
			}[];
			mainThreadProps: readonly { name: string; line: number; column: number }[];
			templateFeatures: readonly {
				kind: string;
				name: string | null;
				line: number;
				column: number;
			}[];
			keyedRanges: readonly {
				line: number;
				column: number;
				empty: boolean;
				nested: boolean;
				lastChild: boolean;
				row: Readonly<Record<string, unknown>>;
			}[];
		};
	};
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
	readonly componentMetadata: readonly unknown[];
	/** The module's `Card`, which returns its plan and that plan's value array. */
	readonly card: (props: unknown) => {
		readonly plan?: unknown;
		readonly program?: unknown;
		readonly values: readonly unknown[];
		readonly computations?: readonly any[];
	};
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
	const componentMetadata: unknown[] = [];
	const useState = (initial: unknown) => {
		let value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
		return [
			value,
			(next: unknown) => (value = typeof next === 'function' ? (next as any)(value) : next),
			() => value,
		] as const;
	};
	const useReducer = (reducer: (state: unknown, action: unknown) => unknown, initial: unknown) => {
		let value = initial;
		return [value, (action: unknown) => (value = reducer(value, action)), () => value] as const;
	};

	const renderer = {
		universalPlan: (_renderer: string, root: unknown, address?: unknown) => {
			roots.push(root);
			addresses.push(address);
			return root;
		},
		universalValue: (plan: unknown, values: readonly unknown[]) => ({ plan, values }),
		enableLynxCompilerProgramRefs: () => {},
		lynxProgram: (_renderer: string, program: any) => {
			roots.push(program);
			addresses.push(program.address);
			return program;
		},
		lynxProgramValue: (
			program: unknown,
			values: readonly unknown[],
			computations: readonly any[] = [],
		) => ({ program, values, computations }),
		useState,
		useReducer,
		__useStateWithGetter: useState,
		defineUniversalComponent: (_renderer: string, render: unknown, metadata: unknown) => {
			componentMetadata.push(metadata);
			return render;
		},
		firstScreenEvent: Symbol('firstScreenEvent'),
		__useReducerWithGetter: useReducer,
		hookSlots: () => 0,
	};
	const rewritten = code
		.replace(
			/import\s*\{([\s\S]*?)\}\s*from\s*["']@octanejs\/lynx\/(?:main-)?renderer["'];/g,
			(_match, specifiers: string) =>
				`const {${specifiers.replace(/\s+as\s+/g, ': ')}} = __renderer;`,
		)
		.replace('export const Card =', 'const Card =');
	const card = new Function('__renderer', `${rewritten}\nreturn Card;`)(renderer);
	return { roots, addresses, componentMetadata, card: card as EvaluatedModule['card'] };
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
	const derived = Backend.deriveLynxProgramIR(planRoot as never)!;
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
	it('emits an independent versioned background program for the Block core', () => {
		const code = compiled(ADDRESSABLE_CARD, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module: 'src/Card.lynx.tsrx',
			backgroundProgram: true,
		});
		expect(code).toContain('lynxProgram as');
		expect(code).toContain('lynxProgramValue as');
		expect(code).not.toContain('universalPlan as');
		expect(code).not.toContain('universalValue as');

		const { roots, addresses, card } = evaluate(code);
		expect(roots).toHaveLength(1);
		expect(roots[0]).toMatchObject({
			version: 1,
			address: {
				module: 'src/Card.lynx.tsrx',
				index: 0,
				digest: expect.stringMatching(/^[0-9a-f]{16}$/),
			},
			wire: { nodes: expect.any(Array), events: expect.any(Array) },
			values: expect.any(Array),
			events: expect.any(Array),
			ranges: [],
		});
		expect(addresses).toEqual([roots[0].address]);
		const value = card({
			tone: 'card active',
			ident: 'card-1',
			label: 'Label',
			detail: 'Detail',
			onPick: () => undefined,
		});
		expect(value.program).toBe(roots[0]);
		expect(value.values).toEqual([
			'card active',
			'card-1',
			expect.any(Function),
			'Label',
			'Detail',
		]);
	});

	it('emits host refs as resource IR without putting them in the physical wire', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string; capture: (value: unknown) => void }) @{
	<view ref={props.capture}>
		<text>{props.label as string}</text>
	</view>
}
`;
		const module = 'src/RefCard.lynx.tsrx';
		const main = evaluate(compiled(source, { backend: Backend, module }));
		const backgroundCode = compiled(source, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module,
			backgroundProgram: true,
		});
		expect(backgroundCode).toContain('enableLynxCompilerProgramRefs');
		const background = evaluate(backgroundCode);

		expect(main.roots[0].refs).toEqual([0]);
		expect(background.roots[0].refs).toEqual([{ node: 0, slot: 0 }]);
		expect(background.roots[0].values.map((site: { slot: number }) => site.slot)).toEqual([1]);
		expect(background.roots[0].wire.nodes[0].bindings).toBeUndefined();
		expect(main.addresses).toEqual(background.addresses);

		const withoutRefCode = compiled(source.replace(' ref={props.capture}', ''), {
			backend: Backend,
			module,
		});
		expect(withoutRefCode).not.toContain('enableLynxCompilerProgramRefs');
		const withoutRef = evaluate(withoutRefCode);
		expect(withoutRef.roots[0]).not.toHaveProperty('refs');
		expect(withoutRef.addresses[0].digest).not.toBe(main.addresses[0].digest);
	});

	it('emits replayable state computations for pure dynamic bindings', () => {
		const code = compiled(
			`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

export function Card({ prefix }: { prefix: string }) @{
	const [count, setCount] = useState(0);
	const label = \`\${prefix}:\${count}\`;
	<view class={count > 0 ? 'active' : 'idle'}>
		<text>{label as string}</text>
		<text bindtap={() => setCount(count + 1)}>{\`\${count}\`}</text>
	</view>
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/DirtyCard.lynx.tsrx',
				backgroundProgram: true,
			},
		);
		expect(code).toContain('__useStateWithGetter as');

		const value = evaluate(code).card({ prefix: 'row' });
		expect(value.computations).toHaveLength(1);
		const computation = value.computations![0];
		expect(computation).toMatchObject({
			kind: 'scalar',
			purity: 'pure',
			escape: 'component-render',
		});
		expect(computation.sources).toEqual([expect.any(Function)]);
		expect(computation.slots.length).toBeGreaterThanOrEqual(4);
		const initial = computation.run();
		for (let index = 0; index < initial.length; index++) {
			const rendered = value.values[computation.slots[index]];
			if (typeof initial[index] === 'function') expect(rendered).toEqual(expect.any(Function));
			else expect(initial[index]).toBe(rendered);
		}

		const tap = value.values.find((entry) => typeof entry === 'function');
		expect(tap).toEqual(expect.any(Function));
		(tap as () => void)();
		const updated = computation.run();
		expect(updated).toEqual(expect.arrayContaining(['active', 'row:1', '1']));
		const updatedTap = updated.find((entry: unknown) => typeof entry === 'function');
		expect(updatedTap).toEqual(expect.any(Function));
		(updatedTap as () => void)();
		expect(computation.run()).toEqual(expect.arrayContaining(['active', 'row:2', '2']));
	});

	it('partitions independent state sources into separate computation groups', () => {
		const value = evaluate(
			compiled(
				`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

export function Card() @{
	const [left] = useState('left');
	const [right] = useState('right');
	<view class={left}><text>{right as string}</text></view>
}
`,
				{
					target: 'universal',
					thread: 'background',
					backend: Backend,
					module: 'src/IndependentCard.lynx.tsrx',
					backgroundProgram: true,
				},
			),
		).card({});

		expect(value.computations).toHaveLength(2);
		expect(value.computations!.map((group) => group.sources.length)).toEqual([1, 1]);
		const slots = value.computations!.flatMap((group) => group.slots);
		expect(new Set(slots).size).toBe(slots.length);
		expect(value.computations!.flatMap((group) => group.run()).sort()).toEqual(['left', 'right']);
	});

	it('replays useReducer state through the same dirty binding path', () => {
		const value = evaluate(
			compiled(
				`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useReducer } from 'octane';

export function Card() @{
	const [count, dispatch] = useReducer((value: number, delta: number) => value + delta, 0);
	<view><text bindtap={() => dispatch(2)}>{\`\${count}\`}</text></view>
}
`,
				{
					target: 'universal',
					thread: 'background',
					backend: Backend,
					module: 'src/ReducerCard.lynx.tsrx',
					backgroundProgram: true,
				},
			),
		).card({});

		expect(value.computations).toHaveLength(1);
		const computation = value.computations![0];
		expect(computation).toMatchObject({
			kind: 'scalar',
			purity: 'pure',
			escape: 'component-render',
		});
		expect(computation.run()).toEqual(['0']);
		const tap = value.values.find((entry) => typeof entry === 'function');
		expect(tap).toEqual(expect.any(Function));
		(tap as () => void)();
		expect(computation.run()).toEqual(['2']);
	});

	it('keeps scalar replay separate from structural invalidation', () => {
		const code = compiled(
			`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

export function Card() @{
	const [heading] = useState('ready');
	const [rows] = useState([{ id: 1, label: 'one' }]);
	<view>
		<text>{heading as string}</text>
		<view>
			@for (const row of rows; key row.id) {
				<text>{row.label as string}</text>
			}
		</view>
	</view>
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/StructuralStateCard.lynx.tsrx',
				backgroundProgram: true,
			},
		);
		const descriptors = [
			...code.matchAll(
				/["']?kind["']?\s*:\s*["'](scalar|structural)["'][\s\S]*?["']?purity["']?\s*:\s*["'](pure|unknown)["']/g,
			),
		].map((match) => match.slice(1));
		expect(descriptors).toEqual(
			expect.arrayContaining([
				['scalar', 'pure'],
				['structural', 'unknown'],
			]),
		);
	});

	it('declines unproved output evaluation without enabling getter-aware hooks', () => {
		const code = compiled(
			`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

function format(value: number): string {
	return String(value);
}

export function Card() @{
	const [count] = useState(0);
	<view><text>{format(count) as string}</text></view>
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/ConservativeCard.lynx.tsrx',
				backgroundProgram: true,
			},
		);
		expect(code).not.toContain('__useStateWithGetter as');

		const value = evaluate(code).card({});
		expect(value.computations).toEqual([]);
		expect(value.values).toEqual(['0']);
	});

	it('keeps external property reads on the conservative component path', () => {
		const code = compiled(
			`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

const external = { get value(): string { return 'outside'; } };

export function Card() @{
	const [count] = useState(0);
	<view><text>{\`\${external.value}:\${count}\`}</text></view>
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/ExternalGetter.lynx.tsrx',
				backgroundProgram: true,
			},
		);

		expect(code).not.toContain('__useStateWithGetter as');
		expect(code).not.toContain('component-render');
	});

	it('does not specialize a local function that merely uses a built-in hook name', () => {
		const code = compiled(
			`/** @jsxImportSource @octanejs/lynx/intrinsics */
function useState(initial: string) {
	return [initial, () => undefined] as const;
}

export function Card() @{
	const [tone] = useState('quiet');
	<view class={tone} />
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/LocalHookName.lynx.tsrx',
				backgroundProgram: true,
			},
		);

		expect(code).not.toContain('component-render');
	});

	it('emits an explicit hook-scope proof for stateless and custom-hook components', () => {
		const rendererModule = '@octanejs/lynx/main-renderer';
		const stateless = evaluate(compiled(ADDRESSABLE_CARD));
		expect(stateless.componentMetadata).toEqual([{ module: rendererModule, hookScope: false }]);

		const hooked = evaluate(
			compiled(
				`/** @jsxImportSource @octanejs/lynx/intrinsics */
function useTone(value: string): string {
	return value;
}

export function Card(props: { label: string }) @{
	const tone = useTone(props.label);
	<view><text>{tone as string}</text></view>
}
`,
				{},
			),
		);
		expect(hooked.componentMetadata).toEqual([{ module: rendererModule, hookScope: true }]);
	});

	it('keeps an unaddressable Block background plan on the Universal plan path', () => {
		const code = compiled(CARD, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module: 'src/Card.lynx.tsrx',
			backgroundProgram: true,
		});
		expect(code).toContain('universalPlan as');
		expect(code).toContain('universalValue as');
		expect(code).not.toContain('lynxProgram as');
		expect(code).not.toContain('lynxProgramValue as');

		const { roots, addresses, card } = evaluate(code);
		expect(roots).toHaveLength(1);
		expect(addresses).toEqual([undefined]);
		expect(
			card({
				tone: 'card active',
				ident: 'card-1',
				label: 'Label',
				detail: 'Detail',
				onPick: () => undefined,
			}),
		).toMatchObject({ plan: roots[0], values: expect.any(Array) });
	});

	it('emits program and Universal helpers together for a mixed Block module', () => {
		const result = compileCard(
			`${ADDRESSABLE_CARD}
export function Dynamic(props: { detail: unknown }) @{
	<view><text>{props.detail}</text></view>
}
`,
			{
				target: 'universal',
				thread: 'background',
				backend: Backend,
				module: 'src/Card.lynx.tsrx',
				backgroundProgram: true,
			},
		);
		expect(result.code).toContain('lynxProgram as');
		expect(result.code).toContain('lynxProgramValue as');
		expect(result.code).toContain('universalPlan as');
		expect(result.code).toContain('universalValue as');
		expect(result.mainThreadProgramCoverage).toEqual({
			total: 2,
			addressed: 1,
		});
	});

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
		expect(root.version).toBe(1);
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
		expect(root.ranges).toEqual([{ slot: 4, node: 3, before: null, id: 4, paintsText: true }]);
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
		expect(root.ranges).toEqual([{ slot: 0, node: 2, before: null, id: 3, paintsText: true }]);
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

	it('emits a program for a range followed by a static sibling', () => {
		const AHEAD = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { label: string }) @{
	<text class="l">{props.label as string}{'tail'}</text>
}
`;
		const evaluated = evaluate(compiled(AHEAD, { backend: Backend }));
		const [root] = evaluated.roots;
		expect(root.kind).toBe('program');
		expect(root.ranges).toEqual([
			expect.objectContaining({ slot: 0, node: 0, before: 1, paintsText: true }),
		]);

		const value = evaluated.card({ label: 'Live' });
		const papi = createHost();
		createLynxHostContainer(papi, { root: 1 });
		const page = papi.pages[0]!;
		const args = [
			...root.values.map((slot: number) => value.values[slot]),
			...root.events.map(() => () => undefined),
			...root.ranges.map((range: { slot: number }) => value.values[range.slot]),
		];
		const nodes = root.bind(papi)(page.id, ...args) as readonly FakeNode[];
		papi.insertBefore(page, nodes[0]!, null);
		expect(nodes[0]!.children.map((child) => child.text)).toEqual(['Live', 'tail']);
	});

	it('keeps a described plan the emitter refuses on the interpreted encoding', () => {
		// An inline style is written by the general prop-patch path and by nothing
		// the emission can call, so emitting the program anyway would paint a first
		// screen that differs from the one the command path paints. A backend that
		// is configured by default must ask the exact emitter during derivation and
		// decline this plan before the compiler assigns it a program, leaving the
		// existing command path byte-identical rather than failing a normal build.
		const STYLED = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { tone: string; label: string }) @{
	<view class={props.tone} style="color:red"><text class="l">{props.label as string}</text></view>
}
`;
		expect(compiled(STYLED, { backend: Backend })).toBe(compiled(STYLED));
		expect(evaluate(compiled(STYLED, { backend: Backend })).roots[0].kind).toBe('template');
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
			{ slot: 0, node: 1, before: null, id: 2, paintsText: true },
			{ slot: 1, node: 2, before: null, id: 4, paintsText: false },
		]);
	});

	it('prefers the shared IR hook when a backend also exposes the legacy hook', () => {
		const backend = {
			...Backend,
			deriveLynxMainThreadProgram() {
				throw new Error('the legacy derivation must not run');
			},
		};
		expect(evaluate(compiled(CARD, { backend })).roots[0].kind).toBe('program');
	});

	it('rejects a shared IR version mismatch before emitting either layer', () => {
		const stale = {
			...Backend,
			deriveLynxProgramIR(plan: never) {
				const ir = Backend.deriveLynxProgramIR(plan);
				return ir === null ? null : { ...ir, version: 2 };
			},
		};
		expect(() => compiled(CARD, { backend: stale })).toThrowError(
			/expected program IR version 1, but the configured backend derived version 2/,
		);
		expect(() =>
			compiled(CARD, {
				backend: stale,
				thread: 'background',
				module: 'src/Card.lynx.tsrx',
			}),
		).toThrowError(/expected program IR version 1, but the configured backend derived version 2/);
	});

	it('rejects a malformed shared IR hook instead of silently using the legacy hook', () => {
		const malformed = {
			deriveLynxProgramIR: true,
			deriveLynxMainThreadProgram: Backend.deriveLynxMainThreadProgram,
			emitLynxMainThreadProgram: Backend.emitLynxMainThreadProgram,
		};
		expect(() => compiled(CARD, { backend: malformed })).toThrowError(
			/deriveLynxProgramIR must be a function/,
		);
	});

	it('keeps the legacy derivation hook as a compatibility fallback', () => {
		const legacy = {
			deriveLynxMainThreadProgram: Backend.deriveLynxMainThreadProgram,
			emitLynxMainThreadProgram: Backend.emitLynxMainThreadProgram,
		};
		expect(evaluate(compiled(CARD, { backend: legacy })).roots[0].kind).toBe('program');
	});

	it('fails the build when a backend contradicts itself about its own arity', () => {
		// The two halves of a backend can be versioned apart, and a create function
		// taking fewer parameters than its map declares would read its values from
		// shifted positions — a first screen that is wrong rather than absent. The
		// compiler takes the source on trust and the counts on evidence.
		const lying = {
			deriveLynxProgramIR: Backend.deriveLynxProgramIR,
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
			deriveLynxProgramIR: Backend.deriveLynxProgramIR,
			emitLynxMainThreadProgram: (program: never, options: { readonly name: string }) => {
				const emission = Backend.emitLynxMainThreadProgram(program, options);
				return { ...emission, source: `${emission.source}); (0` };
			},
		};
		expect(() => compiled(CARD, { backend: trailing })).toThrowError(/not a single expression/);
	});
});

describe('reporting authored Block semantic requirements', () => {
	it('publishes active runtime references and component hook sites without emitting them', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import {
	Activity,
	createContext,
	createPortal as portal,
	lazy,
	useContext as readContext,
	useInsertionEffect,
	useState,
} from 'octane';

const Theme = createContext('light');
const keepPortal = portal;
void keepPortal;

export function Row() @{
	useInsertionEffect(() => {});
	<text>row</text>
}

export function App() @{
	const [visible] = useState(true);
	const theme = readContext(Theme);
	<Activity mode={visible ? 'visible' : 'hidden'}><view><text>{theme as string}</text></view></Activity>
}
`;
		const result = compileCard(source);
		const requirements = result.lynxBlockSemanticRequirements;

		expect(requirements).toEqual({
			version: 1,
			runtimeUses: [
				{ name: 'Activity', line: 24, column: 2 },
				{ name: 'createContext', line: 12, column: 14 },
				{ name: 'createPortal', line: 13, column: 19 },
				{ name: 'useContext', line: 23, column: 15 },
				{ name: 'useInsertionEffect', line: 17, column: 1 },
				{ name: 'useState', line: 22, column: 19 },
			],
			runtimeExports: [],
			opaqueRuntimeAccesses: [],
			components: [
				{
					name: 'Row',
					exportKind: 'named',
					line: 16,
					column: 7,
					hooks: [{ name: 'useInsertionEffect', line: 17, column: 1 }],
				},
				{
					name: 'App',
					exportKind: 'named',
					line: 21,
					column: 7,
					hooks: [
						{ name: 'useState', line: 22, column: 19 },
						{ name: 'useContext', line: 23, column: 15 },
					],
				},
			],
		});
		expect(requirements?.runtimeUses.some(({ name }) => name === 'lazy')).toBe(false);
		expect(result.code).not.toContain('lynxBlockSemanticRequirements');
		expect(Object.isFrozen(requirements)).toBe(true);
		expect(Object.isFrozen(requirements?.runtimeUses)).toBe(true);
		expect(Object.isFrozen(requirements?.runtimeExports)).toBe(true);
		expect(Object.isFrozen(requirements?.opaqueRuntimeAccesses)).toBe(true);
		expect(Object.isFrozen(requirements?.components[0]?.hooks)).toBe(true);
	});

	it('does not mistake an unused import or a shadowed local for a runtime requirement', () => {
		const result = compileCard(`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

function invoke(useState: () => unknown) {
	return useState();
}
void invoke;

export function App() @{
	<view />
}
`);

		expect(result.lynxBlockSemanticRequirements?.runtimeUses).toEqual([]);
		expect(result.lynxBlockSemanticRequirements?.components).toEqual([
			expect.objectContaining({ name: 'App', hooks: [] }),
		]);
	});

	it('keeps runtime requirements from a plain-TypeScript custom-hook module', () => {
		const result = compile(
			`import { useContext as readContext } from 'octane';
export function useTheme(context: unknown) {
	return readContext(context);
}
`,
			'/src/useTheme.ts',
			{
				hmr: false,
				renderer: { ...lynxMainThreadRenderer, target: 'universal', id: 'lynx' },
				universalRuntime: { runtime: 'lynx', thread: 'background' },
			},
		) as ReturnType<typeof compileCard>;

		expect(result.lynxBlockSemanticRequirements).toEqual({
			version: 1,
			runtimeUses: [{ name: 'useContext', line: 3, column: 8 }],
			runtimeExports: [],
			opaqueRuntimeAccesses: [],
			components: [],
		});
	});

	it('keeps barrel exports and opaque Octane module access fail-closed', () => {
		const result = compile(
			`export { useContext as readContext } from 'octane';
export type { OctaneNode } from 'octane';
export * from 'octane';
const load = () => import('oct\\u0061ne');
const required = require('octane');
function shadowed(require: (id: string) => unknown) {
	return require('octane');
}
void load;
void required;
void shadowed;
`,
			'/src/runtime-barrel.ts',
			{
				hmr: false,
				renderer: { ...lynxMainThreadRenderer, target: 'universal', id: 'lynx' },
				universalRuntime: { runtime: 'lynx', thread: 'background' },
			},
		) as ReturnType<typeof compileCard>;

		expect(result.lynxBlockSemanticRequirements).toEqual({
			version: 1,
			runtimeUses: [],
			runtimeExports: [{ name: 'useContext', line: 1, column: 9 }],
			opaqueRuntimeAccesses: [
				{ name: 'commonjs-require', line: 5, column: 17 },
				{ name: 'dynamic-import', line: 4, column: 19 },
				{ name: 'export-all', line: 3, column: 0 },
			],
			components: [],
		});
	});

	it('does not attach a Lynx selection fact to an unpaired universal compile', () => {
		const result = compile(ADDRESSABLE_CARD, '/src/Card.tsrx', {
			hmr: false,
			renderer: { ...lynxMainThreadRenderer, target: 'universal', id: 'lynx' },
		}) as ReturnType<typeof compileCard>;
		const paired = compileCard(ADDRESSABLE_CARD, {
			target: 'universal',
			thread: 'background',
		});

		expect(result.lynxBlockSemanticRequirements).toBeUndefined();
		expect(result.lynxBlockFeatureRequirements).toBeUndefined();
		expect(paired.lynxBlockSemanticRequirements?.version).toBe(1);
		expect(paired.lynxBlockFeatureRequirements?.version).toBe(2);
		expect(paired.code).toBe(result.code);
	});
});

describe('reporting authored Block feature requirements', () => {
	it('records nested, non-tail, and hooked keyed rows without judging support', () => {
		const result = compileCard(`/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';

function HookedRow() @{
	const [value] = useState('row');
	<view><text>{value as string}</text></view>
}

export function App(props: { groups: readonly { id: number; rows: readonly number[] }[] }) @{
	<view>
		@for (const group of props.groups; key group.id) {
			<view>
				@for (const row of group.rows; key row) {
					<HookedRow />
				}
			</view>
		}
		<text>tail</text>
	</view>
}
`);

		expect(result.lynxBlockFeatureRequirements).toEqual({
			version: 2,
			threadFunctions: [],
			mainThreadProps: [],
			templateFeatures: [],
			keyedRanges: [
				{
					line: 11,
					column: 2,
					empty: false,
					nested: true,
					lastChild: false,
					row: { kind: 'inline-host', name: 'view' },
				},
				{
					line: 13,
					column: 4,
					empty: false,
					nested: false,
					lastChild: true,
					row: {
						kind: 'local-component',
						name: 'HookedRow',
						hooks: [{ name: 'useState', line: 5, column: 17 }],
					},
				},
			],
		});
		expect(result.code).not.toContain('lynxBlockFeatureRequirements');
	});

	it('records template roles that structural program addressing cannot prove safe', () => {
		const result = compileCard(`/** @jsxImportSource @octanejs/lynx/intrinsics */
function Panel() @{
	<view />
}

export function App(props: { show: boolean; child: unknown }) @{
	<view bindtap={() => undefined}>
		<Panel />
		<list ref={() => undefined}><list-item /></list>
		@if (props.show) {
			<text>shown</text>
		}
		<>
			<text>fragment</text>
		</>
		@switch (props.show) {
			@case true: {
				<text>yes</text>
			}
			@default: {
				<text>no</text>
			}
		}
		@try { <text>ready</text> } @pending { <text>pending</text> }
		{props.child}
	</view>
}
`);

		expect(result.lynxBlockFeatureRequirements?.templateFeatures).toEqual([
			{ kind: 'program-root-event', name: 'bindtap', line: 7, column: 7 },
			{ kind: 'local-component', name: 'Panel', line: 8, column: 2 },
			{ kind: 'native-list', name: 'list', line: 9, column: 2 },
			{ kind: 'host-ref', name: 'list', line: 9, column: 8 },
			{ kind: 'native-list', name: 'list-item', line: 9, column: 30 },
			{ kind: 'if', name: null, line: 10, column: 2 },
			{ kind: 'fragment', name: null, line: 13, column: 2 },
			{ kind: 'switch', name: null, line: 16, column: 2 },
			{ kind: 'try', name: null, line: 24, column: 2 },
			{ kind: 'renderable-hole', name: null, line: 25, column: 2 },
		]);
	});

	it('proves only immutable module-root component bindings', () => {
		const result = compileCard(`/** @jsxImportSource @octanejs/lynx/intrinsics */
import External from './External.tsrx';

function Local() @{
	<view />
}

function Shadowed(props: { Local: () => unknown }) @{
	const Local = props.Local;
	<Local />
}

export function App() @{
	<view>
		<Local />
		<Shadowed Local={Local} />
		<External />
	</view>
}
`);

		expect(result.lynxBlockFeatureRequirements?.templateFeatures).toEqual([
			{ kind: 'component', name: 'Local', line: 10, column: 1 },
			{ kind: 'local-component', name: 'Local', line: 15, column: 2 },
			{ kind: 'local-component', name: 'Shadowed', line: 16, column: 2 },
			{ kind: 'component', name: 'External', line: 17, column: 2 },
		]);
	});

	it('records inline template-returning component props independently', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';
function Frame(props: { render: () => unknown; onValue: () => number }) {
	props.onValue();
	return props.render();
}

export function App() @{
	const [label] = useState('rendered');
	<Frame
		render={() => <view><text>{label as string}</text></view>}
		onValue={() => 1}
	/>
}
`;
		const module = 'src/InlineRenderProp.lynx.tsrx';
		const result = compileCard(source, { backend: Backend, module });
		const background = compileCard(source, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module,
			backgroundProgram: true,
		});

		expect(result.lynxBlockFeatureRequirements?.templateFeatures).toEqual([
			{ kind: 'local-component', name: 'Frame', line: 10, column: 1 },
			{ kind: 'inline-render-prop', name: 'render', line: 11, column: 2 },
		]);
		expect(result.mainThreadProgramCoverage).toEqual({ total: 1, addressed: 1 });
		expect(background.mainThreadProgramCoverage).toEqual({ total: 1, addressed: 1 });
		expect(background.code).not.toContain('universalPlan as');
	});

	it('proves only local-component-or-empty host holes and preserves their structural kind', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { useState } from 'octane';
function Region(props: { identity: string; label: string }) @{
	const [tone] = useState('quiet');
	<view><text>{props.label + ':' + tone}</text></view>
}

export function App(props: { show: boolean; identity: string; label: string }) @{
	<view>
		{props.show ? <Region key={props.identity} label={props.label} /> : null}
	</view>
}
`;
		const module = 'src/ComponentHole.lynx.tsrx';
		const result = compileCard(source, { backend: Backend, module });
		const background = compileCard(source, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module,
			backgroundProgram: true,
		});

		expect(result.lynxBlockFeatureRequirements?.templateFeatures).toEqual([
			{ kind: 'component-hole', name: null, line: 10, column: 2 },
			{ kind: 'local-component', name: 'Region', line: 10, column: 16 },
		]);
		expect(result.mainThreadProgramCoverage).toEqual({ total: 2, addressed: 2 });
		expect(background.mainThreadProgramCoverage).toEqual({ total: 2, addressed: 2 });
		expect(result.code).toContain('universalIf as');
		expect(background.code).not.toContain('universalPlan as');
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

		// This is the real-device #275 shape. The compiler-proved String conversion
		// now folds, but the unproved label remains a runtime range while the
		// background can observe its current string value and lower a denser
		// descriptor. Naming the resident program would still make its fixed value
		// arity reject the dynamic commit before it paints.
		expect(main.roots[0].values).toEqual([0, 1]);
		expect(main.roots[0].ranges).toHaveLength(1);
		expect(main.roots[0]).not.toHaveProperty('wire');
		expect(main.addresses).toEqual([undefined]);
		expect(background.addresses).toEqual([undefined]);
		expect(
			compileCard(source, {
				backend: Backend,
				module: 'src/Row.lynx.tsrx',
				thread: 'background',
			}).mainThreadProgramCoverage,
		).toEqual({ total: 1, addressed: 0 });
	});

	it('addresses a real row when intrinsic String and authored casts prove every text scalar', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { row: { id: number; label: string }; isSelected: boolean; onSelect: (id: number) => void; onRemove: (id: number) => void }) @{
	<view class={['row', props.isSelected && 'danger']}>
		<text class="col-id">{String(props.row.id)}</text>
		<text class="col-label" bindtap={() => props.onSelect(props.row.id)}>{props.row.label as string}</text>
		<text class="col-remove" bindtap={() => props.onRemove(props.row.id)}>{'x'}</text>
	</view>
}
`;
		const module = 'src/Row.lynx.tsrx';
		const main = evaluate(compiled(source, { backend: Backend, module }));
		const background = evaluate(
			compiled(source, { thread: 'background', backend: Backend, module }),
		);

		// `compile.js` has already proved the unshadowed intrinsic conversion to
		// produce a string. The universal lowering must consume that same proof so
		// both graphs derive the one range-free layout that the address names.
		expect(main.roots[0].ranges).toEqual([]);
		expect(main.roots[0]).toHaveProperty('wire');
		expect(main.addresses[0]).toMatchObject({ module, index: 0 });
		expect(background.addresses).toEqual(main.addresses);
		expect(
			compileCard(ADDRESSABLE_CARD, { backend: Backend, module, thread: 'background' })
				.mainThreadProgramCoverage,
		).toEqual({ total: 1, addressed: 1 });
	});

	it('keeps a component row resident when the keyed range has an @empty arm', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
interface Item { readonly id: number; readonly label: string }

function Row(props: { readonly item: Item }) @{
	<view class="row"><text>{props.item.label as string}</text></view>
}

export function Card(props: { readonly items: readonly Item[] }) @{
	<view class="rows">
		@for (const item of props.items; key item.id) {
			<Row item={item} />
		} @empty {
			<view class="empty"><text>none</text></view>
		}
	</view>
}
`;
		const module = 'src/EmptyRows.lynx.tsrx';
		const mainResult = compileCard(source, { backend: Backend, module });
		const backgroundResult = compileCard(source, {
			thread: 'background',
			backend: Backend,
			module,
		});
		const main = evaluate(mainResult.code);
		const background = evaluate(backgroundResult.code);

		expect(mainResult.mainThreadProgramCoverage).toEqual({ total: 3, addressed: 3 });
		expect(backgroundResult.mainThreadProgramCoverage).toEqual({ total: 3, addressed: 3 });
		expect(main.addresses).toHaveLength(3);
		expect(main.addresses.every((address) => address !== undefined)).toBe(true);
		expect(background.addresses).toEqual(main.addresses);
		expect(backgroundResult.lynxBlockFeatureRequirements?.keyedRanges).toEqual([
			expect.objectContaining({
				empty: true,
				nested: false,
				lastChild: true,
				row: expect.objectContaining({ kind: 'local-component', name: 'Row' }),
			}),
		]);
	});

	it('keeps a Provider-rooted keyed program fully addressed and dirty-grouped', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
import { createContext, useContext, useState } from 'octane';

const Theme = createContext('default');
interface Item { readonly id: number; readonly label: string }

function Frame(props: { readonly children?: unknown }) {
	return props.children;
}

function Row(props: { readonly item: Item }) @{
	const theme = useContext(Theme);
	<view class={theme}><text>{props.item.label as string}</text></view>
}

export function Card(props: { readonly items: readonly Item[]; readonly theme: string }) @{
	const [theme] = useState(props.theme);
	<Theme.Provider value={theme}>
		<Frame>
			<view class={theme}>
				@for (const item of props.items; key item.id) {
					<Row item={item} />
				}
			</view>
		</Frame>
	</Theme.Provider>
}
`;
		const module = 'src/ContextRows.lynx.tsrx';
		const mainResult = compileCard(source, { backend: Backend, module });
		const backgroundResult = compileCard(source, {
			target: 'universal',
			thread: 'background',
			backend: Backend,
			module,
			backgroundProgram: true,
		});

		expect(mainResult.mainThreadProgramCoverage).toEqual({ total: 2, addressed: 2 });
		expect(backgroundResult.mainThreadProgramCoverage).toEqual({ total: 2, addressed: 2 });
		expect(backgroundResult.code).toContain('universalComponent as');
		expect(backgroundResult.code).not.toContain('universalPlan as');
		expect(backgroundResult.code).not.toContain('universalValue as');
		expect(backgroundResult.lynxBlockFeatureRequirements?.templateFeatures).toEqual([
			expect.objectContaining({ kind: 'local-component', name: 'Frame' }),
		]);
		expect(
			backgroundResult.lynxBlockSemanticRequirements?.runtimeUses.map((site) => site.name),
		).toEqual(['createContext', 'useContext', 'useState']);
		expect(backgroundResult.lynxBlockFeatureRequirements?.keyedRanges).toEqual([
			expect.objectContaining({
				row: expect.objectContaining({
					kind: 'local-component',
					name: 'Row',
					hooks: [expect.objectContaining({ name: 'useContext' })],
				}),
			}),
		]);
	});

	it('addresses an open structural range and hashes its topology', () => {
		const module = 'src/StructuralCard.lynx.tsrx';
		const main = evaluate(compiled(STRUCTURAL_ADDRESSABLE_CARD, { backend: Backend, module }));
		const background = evaluate(
			compiled(STRUCTURAL_ADDRESSABLE_CARD, {
				thread: 'background',
				backend: Backend,
				module,
			}),
		);
		const index = main.roots.findIndex((root) => root.ranges?.length === 1);
		expect(index).toBeGreaterThanOrEqual(0);
		expect(main.roots[index]).toHaveProperty('wire');
		expect(main.roots[index].ranges[0]).toMatchObject({ paintsText: false });
		expect(main.addresses[index]).toMatchObject({ module, index });
		expect(background.addresses[index]).toEqual(main.addresses[index]);

		const shifted = {
			...Backend,
			deriveLynxProgramIR(plan: never) {
				const derived = Backend.deriveLynxProgramIR(plan);
				if (derived === null || derived.ranges.length !== 1) return derived;
				return {
					...derived,
					ranges: [{ ...derived.ranges[0]!, node: 0 }],
				};
			},
		};
		const drifted = evaluate(compiled(STRUCTURAL_ADDRESSABLE_CARD, { backend: shifted, module }));
		expect(drifted.addresses[index].digest).not.toBe(main.addresses[index].digest);
	});

	it('keeps a call through a local binding named String range-bearing', () => {
		const source = `/** @jsxImportSource @octanejs/lynx/intrinsics */
export function Card(props: { row: { id: number; label: string }; render: (id: number) => unknown }) @{
	const String = props.render;
	<view>
		<text>{String(props.row.id)}</text>
		<text>{props.row.label as string}</text>
	</view>
}
`;
		const module = 'src/ShadowedRow.lynx.tsrx';
		const main = evaluate(compiled(source, { backend: Backend, module }));
		const background = evaluate(
			compiled(source, { thread: 'background', backend: Backend, module }),
		);

		// This function may return null, a node, or a nested range. Its spelling is
		// not permission to consume the global-intrinsic proof or address a fixed
		// resident wire.
		expect(main.roots[0].ranges).toHaveLength(1);
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
		// both run `deriveLynxProgramIR` as a pure oracle over the same
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
			'version',
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
