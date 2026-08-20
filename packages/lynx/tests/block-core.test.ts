// Issue-#103 U2: the first vertical slice of the Lynx-specialized background
// core. Two contracts are under test and they are separate claims.
//
// 1. Equivalence. An incremental Block-core update leaves the physical tree
//    identical to a fresh mount of the same logical state. That is the oracle
//    a differential test needs and it does not depend on the universal core
//    agreeing about anything, which matters because the two cores are different
//    allocators and never had to agree about host ids.
//
// 2. Change-proportionality. The counts a keyed core pays to service a scoped
//    update do not move when the list grows by three orders of magnitude. This
//    is the #103 U0 gate, restated against a real key map and a real LIS rather
//    than the hand-written stub U0 measured.
import { describe, expect, it } from 'vitest';

import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import {
	compileLynxBlockTemplate,
	createLynxBlockCore,
	type LynxBlockCore,
	type LynxBlockForSlot,
	type LynxBlockTemplate,
} from '../src/core/block-core.js';
import { createFakePAPI, shape, type FakeNode } from './_fixtures/fake-element-papi.js';

// The lynx-table fixture's class contract, which the benchmark harness pins:
// .page > .rows > .row(.danger) > .col-id / .col-label / .col-remove.
const PAGE_TEMPLATE = compileLynxBlockTemplate({
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
});

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

const ROW_CLASS = 0;
const ROW_ID = 1;
const ROW_LABEL = 2;

interface Row {
	readonly id: number;
	readonly label: string;
}

function rows(count: number, offset = 0): Row[] {
	const list: Row[] = new Array(count);
	for (let index = 0; index < count; index++) {
		list[index] = { id: offset + index + 1, label: `row ${offset + index + 1}` };
	}
	return list;
}

function rowValues(
	row: Row,
	selected: number | null,
): readonly (string | number | boolean | null)[] {
	return [row.id === selected ? 'row danger' : 'row', String(row.id), row.label];
}

interface Scene {
	readonly core: LynxBlockCore;
	readonly slot: LynxBlockForSlot;
	readonly papi: ReturnType<typeof createFakePAPI>;
	apply(): void;
	tree(): unknown;
}

/** Mount the page chrome and fill the row range site, then paint. */
function scene(list: readonly Row[], selected: number | null): Scene {
	const papi = createFakePAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	const core = createLynxBlockCore();
	const page = core.mount(null, null, PAGE_TEMPLATE, []);
	const slot = core.openForSlot(page, 1);
	core.fillForSlot(
		slot,
		ROW_TEMPLATE,
		list,
		(row) => row.id,
		(row) => rowValues(row, selected),
	);
	const apply = (): void => {
		const batch = core.flush();
		if (batch === null) return;
		prepareLynxHostBatch(container, batch).apply();
	};
	apply();
	return { core, slot, papi, tree: () => shape(papi.pages[0]!), apply };
}

// `r{root}-h{id}-g{generation}`, the shape `host-driver.ts` writes into the
// nodes-ref selector.
const SELECTOR = /^r(\d+)-h\d+-g(\d+)$/;

/**
 * Strip the two places `shape()` carries an allocator's choice of number rather
 * than a property of the tree: the native event token, which encodes the host id
 * and the listener id, and the nodes-ref selector, which is the host id spelled
 * out. Two scenes that reach the same tree by different command sequences run
 * different id sequences to get there, so comparing those numbers would report a
 * difference that is not one.
 *
 * What survives is everything the numbers were standing in for. Event *sites*
 * must still match exactly — which node carries which `kind:name` — and the
 * selector keeps its root and its **generation**, because a generation bump
 * means an instance was replaced rather than reused, which is precisely what
 * these tests exist to catch.
 */
function withoutAllocatorIdentity(node: unknown): unknown {
	const value = node as {
		events: [string, unknown][];
		children: unknown[];
		selector: string;
	};
	const selector =
		value.selector === ''
			? ''
			: value.selector.replace(SELECTOR, (_, root, generation) => {
					return `r${root}-h*-g${generation}`;
				});
	// A selector this pattern does not recognise would be silently compared as
	// itself, which would make the normalization look sound while hiding a
	// format change. Fail instead.
	if (value.selector !== '' && selector === value.selector) {
		throw new Error(`unrecognised nodes-ref selector ${JSON.stringify(value.selector)}`);
	}
	return {
		...(value as object),
		selector,
		events: value.events.map(([name]) => name),
		children: value.children.map(withoutAllocatorIdentity),
	};
}

describe('Lynx block core — equivalence with a fresh mount', () => {
	it('leaves the tree a scoped selection change produces identical to mounting it selected', () => {
		const list = rows(10);
		const incremental = scene(list, null);
		incremental.core.setKeyedSlotValue(incremental.slot, 5, ROW_CLASS, 'row danger');
		incremental.apply();

		const direct = scene(list, 5);

		expect(withoutAllocatorIdentity(incremental.tree())).toEqual(
			withoutAllocatorIdentity(direct.tree()),
		);
	});

	it('leaves the tree a keyed reorder produces identical to mounting the new order', () => {
		const list = rows(6);
		const reordered = [list[3]!, list[0]!, list[5]!, list[1]!, list[2]!, list[4]!];

		const incremental = scene(list, null);
		incremental.core.reconcileForSlot(
			incremental.slot,
			ROW_TEMPLATE,
			reordered,
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		incremental.apply();

		const direct = scene(reordered, null);
		expect(withoutAllocatorIdentity(incremental.tree())).toEqual(
			withoutAllocatorIdentity(direct.tree()),
		);
	});

	it('leaves the tree an insert-and-remove reconcile produces identical to mounting the result', () => {
		const list = rows(5);
		const next = [list[0]!, { id: 99, label: 'inserted' }, list[2]!, list[4]!];

		const incremental = scene(list, null);
		incremental.core.reconcileForSlot(
			incremental.slot,
			ROW_TEMPLATE,
			next,
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		incremental.apply();

		const direct = scene(next, null);
		expect(withoutAllocatorIdentity(incremental.tree())).toEqual(
			withoutAllocatorIdentity(direct.tree()),
		);
	});

	it('reuses the survivor host across a reorder rather than recreating it', () => {
		const list = rows(4);
		const built = scene(list, null);
		const rowsNode = built.papi.pages[0]!.children[0]!.children[0]!;
		const survivor = rowsNode.children[2]!;
		const survivorUid = survivor.uid;

		built.core.reconcileForSlot(
			built.slot,
			ROW_TEMPLATE,
			[list[2]!, list[0]!, list[1]!, list[3]!],
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		built.apply();

		// Host-resident state lives on the instance, so a survivor that moved must
		// be the same host node — the wire counterpart of the DOM contract at
		// runtime.ts:17389.
		const moved: FakeNode = rowsNode.children[0]!;
		expect(moved.uid).toBe(survivorUid);
	});
});

describe('Lynx block core — change-proportionality', () => {
	// A selection change touches two rows: the one losing `danger` and the one
	// gaining it. A keyed core reaches both by key, so the counts are the same
	// whether the list holds ten rows or ten thousand. That invariance IS the
	// claim; the absolute number 2 is only its witness.
	for (const size of [10, 1_000, 10_000]) {
		it(`services a selection change on ${size.toLocaleString('en-US')} rows with two lookups and two commands`, () => {
			const list = rows(size);
			const built = scene(list, 3);
			built.core.resetCounters();

			built.core.setKeyedSlotValue(built.slot, 3, ROW_CLASS, 'row');
			built.core.setKeyedSlotValue(built.slot, size, ROW_CLASS, 'row danger');
			built.apply();

			expect(built.core.counters()).toEqual({ blockLookups: 2, commands: 2 });
		});
	}

	// The other U0 update cell: every tenth label rewritten. A keyed core pays
	// exactly `changed`, with no `rows` term — which is the whole difference
	// between the semantic floor and a whole-tree reconcile.
	it('services every tenth label with one lookup and one command per changed row', () => {
		const size = 1_000;
		const built = scene(rows(size), null);
		built.core.resetCounters();
		for (let id = 1; id <= size; id += 10) {
			built.core.setKeyedSlotValue(built.slot, id, ROW_LABEL, `row ${id} !!!`);
		}
		built.apply();
		expect(built.core.counters()).toEqual({ blockLookups: 100, commands: 100 });

		const expected = rows(size).map((row) =>
			row.id % 10 === 1 ? { id: row.id, label: `row ${row.id} !!!` } : row,
		);
		expect(withoutAllocatorIdentity(built.tree())).toEqual(
			withoutAllocatorIdentity(scene(expected, null).tree()),
		);
	});

	it('writes nothing when a scoped write does not change the slot', () => {
		const built = scene(rows(100), 7);
		built.core.resetCounters();
		expect(built.core.setKeyedSlotValue(built.slot, 7, ROW_CLASS, 'row danger')).toBe(false);
		expect(built.core.counters()).toEqual({ blockLookups: 1, commands: 0 });
		expect(built.core.flush()).toBeNull();
	});

	it('mounts a whole list with one command regardless of its size', () => {
		for (const size of [10, 10_000]) {
			const papi = createFakePAPI();
			const container = createLynxHostContainer(papi, { root: 1 });
			const core = createLynxBlockCore();
			const page = core.mount(null, null, PAGE_TEMPLATE, []);
			const slot = core.openForSlot(page, 1);
			core.resetCounters();
			core.fillForSlot(
				slot,
				ROW_TEMPLATE,
				rows(size),
				(row) => row.id,
				(row) => rowValues(row, null),
			);
			// One `mount-template-run` carries the whole dense run. The main
			// thread's work is still proportional to the hosts it creates; what is
			// constant is what the background had to say to ask for them.
			expect(core.counters()).toEqual({ blockLookups: 0, commands: 1 });
			prepareLynxHostBatch(container, core.flush()!).apply();
			expect(papi.pages[0]!.children[0]!.children[0]!.children.length).toBe(size);
		}
	});

	// The teardown path is where the command vocabulary is genuinely weaker than
	// the v2 delta protocol, and the count says so rather than hiding it: each
	// departing row costs one `remove` plus one `destroy` per host in its run,
	// where `REMOVE {firstInstance, count}` would cost one frame for all of them.
	it('reports the teardown cost the command vocabulary actually charges', () => {
		const built = scene(rows(4), null);
		built.core.resetCounters();
		built.core.clearForSlot(built.slot);
		expect(built.core.counters()).toEqual({
			blockLookups: 0,
			commands: 4 * (1 + ROW_TEMPLATE.hostCount),
		});
		// Counting a teardown the applier would reject proves nothing, so the
		// frame is applied and the range site checked empty.
		built.apply();
		expect(built.papi.pages[0]!.children[0]!.children[0]!.children).toEqual([]);
	});
});

describe('Lynx block core — allocation-order determinism', () => {
	// #62 §4.2's ledger gains one obligation under allocator determinism (U1
	// §4.6): the background's run sequence must be a pure function of the render.
	// Two cores driven identically must therefore allocate identically, which is
	// what lets the main thread predict a handle it was never sent.
	it('allocates the identical id run for two identical renders', () => {
		const list = rows(50);
		const first = scene(list, 9);
		const second = scene(list, 9);
		expect(first.tree()).toEqual(second.tree());
	});

	it('refuses a template the specialized path cannot own', () => {
		expect(() =>
			compileLynxBlockTemplate({
				nodes: [{ type: 'list', parent: -1, props: {} }],
				events: [],
			}),
		).toThrowError(/native lists are not in the specialized core/);
	});

	it('refuses a value slot two host nodes claim', () => {
		expect(() =>
			compileLynxBlockTemplate({
				nodes: [
					{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
					{ type: 'view', parent: 0, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
				],
				events: [],
			}),
		).toThrowError(/bound by more than one host node/);
	});
});

describe('Lynx block core — the tree it paints', () => {
	it('paints the fixture class contract', () => {
		const built = scene(rows(2), 2);
		const page = built.papi.pages[0]!.children[0]!;
		expect(page.classes).toBe('page');
		const rowsNode = page.children[0]!;
		expect(rowsNode.classes).toBe('rows');
		expect(rowsNode.children.map((row) => row.classes)).toEqual(['row', 'row danger']);
		const first = rowsNode.children[0]!;
		expect(first.children.map((cell) => cell.classes)).toEqual([
			'col-id',
			'col-label',
			'col-remove',
		]);
		expect(first.children.map((cell) => cell.children[0]!.text)).toEqual(['1', 'row 1', 'x']);
		// The slot-to-node table is the one lookup this core adds over the
		// applier's own, so a write to a non-class slot must land on its own node.
		built.core.setKeyedSlotValue(built.slot, 1, ROW_ID, '1001');
		built.apply();
		expect(first.children[0]!.children[0]!.text).toBe('1001');
		expect(first.children[1]!.children[0]!.text).toBe('row 1');
		// Both tappable cells carry a native listener; the id-free cell does not.
		expect(first.children.map((cell) => [...cell.events.keys()])).toEqual([
			[],
			['bindEvent:tap'],
			['bindEvent:tap'],
		]);
	});
});

describe('Lynx block core — refusing corrupt input, reporting departures', () => {
	it('refuses duplicate keys instead of mis-rendering the range', () => {
		const built = scene(rows(3), null);
		const twin = [rows(1)[0]!, rows(1)[0]!];
		expect(() =>
			built.core.reconcileForSlot(
				built.slot,
				ROW_TEMPLATE,
				twin,
				(row) => row.id,
				(row) => rowValues(row, null),
			),
		).toThrowError(/duplicate key/);
		// The guard fires before any removal or move, so the range is untouched
		// and still paints — refusal must not leave a half-reconciled list.
		built.core.reconcileForSlot(
			built.slot,
			ROW_TEMPLATE,
			rows(3),
			(row) => row.id,
			(row) => rowValues(row, null),
		);
		built.apply();
		expect(built.slot.size).toBe(3);
	});

	it('refuses duplicate keys on the empty-range fill path', () => {
		const papi = createFakePAPI();
		createLynxHostContainer(papi, { root: 1 });
		const core = createLynxBlockCore();
		const page = core.mount(null, null, PAGE_TEMPLATE, []);
		const slot = core.openForSlot(page, 1);
		expect(() =>
			core.fillForSlot(
				slot,
				ROW_TEMPLATE,
				[rows(1)[0]!, rows(1)[0]!],
				(row) => row.id,
				(row) => rowValues(row, null),
			),
		).toThrowError(/duplicate key/);
		expect(slot.size).toBe(0);
	});

	it('reports every departing block before its run is destroyed', () => {
		const built = scene(rows(4), null);
		const departedKeys: unknown[] = [];
		built.core.reconcileForSlot(
			built.slot,
			ROW_TEMPLATE,
			rows(2),
			(row) => row.id,
			(row) => rowValues(row, null),
			(block) => departedKeys.push(block.key),
		);
		expect(departedKeys.sort()).toEqual([3, 4]);
		const cleared: unknown[] = [];
		built.core.clearForSlot(built.slot, (block) => cleared.push(block.key));
		expect(cleared.sort()).toEqual([1, 2]);
		expect(built.slot.size).toBe(0);
	});
});
