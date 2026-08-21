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
import { beforeAll, describe, expect, it } from 'vitest';

import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import {
	compileLynxBlockTemplate,
	createLynxBlockCore,
	type LynxBlockCore,
	type LynxBlockForSlot,
	type LynxBlockTemplate,
} from '../src/core/block-core.js';
import type { UniversalHostCommand } from 'octane/universal/native';
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

// Issue-#103 U4: a worklet is the one prop whose value is an object rather than
// a scalar, and every layer under the Block core refused it for that reason.
// What these protect is that the refusal moved to exactly the slots a program
// did not mark, and that worklet lifetime is the same lifetime the record path
// has always given a main-thread prop.
describe('Lynx block core — main-thread worklets on a template run', () => {
	const WORKLET_ROW = compileLynxBlockTemplate({
		nodes: [
			{
				type: 'view',
				parent: -1,
				props: { class: 'row' },
				bindings: [
					{ name: 'main-thread:bindtap', valueIndex: 0 },
					{ name: 'main-thread:ref', valueIndex: 1 },
				],
			},
		],
		events: [],
	});

	interface WorkletScene {
		readonly core: LynxBlockCore;
		readonly slot: LynxBlockForSlot;
		readonly papi: ReturnType<typeof createFakePAPI>;
		/** Paint whatever the core has accumulated, and report what it sent. */
		apply(): UniversalHostCommand['op'][];
		rows(): readonly FakeNode[];
	}

	function workletScene(): WorkletScene {
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		const core = createLynxBlockCore();
		const page = core.mount(null, null, PAGE_TEMPLATE, []);
		const slot = core.openForSlot(page, 1);
		const apply = (): UniversalHostCommand['op'][] => {
			const batch = core.flush();
			if (batch === null) return [];
			prepareLynxHostBatch(container, batch).apply();
			return batch.commands.map((command) => command.op);
		};
		apply();
		return {
			core,
			slot,
			papi,
			apply,
			rows: () => papi.pages[0]!.children[0]!.children[0]!.children,
		};
	}

	function tapListener(node: FakeNode): unknown {
		return node.events.get('bindEvent:tap');
	}

	beforeAll(() => {
		registerMainThreadWorklet('block-core:tap', undefined, function () {
			return null;
		});
	});

	it('gives every row of a run its own live main-thread handler in one command', () => {
		const built = workletScene();
		built.core.fillForSlot(
			built.slot,
			WORKLET_ROW,
			[1, 2, 3],
			(id) => id,
			(id) => [{ _wkltId: 'block-core:tap', _c: { values: [id] } }, { _wvid: `row:${id}` }],
		);
		// The whole list is one command, which is the point: a worklet used to
		// cost the run and take the list back to a create per host.
		expect(built.apply()).toEqual(['mount-template-run']);

		const painted = built.rows();
		expect(painted).toHaveLength(3);
		// Each row carries its own captures, and the registry handed each its own
		// activation — a shared descriptor would show one token on all three.
		const captures = painted.map(
			(row) => (tapListener(row) as { value: { _c: { values: unknown[] } } }).value._c.values[0],
		);
		expect(captures).toEqual([1, 2, 3]);
		const activations = painted.map(
			(row) => (tapListener(row) as { value: { _owlt: number } }).value._owlt,
		);
		expect(new Set(activations).size).toBe(3);
	});

	it('leaves a handler alone when the worklet and its captures are unchanged', () => {
		const built = workletScene();
		built.core.fillForSlot(
			built.slot,
			WORKLET_ROW,
			[1],
			(id) => id,
			(id) => [{ _wkltId: 'block-core:tap', _c: { values: [id] } }, { _wvid: `row:${id}` }],
		);
		built.apply();
		const installed = tapListener(built.rows()[0]!);

		// A compiler rebuilds the descriptor on every render, so this is a
		// different object carrying the same worklet. Identity says "changed";
		// the contract says otherwise, and the host must not be told anything.
		expect(
			built.core.setKeyedSlotValue(built.slot, 1, 0, {
				_wkltId: 'block-core:tap',
				_c: { values: [1] },
			}),
		).toBe(false);
		expect(built.core.flush()).toBeNull();
		expect(tapListener(built.rows()[0]!)).toBe(installed);
	});

	it('replaces a handler whose captures changed', () => {
		const built = workletScene();
		built.core.fillForSlot(
			built.slot,
			WORKLET_ROW,
			[1],
			(id) => id,
			(id) => [{ _wkltId: 'block-core:tap', _c: { values: [id] } }, { _wvid: `row:${id}` }],
		);
		built.apply();

		expect(
			built.core.setKeyedSlotValue(built.slot, 1, 0, {
				_wkltId: 'block-core:tap',
				_c: { values: [99] },
			}),
		).toBe(true);
		built.apply();
		expect(
			(tapListener(built.rows()[0]!) as { value: { _c: { values: unknown[] } } }).value._c
				.values[0],
		).toBe(99);
	});

	it('lets a valid value repair a slot holding a malformed descriptor', () => {
		const built = workletScene();
		built.core.fillForSlot(
			built.slot,
			WORKLET_ROW,
			[1],
			(id) => id,
			(id) => [{ _wkltId: 'block-core:tap', _c: { values: [id] } }, { _wvid: `row:${id}` }],
		);
		built.apply();

		// The core does not validate slot values — the applier reports a malformed
		// descriptor in its own words at its own point in the commit.
		expect(built.core.setKeyedSlotValue(built.slot, 1, 0, { _wkltId: '' })).toBe(true);
		expect(() => built.apply()).toThrowError();

		// The write API must stay usable afterwards: comparing the replacement
		// against the malformed previous value declines equality rather than
		// throwing, so the repair ships instead of the slot being wedged forever.
		expect(
			built.core.setKeyedSlotValue(built.slot, 1, 0, {
				_wkltId: 'block-core:tap',
				_c: { values: [7] },
			}),
		).toBe(true);
		expect(built.core.flush()).not.toBeNull();
	});

	it('refuses a run whose rows would claim one main-thread ref twice', () => {
		const built = workletScene();
		built.core.fillForSlot(
			built.slot,
			WORKLET_ROW,
			[1, 2],
			(id) => id,
			(id) => [{ _wkltId: 'block-core:tap', _c: { values: [id] } }, { _wvid: 'shared' }],
		);
		expect(() => built.apply()).toThrowError(/main-thread ref "shared" is assigned to hosts/);
		// Nothing was painted: the refusal happens before the run reaches PAPI.
		expect(built.papi.pages[0]!.children[0]!.children[0]!.children).toHaveLength(0);
	});

	it('refuses a template that binds a main-thread event on a channel it already owns', () => {
		const built = workletScene();
		const collided = compileLynxBlockTemplate({
			nodes: [
				{
					type: 'view',
					parent: -1,
					props: {},
					bindings: [{ name: 'main-thread:bindtap', valueIndex: 0 }],
				},
			],
			events: [{ node: 0, type: 'bindtap', priority: 'default' }],
		});
		built.core.fillForSlot(
			built.slot,
			collided,
			[1],
			(id) => id,
			() => [{ _wkltId: 'block-core:tap' }],
		);
		expect(() => built.apply()).toThrowError(
			/conflicts with background event "bindtap" on the same native channel/,
		);
	});

	it('refuses an object in a slot the template did not bind to a main-thread prop', () => {
		const built = workletScene();
		const ordinary = compileLynxBlockTemplate({
			nodes: [
				{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
			],
			events: [],
		});
		built.core.fillForSlot(
			built.slot,
			ordinary,
			[1],
			(id) => id,
			() => [{ _wkltId: 'block-core:tap' } as never],
		);
		expect(() => built.apply()).toThrowError(/values\[0\] must be a scalar/);
	});

	it('refuses a template that binds a main-thread prop on raw text', () => {
		expect(() =>
			compileLynxBlockTemplate({
				nodes: [
					{ type: 'text', parent: -1, props: {} },
					{
						type: '#text',
						parent: 0,
						props: { value: '' },
						bindings: [{ name: 'main-thread:bindtap', valueIndex: 0 }],
					},
				],
				events: [],
			}),
		).toThrowError(/binds main-thread:bindtap on #text/);
	});
});
