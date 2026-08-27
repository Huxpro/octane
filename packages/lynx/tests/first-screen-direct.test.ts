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
