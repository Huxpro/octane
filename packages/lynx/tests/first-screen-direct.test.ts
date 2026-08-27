// Issue-58 L3: the direct first-screen applier must leave a container that is
// indistinguishable from the staged batch path — same adoption snapshot
// (ids, native ids, props, events, visibility, roots), same physical tree,
// same event-token journal — so background adoption, mismatch repair, and
// buffered-event replay never observe which applier painted the first screen.
import { describe, expect, it } from 'vitest';

import {
	applyLynxFirstScreenDirect,
	captureLynxFirstTree,
	createLynxHostContainer,
	disposeLynxHostContainer,
	prepareLynxHostBatch,
	type LynxFirstScreenDirectEnvelope,
	type LynxFirstScreenDirectNode,
} from '../src/core/host-driver.js';
import {
	LYNX_FIRST_TREE_STATE,
	LynxFirstScreenRefusalError,
	lynxFirstTreeEventTokens,
} from '../src/core/first-screen.js';
import type { UniversalProgramPlan } from 'octane/universal/native';
import { createFakePAPI, shape, type FakeNode } from './_fixtures/fake-element-papi.js';
import {
	attachThreadFunction,
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
} from '../src/core/worklets.js';
import {
	defineUniversalComponent,
	renderLynxFirstScreen,
	universalActivity,
	universalFor,
	universalPlan,
	universalValue,
} from '../src/main-renderer.js';

const ROW_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	bindings: [
		['class', 0],
		['main-thread:bindtap', 3],
	],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'label' },
			bindings: [['bindtap', 1]],
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

// The main graph authors `main-thread:` event props as tagged callables. The
// adoption snapshot crosses the ContextProxy wire, so both appliers must
// journal the plain worklet descriptor, never the callable itself — a real
// web-core MessagePort structured-clones the snapshot and rejects functions.
registerMainThreadWorklet('first-screen-direct.test:tap', undefined, function rowTapMTS() {});
const rowTapMTS = attachThreadFunction(
	function rowTapMTS() {},
	'main-thread',
	'first-screen-direct.test:tap',
	() => [{ step: 8 }],
);

const SCENE_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'page' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'title' },
			children: [{ kind: 'text', value: 'ready' }],
		},
		{ kind: 'slot', slot: 0 },
		{ kind: 'slot', slot: 1 },
	],
});

const Scene = defineUniversalComponent(
	'lynx',
	function Scene() {
		const rows = [
			{ id: 'a', label: 'alpha', active: true },
			{ id: 'b', label: 'beta', active: false },
		];
		return universalValue(SCENE_PLAN, [
			universalFor(
				rows,
				(row) => row.id,
				(row) =>
					universalValue(ROW_PLAN, [
						row.active ? 'row active' : 'row',
						() => {},
						row.label,
						rowTapMTS,
					]),
			),
			universalActivity('hidden', () =>
				universalValue(ROW_PLAN, ['row hidden-row', () => {}, 'hidden label', rowTapMTS]),
			),
		]);
	},
	{ module: '@octanejs/lynx/main-renderer' },
);

function renderScene() {
	return renderLynxFirstScreen(Scene as never, {});
}

describe('direct first-screen applier', () => {
	it('produces the identical adoption snapshot, journal, and physical tree as the staged path', () => {
		const result = renderScene();

		const directPapi = createFakePAPI();
		const direct = createLynxHostContainer(directPapi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(applyLynxFirstScreenDirect(direct, result.nodes, result.envelope)).toBe(true);
		const directTree = captureLynxFirstTree(direct);

		const stagedResult = renderScene();
		const stagedPapi = createFakePAPI();
		const staged = createLynxHostContainer(stagedPapi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		const prepared = prepareLynxHostBatch(staged, stagedResult.batch);
		prepared.apply();
		const stagedTree = captureLynxFirstTree(staged);

		expect(directTree).not.toBeNull();
		expect(stagedTree).not.toBeNull();
		expect(directTree!.snapshot).toEqual(stagedTree!.snapshot);
		expect([...lynxFirstTreeEventTokens(directTree!)].sort()).toEqual(
			[...lynxFirstTreeEventTokens(stagedTree!)].sort(),
		);
		expect(shape(directPapi.pages[0]!)).toEqual(shape(stagedPapi.pages[0]!));

		// Snapshot props must hold the wire-safe worklet descriptor, never the
		// tagged callable — the snapshot rides a structured-clone MessagePort on
		// real hosts, where a journaled function faults the whole page lifetime.
		const mtsValues = directTree!.snapshot.nodes
			.map((node) => node.props['main-thread:bindtap'])
			.filter((value) => value !== undefined);
		expect(mtsValues.length).toBeGreaterThan(0);
		for (const value of mtsValues) {
			expect(value).toEqual({
				_wkltId: 'first-screen-direct.test:tap',
				_c: { values: [{ step: 8 }] },
			});
		}
	});

	// The command batch is a view of the finished render rather than a step in
	// it: the direct applier reads the envelope, so on a tree it accepts nothing
	// materializes a batch at all. Which means whether some unrelated caller
	// happened to read `result.batch` first must not decide what the user sees,
	// and a batch read afterwards must still describe the page that was painted.
	it('paints the same first screen whether or not the command batch was materialized', () => {
		const eager = renderScene();
		// Materialized before painting; the applier must neither need nor notice it.
		const eagerCommands = eager.batch.commands;
		expect(eagerCommands.length).toBeGreaterThan(0);
		const eagerPapi = createFakePAPI();
		const eagerContainer = createLynxHostContainer(eagerPapi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(applyLynxFirstScreenDirect(eagerContainer, eager.nodes, eager.envelope)).toBe(true);
		const eagerTree = captureLynxFirstTree(eagerContainer);

		const lazy = renderScene();
		const lazyPapi = createFakePAPI();
		const lazyContainer = createLynxHostContainer(lazyPapi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(applyLynxFirstScreenDirect(lazyContainer, lazy.nodes, lazy.envelope)).toBe(true);
		const lazyTree = captureLynxFirstTree(lazyContainer);

		expect(eagerTree).not.toBeNull();
		expect(lazyTree).not.toBeNull();
		expect(lazyTree!.snapshot).toEqual(eagerTree!.snapshot);
		expect([...lynxFirstTreeEventTokens(lazyTree!)].sort()).toEqual(
			[...lynxFirstTreeEventTokens(eagerTree!)].sort(),
		);
		expect(shape(lazyPapi.pages[0]!)).toEqual(shape(eagerPapi.pages[0]!));
		// Read only now, after this render already painted a page.
		expect(lazy.batch.commands).toEqual(eagerCommands);
	});

	it('keeps the staged fault discipline on a mid-walk PAPI throw', () => {
		const result = renderScene();
		// Fail deep into the walk so hosts exist on both sides of the fault.
		const papi = createFakePAPI({ failCreateAt: 5 });
		const container = createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(() => applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toThrowError(
			'injected create fault',
		);
		// The flush obligation survives the fault, further applies are refused,
		// and the container still disposes cleanly — the same terminal contract
		// the staged applier honors.
		expect(papi.flushes()).toBe(1);
		expect(() => applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toThrowError(
			/not accepting an initial tree/,
		);
		expect(() => disposeLynxHostContainer(container)).not.toThrowError();
		expect(container.disposed).toBe(true);
	});

	it('rejects a foreign or unversioned batch envelope before touching PAPI', () => {
		const result = renderScene();
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(() =>
			applyLynxFirstScreenDirect(container, result.nodes, {
				...result.envelope,
				renderer: 'three',
			}),
		).toThrowError(/is not "lynx"/);
		expect(() =>
			applyLynxFirstScreenDirect(container, result.nodes, {
				...result.envelope,
				version: 0,
			}),
		).toThrowError(/positive safe integer/);
		expect(container.instanceCount).toBe(0);
		expect(papi.flushes()).toBe(0);
	});

	// Issue-66 / #90: the staged path this applier replaced walks a flat command
	// array, so its depth capacity is bounded only by the heap. A recursive
	// applier makes the first screen the first stack-bound stage in the
	// pipeline, and refuses trees the renderer upstream of it can produce. The
	// tree here is built iteratively and handed to the applier directly, so the
	// depth under test is the applier's own and not the renderer's or this
	// file's — which is what keeps the assertion independent of the host's stack
	// size rather than pinned to whatever ceiling one machine happens to have.
	it('paints a tree deeper than any call stack, as the staged path does', () => {
		const LEVELS = 20_000;
		let node: LynxFirstScreenDirectNode = {
			kind: 'host',
			id: LEVELS + 1,
			type: 'view',
			props: { class: 'leaf' },
			children: [],
		};
		for (let level = LEVELS; level >= 1; level--) {
			node = { kind: 'host', id: level, type: 'view', props: {}, children: [node] };
		}
		const envelope: LynxFirstScreenDirectEnvelope = { renderer: 'lynx', version: 1, events: [] };

		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(applyLynxFirstScreenDirect(container, [node], envelope)).toBe(true);

		// Bottom-up attachment is what the staged path produces, so the leaf must
		// be the deepest descendant of the single page root.
		let depth = 0;
		let cursor: FakeNode | undefined = papi.pages[0]!.children[0];
		while (cursor !== undefined) {
			depth++;
			cursor = cursor.children[0];
		}
		expect(depth).toBe(LEVELS + 1);
		expect(captureLynxFirstTree(container)).not.toBeNull();
	});

	// The listener identity the renderer assigned becomes the token the host hands
	// the platform, and a token nothing can decode is worse than a refusal: the
	// platform already holds it by the time anything reads it back. The applier
	// holds those five primitives separately and never has an identity object to
	// check, so it owes each primitive the same check the object encoder runs.
	it('refuses a first-screen listener identity the token encoder cannot express', () => {
		const node: LynxFirstScreenDirectNode = {
			kind: 'host',
			id: 1,
			type: 'view',
			props: {},
			children: [],
		};
		const attempt = (listener: unknown) => {
			const papi = createFakePAPI();
			let setEvents = 0;
			const container = createLynxHostContainer(
				{
					...papi,
					setEvent(target: FakeNode, kind: string, name: string, value: unknown) {
						setEvents += 1;
						papi.setEvent(target, kind, name, value as never);
					},
				},
				{ root: 1 },
			);
			return {
				reached: () => setEvents,
				run: () =>
					applyLynxFirstScreenDirect(container, [node], {
						renderer: 'lynx',
						version: 1,
						events: [{ id: 1, type: 'bindtap', listener: listener as never }],
					}),
			};
		};

		const badListener = attempt({ id: 0, priority: 'discrete' });
		expect(badListener.run).toThrowError(/identity\.listener must be a positive safe integer/);
		const badPriority = attempt({ id: 4, priority: 'urgent' });
		expect(badPriority.run).toThrowError(
			/identity\.priority must be discrete, continuous, or default/,
		);
		// Refused before `__AddEvent`, not after: an identity the encoder rejects
		// must never reach the platform as a listener.
		expect(badListener.reached()).toBe(0);
		expect(badPriority.reached()).toBe(0);
		// And a well-formed identity still installs, so the checks above are
		// refusing malformed identities rather than refusing everything.
		const good = attempt({ id: 4, priority: 'discrete' });
		expect(good.run()).toBe(true);
		expect(good.reached()).toBe(1);
	});

	// The applier attaches a host to its parent only once the host's own subtree
	// is complete, and walks roots and siblings in authored order. Both are
	// properties of the walk rather than of the finished tree, so the snapshot
	// and physical-tree differentials above cannot see them: a top-down attach
	// builds the identical final tree while publishing empty nodes into the live
	// page and filling them afterwards.
	it('attaches each host bottom-up and walks roots and siblings in order', () => {
		const host = (
			id: number,
			children: LynxFirstScreenDirectNode[] = [],
		): LynxFirstScreenDirectNode => ({ kind: 'host', id, type: 'view', props: {}, children });
		const roots = [host(1, [host(2, [host(3), host(4)]), host(5)]), host(6, [host(7, [host(8)])])];
		const envelope: LynxFirstScreenDirectEnvelope = { renderer: 'lynx', version: 1, events: [] };

		const papi = createFakePAPI();
		const attachments: [number, number][] = [];
		const container = createLynxHostContainer(
			{
				...papi,
				insertBefore(parent: FakeNode, child: FakeNode, before: FakeNode | null) {
					attachments.push([parent.uid, child.uid]);
					papi.insertBefore(parent, child, before);
				},
			},
			{ root: 1 },
		);
		expect(applyLynxFirstScreenDirect(container, roots, envelope)).toBe(true);
		expect(attachments).toHaveLength(8);

		const attachedAt = new Map<number, number>();
		attachments.forEach(([, child], index) => attachedAt.set(child, index));
		for (const [index, [parent, child]] of attachments.entries()) {
			const parentIndex = attachedAt.get(parent);
			// The page itself is never attached, so it has no index to compare.
			if (parentIndex === undefined) continue;
			expect(index, `host ${child} attached after its parent ${parent}`).toBeLessThan(parentIndex);
		}
		// Authored order, read off the finished tree. The fake PAPI hands out uids
		// in creation order, so this pins both the order hosts were created in and
		// the order they ended up in under each parent: page, then hosts 1..8.
		const uidTree = (node: FakeNode): unknown => [node.uid, node.children.map(uidTree)];
		expect(uidTree(papi.pages[0]!)).toEqual([
			1,
			[
				[
					2,
					[
						[
							3,
							[
								[4, []],
								[5, []],
							],
						],
						[6, []],
					],
				],
				[7, [[8, [[9, []]]]]],
			],
		]);
	});

	// A main-thread worklet and a background listener on one native channel:
	// whichever is installed second silently supersedes the other, so the staged
	// path refuses the host during prepare, before any PAPI call. The direct
	// path has no prepare stage and used to paint the page anyway, leaving the
	// main-thread handler installed and then immediately overwritten — and
	// whether the mistake was reported at all then depended on whether some
	// unrelated part of the page had a native `<list>`, since that is what makes
	// the direct applier decline.
	it('refuses a main-thread/background event collision before touching PAPI', () => {
		const tap = { _wkltId: 'card.tsrx:tap', _c: {} };
		const roots: LynxFirstScreenDirectNode[] = [
			{
				kind: 'host',
				id: 1,
				type: 'view',
				props: {},
				children: [
					{
						kind: 'host',
						id: 2,
						type: 'view',
						props: { 'main-thread:bindtap': tap },
						children: [],
					},
				],
			},
		];
		const envelope: LynxFirstScreenDirectEnvelope = {
			renderer: 'lynx',
			version: 1,
			events: [{ id: 2, type: 'bindtap', listener: { id: 7, priority: 'discrete' } }],
		};

		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(() => applyLynxFirstScreenDirect(container, roots, envelope)).toThrowError(
			/main-thread event "main-thread:bindtap" conflicts with background event "bindtap"/,
		);
		// Refused, not half-painted: the page is untouched and nothing flushed.
		expect(papi.pages[0]!.children).toEqual([]);
		expect(papi.flushes()).toBe(0);
	});

	it('does not reject a main-thread handler on a channel no listener shares', () => {
		const tap = { _wkltId: 'card.tsrx:tap', _c: {} };
		const roots: LynxFirstScreenDirectNode[] = [
			{
				kind: 'host',
				id: 1,
				type: 'view',
				props: { 'main-thread:bindtap': tap },
				children: [],
			},
		];
		// Same host, different native channel: not a collision. Installing the
		// worklet needs a registry this container has no reason to own, so the
		// assertion is scoped to the rejection under test rather than to paint.
		const envelope: LynxFirstScreenDirectEnvelope = {
			renderer: 'lynx',
			version: 1,
			events: [{ id: 1, type: 'bindlongpress', listener: { id: 7, priority: 'discrete' } }],
		};

		const container = createLynxHostContainer(createFakePAPI(), { root: 1 });
		expect(() => applyLynxFirstScreenDirect(container, roots, envelope)).not.toThrowError(
			/conflicts with background event/,
		);
	});

	// A host with no `__CreateList` cannot build a `<list>` at all, and a page
	// using a documented element is owed that diagnostic rather than a silent
	// fallback. So this tree goes back to the staged path, which raises it. Every
	// other list tree is built here now (issue #66 C3).
	it('hands a native-list tree back to the staged path when the host offers no list PAPI', () => {
		const listResult = {
			envelope: Object.freeze({ renderer: 'lynx', version: 1, events: Object.freeze([]) }),
			nodes: [
				{
					kind: 'host' as const,
					id: 1,
					type: 'list',
					props: {},
					children: [],
				},
			],
		};
		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(applyLynxFirstScreenDirect(container, listResult.nodes, listResult.envelope)).toBe(
			false,
		);
		expect(container.instanceCount).toBe(0);
	});
});

// Issue #66 C3: the direct applier builds native lists too. A `<list>` is the
// one host whose element is not created by `__CreateElement` and whose children
// are not attached to it — the platform materializes a row through
// `componentAtIndex` when it needs one — so the walk has to hold two orders at
// once: create the list on the way down, where its unique ID lands, and publish
// its rows on the way back up, once they are records.
const FEED_ROW_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'list-item',
	bindings: [
		['item-key', 0],
		['reuse-identifier', 1],
	],
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'row-label' },
			children: [{ kind: 'slot', slot: 2 }],
		},
	],
});

// A sibling after the `<list>` on purpose. It is the node that would expose a
// creation order the staged path does not produce: a list whose element were
// created after its subtree would hand this sibling the lower unique ID.
const FEED_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'view',
	props: { class: 'feed-shell' },
	children: [
		{
			kind: 'host',
			type: 'list',
			props: { id: 'feed' },
			children: [{ kind: 'slot', slot: 0 }],
		},
		{
			kind: 'host',
			type: 'text',
			props: { class: 'feed-footer' },
			children: [{ kind: 'text', value: 'end' }],
		},
	],
});

const Feed = defineUniversalComponent(
	'lynx',
	function Feed() {
		const rows = [
			{ key: 'a', label: 'alpha' },
			{ key: 'b', label: 'beta' },
			{ key: 'c', label: 'gamma' },
		];
		return universalValue(FEED_PLAN, [
			universalFor(
				rows,
				(row) => row.key,
				(row) => universalValue(FEED_ROW_PLAN, [row.key, 'feed-row', row.label]),
			),
		]);
	},
	{ module: '@octanejs/lynx/main-renderer' },
);

// The rows carry their loop key and their `item-key` separately, because they
// are separate contracts: `@for` rejects a duplicate loop key on its own, before
// any list rule is consulted, so a fixture reusing one value for both could
// never reach the list's own uniqueness check.
const DuplicateRowFeed = defineUniversalComponent(
	'lynx',
	function DuplicateRowFeed() {
		const rows = [
			{ key: 'a', itemKey: 'row', label: 'alpha' },
			{ key: 'b', itemKey: 'row', label: 'beta' },
		];
		return universalValue(FEED_PLAN, [
			universalFor(
				rows,
				(row) => row.key,
				(row) => universalValue(FEED_ROW_PLAN, [row.itemKey, 'feed-row', row.label]),
			),
		]);
	},
	{ module: '@octanejs/lynx/main-renderer' },
);

function renderFeed() {
	return renderLynxFirstScreen(Feed as never, {});
}

function listContainer() {
	const papi = createFakePAPI({ list: true });
	return {
		papi,
		container: createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		}),
	};
}

describe('direct first-screen applier, native lists', () => {
	it('paints a native list into the container the staged path would have produced', () => {
		const direct = listContainer();
		const directResult = renderFeed();
		expect(
			applyLynxFirstScreenDirect(direct.container, directResult.nodes, directResult.envelope),
		).toBe(true);
		const directTree = captureLynxFirstTree(direct.container);

		const staged = listContainer();
		const stagedResult = renderFeed();
		prepareLynxHostBatch(staged.container, stagedResult.batch).apply();
		const stagedTree = captureLynxFirstTree(staged.container);

		expect(directTree).not.toBeNull();
		expect(stagedTree).not.toBeNull();
		// Includes every native id, so it also pins that the two appliers assign
		// element identity in the same order — the list before its later sibling.
		expect(directTree!.snapshot).toEqual(stagedTree!.snapshot);
		expect(shape(direct.papi.pages[0]!)).toEqual(shape(staged.papi.pages[0]!));

		// The rows are the half the snapshot deliberately does not carry: they were
		// never painted, so they live in the main-local journal instead.
		const directJournal = directTree![LYNX_FIRST_TREE_STATE];
		const stagedJournal = stagedTree![LYNX_FIRST_TREE_STATE];
		expect([...directJournal.logicalNodes.values()]).toEqual([
			...stagedJournal.logicalNodes.values(),
		]);
		expect([...directJournal.lists.values()]).toEqual([...stagedJournal.lists.values()]);
		expect([...directJournal.logicalNodes.values()].map((row) => row.type)).toEqual([
			'list-item',
			'text',
			'#text',
			'list-item',
			'text',
			'#text',
			'list-item',
			'text',
			'#text',
		]);
	});

	// The applier emits as it walks, so a list it cannot finish would fault
	// halfway and leave a half-painted page — the one state the staged path never
	// produces. It asks first instead, and a tree it cannot vouch for goes back to
	// the staged path with nothing created, where the diagnostic is raised from
	// where it has always been raised.
	//
	// The rows here reach the list through a keyed `@for`, so a range sits between
	// the list and each `<list-item>` and the rows are not the list's own children
	// in the tree the question is asked of. A reader stopping at the immediate
	// children would find an empty list, wave it through, and fault at publish —
	// which is exactly the half-painted page this exists to prevent.
	it('refuses a malformed list before painting any of it', () => {
		const { papi, container } = listContainer();
		const result = renderLynxFirstScreen(DuplicateRowFeed as never, {});

		expect(applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toBe(false);
		expect(container.instanceCount).toBe(0);
		expect(papi.pages[0]!.children).toHaveLength(0);

		// Same container, same tree, staged: the report the application is owed.
		expect(() => prepareLynxHostBatch(container, result.batch).apply()).toThrowError(
			'item-key "row" is duplicated in one <list>.',
		);
	});

	it('publishes the rows the platform will ask for, on a list it built directly', () => {
		const { papi, container } = listContainer();
		const result = renderFeed();
		expect(applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toBe(true);

		expect(papi.lists).toHaveLength(1);
		const list = papi.lists[0]!;
		// The rows reached native as metadata rather than as elements: three
		// insertions, in authored order, and no child under the list itself.
		expect(list.node.attributes['update-list-info']).toMatchObject({
			insertAction: [
				{ position: 0, type: 'list-item', 'item-key': 'a', 'reuse-identifier': 'feed-row' },
				{ position: 1, type: 'list-item', 'item-key': 'b', 'reuse-identifier': 'feed-row' },
				{ position: 2, type: 'list-item', 'item-key': 'c', 'reuse-identifier': 'feed-row' },
			],
		});
		expect(list.node.children).toHaveLength(0);

		// Driving the platform's own entry point is what proves the callbacks the
		// list was created with are live and pointed at this container: a cell
		// materializes, under the list, from a row that had no element at all.
		const sign = list.componentAtIndex(list.node, papi.getUniqueId(list.node), 0, 0, false);
		expect(sign).toBeGreaterThan(0);
		expect(list.node.children).toHaveLength(1);
		expect(shape(list.node.children[0]!)).toMatchObject({ type: 'list-item' });
	});
});

// Issue-#163 C2d: shapes the direct applier declines rather than approximates.
//
// This applier is exported, so the trees below are ones a caller can hand it —
// including the renderer, which produces a hidden subtree and a native list row
// through ordinary authoring. Each of these is a program this mount cannot
// finish correctly, and the point of the tests is that it says so instead of
// painting a page that is wrong with nothing red. The end-to-end differential
// against the interpreted encoding lives in
// `packages/octane/tests/lynx-main-thread-program-first-screen.test.ts`.

/** A program that makes `nodes` views and appends each to the one before it. */
function fakeProgram(overrides: Partial<UniversalProgramPlan> = {}): UniversalProgramPlan {
	const nodes = overrides.nodes ?? 2;
	return {
		kind: 'program',
		slots: [],
		nodes,
		values: [],
		events: [],
		ranges: [],
		bind: (host: unknown) => {
			const papi = host as { createElement(type: string, pageId: number, text: string): FakeNode };
			return (...args: unknown[]) => {
				const pageId = args[0] as number;
				const made: FakeNode[] = [];
				for (let index = 0; index < nodes; index++) {
					made.push(papi.createElement('view', pageId, ''));
				}
				return made;
			};
		},
		...overrides,
	} as UniversalProgramPlan;
}

function programNode(
	overrides: Partial<LynxFirstScreenDirectNode> = {},
): LynxFirstScreenDirectNode {
	return {
		kind: 'program',
		id: 1,
		children: [],
		plan: fakeProgram(),
		values: [],
		ids: [1, 2],
		spans: [],
		...overrides,
	};
}

function intrinsicHost(): ReturnType<typeof createFakePAPI> {
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

const PROGRAM_ENVELOPE: LynxFirstScreenDirectEnvelope = {
	renderer: 'lynx',
	version: 1,
	events: [],
};

function applyProgram(node: LynxFirstScreenDirectNode): () => unknown {
	const papi = intrinsicHost();
	const container = createLynxHostContainer(papi, { root: 1 });
	return () => applyLynxFirstScreenDirect(container, [node], PROGRAM_ENVELOPE);
}

describe('direct first-screen applier, compiled main-thread programs', () => {
	it('mounts a program and owns every node it made', () => {
		// The premise the refusals below are refusals *from*: a well-formed
		// program paints, and every node it returned is in the physical ownership
		// journal that disposal reads — a program writes no record, so that
		// journal is the only thing standing between its nodes and a leak.
		const papi = intrinsicHost();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(applyLynxFirstScreenDirect(container, [programNode()], PROGRAM_ENVELOPE)).toBe(true);
		expect(papi.pages[0]!.children).toHaveLength(1);
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(papi.pages[0]!.children).toHaveLength(0);
	});

	it('refuses a program whose event site names no Lynx event prop', () => {
		// The plan is the event table the mount journals from (issue #215 D3), so
		// what a site's type has to name is a real Element PAPI tuple. The
		// compiler refuses to emit one that does not, and the plan freeze restates
		// the rest of the plan's structure once per plan; this is the third
		// statement of the same guarantee, for the plans that reach the driver
		// without passing either.
		//
		// Refused for the site the component *declares*, not only for the ones
		// this render bound: nothing was announced here, so no token is installed
		// and the older per-site journal would have skipped the site entirely and
		// painted a page whose next render faults instead.
		expect(
			applyProgram(
				programNode({
					plan: fakeProgram({
						events: [{ slot: 0, node: 0, type: 'onTap', priority: 'discrete' }],
					}),
				}),
			),
		).toThrow(/"onTap" is not a Lynx event prop/);
	});

	it('refuses a program node that carries no plan to mount', () => {
		expect(applyProgram({ kind: 'program', id: 1, children: [] })).toThrow(
			/carries no plan, values, or ids/,
		);
	});

	it('refuses a program the renderer numbered for a different node count', () => {
		// The ids are how the background addresses the program's hosts. One short
		// is an event site or a range parent read against a table with no entry
		// for it, which is a tap routed nowhere rather than anything red.
		expect(applyProgram(programNode({ plan: fakeProgram({ nodes: 3 }), ids: [1, 2] }))).toThrow(
			/declares 3 nodes but was assigned 2 ids/,
		);
	});

	it('refuses a program whose create returns a different number of nodes than it declares', () => {
		// A separate fault from the one above, and the later of the two: the ids
		// agree with the plan, and the create disagrees with both. The returned
		// nodes are the only map back into a subtree with no description, so a
		// program that returned too few would leave this container holding
		// physical nodes it cannot name — checked before any of them is
		// journalled, while the fault is still the program's.
		const short = {
			...fakeProgram({ nodes: 2 }),
			bind: (host: unknown) => {
				const papi = host as { createElement(type: string, id: number, text: string): FakeNode };
				return (...args: unknown[]) => [papi.createElement('view', args[0] as number, '')];
			},
		} as UniversalProgramPlan;
		expect(applyProgram(programNode({ plan: short }))).toThrow(
			/declaring 2 nodes and 0 keyed ranges returned 1 entries/,
		);
	});

	it('refuses a program whose member spans do not match its declared ranges', () => {
		expect(
			applyProgram(
				programNode({
					plan: fakeProgram({ ranges: [{ slot: 0, node: 1, id: 2 }] }),
					spans: [],
				}),
			),
		).toThrow(/declares 1 keyed ranges but carries 0 member spans/);
	});

	it('refuses a hidden program, whose raw-text nodes it cannot tell apart', () => {
		// A hidden host is marked with a `hidden` attribute unless it is raw text,
		// and which of a program's nodes are raw text is exactly what a program
		// stopped carrying.
		expect(applyProgram(programNode({ visibility: 'hidden' }))).toThrow(
			/cannot yet mount a hidden compiled main-thread program/,
		);
		// And as a *refusal* rather than a fault (#163 C3): the page is well formed
		// and the background paints it correctly over the command path, so this
		// costs the first screen rather than the launch. Every other refusal in
		// this block names a program that disagrees with its own plan, and those
		// stay faults — asserted directly below. A fresh container each time,
		// because one that refused is faulted and answers the next apply
		// differently.
		expect(applyProgram(programNode({ visibility: 'hidden' }))).toThrow(
			LynxFirstScreenRefusalError,
		);
	});

	it('faults rather than refusing when the program disagrees with its own plan', () => {
		// The control for the two refusals in this block, and the line between
		// them. A tree the mount cannot yet finish is a capability boundary; a
		// program whose create returns a different number of nodes than it declared
		// is a defect, and no fallback path makes it right. Each of these throws,
		// and none of them may start declining first screens.
		for (const node of [
			programNode({ plan: fakeProgram({ nodes: 2 }), ids: [1] }),
			programNode({ plan: fakeProgram({ ranges: [{ slot: 0, node: 1, id: 2 }] }), spans: [] }),
			programNode({ plan: fakeProgram({ nodes: 0 }), ids: [] }),
		]) {
			expect(applyProgram(node)).toThrow();
			expect(applyProgram(node)).not.toThrow(LynxFirstScreenRefusalError);
		}
	});

	it('refuses a program inside a native list row', () => {
		const papi = createFakePAPI({ list: true });
		const host = {
			...papi,
			intrinsics: {
				view: (pageId: number) => papi.createElement('view', pageId, ''),
				text: (pageId: number) => papi.createElement('text', pageId, ''),
				rawText: (value: string) => papi.createElement('#text', 0, value),
			},
		};
		const container = createLynxHostContainer(host, { root: 1 });
		const tree: LynxFirstScreenDirectNode[] = [
			{
				kind: 'host',
				id: 1,
				type: 'list',
				props: {},
				children: [
					{
						kind: 'host',
						id: 2,
						type: 'list-item',
						props: { 'item-key': 'a' },
						children: [programNode({ id: 3, ids: [3, 4] })],
					},
				],
			},
		];
		// Caught once rather than asserted twice: the container faults on the first
		// refusal and answers a second apply with a different error, so a repeated
		// `toThrow` would be checking the fault rather than the refusal.
		let thrown: unknown;
		try {
			applyLynxFirstScreenDirect(container, tree, PROGRAM_ENVELOPE);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LynxFirstScreenRefusalError);
		expect((thrown as Error).message).toMatch(
			/cannot yet mount a compiled main-thread program inside a native list row/,
		);
		// And decided before the paint, not on the way past it. The `<list>` is the
		// program's own ancestor, so an applier that refused where the mount meets
		// the program would have allocated it on the host first — this page is the
		// shape where "refused early" and "refused late" differ.
		//
		// Asserted on the native list rather than on the page's children: the
		// direct walk creates as it goes and attaches its roots once at the end, so
		// an empty page is what a refusal anywhere leaves and would hold either
		// way. A `<list>` the host allocated is the thing that would actually have
		// been paid for.
		expect(papi.lists).toHaveLength(0);
	});

	it('refuses a program under a hidden host, not only a hidden program', () => {
		// The inherited half of the same refusal. The program itself carries no
		// visibility here; its parent is what is hidden, and a program under a
		// hidden host is just as hidden as one marked so. Both halves matter
		// because a program's raw-text nodes are exactly what it stopped carrying,
		// which is why neither can be marked by guessing.
		const created: string[] = [];
		const base = intrinsicHost();
		const papi = {
			...base,
			createElement(type: string, parent: number, text: string) {
				created.push(type);
				return base.createElement(type, parent, text);
			},
		};
		const container = createLynxHostContainer(papi, { root: 1 });
		let thrown: unknown;
		try {
			applyLynxFirstScreenDirect(
				container,
				[
					{
						kind: 'host',
						id: 1,
						type: 'view',
						props: {},
						visibility: 'hidden',
						children: [programNode({ id: 2, ids: [2, 3] })],
					},
				],
				PROGRAM_ENVELOPE,
			);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LynxFirstScreenRefusalError);
		expect((thrown as Error).message).toMatch(
			/cannot yet mount a hidden compiled main-thread program/,
		);
		// The hidden `<view>` is the program's ancestor, so the same early-versus-
		// late claim as above, counted where this page can show it: nothing the
		// host was asked to make.
		expect(created).toEqual([]);
	});
});

/**
 * A one-node program with one event site, whose create records the token it was
 * handed rather than installing it.
 *
 * The token is the whole of what a site installs — the emitted create passes it
 * straight to `setEvent` and installs nothing when it is `undefined` — so the
 * argument the mount computed is what a host would have seen.
 */
function eventProgram(type: string, handed: unknown[]): UniversalProgramPlan {
	return fakeProgram({
		nodes: 1,
		events: [{ slot: 0, node: 0, type, priority: 'discrete' }],
		bind: (host: unknown) => {
			const papi = host as { createElement(type: string, pageId: number, text: string): FakeNode };
			return (...args: unknown[]) => {
				handed.push(args[1]);
				return [papi.createElement('view', args[0] as number, '')];
			};
		},
	});
}

describe('direct first-screen applier, a program event site', () => {
	it("installs the listener announced for the site's own type", () => {
		// One host can carry several native events — `bindtap` and `bindlongpress`
		// on one text is ordinary authoring — so a host's announcement is a list
		// and a site has to pick its own type out of it rather than take the head.
		// Taking the head routes a long press to the tap handler with nothing red
		// anywhere, which is why the listener ids here differ and the answer names
		// one of them.
		const handed: unknown[] = [];
		const papi = intrinsicHost();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: eventProgram('bindlongpress', handed), ids: [1] })],
				{
					renderer: 'lynx',
					version: 1,
					events: [
						{ id: 1, type: 'bindtap', listener: { id: 7, priority: 'discrete' } },
						{ id: 1, type: 'bindlongpress', listener: { id: 9, priority: 'discrete' } },
					],
				},
			),
		).toBe(true);
		expect(handed).toEqual(['octane-lynx:event:1:1:1:9:discrete']);
	});

	it('installs nothing for a site whose type its host never announced', () => {
		// The other half of the same question, and the one a list makes reachable:
		// this host *did* announce a listener, just not for this site's type. A
		// lookup that answered with whatever the host announced would install a tap
		// handler on a site the renderer passed no handler to.
		const handed: unknown[] = [];
		const papi = intrinsicHost();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: eventProgram('bindlongpress', handed), ids: [1] })],
				{
					renderer: 'lynx',
					version: 1,
					events: [{ id: 1, type: 'bindtap', listener: { id: 7, priority: 'discrete' } }],
				},
			),
		).toBe(true);
		expect(handed).toEqual([undefined]);
	});
});

/**
 * A one-node program carrying one site per type given, in that order, handing
 * back every token argument the mount passed it.
 */
function runProgram(types: readonly string[], handed: unknown[][]): UniversalProgramPlan {
	return fakeProgram({
		nodes: 1,
		events: types.map((type, index) => ({
			slot: index,
			node: 0,
			type,
			priority: 'discrete' as const,
		})),
		bind: (host: unknown) => {
			const papi = host as { createElement(type: string, pageId: number, text: string): FakeNode };
			return (...args: unknown[]) => {
				handed.push(args.slice(1, 1 + types.length));
				return [papi.createElement('view', args[0] as number, '')];
			};
		},
	});
}

/**
 * A two-node program with a keyed hole, one event site on each node, and
 * members that carry native events of their own.
 *
 * The members are the point. A program's own announcements are one contiguous
 * run, and the members' announcements come straight after it, so a run that
 * counted them as its own would read a member's listener at one of the
 * program's sites. Nothing about a program alone can show that.
 */
const RUN_PROGRAM_PLAN = universalPlan('lynx', {
	kind: 'program',
	slots: [],
	nodes: 2,
	values: [0],
	events: [
		{ slot: 1, node: 0, type: 'bindtap', priority: 'discrete' },
		{ slot: 2, node: 1, type: 'bindlongpress', priority: 'discrete' },
	],
	ranges: [{ slot: 3, node: 0, id: 2 }],
	bind: (host: unknown) => {
		const papi = host as {
			readonly intrinsics: { view(pageId: number): FakeNode; text(pageId: number): FakeNode };
			insertBefore(parent: FakeNode, child: FakeNode, before: FakeNode | null): void;
			setClasses(node: FakeNode, value: string): void;
		};
		return (...args: unknown[]): readonly unknown[] => {
			PROGRAM_TOKENS.push(args.slice(2, 4));
			const view = papi.intrinsics.view(args[0] as number);
			const text = papi.intrinsics.text(args[0] as number);
			papi.setClasses(view, args[1] as string);
			papi.insertBefore(view, text, null);
			return [view, text, undefined];
		};
	},
});

const PROGRAM_TOKENS: unknown[][] = [];

const RUN_MEMBER_PLAN = universalPlan('lynx', {
	kind: 'host',
	type: 'text',
	bindings: [['bindtap', 0]],
});

const RunScene = defineUniversalComponent(
	'lynx',
	function RunScene() {
		return universalValue(RUN_PROGRAM_PLAN, [
			'row',
			() => {},
			// The long-press site is left without a handler on purpose: the run is
			// then shorter than the site list, and the gap sits before the members'
			// announcements rather than at the end of everything.
			undefined,
			universalFor(
				['m0', 'm1'],
				(row) => row,
				() => universalValue(RUN_MEMBER_PLAN, [() => {}]),
			),
		]);
	},
	{ module: '@octanejs/lynx/main-renderer' },
);

describe('first-screen renderer and applier, a program among other announcements', () => {
	it("reads the program's own listeners and leaves its hole's members alone", () => {
		PROGRAM_TOKENS.length = 0;
		const result = renderLynxFirstScreen(RunScene as never, {});
		const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
		expect(applyLynxFirstScreenDirect(container, result.nodes, result.envelope)).toBe(true);

		// The program's `<view>` is the first id it took, and the one site this
		// render passed a handler to is bound there. Everything else the envelope
		// announces belongs to the members inside its hole.
		const program = result.nodes[0] as LynxFirstScreenDirectNode;
		const viewId = program.ids![0]!;
		const own = result.envelope.events.filter((event) => event.id === viewId);
		expect(own).toHaveLength(1);
		expect(result.envelope.events.length).toBeGreaterThan(own.length);

		expect(PROGRAM_TOKENS).toEqual([
			[`octane-lynx:event:1:${viewId}:1:${own[0]!.listener.id}:discrete`, undefined],
		]);
	});
});

describe('direct first-screen applier, the announcement run a program records', () => {
	// The renderer announces a program's sites in one contiguous pass, in site
	// order, so the mount can read each site's listener at a position instead of
	// searching the whole announcement for a host and then that host's list for a
	// type. These pin what the position has to mean; the two tests above pin the
	// search that answers when a caller hands over a tree without one.
	const THREE = ['bindtap', 'bindlongpress', 'bindtouchstart'];

	it("reads each site's listener from the run the renderer recorded", () => {
		const handed: unknown[][] = [];
		const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: runProgram(THREE, handed), ids: [1], eventsAt: 0, eventsCount: 3 })],
				{
					renderer: 'lynx',
					version: 1,
					events: THREE.map((type, index) => ({
						id: 1,
						type,
						listener: { id: 7 + index, priority: 'discrete' as const },
					})),
				},
			),
		).toBe(true);
		expect(handed).toEqual([
			[
				'octane-lynx:event:1:1:1:7:discrete',
				'octane-lynx:event:1:1:1:8:discrete',
				'octane-lynx:event:1:1:1:9:discrete',
			],
		]);
	});

	it('leaves a site nothing was announced for open without losing the sites after it', () => {
		// A handler prop that came through undefined announces nothing, so the run
		// is shorter than the site list and the gap is in the middle of it. A reader
		// that advanced once per site rather than once per announcement would hand
		// the third site's listener to the second — a long press routed to the tap
		// handler, with nothing red.
		const handed: unknown[][] = [];
		const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: runProgram(THREE, handed), ids: [1], eventsAt: 0, eventsCount: 2 })],
				{
					renderer: 'lynx',
					version: 1,
					events: [
						{ id: 1, type: 'bindtap', listener: { id: 7, priority: 'discrete' } },
						{ id: 1, type: 'bindtouchstart', listener: { id: 9, priority: 'discrete' } },
					],
				},
			),
		).toBe(true);
		expect(handed).toEqual([
			['octane-lynx:event:1:1:1:7:discrete', undefined, 'octane-lynx:event:1:1:1:9:discrete'],
		]);
	});

	it('faults when the run carries an announcement no site claimed', () => {
		// The one disagreement a position can have with the thing it addresses, and
		// the one the search could never report: an announcement inside this
		// program's run that no site of this program answers to. Left unchecked it is
		// a listener the background installed and this side bound to nothing.
		const handed: unknown[][] = [];
		const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
		expect(() =>
			applyLynxFirstScreenDirect(
				container,
				[
					programNode({
						plan: runProgram(['bindtap'], handed),
						ids: [1],
						eventsAt: 0,
						eventsCount: 2,
					}),
				],
				{
					renderer: 'lynx',
					version: 1,
					events: [
						{ id: 1, type: 'bindtap', listener: { id: 7, priority: 'discrete' } },
						{ id: 1, type: 'bindlongpress', listener: { id: 8, priority: 'discrete' } },
					],
				},
			),
		).toThrow(/2 announcements for its 1 event site, and claimed 1 of them/);
	});

	it('refuses a node carrying half a run rather than painting it without listeners', () => {
		// A start with no count is an empty run, so every site comes back open and
		// the page paints with no listeners at all. That is the silence this slice
		// exists to remove, so it cannot be the thing a half-filled node gets.
		const handed: unknown[][] = [];
		const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
		expect(() =>
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: runProgram(['bindtap'], handed), ids: [1], eventsAt: 0 })],
				{
					renderer: 'lynx',
					version: 1,
					events: [{ id: 1, type: 'bindtap', listener: { id: 7, priority: 'discrete' } }],
				},
			),
		).toThrow(/half an announcement run/);
	});

	it('installs what the search installs, for the same tree and envelope', () => {
		// The two readers have to answer the same question the same way, so the only
		// difference between these arms is whether the node carries the run. A page
		// whose tokens depend on that is a page whose taps do.
		//
		// The listener ids descend while the positions ascend, so a reader that took
		// a site's id from where its announcement sits rather than from the
		// announcement itself fails here rather than passing by coincidence.
		const envelope: LynxFirstScreenDirectEnvelope = {
			renderer: 'lynx',
			version: 1,
			events: [
				{ id: 1, type: 'bindtap', listener: { id: 5, priority: 'discrete' } },
				{ id: 1, type: 'bindtouchstart', listener: { id: 4, priority: 'discrete' } },
			],
		};
		const runs: Partial<LynxFirstScreenDirectNode>[] = [{ eventsAt: 0, eventsCount: 2 }, {}];
		const answers = runs.map((run) => {
			const handed: unknown[][] = [];
			const container = createLynxHostContainer(intrinsicHost(), { root: 1 });
			expect(
				applyLynxFirstScreenDirect(
					container,
					[programNode({ plan: runProgram(THREE, handed), ids: [1], ...run })],
					envelope,
				),
			).toBe(true);
			return handed;
		});
		expect(answers[0]).toEqual([
			['octane-lynx:event:1:1:1:5:discrete', undefined, 'octane-lynx:event:1:1:1:4:discrete'],
		]);
		expect(answers[0]).toEqual(answers[1]);
	});
});

/**
 * A one-node `text` program with one declared range it paints when handed a
 * string, built to the emission's contract rather than approximating it: the
 * range values come last, and the answer is the program's nodes followed by one
 * entry per site — the painted node, or `undefined` for a site left open.
 */
function paintingProgram(answer: 'paint' | 'decline' | 'always' = 'paint'): UniversalProgramPlan {
	return fakeProgram({
		nodes: 1,
		ranges: [{ slot: 0, node: 0, id: 1, paintsText: true }],
		bind: (host: unknown) => {
			const papi = host as {
				createElement(type: string, pageId: number, text: string): FakeNode;
				insertBefore(parent: FakeNode, child: FakeNode, before: FakeNode | null): void;
			};
			return (...args: unknown[]) => {
				const root = papi.createElement('text', args[0] as number, '');
				const value = args[1];
				const paints = answer === 'always' || (answer === 'paint' && typeof value === 'string');
				if (!paints) return [root, undefined];
				const text = papi.createElement('#text', 0, typeof value === 'string' ? value : '');
				papi.insertBefore(root, text, null);
				return [root, text];
			};
		},
	});
}

describe('direct first-screen applier, a range site the program paints', () => {
	it('owns and numbers the text the program painted for a hole', () => {
		// The mount's half of a painted hole: the text is under the host the plan
		// named, and the page comes down cleanly afterwards.
		//
		// What this cannot see is the ID map. A painted text is a child of a node
		// the program made, so disposal takes it away with its parent whether or
		// not the mount ever journalled it — the claim that it is journalled
		// *under its own ID* is only observable once a background describes the
		// same tree, and it is asserted there, on a real component, by
		// `adopts the program's own nodes rather than repainting them` in
		// `packages/octane/tests/lynx-main-thread-program-first-screen.test.ts`.
		// Saying so here rather than letting the teardown below read as proof of
		// it.
		const papi = intrinsicHost();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[
					programNode({
						plan: paintingProgram(),
						ids: [1],
						spans: [0],
						texts: ['Label'],
						rangeIds: [2],
					}),
				],
				PROGRAM_ENVELOPE,
			),
		).toBe(true);
		const root = papi.pages[0]!.children[0] as FakeNode;
		expect(root.children).toHaveLength(1);
		expect((root.children[0] as FakeNode).text).toBe('Label');
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(papi.pages[0]!.children).toHaveLength(0);
	});

	it('leaves a hole it handed no string for the ordinary path to fill', () => {
		// The other arm of the same decision, and why the trailing entry is
		// `undefined` rather than absent: nothing about the mount changes except
		// that this hole's member is an ordinary described host again.
		const papi = intrinsicHost();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[
					programNode({
						plan: paintingProgram(),
						ids: [1],
						spans: [1],
						texts: [undefined],
						rangeIds: [undefined],
						children: [
							{ kind: 'host', id: 2, type: '#text', props: { value: 'Row' }, children: [] },
						],
					}),
				],
				PROGRAM_ENVELOPE,
			),
		).toBe(true);
		const root = papi.pages[0]!.children[0] as FakeNode;
		expect(root.children).toHaveLength(1);
		expect((root.children[0] as FakeNode).text).toBe('Row');
		expect(disposeLynxHostContainer(container).complete).toBe(true);
	});

	it('faults when the create declined a hole this first screen handed a string', () => {
		// Two processes decided this — the renderer, choosing which holes to hand
		// a string, and the build, choosing which holes carry the test that uses
		// one — so neither answer can stand as evidence for the other. Without the
		// comparison this is silent: the text is simply missing from the page.
		expect(
			applyProgram(
				programNode({
					plan: paintingProgram('decline'),
					ids: [1],
					spans: [0],
					texts: ['Label'],
					rangeIds: [2],
				}),
			),
		).toThrow(/left keyed range 0 open, which this first screen handed it to paint/);
	});

	it('faults when the create painted a hole this first screen filled itself', () => {
		// The other direction, and the worse one: the renderer materialized the
		// member and the program made one too, so the page holds a node no
		// ownership journal knows about and disposal leaves behind.
		expect(
			applyProgram(
				programNode({
					plan: paintingProgram('always'),
					ids: [1],
					spans: [1],
					texts: [undefined],
					rangeIds: [undefined],
					children: [{ kind: 'host', id: 2, type: '#text', props: { value: 'Row' }, children: [] }],
				}),
			),
		).toThrow(/painted keyed range 0, which this first screen filled itself/);
	});

	it('faults when a painted hole was never numbered', () => {
		// The ID is what adoption resolves the background's description against.
		// Journalling the node under nothing would leave it owned and unnameable,
		// which surfaces later as a background describing a host main never
		// painted rather than as the mount that skipped a number.
		expect(
			applyProgram(
				programNode({
					plan: paintingProgram(),
					ids: [1],
					spans: [0],
					texts: ['Label'],
					rangeIds: [undefined],
				}),
			),
		).toThrow(/painted keyed range 0, which this first screen did not number/);
	});

	it('refuses a range table shorter than the ranges the program declares', () => {
		// A hole is addressed by its position in `plan.ranges` and by nothing
		// else, so a short table silently re-addresses every hole after the gap
		// rather than failing at the one it is missing.
		expect(
			applyProgram(
				programNode({ plan: paintingProgram(), ids: [1], spans: [0], texts: [], rangeIds: [2] }),
			),
		).toThrow(/carries 0 range texts and 1 range ids/);
	});
});

/**
 * A two-node program shaped like the real emission: it makes a root and a
 * child, puts the child *inside* the root, and hands both back. Only the root
 * is ever appended to the page, so at teardown the child is reachable through
 * the program's run and through nothing else — it has no record, and the page
 * root the applier registered is its parent rather than itself.
 */
function nestingProgram(): UniversalProgramPlan {
	return fakeProgram({
		nodes: 2,
		bind: (host: unknown) => {
			const papi = host as {
				createElement(type: string, pageId: number, text: string): FakeNode;
				insertBefore(parent: FakeNode, child: FakeNode, before: FakeNode | null): void;
			};
			return (...args: unknown[]) => {
				const pageId = args[0] as number;
				const root = papi.createElement('view', pageId, '');
				const child = papi.createElement('view', pageId, '');
				papi.insertBefore(root, child, null);
				return [root, child];
			};
		},
	});
}

/**
 * `intrinsicHost()` with one node's parentage made unresolvable on demand, the
 * way `host-driver.test.ts` injects a `getParent` failure for an ordinary host.
 * Set `papi.unresolvable` after the paint to name the node.
 */
function hostFailingParentOf(failure: Error): ReturnType<typeof intrinsicHost> & {
	unresolvable: unknown;
} {
	const base = intrinsicHost();
	const papi = {
		...base,
		unresolvable: null as unknown,
		getParent(target: FakeNode): FakeNode | null {
			if (target === papi.unresolvable) throw failure;
			return base.getParent(target);
		},
	};
	return papi;
}

describe('direct first-screen applier, the nodes a program leaves for teardown', () => {
	// Disposal has to account for every physical node the first screen made, and
	// a program writes no record for any of its own — so the run it journals is
	// the only place they are named. A node missing from it is not leaked
	// loudly: the host is never asked about it, so a container that left it in
	// the page still reports `complete: true`. That false completion is what
	// these two tests observe, by making the host unable to resolve exactly one
	// program node's parent and asking whether the dispose noticed.
	//
	// The program's root cannot show this — the applier registers it as a page
	// root, which teardown reads whether or not the run exists. It has to be a
	// node the program made *below* its root, which is every node but one.

	it('reports an incomplete dispose when a node the program made cannot be resolved', () => {
		const failure = new Error('parent inspection failed');
		const papi = hostFailingParentOf(failure);
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[programNode({ plan: nestingProgram(), ids: [1, 2] })],
				PROGRAM_ENVELOPE,
			),
		).toBe(true);
		const root = papi.pages[0]!.children[0] as FakeNode;
		papi.unresolvable = root.children[0] as FakeNode;

		expect(disposeLynxHostContainer(container)).toMatchObject({
			complete: false,
			remainingRoots: 1,
			errors: [failure],
		});
		expect(container.disposed).toBe(false);

		// And the retained half of the same contract: once the host can answer,
		// the retry completes rather than leaving the container permanently
		// undisposable.
		papi.unresolvable = null;
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(container.disposed).toBe(true);
		expect(papi.pages[0]!.children).toHaveLength(0);
	});

	it('reports an incomplete dispose when a hole the program painted cannot be resolved', () => {
		// The same claim for the trailing half of a run. A painted text is a
		// child of a node the program made and would come down with it either
		// way, so nothing about the page can distinguish a container that owns it
		// from one that forgot it — only whether teardown asked.
		const failure = new Error('parent inspection failed');
		const papi = hostFailingParentOf(failure);
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(
			applyLynxFirstScreenDirect(
				container,
				[
					programNode({
						plan: paintingProgram(),
						ids: [1],
						spans: [0],
						texts: ['Label'],
						rangeIds: [2],
					}),
				],
				PROGRAM_ENVELOPE,
			),
		).toBe(true);
		const root = papi.pages[0]!.children[0] as FakeNode;
		const painted = root.children[0] as FakeNode;
		expect(painted.text).toBe('Label');
		papi.unresolvable = painted;

		expect(disposeLynxHostContainer(container)).toMatchObject({
			complete: false,
			remainingRoots: 1,
			errors: [failure],
		});
		expect(container.disposed).toBe(false);

		papi.unresolvable = null;
		expect(disposeLynxHostContainer(container).complete).toBe(true);
		expect(container.disposed).toBe(true);
		expect(papi.pages[0]!.children).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Issue #215 D8: a shell's keyed range holding one repeated program.
//
// The shape a `@for` of one component lowers to, reduced to two hosts, one
// value, one event site and one painted hole per row, inside the hole of the
// shell that declares the loop. The mount used to walk that as N separate
// programs — N walk frames, N argument arrays, N spread calls, N runs in the
// journal — and now recognises the span, drives it once over four tables, and
// answers every later question about an ID by arithmetic from the first one
// instead of from a per-member ID table.
//
// The shell is a program rather than a described host on purpose, and it is the
// only arrangement this compiler produces: the backend leaves a parent
// described only when its range hole is *not* the parent's last child, and a
// hole that is not last has a described sibling after it — which an
// all-or-nothing span over a parent's children declines anyway. Every other
// shape either compiles the shell into a program, as here, or fails the build.
//
// So what these pin is that the two paths are the same page. The control is not
// a hand-written expectation: it is the same description, painted by the same
// plan, with the driver taken away — which is the path this span had before the
// slice and the path a hand-built plan still gets.

interface DenseCalls {
	create: number;
	run: number;
}

/**
 * The row plan, with or without the driver the emission puts beside its create
 * function.
 *
 * Both arms paint through one `paint` — the same statements, the same order,
 * the same host calls — because the emission's two forms are one body under two
 * headers. What differs is only how an instance's arguments arrive: an argument
 * list per call, or a cursor into a table shared by every instance. The driver
 * transcribes the emitted loop's index arithmetic exactly: one cursor per table
 * stepping by that table's per-instance width, and `out` stepping by the
 * instance's whole span.
 */
function denseRowPlan(
	driver: boolean,
	handed: unknown[][],
	calls: DenseCalls,
): UniversalProgramPlan {
	return fakeProgram({
		nodes: 2,
		values: [0],
		events: [{ slot: 1, node: 1, type: 'bindtap', priority: 'discrete' as const }],
		ranges: [{ slot: 2, node: 1, id: 2, paintsText: true }],
		bind: (host: unknown) => {
			const papi = host as {
				readonly intrinsics: { view(pageId: number): FakeNode; text(pageId: number): FakeNode };
				createElement(type: string, pageId: number, text: string): FakeNode;
				insertBefore(parent: FakeNode, child: FakeNode, before: FakeNode | null): void;
				setClasses(node: FakeNode, value: string): void;
				setEvent(target: FakeNode, kind: string, name: string, listener: unknown): void;
			};
			const paint = (
				pageId: number,
				value: unknown,
				token: unknown,
				text: unknown,
				out: unknown[],
				at: number,
			): void => {
				handed.push([value, token, text]);
				const view = papi.intrinsics.view(pageId);
				const label = papi.intrinsics.text(pageId);
				papi.setClasses(view, value as string);
				papi.insertBefore(view, label, null);
				// Installed where the plan says the site is — node 1, the label — the
				// way the emission's own body does it, so the paint's crossings and
				// teardown's are about the same nodes.
				// `('bindEvent', 'tap')` rather than `'bindtap'`: the native tuple is
				// what the prop name parses to, and it is what teardown clears with.
				if (token !== undefined) papi.setEvent(label, 'bindEvent', 'tap', token);
				out[at] = view;
				out[at + 1] = label;
				// The compiled test for a painted hole, which is what makes the
				// renderer's decision and the program's the same decision.
				if (typeof text !== 'string') {
					out[at + 2] = undefined;
					return;
				}
				const painted = papi.createElement('#text', 0, text);
				papi.insertBefore(label, painted, null);
				out[at + 2] = painted;
			};
			const create = (...args: unknown[]): readonly unknown[] => {
				calls.create++;
				const made: unknown[] = new Array(3);
				paint(args[0] as number, args[1], args[2], args[3], made, 0);
				return made;
			};
			if (!driver) return create;
			return Object.assign(create, {
				run(
					pageId: unknown,
					count: number,
					values: readonly unknown[],
					events: readonly unknown[],
					ranges: readonly unknown[],
					out: unknown[],
				): void {
					calls.run++;
					let vi = 0;
					let ei = 0;
					let ri = 0;
					let oi = 0;
					for (let index = 0; index < count; index++) {
						paint(pageId as number, values[vi], events[ei], ranges[ri], out, oi);
						vi += 1;
						ei += 1;
						ri += 1;
						oi += 3;
					}
				},
			});
		},
	});
}

const DENSE_LABELS = ['alpha', 'beta', 'gamma'];

/**
 * The wrapper IDs `assignProgramIds` mints for three such rows.
 *
 * The wrapper is why the stride is four and not three. A `@for` of components
 * lowers each row to a transparent keyed range holding the component, and that
 * range takes an ID without making a node — so an instance's own span is three
 * IDs (two hosts and the hole it paints) and the next instance begins a fourth
 * one later. The mount reads that spacing off the description rather than
 * deriving it from the plan for exactly this reason: what sits between two
 * instances is the description's business, and the plan cannot see it.
 */
const DENSE_WRAPPERS = [2, 6, 10];
/**
 * Spacing for a member wrapped twice, which needs one more ID per member than
 * `DENSE_WRAPPERS` leaves room for.
 */
const DENSE_WRAPPERS_DEEP = [2, 7, 12];

function denseRow(
	plan: UniversalProgramPlan,
	index: number,
	wrapperId: number,
	open: boolean,
	depth: number,
	sibling: boolean,
): LynxFirstScreenDirectNode {
	const label = DENSE_LABELS[index]!;
	// The program sits under `depth` transparent wrappers, because that is how
	// many a real member wears and the number is not fixed: `@for` contributes
	// one, and a member that is a component contributes another.
	const first = wrapperId + depth;
	const program: LynxFirstScreenDirectNode = open
		? {
				kind: 'program',
				id: first,
				children: [
					{ kind: 'host', id: first + 2, type: '#text', props: { value: label }, children: [] },
				],
				plan,
				values: [label],
				ids: [first, first + 1],
				spans: [1],
				texts: [undefined],
				rangeIds: [undefined],
				eventsAt: index,
				eventsCount: 1,
			}
		: {
				kind: 'program',
				id: first,
				children: [],
				plan,
				values: [label],
				ids: [first, first + 1],
				spans: [0],
				texts: [label],
				rangeIds: [first + 2],
				eventsAt: index,
				eventsCount: 1,
			};
	let wrapped = program;
	for (let level = depth - 1; level >= 0; level--) {
		const children =
			level === 0 && sibling
				? [
						wrapped,
						{
							kind: 'host' as const,
							id: wrapperId + depth + 3,
							type: 'view',
							props: {},
							children: [],
						},
					]
				: [wrapped];
		wrapped = { kind: 'range', id: wrapperId + level, children };
	}
	return wrapped;
}

/**
 * The shell the rows are a keyed range of: one node, one hole it leaves for the
 * renderer to fill, and nothing else.
 *
 * It is a program because that is what this compiler produces for a component
 * whose loop is its last child, and it is the reason the rows' IDs start at 2
 * rather than at the top of the page: `assignProgramIds` mints a hole's members
 * *inside* the shell's own span.
 */
function denseShellPlan(): UniversalProgramPlan {
	return fakeProgram({
		nodes: 1,
		ranges: [{ slot: 0, node: 0, id: 1 }],
		bind: (host: unknown) => {
			const papi = host as { readonly intrinsics: { view(pageId: number): FakeNode } };
			return (...args: unknown[]): readonly unknown[] => [
				papi.intrinsics.view(args[0] as number),
				undefined,
			];
		},
	});
}

function denseArm(
	driver: boolean,
	options: {
		papi?: ReturnType<typeof intrinsicHost>;
		wrappers?: readonly number[];
		open?: boolean;
		/** Which member gets a second plan of the same shape, if any. */
		oddMember?: number;
		/** How many transparent wrappers sit between the member and the program. */
		depth?: number;
		/** Give the outermost wrapper a described sibling beside the program. */
		wrapperSibling?: boolean;
	} = {},
): {
	papi: ReturnType<typeof intrinsicHost>;
	container: ReturnType<typeof createLynxHostContainer>;
	handed: unknown[][];
	calls: DenseCalls;
	crossings: [unknown, string, unknown][];
} {
	const handed: unknown[][] = [];
	const calls: DenseCalls = { create: 0, run: 0 };
	const plan = denseRowPlan(driver, handed, calls);
	const other = options.oddMember === undefined ? plan : denseRowPlan(driver, handed, calls);
	const depth = options.depth ?? 1;
	const wrappers = options.wrappers ?? (depth === 1 ? DENSE_WRAPPERS : DENSE_WRAPPERS_DEEP);
	const base = options.papi ?? intrinsicHost();
	// Every `setEvent` crossing, as the host received it. Which *node* a listener
	// is cleared from is the one thing teardown gets wrong when a flat host
	// position is read as an index into a run's `nodes`, and no tree can show it.
	const crossings: [unknown, string, unknown][] = [];
	const papi = {
		...base,
		setEvent(target: never, kind: never, name: never, listener: never) {
			crossings.push([target, name as unknown as string, listener]);
			base.setEvent(target, kind, name, listener);
		},
	} as typeof base;
	const container = createLynxHostContainer(papi, { root: 1 });
	const nodes: LynxFirstScreenDirectNode[] = [
		{
			kind: 'program',
			id: 1,
			plan: denseShellPlan(),
			values: [],
			ids: [1],
			spans: [wrappers.length],
			texts: [undefined],
			rangeIds: [undefined],
			children: wrappers.map((wrapperId, index) =>
				denseRow(
					index === options.oddMember ? other : plan,
					index,
					wrapperId,
					options.open ?? false,
					depth,
					options.wrapperSibling ?? false,
				),
			),
		},
	];
	const envelope: LynxFirstScreenDirectEnvelope = {
		renderer: 'lynx',
		version: 1,
		events: wrappers.map((wrapperId, index) => ({
			id: wrapperId + depth + 1,
			type: 'bindtap',
			listener: { id: 900 + index, priority: 'discrete' as const },
		})),
	};
	expect(applyLynxFirstScreenDirect(container, nodes, envelope)).toBe(true);
	return { papi, container, handed, calls, crossings };
}

describe('direct first-screen applier, a keyed range of one repeated program', () => {
	it('drives the whole range once and leaves the page one call each would leave', () => {
		const driven = denseArm(true);
		const perMember = denseArm(false);

		// One call for three instances against three calls for three instances,
		// which is the whole of what this slice changes. Everything below is the
		// claim that the two produce the same screen.
		expect(driven.calls).toEqual({ create: 0, run: 1 });
		expect(perMember.calls).toEqual({ create: 3, run: 0 });

		// Instance for instance, the same arguments in the same order: the tables
		// are a transposition of the argument lists and nothing more.
		expect(driven.handed).toHaveLength(3);
		expect(driven.handed).toEqual(perMember.handed);

		expect(shape(driven.papi.pages[0]!)).toEqual(shape(perMember.papi.pages[0]!));

		// The half the page cannot show. A dense run carries no ID table, so every
		// answer adoption asks it — which node wears an ID, where it sits among
		// its parent's children, what listener is installed on it — is arithmetic
		// from `firstId`. The snapshot is all of those answers at once, and the
		// per-member arm computed them from tables the renderer wrote.
		const drivenTree = captureLynxFirstTree(driven.container);
		const perMemberTree = captureLynxFirstTree(perMember.container);
		expect(drivenTree).not.toBeNull();
		expect(perMemberTree).not.toBeNull();
		expect(drivenTree!.snapshot).toEqual(perMemberTree!.snapshot);
		expect([...lynxFirstTreeEventTokens(drivenTree!)].sort()).toEqual(
			[...lynxFirstTreeEventTokens(perMemberTree!)].sort(),
		);
	});

	it("installs each instance's listener on that instance's own node", () => {
		// The token table is one array for the whole range, so a site is addressed
		// by `instance * sites + site` on the way in and read back the same way.
		// Getting either base wrong hands every instance the first one's listener,
		// which no shape and no node count can see — the page is identical and
		// every tap goes to row zero.
		const driven = denseArm(true);
		expect(driven.handed.map((args) => args[1])).toEqual([
			'octane-lynx:event:1:4:1:900:discrete',
			'octane-lynx:event:1:8:1:901:discrete',
			'octane-lynx:event:1:12:1:902:discrete',
		]);
		expect(driven.handed.map((args) => args[1])).toEqual(
			denseArm(false).handed.map((args) => args[1]),
		);
	});

	it("takes back every node a dense range painted, including the last instance's", () => {
		// One run now names `count * stride` nodes rather than `stride`, and the
		// cleanup walk reads it whole. A walk that still read only the first
		// instance would leave every later instance's interior nodes unowned, and
		// unowned is silent: the host is never asked about them, so the container
		// reports a complete dispose and the page keeps them.
		//
		// The target is the *last* instance's painted text, which is the entry
		// furthest from anything the single-instance shape would have reached.
		const failure = new Error('parent inspection failed');
		const papi = hostFailingParentOf(failure);
		const driven = denseArm(true, { papi });
		const page = papi.pages[0]!;
		const parent = page.children[0] as FakeNode;
		expect(parent.children).toHaveLength(3);
		const label = (parent.children[2] as FakeNode).children[0] as FakeNode;
		const painted = label.children[0] as FakeNode;
		expect(painted.text).toBe('gamma');
		papi.unresolvable = painted;

		expect(disposeLynxHostContainer(driven.container)).toMatchObject({
			complete: false,
			errors: [failure],
		});
		expect(driven.container.disposed).toBe(false);

		papi.unresolvable = null;
		expect(disposeLynxHostContainer(driven.container).complete).toBe(true);
		expect(driven.container.disposed).toBe(true);
		expect(page.children).toHaveLength(0);
	});

	it("clears each instance's listener from the node it was installed on", () => {
		// Teardown enumerates a run's hosts as one flat sequence — `plan.nodes` per
		// instance, `count` instances — and then has to turn each position back
		// into a node. That is not an index into `nodes`: an instance contributes
		// its hosts *and then* the holes it painted, so position `p` of instance
		// `i` sits at `i * (nodes + ranges) + p`. Reading it as `p` alone unbinds
		// row 1's listener from row 0's label and leaves row 1 live.
		//
		// Nothing about the page shows that. The nodes come out either way, and a
		// listener left installed on a detached node is only ever a crossing that
		// did not happen.
		const driven = denseArm(true);
		const page = driven.papi.pages[0]!;
		const shell = page.children[0] as FakeNode;
		const labels = [0, 1, 2].map((index) => (shell.children[index] as FakeNode).children[0]);
		// Installed on each row's own label, by the create itself.
		expect(driven.crossings.filter((call) => call[2] !== undefined).map((call) => call[0])).toEqual(
			labels,
		);

		const cleared = driven.crossings.length;
		expect(disposeLynxHostContainer(driven.container).complete).toBe(true);
		// And cleared from the same three, once each.
		expect(driven.crossings.slice(cleared)).toEqual(labels.map((node) => [node, 'tap', undefined]));
	});

	it('drives a range whose members are wrapped by the loop and by a component alike', () => {
		// The shape the compiler actually emits, and the one every other cell here
		// misses. `@for` wraps each keyed member in a range, and a member that is a
		// component is wrapped in one more. Neither wrapper makes a node, so the
		// page, the snapshot and the tokens are identical at either depth — which is
		// exactly why a mount that unwrapped a fixed one level went on producing a
		// correct screen while never once taking this path.
		const driven = denseArm(true, { depth: 2 });
		const perMember = denseArm(false, { depth: 2 });

		expect(driven.calls).toEqual({ create: 0, run: 1 });
		expect(perMember.calls).toEqual({ create: 3, run: 0 });
		expect(driven.handed).toEqual(perMember.handed);
		expect(shape(driven.papi.pages[0]!)).toEqual(shape(perMember.papi.pages[0]!));

		const drivenTree = captureLynxFirstTree(driven.container);
		const perMemberTree = captureLynxFirstTree(perMember.container);
		expect(drivenTree).not.toBeNull();
		expect(perMemberTree).not.toBeNull();
		expect(drivenTree!.snapshot).toEqual(perMemberTree!.snapshot);
		expect([...lynxFirstTreeEventTokens(drivenTree!)].sort()).toEqual(
			[...lynxFirstTreeEventTokens(perMemberTree!)].sort(),
		);
	});

	it('declines a range whose wrapper carries a sibling beside the program', () => {
		// The limit of the descent, and the reason it is not simply "skip ranges".
		// A wrapper is transparent only while the program is all it holds; a wrapper
		// with a described sibling owns a node the tables know nothing about, and
		// driving the span would drop it. All-or-nothing, as everywhere else here.
		const driven = denseArm(true, { depth: 2, wrapperSibling: true });
		const perMember = denseArm(false, { depth: 2, wrapperSibling: true });

		expect(driven.calls).toEqual({ create: 3, run: 0 });
		expect(shape(driven.papi.pages[0]!)).toEqual(shape(perMember.papi.pages[0]!));
	});

	it('declines a range whose members are not all one plan', () => {
		// A driver belongs to a plan: two plans interleave neither their arguments
		// nor their IDs, and there is no table shape that would hold both.
		// The *last* member, so the per-member check is what has to catch it: the
		// span reads its stride off the first two, and a second plan appearing
		// there is caught by the one comparison that walk already makes.
		const mixed = denseArm(true, { oddMember: 2 });
		expect(mixed.calls).toEqual({ create: 3, run: 0 });
		expect(shape(mixed.papi.pages[0]!)).toEqual(shape(denseArm(false).papi.pages[0]!));
	});

	it('declines a range whose members are not evenly spaced', () => {
		// The run addresses its nodes by arithmetic from `firstId`, so a member
		// starting anywhere but where the arithmetic puts it would put every later
		// reader on the wrong node. One member a single ID further along is enough,
		// and it is what an open hole in an earlier member does to a real
		// numbering.
		const uneven = denseArm(true, { wrappers: [2, 7, 11] });
		expect(uneven.calls).toEqual({ create: 3, run: 0 });
		// The control carries the same numbering, because the event tokens on the
		// page encode the host IDs: a control numbered differently would differ by
		// those rather than by anything this cell is about.
		expect(shape(uneven.papi.pages[0]!)).toEqual(
			shape(denseArm(false, { wrappers: [2, 7, 11] }).papi.pages[0]!),
		);
	});

	it('declines a range whose holes this renderer filled itself', () => {
		// An open hole holds members whose IDs are minted *inside* the member's own
		// span, so two instances of such a program do not take the same number of
		// IDs at all — and it is the same condition the emitter reports by carrying
		// a driver, restated where the description can be checked against it.
		const open = denseArm(true, { open: true });
		expect(open.calls).toEqual({ create: 3, run: 0 });
		const parent = open.papi.pages[0]!.children[0] as FakeNode;
		const label = (parent.children[0] as FakeNode).children[0] as FakeNode;
		expect((label.children[0] as FakeNode).text).toBe('alpha');
		expect(disposeLynxHostContainer(open.container).complete).toBe(true);
	});
});
