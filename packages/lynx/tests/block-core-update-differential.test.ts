// Issue-#103 B0 slice 2: the two cores over one commit stream.
//
// `block-core-differential.test.ts` compares the two cores on a first mount and
// on three single update shapes, each from a fresh pair of roots. That is the
// right test for "does the Block core produce the same tree", and it is not the
// test for "can the Block core drive an application", because an application is
// a *stream*: state after state, on roots that keep their identity and their
// allocator across every step. A divergence in step 3 that step 4 happens to
// overwrite is invisible to a per-scenario comparison and fatal in a product.
//
// So one ladder — the `lynx-table` operation ladder — is applied to one pair of
// roots, and all three artifacts are compared after *every* step:
//
//   physical tree    what the shared applier painted, including event sites.
//   handle journal   `LynxPreparedHostBatch.handleDelta`, the clone-safe public
//                    handle changes main publishes before acknowledging. This
//                    is what the background adopts, so two cores that paint the
//                    same tree while publishing different handles would break
//                    adoption without breaking any pixel.
//   event journal    every `setEvent` the applier issued, in order, with what
//                    it installed or cleared.
//
// Compared byte-for-byte on the serialized artifact, after one normalization
// and no other: the two cores are different allocators and never had to agree
// about a number. Every integer identity — host ids in a selector or a handle,
// the numeric fields of a native event token, the node a journal entry names —
// is replaced by its rank in first-appearance order within the artifact itself.
// That is a bijection or the comparison fails, so what survives is the claim
// worth making: the same events, over the same nodes, in the same order.
import { describe, expect, it } from 'vitest';

import {
	createUniversalRoot,
	defineUniversalComponent,
	universalFor,
	universalPlan,
	universalValue,
} from 'octane/universal/native';

import { LYNX_TRANSPORT_RENDERER, type LynxTransportCommitMessage } from '../src/core/protocol.js';
import { createLynxBackgroundTransport } from '../src/core/transport.js';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxBlockRoot } from '../src/core/block-root.js';
import { FakeContextProxy, flushMicrotasks, installMainSide } from './_fixtures/fake-lynx-wire.js';
import { paint } from './_fixtures/painted-commits.js';

const ROWS = 120;

interface Row {
	readonly id: number;
	readonly label: string;
}

interface SceneProps {
	readonly rows: readonly Row[];
	readonly selected: number | null;
}

function seed(count: number): Row[] {
	return Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		label: `row ${index + 1}`,
	}));
}

const rowClass = (row: Row, selected: number | null) =>
	row.id === selected ? 'row danger' : 'row';

// One event site per row, so the event journal is a real artifact rather than an
// empty list that would agree with anything.
const ROW_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [
		['class', 0],
		['bindtap', 2],
	],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'col-label' },
			children: [{ kind: 'text', slot: 1 }],
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
	],
	events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
});

const BLOCK_CLASS_SLOT = 0;

const Scene = defineUniversalComponent(LYNX_TRANSPORT_RENDERER, ({ rows, selected }: SceneProps) =>
	universalValue(PAGE_PLAN, [
		universalFor(
			rows,
			(row) => row.id,
			(row) => universalValue(ROW_PLAN, [rowClass(row, selected), row.label, () => row.id]),
		),
	]),
);

function universalColumn() {
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
			const rendering = root.renderAsync(Scene, props);
			await flushMicrotasks();
			for (let index = before; index < main.commits.length; index++) {
				main.acknowledge(main.commits[index]!);
			}
			await rendering;
			await flushMicrotasks();
		},
	};
}

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
	let acknowledged = 0;
	return {
		main,
		core,
		slot,
		/** Bind every member of the range, as a compiled program would on mount. */
		bind(): void {
			for (const [key, block] of slot.items) root.bindListeners(block, [() => key]);
		},
		/**
		 * Release a departing block's listeners before its run is destroyed —
		 * the obligation `block-root.ts` documents and `reconcileForSlot`'s
		 * `departed` callback exists to satisfy.
		 */
		release(block: Parameters<typeof root.releaseListeners>[0]): void {
			root.releaseListeners(block);
		},
		async commit(): Promise<void> {
			const committing = root.commit();
			await flushMicrotasks();
			while (acknowledged < main.commits.length) {
				main.acknowledge(main.commits[acknowledged++]!);
			}
			await committing;
			await flushMicrotasks();
		},
	};
}

type BlockColumn = ReturnType<typeof blockColumn>;

const blockValues = (row: Row, selected: number | null): readonly string[] => [
	rowClass(row, selected),
	row.label,
];

/**
 * One state transition, described once and driven into both cores.
 *
 * `universal` is the next props; `block` is what a compiled block program would
 * call for the same transition. They are two descriptions of one intent, and
 * the test is that the host cannot tell which one it was handed.
 */
interface Step {
	readonly name: string;
	readonly universal: SceneProps;
	readonly block: (column: BlockColumn) => void;
}

function ladder(): Step[] {
	const base = seed(ROWS);
	const updated = base.map((row, index) =>
		index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row,
	);
	const swapped = [...updated];
	const [low, high] = [1, ROWS - 2];
	[swapped[low], swapped[high]] = [swapped[high]!, swapped[low]!];
	const removed = swapped.filter((_, index) => index % 7 !== 3);
	const appended = [
		...removed,
		{ id: ROWS + 1, label: 'appended one' },
		{ id: ROWS + 2, label: 'appended two' },
	];
	const reconcile =
		(rows: readonly Row[], selected: number | null) =>
		(column: BlockColumn): void => {
			column.core.reconcileForSlot(
				column.slot,
				BLOCK_ROW,
				rows,
				(row) => row.id,
				(row) => blockValues(row, selected),
				(block) => column.release(block),
			);
			column.bind();
		};

	return [
		{
			name: 'create',
			universal: { rows: base, selected: null },
			block: (column) => {
				column.core.fillForSlot(
					column.slot,
					BLOCK_ROW,
					base,
					(row) => row.id,
					(row) => blockValues(row, null),
				);
				column.bind();
			},
		},
		{
			name: 'update every 10th',
			universal: { rows: updated, selected: null },
			block: reconcile(updated, null),
		},
		{
			name: 'select one row',
			universal: { rows: updated, selected: 7 },
			// The scoped write the ceiling is about: one key lookup, one command.
			block: (column) => {
				column.core.setKeyedSlotValue(column.slot, 7, BLOCK_CLASS_SLOT, 'row danger');
			},
		},
		{
			name: 'move the selection',
			universal: { rows: updated, selected: ROWS - 3 },
			block: (column) => {
				column.core.setKeyedSlotValue(column.slot, 7, BLOCK_CLASS_SLOT, 'row');
				column.core.setKeyedSlotValue(column.slot, ROWS - 3, BLOCK_CLASS_SLOT, 'row danger');
			},
		},
		{
			name: 'swap two rows',
			universal: { rows: swapped, selected: ROWS - 3 },
			block: reconcile(swapped, ROWS - 3),
		},
		{
			name: 'remove every seventh',
			universal: { rows: removed, selected: ROWS - 3 },
			block: reconcile(removed, ROWS - 3),
		},
		{
			name: 'append two',
			universal: { rows: appended, selected: ROWS - 3 },
			block: reconcile(appended, ROWS - 3),
		},
		{ name: 'clear', universal: { rows: [], selected: null }, block: reconcile([], null) },
		{ name: 'refill', universal: { rows: base, selected: 3 }, block: reconcile(base, 3) },
	];
}

/**
 * Compare two serialized artifacts and, when they differ, say where.
 *
 * These artifacts are tens of kilobytes of one line. A raw equality failure
 * prints both in full and buries the one place they diverge, so the failure
 * carries the divergence itself: the common prefix length and a window around
 * the first differing character.
 */
function expectSame(actual: string, expected: string, label: string): void {
	if (actual === expected) return;
	let index = 0;
	while (index < actual.length && index < expected.length && actual[index] === expected[index]) {
		index++;
	}
	const window = (text: string) => text.slice(Math.max(0, index - 160), index + 160);
	throw new Error(
		`${label}: diverges at character ${index} of ${expected.length}\n` +
			`  universal … ${window(expected)}\n` +
			`  block     … ${window(actual)}`,
	);
}

/** Every op except the ones that spell out a mount, counted over a whole run. */
function mutationOps(commits: readonly LynxTransportCommitMessage[]): Record<string, number> {
	const mount = new Set(['create', 'insert', 'event', 'mount-template-run']);
	const counts: Record<string, number> = {};
	for (const commit of commits) {
		for (const command of commit.batch.commands) {
			if (mount.has(command.op)) continue;
			counts[command.op] = (counts[command.op] ?? 0) + 1;
		}
	}
	return counts;
}

describe('Lynx cores — one commit stream, two cores', () => {
	it('keeps the physical tree, handle journal, and event journal equal at every step', async () => {
		const steps = ladder();
		const universal = universalColumn();
		const block = blockColumn();

		for (const step of steps) {
			await universal.render(step.universal);
			step.block(block);
			await block.commit();

			const fromUniversal = paint(universal.main.commits);
			const fromBlock = paint(block.main.commits);
			expectSame(fromBlock.tree, fromUniversal.tree, `${step.name}: physical tree`);
			expectSame(fromBlock.handles, fromUniversal.handles, `${step.name}: handle journal`);
			expectSame(fromBlock.events, fromUniversal.events, `${step.name}: event journal`);
			// The mutation the host is asked to perform, which the artifacts above
			// cannot see: they compare the result, and two cores could reach it by
			// asking for different amounts of work. `mount` is excluded because
			// that is exactly where the cores differ on purpose — the universal
			// core spells a mount as create/insert/event per host and the Block
			// core as one `mount-template-run` per dense run.
			expect(mutationOps(block.main.commits), `${step.name}: mutation work`).toEqual(
				mutationOps(universal.main.commits),
			);
		}
	});
});
