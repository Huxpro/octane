// Issue-#135 item 1b: a compiled component driving the Block core.
//
// Every earlier Block-core test drove the core by hand, from a program written
// in the test file. That proves the core, and it deliberately proves nothing
// about a *component*: a hand-written program is an architecture floor, and a
// number produced through one carries that label. This is the test that removes
// the label for the shapes it covers — the same compiled component, rendered
// through both cores, compared on what the host actually received.
//
// The oracle is the one `block-core-update-differential.test.ts` established,
// for the same reason: an application is a stream of states, so all three
// artifacts are compared after *every* step of a ladder rather than once at the
// end.
//
//   physical tree    what the shared applier painted, including event sites.
//   handle journal   the clone-safe public handle changes main publishes before
//                    acknowledging, which is what the background adopts.
//   event journal    every `setEvent` the applier issued, in order.
//
// The two cores are independent allocators that never had to agree about a
// number, so every integer identity is replaced by its rank in first-appearance
// order before comparing. That is a bijection or the comparison fails, so what
// survives is the claim worth making: the same tree, the same handles, the same
// events over the same nodes in the same order.
//
// What this does not cover is refused by name rather than half-rendered, and
// the refusals are asserted here too. Insertion-effect timing remains a later
// composition layer; compiler-slot identities now cover overlapping ranges.
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	(globalThis as unknown as Record<string, unknown>).__OCTANE_LYNX_PROFILE__ = true;
});

import {
	createPortal,
	createContext,
	createUniversalRoot,
	defineUniversalComponent,
	memo,
	startTransition,
	universalActivity,
	universalChildren,
	universalComponent,
	universalContext,
	universalFor,
	universalPlan,
	universalIf,
	universalProgramRangeCommandSlot,
	universalProps,
	universalTry,
	universalValue,
	universalSwitch,
	use,
	useCallback,
	useContext,
	useDeferredValue,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useInsertionEffect,
	useRef,
	useState,
	useSyncExternalStore,
	useTransition,
	type UniversalRenderable,
	type UniversalHostCommand,
} from 'octane/universal/native';
import { deriveLynxProgramIR } from '../src/compiler/index.js';
import { lynxProgram, lynxProgramValue } from '../src/core/compiler-program.js';

import { createLynxBlockBackgroundCore } from '../src/core/block-background.js';
import { createLynxBlockCore, type LynxBlockCore } from '../src/core/block-core.js';
import { withLynxBlockProgram } from '../src/core/block-program.js';
import {
	createLynxClientContainer,
	createLynxClientDriver,
	type LynxPublicHandle,
} from '../src/core/client-driver.js';
import { registerUniversalProgram, residentRunProgram } from '../src/core/program-registry.js';
import { lynxWireProfile } from '../src/core/profiling.js';
import {
	createLynxHostContainer,
	prepareLynxHostBatch,
	resolveLynxHostNativeEvent,
	type LynxResolvedNativeEvent,
} from '../src/core/host-driver.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxTransportCommitMessage,
} from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import type { LynxComponent } from '../src/intrinsics.js';
import { createFakePAPI } from './_fixtures/fake-element-papi.js';
import {
	BlockContextFixture,
	type BlockContextProps,
	BlockDynamicComponentFixture,
	type BlockDynamicComponentProps,
	BlockCompositionFixture,
	type BlockCompositionProps,
	BlockScopedRow,
	BlockConditionalFixture,
	type BlockConditionalProps,
	BlockSwitchFixture,
	type BlockSwitchProps,
	BlockStateBranchesFixture,
	BlockScopedRowsFixture,
	type BlockScopedRowsProps,
	BlockWrappedSelectionFixture,
	type BlockWrappedSelectionProps,
} from './_fixtures/block-scoped-rows.lynx.tsrx';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';
import { paint } from './_fixtures/painted-commits.js';

interface CardProps {
	readonly label: string;
	readonly detail: string;
	readonly active: boolean;
	readonly onTap: () => void;
}

// Deliberately range-free: a keyed range is item 1c, and a test that mixed the
// two could not say which seam a failure came from. Everything else a component
// has is here — a bound class, two text holes at different depths, a static
// prop that must survive as static, and an event site.
const CARD_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			// A template program refuses an event on its root — the root is the node
			// a parent inserts — so the tap sits where a real card's tap sits anyway.
			props: { class: 'card-label' },
			bindings: [['bindtap', 3]],
			children: [{ kind: 'text', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'view',
			bindings: [['class', 2]],
			children: [{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', slot: 4 }] }],
		},
	],
});

const Card = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ label, detail, active, onTap }: CardProps) =>
		universalValue(CARD_PLAN, [
			active ? 'card active' : 'card',
			label,
			active ? 'card-meta on' : 'card-meta',
			onTap,
			detail,
		]),
);

const CARD_PROGRAM_IR = deriveLynxProgramIR(CARD_PLAN.root as never)!;
const CARD_COMPILER_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...CARD_PROGRAM_IR,
	address: {
		module: 'tests/CompilerCard.lynx.tsrx',
		index: 0,
		digest: 'fedcba9876543210',
	},
});

const REF_CARD_COMPILER_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...CARD_PROGRAM_IR,
	address: {
		module: 'tests/CompilerRefCard.lynx.tsrx',
		index: 0,
		digest: 'compiler-ref-card',
	},
	refs: [{ node: 0, slot: 5 }],
});

const CONTINUOUS_CARD_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'card-label' },
			bindings: [['bindscroll', 3]],
			children: [{ kind: 'text', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'view',
			bindings: [['class', 2]],
			children: [{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', slot: 4 }] }],
		},
	],
});
const CONTINUOUS_CARD_PROGRAM_IR = deriveLynxProgramIR(CONTINUOUS_CARD_PLAN.root as never)!;
const CONTINUOUS_CARD_COMPILER_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...CONTINUOUS_CARD_PROGRAM_IR,
	address: {
		module: 'tests/ContinuousCompilerCard.lynx.tsrx',
		index: 0,
		digest: '0123456789fedcba',
	},
});

const CompilerCard = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ label, detail, active, onTap }: CardProps) =>
		lynxProgramValue(CARD_COMPILER_PROGRAM, [
			active ? 'card active' : 'card',
			label,
			active ? 'card-meta on' : 'card-meta',
			onTap,
			detail,
		]) as never,
);

const ADDRESSED_SIMPLE_PLAN = universalPlan(
	LYNX_TRANSPORT_RENDERER,
	{
		kind: 'host',
		type: 'view',
		bindings: [['class', 0]],
		children: [{ kind: 'text', slot: 1 }],
	},
	{
		module: 'tests/AddressedCard.lynx.tsrx',
		index: 0,
		digest: '0123456789abcdef',
	},
);

registerUniversalProgram('tests/AddressedCard.lynx.tsrx', 0, {
	kind: 'program',
	slots: ['p:class', 'c'],
	nodes: 2,
	values: [0, 1],
	events: [],
	ranges: [],
	wire: {
		nodes: [
			{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
			{ type: '#text', parent: 0, props: {}, bindings: [{ name: 'value', valueIndex: 1 }] },
		],
		events: [],
	},
	bind: (() => {
		throw new Error('The protocol-only fixture must not execute its resident program.');
	}) as never,
});

const AddressedCard = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ label, active }: CardProps) =>
		universalValue(ADDRESSED_SIMPLE_PLAN, [active ? 'card active' : 'card', label]),
);

function subscribedCard(lifecycle: string[]): LynxComponent<CardProps> {
	return defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		function Subscribed({ label, detail, active, onTap }: CardProps) {
			useEffect(
				() => {
					lifecycle.push(`subscribe:${label}`);
					return () => lifecycle.push(`unsubscribe:${label}`);
				},
				[label],
				'subscription',
			);
			return universalValue(CARD_PLAN, [
				active ? 'card active' : 'card',
				label,
				active ? 'card-meta on' : 'card-meta',
				onTap,
				detail,
			]);
		},
	);
}

const noop = () => undefined;

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(error: Error): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Value>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function unorderedHandleLifecycle(journal: string): string {
	const entries: string[] = [];
	let start = -1;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = 0; index < journal.length; index++) {
		const character = journal[index]!;
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') {
			quoted = true;
		} else if (character === '{') {
			if (depth++ === 0) start = index;
		} else if (character === '}' && --depth === 0) {
			entries.push(journal.slice(start, index + 1));
		}
	}
	return entries.sort().join('\n');
}

interface TableRow {
	readonly id: number;
	readonly label: string;
}

interface TableProps {
	readonly rows: readonly TableRow[];
	readonly selected: number | undefined;
	readonly onSelect: (id: number) => void;
}

// One row of the keyed range, in the shape the compiler emits for an inline
// `@for` body: a bound class so a selection is a scoped slot write, a text hole
// per column, and a tap on a child rather than on the row's own root, which a
// template program refuses to bind.
const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-id' },
			children: [{ kind: 'slot', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-label' },
			bindings: [['bindtap', 2]],
			children: [{ kind: 'slot', slot: 3 }],
		},
	],
});

// The page: a static title, then a container whose only child is the range
// hole. A renderable hole is one plan node whatever it holds, so this is the
// same `slot` node a text hole would be — which is the whole reason the value
// has to be what decides.
const TABLE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'title' },
			children: [{ kind: 'text', value: 'rows' }],
		},
		{
			kind: 'host',
			type: 'view',
			props: { class: 'rows' },
			children: [{ kind: 'slot', slot: 0 }],
		},
	],
});

// The shape a compiled page with one scalar heading and one keyed component
// range emits. The heading state changes independently of the range, making
// range discovery itself — not merely its eventual writes — observable.
const RANGE_DEPENDENCY_PAGE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'title' },
			bindings: [['text', 0]],
		},
		{
			kind: 'host',
			type: 'view',
			props: { class: 'rows' },
			children: [{ kind: 'slot', slot: 1 }],
		},
	],
});

const RANGE_DEPENDENCY_PAGE_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...deriveLynxProgramIR(RANGE_DEPENDENCY_PAGE_PLAN.root as never)!,
	address: {
		module: 'tests/RangeDependencyPage.lynx.tsrx',
		index: 0,
		digest: 'range-dependency-page',
	},
});

const BRANCH_DEPENDENCY_PAGE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'branches' },
	children: [
		{
			kind: 'host',
			type: 'view',
			props: { class: 'if-region' },
			children: [{ kind: 'slot', slot: 0 }],
		},
		{
			kind: 'host',
			type: 'view',
			props: { class: 'switch-region' },
			children: [{ kind: 'slot', slot: 1 }],
		},
	],
});

const BRANCH_DEPENDENCY_PAGE_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...deriveLynxProgramIR(BRANCH_DEPENDENCY_PAGE_PLAN.root as never)!,
	address: {
		module: 'tests/BranchDependencyPage.lynx.tsrx',
		index: 0,
		digest: 'branch-dependency-page',
	},
});

const TABLE_COMPILER_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
	...deriveLynxProgramIR(TABLE_PLAN.root as never)!,
	address: {
		module: 'tests/StructuralTable.lynx.tsrx',
		index: 0,
		digest: 'structural-table',
	},
});

const Table = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Table(props: TableProps) {
	return universalValue(TABLE_PLAN, [
		universalFor(
			props.rows,
			(row: TableRow) => row.id,
			(row: TableRow) =>
				universalValue(ROW_PLAN, [
					row.id === props.selected ? 'row danger' : 'row',
					String(row.id),
					() => props.onSelect(row.id),
					row.label,
				]),
		),
	]);
});

const table = (
	ids: readonly number[],
	selected?: number,
	onSelect: (id: number) => void = noop,
): TableProps => ({
	rows: ids.map((id) => ({ id, label: `row ${id}` })),
	selected,
	onSelect,
});

/**
 * One state per rung, and every structural shape a keyed range has: fill from
 * empty, a scoped write that moves one slot of one row, a reorder, a label
 * edit, a removal, an insertion, emptying, and refilling afterwards.
 */
const TABLE_LADDER: readonly TableProps[] = [
	table([]),
	table([1, 2, 3]),
	table([1, 2, 3], 2),
	table([3, 1, 2], 2),
	{
		rows: [
			{ id: 3, label: 'row 3' },
			{ id: 1, label: 'row one, edited' },
			{ id: 2, label: 'row 2' },
		],
		selected: 2,
		onSelect: noop,
	},
	table([3, 2], 2),
	table([3, 2, 4], 2),
	table([]),
	table([5]),
];

/**
 * The event site the background actually bound, resolved through the host.
 *
 * Painting the commits and asking the applier what a token means is the honest
 * way to name a listener: it is the id the main thread would send back, rather
 * than one assumed from how the allocator happens to count.
 */
function boundListener(commits: readonly LynxTransportCommitMessage[]): LynxResolvedNativeEvent {
	const papi = createFakePAPI();
	const host = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
	const label = papi.pages[0]!.children[0]!.children[0]!;
	const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
	if (resolved === null) throw new Error('the card bound no event site');
	return resolved;
}

/**
 * The tap site the nth painted row bound, resolved through the host.
 *
 * Rows are addressed by painted position rather than by key on purpose: a
 * survivor keeps its hosts through a reorder, so "the second row on screen" and
 * "the row that was second last render" are different questions, and a test
 * that could not ask the first one could not tell a rebind from a re-mount.
 */
function rowListener(
	commits: readonly LynxTransportCommitMessage[],
	row: number,
): LynxResolvedNativeEvent {
	const papi = createFakePAPI();
	const host = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
	// page > rows container > the nth row > its label column.
	const rows = papi.pages[0]!.children[0]!.children[1]!;
	const label = rows.children[row]!.children[1]!;
	const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
	if (resolved === null) throw new Error(`row ${row} bound no event site`);
	return resolved;
}

/** The tap site on a CARD_PLAN member inside TABLE_PLAN's structural range. */
function cardRangeListener(
	commits: readonly LynxTransportCommitMessage[],
	row: number,
): LynxResolvedNativeEvent {
	const papi = createFakePAPI();
	const host = createLynxHostContainer(papi, { root: 1 });
	for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
	const rows = papi.pages[0]!.children[0]!.children[1]!;
	const label = rows.children[row]!.children[0]!;
	const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
	if (resolved === null) throw new Error(`card ${row} bound no event site`);
	return resolved;
}

/** Send one delivery back, as the main thread would. */
function deliverTo(
	block: { readonly main: { readonly commits: readonly LynxTransportCommitMessage[] } },
	listener: LynxResolvedNativeEvent,
	version = block.main.commits.at(-1)!.version,
): unknown {
	return (block as ReturnType<typeof blockColumn>).background.dispatchTransportEvent({
		protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
		renderer: LYNX_TRANSPORT_RENDERER,
		root: 1,
		// A delivery names the batch it was painted against, so a stale event is
		// refused rather than run against post-commit state.
		version,
		type: 'event',
		priority: listener.priority,
		deliveries: [{ listener: listener.listener, payload: null }],
	} as never);
}

/** A root driven by the universal core, over the transport a real page uses. */
function universalColumn<Props>(component: LynxComponent<Props>) {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const root = createUniversalRoot(container, createLynxClientDriver(container), {
		transport,
		scheduleMicrotask: (callback) => callback(),
	});
	transport.bindRoot(root);
	let acknowledged = 0;
	return {
		main,
		async render(props: Props): Promise<void> {
			await flushMicrotasks();
			while (acknowledged < main.commits.length) {
				main.acknowledge(main.commits[acknowledged++]!);
			}
			let settled = false;
			const rendering = root.renderAsync(component as never, props as never).finally(() => {
				settled = true;
			});
			for (let guard = 0; guard < 20 && !settled; guard++) {
				await flushMicrotasks();
				while (acknowledged < main.commits.length) {
					main.acknowledge(main.commits[acknowledged++]!);
				}
			}
			await rendering;
			await flushMicrotasks();
		},
	};
}

/** The same component through `core: 'block'`, entered exactly as a bundle enters it. */
function blockColumn<Props = CardProps>(
	core?: LynxBlockCore,
	resolveProgram?: Parameters<typeof installMainSide>[2],
	compact = false,
) {
	const context = new FakeContextProxy();
	const main = installMainSide(context, compact, resolveProgram);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const background = createLynxBlockBackgroundCore({
		container,
		transport,
		scheduleMicrotask: (callback) => void Promise.resolve().then(callback),
		transportRoot: 1,
		core,
	});
	transport.bindRoot(background);
	let acknowledged = 0;
	const acknowledgePending = () => {
		while (acknowledged < main.commits.length) {
			main.acknowledge(main.commits[acknowledged++]!);
		}
	};
	const settle = async (work: Promise<unknown>): Promise<unknown> => {
		let settled = false;
		const tracked = work.then(
			(value) => {
				settled = true;
				return value;
			},
			(error) => {
				settled = true;
				throw error;
			},
		);
		tracked.catch(() => undefined);
		for (let guard = 0; guard < 20 && !settled; guard++) {
			await flushMicrotasks();
			acknowledgePending();
		}
		return tracked;
	};
	return {
		main,
		background,
		settle,
		acknowledgePending,
		markPendingHandled(): void {
			acknowledged = main.commits.length;
		},
		async render(component: LynxComponent<Props>, props: Props): Promise<void> {
			await settle(background.renderAsync(component as never, props as never));
		},
	};
}

/** One state per rung; the ladder moves one thing, then the other, then both. */
const LADDER: readonly CardProps[] = [
	{ label: 'alpha', detail: 'one', active: false, onTap: noop },
	{ label: 'beta', detail: 'one', active: false, onTap: noop },
	{ label: 'beta', detail: 'one', active: true, onTap: noop },
	{ label: 'beta', detail: 'two', active: true, onTap: noop },
	{ label: 'gamma', detail: 'three', active: false, onTap: noop },
	// A render that moves nothing. The wire must agree that nothing moved.
	{ label: 'gamma', detail: 'three', active: false, onTap: noop },
];

describe('Lynx compiled component on the Block core', () => {
	it('rejects a mismatched background program ABI before mounting', () => {
		expect(() =>
			lynxProgram(LYNX_TRANSPORT_RENDERER, {
				...CARD_PROGRAM_IR,
				version: 2,
				address: {
					module: 'tests/MismatchedCard.lynx.tsrx',
					index: 0,
					digest: '0123456789abcdef',
				},
			} as never),
		).toThrow(/expected ABI version 1, received 2/);
	});
	it('validates and deeply freezes compiler-owned host-ref sites', () => {
		const program = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: CARD_COMPILER_PROGRAM.address,
			refs: [{ node: 0, slot: 0 }],
		});
		expect(program.refs).toEqual([{ node: 0, slot: 0 }]);
		expect(Object.isFrozen(program.refs)).toBe(true);
		expect(Object.isFrozen(program.refs![0])).toBe(true);

		expect(() =>
			lynxProgram(LYNX_TRANSPORT_RENDERER, {
				...CARD_PROGRAM_IR,
				address: CARD_COMPILER_PROGRAM.address,
				refs: [{ node: CARD_PROGRAM_IR.wire.nodes.length, slot: 0 }],
			}),
		).toThrow(/invalid host-ref site/);
		expect(() =>
			lynxProgram(LYNX_TRANSPORT_RENDERER, {
				...CARD_PROGRAM_IR,
				address: CARD_COMPILER_PROGRAM.address,
				refs: [{ node: 0, slot: -1 }],
			}),
		).toThrow(/invalid host-ref site/);
		expect(() => lynxProgramValue(program, [])).toThrow(/host-ref slot/);
	});

	it('validates scalar replay and structural invalidation as distinct descriptors', () => {
		expect(() =>
			lynxProgramValue(CARD_COMPILER_PROGRAM, CARD_PROGRAM_IR.values, [
				{
					kind: 'scalar',
					purity: 'pure',
					escape: 'component-render',
					sources: [noop],
					slots: [0],
				} as never,
			]),
		).toThrow(/replay function/);

		expect(() =>
			lynxProgramValue(CARD_COMPILER_PROGRAM, CARD_PROGRAM_IR.values, [
				{
					kind: 'structural',
					purity: 'unknown',
					escape: 'component-render',
					sources: [noop],
					slots: [0],
				},
			] as never),
		).toThrow(/valid kind\/purity\/escape metadata/);

		expect(() =>
			lynxProgramValue(
				TABLE_COMPILER_PROGRAM,
				[undefined],
				[
					{
						kind: 'structural',
						purity: 'unknown',
						escape: 'component-render',
						sources: [noop],
						slots: [0],
					},
				],
			),
		).not.toThrow();

		expect(() =>
			lynxProgramValue(TABLE_COMPILER_PROGRAM, [undefined], [
				{
					kind: 'structural',
					purity: 'unknown',
					escape: 'component-render',
					sources: [noop],
					slots: [0],
					run: () => [undefined],
				},
			] as never),
		).toThrow(/replay function/);

		expect(() =>
			lynxProgramValue(TABLE_COMPILER_PROGRAM, [undefined], [
				{
					kind: 'structural',
					purity: 'descriptor-pure',
					escape: 'component-render',
					sources: [noop],
					slots: [0],
				},
			] as never),
		).toThrow(/replay function/);
	});
	it('preserves a build-proven address on the Block run command', async () => {
		const block = blockColumn(
			createLynxBlockCore({ templateRuns: () => true }),
			residentRunProgram,
		);
		await block.render(AddressedCard as LynxComponent<CardProps>, LADDER[0]!);

		expect(block.main.commits).toHaveLength(1);
		expect(block.main.commits[0]!.batch.commands).toEqual([
			expect.objectContaining({
				op: 'mount-program-run',
				address: { module: 'tests/AddressedCard.lynx.tsrx', index: 0 },
			}),
		]);
	});

	it('consumes the compiler-owned wire directly and preserves update semantics', async () => {
		const universal = universalColumn(Card as LynxComponent<CardProps>);
		const block = blockColumn();

		for (const [step, props] of LADDER.entries()) {
			await universal.render(props);
			await block.render(CompilerCard as LynxComponent<CardProps>, props);

			const left = paint(universal.main.commits);
			const right = paint(block.main.commits);
			expect(right.tree, `tree after step ${step}`).toBe(left.tree);
			expect(right.handles, `handles after step ${step}`).toBe(left.handles);
			expect(right.events, `events after step ${step}`).toBe(left.events);
		}
		expect(paint(block.main.commits).tree).toContain('gamma');
	});

	it('paints what the universal core paints, at every step of a ladder', async () => {
		const universal = universalColumn(Card as LynxComponent<CardProps>);
		const block = blockColumn();

		for (const [step, props] of LADDER.entries()) {
			await universal.render(props);
			await block.render(Card as LynxComponent<CardProps>, props);

			const left = paint(universal.main.commits);
			const right = paint(block.main.commits);
			expect(right.tree, `tree after step ${step}`).toBe(left.tree);
			expect(right.handles, `handles after step ${step}`).toBe(left.handles);
			expect(right.events, `events after step ${step}`).toBe(left.events);
		}

		// The ladder has to have painted something, or every assertion above
		// compared two empty artifacts and agreed.
		expect(paint(block.main.commits).tree).toContain('card-label');
		expect(paint(block.main.commits).tree).toContain('gamma');
	});

	it('sends a frame only for the renders that changed something', async () => {
		const block = blockColumn();
		const frames: number[] = [];
		for (const props of LADDER) {
			const before = block.main.commits.length;
			await block.render(Card as LynxComponent<CardProps>, props);
			frames.push(block.main.commits.length - before);
		}
		// Mount, then one frame per rung that moved a value, then nothing for the
		// rung that repeated the previous state: a re-render that changes no slot
		// is not a commit the far side has to process.
		expect(frames).toEqual([1, 1, 1, 1, 1, 0]);
	});

	it('visits only the slots a re-render moved', async () => {
		// `counters()` is the core's published account of its own claim, and this is
		// the derived path's version of it: the work an update does is a function of
		// what changed, not of how big the component's template is.
		const core = createLynxBlockCore();
		const block = blockColumn(core);
		const base: CardProps = { label: 'alpha', detail: 'one', active: false, onTap: noop };
		await block.render(Card as LynxComponent<CardProps>, base);

		const step = async (props: CardProps) => {
			const before = core.counters();
			await block.render(Card as LynxComponent<CardProps>, props);
			const after = core.counters();
			return {
				lookups: after.blockLookups - before.blockLookups,
				commands: after.commands - before.commands,
			};
		};

		// One of the card's four value slots moved.
		expect(await step({ ...base, label: 'beta' })).toEqual({ lookups: 1, commands: 1 });
		// `active` drives two classes, on two different nodes.
		expect(await step({ ...base, label: 'beta', active: true })).toEqual({
			lookups: 2,
			commands: 2,
		});
		// And a render that moves nothing costs nothing, however many slots the
		// template has.
		expect(await step({ ...base, label: 'beta', active: true })).toEqual({
			lookups: 0,
			commands: 0,
		});
	});

	it('routes a native delivery back to the handler this render returned', async () => {
		const block = blockColumn();
		const taps: string[] = [];
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: () => taps.push('first'),
		});

		const listener = boundListener(block.main.commits);
		const deliver = () => deliverTo(block, listener);

		deliver();
		expect(taps).toEqual(['first']);

		// A handler is a fresh closure every render. The same site must reach the
		// second render's closure, without the wire changing: a rebind moves which
		// function an id reaches, never the id.
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'beta',
			detail: 'one',
			active: false,
			onTap: () => taps.push('second'),
		});
		deliver();
		expect(taps).toEqual(['first', 'second']);
	});

	it('releases the listeners it bound when the root unmounts', async () => {
		const block = blockColumn();
		const taps: string[] = [];
		await block.render(Card as LynxComponent<CardProps>, {
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: () => taps.push('tapped'),
		});
		const listener = boundListener(block.main.commits);

		await block.settle(block.background.unmountAsync());

		// The root outlives the program's unmount, so a listener the program left
		// bound would keep this render's closure — and its props — reachable on a
		// root that no longer paints, and would still run for a late delivery.
		expect(() => deliverTo(block, listener)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it("leaves a conditional handler's site unbound until a render supplies one", async () => {
		const block = blockColumn();
		const taps: string[] = [];
		const conditional = (handler: (() => void) | undefined): CardProps => ({
			label: 'alpha',
			detail: 'one',
			active: false,
			onTap: handler as never,
		});

		// An empty hole is how a template expresses a conditional handler — the
		// same shape `block-root.ts` documents a `null` listener entry for — so a
		// render that has no handler yet must mount rather than be refused.
		await block.render(Card as LynxComponent<CardProps>, conditional(undefined));
		await block.render(
			Card as LynxComponent<CardProps>,
			conditional(() => taps.push('later')),
		);
		const listener = boundListener(block.main.commits);
		deliverTo(block, listener);
		expect(taps).toEqual(['later']);

		// And a render that withdraws the handler unbinds the site: a delivery
		// must not reach a closure the current render no longer returns.
		await block.render(Card as LynxComponent<CardProps>, conditional(undefined));
		expect(() => deliverTo(block, listener)).toThrow(/listener/i);
		expect(taps).toEqual(['later']);
	});

	it('still prefers a program a component carries over deriving one', async () => {
		const block = blockColumn();
		let mounted = 0;
		// A wrapper rather than the shared Card: `withLynxBlockProgram` defines
		// the program on the component it is given, and the suite's other cases
		// must keep exercising the derivation.
		const CarrierCard = (props: CardProps, context: Parameters<typeof Card>[1]) =>
			Card(props, context);
		const carrier = withLynxBlockProgram(CarrierCard as LynxComponent<CardProps>, {
			mount() {
				mounted++;
			},
		});

		await block.render(carrier, LADDER[0]!);

		// The attached program ran and the derivation did not: a component that
		// says what it is on the Block core is never second-guessed.
		expect(mounted).toBe(1);
		expect(block.main.commits).toHaveLength(0);
	});
});

describe('Lynx compiled component with its own state on the Block core', () => {
	/**
	 * A page that reads a cell, and a tap that writes it.
	 *
	 * The cell is spelled rather than counted because `paint` rewrites every
	 * digit it finds into an allocator token — which is what makes its trees
	 * comparable across two cores, and what would make `n:0` and `n:1` the same
	 * string here.
	 */
	const TALLY = ['none', 'once', 'twice', 'thrice'] as const;
	const Counter = defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		function Counter(props: { readonly base: string }) {
			const [taps, setTaps] = useState(0);
			return universalValue(CARD_PLAN, [
				'card',
				`${props.base}-${TALLY[taps] ?? 'many'}`,
				'card-meta',
				() => setTaps((previous) => previous + 1),
				'detail',
			]);
		},
	);

	it('repaints the page when a tap writes a cell the page owns', async () => {
		const block = blockColumn<{ readonly base: string }>();
		await block.render(Counter as LynxComponent<{ readonly base: string }>, { base: 'n' });
		expect(paint(block.main.commits).tree).toContain('n-none');

		// The tap runs a setter with no render in flight and no caller left to
		// re-render the page, so what repaints it is the scope's own schedule.
		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('n-once');

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('n-twice');
	});
	it('runs only compiler dependency groups for a covered state update', async () => {
		let componentRuns = 0;
		let computationRuns = 0;
		const Direct = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Direct(props: { readonly base: string }) {
				componentRuns++;
				const [count, setCount, getCount] = useState(0, 'count');
				const label = `${props.base}-${TALLY[count] ?? 'many'}`;
				return lynxProgramValue(
					CARD_COMPILER_PROGRAM,
					[
						count === 0 ? 'card' : 'card active',
						label,
						count === 0 ? 'card-meta' : 'card-meta on',
						() => {
							setCount(getCount() + 1);
							setCount(getCount() + 1);
						},
						'detail',
					],
					[
						{
							sources: [getCount],
							kind: 'scalar',
							purity: 'pure',
							escape: 'component-render',
							slots: [0, 1, 2],
							run() {
								computationRuns++;
								const next = getCount();
								return [
									next === 0 ? 'card' : 'card active',
									`${props.base}-${TALLY[next] ?? 'many'}`,
									next === 0 ? 'card-meta' : 'card-meta on',
								];
							},
						},
					],
				) as never;
			},
		);
		const core = createLynxBlockCore({ templateRuns: () => false });
		const block = blockColumn<{ readonly base: string }>(core);

		await block.render(Direct as LynxComponent<{ readonly base: string }>, { base: 'n' });
		expect(componentRuns).toBe(1);
		expect(computationRuns).toBe(0);
		const before = core.counters();

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());

		const after = core.counters();
		expect(componentRuns).toBe(1);
		expect(computationRuns).toBe(1);
		expect(paint(block.main.commits).tree).toContain('n-twice');
		expect({
			lookups: after.blockLookups - before.blockLookups,
			commands: after.commands - before.commands,
		}).toEqual({ lookups: 3, commands: 3 });

		// A caller-driven render refreshes the computation closure's props. Its
		// next state-only update still bypasses the component setup.
		await block.render(Direct as LynxComponent<{ readonly base: string }>, { base: 'b' });
		expect(componentRuns).toBe(2);
		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(componentRuns).toBe(2);
		expect(computationRuns).toBe(2);
		expect(paint(block.main.commits).tree).toContain('b-many');
	});

	it('indexes a repeated source getter only once for hand-authored metadata', async () => {
		let computationRuns = 0;
		let setCount: ((value: number) => void) | undefined;
		const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
			const [count, updateCount, getCount] = useState(0, 'count');
			setCount = updateCount;
			return lynxProgramValue(
				CARD_COMPILER_PROGRAM,
				['card', TALLY[count] ?? 'many', 'card-meta', noop, 'detail'],
				[
					{
						kind: 'scalar',
						purity: 'pure',
						escape: 'component-render',
						sources: [getCount, getCount],
						slots: [1],
						run() {
							computationRuns++;
							return [TALLY[getCount()] ?? 'many'];
						},
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>();

		await block.render(Scene as LynxComponent<Record<string, never>>, {});
		setCount!(1);
		await block.settle(Promise.resolve());

		expect(computationRuns).toBe(1);
		expect(paint(block.main.commits).tree).toContain('once');
	});

	it('indexes dirty dependency discovery independently of unrelated groups', async () => {
		const groupCount = 128;
		let componentRuns = 0;
		let sourceReads = 0;
		let setFirst: ((value: number) => void) | undefined;
		const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
			componentRuns++;
			const computations = [];
			for (let index = 0; index < groupCount; index++) {
				const [value, update, getValue] = useState(index, `group-${index}`);
				if (index === 0) setFirst = update;
				const sources: Array<() => unknown> = [];
				Object.defineProperty(sources, 0, {
					configurable: true,
					get() {
						sourceReads++;
						return getValue;
					},
				});
				sources.length = 1;
				computations.push({
					kind: 'scalar' as const,
					purity: 'pure' as const,
					escape: 'component-render' as const,
					sources,
					slots: [0],
					run: () => [index === 0 && getValue() !== value ? 'card active' : 'card'],
				});
			}
			return lynxProgramValue(
				CARD_COMPILER_PROGRAM,
				['card', 'ready', 'card-meta', noop, 'detail'],
				computations,
			) as never;
		});
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Scene as LynxComponent<Record<string, never>>, {});
		sourceReads = 0;
		setFirst!(groupCount);
		await block.settle(Promise.resolve());

		expect(componentRuns).toBe(1);
		expect(sourceReads).toBe(0);
		expect(paint(block.main.commits).tree).toContain('card active');
	});

	it('runs a shared dependency group once when both sources update together', async () => {
		let componentRuns = 0;
		let computationRuns = 0;
		let updateBoth: (() => void) | undefined;
		const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
			componentRuns++;
			const [left, setLeft, getLeft] = useState('left', 'left');
			const [right, setRight, getRight] = useState('right', 'right');
			updateBoth = () => {
				setLeft('LEFT');
				setRight('RIGHT');
			};
			return lynxProgramValue(
				CARD_COMPILER_PROGRAM,
				['card', `${left}:${right}`, 'card-meta', noop, 'detail'],
				[
					{
						kind: 'scalar',
						purity: 'pure',
						escape: 'component-render',
						sources: [getLeft, getRight],
						slots: [1],
						run() {
							computationRuns++;
							return [`${getLeft()}:${getRight()}`];
						},
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>();

		await block.render(Scene as LynxComponent<Record<string, never>>, {});
		updateBoth!();
		await block.settle(Promise.resolve());

		expect(componentRuns).toBe(1);
		expect(computationRuns).toBe(1);
		expect(paint(block.main.commits).tree).toContain('LEFT:RIGHT');
	});

	it('prepares and refreshes continuous-input work while the previous frame awaits acknowledgement', async () => {
		let computationRuns = 0;
		const Direct = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Direct() {
			const [count, updateCount, getCount] = useState(0, 'count');
			return lynxProgramValue(
				CONTINUOUS_CARD_COMPILER_PROGRAM,
				[
					'card',
					TALLY[count] ?? 'many',
					'card-meta',
					() => updateCount((previous) => previous + 1),
					'detail',
				],
				[
					{
						kind: 'scalar',
						purity: 'pure',
						escape: 'component-render',
						sources: [getCount],
						slots: [1],
						run() {
							computationRuns++;
							return [TALLY[getCount()] ?? 'many'];
						},
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);
		await block.render(Direct as LynxComponent<Record<string, never>>, {});
		const profileBefore = { ...lynxWireProfile() };
		const acceptedVersion = block.main.commits[0]!.version;
		const scroll = boundListener(block.main.commits);
		expect(scroll.priority).toBe('continuous');

		deliverTo(block, scroll, acceptedVersion);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(2);
		expect(computationRuns).toBe(1);

		deliverTo(block, scroll, acceptedVersion);
		const pending = block.background.flushTransport();
		await flushMicrotasks();
		// Calculation advanced, but no speculative host frame or publication escaped.
		expect(computationRuns).toBe(2);
		expect(block.main.commits).toHaveLength(2);

		deliverTo(block, scroll, acceptedVersion);
		await flushMicrotasks();
		expect(computationRuns).toBe(3);
		expect(block.main.commits).toHaveLength(2);

		block.acknowledgePending();
		for (let guard = 0; guard < 5 && block.main.commits.length < 3; guard++)
			await flushMicrotasks();
		expect(block.main.commits).toHaveLength(3);
		expect(computationRuns).toBe(3);
		block.acknowledgePending();
		await pending;
		expect(paint(block.main.commits).tree).toContain('thrice');
		const profileAfter = lynxWireProfile();
		expect({
			merges: profileAfter.blockRenderMerges - profileBefore.blockRenderMerges,
			preparations: profileAfter.blockRenderPrepares - profileBefore.blockRenderPrepares,
			preparationsWhileAck:
				profileAfter.blockRenderPreparesWhileAck - profileBefore.blockRenderPreparesWhileAck,
			roundTrips: profileAfter.blockAckRoundTrips - profileBefore.blockAckRoundTrips,
		}).toEqual({
			merges: 1,
			preparations: 2,
			preparationsWhileAck: 2,
			roundTrips: 2,
		});
		expect(profileAfter.blockRenderQueueMaxDepth).toBeGreaterThanOrEqual(1);
	});

	it('drains a prepared scalar draft before teardown requested during acknowledgement', async () => {
		let computationRuns = 0;
		let setCount!: (value: number | ((previous: number) => number)) => void;
		const Direct = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Direct() {
			const [count, updateCount, getCount] = useState(0, 'count');
			setCount = updateCount;
			return lynxProgramValue(
				CARD_COMPILER_PROGRAM,
				['card', TALLY[count] ?? 'many', 'card-meta', noop, 'detail'],
				[
					{
						kind: 'scalar',
						purity: 'pure',
						escape: 'component-render',
						sources: [getCount],
						slots: [1],
						run() {
							computationRuns++;
							return [TALLY[getCount()] ?? 'many'];
						},
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);
		await block.render(Direct as LynxComponent<Record<string, never>>, {});

		setCount((previous) => previous + 1);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(2);

		setCount((previous) => previous + 1);
		const unmounting = block.background.unmountAsync();
		await flushMicrotasks();
		expect(computationRuns).toBe(2);
		expect(block.main.commits).toHaveLength(2);

		block.acknowledgePending();
		for (let guard = 0; guard < 5 && block.main.commits.length < 3; guard++) {
			await flushMicrotasks();
		}
		expect(block.main.commits).toHaveLength(3);
		expect(computationRuns).toBe(2);
		expect(paint(block.main.commits).tree).toContain('twice');

		block.acknowledgePending();
		for (let guard = 0; guard < 5 && block.main.commits.length < 4; guard++) {
			await flushMicrotasks();
		}
		expect(block.main.commits).toHaveLength(4);
		block.acknowledgePending();
		await unmounting;

		setCount((previous) => previous + 1);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(4);
		expect(computationRuns).toBe(2);
	});

	it.each([
		['rejects before acceptance', 'reject', 'a-once', 1],
		['faults after acceptance', 'fault', 'b-once', 2],
	] as const)(
		'rebases a prepared draft when an older props frame %s',
		async (_label, outcome, expected, expectedComputations) => {
			let computationRuns = 0;
			let setCount!: (value: number | ((previous: number) => number)) => void;
			const Direct = defineUniversalComponent(
				LYNX_TRANSPORT_RENDERER,
				function Direct(props: { readonly base: string }) {
					const [count, updateCount, getCount] = useState(0, 'count');
					setCount = updateCount;
					return lynxProgramValue(
						CARD_COMPILER_PROGRAM,
						['card', props.base + '-' + (TALLY[count] || 'many'), 'card-meta', noop, 'detail'],
						[
							{
								kind: 'scalar',
								purity: 'pure',
								escape: 'component-render',
								sources: [getCount],
								slots: [1],
								run() {
									computationRuns++;
									return [props.base + '-' + (TALLY[getCount()] || 'many')];
								},
							},
						],
					) as never;
				},
			);
			const block = blockColumn<{ readonly base: string }>(
				createLynxBlockCore({ templateRuns: () => false }),
			);
			await block.render(Direct as LynxComponent<{ readonly base: string }>, { base: 'a' });

			const updating = block.background.renderAsync(Direct as never, { base: 'b' });
			updating.catch(() => undefined);
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(2);
			setCount((previous) => previous + 1);
			const pending = block.background.flushTransport();
			await flushMicrotasks();
			expect(computationRuns).toBe(1);
			expect(block.main.commits).toHaveLength(2);

			if (outcome === 'reject') {
				block.main.reject(block.main.commits[1]!, 'injected props rejection');
				await expect(updating).rejects.toThrow('injected props rejection');
			} else {
				block.main.acknowledge(block.main.commits[1]!, 'fault');
				await expect(updating).rejects.toThrow('accepted host fault');
			}
			for (let guard = 0; guard < 5 && block.main.commits.length < 3; guard++) {
				await flushMicrotasks();
			}
			expect(block.main.commits).toHaveLength(3);
			expect(computationRuns).toBe(expectedComputations);
			block.main.acknowledge(block.main.commits[2]!);
			await pending;
			const accepted =
				outcome === 'reject'
					? [block.main.commits[0]!, block.main.commits[2]!]
					: block.main.commits;
			expect(paint(accepted).tree).toContain(expected);
		},
	);

	it('rebinds a dirty event slot without retaining its stale closure', async () => {
		let componentRuns = 0;
		let computationRuns = 0;
		let setLabel: ((value: string) => void) | undefined;
		const observations: string[] = [];
		const Direct = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Direct() {
			componentRuns++;
			const [label, updateLabel, getLabel] = useState('old', 'label');
			setLabel = updateLabel;
			return lynxProgramValue(
				CARD_COMPILER_PROGRAM,
				['card', label, 'card-meta', () => observations.push(label), 'detail'],
				[
					{
						kind: 'scalar',
						purity: 'pure',
						escape: 'component-render',
						sources: [getLabel],
						slots: [1, 3],
						run() {
							computationRuns++;
							const next = getLabel();
							return [next, () => observations.push(next)];
						},
					},
				],
			) as never;
		});
		const core = createLynxBlockCore({ templateRuns: () => false });
		const block = blockColumn<Record<string, never>>(core);

		await block.render(Direct as LynxComponent<Record<string, never>>, {});
		const listener = boundListener(block.main.commits);
		deliverTo(block, listener);
		expect(observations).toEqual(['old']);

		const before = core.counters();
		setLabel!('new');
		await block.settle(Promise.resolve());
		const after = core.counters();
		deliverTo(block, listener);

		expect(componentRuns).toBe(1);
		expect(computationRuns).toBe(1);
		expect(observations).toEqual(['old', 'new']);
		expect({
			lookups: after.blockLookups - before.blockLookups,
			commands: after.commands - before.commands,
		}).toEqual({ lookups: 1, commands: 1 });
	});

	it('keeps dynamic host refs on the serialized ownership path', async () => {
		const refs: string[] = [];
		const callback = (name: string) => (handle: unknown | null) => {
			refs.push(`${name}:${handle === null ? 'null' : 'attach'}`);
			return () => refs.push(`${name}:cleanup`);
		};
		const props = {
			firstRef: callback('first'),
			secondRef: callback('second'),
		};
		let componentRuns = 0;
		let setCount!: (value: number) => void;
		let setSecond!: (value: boolean) => void;
		const DynamicRef = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function DynamicRef(input: typeof props) {
				componentRuns++;
				const [count, updateCount, getCount] = useState(0, 'count');
				const [second, updateSecond, getSecond] = useState(false, 'second-ref');
				setCount = updateCount;
				setSecond = updateSecond;
				return lynxProgramValue(
					REF_CARD_COMPILER_PROGRAM,
					[
						'card',
						`count ${TALLY[count] ?? 'many'}`,
						'card-meta',
						noop,
						second ? 'second' : 'first',
						second ? input.secondRef : input.firstRef,
					],
					[
						{
							kind: 'scalar',
							purity: 'pure',
							escape: 'component-render',
							sources: [getCount],
							slots: [1],
							run: () => [`count ${TALLY[getCount()] ?? 'many'}`],
						},
						{
							kind: 'scalar',
							purity: 'pure',
							escape: 'component-render',
							sources: [getSecond],
							slots: [4, 5],
							run: () => [
								getSecond() ? 'second' : 'first',
								getSecond() ? input.secondRef : input.firstRef,
							],
						},
					],
				) as never;
			},
		);
		const block = blockColumn<typeof props>();

		await block.render(DynamicRef, props);
		expect(refs).toEqual(['first:attach']);
		expect(componentRuns).toBe(1);

		setCount(1);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(2);
		setSecond(true);
		const pending = block.background.flushTransport();
		await flushMicrotasks();
		// The ref update is accumulated while the count frame is in flight, but
		// neither its full component render nor its ownership callback may publish.
		expect(block.main.commits).toHaveLength(2);
		expect(componentRuns).toBe(1);
		expect(refs).toEqual(['first:attach']);

		block.acknowledgePending();
		for (let guard = 0; guard < 5 && block.main.commits.length < 3; guard++) {
			await flushMicrotasks();
		}
		expect(block.main.commits).toHaveLength(3);
		expect(componentRuns).toBe(2);
		expect(refs).toEqual(['first:attach']);

		block.acknowledgePending();
		await pending;

		expect(paint(block.main.commits).tree).toContain('count once');
		expect(paint(block.main.commits).tree).toContain('second');
		expect(refs).toEqual(['first:attach', 'first:cleanup', 'second:attach']);
	});

	it('keeps compiler scalar updates independent of unrelated keyed row count', async () => {
		for (const count of [2, 128]) {
			let componentRuns = 0;
			let computationRuns = 0;
			let keyCalls = 0;
			let bodyCalls = 0;
			let setHeading: ((value: string) => void) | undefined;
			const rows = Array.from({ length: count }, (_, index) => ({
				id: index + 1,
				label: `row ${index + 1}`,
			}));
			const Scene = defineUniversalComponent(
				LYNX_TRANSPORT_RENDERER,
				function Scene(props: { readonly rows: readonly TableRow[] }) {
					componentRuns++;
					const [heading, updateHeading, getHeading] = useState('ready', 'heading');
					setHeading = updateHeading;
					return lynxProgramValue(
						RANGE_DEPENDENCY_PAGE_PROGRAM,
						[
							heading,
							universalFor(
								props.rows,
								(row: TableRow) => {
									keyCalls++;
									return row.id;
								},
								(row: TableRow) => {
									bodyCalls++;
									return universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]);
								},
							),
						],
						[
							{
								kind: 'scalar',
								purity: 'pure',
								escape: 'component-render',
								sources: [getHeading],
								slots: [0],
								run() {
									computationRuns++;
									return [getHeading()];
								},
							},
						],
					) as never;
				},
			);
			const core = createLynxBlockCore({ templateRuns: () => false });
			const block = blockColumn<{ readonly rows: readonly TableRow[] }>(core);

			await block.render(Scene as LynxComponent<{ readonly rows: readonly TableRow[] }>, { rows });
			keyCalls = 0;
			bodyCalls = 0;
			const before = core.counters();
			setHeading!('changed');
			await block.settle(Promise.resolve());
			const after = core.counters();

			expect(componentRuns, `${count} rows`).toBe(1);
			expect(computationRuns, `${count} rows`).toBe(1);
			expect({ keyCalls, bodyCalls }, `${count} rows`).toEqual({ keyCalls: 0, bodyCalls: 0 });
			expect(
				{
					lookups: after.blockLookups - before.blockLookups,
					commands: after.commands - before.commands,
				},
				`${count} rows`,
			).toEqual({ lookups: 1, commands: 1 });
			expect(paint(block.main.commits).tree).toContain('changed');
			await block.settle(block.background.unmountAsync());
		}
	});

	it('reruns the owning component for a structural dependency without replaying it', async () => {
		let componentRuns = 0;
		let setRows: ((value: readonly TableRow[]) => void) | undefined;
		const one = { id: 1, label: 'row 1' };
		const two = { id: 2, label: 'row 2' };
		const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
			componentRuns++;
			const [rows, updateRows, getRows] = useState<readonly TableRow[]>([one], 'rows');
			setRows = updateRows;
			return lynxProgramValue(
				TABLE_COMPILER_PROGRAM,
				[
					universalFor(
						rows,
						(row: TableRow) => row.id,
						(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
					),
				],
				[
					{
						kind: 'structural',
						purity: 'unknown',
						escape: 'component-render',
						sources: [getRows],
						slots: [0],
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Scene as LynxComponent<Record<string, never>>, {});
		expect(componentRuns).toBe(1);
		expect(
			JSON.parse(paint(block.main.commits).tree).children[0].children[1].children,
		).toHaveLength(1);
		setRows!([one, two]);
		await block.settle(Promise.resolve());

		expect(componentRuns).toBe(2);
		expect(
			JSON.parse(paint(block.main.commits).tree).children[0].children[1].children,
		).toHaveLength(2);
	});

	it('replays a compiler-proved keyed range without rerunning its owning component', async () => {
		let componentRuns = 0;
		let computationRuns = 0;
		let setRows: ((value: readonly TableRow[]) => void) | undefined;
		const one = { id: 1, label: 'row 1' };
		const two = { id: 2, label: 'row 2' };
		const range = (rows: readonly TableRow[]) =>
			universalFor(
				rows,
				(row: TableRow) => row.id,
				(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
			);
		const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
			componentRuns++;
			const [rows, updateRows, getRows] = useState<readonly TableRow[]>([one], 'rows');
			setRows = updateRows;
			return lynxProgramValue(
				TABLE_COMPILER_PROGRAM,
				[range(rows)],
				[
					{
						kind: 'structural',
						purity: 'descriptor-pure',
						escape: 'component-render',
						sources: [getRows],
						slots: [0],
						run() {
							computationRuns++;
							return [range(getRows())];
						},
					},
				],
			) as never;
		});
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Scene as LynxComponent<Record<string, never>>, {});
		setRows!([one, two]);
		await block.settle(Promise.resolve());

		expect(componentRuns).toBe(1);
		expect(computationRuns).toBe(1);
		expect(
			JSON.parse(paint(block.main.commits).tree).children[0].children[1].children,
		).toHaveLength(2);
	});

	it('rebases a rejected keyed-range replay onto the next state update', async () => {
		vi.useFakeTimers();
		try {
			let componentRuns = 0;
			let computationRuns = 0;
			let setRows: ((value: readonly TableRow[]) => void) | undefined;
			const rows = [1, 2, 3].map((id) => ({ id, label: `row ${id}` }));
			const range = (items: readonly TableRow[]) =>
				universalFor(
					items,
					(row: TableRow) => row.id,
					(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
				);
			const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
				componentRuns++;
				const [items, updateRows, getRows] = useState<readonly TableRow[]>([rows[0]!], 'rows');
				setRows = updateRows;
				return lynxProgramValue(
					TABLE_COMPILER_PROGRAM,
					[range(items)],
					[
						{
							kind: 'structural',
							purity: 'descriptor-pure',
							escape: 'component-render',
							sources: [getRows],
							slots: [0],
							run() {
								computationRuns++;
								return [range(getRows())];
							},
						},
					],
				) as never;
			});
			const block = blockColumn<Record<string, never>>(
				createLynxBlockCore({ templateRuns: () => false }),
			);

			await block.render(Scene as LynxComponent<Record<string, never>>, {});
			setRows!(rows.slice(0, 2));
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(2);
			block.main.reject(block.main.commits[1]!, 'injected range replay rejection');
			await flushMicrotasks();

			setRows!(rows);
			await block.settle(Promise.resolve());

			expect(componentRuns).toBe(1);
			expect(computationRuns).toBe(2);
			expect(
				JSON.parse(paint([block.main.commits[0]!, block.main.commits[2]!]).tree).children[0]
					.children[1].children,
			).toHaveLength(3);
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it('rebases rejected @if and @switch descriptor replays onto the next state', async () => {
		vi.useFakeTimers();
		try {
			let setMode: ((value: 'then' | 'case' | 'default') => void) | undefined;
			const descriptors = (mode: 'then' | 'case' | 'default') => [
				universalIf(
					mode === 'then',
					() => universalValue(ROW_PLAN, ['row', 'if', noop, 'if:then']),
					() => universalValue(ROW_PLAN, ['row', 'if', noop, 'if:else']),
				),
				universalSwitch(
					mode,
					[['case', () => universalValue(ROW_PLAN, ['row', 'switch', noop, 'switch:case'])]],
					() => universalValue(ROW_PLAN, ['row', 'switch', noop, 'switch:default']),
				),
			];
			const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Scene() {
				const [mode, updateMode, getMode] = useState<'then' | 'case' | 'default'>('then', 'mode');
				setMode = updateMode;
				return lynxProgramValue(BRANCH_DEPENDENCY_PAGE_PROGRAM, descriptors(mode), [
					{
						kind: 'structural',
						purity: 'descriptor-pure',
						escape: 'component-render',
						sources: [getMode],
						slots: [0, 1],
						run() {
							return descriptors(getMode());
						},
					},
				]) as never;
			});
			const block = blockColumn<Record<string, never>>(
				createLynxBlockCore({ templateRuns: () => false }),
			);

			await block.render(Scene as LynxComponent<Record<string, never>>, {});
			expect(paint(block.main.commits).tree).toContain('if:then');
			expect(paint(block.main.commits).tree).toContain('switch:default');

			setMode!('case');
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(2);
			block.main.reject(block.main.commits[1]!, 'injected branch replay rejection');
			block.markPendingHandled();
			await flushMicrotasks();

			setMode!('default');
			await block.settle(Promise.resolve());

			const accepted = [block.main.commits[0]!, block.main.commits[2]!];
			expect(paint(accepted).tree).toContain('if:else');
			expect(paint(accepted).tree).toContain('switch:default');
			expect(paint(accepted).tree).not.toContain('switch:case');
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it('keeps the cell across a re-render driven by new props', async () => {
		const block = blockColumn<{ readonly base: string }>();
		const render = (base: string) =>
			block.render(Counter as LynxComponent<{ readonly base: string }>, { base });

		await render('a');
		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('a-once');

		// New props, same component: the cell is the page's, not the render's,
		// so the tap it already took survives the prop change.
		await render('b');
		expect(paint(block.main.commits).tree).toContain('b-once');
	});

	it('keeps refs stable and callbacks memoized by their declared dependencies', async () => {
		const refs: { current: number }[] = [];
		const callbacks: (() => void)[] = [];
		const observations: string[] = [];
		const WithStableCells = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function WithStableCells(props: { readonly label: string }) {
				const count = useRef(0, 'count');
				const onTap = useCallback(
					() => observations.push(`${props.label}:${++count.current}`),
					[props.label],
					'onTap',
				);
				refs.push(count);
				callbacks.push(onTap);
				return universalValue(CARD_PLAN, ['card', props.label, 'card-meta', onTap, 'detail']);
			},
		);
		const block = blockColumn<{ readonly label: string }>();

		await block.render(WithStableCells as LynxComponent<{ readonly label: string }>, {
			label: 'same',
		});
		deliverTo(block, boundListener(block.main.commits));
		await block.render(WithStableCells as LynxComponent<{ readonly label: string }>, {
			label: 'same',
		});
		expect(refs[1]).toBe(refs[0]);
		expect(callbacks[1]).toBe(callbacks[0]);

		await block.render(WithStableCells as LynxComponent<{ readonly label: string }>, {
			label: 'changed',
		});
		expect(refs[2]).toBe(refs[0]);
		expect(callbacks[2]).not.toBe(callbacks[1]);
		deliverTo(block, boundListener(block.main.commits));
		expect(observations).toEqual(['same:1', 'changed:2']);
	});

	it('reads the pending value through the third member of the tuple', async () => {
		// `getState` projects the updates already queued, which is what lets a
		// handler write twice off its own arithmetic. The pair is the contract:
		// the same handler written against the rendered value lands on one,
		// because both writes computed the same next value from the same
		// snapshot.
		const twice = (useProjected: boolean) =>
			defineUniversalComponent(
				LYNX_TRANSPORT_RENDERER,
				function Adder(props: { readonly base: string }) {
					const [taps, setTaps, getTaps] = useState(0, 'taps');
					return universalValue(CARD_PLAN, [
						'card',
						`${props.base}-${TALLY[taps] ?? 'many'}`,
						'card-meta',
						() => {
							setTaps((useProjected ? getTaps() : taps) + 1);
							setTaps((useProjected ? getTaps() : taps) + 1);
						},
						'detail',
					]);
				},
			);

		const projected = blockColumn<{ readonly base: string }>();
		await projected.render(twice(true) as LynxComponent<{ readonly base: string }>, {
			base: 'n',
		});
		deliverTo(projected, boundListener(projected.main.commits));
		await projected.settle(Promise.resolve());
		expect(paint(projected.main.commits).tree).toContain('n-twice');

		const rendered = blockColumn<{ readonly base: string }>();
		await rendered.render(twice(false) as LynxComponent<{ readonly base: string }>, {
			base: 'n',
		});
		deliverTo(rendered, boundListener(rendered.main.commits));
		await rendered.settle(Promise.resolve());
		expect(paint(rendered.main.commits).tree).toContain('n-once');
	});

	it('keeps a cell that belongs to a hook a render skipped', async () => {
		// Hooks are keyed by call-site slot, not by call order, so a hook may sit
		// behind a condition. Two things have to hold across that: the cell of the
		// hook that did not run is still there when it runs again, and the hook
		// that ran either way never picks up the other's cell.
		const NAMES = ['first', 'second', 'third'] as const;
		let leadInits = 0;
		const Conditional = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Conditional(props: { readonly base: string; readonly extra: boolean }) {
				let lead = 'skipped';
				if (props.extra) {
					const [value] = useState(() => NAMES[leadInits++] ?? 'many', 'lead');
					lead = value;
				}
				const [tail, setTail] = useState('quiet', 'tail');
				return universalValue(CARD_PLAN, [
					'card',
					`${props.base}-${tail}`,
					'card-meta',
					() => setTail('loud'),
					lead,
				]);
			},
		);

		const block = blockColumn<{ readonly base: string; readonly extra: boolean }>();
		const render = (extra: boolean) =>
			block.render(
				Conditional as LynxComponent<{ readonly base: string; readonly extra: boolean }>,
				{ base: 'n', extra },
			);

		await render(true);
		expect(paint(block.main.commits).tree).toContain('first');
		expect(paint(block.main.commits).tree).toContain('n-quiet');

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('n-loud');

		// The conditional hook does not run this render.
		await render(false);
		expect(paint(block.main.commits).tree).toContain('skipped');
		expect(paint(block.main.commits).tree).toContain('n-loud');

		// And it comes back to the cell it left, rather than to a fresh one or to
		// the cell of the hook that kept running.
		await render(true);
		expect(paint(block.main.commits).tree).toContain('first');
		expect(paint(block.main.commits).tree).toContain('n-loud');
	});

	it('never paints a frame with only one of two cells a tap wrote', async () => {
		const block = blockColumn<{ readonly base: string }>();
		const Two = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Two(props: { readonly base: string }) {
				const [left, setLeft] = useState(false);
				const [right, setRight] = useState(false);
				return universalValue(CARD_PLAN, [
					'card',
					`${props.base}-${left ? 'L' : 'l'}${right ? 'R' : 'r'}`,
					'card-meta',
					() => {
						setLeft(true);
						setRight(true);
					},
					'detail',
				]);
			},
		);

		await block.render(Two as LynxComponent<{ readonly base: string }>, { base: 'n' });
		const mounted = block.main.commits.length;

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('n-LR');

		// The handler wrote two cells, and no frame in between shows one of them
		// moved without the other. A render on the setter's own stack would
		// paint `n-Lr` first, which is a state this component was never in.
		const everyFrame = block.main.commits.map(
			(_, index) => paint(block.main.commits.slice(0, index + 1)).tree,
		);
		expect(everyFrame.some((tree) => tree.includes('n-Lr') || tree.includes('n-lR'))).toBe(false);
		// And the pair did land, so the check above is not vacuous.
		expect(everyFrame.at(-1)).toContain('n-LR');
		expect(block.main.commits.length).toBeGreaterThan(mounted);
	});
});

describe('Lynx compiled component Block semantic boundaries', () => {
	it('publishes Block transition pending in general and compact products', async () => {
		for (const compact of [false, true]) {
			const renders: string[] = [];
			let begin!: () => void;
			const TransitionCard = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
				const [count, setCount] = useState(0, 'transition-count');
				const [pending, start] = useTransition('transition');
				begin = () => start(() => setCount(1));
				renders.push(`${pending}:${count}`);
				return universalValue(CARD_PLAN, [
					'transition',
					`count ${count === 0 ? 'zero' : 'one'}`,
					pending ? 'pending' : 'ready',
					noop,
					`${pending}:${count}`,
				]);
			});
			const block = blockColumn<Record<string, never>>(undefined, undefined, compact);

			await block.render(TransitionCard, {});
			begin();
			await flushMicrotasks();
			await block.settle(block.background.flushTransport());
			await flushMicrotasks();
			await block.settle(block.background.flushTransport());

			expect(renders).toContain('true:0');
			expect(renders).toContain('true:1');
			expect(renders.at(-1)).toBe('false:1');
			expect(paint(block.main.commits).tree).toContain('count one');
		}
	});

	it('runs a standalone Block transition through the same staged lane', async () => {
		let begin!: () => void;
		const renders: number[] = [];
		const TransitionCard = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			const [count, setCount] = useState(0, 'standalone-count');
			begin = () => startTransition(() => setCount(1));
			renders.push(count);
			return universalValue(CARD_PLAN, [
				'transition',
				`standalone ${count === 0 ? 'zero' : 'one'}`,
				'meta',
				noop,
				'detail',
			]);
		});
		const block = blockColumn<Record<string, never>>();

		await block.render(TransitionCard, {});
		begin();
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		expect(renders).toEqual([0, 1]);
		expect(paint(block.main.commits).tree).toContain('standalone one');
	});

	it('previews and then publishes a deferred value through a Block transition', async () => {
		const renders: string[] = [];
		const DeferredCard = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ value }: { readonly value: string }) => {
				const deferred = useDeferredValue(value, 'deferred-value');
				renders.push(`${value}:${deferred}`);
				return universalValue(CARD_PLAN, [
					'deferred',
					deferred,
					value === deferred ? 'fresh' : 'stale',
					noop,
					'detail',
				]);
			},
		);
		const block = blockColumn<{ readonly value: string }>();

		await block.render(DeferredCard, { value: 'zero' });
		await block.render(DeferredCard, { value: 'one' });
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		expect(renders).toContain('one:zero');
		expect(renders.at(-1)).toBe('one:one');
		expect(paint(block.main.commits).tree).toContain('one');
	});

	it('retains transition ownership in a keyed Block row scope', async () => {
		const row = Object.freeze({ id: 1 });
		const renders: string[] = [];
		const TransitionRow = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			const [count, setCount] = useState(0, 'row-count');
			const [pending, start] = useTransition('row-transition');
			renders.push(`${pending}:${count}`);
			return universalValue(CARD_PLAN, [
				'row',
				`row ${count === 0 ? 'zero' : 'one'}`,
				pending ? 'pending' : 'ready',
				() => start(() => setCount(1)),
				'detail',
			]);
		});
		const Page = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalFor(
						[row],
						(item) => item.id,
						() => universalComponent(LYNX_TRANSPORT_RENDERER, TransitionRow, {}),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>();

		await block.render(Page, {});
		deliverTo(block, cardRangeListener(block.main.commits, 0));
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		expect(renders).toContain('true:0');
		expect(renders).toContain('true:1');
		expect(renders.at(-1)).toBe('false:1');
		expect(paint(block.main.commits).tree).toContain('row one');
	});

	it('keeps the accepted Suspense body visible until a Block transition can reveal', async () => {
		let begin!: (promise: Promise<string>) => void;
		const renders: string[] = [];
		const TransitionBoundary = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			const [source, setSource] = useState<Promise<string> | null>(null, 'source');
			const [pending, start] = useTransition('transition');
			begin = (promise) => start(() => setSource(promise));
			renders.push(`${pending}:${source === null ? 'ready' : 'staged'}`);
			return universalValue(TABLE_PLAN, [
				universalTry(
					() =>
						universalValue(CARD_PLAN, [
							'body',
							source === null ? 'ready body' : use(source),
							pending ? 'transition pending' : 'transition ready',
							noop,
							'body',
						]),
					() => universalValue(CARD_PLAN, ['fallback', 'loading', 'meta', noop, 'pending']),
				),
			]);
		});
		const block = blockColumn<Record<string, never>>();

		await block.render(TransitionBoundary, {});
		const pending = deferred<string>();
		begin(pending.promise);
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		const retained = paint(block.main.commits).tree;
		expect(renders).toContain('true:staged');
		expect(retained).toContain('ready body');
		expect(retained).toContain('transition pending');
		expect(retained).not.toContain('loading');

		pending.resolve('revealed body');
		await pending.promise;
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		const revealed = paint(block.main.commits).tree;
		expect(revealed).toContain('revealed body');
		expect(revealed).toContain('transition ready');
		expect(revealed).not.toContain('loading');
		expect(renders.at(-1)).toBe('false:staged');
	});

	it('settles a retained Block transition after an urgent update forfeits its shell', async () => {
		let begin!: (promise: Promise<string>) => void;
		let preempt!: () => void;
		const renders: string[] = [];
		const Boundary = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			const [source, setSource] = useState<Promise<string> | null>(null, 'source');
			const [, setTick] = useState(0, 'tick');
			const [pending, start] = useTransition('transition');
			begin = (promise) => start(() => setSource(promise));
			preempt = () => setTick((value) => value + 1);
			renders.push(`${pending}:${source === null ? 'ready' : 'staged'}`);
			return universalValue(TABLE_PLAN, [
				universalTry(
					() =>
						universalValue(CARD_PLAN, [
							'body',
							source === null ? 'ready body' : use(source),
							pending ? 'transition pending' : 'transition ready',
							noop,
							'body',
						]),
					() => universalValue(CARD_PLAN, ['fallback', 'loading', 'meta', noop, 'pending']),
				),
			]);
		});
		const block = blockColumn<Record<string, never>>();

		await block.render(Boundary, {});
		const pending = deferred<string>();
		begin(pending.promise);
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		expect(paint(block.main.commits).tree).toContain('ready body');

		preempt();
		await block.settle(Promise.resolve());
		await block.settle(block.background.flushTransport());
		expect(paint(block.main.commits).tree).toContain('loading');

		pending.resolve('urgent reveal');
		await pending.promise;
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());
		await flushMicrotasks();
		await block.settle(block.background.flushTransport());

		expect(paint(block.main.commits).tree).toContain('urgent reveal');
		expect(renders.at(-1)).toBe('false:staged');
	});

	it('runs ordinary compiled keyed row hooks with inferred and explicit dependencies', async () => {
		const metadata = Symbol.for('octane.universal.component');
		// This Vitest project compiles with HMR. Its wrapper must stay conservative
		// because a hot replacement may add hooks; the hmr:false compiler test pins
		// the production page's hookScope:false proof.
		expect(
			(BlockScopedRowsFixture as never as Record<PropertyKey, unknown>)[metadata],
		).toMatchObject({
			hookScope: true,
		});
		expect((BlockScopedRow as never as Record<PropertyKey, unknown>)[metadata]).toMatchObject({
			hookScope: true,
		});

		const lifecycle: string[] = [];
		const observations: string[] = [];
		const movedObservations: string[] = [];
		const log = (entry: string): void => void lifecycle.push(entry);
		const observe = (entry: string): void => void observations.push(entry);
		const observeMoved = (entry: string): void => void movedObservations.push(entry);
		const one = { id: 1, label: 'one' };
		const two = { id: 2, label: 'two' };
		const block = blockColumn<BlockScopedRowsProps>();
		const component = BlockScopedRowsFixture as never as LynxComponent<BlockScopedRowsProps>;
		await block.render(component, { rows: [one, two], log, observe });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['effect:one:quiet', 'effect:two:quiet']);
		expect(observations).toEqual(['page', 'row:1', 'row:2']);
		observations.length = 0;

		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('one-loud');
		expect(observations).toEqual(['row:1']);
		expect(lifecycle).toEqual([
			'effect:one:quiet',
			'effect:two:quiet',
			'cleanup:one:quiet',
			'effect:one:loud',
		]);

		await block.render(component, { rows: [two, one], log, observe: observeMoved });
		await flushMicrotasks();
		const reordered = paint(block.main.commits).tree;
		expect(reordered.indexOf('two-quiet')).toBeLessThan(reordered.indexOf('one-loud'));
		expect(lifecycle).toHaveLength(4);

		observations.length = 0;
		movedObservations.length = 0;
		deliverTo(block, rowListener(block.main.commits, 1));
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		expect(observations).toEqual([]);
		expect(movedObservations).toEqual(['row:1']);
		expect(paint(block.main.commits).tree).toContain('one-quiet');

		await block.render(component, { rows: [two], log, observe: observeMoved });
		await flushMicrotasks();
		expect(lifecycle.at(-1)).toBe('cleanup:one:quiet');

		await block.render(component, { rows: [two, one], log, observe: observeMoved });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('one-quiet');
		expect(lifecycle.at(-1)).toBe('effect:one:quiet');

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual(['cleanup:two:quiet', 'cleanup:one:quiet']);
	});

	it('propagates context updates through keyed moves without resetting row state', async () => {
		const Theme = createContext('default');
		const lifecycle: string[] = [];
		const one = { id: 1, label: 'one' };
		const two = { id: 2, label: 'two' };

		interface ContextRowProps {
			readonly row: TableRow;
		}
		const ContextRow = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function ContextRow({ row }: ContextRowProps) {
				const theme = useContext(Theme);
				const [loud, setLoud] = useState(false);
				useEffect(
					() => {
						lifecycle.push(`effect:${row.id}:${theme}`);
						return () => lifecycle.push(`cleanup:${row.id}:${theme}`);
					},
					[theme],
					'theme',
				);
				return universalValue(ROW_PLAN, [
					'row',
					String(row.id),
					() => setLoud((value) => !value),
					`${row.label}:${theme}:${loud ? 'loud' : 'quiet'}`,
				]);
			},
		);

		interface ContextPageProps {
			readonly rows: readonly TableRow[];
			readonly theme: string;
		}
		const ContextPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ rows, theme }: ContextPageProps) =>
				universalContext(
					Theme,
					theme,
					universalValue(TABLE_PLAN, [
						universalFor(
							rows,
							(row) => row.id,
							(row) => universalComponent(LYNX_TRANSPORT_RENDERER, ContextRow, { row }),
						),
					]),
				),
		);

		const block = blockColumn<ContextPageProps>();
		await block.render(ContextPage as LynxComponent<ContextPageProps>, {
			rows: [one, two],
			theme: 'dark',
		});
		await flushMicrotasks();
		expect(lifecycle).toEqual(['effect:1:dark', 'effect:2:dark']);

		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('one:dark:loud');

		await block.render(ContextPage as LynxComponent<ContextPageProps>, {
			rows: [two, one],
			theme: 'light',
		});
		await flushMicrotasks();
		const moved = paint(block.main.commits).tree;
		expect(moved.indexOf('two:light:quiet')).toBeLessThan(moved.indexOf('one:light:loud'));
		expect(lifecycle).toEqual(
			expect.arrayContaining([
				'cleanup:1:dark',
				'cleanup:2:dark',
				'effect:1:light',
				'effect:2:light',
			]),
		);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual(
			expect.arrayContaining(['cleanup:1:light', 'cleanup:2:light']),
		);
	});
	it('adopts authored .tsrx context across keyed moves with dual-backend parity', async () => {
		const lifecycle: string[] = [];
		const one = { id: 1, label: 'one' };
		const two = { id: 2, label: 'two' };
		const component = BlockContextFixture as never as LynxComponent<BlockContextProps>;
		const universal = universalColumn(component);
		const block = blockColumn<BlockContextProps>();
		const props = (
			rows: BlockContextProps['rows'],
			theme: string,
			log: (entry: string) => void,
		): BlockContextProps => ({ rows, theme, log });

		await universal.render(props([one, two], 'dark', noop));
		await block.render(
			component,
			props([one, two], 'dark', (entry) => lifecycle.push(entry)),
		);
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		expect(lifecycle).toEqual(['effect:1:dark', 'effect:2:dark']);

		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('one:dark:loud');

		const ignoredOne = { id: 1, label: 'ignored one' };
		const ignoredTwo = { id: 2, label: 'ignored two' };
		await universal.render(props([ignoredOne, ignoredTwo], 'dark', noop));
		await block.render(
			component,
			props([ignoredOne, ignoredTwo], 'dark', (entry) => lifecycle.push(entry)),
		);
		await flushMicrotasks();
		expect(paint(universal.main.commits).tree).not.toContain('ignored');
		expect(paint(block.main.commits).tree).not.toContain('ignored');
		expect(paint(block.main.commits).tree).toContain('one:dark:loud');
		expect(lifecycle).toEqual(['effect:1:dark', 'effect:2:dark']);

		await universal.render(props([two, one], 'light', noop));
		await block.render(
			component,
			props([two, one], 'light', (entry) => lifecycle.push(entry)),
		);
		await flushMicrotasks();
		const universalMoved = paint(universal.main.commits).tree;
		const blockMoved = paint(block.main.commits).tree;
		expect(universalMoved.indexOf('two:light:quiet')).toBeLessThan(
			universalMoved.indexOf('one:light:quiet'),
		);
		expect(blockMoved.indexOf('two:light:quiet')).toBeLessThan(
			blockMoved.indexOf('one:light:loud'),
		);
		expect(lifecycle).toEqual(
			expect.arrayContaining([
				'cleanup:1:dark',
				'cleanup:2:dark',
				'effect:1:light',
				'effect:2:light',
			]),
		);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual(
			expect.arrayContaining(['cleanup:1:light', 'cleanup:2:light']),
		);
	});

	it('retains Activity state while visibility gates effects and native listeners', async () => {
		interface ActivityProps {
			readonly mode: 'visible' | 'hidden';
			readonly label: string;
		}
		const lifecycle: string[] = [];
		const activityRef: { current: unknown } = { current: null };
		const activityProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: {
				module: 'tests/ActivityChild.lynx.tsrx',
				index: 0,
				digest: 'activity-child',
			},
			refs: [{ node: 0, slot: 5 }],
		});
		let setTone!: (value: string) => void;
		const ActivityChild = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function ActivityChild({ label }: { readonly label: string }) {
				const [tone, updateTone] = useState('quiet', 'tone');
				setTone = updateTone;
				useLayoutEffect(
					() => {
						lifecycle.push(`layout:${label}:${tone}`);
						return () => lifecycle.push(`layout-cleanup:${label}:${tone}`);
					},
					[label, tone],
					'activity-layout',
				);
				useEffect(
					() => {
						lifecycle.push(`passive:${label}:${tone}`);
						return () => lifecycle.push(`passive-cleanup:${label}:${tone}`);
					},
					[label, tone],
					'activity-passive',
				);
				return lynxProgramValue(activityProgram, [
					'activity',
					label,
					'activity-meta',
					() => updateTone('tapped'),
					`${label}:${tone}`,
					activityRef,
				]);
			},
		);
		const ActivityPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function ActivityPage({ mode, label }: ActivityProps) {
				return universalValue(TABLE_PLAN, [
					universalActivity(mode, () =>
						universalComponent(LYNX_TRANSPORT_RENDERER, ActivityChild, { label }),
					),
				]);
			},
			{ hookScope: false },
		);
		const block = blockColumn<ActivityProps>(createLynxBlockCore({ templateRuns: () => false }));

		await block.render(ActivityPage as never, { mode: 'hidden', label: 'alpha' });
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		const visibility = () =>
			block.main.commits
				.map((commit) => commit.batch.commands.filter((command) => command.op === 'visibility'))
				.filter((commands) => commands.length !== 0)
				.map((commands) => {
					const states = new Set(commands.map((command) => command.state));
					expect(states.size).toBe(1);
					return commands[0]!.state;
				});
		const activityListener = (): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of block.main.commits) prepareLynxHostBatch(host, commit.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[1]!.children[0]!.children[0]!;
			const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
			if (resolved === null) throw new Error('the Activity child bound no event site');
			return resolved;
		};
		expect(visibility()).toEqual(['hidden']);
		expect(activityListener).toThrow();
		expect(activityRef.current).toBeNull();

		setTone('warm');
		await block.settle(Promise.resolve());
		await block.render(ActivityPage as never, { mode: 'hidden', label: 'beta' });
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		expect(paint(block.main.commits).tree).toContain('beta:warm');

		await block.render(ActivityPage as never, { mode: 'visible', label: 'beta' });
		await flushMicrotasks();
		expect(visibility()).toEqual(['hidden', 'visible']);
		expect(lifecycle).toEqual(['layout:beta:warm', 'passive:beta:warm']);
		const visibleHandle = activityRef.current;
		expect(visibleHandle).toMatchObject({ active: true, attached: true });
		const live = activityListener();
		deliverTo(block, live);
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('beta:tapped');

		await block.render(ActivityPage as never, { mode: 'hidden', label: 'beta' });
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual([
			'layout-cleanup:beta:tapped',
			'passive-cleanup:beta:tapped',
		]);
		expect(() => deliverTo(block, live)).toThrow(/listener/i);
		expect(activityRef.current).toBeNull();

		await block.render(ActivityPage as never, { mode: 'visible', label: 'gamma' });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('gamma:tapped');
		expect(lifecycle.slice(-2)).toEqual(['layout:gamma:tapped', 'passive:gamma:tapped']);
		expect(activityRef.current).toBe(visibleHandle);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual([
			'layout-cleanup:gamma:tapped',
			'passive-cleanup:gamma:tapped',
		]);
		expect(activityRef.current).toBeNull();
		expect(visibleHandle).toMatchObject({ active: false });
	});

	it('matches Universal host observations while an Activity is hidden and revealed', async () => {
		interface ActivityProps {
			readonly mode: 'visible' | 'hidden';
			readonly label: string;
		}
		const ActivityChild = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ label }: { readonly label: string }) =>
				universalValue(CARD_PLAN, ['activity', label, 'activity-meta', noop, label]),
		);
		const ActivityPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ mode, label }: ActivityProps) =>
				universalValue(TABLE_PLAN, [
					universalActivity(mode, () =>
						universalComponent(LYNX_TRANSPORT_RENDERER, ActivityChild, { label }),
					),
				]),
			{ hookScope: false },
		);
		const universal = universalColumn(ActivityPage as never);
		const block = blockColumn<ActivityProps>(createLynxBlockCore({ templateRuns: () => false }));

		for (const props of [
			{ mode: 'hidden', label: 'alpha' },
			{ mode: 'visible', label: 'beta' },
			{ mode: 'hidden', label: 'gamma' },
			{ mode: 'visible', label: 'delta' },
		] as const) {
			await universal.render(props);
			await block.render(ActivityPage as never, props);
			await flushMicrotasks();
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it('matches Universal host observations through pending and Suspense reveal', async () => {
		const pending = deferred<string>();
		const Primary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ value }: { readonly value: Promise<string> }) =>
				universalValue(CARD_PLAN, ['body', use(value), 'body-meta', noop, 'body']),
		);
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ value }: { readonly value: Promise<string> }) =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => universalComponent(LYNX_TRANSPORT_RENDERER, Primary, { value } as never),
						() =>
							universalValue(CARD_PLAN, ['pending', 'loading', 'pending-meta', noop, 'pending']),
					),
				]),
			{ hookScope: false },
		);
		const universal = universalColumn(Boundary as never);
		const block = blockColumn<{ readonly value: Promise<string> }>(
			createLynxBlockCore({ templateRuns: () => false }),
		);
		const props = { value: pending.promise };

		await universal.render(props);
		await block.render(Boundary as never, props);
		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));

		pending.resolve('ready');
		await pending.promise;
		await block.settle(Promise.resolve());
		await universal.render(props);
		const blockPaint = paint(block.main.commits);
		const universalPaint = paint(universal.main.commits);
		expect(blockPaint.tree).toBe(universalPaint.tree);
		expect(blockPaint.events).toBe(universalPaint.events);
		// The accepted reveal frame is atomic. Whether its new body handles are
		// listed before or after the removed fallback handles is not observable;
		// the complete create/destroy lifecycle still has to be identical.
		expect(unorderedHandleLifecycle(blockPaint.handles)).toBe(
			unorderedHandleLifecycle(universalPaint.handles),
		);
		expect(blockPaint.tree).toContain('ready');
	});

	it('retains a stateful portal across target moves and releases it only after acknowledgement', async () => {
		interface PortalProps {
			readonly target: LynxPublicHandle | null;
			readonly theme: string;
			readonly captureTargetA: (handle: LynxPublicHandle | null) => void;
			readonly captureTargetB: (handle: LynxPublicHandle | null) => void;
			readonly capturePortal: (handle: LynxPublicHandle | null) => void;
		}
		const Theme = createContext('missing');
		const lifecycle: string[] = [];
		const targetARefs: Array<LynxPublicHandle | null> = [];
		const targetBRefs: Array<LynxPublicHandle | null> = [];
		const portalRefs: Array<LynxPublicHandle | null> = [];
		const shellPlan = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { id: 'portal-page' },
			children: [
				{
					kind: 'host',
					type: 'view',
					props: { id: 'target-a' },
				},
				{
					kind: 'host',
					type: 'view',
					props: { id: 'target-b' },
				},
				{ kind: 'slot', slot: 0 },
			],
		});
		const shellProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...deriveLynxProgramIR(shellPlan.root as never)!,
			address: {
				module: 'tests/BlockPortalShell.lynx.tsrx',
				index: 0,
				digest: 'block-portal-shell',
			},
			refs: [
				{ node: 1, slot: 1 },
				{ node: 2, slot: 2 },
			],
		});
		registerUniversalProgram('tests/BlockPortalShell.lynx.tsrx', 0, {
			kind: 'program',
			slots: [],
			nodes: shellProgram.wire.nodes.length,
			values: [],
			events: [],
			ranges: [],
			bind: (() => {
				throw new Error('The portal shell fixture is mounted from its wire descriptor.');
			}) as never,
			wire: shellProgram.wire,
		});
		const portalProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: {
				module: 'tests/BlockPortalLeaf.lynx.tsrx',
				index: 0,
				digest: 'block-portal-leaf',
			},
			refs: [{ node: 0, slot: 5 }],
		});
		registerUniversalProgram('tests/BlockPortalLeaf.lynx.tsrx', 0, {
			kind: 'program',
			slots: [],
			nodes: portalProgram.wire.nodes.length,
			values: [],
			events: [],
			ranges: [],
			bind: (() => {
				throw new Error('The portal resident fixture is mounted from its wire descriptor.');
			}) as never,
			wire: portalProgram.wire,
		});
		const PortalLeaf = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function PortalLeaf({ capture }: { readonly capture: PortalProps['capturePortal'] }) {
				const theme = useContext(Theme);
				const [count, setCount] = useState(0, 'portal-count');
				useEffect(
					() => {
						lifecycle.push(`effect:${theme}:${count}`);
						return () => lifecycle.push(`cleanup:${theme}:${count}`);
					},
					[theme, count],
					'portal-effect',
				);
				return lynxProgramValue(portalProgram, [
					`portal-content ${theme}`,
					theme,
					'portal-meta',
					() => setCount((value) => value + 1),
					`${theme}:${count}`,
					capture,
				]) as never;
			},
		);
		const PortalPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			(props: PortalProps) =>
				universalContext(
					Theme,
					props.theme,
					lynxProgramValue(shellProgram, [
						props.target === null
							? null
							: createPortal(
									universalComponent(LYNX_TRANSPORT_RENDERER, PortalLeaf, {
										capture: props.capturePortal,
									}),
									props.target,
								),
						props.captureTargetA,
						props.captureTargetB,
					]) as never,
				),
			{ hookScope: false },
		);
		const captureTargetA = (handle: LynxPublicHandle | null) => void targetARefs.push(handle);
		const captureTargetB = (handle: LynxPublicHandle | null) => void targetBRefs.push(handle);
		const capturePortal = (handle: LynxPublicHandle | null) => void portalRefs.push(handle);
		const props = (target: LynxPublicHandle | null, theme: string): PortalProps => ({
			target,
			theme,
			captureTargetA,
			captureTargetB,
			capturePortal,
		});
		const block = blockColumn<PortalProps>(undefined, residentRunProgram, true);

		await block.render(PortalPage as never, props(null, 'warm'));
		const targetA = targetARefs.at(-1)!;
		const targetB = targetBRefs.at(-1)!;
		expect(targetA).toMatchObject({ active: true, attached: true, type: 'view' });
		expect(targetB).toMatchObject({ active: true, attached: true, type: 'view' });

		await block.render(PortalPage as never, props(targetA, 'warm'));
		await flushMicrotasks();
		const portalHandle = portalRefs.at(-1)!;
		expect(portalHandle).toMatchObject({ active: true, attached: true, type: 'view' });
		expect(lifecycle).toEqual(['effect:warm:0']);
		expect(paint(block.main.commits).tree).toContain('portal-content warm');

		await block.render(PortalPage as never, props(targetB, 'cool'));
		await flushMicrotasks();
		expect(portalRefs.at(-1)).toBe(portalHandle);
		expect(lifecycle).toEqual(['effect:warm:0', 'cleanup:warm:0', 'effect:cool:0']);
		const move = block.main.commits.at(-1)!.batch.commands;
		expect(move.filter((command) => command.op === 'destroy')).toHaveLength(0);
		expect(move.filter((command) => command.op === 'mount-template-run')).toHaveLength(0);
		expect(move.filter((command) => command.op === 'move')).toHaveLength(1);

		const portalListener = (): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of block.main.commits) prepareLynxHostBatch(host, commit.batch).apply();
			const target = papi.pages[0]!.children[0]!.children[1]!;
			const label = target.children[0]!.children[0]!;
			const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
			if (resolved === null) throw new Error('the portal child bound no event site');
			return resolved;
		};
		deliverTo(block, portalListener());
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('portal-content cool');
		expect(portalRefs.at(-1)).toBe(portalHandle);

		const lifecycleBeforeReject = [...lifecycle];
		const refCountBeforeReject = portalRefs.length;
		const removal = block.background.renderAsync(PortalPage as never, props(null, 'cool'));
		await flushMicrotasks();
		const rejectedCommit = block.main.commits.at(-1)!;
		block.main.reject(rejectedCommit, 'injected portal removal rejection');
		block.markPendingHandled();
		await expect(removal).rejects.toThrow('injected portal removal rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual(lifecycleBeforeReject);
		expect(portalRefs).toHaveLength(refCountBeforeReject);
		expect(portalHandle.active).toBe(true);

		await block.render(PortalPage as never, props(null, 'cool'));
		await flushMicrotasks();
		expect(portalRefs.at(-1)).toBeNull();
		expect(lifecycle.at(-1)).toBe('cleanup:cool:1');
		expect(portalHandle.active).toBe(false);
		const acceptedCommits = block.main.commits.filter((commit) => commit !== rejectedCommit);
		expect(paint(acceptedCommits).tree).not.toContain('portal-content');

		await block.settle(block.background.unmountAsync());
		expect(targetA.active).toBe(false);
		expect(targetB.active).toBe(false);
	});

	it('refuses two Block portal boundaries that claim the same target', async () => {
		interface PortalPairProps {
			readonly target: LynxPublicHandle | null;
			readonly captureTarget: (handle: LynxPublicHandle | null) => void;
			readonly second: boolean;
		}
		const targetRefs: Array<LynxPublicHandle | null> = [];
		const pairPlan = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			children: [
				{ kind: 'host', type: 'view' },
				{ kind: 'slot', slot: 0 },
				{ kind: 'slot', slot: 1 },
			],
		});
		const pairProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...deriveLynxProgramIR(pairPlan.root as never)!,
			address: {
				module: 'tests/BlockPortalPair.lynx.tsrx',
				index: 0,
				digest: 'block-portal-pair',
			},
			refs: [{ node: 1, slot: 2 }],
		});
		const leaf = (label: string) =>
			universalValue(CARD_PLAN, ['portal', label, 'meta', noop, label]);
		const Pair = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			(props: PortalPairProps) =>
				lynxProgramValue(pairProgram, [
					props.target === null ? null : createPortal(leaf('first'), props.target),
					props.target === null || !props.second
						? null
						: createPortal(leaf('second'), props.target),
					props.captureTarget,
				]) as never,
			{ hookScope: false },
		);
		const captureTarget = (handle: LynxPublicHandle | null) => void targetRefs.push(handle);
		const block = blockColumn<PortalPairProps>();
		await block.render(Pair as never, { target: null, captureTarget, second: false });
		const target = targetRefs.at(-1)!;
		const commits = block.main.commits.length;

		await expect(
			block.settle(
				block.background.renderAsync(Pair as never, { target, captureTarget, second: true }),
			),
		).rejects.toThrow(/one active portal boundary per Lynx target/);
		expect(block.main.commits).toHaveLength(commits);

		await block.render(Pair as never, { target, captureTarget, second: false });
		expect(paint(block.main.commits).tree).toContain('first');
	});

	it('retains a committed Suspense body while pending and reconnects its stateful owner', async () => {
		interface SuspenseProps {
			readonly pending: Promise<string> | null;
			readonly label: string;
		}
		const lifecycle: string[] = [];
		const counts = ['none', 'once', 'twice', 'thrice'] as const;
		const primaryRef: { current: unknown } = { current: null };
		const primaryProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: {
				module: 'tests/RetainedSuspensePrimary.lynx.tsrx',
				index: 0,
				digest: 'retained-suspense-primary',
			},
			refs: [{ node: 0, slot: 5 }],
		});
		const Primary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Primary({ pending, label }: SuspenseProps) {
				const [count, updateCount] = useState(0, 'primary-count');
				useLayoutEffect(
					() => {
						lifecycle.push(`layout:${label}:${count}`);
						return () => lifecycle.push(`layout-cleanup:${label}:${count}`);
					},
					[label, count],
					'primary-layout',
				);
				useEffect(
					() => {
						lifecycle.push(`passive:${label}:${count}`);
						return () => lifecycle.push(`passive-cleanup:${label}:${count}`);
					},
					[label, count],
					'primary-passive',
				);
				const value = pending === null ? label : use(pending);
				return lynxProgramValue(primaryProgram, [
					'primary',
					`${value}:${counts[count] ?? 'many'}`,
					'primary-meta',
					() => updateCount((previous) => previous + 1),
					'body',
					primaryRef,
				]) as never;
			},
		);
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			(props: SuspenseProps) =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => universalComponent(LYNX_TRANSPORT_RENDERER, Primary, props as never),
						() =>
							universalValue(CARD_PLAN, [
								'pending',
								'pending',
								'pending-meta',
								() => lifecycle.push('pending-tap'),
								'fallback',
							]),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<SuspenseProps>(createLynxBlockCore({ templateRuns: () => false }));

		await block.render(Boundary as never, { pending: null, label: 'ready' });
		await flushMicrotasks();
		const handle = primaryRef.current;
		expect(handle).toMatchObject({ active: true, attached: true });
		const primaryListener = cardRangeListener(block.main.commits, 0);
		deliverTo(block, primaryListener);
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('ready:once');

		const pending = deferred<string>();
		await block.render(Boundary as never, { pending: pending.promise, label: 'ready' });
		await flushMicrotasks();
		expect(primaryRef.current).toBeNull();
		expect(lifecycle.slice(-2)).toEqual(['layout-cleanup:ready:1', 'passive-cleanup:ready:1']);
		expect(() => deliverTo(block, primaryListener)).toThrow(/listener/i);
		deliverTo(block, cardRangeListener(block.main.commits, 1));
		expect(lifecycle.at(-1)).toBe('pending-tap');

		pending.resolve('settled');
		await pending.promise;
		await block.settle(Promise.resolve());
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('settled:once');
		expect(primaryRef.current).toBe(handle);
		expect(lifecycle.slice(-2)).toEqual(['layout:ready:1', 'passive:ready:1']);
		deliverTo(block, cardRangeListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('settled:twice');

		const abandoned = deferred<string>();
		await block.render(Boundary as never, { pending: abandoned.promise, label: 'ready' });
		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		const commitsAfterUnmount = block.main.commits.length;
		expect(primaryRef.current).toBeNull();
		expect(handle).toMatchObject({ active: false });
		abandoned.resolve('too late');
		await abandoned.promise;
		await flushMicrotasks();
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(commitsAfterUnmount);
	});

	it('publishes no suspended attempt before fallback acknowledgement or after rejection', async () => {
		const pending = deferred<string>();
		const lifecycle: string[] = [];
		const primaryRef: { current: unknown } = { current: null };
		const primaryProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: {
				module: 'tests/RejectedSuspensePrimary.lynx.tsrx',
				index: 0,
				digest: 'rejected-suspense-primary',
			},
			refs: [{ node: 0, slot: 5 }],
		});
		const Primary = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			useEffect(
				() => {
					lifecycle.push('effect');
					return () => lifecycle.push('cleanup');
				},
				[],
				'rejected-suspense-effect',
			);
			const value = use(pending.promise);
			return lynxProgramValue(primaryProgram, [
				'primary',
				value,
				'primary-meta',
				() => lifecycle.push('primary-tap'),
				'body',
				primaryRef,
			]) as never;
		});
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => universalComponent(LYNX_TRANSPORT_RENDERER, Primary, {}),
						() =>
							universalValue(CARD_PLAN, [
								'pending',
								'pending',
								'pending-meta',
								() => lifecycle.push('pending-tap'),
								'fallback',
							]),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		const rejected = block.background.renderAsync(Boundary as never, {});
		rejected.catch(() => undefined);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		expect(lifecycle).toEqual([]);
		expect(primaryRef.current).toBeNull();
		const early = cardRangeListener(block.main.commits, 0);
		expect(() => deliverTo(block, early)).toThrow(/version|listener/i);

		pending.resolve('accepted later');
		await pending.promise;
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		block.main.reject(block.main.commits[0]!, 'injected Suspense fallback rejection');
		await expect(rejected).rejects.toThrow('injected Suspense fallback rejection');
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		expect(lifecycle).toEqual([]);
		expect(primaryRef.current).toBeNull();

		await block.render(Boundary as never, {});
		await flushMicrotasks();
		expect(paint(block.main.commits.slice(1)).tree).toContain('accepted later');
		expect(lifecycle).toEqual(['effect']);
		expect(primaryRef.current).toMatchObject({ active: true, attached: true });
	});

	it('pierces a retained keyed parent when a nested Suspense boundary settles', async () => {
		const pending = deferred<string>();
		const rows = Object.freeze([{ id: 1 }]);
		const NestedBoundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			({ promise }: { readonly promise: Promise<string> }) =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => universalValue(CARD_PLAN, ['body', use(promise), 'meta', noop, 'body']),
						() => universalValue(CARD_PLAN, ['pending', 'nested pending', 'meta', noop, 'pending']),
					),
				]),
			{ hookScope: false },
		);
		const Page = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalFor(
						rows,
						(row) => row.id,
						() =>
							universalComponent(LYNX_TRANSPORT_RENDERER, NestedBoundary, {
								promise: pending.promise,
							}),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Page as never, {});
		expect(paint(block.main.commits).tree).toContain('nested pending');
		pending.resolve('nested ready');
		await pending.promise;
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('nested ready');
		expect(paint(block.main.commits).tree).not.toContain('nested pending');
	});

	it('routes a rejected suspension from pending to catch', async () => {
		const pending = deferred<string>();
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => universalValue(CARD_PLAN, ['body', use(pending.promise), 'meta', noop, 'body']),
						() => universalValue(CARD_PLAN, ['pending', 'loading', 'meta', noop, 'pending']),
						(error) =>
							universalValue(CARD_PLAN, ['catch', (error as Error).message, 'meta', noop, 'catch']),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Boundary as never, {});
		expect(paint(block.main.commits).tree).toContain('loading');
		pending.reject(new Error('asset failed'));
		await pending.promise.catch(() => undefined);
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('asset failed');
		expect(paint(block.main.commits).tree).not.toContain('loading');
	});

	it('commits a synchronous catch arm and retries it only after reset', async () => {
		let reset!: () => void;
		let fail = true;
		let bodyRuns = 0;
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => {
							bodyRuns++;
							if (fail) throw new Error('expected failure');
							return universalValue(ROW_PLAN, ['body', 'recovered', noop, 'body']);
						},
						null,
						(error, retry) => {
							reset = retry;
							return universalValue(ROW_PLAN, ['catch', (error as Error).message, noop, 'catch']);
						},
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		await block.render(Boundary as never, {});
		expect(paint(block.main.commits).tree).toContain('expected failure');
		expect(bodyRuns).toBe(1);
		await block.render(Boundary as never, {});
		expect(bodyRuns).toBe(1);

		fail = false;
		reset();
		await block.settle(Promise.resolve());
		expect(bodyRuns).toBe(2);
		expect(paint(block.main.commits).tree).toContain('recovered');
	});

	it('does not publish a caught error from a rejected host frame', async () => {
		let fail = true;
		let bodyRuns = 0;
		const Boundary = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalTry(
						() => {
							bodyRuns++;
							if (fail) throw new Error('abandoned error');
							return universalValue(ROW_PLAN, ['body', 'healthy', noop, 'body']);
						},
						null,
						(error) => universalValue(ROW_PLAN, ['catch', (error as Error).message, noop, 'catch']),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn<Record<string, never>>(
			createLynxBlockCore({ templateRuns: () => false }),
		);

		const rejected = block.background.renderAsync(Boundary as never, {});
		rejected.catch(() => undefined);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		block.main.reject(block.main.commits[0]!, 'injected catch rejection');
		await expect(rejected).rejects.toThrow('injected catch rejection');

		fail = false;
		await block.render(Boundary as never, {});
		expect(bodyRuns).toBe(2);
		expect(paint(block.main.commits.slice(1)).tree).toContain('healthy');
		expect(paint(block.main.commits.slice(1)).tree).not.toContain('abandoned error');
	});

	it('publishes no Activity effect, ref, or listener from a rejected mount', async () => {
		const lifecycle: string[] = [];
		const activityRef: { current: unknown } = { current: null };
		const activityProgram = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...CARD_PROGRAM_IR,
			address: {
				module: 'tests/RejectedActivityChild.lynx.tsrx',
				index: 0,
				digest: 'rejected-activity-child',
			},
			refs: [{ node: 0, slot: 5 }],
		});
		const ActivityChild = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, () => {
			useEffect(
				() => {
					lifecycle.push('effect');
					return () => lifecycle.push('cleanup');
				},
				[],
				'rejected-activity-effect',
			);
			return lynxProgramValue(activityProgram, [
				'activity',
				'visible',
				'activity-meta',
				() => lifecycle.push('tap'),
				'visible',
				activityRef,
			]);
		});
		const ActivityPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			() =>
				universalValue(TABLE_PLAN, [
					universalActivity('visible', () =>
						universalComponent(LYNX_TRANSPORT_RENDERER, ActivityChild, {}),
					),
				]),
			{ hookScope: false },
		);
		const block = blockColumn(createLynxBlockCore({ templateRuns: () => false }));

		const rejected = block.background.renderAsync(ActivityPage as never, {});
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		expect(lifecycle).toEqual([]);
		expect(activityRef.current).toBeNull();
		const pendingListener = (() => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			prepareLynxHostBatch(host, block.main.commits[0]!.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[1]!.children[0]!.children[0]!;
			return resolveLynxHostNativeEvent(host, [...label.events.values()][0])!;
		})();
		expect(() => deliverTo(block, pendingListener)).toThrow(/version|listener/i);

		block.main.reject(block.main.commits[0]!, 'injected Activity mount rejection');
		await expect(rejected).rejects.toThrow('injected Activity mount rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		expect(activityRef.current).toBeNull();

		await block.render(ActivityPage as never, {});
		await flushMicrotasks();
		expect(lifecycle).toEqual(['effect']);
		expect(activityRef.current).toMatchObject({ active: true, attached: true });
		const acceptedListener = (() => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			prepareLynxHostBatch(host, block.main.commits[1]!.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[1]!.children[0]!.children[0]!;
			return resolveLynxHostNativeEvent(host, [...label.events.values()][0])!;
		})();
		deliverTo(block, acceptedListener);
		expect(lifecycle).toEqual(['effect', 'tap']);
	});

	it('replaces @if and @switch branches with isolated state, effects, and listeners', async () => {
		const ALTERNATE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'alternate' },
			children: [
				{
					kind: 'host',
					type: 'text',
					props: { class: 'alternate-label' },
					children: [{ kind: 'slot', slot: 0 }],
				},
			],
		});
		const lifecycle: string[] = [];

		interface BranchProps {
			readonly label: string;
		}
		const Visible = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Visible({ label }: BranchProps) {
				const [loud, setLoud] = useState(false);
				useEffect(
					() => {
						lifecycle.push(`mount:${label}`);
						return () => lifecycle.push(`cleanup:${label}`);
					},
					[],
					'branch-lifetime',
				);
				return universalValue(ROW_PLAN, [
					'branch',
					label,
					() => setLoud((value) => !value),
					`${label}:${loud ? 'loud' : 'quiet'}`,
				]);
			},
		);

		interface BranchPageProps {
			readonly mode: 'then' | 'else' | 'none' | 'case' | 'default';
			readonly label: string;
		}
		const BranchPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function BranchPage({ mode, label }: BranchPageProps) {
				const region =
					mode === 'then' || mode === 'else' || mode === 'none'
						? universalIf(
								mode === 'then',
								() =>
									universalComponent(LYNX_TRANSPORT_RENDERER, Visible, {
										label,
									}),
								mode === 'none' ? null : () => universalValue(ALTERNATE_PLAN, ['alternate']),
							)
						: universalSwitch(
								mode === 'case' ? 'known' : 'missing',
								[
									[
										'known',
										() =>
											universalComponent(LYNX_TRANSPORT_RENDERER, Visible, {
												label,
											}),
									],
								],
								() => universalValue(ALTERNATE_PLAN, ['default']),
							);
				return universalValue(TABLE_PLAN, [region]);
			},
		);

		const block = blockColumn<BranchPageProps>();
		await block.render(BranchPage as never, { mode: 'then', label: 'alpha' });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:alpha']);
		const departed = rowListener(block.main.commits, 0);
		deliverTo(block, departed);
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('alpha:loud');

		await block.render(BranchPage as never, { mode: 'then', label: 'beta' });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('beta:loud');
		expect(lifecycle).toEqual(['mount:alpha']);

		await block.render(BranchPage as never, { mode: 'else', label: 'beta' });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('alternate');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha']);
		expect(() => deliverTo(block, departed)).toThrow(/listener/i);

		await block.render(BranchPage as never, { mode: 'none', label: 'beta' });
		expect(paint(block.main.commits).tree).not.toContain('alternate');

		await block.render(BranchPage as never, { mode: 'case', label: 'gamma' });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('gamma:quiet');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha', 'mount:gamma']);

		await block.render(BranchPage as never, { mode: 'default', label: 'gamma' });
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('default');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha', 'mount:gamma', 'cleanup:gamma']);

		await block.settle(block.background.unmountAsync());
	});
	it('adopts state-driven @if and @switch replay from an authored .tsrx module', async () => {
		const block = blockColumn<Record<string, never>>();
		const component = BlockStateBranchesFixture as never as LynxComponent<Record<string, never>>;

		await block.render(component, {});
		expect(paint(block.main.commits).tree).toContain('if:then');
		expect(paint(block.main.commits).tree).toContain('switch:default');

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('if:else');
		expect(paint(block.main.commits).tree).toContain('switch:case');

		deliverTo(block, boundListener(block.main.commits));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('if:else');
		expect(paint(block.main.commits).tree).toContain('switch:default');
		expect(paint(block.main.commits).tree).not.toContain('switch:case');
	});
	it('adopts an authored .tsrx @if branch without resetting its surviving component', async () => {
		const lifecycle: string[] = [];
		const block = blockColumn<BlockConditionalProps>();
		const component = BlockConditionalFixture as never as LynxComponent<BlockConditionalProps>;

		const initial: BlockConditionalProps = {
			show: true,
			label: 'alpha',
			log: (entry) => lifecycle.push(entry),
		};
		const rejected = block.background.renderAsync(component, initial);
		await flushMicrotasks();
		block.main.reject(block.main.commits[0]!, 'injected conditional mount rejection');
		await expect(rejected).rejects.toThrow('injected conditional mount rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		const accepted = () => block.main.commits.slice(1);
		await block.render(component, initial);
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('alpha:quiet');
		expect(lifecycle).toEqual(['mount:alpha']);

		const departed = rowListener(accepted(), 0);
		deliverTo(block, departed);
		await block.settle(Promise.resolve());
		expect(paint(accepted()).tree).toContain('alpha:loud');

		await block.render(component, {
			show: true,
			label: 'beta',
			log: (entry) => lifecycle.push(entry),
		});
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('beta:loud');
		expect(lifecycle).toEqual(['mount:alpha']);

		await block.render(component, {
			show: false,
			label: 'beta',
			log: (entry) => lifecycle.push(entry),
		});
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('hidden:beta');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha']);
		expect(() => deliverTo(block, departed)).toThrow(/listener/i);

		await block.render(component, {
			show: true,
			label: 'gamma',
			log: (entry) => lifecycle.push(entry),
		});
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('gamma:quiet');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha', 'mount:gamma']);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha', 'mount:gamma', 'cleanup:gamma']);
	});
	it('adopts an authored .tsrx @switch branch with isolated retry and state', async () => {
		const lifecycle: string[] = [];
		const component = BlockSwitchFixture as never as LynxComponent<BlockSwitchProps>;
		const block = blockColumn<BlockSwitchProps>();
		const universal = universalColumn(component);
		const props = (mode: BlockSwitchProps['mode'], label: string): BlockSwitchProps => ({
			mode,
			label,
			log: (entry) => lifecycle.push(entry),
		});

		const initial = props('case', 'alpha');
		const rejected = block.background.renderAsync(component as never, initial);
		await flushMicrotasks();
		block.main.reject(block.main.commits[0]!, 'injected switch mount rejection');
		await expect(rejected).rejects.toThrow('injected switch mount rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);

		const accepted = () => block.main.commits.slice(1);
		await universal.render({ ...initial, log: noop });
		await block.render(component, initial);
		await flushMicrotasks();
		expect(paint(accepted()).tree).toBe(paint(universal.main.commits).tree);
		expect(lifecycle).toEqual(['mount:alpha']);

		const departed = rowListener(accepted(), 0);
		deliverTo(block, departed);
		await block.settle(Promise.resolve());
		expect(paint(accepted()).tree).toContain('alpha:loud');

		await block.render(component, props('case', 'beta'));
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('beta:loud');
		expect(lifecycle).toEqual(['mount:alpha']);

		const fallback = props('default', 'beta');
		await universal.render({ ...fallback, log: noop });
		await block.render(component, fallback);
		await flushMicrotasks();
		expect(paint(accepted()).tree).toBe(paint(universal.main.commits).tree);
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha']);
		expect(() => deliverTo(block, departed)).toThrow(/listener/i);

		const remount = props('case', 'gamma');
		await universal.render({ ...remount, log: noop });
		await block.render(component, remount);
		await flushMicrotasks();
		expect(paint(accepted()).tree).toBe(paint(universal.main.commits).tree);
		expect(paint(accepted()).tree).toContain('gamma:quiet');
		expect(lifecycle).toEqual(['mount:alpha', 'cleanup:alpha', 'mount:gamma']);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.at(-1)).toBe('cleanup:gamma');
	});

	it('keeps row-state discovery constant as unrelated stateful rows grow', async () => {
		const component = BlockScopedRowsFixture as never as LynxComponent<BlockScopedRowsProps>;
		for (const count of [2, 128]) {
			const observations: string[] = [];
			const core = createLynxBlockCore();
			const block = blockColumn<BlockScopedRowsProps>(core);
			const rows = Array.from({ length: count }, (_, index) => ({
				id: index + 1,
				label: `row ${index + 1}`,
			}));
			await block.render(component, {
				rows,
				log: noop,
				observe: (entry) => observations.push(entry),
			});
			observations.length = 0;
			const before = core.counters();

			deliverTo(block, rowListener(block.main.commits, 0));
			await block.settle(Promise.resolve());

			const after = core.counters();
			expect(observations, `${count} rows`).toEqual(['row:1']);
			expect(
				{
					lookups: after.blockLookups - before.blockLookups,
					commands: after.commands - before.commands,
				},
				`${count} rows`,
			).toEqual({ lookups: 1, commands: 3 });
			const tree = paint(block.main.commits).tree;
			expect(tree).toContain('row #0-loud');
			expect(tree).toContain('ROW #0:loud');
			expect(tree).toContain('quiet');
			await block.settle(block.background.unmountAsync());
		}
	});

	it('skips a compiler-certified stable range when unrelated page state changes', async () => {
		interface DependencyProps {
			readonly rows: readonly TableRow[];
			readonly shared: string;
			readonly observe: (entry: string) => void;
		}
		interface DependencyRowProps {
			readonly row: TableRow;
			readonly shared: string;
			readonly observe: (entry: string) => void;
		}
		const rowsFor = (count: number): readonly TableRow[] =>
			Array.from({ length: count }, (_, index) => ({
				id: index + 1,
				label: `row ${index + 1}`,
			}));

		for (const [count, certified] of [
			[2, true],
			[128, true],
			[4, false],
		] as const) {
			const observations: string[] = [];
			let pageCalls = 0;
			let keyCalls = 0;
			let bodyCalls = 0;
			let rowCalls = 0;
			let setHeading: ((value: string | ((previous: string) => string)) => void) | undefined;
			const Row = defineUniversalComponent(
				LYNX_TRANSPORT_RENDERER,
				(props: DependencyRowProps) => {
					rowCalls++;
					props.observe(`row:${props.row.id}`);
					return universalValue(ROW_PLAN, [
						'row',
						String(props.row.id),
						noop,
						`${props.row.label}:${props.shared}`,
					]);
				},
				{ hookScope: false },
			);
			const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, (props: DependencyProps) => {
				pageCalls++;
				props.observe('page');
				const [heading, updateHeading] = useState('ready', 'heading');
				setHeading = updateHeading;
				return universalValue(RANGE_DEPENDENCY_PAGE_PLAN, [
					heading,
					universalFor(
						props.rows,
						(row: TableRow) => {
							keyCalls++;
							return row.id;
						},
						(row: TableRow) => {
							bodyCalls++;
							props.observe(`body:${row.id}`);
							return universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'shared', props.shared],
									['set', 'observe', props.observe],
								]),
							);
						},
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
						undefined,
						certified ? [props.shared, props.observe] : undefined,
					),
				]);
			});
			const rows = rowsFor(count);
			const observe = (entry: string): void => void observations.push(entry);
			const core = createLynxBlockCore();
			const block = blockColumn<DependencyProps>(core);
			await block.render(Scene as LynxComponent<DependencyProps>, {
				rows,
				shared: 'shared',
				observe,
			});
			observations.length = 0;
			keyCalls = 0;
			bodyCalls = 0;
			rowCalls = 0;
			const before = core.counters();

			setHeading!('changed');
			await block.settle(Promise.resolve());

			const after = core.counters();
			const label = `${count} rows, ${certified ? 'certified' : 'unproved'}`;
			const discovered = certified ? 0 : count;
			expect(pageCalls, label).toBe(2);
			expect({ keyCalls, bodyCalls, rowCalls }, label).toEqual({
				keyCalls: discovered,
				bodyCalls: discovered,
				rowCalls: 0,
			});
			expect(observations, label).toEqual([
				'page',
				...Array.from({ length: discovered }, (_, index) => `body:${index + 1}`),
			]);
			expect(
				{
					lookups: after.blockLookups - before.blockLookups,
					commands: after.commands - before.commands,
				},
				label,
			).toEqual({ lookups: 1, commands: 1 });
			expect(paint(block.main.commits).tree).toContain('changed');
			if (certified && count === 2) {
				observations.length = 0;
				keyCalls = 0;
				bodyCalls = 0;
				rowCalls = 0;
				await block.render(Scene as LynxComponent<DependencyProps>, {
					rows,
					shared: 'next',
					observe,
				});
				expect({ keyCalls, bodyCalls, rowCalls }).toEqual({
					keyCalls: count,
					bodyCalls: count,
					rowCalls: count,
				});
				expect(paint(block.main.commits).tree).toContain('row #0:next');
			}
			await block.settle(block.background.unmountAsync());
		}
	});

	it('rolls a rejected row-local frame back and recovers its queued state on retry', async () => {
		vi.useFakeTimers();
		try {
			const lifecycle: string[] = [];
			const observations: string[] = [];
			const one = { id: 1, label: 'one' };
			const props: BlockScopedRowsProps = {
				rows: [one],
				log: (entry) => void lifecycle.push(entry),
				observe: (entry) => void observations.push(entry),
			};
			const component = BlockScopedRowsFixture as never as LynxComponent<BlockScopedRowsProps>;
			const block = blockColumn<BlockScopedRowsProps>();

			const mounting = block.background.renderAsync(component as never, props);
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(1);
			block.main.acknowledge(block.main.commits[0]!);
			await mounting;
			await flushMicrotasks();
			expect(lifecycle).toEqual(['effect:one:quiet']);

			observations.length = 0;
			deliverTo(block, rowListener(block.main.commits, 0));
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(2);
			expect(observations).toEqual(['row:1']);
			block.main.reject(block.main.commits[1]!, 'injected row-local rejection');
			await flushMicrotasks();
			expect(lifecycle).toEqual(['effect:one:quiet']);
			expect(paint([block.main.commits[0]!]).tree).toContain('one-quiet');

			observations.length = 0;
			const retried = block.background.renderAsync(component as never, {
				...props,
				rows: [{ ...one }],
			});
			await flushMicrotasks();
			expect(block.main.commits).toHaveLength(3);
			block.main.acknowledge(block.main.commits[2]!);
			await retried;
			await flushMicrotasks();
			expect(observations).toEqual(['page', 'row:1']);
			expect(paint([block.main.commits[0]!, block.main.commits[2]!]).tree).toContain('one-loud');
			expect(lifecycle).toEqual(['effect:one:quiet', 'cleanup:one:quiet', 'effect:one:loud']);

			const unmounting = block.background.unmountAsync();
			await flushMicrotasks();
			block.main.acknowledge(block.main.commits[3]!);
			await unmounting;
			await flushMicrotasks();
			expect(lifecycle.at(-1)).toBe('cleanup:one:loud');
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});

	it('mounts a compiler-proven hooked row in its own semantic scope', async () => {
		const block = blockColumn<TableProps>();
		const HookedRow = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function HookedRow(props: { readonly row: TableRow }) {
				const [label] = useState(props.row.label);
				return universalValue(ROW_PLAN, ['row', String(props.row.id), noop, label]);
			},
			{ hookScope: true },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								HookedRow,
								universalProps([['set', 'row', row]]),
							),
					),
				]);
			},
			{ hookScope: false },
		);

		await block.render(Listed as LynxComponent<TableProps>, table([1], undefined, noop));
		expect(paint(block.main.commits).tree).toContain('row #0');
	});

	it('fails closed when compiler metadata falsely proves a hooked row stateless', async () => {
		const Contradiction = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Contradiction(props: { readonly row: TableRow }) {
				const [label] = useState(props.row.label);
				return universalValue(ROW_PLAN, ['row', String(props.row.id), noop, label]);
			},
			{ hookScope: false },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Contradiction,
								universalProps([['set', 'row', row]]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const block = blockColumn<TableProps>();

		await expect(
			block.render(Listed as LynxComponent<TableProps>, table([1], undefined, noop)),
		).rejects.toThrow(/Contradiction.*hookScope: false/s);
		expect(block.main.commits).toHaveLength(0);
	});

	it('retains keyed row state and identities through reorder, then disposes a departed key', async () => {
		const lifecycle: string[] = [];
		const setters = new Map<number, (value: string) => void>();
		const refs = new Map<number, { current: number }>();
		const callbacks = new Map<number, () => void>();
		const memos = new Map<number, { readonly id: number }>();
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow }) {
				const [tone, setTone] = useState('quiet', 'tone');
				const renders = useRef(0, 'renders');
				const onTap = useCallback(() => setTone('loud'), [], 'onTap');
				const memo = useMemo(() => ({ id: props.row.id }), [props.row.id], 'memo');
				renders.current++;
				setters.set(props.row.id, setTone);
				refs.set(props.row.id, renders);
				callbacks.set(props.row.id, onTap);
				memos.set(props.row.id, memo);
				useEffect(
					() => {
						lifecycle.push(`mount:${props.row.label}`);
						return () => lifecycle.push(`cleanup:${props.row.label}`);
					},
					[props.row.id],
					'lifecycle',
				);
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					onTap,
					`${props.row.label}-${tone}`,
				]);
			},
			{ hookScope: true },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: { readonly rows: readonly TableRow[] }) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([['set', 'row', row]]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const one = { id: 1, label: 'one' };
		const two = { id: 2, label: 'two' };
		const block = blockColumn<{ readonly rows: readonly TableRow[] }>();

		await block.render(Listed as never, { rows: [one, two] });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:one', 'mount:two']);
		const oneRef = refs.get(1);
		const oneCallback = callbacks.get(1);
		const oneMemo = memos.get(1);
		const staleSetter = setters.get(1)!;

		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('one-loud');
		expect(paint(block.main.commits).tree).toContain('two-quiet');

		await block.render(Listed as never, { rows: [two, one] });
		await flushMicrotasks();
		const reordered = paint(block.main.commits).tree;
		expect(reordered.indexOf('two-quiet')).toBeLessThan(reordered.indexOf('one-loud'));
		expect(refs.get(1)).toBe(oneRef);
		expect(callbacks.get(1)).toBe(oneCallback);
		expect(memos.get(1)).toBe(oneMemo);
		expect(lifecycle).toEqual(['mount:one', 'mount:two']);

		await block.render(Listed as never, { rows: [two] });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:one', 'mount:two', 'cleanup:one']);
		const committed = block.main.commits.length;
		staleSetter('stale');
		await flushMicrotasks();
		block.acknowledgePending();
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(committed);
		expect(paint(block.main.commits).tree).toContain('two-quiet');

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:one', 'mount:two', 'cleanup:one', 'cleanup:two']);
	});

	it('settles a keyed row render-phase update before publishing its host values', async () => {
		let passes = 0;
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow }) {
				const [ready, setReady] = useState(false, 'ready');
				passes++;
				if (!ready) setReady(true);
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					noop,
					ready ? 'settled' : 'draft',
				]);
			},
			{ hookScope: true },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: { readonly rows: readonly TableRow[] }) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([['set', 'row', row]]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const block = blockColumn<{ readonly rows: readonly TableRow[] }>();

		await block.render(Listed as never, { rows: [{ id: 1, label: 'one' }] });
		expect(passes).toBe(2);
		expect(paint(block.main.commits).tree).toContain('settled');
		expect(paint(block.main.commits).tree).not.toContain('draft');
	});

	it('keeps conditional reducer slots and projects queued row actions through the getter', async () => {
		const totals = ['none', 'once', 'twice', 'thrice'] as const;
		let passes = 0;
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly extra: boolean }) {
				passes++;
				let lead = 'skipped';
				if (props.extra) {
					const [value] = useState('lead', 'lead');
					lead = value;
				}
				const [total, dispatch, getTotal] = useReducer(
					(value: number, amount: number) => value + amount,
					0,
					'total',
				);
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					() => {
						dispatch(1);
						dispatch(getTotal() + 1);
					},
					`${lead}-${totals[total] ?? 'many'}`,
				]);
			},
			{ hookScope: true },
		);
		interface ReducerListProps {
			readonly rows: readonly TableRow[];
			readonly extra: boolean;
		}
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: ReducerListProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'extra', props.extra],
								]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const rows = [{ id: 1, label: 'one' }];
		const block = blockColumn<ReducerListProps>();

		await block.render(Listed as never, { rows, extra: true });
		expect(passes).toBe(1);
		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('lead-thrice');
		expect(passes).toBe(2);

		await block.render(Listed as never, { rows, extra: false });
		expect(paint(block.main.commits).tree).toContain('skipped-thrice');
		await block.render(Listed as never, { rows, extra: true });
		expect(paint(block.main.commits).tree).toContain('lead-thrice');
	});

	it('matches Universal output for reducer, memo, and layout-effect components', async () => {
		interface HookProps {
			readonly label: string;
		}
		let initializerCalls = 0;
		const HookPage = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function HookPage(props: HookProps) {
				const [count] = useReducer(
					(value: number, amount: number) => value + amount,
					3,
					(value) => {
						initializerCalls++;
						return value * 2;
					},
					'hook-parity-reducer',
				);
				const value = useMemo(
					() => `${props.label}:${count}`,
					[props.label, count],
					'hook-parity-memo',
				);
				useLayoutEffect(() => undefined, [value], 'hook-parity-layout');
				return universalValue(CARD_PLAN, ['hooks', value, 'hooks-meta', noop, value]);
			},
		);
		const universal = universalColumn(HookPage as never);
		const block = blockColumn<HookProps>();

		for (const props of [{ label: 'alpha' }, { label: 'beta' }, { label: 'gamma' }] as const) {
			await universal.render(props);
			await block.render(HookPage as never, props);
			await flushMicrotasks();
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
		// Painted commits rank numeric identities instead of leaking allocator values;
		// the reducer's initialized `6` is therefore the first non-zero rank.
		expect(paint(block.main.commits).tree).toContain('gamma:#1');
		expect(initializerCalls).toBe(2);
	});

	it('publishes keyed row layout and passive phases only after host acknowledgement', async () => {
		const lifecycle: string[] = [];
		interface EffectListProps {
			readonly rows: readonly TableRow[];
			readonly label: string;
		}
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly label: string }) {
				useLayoutEffect(
					() => {
						lifecycle.push(`layout:${props.label}`);
						return () => lifecycle.push(`layout-cleanup:${props.label}`);
					},
					[props.label],
					'layout',
				);
				useEffect(
					() => {
						lifecycle.push(`passive:${props.label}`);
						return () => lifecycle.push(`passive-cleanup:${props.label}`);
					},
					[props.label],
					'passive',
				);
				return universalValue(ROW_PLAN, ['row', String(props.row.id), noop, props.label]);
			},
			{ hookScope: true },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: EffectListProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'label', props.label],
								]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const rows = [{ id: 1, label: 'one' }];
		const block = blockColumn<EffectListProps>();

		const mounting = block.background.renderAsync(Listed as never, {
			rows,
			label: 'alpha',
		});
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		block.acknowledgePending();
		await mounting;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['layout:alpha', 'passive:alpha']);

		const updating = block.background.renderAsync(Listed as never, {
			rows,
			label: 'beta',
		});
		await flushMicrotasks();
		expect(lifecycle).toEqual(['layout:alpha', 'passive:alpha']);
		block.acknowledgePending();
		await updating;
		await flushMicrotasks();
		expect(lifecycle).toEqual([
			'layout:alpha',
			'passive:alpha',
			'layout-cleanup:alpha',
			'layout:beta',
			'passive-cleanup:alpha',
			'passive:beta',
		]);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.slice(-2)).toEqual(['layout-cleanup:beta', 'passive-cleanup:beta']);
	});
	it('aborts keyed row drafts thrown as errors or thenables and preserves committed state for retry', async () => {
		interface RetryProps {
			readonly rows: readonly TableRow[];
			readonly failure: unknown;
		}
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly failure: unknown }) {
				const [tone, setTone] = useState('quiet', 'tone');
				if (props.failure !== null) throw props.failure;
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					() => setTone('loud'),
					`${props.row.label}-${tone}`,
				]);
			},
			{ hookScope: true },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: RetryProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'failure', props.failure],
								]),
							),
					),
				]);
			},
			{ hookScope: false },
		);
		const rows = [{ id: 1, label: 'one' }];
		const block = blockColumn<RetryProps>();
		await block.render(Listed as never, { rows, failure: null });
		deliverTo(block, rowListener(block.main.commits, 0));
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('one-loud');

		for (const failure of [new Error('row fault'), Promise.resolve('ready')]) {
			await expect(
				block.settle(block.background.renderAsync(Listed as never, { rows, failure } as never)),
			).rejects.toBe(failure);
			await block.render(Listed as never, { rows, failure: null });
			expect(paint(block.main.commits).tree).toContain('one-loud');
		}
	});

	it('runs a page passive effect after acknowledgement and cleans it up on change and unmount', async () => {
		const block = blockColumn();
		const lifecycle: string[] = [];
		const Subscribed = subscribedCard(lifecycle);
		const mounting = block.background.renderAsync(Subscribed as never, LADDER[0]!);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		expect(lifecycle).toEqual([]);

		block.acknowledgePending();
		await mounting;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['subscribe:alpha']);

		await block.render(Subscribed as never, { ...LADDER[0]!, label: 'beta' });
		expect(lifecycle).toEqual(['subscribe:alpha', 'unsubscribe:alpha', 'subscribe:beta']);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.at(-1)).toBe('unsubscribe:beta');
	});

	it('retries a pre-ACK rejected mount and publishes its passive effect only after acceptance', async () => {
		const block = blockColumn();
		const lifecycle: string[] = [];
		const Subscribed = subscribedCard(lifecycle);

		const rejected = block.background.renderAsync(Subscribed as never, LADDER[0]!);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(1);
		block.main.reject(block.main.commits[0]!, 'injected pre-ACK rejection');
		await expect(rejected).rejects.toThrow('injected pre-ACK rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);

		await block.render(Subscribed as LynxComponent<CardProps>, LADDER[0]!);
		await flushMicrotasks();
		expect(block.main.commits).toHaveLength(2);
		expect(lifecycle).toEqual(['subscribe:alpha']);
	});

	it('keeps accepted effects and handlers across a rejected update, then publishes one retry', async () => {
		const block = blockColumn();
		const lifecycle: string[] = [];
		const taps: string[] = [];
		const Subscribed = subscribedCard(lifecycle);
		const firstProps = { ...LADDER[0]!, onTap: () => taps.push('alpha') };
		const nextProps = { ...LADDER[1]!, onTap: () => taps.push('beta') };

		const first = block.background.renderAsync(Subscribed as never, firstProps);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[0]!);
		await first;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['subscribe:alpha']);

		const listener = boundListener([block.main.commits[0]!]);
		const rejected = block.background.renderAsync(Subscribed as never, nextProps);
		await flushMicrotasks();
		// Until main accepts the new frame, the painted tree still belongs to the
		// previous version and an event from it must see the previous closure.
		block.background.dispatchTransportEvent({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: block.main.commits[0]!.version,
			type: 'event',
			priority: listener.priority,
			deliveries: [{ listener: listener.listener, payload: null }],
		} as never);
		expect(taps).toEqual(['alpha']);
		block.main.reject(block.main.commits[1]!, 'injected update rejection');
		await expect(rejected).rejects.toThrow('injected update rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual(['subscribe:alpha']);
		block.background.dispatchTransportEvent({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: block.main.commits[0]!.version,
			type: 'event',
			priority: listener.priority,
			deliveries: [{ listener: listener.listener, payload: null }],
		} as never);
		expect(taps).toEqual(['alpha', 'alpha']);

		const retried = block.background.renderAsync(Subscribed as never, nextProps);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[2]!);
		await retried;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['subscribe:alpha', 'unsubscribe:alpha', 'subscribe:beta']);
	});

	it('keeps an ACKed update published when main reports a later host fault', async () => {
		const block = blockColumn();
		const lifecycle: string[] = [];
		const taps: string[] = [];
		const Subscribed = subscribedCard(lifecycle);
		const firstProps = { ...LADDER[0]!, onTap: () => taps.push('alpha') };
		const nextProps = { ...LADDER[1]!, onTap: () => taps.push('beta') };

		await block.render(Subscribed as LynxComponent<CardProps>, firstProps);
		await flushMicrotasks();
		const listener = boundListener([block.main.commits[0]!]);

		const faulted = block.background.renderAsync(Subscribed as never, nextProps);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[1]!, 'fault');
		await expect(faulted).rejects.toThrow('accepted host fault');
		await flushMicrotasks();
		expect(lifecycle).toEqual(['subscribe:alpha', 'unsubscribe:alpha', 'subscribe:beta']);

		block.background.dispatchTransportEvent({
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: block.main.commits[1]!.version,
			type: 'event',
			priority: listener.priority,
			deliveries: [{ listener: listener.listener, payload: null }],
		} as never);
		expect(taps).toEqual(['beta']);
	});

	it('restores a keyed range after pre-ACK rejection so its retry matches a fresh render', async () => {
		const block = blockColumn<TableProps>();
		const first = block.background.renderAsync(Table as never, table([1, 2, 3]));
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[0]!);
		await first;

		const next = table([3, 1, 4], 4);
		const rejected = block.background.renderAsync(Table as never, next);
		await flushMicrotasks();
		block.main.reject(block.main.commits[1]!, 'injected range rejection');
		await expect(rejected).rejects.toThrow('injected range rejection');

		const retried = block.background.renderAsync(Table as never, next);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[2]!);
		await retried;

		const fresh = blockColumn<TableProps>();
		await fresh.render(Table as LynxComponent<TableProps>, next);
		expect(paint([block.main.commits[0]!, block.main.commits[2]!] as never).tree).toEqual(
			paint(fresh.main.commits).tree,
		);
	});

	it('still refuses a page insertion effect because the Block core has no pre-mutation phase', async () => {
		const block = blockColumn();
		const Inserting = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Inserting({ label, detail, active, onTap }: CardProps) {
				useInsertionEffect(() => undefined, [], 'insert');
				return universalValue(CARD_PLAN, [
					active ? 'card active' : 'card',
					label,
					active ? 'card-meta on' : 'card-meta',
					onTap,
					detail,
				]);
			},
		);
		await expect(
			block.settle(block.background.renderAsync(Inserting as never, LADDER[0]!)),
		).rejects.toThrow(/Inserting.*insertion effect/s);
	});

	it('answers a context default when no provider overrides it', async () => {
		const block = blockColumn();
		const Theme = createContext('light');
		// Block supplies the same default lookup as an ordinary Universal owner chain.
		const Themed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Themed({ label, detail, active, onTap }: CardProps) {
				const theme = useContext(Theme);
				return universalValue(CARD_PLAN, [
					`card ${theme}`,
					label,
					active ? 'card-meta on' : 'card-meta',
					onTap,
					detail,
				]);
			},
		);
		await block.render(Themed as never, LADDER[0]!);
		expect(paint(block.main.commits).tree).toContain('card light');
	});

	it('names a template that is not rooted at a host element', async () => {
		const block = blockColumn();
		const TEXT_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, { kind: 'text', value: 'bare' });
		const Bare = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Bare() {
			return universalValue(TEXT_PLAN, []);
		});

		await expect(
			block.settle(block.background.renderAsync(Bare as never, LADDER[0]!)),
		).rejects.toThrow(/Bare.*rooted at a "text" node/s);
	});

	it('names what a component that was never compiled is missing', async () => {
		const block = blockColumn();
		const Plain = (() => null) as unknown as LynxComponent<CardProps>;
		await expect(
			block.settle(block.background.renderAsync(Plain as never, LADDER[0]!)),
		).rejects.toThrow(/did not return a compiled template/);
	});

	it('refuses a later render that returns a different template', async () => {
		const block = blockColumn();
		const OTHER_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Switching = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Switching(props: CardProps) {
				return props.active
					? universalValue(OTHER_PLAN, [])
					: universalValue(CARD_PLAN, [
							'card',
							props.label,
							'card-meta',
							props.onTap,
							props.detail,
						]);
			},
		);

		await block.render(Switching as LynxComponent<CardProps>, LADDER[0]!);
		await expect(
			block.settle(
				block.background.renderAsync(Switching as never, { ...LADDER[0]!, active: true }),
			),
		).rejects.toThrow(/different compiled template/);
	});
});

/**
 * Item 1c: the hole that holds a keyed range.
 *
 * The oracle is the one above, for the same reason — the same compiled
 * component through both cores, compared on the painted tree, the handle
 * journal and the event journal after every rung. What a range adds is that
 * the rungs are structural: rows arrive, move, change, leave, and the list
 * empties and refills, and each of those is a different path through
 * `fillForSlot` / `reconcileForSlot` / `clearForSlot`.
 */
describe('Lynx compiled component with a keyed range on the Block core', () => {
	it('retains the compiler range slot on structural commands before transport encoding', async () => {
		const emitted: UniversalHostCommand[] = [];
		const base = createLynxBlockCore();
		const observing: LynxBlockCore = {
			...base,
			flush() {
				const batch = base.flush();
				if (batch !== null) emitted.push(...batch.commands);
				return batch;
			},
		};
		const block = blockColumn<TableProps>(observing);

		await block.render(Table as LynxComponent<TableProps>, table([1, 2, 3]));
		const rangeRun = emitted.find(
			(command) => command.op === 'mount-template-run' && command.parent !== null,
		);
		expect(rangeRun).toBeDefined();
		// TABLE_PLAN's range is compiler slot 0 below physical host node 2. A
		// producer that guessed from the node address would report the wrong owner.
		expect(universalProgramRangeCommandSlot(rangeRun!)).toBe(0);

		emitted.length = 0;
		await block.render(Table as LynxComponent<TableProps>, table([3, 1, 2]));
		const moves = emitted.filter((command) => command.op === 'move');
		expect(moves).not.toHaveLength(0);
		expect(moves.map(universalProgramRangeCommandSlot)).toEqual(moves.map(() => 0));
	});

	it('paints what the universal core paints, at every step of a structural ladder', async () => {
		const universal = universalColumn(Table as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();

		for (const [step, props] of TABLE_LADDER.entries()) {
			await universal.render(props);
			await block.render(Table as LynxComponent<TableProps>, props);

			const left = paint(universal.main.commits);
			const right = paint(block.main.commits);
			expect(right.tree, `tree after step ${step}`).toBe(left.tree);
			expect(right.handles, `handles after step ${step}`).toBe(left.handles);
			expect(right.events, `events after step ${step}`).toBe(left.events);
		}

		// The ladder has to have painted rows, or every assertion above compared
		// two trees that agreed about nothing. Row text is not asserted literally
		// because the tree has had every integer replaced by its rank.
		const painted = paint(block.main.commits).tree;
		expect(painted).toContain('col-label');
		expect(painted.match(/"classes":"row"/g)).toHaveLength(1);
	});

	it('reconciles the range instead of re-mounting it', async () => {
		// The Block model's claim about a keyed list: a survivor keeps its hosts,
		// so a re-render that changes one row's label neither creates nor destroys
		// anything. `counters()` is where the core states that about itself.
		const core = createLynxBlockCore();
		const block = blockColumn<TableProps>(core);
		await block.render(Table as LynxComponent<TableProps>, table([1, 2, 3]));

		const step = async (props: TableProps) => {
			const before = core.counters();
			await block.render(Table as LynxComponent<TableProps>, props);
			const after = core.counters();
			return after.commands - before.commands;
		};

		// Selecting row 2 rewrites one row's class and nothing else, however many
		// rows the range holds.
		expect(await step(table([1, 2, 3], 2))).toBe(1);
		// A pure reorder writes no props: every survivor is patched with the values
		// it already holds, so the only commands are the moves the LIS could not
		// avoid — here one, because rows 1 and 2 stay in relative order.
		expect(await step(table([3, 1, 2], 2))).toBe(1);
		// And a re-render that produces the same list costs nothing at all.
		expect(await step(table([3, 1, 2], 2))).toBe(0);
	});

	it('routes a native delivery to the handler this render gave that row', async () => {
		const taps: string[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(`first ${id}`)),
		);

		const second = rowListener(block.main.commits, 1);
		deliverTo(block, second);
		expect(taps).toEqual(['first 2']);

		// A survivor keeps its hosts through a reorder, so this site is still row
		// 2's — but every row's handler is a fresh closure over this render's item
		// and props, so what the site reaches must be the second render's.
		await block.render(
			Table as LynxComponent<TableProps>,
			table([3, 1, 2], undefined, (id) => taps.push(`second ${id}`)),
		);
		deliverTo(block, second);
		expect(taps).toEqual(['first 2', 'second 2']);

		// And a site is addressed by the block that owns it rather than by where
		// it sits: row 2 moved, so the second row on screen is now row 1.
		deliverTo(block, rowListener(block.main.commits, 1));
		expect(taps).toEqual(['first 2', 'second 2', 'second 1']);
	});

	it('releases a row that leaves the range', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(id)),
		);
		const departing = rowListener(block.main.commits, 2);

		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2], undefined, (id) => taps.push(id)),
		);

		// A departed row's listener run is the program's to release: nothing else
		// holds it, and a run left bound keeps that row's closure — and the item it
		// closed over — reachable for as long as the root lives.
		expect(() => deliverTo(block, departing)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('releases every row when the range empties', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2, 3], undefined, (id) => taps.push(id)),
		);
		const rows = [0, 1, 2].map((index) => rowListener(block.main.commits, index));

		await block.render(
			Table as LynxComponent<TableProps>,
			table([], undefined, (id) => taps.push(id)),
		);

		// Emptying is the one departure an owner cannot see coming row by row, and
		// it is the path a `Clear` button takes.
		for (const row of rows) expect(() => deliverTo(block, row)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('releases every row the range still holds when the root unmounts', async () => {
		const taps: number[] = [];
		const block = blockColumn<TableProps>();
		await block.render(
			Table as LynxComponent<TableProps>,
			table([1, 2], undefined, (id) => taps.push(id)),
		);
		const rows = [0, 1].map((index) => rowListener(block.main.commits, index));

		await block.settle(block.background.unmountAsync());

		for (const row of rows) expect(() => deliverTo(block, row)).toThrow(/listener/i);
		expect(taps).toEqual([]);
	});

	it('renders a row authored as a component', async () => {
		// `@for (…) { <Row … /> }` is a component invocation per row rather than a
		// template, which is what the compiler emits for the shape the benchmark
		// page is written in. The row's plan is inside the component, so the
		// lowering calls it.
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly onSelect: (id: number) => void }) {
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					() => props.onSelect(props.row.id),
					props.row.label,
				]);
			},
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'onSelect', props.onSelect],
								]),
							),
					),
				]);
			},
		);

		const universal = universalColumn(Listed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();
		const taps: number[] = [];
		for (const ids of [[1, 2], [2, 1, 3], []]) {
			const props = table(ids, undefined, (id: number) => taps.push(id));
			await universal.render(props);
			await block.render(Listed as LynxComponent<TableProps>, props);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}

		await block.render(
			Listed as LynxComponent<TableProps>,
			table([7], undefined, (id) => taps.push(id)),
		);
		deliverTo(block, rowListener(block.main.commits, 0));
		expect(taps).toEqual([7]);
	});
	it('honors a memo comparator for a stateful row without swallowing its local updates', async () => {
		interface MemoRowProps {
			readonly row: TableRow;
			readonly revision: number;
		}
		let renders = 0;
		let comparisons = 0;
		const MemoRow = memo(
			defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function MemoRow(props: MemoRowProps) {
				const [tone, setTone] = useState('quiet', 'tone');
				renders++;
				return universalValue(ROW_PLAN, [
					`row ${tone}`,
					String(props.row.id),
					() => setTone(tone === 'quiet' ? 'loud' : 'quiet'),
					`${props.row.label}:${tone}`,
				]);
			}),
			(previous, next) => {
				comparisons++;
				return previous.revision === next.revision;
			},
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: { readonly row: TableRow; readonly revision: number }) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						[props.row],
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								MemoRow,
								universalProps([
									['set', 'row', row],
									['set', 'revision', props.revision],
								]),
							),
					),
				]);
			},
		);
		const block = blockColumn<{ readonly row: TableRow; readonly revision: number }>();

		await block.render(Listed as never, {
			row: { id: 1, label: 'first' },
			revision: 0,
		});
		expect(renders).toBe(1);
		expect(comparisons).toBe(0);
		expect(paint(block.main.commits).tree).toContain('first:quiet');

		await block.render(Listed as never, {
			row: { id: 1, label: 'ignored' },
			revision: 0,
		});
		expect(renders).toBe(1);
		expect(comparisons).toBe(1);
		expect(paint(block.main.commits).tree).toContain('first:quiet');

		deliverTo(block, rowListener(block.main.commits, 0));
		await flushMicrotasks();
		expect(renders).toBe(2);
		expect(comparisons).toBe(1);
		expect(paint(block.main.commits).tree).toContain('ignored:loud');

		await block.render(Listed as never, {
			row: { id: 1, label: 'accepted' },
			revision: 1,
		});
		expect(renders).toBe(3);
		expect(comparisons).toBe(2);
		expect(paint(block.main.commits).tree).toContain('accepted:loud');
	});

	it('composes component children and render props through a keyed row', async () => {
		interface ComposedRowProps {
			readonly row: TableRow;
			readonly render: (label: string) => UniversalRenderable;
		}
		let frameRenders = 0;
		let leafRenders = 0;
		const Leaf = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Leaf(props: ComposedRowProps) {
				leafRenders++;
				return props.render(props.row.label);
			},
			{ hookScope: false },
		);
		const Frame = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Frame(props: { readonly children: UniversalRenderable }) {
				frameRenders++;
				return props.children;
			},
			{ hookScope: false },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Frame,
								universalProps(
									[],
									universalChildren(LYNX_TRANSPORT_RENDERER, () =>
										universalComponent(
											LYNX_TRANSPORT_RENDERER,
											Leaf,
											universalProps([
												['set', 'row', row],
												[
													'set',
													'render',
													(label: string) =>
														universalValue(ROW_PLAN, [
															'row',
															String(row.id),
															noop,
															`slot:${label}`,
														]),
												],
											]),
										),
									),
								),
							),
					),
				]);
			},
		);
		const block = blockColumn<TableProps>();

		await block.render(Listed as LynxComponent<TableProps>, table([1, 2]));
		expect(paint(block.main.commits).tree).toContain('slot:row #0');
		expect(paint(block.main.commits).tree).toContain('slot:row #1');
		expect(frameRenders).toBe(2);
		expect(leafRenders).toBe(2);

		await block.render(Listed as LynxComponent<TableProps>, table([2, 1, 3]));
		expect(paint(block.main.commits).tree).toContain('slot:row #2');
		expect(frameRenders).toBe(5);
		expect(leafRenders).toBe(5);
	});
	it('adopts authored .tsrx component children and render props inside keyed rows', async () => {
		const block = blockColumn<BlockCompositionProps>();
		const props = (ids: readonly number[], prefix: string): BlockCompositionProps => ({
			rows: ids.map((id) => ({ id, label: ['', 'one', 'two', 'three'][id]! })),
			prefix,
		});

		await block.render(
			BlockCompositionFixture as LynxComponent<BlockCompositionProps>,
			props([1, 2], 'a'),
		);
		expect(paint(block.main.commits).tree).toContain('a:one:quiet');
		expect(paint(block.main.commits).tree).toContain('a:two:quiet');

		deliverTo(block, rowListener(block.main.commits, 0));
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('a:one:loud');

		await block.render(
			BlockCompositionFixture as LynxComponent<BlockCompositionProps>,
			props([2, 1, 3], 'b'),
		);
		expect(paint(block.main.commits).tree).toContain('b:three:quiet');
		expect(paint(block.main.commits).tree).toContain('b:one:loud');
		expect(paint(block.main.commits).tree).toContain('b:two:quiet');
	});

	it('mounts a component-valued dynamic region and keys its stateful lifetime', async () => {
		const SHELL_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'shell' },
			children: [{ kind: 'slot', slot: 0 }],
		});
		interface RegionProps {
			readonly identity: string;
			readonly label: string;
			readonly show: boolean;
		}
		const RegionRow = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function RegionRow(props: { readonly label: string }) {
				const [tone, setTone] = useState('quiet', 'tone');
				return universalValue(ROW_PLAN, [
					`row ${tone}`,
					'region',
					() => setTone(tone === 'quiet' ? 'loud' : 'quiet'),
					`${props.label}:${tone}`,
				]);
			},
		);
		const Scene = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Scene(props: RegionProps) {
				return universalValue(SHELL_PLAN, [
					props.show
						? universalComponent(
								LYNX_TRANSPORT_RENDERER,
								RegionRow,
								universalProps([['set', 'label', props.label]]),
								props.identity,
							)
						: null,
				]);
			},
		);
		const block = blockColumn<RegionProps>();
		const listener = (): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of block.main.commits) prepareLynxHostBatch(host, commit.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[0]!.children[1]!;
			return resolveLynxHostNativeEvent(host, [...label.events.values()][0])!;
		};

		await block.render(Scene as LynxComponent<RegionProps>, {
			identity: 'stable',
			label: 'first',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('first:quiet');

		deliverTo(block, listener());
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('first:loud');

		await block.render(Scene as LynxComponent<RegionProps>, {
			identity: 'stable',
			label: 'second',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('second:loud');

		await block.render(Scene as LynxComponent<RegionProps>, {
			identity: 'replacement',
			label: 'third',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('third:quiet');
		await block.render(Scene as LynxComponent<RegionProps>, {
			identity: 'replacement',
			label: 'hidden',
			show: false,
		});
		expect(paint(block.main.commits).tree).not.toContain('third:quiet');

		await block.render(Scene as LynxComponent<RegionProps>, {
			identity: 'replacement',
			label: 'fourth',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('fourth:quiet');
	});
	it('adopts an authored .tsrx component-valued dynamic region', async () => {
		const block = blockColumn<BlockDynamicComponentProps>();
		const component =
			BlockDynamicComponentFixture as unknown as LynxComponent<BlockDynamicComponentProps>;

		const listener = (): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of block.main.commits) prepareLynxHostBatch(host, commit.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[0]!.children[0]!;
			return resolveLynxHostNativeEvent(host, [...label.events.values()][0])!;
		};

		await block.render(component, {
			identity: 'stable',
			label: 'initially hidden',
			show: false,
		});
		expect(paint(block.main.commits).tree).not.toContain('initially hidden');

		await block.render(component, {
			identity: 'stable',
			label: 'first',
			show: true,
		});
		deliverTo(block, listener());
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('first:loud');

		await block.render(component, {
			identity: 'stable',
			label: 'second',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('second:loud');

		await block.render(component, {
			identity: 'replacement',
			label: 'third',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('third:quiet');

		await block.render(component, {
			identity: 'replacement',
			label: 'hidden',
			show: false,
		});
		expect(paint(block.main.commits).tree).not.toContain('third:quiet');

		await block.render(component, {
			identity: 'replacement',
			label: 'fourth',
			show: true,
		});
		expect(paint(block.main.commits).tree).toContain('fourth:quiet');
	});
	it('keeps a static sibling authored before the range ahead of every row', async () => {
		// A range appends its rows to its host element, so the rule it has to obey
		// is that it is that element's *last* child — not its only one. A sibling
		// authored before it stays where it was authored, and this is the case
		// that tells "last child" apart from "only child".
		const HEADED_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'page' },
			children: [
				{
					kind: 'host',
					type: 'text',
					props: { class: 'header' },
					children: [{ kind: 'text', value: 'head' }],
				},
				{ kind: 'slot', slot: 0 },
			],
		});
		const Headed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Headed(props: TableProps) {
				return universalValue(HEADED_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
					),
				]);
			},
		);
		// What the page element holds, in painted order.
		const pageChildren = (commits: readonly LynxTransportCommitMessage[]): string[] => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
			return papi.pages[0]!.children[0]!.children.map((child) => child.classes);
		};
		const universal = universalColumn(Headed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();

		for (const [props, expected] of [
			[table([1, 2]), ['header', 'row', 'row']],
			[table([2, 3, 1]), ['header', 'row', 'row', 'row']],
			[table([]), ['header']],
		] as const) {
			await universal.render(props);
			await block.render(Headed as LynxComponent<TableProps>, props);
			// Said directly as well as differentially, because two cores that both
			// painted the header last would satisfy the comparison alone.
			expect(pageChildren(block.main.commits)).toEqual(expected);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it("leaves a row's empty handler hole unbound and unbinds one a render withdraws", async () => {
		const taps: string[] = [];
		// The selected row withdraws its own tap. An empty event hole is how a
		// template expresses a conditional handler, and a row is a template, so a
		// range has to accept one — including on the very first row, which is the
		// row the range derives its template from.
		const Conditional = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Conditional(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							universalValue(ROW_PLAN, [
								row.id === props.selected ? 'row danger' : 'row',
								String(row.id),
								row.id === props.selected ? undefined : () => props.onSelect(row.id),
								row.label,
							]),
					),
				]);
			},
		);
		const block = blockColumn<TableProps>();

		await block.render(
			Conditional as LynxComponent<TableProps>,
			table([1, 2], 1, (id) => taps.push(`first ${id}`)),
		);
		expect(() => deliverTo(block, rowListener(block.main.commits, 0))).toThrow(/listener/i);
		deliverTo(block, rowListener(block.main.commits, 1));
		expect(taps).toEqual(['first 2']);

		// The selection moves, so one survivor gains a handler and the other
		// loses one. The row that lost it must stop reaching the closure of the
		// render that last supplied one, which is why a rebind releases first.
		await block.render(
			Conditional as LynxComponent<TableProps>,
			table([1, 2], 2, (id) => taps.push(`second ${id}`)),
		);
		deliverTo(block, rowListener(block.main.commits, 0));
		expect(() => deliverTo(block, rowListener(block.main.commits, 1))).toThrow(/listener/i);
		expect(taps).toEqual(['first 2', 'second 1']);
	});
});

describe('Lynx compiled component keyed-range semantic boundaries', () => {
	const listedPlan = (children: readonly unknown[]) =>
		universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'page' },
			children: children as never,
		});

	const listing = (plan: ReturnType<typeof listedPlan>, row: (id: number) => UniversalRenderable) =>
		defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Listed(props: TableProps) {
			return universalValue(plan, [
				universalFor(
					props.rows,
					(item: TableRow) => item.id,
					(item: TableRow) => row(item.id),
				),
			]);
		});

	it('keeps a non-tail range ahead of its static sibling across reconciliation', async () => {
		const Listed = listing(
			listedPlan([
				{ kind: 'slot', slot: 0 },
				{ kind: 'host', type: 'text', props: { class: 'footer' }, children: [] },
			]),
			(id) => universalValue(ROW_PLAN, ['row', String(id), noop, `row ${id}`]),
		);
		const classes = (commits: readonly LynxTransportCommitMessage[]): string[] => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
			return papi.pages[0]!.children[0]!.children.map((child) => child.classes);
		};
		const universal = universalColumn(Listed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();
		for (const [props, expected] of [
			[table([1, 2]), ['row', 'row', 'footer']],
			[table([2, 3, 1]), ['row', 'row', 'row', 'footer']],
			[table([]), ['footer']],
		] as const) {
			await universal.render(props);
			await block.render(Listed as LynxComponent<TableProps>, props);
			expect(classes(block.main.commits)).toEqual(expected);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it('keeps sibling keyed ranges independent under one host', async () => {
		interface SiblingRangesProps {
			readonly left: readonly TableRow[];
			readonly right: readonly TableRow[];
		}
		const SIBLING_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'page' },
			children: [
				{ kind: 'slot', slot: 0 },
				{ kind: 'slot', slot: 1 },
				{ kind: 'host', type: 'text', props: { class: 'footer' }, children: [] },
			],
		});
		const SiblingRanges = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function SiblingRanges(props: SiblingRangesProps) {
				const render = (side: string) => (row: TableRow) =>
					universalValue(ROW_PLAN, ['row', String(row.id), noop, `${side} ${row.label}`]);
				return universalValue(SIBLING_PLAN, [
					universalFor(props.left, (row: TableRow) => row.id, render('left')),
					universalFor(props.right, (row: TableRow) => row.id, render('right')),
				]);
			},
		);
		const rows = (...ids: number[]): TableRow[] => ids.map((id) => ({ id, label: `row ${id}` }));
		const ladder: readonly SiblingRangesProps[] = [
			{ left: [], right: rows(20) },
			{ left: rows(1, 2), right: rows(20) },
			{ left: rows(2, 3, 1), right: rows(21, 20) },
			{ left: rows(3), right: [] },
			{ left: rows(3), right: rows(22) },
		];
		const universal = universalColumn(SiblingRanges as LynxComponent<SiblingRangesProps>);
		const block = blockColumn<SiblingRangesProps>();

		for (const props of ladder) {
			await universal.render(props);
			await block.render(SiblingRanges as LynxComponent<SiblingRangesProps>, props);
			const result = paint(block.main.commits).tree;
			expect(result).toBe(paint(universal.main.commits).tree);
			if (props.left.length !== 0 && props.right.length !== 0) {
				expect(result.lastIndexOf('left row')).toBeLessThan(result.indexOf('right row'));
			}
			expect(result.indexOf('footer')).toBeGreaterThan(
				Math.max(result.lastIndexOf('left row'), result.lastIndexOf('right row')),
			);
		}
	});

	it('names a row that is not a compiled template', async () => {
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) => `row ${id}`);
		const block = blockColumn<TableProps>();
		// The defect is the row's output, not the page's: Listed did return a
		// compiled template, so the diagnostic must say which level failed.
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/a row of one of its keyed ranges is not a compiled template/);
	});

	it('mounts nothing when a duplicate key rejects the first render, so a retry paints once', async () => {
		const block = blockColumn<TableProps>();
		const duplicated: TableProps = {
			rows: [
				{ id: 7, label: 'row 7' },
				{ id: 7, label: 'row 7 again' },
			],
			selected: undefined,
			onSelect: noop,
		};
		await expect(
			block.settle(block.background.renderAsync(Table as never, duplicated)),
		).rejects.toThrow(/duplicate key/);
		expect(block.main.commits).toHaveLength(0);

		// The application fixes its data and renders again. A rejection that had
		// already mounted the page block would make this paint the page twice.
		await block.render(Table as LynxComponent<TableProps>, table([1, 2]));
		const retried = paint(block.main.commits);

		const fresh = blockColumn<TableProps>();
		await fresh.render(Table as LynxComponent<TableProps>, table([1, 2]));
		expect(retried.tree).toEqual(paint(fresh.main.commits).tree);
	});

	it('names two rows that returned different templates', async () => {
		const OTHER_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) =>
			id === 1
				? universalValue(ROW_PLAN, ['row', String(id), noop, `row ${id}`])
				: universalValue(OTHER_ROW, []),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1, 2]))),
		).rejects.toThrow(/two rows of one keyed range/);
	});

	it('names a row that is not rooted at a host element', async () => {
		const TEXT_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, { kind: 'text', value: 'bare' });
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(TEXT_ROW, []),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/row of one of its keyed ranges is rooted at a "text" node/);
	});

	it('mounts and updates a one-host resident row without enabling generic template collapse', async () => {
		const TEXT_HOST_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'text',
			bindings: [['text', 0]],
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) =>
			universalValue(TEXT_HOST_ROW, [`row ${id}`]),
		);
		const universal = universalColumn(Listed as LynxComponent<TableProps>);
		const block = blockColumn<TableProps>();

		for (const props of [table([1, 2]), table([2, 3]), table([]), table([4])]) {
			await universal.render(props);
			await block.render(Listed as never, props);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it('names a row that is not entirely compile-time host structure', async () => {
		const NESTED_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'row' },
			children: [{ kind: 'component', slot: 0 } as never],
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(NESTED_ROW, [noop]),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/not entirely compile-time host structure/);
	});

	it('names a row whose event site sits on its own root', async () => {
		// A template program's root is the node its parent inserts, and it refuses
		// to bind an event there. That is a real limit on what a row may be
		// authored as, so it is named rather than silently dropping the handler.
		const TAPPED_ROOT = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['bindtap', 0]],
			children: [{ kind: 'host', type: 'text', props: { class: 'col-id' }, children: [] }],
		});
		const Listed = listing(listedPlan([{ kind: 'slot', slot: 0 }]), () =>
			universalValue(TAPPED_ROOT, [noop]),
		);
		const block = blockColumn<TableProps>();
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1]))),
		).rejects.toThrow(/static prop or event site of one of its keyed range rows/);
	});

	it('matches Universal while nested keyed ranges mount, reorder, empty, and remount', async () => {
		interface Group {
			readonly id: number;
			readonly rows: readonly TableRow[];
		}
		interface NestedProps {
			readonly groups: readonly Group[];
		}
		const NESTED_PLAN = listedPlan([{ kind: 'slot', slot: 0 }]);
		const INNER_EMPTY_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'nested-empty' },
			children: [
				{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', value: 'empty' }] },
			],
		});
		const Nested = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Nested(props: NestedProps) {
				return universalValue(NESTED_PLAN, [
					universalFor(
						props.groups,
						(group: Group) => group.id,
						(group: Group) =>
							universalValue(TABLE_PLAN, [
								universalFor(
									group.rows,
									(row: TableRow) => row.id,
									(row: TableRow) =>
										universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
									() => universalValue(INNER_EMPTY_PLAN, []),
								),
							]),
					),
				]);
			},
		);
		const row = (id: number, label = `row ${id}`): TableRow => ({ id, label });
		const ladder: readonly NestedProps[] = [
			{
				groups: [
					{ id: 1, rows: [row(11), row(12)] },
					{ id: 2, rows: [row(21)] },
				],
			},
			{
				groups: [
					{ id: 2, rows: [row(22), row(21, 'row twenty-one')] },
					{ id: 1, rows: [row(12), row(11)] },
				],
			},
			{ groups: [{ id: 2, rows: [row(21), row(22)] }] },
			{ groups: [{ id: 2, rows: [] }] },
			{ groups: [] },
			{ groups: [{ id: 3, rows: [row(31)] }] },
		];
		const universal = universalColumn(Nested as LynxComponent<NestedProps>);
		const block = blockColumn<NestedProps>();

		for (const props of ladder) {
			await universal.render(props);
			await block.render(Nested as never, props);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
		expect(paint(block.main.commits).tree).toContain('row #1');
	});

	it('consumes compiler-owned nested range metadata on both resident levels', async () => {
		interface Group {
			readonly id: number;
			readonly rows: readonly TableRow[];
		}
		interface NestedProps {
			readonly groups: readonly Group[];
		}
		const OUTER_PLAN = listedPlan([{ kind: 'slot', slot: 0 }]);
		const OUTER_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			...deriveLynxProgramIR(OUTER_PLAN.root as never)!,
			address: { module: 'tests/NestedOuter.lynx.tsrx', index: 0, digest: 'nested-outer' },
		});
		const ROW_PROGRAM = lynxProgram(LYNX_TRANSPORT_RENDERER, {
			version: 1,
			address: { module: 'tests/NestedRow.lynx.tsrx', index: 0, digest: 'nested-row' },
			wire: {
				nodes: [
					{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
					{ type: 'text', parent: 0, props: { class: 'col-id' } },
					{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 1 }] },
					{ type: 'text', parent: 0, props: { class: 'col-label' } },
					{ type: '#text', parent: 3, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
				],
				events: [{ node: 3, type: 'bindtap', priority: 'discrete' }],
			},
			values: [
				{ node: 0, name: 'class', slot: 0, text: false },
				{ node: 2, name: 'value', slot: 1, text: true },
				{ node: 4, name: 'value', slot: 3, text: true },
			],
			events: [
				{
					node: 3,
					prop: 'bindtap',
					slot: 2,
					type: 'bindtap',
					priority: 'discrete',
				},
			],
			ranges: [],
		});
		const renderGroups = (groups: readonly Group[], compiler: boolean) =>
			universalFor(
				groups,
				(group: Group) => group.id,
				(group: Group) => {
					const rows = universalFor(
						group.rows,
						(row: TableRow) => row.id,
						(row: TableRow) =>
							compiler
								? (lynxProgramValue(ROW_PROGRAM, ['row', String(row.id), noop, row.label]) as never)
								: universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
					);
					return compiler
						? (lynxProgramValue(TABLE_COMPILER_PROGRAM, [rows]) as never)
						: universalValue(TABLE_PLAN, [rows]);
				},
			);
		const CompilerNested = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			(props: NestedProps) =>
				lynxProgramValue(OUTER_PROGRAM, [renderGroups(props.groups, true)]) as never,
		);
		const PlanNested = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, (props: NestedProps) =>
			universalValue(OUTER_PLAN, [renderGroups(props.groups, false)]),
		);
		const row = (id: number): TableRow => ({ id, label: `row ${id}` });
		const ladder: readonly NestedProps[] = [
			{
				groups: [
					{ id: 1, rows: [row(11), row(12)] },
					{ id: 2, rows: [row(21)] },
				],
			},
			{
				groups: [
					{ id: 2, rows: [row(22), row(21)] },
					{ id: 1, rows: [row(12)] },
				],
			},
			{ groups: [] },
		];
		const compiler = blockColumn<NestedProps>();
		const plan = blockColumn<NestedProps>();

		for (const props of ladder) {
			await compiler.render(CompilerNested as never, props);
			await plan.render(PlanNested as never, props);
			expect(paint(compiler.main.commits).tree).toBe(paint(plan.main.commits).tree);
		}
	});

	it('retains nested row state through both reorders and disposes it with the outer key', async () => {
		interface Group {
			readonly id: number;
			readonly rows: readonly TableRow[];
		}
		interface NestedProps {
			readonly groups: readonly Group[];
		}
		const lifecycle: string[] = [];
		const Inner = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Inner(props: { readonly row: TableRow }) {
				const [tone, setTone] = useState('quiet', 'nested-tone');
				useEffect(
					() => {
						lifecycle.push(`mount:${props.row.id}`);
						return () => lifecycle.push(`cleanup:${props.row.id}`);
					},
					[props.row.id],
					'nested-lifecycle',
				);
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					() => setTone('loud'),
					`${props.row.label}-${tone}`,
				]);
			},
			{ hookScope: true },
		);
		const NESTED_PLAN = listedPlan([{ kind: 'slot', slot: 0 }]);
		const Nested = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Nested(props: NestedProps) {
				return universalValue(NESTED_PLAN, [
					universalFor(
						props.groups,
						(group: Group) => group.id,
						(group: Group) =>
							universalValue(TABLE_PLAN, [
								universalFor(
									group.rows,
									(row: TableRow) => row.id,
									(row: TableRow) =>
										universalComponent(
											LYNX_TRANSPORT_RENDERER,
											Inner,
											universalProps([['set', 'row', row]]),
										),
								),
							]),
					),
				]);
			},
		);
		const nestedListener = (
			commits: readonly LynxTransportCommitMessage[],
			groupIndex: number,
			rowIndex: number,
		): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
			const label =
				papi.pages[0]!.children[0]!.children[groupIndex]!.children[1]!.children[rowIndex]!
					.children[1]!;
			const listener = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
			if (listener === null) throw new Error('the nested row bound no tap listener');
			return listener;
		};
		const one = { id: 1, label: 'one' };
		const two = { id: 2, label: 'two' };
		const three = { id: 3, label: 'three' };
		const block = blockColumn<NestedProps>();

		await block.render(Nested as never, {
			groups: [
				{ id: 10, rows: [one, two] },
				{ id: 20, rows: [three] },
			],
		});
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:1', 'mount:2', 'mount:3']);
		const oneListener = nestedListener(block.main.commits, 0, 0);
		deliverTo(block, oneListener);
		await block.settle(Promise.resolve());
		expect(paint(block.main.commits).tree).toContain('one-loud');

		await block.render(Nested as never, {
			groups: [
				{ id: 20, rows: [three] },
				{ id: 10, rows: [two, one] },
			],
		});
		await flushMicrotasks();
		expect(paint(block.main.commits).tree).toContain('one-loud');
		expect(lifecycle).toEqual(['mount:1', 'mount:2', 'mount:3']);

		await block.render(Nested as never, { groups: [{ id: 20, rows: [three] }] });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount:1', 'mount:2', 'mount:3', 'cleanup:2', 'cleanup:1']);
		expect(() => deliverTo(block, oneListener)).toThrow(/listener/i);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle.at(-1)).toBe('cleanup:3');
	});

	it('resets nested semantic owners when an outer keyed component changes type', async () => {
		interface ReplacementProps {
			readonly alternate: boolean;
		}
		const lifecycle: string[] = [];
		const Inner = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Inner() {
				useEffect(
					() => {
						lifecycle.push('mount');
						return () => lifecycle.push('cleanup');
					},
					[],
					'nested-replacement-effect',
				);
				return universalValue(ROW_PLAN, ['row', '1', noop, 'same']);
			},
			{ hookScope: true },
		);
		const renderOuter = () =>
			universalValue(TABLE_PLAN, [
				universalFor(
					[1],
					(id: number) => id,
					() => universalComponent(LYNX_TRANSPORT_RENDERER, Inner),
				),
			]);
		const OuterA = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function OuterA() {
			return renderOuter();
		});
		const OuterB = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function OuterB() {
			return renderOuter();
		});
		const NESTED_PLAN = listedPlan([{ kind: 'slot', slot: 0 }]);
		const Nested = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, (props: ReplacementProps) =>
			universalValue(NESTED_PLAN, [
				universalFor(
					[1],
					(id: number) => id,
					() => universalComponent(LYNX_TRANSPORT_RENDERER, props.alternate ? OuterB : OuterA),
				),
			]),
		);
		const block = blockColumn<ReplacementProps>();

		const mounting = block.background.renderAsync(Nested as never, { alternate: false });
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[0]!);
		await mounting;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount']);

		const rejected = block.background.renderAsync(Nested as never, { alternate: true });
		await flushMicrotasks();
		block.main.reject(block.main.commits[1]!, 'injected nested replacement rejection');
		await expect(rejected).rejects.toThrow('injected nested replacement rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount']);

		const retried = block.background.renderAsync(Nested as never, { alternate: true });
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[2]!);
		await retried;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount', 'cleanup', 'mount']);

		const unmounting = block.background.unmountAsync();
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[3]!);
		await unmounting;
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount', 'cleanup', 'mount', 'cleanup']);
	});

	it('restores nested range ownership after a pre-ACK structural rejection', async () => {
		const Nested = listing(listedPlan([{ kind: 'slot', slot: 0 }]), (id) =>
			universalValue(TABLE_PLAN, [
				universalFor(
					[{ id, label: `nested ${id}` }],
					(row: TableRow) => row.id,
					(row: TableRow) => universalValue(ROW_PLAN, ['row', String(row.id), noop, row.label]),
				),
			]),
		);
		const initial = table([1, 2]);
		const next = table([2, 3]);
		const block = blockColumn<TableProps>();
		const mounting = block.background.renderAsync(Nested as never, initial);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[0]!);
		await mounting;

		const rejected = block.background.renderAsync(Nested as never, next);
		await flushMicrotasks();
		block.main.reject(block.main.commits[1]!, 'injected nested range rejection');
		await expect(rejected).rejects.toThrow('injected nested range rejection');

		const retried = block.background.renderAsync(Nested as never, next);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits[2]!);
		await retried;

		const fresh = blockColumn<TableProps>();
		await fresh.render(Nested as never, next);
		expect(paint([block.main.commits[0]!, block.main.commits[2]!] as never).tree).toBe(
			paint(fresh.main.commits).tree,
		);
	});

	it('disconnects nested listeners and effects with inherited Activity visibility', async () => {
		interface VisibilityProps {
			readonly visible: boolean;
		}
		const lifecycle: string[] = [];
		const taps: string[] = [];
		const Inner = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Inner() {
				useEffect(
					() => {
						lifecycle.push('mount');
						return () => lifecycle.push('cleanup');
					},
					[],
					'nested-visible-effect',
				);
				return universalValue(ROW_PLAN, ['row', '1', () => taps.push('tap'), 'nested']);
			},
			{ hookScope: true },
		);
		const NESTED_PLAN = listedPlan([{ kind: 'slot', slot: 0 }]);
		const Nested = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Nested(props: VisibilityProps) {
				return universalActivity(props.visible ? 'visible' : 'hidden', () =>
					universalValue(NESTED_PLAN, [
						universalFor(
							[1],
							(id: number) => id,
							() =>
								universalValue(TABLE_PLAN, [
									universalFor(
										[1],
										(id: number) => id,
										() => universalComponent(LYNX_TRANSPORT_RENDERER, Inner),
									),
								]),
						),
					]),
				);
			},
		);
		const listener = (commits: readonly LynxTransportCommitMessage[]): LynxResolvedNativeEvent => {
			const papi = createFakePAPI();
			const host = createLynxHostContainer(papi, { root: 1 });
			for (const commit of commits) prepareLynxHostBatch(host, commit.batch).apply();
			const label = papi.pages[0]!.children[0]!.children[0]!.children[1]!.children[0]!.children[1]!;
			const resolved = resolveLynxHostNativeEvent(host, [...label.events.values()][0]);
			if (resolved === null) throw new Error('the visible nested row bound no listener');
			return resolved;
		};
		const block = blockColumn<VisibilityProps>();

		await block.render(Nested as never, { visible: true });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount']);
		const visibleListener = listener(block.main.commits);
		deliverTo(block, visibleListener);
		expect(taps).toEqual(['tap']);

		await block.render(Nested as never, { visible: false });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount', 'cleanup']);
		expect(() => deliverTo(block, visibleListener)).toThrow(/listener/i);

		await block.render(Nested as never, { visible: true });
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount', 'cleanup', 'mount']);
		deliverTo(block, listener(block.main.commits));
		expect(taps).toEqual(['tap', 'tap']);
	});

	it('mounts, updates, removes, and remounts an @empty branch as its own keyed lifetime', async () => {
		const EMPTY_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'empty-state' },
			children: [
				{
					kind: 'host',
					type: 'text',
					props: { class: 'empty-marker' },
					children: [{ kind: 'slot', slot: 0 }],
				},
				{
					kind: 'host',
					type: 'text',
					props: { class: 'empty-action' },
					bindings: [['bindtap', 1]],
					children: [{ kind: 'slot', slot: 2 }],
				},
			],
		});
		const lifecycle: string[] = [];
		const Empty = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, function Empty() {
			const [seen, setSeen] = useState(false);
			useEffect(
				() => {
					lifecycle.push('mount');
					return () => lifecycle.push('cleanup');
				},
				[],
				'empty-lifetime',
			);
			return universalValue(EMPTY_PLAN, [
				'empty',
				() => setSeen(true),
				seen ? 'empty seen' : 'nothing here',
			]);
		});
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(item: TableRow) => item.id,
						(item: TableRow) =>
							universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label]),
						() => universalComponent(LYNX_TRANSPORT_RENDERER, Empty),
					),
				]);
			},
		);
		const block = blockColumn<TableProps>();

		const rejected = block.background.renderAsync(Listed as never, table([]));
		await flushMicrotasks();
		block.main.reject(block.main.commits[0]!, 'injected empty mount rejection');
		await expect(rejected).rejects.toThrow('injected empty mount rejection');
		await flushMicrotasks();
		expect(lifecycle).toEqual([]);
		const accepted = () => block.main.commits.slice(1);

		await block.render(Listed as never, table([]));
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('nothing here');
		expect(lifecycle).toEqual(['mount']);

		const departed = rowListener(accepted(), 0);
		deliverTo(block, departed);
		await block.settle(Promise.resolve());
		expect(paint(accepted()).tree).toContain('empty seen');

		await block.render(Listed as never, table([1]));
		await flushMicrotasks();
		expect(paint(accepted()).tree).not.toContain('empty-state');
		expect(lifecycle).toEqual(['mount', 'cleanup']);
		expect(() => deliverTo(block, departed)).toThrow(/listener/i);

		await block.render(Listed as never, table([]));
		await flushMicrotasks();
		expect(paint(accepted()).tree).toContain('nothing here');
		expect(lifecycle).toEqual(['mount', 'cleanup', 'mount']);

		await block.settle(block.background.unmountAsync());
		await flushMicrotasks();
		expect(lifecycle).toEqual(['mount', 'cleanup', 'mount', 'cleanup']);
	});

	it('writes nothing when a later render refuses inside a range', async () => {
		// A refusal has to leave the block as the last render left it. The rows are
		// rendered before the first slot is written for exactly this reason, and
		// the root's own slots are held back with them — otherwise a refused render
		// would leave its title on the core, to be flushed by whichever frame came
		// next.
		const TITLED_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['class', 1]],
			children: [
				{
					kind: 'host',
					type: 'view',
					props: { class: 'rows' },
					children: [{ kind: 'slot', slot: 0 }],
				},
			],
		});
		const OTHER_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'other' },
		});
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TITLED_PLAN, [
					universalFor(
						props.rows,
						(item: TableRow) => item.id,
						(item: TableRow) =>
							props.selected === undefined
								? universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label])
								: universalValue(OTHER_ROW, []),
					),
					props.selected === undefined ? 'page' : 'page selected',
				]);
			},
		);

		const core = createLynxBlockCore();
		const block = blockColumn<TableProps>(core);
		await block.render(Listed as LynxComponent<TableProps>, table([1]));
		const before = core.counters();
		const frames = block.main.commits.length;

		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1], 1))),
		).rejects.toThrow(/two rows of one keyed range|different compiled templates/);

		expect(core.counters().commands).toBe(before.commands);
		expect(block.main.commits).toHaveLength(frames);
	});

	it('refuses a hole that mounted a keyed range and later held something else', async () => {
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					props.selected === undefined
						? universalFor(
								props.rows,
								(item: TableRow) => item.id,
								(item: TableRow) =>
									universalValue(ROW_PLAN, ['row', String(item.id), noop, item.label]),
							)
						: 'not a range any more',
				]);
			},
		);
		const block = blockColumn<TableProps>();
		await block.render(Listed as LynxComponent<TableProps>, table([1]));
		await expect(
			block.settle(block.background.renderAsync(Listed as never, table([1], 1))),
		).rejects.toThrow(/structural hole later held a non-structural value/);
	});
});

/**
 * Item 1's widening slice: a row the page re-rendered past.
 *
 * Every ladder above rebuilds its rows from scratch each rung, which is a fair
 * model of `setRows(next)` and no model at all of the other half of what a page
 * does. `setSelected` leaves `rows` alone: the array, and every object in it,
 * survives the render that changed the page. A lowering that answers "same
 * item, same row" would paint that ladder perfectly and still be wrong, because
 * what moved is a *sibling* prop the row is given rather than anything the row
 * is keyed by.
 *
 * So these rungs hold item identity fixed on purpose and move the page around
 * it, and the oracle stays the one the file uses everywhere else: the two cores
 * must paint the same tree at every step.
 */
const STABLE_ROWS: readonly TableRow[] = [
	{ id: 1, label: 'row 1' },
	{ id: 2, label: 'row 2' },
	{ id: 3, label: 'row 3' },
	{ id: 4, label: 'row 4' },
	{ id: 5, label: 'row 5' },
];

/** `<Row … />` per row: the shape the benchmark page and every real page use. */
function stableColumnComponent(): LynxComponent<TableProps> {
	const Row = defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		function Row(props: {
			readonly row: TableRow;
			readonly isSelected: boolean;
			readonly onSelect: (id: number) => void;
		}) {
			return universalValue(ROW_PLAN, [
				props.isSelected ? 'row danger' : 'row',
				String(props.row.id),
				() => props.onSelect(props.row.id),
				props.row.label,
			]);
		},
		{ hookScope: false },
	);
	const Listed = defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		function Listed(props: TableProps) {
			return universalValue(TABLE_PLAN, [
				universalFor(
					props.rows,
					(row: TableRow) => row.id,
					(row: TableRow) =>
						universalComponent(
							LYNX_TRANSPORT_RENDERER,
							Row,
							universalProps([
								['set', 'row', row],
								['set', 'isSelected', row.id === props.selected],
								['set', 'onSelect', props.onSelect],
							]),
						),
				),
			]);
		},
	);
	return Listed as LynxComponent<TableProps>;
}

describe('Lynx compiled component whose rows outlive the render', () => {
	it('runs only old and new rows for an authored wrapped selection predicate', async () => {
		const observed: string[] = [];
		const observe = (entry: string) => observed.push(entry);
		const component =
			BlockWrappedSelectionFixture as never as LynxComponent<BlockWrappedSelectionProps>;
		const block = blockColumn<BlockWrappedSelectionProps>();

		await block.render(component, { rows: STABLE_ROWS, selected: 2, observe });
		observed.length = 0;
		await block.render(component, { rows: STABLE_ROWS, selected: 4, observe });

		expect(observed).toEqual(['selection-row:2', 'selection-row:4']);
		const rows = JSON.parse(paint(block.main.commits).tree).children[0].children[0].children;
		expect(rows[1].classes).toBe('row muted');
		expect(rows[3].classes).toBe('row danger');
	});

	it('visits only old and new keys for a compiler-certified selection', async () => {
		let keyCalls = 0;
		let rangeCalls = 0;
		let rowCalls = 0;
		let visited: number[] = [];
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: {
				readonly row: TableRow;
				readonly isSelected: boolean;
				readonly onSelect: (id: number) => void;
			}) {
				rowCalls++;
				return universalValue(ROW_PLAN, [
					props.isSelected ? 'row danger' : 'row',
					String(props.row.id),
					() => props.onSelect(props.row.id),
					props.row.label,
				]);
			},
			{ hookScope: false },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => {
							keyCalls++;
							return row.id;
						},
						(row: TableRow, index: number) => {
							rangeCalls++;
							visited.push(row.id * 1000 + index);
							return universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'isSelected', props.selected === row.id],
									['set', 'onSelect', props.onSelect],
								]),
							);
						},
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
						[props.selected, [props.onSelect], 'row', true],
					),
				]);
			},
		);
		const rows = Array.from({ length: 100 }, (_, index) => ({
			id: index + 1,
			label: `row ${index + 1}`,
		}));
		const onSelect = (): void => {};
		const core = createLynxBlockCore();
		const block = blockColumn<TableProps>(core);
		await block.render(Listed as LynxComponent<TableProps>, {
			rows,
			selected: undefined,
			onSelect,
		});

		const step = async (selected: number | undefined, nextRows = rows) => {
			visited = [];
			const beforeRange = rangeCalls;
			const beforeRows = rowCalls;
			const beforeCore = core.counters();
			await block.render(Listed as LynxComponent<TableProps>, {
				rows: nextRows,
				selected,
				onSelect,
			});
			const afterCore = core.counters();
			return {
				rangeCalls: rangeCalls - beforeRange,
				rowCalls: rowCalls - beforeRows,
				lookups: afterCore.blockLookups - beforeCore.blockLookups,
				commands: afterCore.commands - beforeCore.commands,
				visited,
			};
		};

		expect(await step(25)).toEqual({
			rangeCalls: 1,
			rowCalls: 1,
			lookups: 1,
			commands: 1,
			visited: [25_024],
		});
		expect(await step(75)).toEqual({
			rangeCalls: 2,
			rowCalls: 2,
			lookups: 2,
			commands: 2,
			visited: [25_024, 75_074],
		});
		// Move backwards to prove old/new rows retain list order rather than
		// selection-transition order, while receiving their committed indices.
		expect(await step(25)).toEqual({
			rangeCalls: 2,
			rowCalls: 2,
			lookups: 2,
			commands: 2,
			visited: [25_024, 75_074],
		});
		expect(await step(25)).toEqual({
			rangeCalls: 0,
			rowCalls: 0,
			lookups: 0,
			commands: 0,
			visited: [],
		});
		// A new collection identity alone does not invalidate a compiler-proven
		// row. The changed-item rung then proves the shortcut still reaches the
		// one row whose direct item prop actually changed.
		expect(await step(25, rows.slice())).toEqual({
			rangeCalls: 0,
			rowCalls: 0,
			lookups: 0,
			commands: 0,
			visited: [],
		});
		const edited = rows.slice();
		edited[9] = { ...edited[9]!, label: 'row 10 edited' };
		expect(await step(25, edited)).toEqual({
			rangeCalls: 1,
			rowCalls: 1,
			lookups: 1,
			commands: 1,
			visited: [10_009],
		});
		const swapped = edited.slice();
		[swapped[1], swapped[98]] = [swapped[98]!, swapped[1]!];
		const swappedStep = await step(25, swapped);
		expect(swappedStep.rangeCalls).toBe(0);
		// The compiler proved this Row does not receive the index, so even the
		// shifted descriptors survive without rebuilding their identical props.
		expect(swappedStep.rowCalls).toBe(0);
		expect(swappedStep.visited).toEqual([]);

		// Deletion-only retention reuses the committed descriptor Map. Rejecting the
		// structural frame must leave that Map intact: key 50 still has to be
		// available to the following sparse selection against the accepted source.
		const rejectedRemoval = swapped.filter((row) => row.id !== 50);
		const beforeRejectedKeys = keyCalls;
		const beforeRejectedRange = rangeCalls;
		const beforeRejectedRows = rowCalls;
		const rejected = block.background.renderAsync(
			Listed as never,
			{ rows: rejectedRemoval, selected: 25, onSelect } as never,
		);
		await flushMicrotasks();
		block.main.reject(block.main.commits.at(-1)!, 'injected deletion-only rejection');
		await expect(rejected).rejects.toThrow('injected deletion-only rejection');
		expect(keyCalls).toBe(beforeRejectedKeys);
		expect(rangeCalls).toBe(beforeRejectedRange);
		expect(rowCalls).toBe(beforeRejectedRows);
		const commitStep = async (selected: number | undefined, nextRows: readonly TableRow[]) => {
			visited = [];
			const beforeRange = rangeCalls;
			const beforeRows = rowCalls;
			const beforeCore = core.counters();
			const rendering = block.background.renderAsync(
				Listed as never,
				{ rows: nextRows, selected, onSelect } as never,
			);
			await flushMicrotasks();
			block.main.acknowledge(block.main.commits.at(-1)!);
			await rendering;
			const afterCore = core.counters();
			return {
				rangeCalls: rangeCalls - beforeRange,
				rowCalls: rowCalls - beforeRows,
				lookups: afterCore.blockLookups - beforeCore.blockLookups,
				commands: afterCore.commands - beforeCore.commands,
				visited,
			};
		};
		expect(await commitStep(50, swapped)).toEqual({
			rangeCalls: 2,
			rowCalls: 2,
			lookups: 2,
			commands: 2,
			visited: [25_024, 50_049],
		});

		const beforeRemovalKeys = keyCalls;
		const removed = swapped.filter((row) => row.id !== 50);
		expect(await commitStep(50, removed)).toEqual({
			rangeCalls: 0,
			rowCalls: 0,
			lookups: 1,
			commands: 6,
			visited: [],
		});
		// The compiler proved an index-independent component row with stable
		// captures. A strict item-identity subsequence therefore supplies both the
		// retained descriptors and their committed keys without either producer.
		expect(keyCalls - beforeRemovalKeys).toBe(0);

		const beforeClearKeys = keyCalls;
		expect(await commitStep(50, [])).toEqual({
			rangeCalls: 0,
			rowCalls: 0,
			lookups: 0,
			commands: 2,
			visited: [],
		});
		// Emptying a compiler-certified range takes the ordinary empty-render path:
		// it publishes a fresh descriptor Map after acknowledgement without asking
		// either producer to describe rows that no longer exist.
		expect(keyCalls - beforeClearKeys).toBe(0);
	});

	it('preserves strict-equality selection semantics across a fresh collection', async () => {
		let rangeCalls = 0;
		let rowCalls = 0;
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly isSelected: boolean }) {
				rowCalls++;
				return universalValue(ROW_PLAN, [
					props.isSelected ? 'row danger' : 'row',
					String(props.row.id),
					noop,
					props.row.label,
				]);
			},
			{ hookScope: false },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) => {
							rangeCalls++;
							return universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'isSelected', props.selected === row.id],
								]),
							);
						},
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
						[props.selected, [], 'row', true],
					),
				]);
			},
		);
		const rows: readonly TableRow[] = [
			{ id: 0, label: 'zero' },
			{ id: 1, label: 'one' },
		];
		const block = blockColumn<TableProps>();

		await block.render(Listed as LynxComponent<TableProps>, {
			rows,
			selected: -0,
			onSelect: noop,
		});
		let paintedRows = JSON.parse(paint(block.main.commits).tree).children[0].children[1].children;
		expect(paintedRows[0].classes).toBe('row danger');
		rangeCalls = 0;
		rowCalls = 0;

		await block.render(Listed as LynxComponent<TableProps>, {
			rows: rows.slice(),
			selected: 1,
			onSelect: noop,
		});

		paintedRows = JSON.parse(paint(block.main.commits).tree).children[0].children[1].children;
		expect(rangeCalls).toBe(2);
		expect(rowCalls).toBe(2);
		expect(paintedRows[0].classes).toBe('row');
		expect(paintedRows[1].classes).toBe('row danger');
	});

	it('owns one external-store selector and publishes it only after host acknowledgement', async () => {
		let selected: number | undefined;
		let subscriptions = 0;
		let unsubscriptions = 0;
		const listeners = new Set<() => void>();
		const store = {
			getSnapshot: () => selected,
			subscribe(listener: () => void) {
				subscriptions++;
				listeners.add(listener);
				return () => {
					if (listeners.delete(listener)) unsubscriptions++;
				};
			},
			select(value: number | undefined) {
				selected = value;
				for (const listener of listeners) listener();
			},
			notify() {
				for (const listener of listeners) listener();
			},
		};
		let rangeCalls = 0;
		let rowCalls = 0;
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: { readonly row: TableRow; readonly isSelected: boolean }) {
				rowCalls++;
				return universalValue(ROW_PLAN, [
					props.isSelected ? 'row danger' : 'row',
					String(props.row.id),
					noop,
					props.row.label,
				]);
			},
			{ hookScope: false },
		);
		interface StoreTableProps {
			readonly rows: readonly TableRow[];
			readonly store: typeof store;
		}
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: StoreTableProps) {
				const current = useSyncExternalStore(
					props.store.subscribe,
					props.store.getSnapshot,
					undefined,
					'selection',
				);
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow) => {
							rangeCalls++;
							return universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'isSelected', current === row.id],
								]),
							);
						},
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
						[current, [], 'row'],
					),
				]);
			},
		);
		const rows = Array.from({ length: 100 }, (_, index) => ({
			id: index + 1,
			label: `row ${index + 1}`,
		}));
		const core = createLynxBlockCore();
		const block = blockColumn<StoreTableProps>(core);
		const mounting = block.background.renderAsync(Listed as never, { rows, store } as never);
		await flushMicrotasks();

		// Rendering and sending the frame do not make the subscription live. It
		// belongs to the accepted tree, so only the main thread's ACK publishes it.
		expect(block.main.commits).toHaveLength(1);
		expect(subscriptions).toBe(0);
		block.acknowledgePending();
		await mounting;
		await flushMicrotasks();
		expect(subscriptions).toBe(1);
		expect(listeners.size).toBe(1);

		const step = async (value: number | undefined) => {
			const beforeRange = rangeCalls;
			const beforeRows = rowCalls;
			const beforeCore = core.counters();
			store.select(value);
			await block.settle(block.background.flushTransport());
			const afterCore = core.counters();
			return {
				rangeCalls: rangeCalls - beforeRange,
				rowCalls: rowCalls - beforeRows,
				lookups: afterCore.blockLookups - beforeCore.blockLookups,
				commands: afterCore.commands - beforeCore.commands,
			};
		};

		expect(await step(25)).toEqual({ rangeCalls: 1, rowCalls: 1, lookups: 1, commands: 1 });
		expect(await step(75)).toEqual({ rangeCalls: 2, rowCalls: 2, lookups: 2, commands: 2 });
		expect(await step(25)).toEqual({ rangeCalls: 2, rowCalls: 2, lookups: 2, commands: 2 });
		expect(paint(block.main.commits).tree).toContain('"classes":"row danger"');
		expect(subscriptions).toBe(1);
		expect(unsubscriptions).toBe(0);

		const frames = block.main.commits.length;
		const beforeRange = rangeCalls;
		const beforeRows = rowCalls;
		const beforeCore = core.counters();
		store.notify();
		await block.settle(block.background.flushTransport());
		expect(block.main.commits).toHaveLength(frames);
		expect(rangeCalls).toBe(beforeRange);
		expect(rowCalls).toBe(beforeRows);
		expect(core.counters()).toEqual(beforeCore);

		await block.settle(block.background.unmountAsync());
		expect(unsubscriptions).toBe(1);
		expect(listeners.size).toBe(0);
	});

	it('falls back to the whole range when rows or another captured dependency change', async () => {
		let rangeCalls = 0;
		let visited: number[] = [];
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Row(props: {
				readonly row: TableRow;
				readonly isSelected: boolean;
				readonly onSelect: (id: number) => void;
			}) {
				return universalValue(ROW_PLAN, [
					props.isSelected ? 'row danger' : 'row',
					String(props.row.id),
					() => props.onSelect(props.row.id),
					props.row.label,
				]);
			},
			{ hookScope: false },
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function Listed(props: TableProps) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: TableRow) => row.id,
						(row: TableRow, index: number) => {
							rangeCalls++;
							visited.push(row.id * 1000 + index);
							return universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([
									['set', 'row', row],
									['set', 'isSelected', props.selected === row.id],
									['set', 'onSelect', props.onSelect],
								]),
							);
						},
						null,
						false,
						false,
						undefined,
						undefined,
						undefined,
						true,
						[props.selected, [props.onSelect], 'row'],
					),
				]);
			},
		);
		const rows = STABLE_ROWS;
		const first = (): void => {};
		const second = (): void => {};
		const block = blockColumn<TableProps>();
		await block.render(Listed as LynxComponent<TableProps>, {
			rows,
			selected: undefined,
			onSelect: first,
		});

		rangeCalls = 0;
		await block.render(Listed as LynxComponent<TableProps>, {
			rows,
			selected: 2,
			onSelect: second,
		});
		expect(rangeCalls).toBe(rows.length);

		rangeCalls = 0;
		const reordered = [rows[4]!, ...rows.slice(0, 4)];
		await block.render(Listed as LynxComponent<TableProps>, {
			rows: reordered,
			selected: 2,
			onSelect: second,
		});
		expect(rangeCalls).toBe(rows.length);

		// The fallback refreshed each retained row's position. A later sparse
		// selection on that same reordered source must still reach only its two
		// keys, including the row whose index moved.
		rangeCalls = 0;
		visited = [];
		await block.render(Listed as LynxComponent<TableProps>, {
			rows: reordered,
			selected: 5,
			onSelect: second,
		});
		expect(rangeCalls).toBe(2);
		expect(visited).toEqual([5_000, 2_002]);

		// A rejected structural frame must not publish its tentative order into
		// the retained records. The accepted tree is still `reordered`, so the
		// following sparse selection has to receive those committed indices.
		const rejected = block.background.renderAsync(
			Listed as never,
			{
				rows,
				selected: 5,
				onSelect: second,
			} as never,
		);
		await flushMicrotasks();
		block.main.reject(block.main.commits.at(-1)!, 'injected reordered range rejection');
		await expect(rejected).rejects.toThrow('injected reordered range rejection');

		rangeCalls = 0;
		visited = [];
		const retained = block.background.renderAsync(
			Listed as never,
			{
				rows: reordered,
				selected: 2,
				onSelect: second,
			} as never,
		);
		await flushMicrotasks();
		block.main.acknowledge(block.main.commits.at(-1)!);
		await retained;
		expect(rangeCalls).toBe(2);
		expect(visited).toEqual([5_000, 2_002]);
	});

	it('paints what the universal core paints while the row objects never change', async () => {
		const Listed = stableColumnComponent();
		// One function for every rung: a fresh one each render would change every
		// row's props and make the ladder prove nothing about a row left alone.
		const onSelect = (): void => {};
		const edited = STABLE_ROWS.map((row) =>
			row.id === 2 ? { id: 2, label: 'row 2 edited' } : row,
		);
		// Every rung reuses the objects of the one before it wherever the page
		// would. Only `edited` and the reorder build a new array, and even those
		// keep every row object they did not touch.
		const ladder: readonly TableProps[] = [
			{ rows: [], selected: undefined, onSelect },
			{ rows: STABLE_ROWS, selected: undefined, onSelect },
			// The selection moves and nothing else does — the rung the older
			// ladders have no spelling for.
			{ rows: STABLE_ROWS, selected: 3, onSelect },
			// …and moves again, so one row gains the class and another loses it.
			{ rows: STABLE_ROWS, selected: 4, onSelect },
			// A render that moves nothing at all.
			{ rows: STABLE_ROWS, selected: 4, onSelect },
			// One row's own data changes; its four neighbours are the same objects.
			{ rows: edited, selected: 4, onSelect },
			// A reorder over surviving objects: keys move, values do not.
			{ rows: [edited[4]!, ...edited.slice(1, 4), edited[0]!], selected: 4, onSelect },
			// A removal, then a selection change over what is left.
			{ rows: [edited[4]!, edited[2]!, edited[3]!, edited[0]!], selected: 4, onSelect },
			{ rows: [edited[4]!, edited[2]!, edited[3]!, edited[0]!], selected: 3, onSelect },
			// The removed row returns, so the range grows over surviving objects.
			{ rows: edited, selected: 3, onSelect },
			{ rows: [], selected: undefined, onSelect },
		];

		const universal = universalColumn(Listed);
		const block = blockColumn<TableProps>();
		for (const props of ladder) {
			await universal.render(props);
			await block.render(Listed, props);
			expect(paint(block.main.commits).tree).toBe(paint(universal.main.commits).tree);
		}
	});

	it('routes a tap to a row the last render left alone', async () => {
		// The listeners of a row the render did not call are the closures an
		// earlier render made. They may be kept only because the props they close
		// over compared equal, so this is the assertion that says they still reach
		// the right row rather than the row that happened to be there when they
		// were made.
		const taps: number[] = [];
		const Listed = stableColumnComponent();
		const onSelect = (id: number): void => void taps.push(id);
		const block = blockColumn<TableProps>();
		await block.render(Listed, { rows: STABLE_ROWS, selected: undefined, onSelect });
		// Row 1 is the one that changes; rows 2-5 are left exactly as they were.
		await block.render(Listed, { rows: STABLE_ROWS, selected: 1, onSelect });
		deliverTo(block, rowListener(block.main.commits, 3));
		deliverTo(block, rowListener(block.main.commits, 0));
		expect(taps).toEqual([4, 1]);
	});

	it('keeps retained listeners through structural changes and binds only changed rows', async () => {
		interface EventRow {
			readonly id: number;
			readonly label: string;
			readonly onTap: () => void;
		}
		const Row = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function EventRowComponent(props: { readonly row: EventRow }) {
				return universalValue(ROW_PLAN, [
					'row',
					String(props.row.id),
					props.row.onTap,
					props.row.label,
				]);
			},
		);
		const Listed = defineUniversalComponent(
			LYNX_TRANSPORT_RENDERER,
			function EventRows(props: { readonly rows: readonly EventRow[] }) {
				return universalValue(TABLE_PLAN, [
					universalFor(
						props.rows,
						(row: EventRow) => row.id,
						(row: EventRow) =>
							universalComponent(
								LYNX_TRANSPORT_RENDERER,
								Row,
								universalProps([['set', 'row', row]]),
							),
					),
				]);
			},
		);
		const taps: string[] = [];
		const one: EventRow = { id: 1, label: 'one', onTap: () => taps.push('first one') };
		const two: EventRow = { id: 2, label: 'two', onTap: () => taps.push('first two') };
		const three: EventRow = { id: 3, label: 'three', onTap: () => taps.push('first three') };
		const block = blockColumn<{ readonly rows: readonly EventRow[] }>();
		await block.render(Listed as LynxComponent<{ readonly rows: readonly EventRow[] }>, {
			rows: [one, two, three],
		});
		const [oneListener, twoListener, threeListener] = [0, 1, 2].map((index) =>
			rowListener(block.main.commits, index),
		);

		const changedTwo: EventRow = {
			id: 2,
			label: 'two changed',
			onTap: () => taps.push('second two'),
		};
		const four: EventRow = { id: 4, label: 'four', onTap: () => taps.push('new four') };
		await block.render(Listed as LynxComponent<{ readonly rows: readonly EventRow[] }>, {
			rows: [three, one, changedTwo, four],
		});

		// Moves retain each block's listener run. Rows three and one kept their
		// complete descriptors, row two kept its host but published its new
		// closure, and the inserted row received its first listener binding.
		expect(rowListener(block.main.commits, 0).listener).toBe(threeListener!.listener);
		expect(rowListener(block.main.commits, 1).listener).toBe(oneListener!.listener);
		expect(rowListener(block.main.commits, 2).listener).toBe(twoListener!.listener);
		deliverTo(block, threeListener!);
		deliverTo(block, oneListener!);
		deliverTo(block, twoListener!);
		deliverTo(block, rowListener(block.main.commits, 3));
		expect(taps).toEqual(['first three', 'first one', 'second two', 'new four']);

		await block.render(Listed as LynxComponent<{ readonly rows: readonly EventRow[] }>, {
			rows: [three, changedTwo, four],
		});
		expect(() => deliverTo(block, oneListener!)).toThrow(/listener/i);
		deliverTo(block, threeListener!);
		expect(taps.at(-1)).toBe('first three');
	});

	it('gives a re-rendered row this render’s handler rather than the one it kept', async () => {
		// The other half: a row the render *did* call must stop reaching the
		// closure it had, because that one closes over the previous props.
		const first: number[] = [];
		const second: number[] = [];
		const Listed = stableColumnComponent();
		const block = blockColumn<TableProps>();
		await block.render(Listed, {
			rows: STABLE_ROWS,
			selected: undefined,
			onSelect: (id) => first.push(id),
		});
		// `onSelect` is a different function this render, so every row's props
		// differ and every row is called again.
		await block.render(Listed, {
			rows: STABLE_ROWS,
			selected: undefined,
			onSelect: (id) => second.push(id),
		});
		deliverTo(block, rowListener(block.main.commits, 2));
		expect(first).toEqual([]);
		expect(second).toEqual([3]);
	});
});
