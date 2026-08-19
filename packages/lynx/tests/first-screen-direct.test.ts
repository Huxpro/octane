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
	type LynxFirstScreenDirectNode,
} from '../src/core/host-driver.js';
import { LYNX_FIRST_TREE_STATE } from '../src/core/first-screen.js';
import {
	attachThreadFunction,
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
} from '../src/core/worklets.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	defineUniversalComponent,
	renderLynxFirstScreen,
	universalActivity,
	universalFor,
	universalPlan,
	universalValue,
} from '../src/main-renderer.js';

interface FakeNode {
	readonly uid: number;
	readonly type: string;
	parent: FakeNode | null;
	readonly children: FakeNode[];
	readonly attributes: Record<string, unknown>;
	classes: string;
	readonly events: Map<string, unknown>;
	selector: string;
	id: string | null;
	text: string;
}

function createFakePAPI(
	options: { failCreateAt?: number } = {},
): LynxElementPAPI<FakeNode> & { readonly pages: FakeNode[]; flushes(): number } {
	let nextUid = 1;
	let created = 0;
	let flushCount = 0;
	const pages: FakeNode[] = [];
	const node = (type: string, text = ''): FakeNode => ({
		uid: nextUid++,
		type,
		parent: null,
		children: [],
		attributes: {},
		classes: '',
		events: new Map(),
		selector: '',
		id: null,
		text,
	});
	return {
		pages,
		flushes() {
			return flushCount;
		},
		createPage() {
			const page = node('page');
			pages.push(page);
			return page;
		},
		createElement(type, _parent, text) {
			created += 1;
			if (options.failCreateAt !== undefined && created === options.failCreateAt) {
				throw new Error('injected create fault');
			}
			return node(type === '#text' ? 'raw-text' : type, text);
		},
		getUniqueId(target) {
			return target.uid;
		},
		getParent(target) {
			return target.parent;
		},
		isEqual(first, second) {
			return first === second;
		},
		isChild(parent, child) {
			return child.parent === parent;
		},
		insertBefore(parent, child, before) {
			const index = before === null ? parent.children.length : parent.children.indexOf(before);
			parent.children.splice(index, 0, child);
			child.parent = parent;
		},
		remove(parent, child) {
			parent.children.splice(parent.children.indexOf(child), 1);
			child.parent = null;
		},
		replace() {
			throw new Error('unused');
		},
		setClasses(target, value) {
			target.classes = value;
		},
		setInlineStyles() {},
		setCssId() {},
		setAttribute(target, name, value) {
			if (name === 'text') target.text = String(value);
			else target.attributes[name] = value;
		},
		setRefSelector(target, value) {
			target.selector = value;
		},
		setDataset() {},
		setEvent(target, kind, name, listener) {
			if (listener === undefined) target.events.delete(`${kind}:${name}`);
			else target.events.set(`${kind}:${name}`, listener);
		},
		setId(target, value) {
			target.id = value;
		},
		flush() {
			flushCount += 1;
		},
	};
}

function shape(node: FakeNode): unknown {
	return {
		type: node.type,
		classes: node.classes,
		attributes: node.attributes,
		events: [...node.events.entries()].sort(),
		selector: node.selector,
		text: node.text,
		children: node.children.map(shape),
	};
}

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
		expect(applyLynxFirstScreenDirect(direct, result.nodes, result.batch)).toBe(true);
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
		expect([...directTree![LYNX_FIRST_TREE_STATE].eventsByToken.keys()].sort()).toEqual(
			[...stagedTree![LYNX_FIRST_TREE_STATE].eventsByToken.keys()].sort(),
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

	it('keeps the staged fault discipline on a mid-walk PAPI throw', () => {
		const result = renderScene();
		// Fail deep into the walk so hosts exist on both sides of the fault.
		const papi = createFakePAPI({ failCreateAt: 5 });
		const container = createLynxHostContainer(papi, {
			root: 1,
			worklets: createLynxMainThreadWorkletRegistry(),
		});
		expect(() => applyLynxFirstScreenDirect(container, result.nodes, result.batch)).toThrowError(
			'injected create fault',
		);
		// The flush obligation survives the fault, further applies are refused,
		// and the container still disposes cleanly — the same terminal contract
		// the staged applier honors.
		expect(papi.flushes()).toBe(1);
		expect(() => applyLynxFirstScreenDirect(container, result.nodes, result.batch)).toThrowError(
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
				...result.batch,
				renderer: 'three',
			} as never),
		).toThrowError(/is not "lynx"/);
		expect(() =>
			applyLynxFirstScreenDirect(container, result.nodes, {
				...result.batch,
				version: 0,
			} as never),
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
		const batch = { renderer: 'lynx', version: 1, commands: [] } as const;

		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(applyLynxFirstScreenDirect(container, [node], batch)).toBe(true);

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
		const batch = { renderer: 'lynx', version: 1, commands: [] } as const;

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
		expect(applyLynxFirstScreenDirect(container, roots, batch)).toBe(true);
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
		const batch = {
			renderer: 'lynx',
			version: 1,
			commands: [
				{ op: 'event', id: 2, type: 'bindtap', listener: { id: 7, priority: 'discrete' } },
			],
		} as unknown as Parameters<typeof applyLynxFirstScreenDirect>[2];

		const papi = createFakePAPI();
		const container = createLynxHostContainer(papi, { root: 1 });
		expect(() => applyLynxFirstScreenDirect(container, roots, batch)).toThrowError(
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
		const batch = {
			renderer: 'lynx',
			version: 1,
			commands: [
				{ op: 'event', id: 1, type: 'bindlongpress', listener: { id: 7, priority: 'discrete' } },
			],
		} as unknown as Parameters<typeof applyLynxFirstScreenDirect>[2];

		const container = createLynxHostContainer(createFakePAPI(), { root: 1 });
		expect(() => applyLynxFirstScreenDirect(container, roots, batch)).not.toThrowError(
			/conflicts with background event/,
		);
	});

	it('declines native-list trees so the staged path keeps owning them', () => {
		const listResult = {
			batch: Object.freeze({ renderer: 'lynx', version: 1, commands: Object.freeze([]) }),
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
		expect(applyLynxFirstScreenDirect(container, listResult.nodes, listResult.batch as never)).toBe(
			false,
		);
		expect(container.instanceCount).toBe(0);
	});
});
