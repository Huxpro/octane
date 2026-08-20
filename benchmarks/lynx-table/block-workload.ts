/**
 * Issue-#103 U0, re-run on the real slice.
 *
 * U0 measured the update path's architectural ceiling with a hand-written op
 * emitter (`prototype/app-service.js`) that kept its row state in a plain
 * array. It reported two numbers per operation: what that stub actually
 * touched, and what a keyed core *would* touch — the second hand-derived beside
 * the first, because at the time there was no keyed core to ask. U2 built one.
 * This module asks it, over the same operation ladder, and reports the counter
 * the core keeps itself.
 *
 * The chassis is `workload.ts`'s: the same cross-wired ContextProxy pair, the
 * same fake Element PAPI, the same real main-thread receiver, and the same
 * `__OCTANE_LYNX_PROF` accounting. Only the background core differs. That is
 * what makes a command count from this column comparable to one from the
 * `octane-lynx` column rather than merely adjacent to it.
 *
 * ## Two columns, because one of them would over-claim alone
 *
 * `scoped` drives the core the way a compiled block program with per-row
 * reactive slots would: a selection change writes two rows' `class` slot by
 * key. `reconcile` drives the same core the way the app's own `setRows(next)`
 * does today: hand the whole next list to `reconcileForSlot` and let it match
 * survivors by key. Both run the real core over the real wire; the only
 * difference is which entry point the state change reaches.
 *
 * They answer different questions, and reporting only the first would credit
 * the Block model with a win that belongs to the scoped write. Where they
 * agree — `create`, `swap` — the operation is structural and list-proportional
 * in any keyed core, which is the LIS pass doing its job rather than a defect.
 *
 * ## What this is not
 *
 * The block program below is hand-written: no hooks, no compiler, no component
 * bodies. It is a ceiling for the same reason U0's floor was one, and it must
 * be read as "what does the architecture cost", never as "what does Octane on
 * Lynx cost today". The `octane-lynx` column in `run.mjs` is the second number.
 */
import {
	compileLynxBlockTemplate,
	createLynxBlockCore,
} from '../../packages/lynx/src/core/block-core.js';
import type { LynxBlockForSlot } from '../../packages/lynx/src/core/block-core.js';
import { createLynxBlockRoot } from '../../packages/lynx/src/core/block-root.js';
import type { LynxBlockRoot } from '../../packages/lynx/src/core/block-root.js';
import { createLynxClientContainer } from '../../packages/lynx/src/core/client-driver.js';
import { createLynxBackgroundTransport } from '../../packages/lynx/src/core/transport.js';
import type { UniversalHostTemplateProgram } from 'octane/universal/native';

import { buildDataSeeded } from './app/src/data.js';
import type { RowData } from './app/src/data.js';
import {
	createWireChassis,
	profileSnapshot,
	summarizeWire,
	type FakeElementPAPI,
	type FakeNode,
	type OpCounters,
	type WireChassis,
} from './workload.js';

// -- the program, mirroring App.lynx.tsrx host-for-host -----------------------

/**
 * The toolbar's buttons, in the app's order. The ladder taps three of them and
 * the rest exist because they are on the page: the chrome is 41 host nodes in
 * the app and has to be 41 here, or a create count would not be comparable.
 */
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

type ProgramNode = UniversalHostTemplateProgram['nodes'][number];

function pageProgram(): UniversalHostTemplateProgram {
	const nodes: ProgramNode[] = [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'text', parent: 0, props: { class: 'title' } },
		{ type: '#text', parent: 1, props: { value: TITLE } },
		{ type: 'view', parent: 0, props: { class: 'toolbar' } },
	];
	const events: { node: number; type: string; priority: 'default' }[] = [];
	for (const label of BUTTON_LABELS) {
		const button = nodes.length;
		nodes.push({ type: 'view', parent: 3, props: { class: 'btn' } });
		nodes.push({ type: 'text', parent: button, props: { class: 'btn-text' } });
		nodes.push({ type: '#text', parent: button + 1, props: { value: label } });
		events.push({ node: button, type: 'bindtap', priority: 'default' });
	}
	nodes.push({ type: 'view', parent: 0, props: { class: 'rows' } });
	return { nodes, events };
}

const PAGE_TEMPLATE = compileLynxBlockTemplate(pageProgram());
/** Index of `<view class="rows">`, the range site every row block lives in. */
const ROWS_NODE = PAGE_TEMPLATE.hostCount - 1;

/**
 * One `<Row>`: seven host nodes and three live slots — the row's class, the id
 * text, and the label text. The two `bindtap` sites are the app's select and
 * remove handlers.
 */
const ROW_TEMPLATE = compileLynxBlockTemplate({
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
		{ node: 3, type: 'bindtap', priority: 'default' },
		{ node: 5, type: 'bindtap', priority: 'default' },
	],
});

/** Slot order is the template's binding order: class, id text, label text. */
const ROW_CLASS_SLOT = 0;
const ROW_LABEL_SLOT = 2;

function rowValues(row: RowData, selected: number | undefined): readonly string[] {
	return [row.id === selected ? 'row danger' : 'row', String(row.id), row.label];
}

/**
 * The app's own seeded rows, rebased onto ids 1..N.
 *
 * `data.ts` hands out ids from a module-global counter that never resets, so a
 * second call in the same process yields wider id strings than the first. That
 * is invisible to the app and to `workload.ts`, which gates on counts rather
 * than label-dependent bytes, but it would make the two columns here disagree
 * about `create` bytes for a reason that has nothing to do with either core.
 */
function seededRows(count: number): RowData[] {
	return buildDataSeeded(count).map((row, index) => ({ id: index + 1, label: row.label }));
}

// -- the background program ---------------------------------------------------

export type BlockDriveMode = 'scoped' | 'reconcile';

type BlockCore = ReturnType<typeof createLynxBlockCore>;

interface BlockProgram {
	readonly chassis: WireChassis;
	readonly root: LynxBlockRoot;
	readonly slot: LynxBlockForSlot;
	rows: RowData[];
	selected: number | undefined;
	commit(): Promise<void>;
	dispose(): void;
}

/**
 * Stand a block core on the real background transport and mount the page
 * shell. The transport root id is explicit because `universal-core.ts` keeps
 * its allocator module-private; see `block-root.ts`.
 */
function createBlockProgram(chassis: WireChassis, core: BlockCore): BlockProgram {
	const container = createLynxClientContainer();
	const transport = createLynxBackgroundTransport(chassis.contexts.background, container, {
		onDiagnostic: (error) => chassis.diagnostics.push(error),
	});
	const root = createLynxBlockRoot({ container, transport, transportRoot: 1, core });
	transport.bindRoot(root);

	const page = core.mount(null, null, PAGE_TEMPLATE, []);
	// The toolbar's handlers exist so the mounted program is a whole program:
	// the ladder drives state directly, but a template whose event sites were
	// declared and never bound would ship listener ids nothing could receive.
	root.bindListeners(
		page,
		BUTTON_LABELS.map(() => () => undefined),
	);
	const slot = core.openForSlot(page, ROWS_NODE);

	const program: BlockProgram = {
		chassis,
		root,
		slot,
		rows: [],
		selected: undefined,
		async commit() {
			await root.commit();
		},
		dispose() {
			transport.close();
		},
	};
	return program;
}

/** Bind the two per-row handlers of every block the last mount created. */
function bindRows(program: BlockProgram, keys: readonly number[]): void {
	for (const key of keys) {
		const block = program.slot.items.get(key);
		if (block === undefined) continue;
		program.root.bindListeners(block, [() => undefined, () => undefined]);
	}
}

// -- the operations, mirroring the app and workload.ts ------------------------

const STORM_UPDATE_TICKS = 50;
const STORM_SELECT_TICKS = 30;

/**
 * `create`: clear whatever is mounted and fill the range site. Structural in
 * both columns — a fresh list has no survivor to match, which is the
 * mount-linear path `runtime.ts` takes when `oldSize === 0`.
 */
function driveCreate(program: BlockProgram, core: BlockCore, rows: RowData[]): void {
	core.clearForSlot(program.slot);
	program.rows = rows;
	program.selected = undefined;
	core.fillForSlot(
		program.slot,
		ROW_TEMPLATE,
		rows,
		(row) => row.id,
		(row) => rowValues(row, undefined),
	);
	bindRows(
		program,
		rows.map((row) => row.id),
	);
}

/** `update`: rewrite every tenth label. */
function driveUpdateTenth(program: BlockProgram, core: BlockCore, mode: BlockDriveMode): void {
	const next = program.rows.slice();
	for (let index = 0; index < next.length; index += 10) {
		next[index] = { id: next[index]!.id, label: `${next[index]!.label} !!!` };
	}
	applyRows(program, core, mode, next, (changed) => {
		for (let index = 0; index < changed.length; index += 10) {
			core.setKeyedSlotValue(
				program.slot,
				changed[index]!.id,
				ROW_LABEL_SLOT,
				changed[index]!.label,
			);
		}
	});
}

/** `select`: move `.danger` from one row to another. */
function driveSelect(
	program: BlockProgram,
	core: BlockCore,
	mode: BlockDriveMode,
	id: number,
): void {
	const previous = program.selected;
	program.selected = id;
	applyRows(program, core, mode, program.rows, () => {
		if (previous !== undefined) {
			core.setKeyedSlotValue(program.slot, previous, ROW_CLASS_SLOT, 'row');
		}
		core.setKeyedSlotValue(program.slot, id, ROW_CLASS_SLOT, 'row danger');
	});
}

/** `swap`: exchange rows 1 and 998. Structural, so both columns reconcile. */
function driveSwap(program: BlockProgram, core: BlockCore): void {
	if (program.rows.length <= 998) return;
	const next = program.rows.slice();
	const first = next[1]!;
	next[1] = next[998]!;
	next[998] = first;
	program.rows = next;
	core.reconcileForSlot(
		program.slot,
		ROW_TEMPLATE,
		next,
		(row) => row.id,
		(row) => rowValues(row, program.selected),
	);
}

/**
 * The one seam between the two columns. `scoped` runs the caller's targeted
 * writes; `reconcile` throws the whole next list at the keyed reconciler, which
 * is what a `setRows(next)` costs when nothing scopes it.
 */
function applyRows(
	program: BlockProgram,
	core: BlockCore,
	mode: BlockDriveMode,
	next: RowData[],
	scoped: (rows: RowData[]) => void,
): void {
	program.rows = next;
	if (mode === 'scoped') {
		scoped(next);
		return;
	}
	core.reconcileForSlot(
		program.slot,
		ROW_TEMPLATE,
		next,
		(row) => row.id,
		(row) => rowValues(row, program.selected),
	);
}

// -- measurement --------------------------------------------------------------

export interface BlockOpCounters extends Pick<
	OpCounters,
	| 'commits'
	| 'commands'
	| 'bytes'
	| 'wireToMainBytes'
	| 'wireToBackgroundBytes'
	| 'wireToMainMessages'
	| 'wireToBackgroundMessages'
	| 'commandOps'
	| 'handleOps'
	| 'messageTypes'
> {
	/** Blocks the core visited to service this operation. The U0 gate metric. */
	readonly blockLookups: number;
}

export interface BlockRunResult {
	readonly rows: number;
	readonly mode: BlockDriveMode;
	readonly create: BlockOpCounters;
	readonly update10th: BlockOpCounters;
	readonly select: BlockOpCounters;
	readonly swap: BlockOpCounters;
	readonly updateStorm: BlockOpCounters;
	readonly selectStorm: BlockOpCounters;
	readonly createdElements: number;
	readonly mountedRows: number;
	readonly firstRowClasses: string;
	readonly firstRowLabel: string;
	readonly diagnostics: readonly string[];
}

function hasClass(node: FakeNode, name: string): boolean {
	return node.classes.split(/\s+/).includes(name);
}

function findAll(papi: FakeElementPAPI, match: (node: FakeNode) => boolean): FakeNode[] {
	const found: FakeNode[] = [];
	for (const node of papi.nodes.values()) if (match(node)) found.push(node);
	return found;
}

function rowViews(papi: FakeElementPAPI): FakeNode[] {
	return findAll(papi, (node) => node.type === 'view' && hasClass(node, 'row'));
}

function labelOf(row: FakeNode): string {
	for (const child of row.children) {
		if (!hasClass(child, 'col-label')) continue;
		return child.children.map((grandchild) => grandchild.text).join('') || child.text;
	}
	return '';
}

function seededRandom(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** Run the ladder at one scale in one drive mode and report per-op deltas. */
export async function runBlockTable(rows: number, mode: BlockDriveMode): Promise<BlockRunResult> {
	const chassis = createWireChassis();
	const core = createLynxBlockCore();
	const previousRandom = Math.random;
	Math.random = seededRandom(0x0c7a_4e11);
	let program: BlockProgram | null = null;
	try {
		program = createBlockProgram(chassis, core);
		await program.commit();

		const measure = async (drive: () => Promise<void>): Promise<BlockOpCounters> => {
			const before = profileSnapshot();
			const beforeLookups = core.counters().blockLookups;
			const wireStart = chassis.wireMessages.length;
			await drive();
			const after = profileSnapshot();
			return {
				commits: after.commits - before.commits,
				commands: after.commands - before.commands,
				bytes: after.bytes - before.bytes,
				blockLookups: core.counters().blockLookups - beforeLookups,
				...summarizeWire(chassis.wireMessages.slice(wireStart)),
			};
		};

		const live = program;
		const create = await measure(async () => {
			driveCreate(live, core, seededRows(rows));
			await live.commit();
		});

		const update10th = await measure(async () => {
			driveUpdateTenth(live, core, mode);
			await live.commit();
		});

		// Two selections: the first turns selection on, the second is the steady
		// state the op measures — one row gains `.danger`, one loses it.
		driveSelect(live, core, mode, live.rows[1]!.id);
		await live.commit();
		const select = await measure(async () => {
			driveSelect(live, core, mode, live.rows[2]!.id);
			await live.commit();
		});

		const swap = await measure(async () => {
			driveSwap(live, core);
			await live.commit();
		});

		const updateStorm = await measure(async () => {
			for (let tick = 1; tick <= STORM_UPDATE_TICKS; tick++) {
				const next = live.rows.slice();
				for (let index = 0; index < next.length; index += 10) {
					next[index] = { id: next[index]!.id, label: `bench ${tick}` };
				}
				applyRows(live, core, mode, next, (changed) => {
					for (let index = 0; index < changed.length; index += 10) {
						core.setKeyedSlotValue(
							live.slot,
							changed[index]!.id,
							ROW_LABEL_SLOT,
							changed[index]!.label,
						);
					}
				});
				await live.commit();
			}
		});

		const selectStorm = await measure(async () => {
			const ids = live.rows.map((row) => row.id);
			for (let tick = 1; tick <= STORM_SELECT_TICKS; tick++) {
				const id = tick < STORM_SELECT_TICKS ? ids[(tick * 97) % ids.length]! : ids[0]!;
				driveSelect(live, core, mode, id);
				await live.commit();
			}
		});

		const painted = rowViews(chassis.papi);
		const first = painted[0];
		return {
			rows,
			mode,
			create,
			update10th,
			select,
			swap,
			updateStorm,
			selectStorm,
			createdElements: chassis.papi.createdElements,
			mountedRows: painted.length,
			firstRowClasses: first === undefined ? '' : first.classes,
			firstRowLabel: first === undefined ? '' : labelOf(first),
			diagnostics: chassis.diagnostics.map((error) => error.message),
		};
	} finally {
		program?.dispose();
		chassis.main.close();
		Math.random = previousRandom;
	}
}

export { STORM_UPDATE_TICKS, STORM_SELECT_TICKS };
