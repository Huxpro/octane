// Issue-#103 U2b: the two cores, painting the same page.
//
// U1 §7 made per-root opt-in the shape of coexistence, and named this test as
// the reason: the same logical state driven through the universal core and
// through the Block core, over the *same* wire and the *same* applier, must
// leave the same physical tree. Fork the applier and byte-equality proves
// nothing; sharing it is what makes the comparison mean something.
//
// Both sides here run `createLynxBackgroundTransport` against the same fake
// main thread and replay the accepted commits through `prepareLynxHostBatch`.
// The only difference between the two columns is which background core built
// the frames.
//
// What is compared, and what is deliberately not:
//
//   compared      the painted tree — types, classes, attributes, text, event
//                 *sites*, and the selector's root and generation.
//   normalized    host ids inside the nodes-ref selector, and the numeric part
//                 of a native event token. The two cores are different
//                 allocators and never had to agree about a number; comparing
//                 those would report a difference that is not one.
//   not compared  the command streams. They are not the same program — the
//                 universal side renders a component, the Block side is driven
//                 directly — so the frames legitimately differ. The counts are
//                 read for what they say rather than asserted equal.
import { beforeAll, describe, expect, it } from 'vitest';

import {
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
	type UniversalHostCommand,
	type UniversalHostTemplateProgramValue,
} from 'octane/universal/native';

import { LYNX_TRANSPORT_RENDERER, type LynxTransportCommitMessage } from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockRoot } from '../src/core/block-root.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import {
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
} from '../src/core/worklets.js';
import {
	createFakePAPI,
	shape,
	withoutAllocatorIdentity,
	type FakeNode,
} from './_fixtures/fake-element-papi.js';
import {
	FakeContextProxy,
	flushMicrotasks,
	installMainSide,
	type MainSide,
} from './_fixtures/fake-lynx-wire.js';

interface Row {
	readonly id: number;
	readonly label: string;
}

interface SceneProps {
	readonly rows: readonly Row[];
	readonly selected: number | null;
}

function rows(count: number): Row[] {
	return Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		label: `row ${index + 1}`,
	}));
}

function rowClass(row: Row, selected: number | null): string {
	return row.id === selected ? 'row danger' : 'row';
}

// The two descriptions of one fixture. They have to agree about host types,
// nesting, static props, and which values are bound where — that agreement is
// the premise of the comparison, not a thing the comparison proves.
const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-label' },
			children: [{ kind: 'text', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-remove' },
			children: [{ kind: 'text', value: 'x' }],
		},
	],
});

const PAGE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{ kind: 'host', type: 'view', props: { class: 'rows' }, children: [{ kind: 'slot', slot: 0 }] },
	],
});

const BLOCK_PAGE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
});

const BLOCK_ROW = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		{ type: 'text', parent: 0, props: { class: 'col-label' } },
		{
			type: '#text',
			parent: 1,
			props: { value: '' },
			bindings: [{ name: 'value', valueIndex: 1 }],
		},
		{ type: 'text', parent: 0, props: { class: 'col-remove' } },
		{ type: '#text', parent: 3, props: { value: 'x' } },
	],
	events: [],
});

const BLOCK_ROW_CLASS = 0;

const Scene = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ rows: list, selected }: SceneProps) =>
		universalValue(PAGE_PLAN, [
			universalFor(
				list,
				(row) => row.id,
				(row) => universalValue(ROW_PLAN, [rowClass(row, selected), row.label]),
			),
		]),
);

/** Replay every accepted commit through the real applier onto a fake host. */
function host(commits: readonly LynxTransportCommitMessage[]): ReturnType<typeof createFakePAPI> {
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, {
		root: 1,
		worklets: createLynxMainThreadWorkletRegistry(),
	});
	for (const commit of commits) prepareLynxHostBatch(container, commit.batch).apply();
	return papi;
}

function paint(commits: readonly LynxTransportCommitMessage[]): unknown {
	return withoutAllocatorIdentity(shape(host(commits).pages[0]!));
}

function countCommands(commits: readonly LynxTransportCommitMessage[]): number {
	let total = 0;
	for (const commit of commits) total += commit.batch.commands.length;
	return total;
}

function commandOps(commit: LynxTransportCommitMessage): UniversalHostCommand['op'][] {
	return commit.batch.commands.map((command) => command.op);
}

/** The universal core over the real wire, rendered once per state. */
function universalColumn(component: typeof Scene = Scene) {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const root = createUniversalRoot(container, createLynxClientDriver(container), {
		transport,
		scheduleMicrotask: (callback) => callback(),
	});
	transport.bindRoot(root);
	return {
		main,
		async render(props: SceneProps): Promise<void> {
			const before = main.commits.length;
			const rendering = root.renderAsync(component, props);
			await flushMicrotasks();
			for (let index = before; index < main.commits.length; index++) {
				main.acknowledge(main.commits[index]!);
			}
			await rendering;
			await flushMicrotasks();
		},
	};
}

/** The Block core over the same wire, driven directly. */
function blockColumn() {
	const context = new FakeContextProxy();
	const main = installMainSide(context);
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(context, container);
	const core = createLynxBlockCore();
	const root = createLynxBlockRoot({ container, transport, transportRoot: 1, core });
	transport.bindRoot(root);
	const page = core.mount(null, null, BLOCK_PAGE, []);
	const slot = core.openForSlot(page, 1);
	return {
		main,
		core,
		slot,
		async commit(): Promise<LynxTransportCommitMessage | null> {
			const before = main.commits.length;
			const committing = root.commit();
			await flushMicrotasks();
			if (main.commits.length === before) return committing.then(() => null);
			const commit = main.commits[main.commits.length - 1]!;
			main.acknowledge(commit);
			await committing;
			return commit;
		},
	};
}

function blockValues(row: Row, selected: number | null): readonly string[] {
	return [rowClass(row, selected), row.label];
}

describe('Lynx cores — the same page, painted by both', () => {
	it('paints the same tree for a first mount', async () => {
		const list = rows(4);

		const universal = universalColumn();
		await universal.render({ rows: list, selected: null });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));
	});

	it('paints the same tree after a scoped selection change', async () => {
		const list = rows(8);

		const universal = universalColumn();
		await universal.render({ rows: list, selected: null });
		await universal.render({ rows: list, selected: 5 });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		await block.commit();
		block.core.setKeyedSlotValue(block.slot, 5, BLOCK_ROW_CLASS, 'row danger');
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));
	});

	it('paints the same tree after a keyed reorder', async () => {
		const list = rows(6);
		const reordered = [list[3]!, list[0]!, list[5]!, list[1]!, list[2]!, list[4]!];

		const universal = universalColumn();
		await universal.render({ rows: list, selected: null });
		await universal.render({ rows: reordered, selected: null });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		await block.commit();
		block.core.reconcileForSlot(
			block.slot,
			BLOCK_ROW,
			reordered,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));
	});

	it('paints the same tree after an insert and a removal in one reconcile', async () => {
		const list = rows(5);
		const next = [list[0]!, { id: 99, label: 'inserted' }, list[2]!, list[4]!, list[1]!];

		const universal = universalColumn();
		await universal.render({ rows: list, selected: 3 });
		await universal.render({ rows: next, selected: 99 });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, 3),
		);
		await block.commit();
		block.core.reconcileForSlot(
			block.slot,
			BLOCK_ROW,
			next,
			(row) => row.id,
			(row) => blockValues(row, 99),
		);
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));
	});
});

describe('Lynx cores — what the wire already agrees about', () => {
	// #102 attributed the update-path debt to the background drain, not the wire:
	// `select@10k` reconciles 10,042 blueprints and emits ONE host command. This
	// is that finding stated as a test rather than a measurement — the two cores
	// send the same amount for the same scoped change, so a claim that the Block
	// core makes the *wire* cheaper on an update would be wrong.
	it('sends the same one command for a scoped change, from either core', async () => {
		const list = rows(200);

		const universal = universalColumn();
		await universal.render({ rows: list, selected: null });
		const universalMount = universal.main.commits.length;
		await universal.render({ rows: list, selected: 7 });
		const universalUpdate = universal.main.commits.slice(universalMount);

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		await block.commit();
		block.core.setKeyedSlotValue(block.slot, 7, BLOCK_ROW_CLASS, 'row danger');
		const blockUpdate = (await block.commit())!;

		expect(countCommands(universalUpdate)).toBe(1);
		expect(commandOps(blockUpdate)).toEqual(['update']);
		expect(countCommands(universalUpdate)).toBe(countCommands([blockUpdate]));
	});

	// And where they do differ on the wire: a mount. The universal core's own
	// command shape depends on what main advertised, so this reads the number
	// rather than pinning a particular encoding — what matters is that the Block
	// core's mount is one command for the whole dense run.
	it('mounts a whole list in one command from the Block core', async () => {
		const list = rows(64);

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_ROW,
			list,
			(row) => row.id,
			(row) => blockValues(row, null),
		);
		const commit = (await block.commit())!;

		// The page shell plus the run. Neither grows with the list.
		expect(commandOps(commit)).toEqual(['mount-template-run', 'mount-template-run']);

		const universal = universalColumn();
		await universal.render({ rows: list, selected: null });
		expect(countCommands(universal.main.commits)).toBeGreaterThan(0);
	});
});

// The worklet row: the one prop kind that used to end the template path.
//
// A `main-thread:` binding makes the universal core decline its collapsed
// template program, so that column falls back to a create per host and a set
// per prop. The Block core carries the descriptor in a value slot and mounts
// the whole list in one command. What has to survive that difference is
// everything a user can see: the same tree, the same event sites, and the same
// live handler on every row — same worklet, same captures, in the same order.
//
// The fixture is the plain row plus a handler, so one run carries a scalar slot
// and a descriptor slot together. That is the case worth proving: the slot mask
// has to admit an object on the bound slot without admitting one anywhere else.
describe('Lynx cores — the worklet row', () => {
	const TAP = 'block-core-differential:tap';

	const WORKLET_ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
		kind: 'host',
		type: 'view',
		bindings: [
			['class', 0],
			['main-thread:bindtap', 1],
		],
		children: [
			{
				kind: 'host',
				type: 'text',
				props: { class: 'col-label' },
				children: [{ kind: 'text', slot: 2 }],
			},
		],
	});

	const BLOCK_WORKLET_ROW = compileLynxBlockTemplate({
		nodes: [
			{
				type: 'view',
				parent: -1,
				props: {},
				bindings: [
					{ name: 'class', valueIndex: 0 },
					{ name: 'main-thread:bindtap', valueIndex: 1 },
				],
			},
			{ type: 'text', parent: 0, props: { class: 'col-label' } },
			{
				type: '#text',
				parent: 1,
				props: { value: '' },
				bindings: [{ name: 'value', valueIndex: 2 }],
			},
		],
		events: [],
	});

	// One value factory for both columns, so a difference in the painted handlers
	// is a difference between the cores rather than between fixtures. A compiler
	// rebuilds the descriptor on every render, which is why neither core may lean
	// on identity to decide whether the handler changed.
	function workletValues(
		row: Row,
		selected: number | null,
	): readonly UniversalHostTemplateProgramValue[] {
		return [rowClass(row, selected), { _wkltId: TAP, _c: { values: [row.id] } }, row.label];
	}

	const WorkletScene = defineUniversalComponent(
		LYNX_TRANSPORT_RENDERER,
		({ rows: list, selected }: SceneProps) =>
			universalValue(PAGE_PLAN, [
				universalFor(
					list,
					(row) => row.id,
					(row) => universalValue(WORKLET_ROW_PLAN, workletValues(row, selected)),
				),
			]),
	);

	/** What each painted row would actually run when its native event fires. */
	function handlers(
		papi: ReturnType<typeof createFakePAPI>,
	): readonly { id: string; captures: readonly unknown[]; activation: number }[] {
		const painted: readonly FakeNode[] = papi.pages[0]!.children[0]!.children[0]!.children;
		return painted.map((row) => {
			const listener = row.events.get('bindEvent:tap') as {
				value: { _wkltId: string; _owlt: number; _c?: { values: readonly unknown[] } };
			};
			return {
				id: listener.value._wkltId,
				captures: listener.value._c?.values ?? [],
				activation: listener.value._owlt,
			};
		});
	}

	function worklets(
		commits: readonly LynxTransportCommitMessage[],
	): readonly { id: string; captures: readonly unknown[] }[] {
		return handlers(host(commits)).map(({ id, captures }) => ({ id, captures }));
	}

	beforeAll(() => {
		registerMainThreadWorklet(TAP, undefined, function () {
			return null;
		});
	});

	it('paints the same live main-thread handler from either core', async () => {
		const list = rows(5);

		const universal = universalColumn(WorkletScene);
		await universal.render({ rows: list, selected: 3 });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_WORKLET_ROW,
			list,
			(row) => row.id,
			(row) => workletValues(row, 3),
		);
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));

		// The tree comparison keeps which node carries which channel but drops the
		// listener *values*, so the handlers are compared separately. Every row
		// runs its own worklet closed over its own row.
		expect(worklets(block.main.commits)).toEqual(
			list.map((row) => ({ id: TAP, captures: [row.id] })),
		);
		expect(worklets(universal.main.commits)).toEqual(worklets(block.main.commits));
		// Distinct activations, because a shared one would let releasing any row
		// take every other row's handler down with it.
		const activations = handlers(host(block.main.commits)).map((handler) => handler.activation);
		expect(new Set(activations).size).toBe(list.length);
	});

	it('paints the same tree after a scoped change beside a worklet', async () => {
		const list = rows(8);

		const universal = universalColumn(WorkletScene);
		await universal.render({ rows: list, selected: null });
		await universal.render({ rows: list, selected: 5 });

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_WORKLET_ROW,
			list,
			(row) => row.id,
			(row) => workletValues(row, null),
		);
		await block.commit();
		block.core.setKeyedSlotValue(block.slot, 5, BLOCK_ROW_CLASS, 'row danger');
		await block.commit();

		expect(paint(block.main.commits)).toEqual(paint(universal.main.commits));
		// The write next door left every handler alone. A core that re-sent the
		// worklet would still paint this tree, so the handlers are read again.
		expect(worklets(block.main.commits)).toEqual(worklets(universal.main.commits));
	});

	it('mounts a whole worklet list in one command from the Block core', async () => {
		const list = rows(64);

		const block = blockColumn();
		block.core.fillForSlot(
			block.slot,
			BLOCK_WORKLET_ROW,
			list,
			(row) => row.id,
			(row) => workletValues(row, null),
		);
		const commit = (await block.commit())!;

		// The page shell plus the run — the same two commands the plain row costs.
		// A worklet used to end the run and take the list back to a create per host.
		expect(commandOps(commit)).toEqual(['mount-template-run', 'mount-template-run']);
		// And that one command really installed all of them, rather than being
		// cheap by painting less.
		expect(worklets([commit])).toHaveLength(list.length);
	});
});
