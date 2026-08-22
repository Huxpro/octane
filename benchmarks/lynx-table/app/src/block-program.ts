/**
 * Issue-#103 B0 — the `octane-block` cell's background program.
 *
 * `App.lynx.tsrx` is the same benchmark UI written the way an Octane
 * application is written: hooks, a `Row` component, a keyed `@for`. The Block
 * core cannot run it, and says so by name rather than rendering something
 * partial — it has no hook cells, so a compiled component has no program to be
 * (`packages/lynx/src/core/block-background.ts`). This module is what stands in
 * until it does: the same page, host-for-host, driven directly against the
 * core.
 *
 * ## Read every number from this cell as an architecture ceiling
 *
 * Hand-written, exactly as `benchmarks/lynx-table/block-workload.ts` says of
 * its own program. It is what the update path *could* cost once a lowering
 * emits this shape, never what Octane on Lynx costs today. The `octane` cell is
 * the second number, and the two are only comparable because they are one
 * application entry, one bundle recipe, and one page driver, with the build
 * flag as the single variable.
 *
 * ## Two drive modes, because one of them would over-claim alone
 *
 * `scoped` writes the slot that changed, by key: what a lowering with per-row
 * reactive cells emits for a selection or a label edit. `reconcile` hands the
 * whole next list to the keyed reconciler: what `setRows(next)` costs when
 * nothing scopes it, which is what the `octane` cell does today. Build both
 * (`BENCH_BLOCK_MODE=reconcile`) before quoting either; where they agree —
 * create, swap, remove — the operation is structural in any keyed core.
 */
// `@octanejs/lynx/block`, not the package root: the plugin replaces the bare
// root request with the first-screen facade on the main-thread layer, and this
// module is linked into both layers because the entry is. See src/block.ts.
import {
	compileLynxBlockTemplate,
	withLynxBlockProgram,
	type LynxBlock,
	type LynxBlockCore,
	type LynxBlockForSlot,
	type LynxBlockProgram,
	type LynxBlockProgramContext,
	type LynxBlockTemplate,
} from '@octanejs/lynx/block';

import { buildData, buildDataSeeded } from './data.js';
import type { RowData } from './data.js';

declare const __BENCH_AUTOROWS__: number;
declare const __BENCH_BLOCK_MODE__: string;

/** The toolbar, in `App.lynx.tsrx`'s order. The page driver clicks by text. */
const BUTTON_LABELS = [
	'Create 1,000 rows',
	'Create 3,000 rows',
	'Create 5,000 rows',
	'Create 10,000 rows',
	'Create 20,000 rows',
	'Create 30,000 rows',
	'Append 1,000 rows',
	'Update every 10th row',
	'Swap Rows',
	'Clear',
	'Update storm',
	'Select storm',
];

const TITLE = 'Octane UI Benchmark on Lynx · ready';

type TemplateNode = LynxBlockTemplate['program']['nodes'][number];

/**
 * What `createLynxClientDriver` classifies `bindtap` as, so the two cells
 * declare the same thing for the same site.
 *
 * The Block core never branches on a priority — it carries the declaration to
 * the listener descriptor, and `block-root.ts` refuses a delivery whose
 * transported priority disagrees with it. So this is not a scheduling knob
 * here, and correcting it does not move a number. It matters because the `octane`
 * cell reaches `discrete` through the driver (`tap` is in `DISCRETE_EVENTS`),
 * and because the lowering that will replace this file asks the driver rather
 * than restating an answer: a hand-written `'default'` would have shown up as a
 * diff the day the compiled program landed, in the cell whose whole purpose is
 * to hold every variable but one fixed.
 */
const TAP_PRIORITY = 'discrete' as const;

function pageTemplate(): LynxBlockTemplate {
	const nodes: TemplateNode[] = [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'text', parent: 0, props: { class: 'title' } },
		{ type: '#text', parent: 1, props: { value: TITLE } },
		{ type: 'view', parent: 0, props: { class: 'toolbar' } },
	];
	const events: { node: number; type: string; priority: typeof TAP_PRIORITY }[] = [];
	for (const label of BUTTON_LABELS) {
		const button = nodes.length;
		nodes.push({ type: 'view', parent: 3, props: { class: 'btn' } });
		nodes.push({ type: 'text', parent: button, props: { class: 'btn-text' } });
		nodes.push({ type: '#text', parent: button + 1, props: { value: label } });
		events.push({ node: button, type: 'bindtap', priority: TAP_PRIORITY });
	}
	nodes.push({ type: 'view', parent: 0, props: { class: 'rows' } });
	return compileLynxBlockTemplate({ nodes, events });
}

/**
 * Compiled on first mount rather than at module scope.
 *
 * The entry is compiled into the main-thread layer as well as the background
 * one, so a module-scope compile here would run on the main thread during the
 * first screen — real first-paint cost, in the cell whose FCP is being
 * compared. `mount` only ever runs on the background thread.
 */
let templates: { page: LynxBlockTemplate; rowsNode: number; row: LynxBlockTemplate } | null = null;

function loadTemplates(): NonNullable<typeof templates> {
	if (templates !== null) return templates;
	const page = pageTemplate();
	templates = { page, rowsNode: page.hostCount - 1, row: rowTemplate() };
	return templates;
}

/** One `<Row>`: seven host nodes, three live slots, two tap sites. */
function rowTemplate(): LynxBlockTemplate {
	return compileLynxBlockTemplate({
		nodes: [
			{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
			{ type: 'text', parent: 0, props: { class: 'col-id' } },
			{
				type: '#text',
				parent: 1,
				props: { value: '' },
				bindings: [{ name: 'value', valueIndex: 1 }],
			},
			{ type: 'text', parent: 0, props: { class: 'col-label' } },
			{
				type: '#text',
				parent: 3,
				props: { value: '' },
				bindings: [{ name: 'value', valueIndex: 2 }],
			},
			{ type: 'text', parent: 0, props: { class: 'col-remove' } },
			{ type: '#text', parent: 5, props: { value: 'x' } },
		],
		events: [
			{ node: 3, type: 'bindtap', priority: TAP_PRIORITY },
			{ node: 5, type: 'bindtap', priority: TAP_PRIORITY },
		],
	});
}

/** Slot order is the template's binding order: class, id text, label text. */
const ROW_CLASS_SLOT = 0;
const ROW_LABEL_SLOT = 2;

function rowValues(row: RowData, selected: number | undefined): readonly string[] {
	return [row.id === selected ? 'row danger' : 'row', String(row.id), row.label];
}

// -- storms, tick-for-tick with App.lynx.tsrx --------------------------------
// Each tick is its own macrotask so every mutation goes through a full commit
// instead of batching. A MessageChannel avoids the nested setTimeout 4ms clamp.
const STORM_UPDATE_TICKS = 50;
const STORM_SELECT_TICKS = 30;

const stormChannel = new MessageChannel();
let stormPending: (() => void) | null = null;
stormChannel.port1.onmessage = () => {
	const callback = stormPending;
	stormPending = null;
	if (callback) callback();
};

function runStorm(ticks: number, step: (tick: number) => void): void {
	let tick = 0;
	const next = () => {
		tick += 1;
		step(tick);
		if (tick < ticks) {
			stormPending = next;
			stormChannel.port2.postMessage(0);
		}
	};
	stormPending = next;
	stormChannel.port2.postMessage(0);
}

// -- the program -------------------------------------------------------------

interface TableState {
	core: LynxBlockCore;
	context: LynxBlockProgramContext;
	slot: LynxBlockForSlot;
	rowTemplate: LynxBlockTemplate;
	rows: RowData[];
	selected: number | undefined;
	/**
	 * The two indexes a per-block resource owner needs, because the core has a
	 * `departed` callback and no `arrived` one: `boundKeys` answers "does this
	 * key already own its listeners" for the post-reconcile sweep, and
	 * `keyOfBlock` answers "which key is leaving" in O(1) when one departs.
	 * Searching the range for the departing block instead would make a clear
	 * quadratic, which would show up in the measurement as core cost.
	 */
	boundKeys: Set<number>;
	keyOfBlock: Map<LynxBlock, number>;
	/** Commits run one at a time; a failure is reported, never swallowed. */
	committing: Promise<unknown>;
}

/**
 * `scoped` runs the caller's targeted writes; `reconcile` throws the whole next
 * list at the keyed reconciler. Structural operations ignore the mode: an
 * insert, a removal, and a swap have no scoped spelling in either core.
 */
const SCOPED = __BENCH_BLOCK_MODE__ !== 'reconcile';

/**
 * Give every block that arrived since the last sweep its two handlers.
 *
 * Linear in the range, which is why it runs only after a structural operation:
 * a scoped write creates no block, so `select` and `update every 10th` never
 * reach here. A structural operation is already linear in both cores, so this
 * does not put the block column ahead of or behind the component column.
 */
function bindNewRows(state: TableState): void {
	for (const [key, block] of state.slot.items) {
		const id = key as number;
		if (state.boundKeys.has(id)) continue;
		state.boundKeys.add(id);
		state.keyOfBlock.set(block, id);
		state.context.root.bindListeners(block, [() => select(state, id), () => remove(state, id)]);
	}
}

/** Every departure releases its listeners before its run is destroyed. */
function departed(state: TableState): (block: LynxBlock) => void {
	return (block) => {
		const key = state.keyOfBlock.get(block);
		if (key !== undefined) {
			state.keyOfBlock.delete(block);
			state.boundKeys.delete(key);
		}
		state.context.root.releaseListeners(block);
	};
}

function reconcile(state: TableState, next: RowData[]): void {
	state.rows = next;
	state.core.reconcileForSlot(
		state.slot,
		state.rowTemplate,
		next,
		(row) => row.id,
		(row) => rowValues(row, state.selected),
		departed(state),
	);
	bindNewRows(state);
}

/**
 * One commit at a time, and a failure that reaches the page rather than a
 * rejected promise nobody awaited. A cell whose commits are failing would
 * otherwise still produce timings — of a page that stopped updating.
 */
function commit(state: TableState): void {
	state.committing = state.committing.then(
		() => state.context.commit(),
		() => state.context.commit(),
	);
	state.committing.catch((error: unknown) => {
		console.error('[octane-block] commit failed', error);
	});
}

function create(state: TableState, count: number): void {
	state.core.clearForSlot(state.slot, departed(state));
	state.rows = buildData(count);
	state.selected = undefined;
	state.core.fillForSlot(
		state.slot,
		state.rowTemplate,
		state.rows,
		(row) => row.id,
		(row) => rowValues(row, undefined),
	);
	bindNewRows(state);
	commit(state);
}

function append(state: TableState): void {
	reconcile(state, state.rows.concat(buildData(1000)));
	commit(state);
}

function updateTenth(state: TableState): void {
	const next = state.rows.slice();
	for (let index = 0; index < next.length; index += 10) {
		next[index] = { id: next[index]!.id, label: `${next[index]!.label} !!!` };
	}
	if (SCOPED) {
		state.rows = next;
		for (let index = 0; index < next.length; index += 10) {
			state.core.setKeyedSlotValue(state.slot, next[index]!.id, ROW_LABEL_SLOT, next[index]!.label);
		}
	} else {
		reconcile(state, next);
	}
	commit(state);
}

function select(state: TableState, id: number): void {
	const previous = state.selected;
	if (previous === id) return;
	state.selected = id;
	if (SCOPED) {
		if (previous !== undefined) {
			state.core.setKeyedSlotValue(state.slot, previous, ROW_CLASS_SLOT, 'row');
		}
		state.core.setKeyedSlotValue(state.slot, id, ROW_CLASS_SLOT, 'row danger');
	} else {
		reconcile(state, state.rows);
	}
	commit(state);
}

function remove(state: TableState, id: number): void {
	const index = state.rows.findIndex((row) => row.id === id);
	if (index < 0) return;
	reconcile(state, state.rows.slice(0, index).concat(state.rows.slice(index + 1)));
	commit(state);
}

function swap(state: TableState): void {
	if (state.rows.length <= 998) return;
	const next = state.rows.slice();
	const first = next[1]!;
	next[1] = next[998]!;
	next[998] = first;
	reconcile(state, next);
	commit(state);
}

function clear(state: TableState): void {
	state.core.clearForSlot(state.slot, departed(state));
	state.rows = [];
	state.selected = undefined;
	commit(state);
}

function updateStorm(state: TableState): void {
	runStorm(STORM_UPDATE_TICKS, (tick) => {
		const next = state.rows.map((row, index) =>
			index % 10 === 0 ? { id: row.id, label: 'bench ' + tick } : row,
		);
		if (SCOPED) {
			state.rows = next;
			for (let index = 0; index < next.length; index += 10) {
				state.core.setKeyedSlotValue(
					state.slot,
					next[index]!.id,
					ROW_LABEL_SLOT,
					next[index]!.label,
				);
			}
		} else {
			reconcile(state, next);
		}
		commit(state);
	});
}

function selectStorm(state: TableState): void {
	const ids = state.rows.map((row) => row.id);
	if (ids.length === 0) return;
	runStorm(STORM_SELECT_TICKS, (tick) => {
		select(state, tick < STORM_SELECT_TICKS ? ids[(tick * 97) % ids.length]! : ids[0]!);
	});
}

function tableProgram(): LynxBlockProgram<Record<string, never>> {
	let state: TableState | null = null;
	return {
		mount(context) {
			const core = context.core;
			const { page: pageTemplate, rowsNode, row: rowTemplate } = loadTemplates();
			const page = core.mount(null, null, pageTemplate, []);
			const slot = core.openForSlot(page, rowsNode);
			const table: TableState = {
				core,
				context,
				slot,
				rowTemplate,
				rows: [],
				selected: undefined,
				boundKeys: new Set<number>(),
				keyOfBlock: new Map<LynxBlock, number>(),
				committing: Promise.resolve(),
			};
			state = table;
			const handlers: (() => void)[] = [
				() => create(table, 1000),
				() => create(table, 3000),
				() => create(table, 5000),
				() => create(table, 10000),
				() => create(table, 20000),
				() => create(table, 30000),
				() => append(table),
				() => updateTenth(table),
				() => swap(table),
				() => clear(table),
				() => updateStorm(table),
				() => selectStorm(table),
			];
			context.root.bindListeners(page, handlers);
			// Mount-create ladder: the same pre-populated variant the component
			// build gets from `BENCH_AUTOROWS`, so the two cells mount the same page.
			if (__BENCH_AUTOROWS__ > 0) {
				table.rows = buildDataSeeded(__BENCH_AUTOROWS__);
				core.fillForSlot(
					slot,
					rowTemplate,
					table.rows,
					(row) => row.id,
					(row) => rowValues(row, undefined),
				);
				bindNewRows(table);
			}
		},
		unmount() {
			if (state === null) return;
			state.core.clearForSlot(state.slot, departed(state));
			state = null;
		},
	};
}

/**
 * `App` unchanged, carrying the program above. A `core: 'universal'` build
 * ignores the attachment and renders the component; a `core: 'block'` build
 * runs the program and never calls the component.
 */
export function blockApp<Component>(component: Component): Component {
	return withLynxBlockProgram(component as never, tableProgram() as never) as unknown as Component;
}
