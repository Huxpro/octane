import type {
	UniversalHostTemplateProgram,
	UniversalProgramCreate,
	UniversalProgramPlan,
} from 'octane/universal/native';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	(globalThis as unknown as Record<string, unknown>).__OCTANE_LYNX_PROFILE__ = true;
});

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import { lynxWireProfile } from '../src/core/profiling.js';
import {
	decodeLynxNativeEventToken,
	encodeLynxNativeEventToken,
} from '../src/core/native-events.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import { createFakePAPI, type FakeNode, shape } from './_fixtures/fake-element-papi.js';

const ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'id', valueIndex: 0 },
				{ name: 'class', valueIndex: 1 },
			],
		},
		{ type: 'text', parent: 0, props: {} },
		{
			type: '#text',
			parent: 1,
			props: {},
			bindings: [{ name: 'value', valueIndex: 2 }],
		},
	],
	events: [],
};

const EVENT_ROW: UniversalHostTemplateProgram = {
	...ROW,
	events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
};

const LIST_SHELL: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'list', parent: 0, props: { id: 'feed', 'list-type': 'single' } },
	],
	events: [],
};

const LIST_EVENT_ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'list-item',
			parent: -1,
			props: { 'reuse-identifier': 'feed-row' },
			bindings: [{ name: 'item-key', valueIndex: 0 }],
		},
		{ type: 'text', parent: 0, props: {} },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 1 }] },
	],
	events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
};

function emittedPlan(
	papi: LynxElementPAPI<FakeNode>,
	resident?: readonly number[],
): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createCompactRow',
		slotUpdates: true,
		residentNodes: resident,
	});
	const bind = new Function(`return (${emission.source});`)() as (
		host: unknown,
	) => UniversalProgramPlan['bind'] extends (host: unknown) => infer Create ? Create : never;
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c'],
		nodes: ROW.nodes.length,
		...(resident === undefined ? null : { resident }),
		values: [0, 1, 2],
		events: [],
		ranges: [],
		bind: bind as UniversalProgramPlan['bind'],
	};
}

function emittedEventPlan(resident?: readonly number[]): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(EVENT_ROW, {
		name: 'createCompactEventRow',
		slotUpdates: true,
		residentNodes: resident,
	});
	const bind = new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'];
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c', 'e:bindtap'],
		nodes: EVENT_ROW.nodes.length,
		...(resident === undefined ? null : { resident }),
		values: [0, 1, 2],
		events: EVENT_ROW.events.map((event) => ({ ...event, slot: 3 })),
		ranges: [],
		bind,
	};
}

function emittedListPlan(
	program: UniversalHostTemplateProgram,
	slots: UniversalProgramPlan['slots'],
	values: UniversalProgramPlan['values'],
	ranges: UniversalProgramPlan['ranges'] = [],
	resident?: readonly number[],
): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(program, {
		name: program === LIST_SHELL ? 'createCompactList' : 'createCompactListRow',
		slotUpdates: true,
		structuralRuns: true,
		ranges: ranges.map((range) => ({ node: range.node, before: range.before })),
		residentNodes: resident,
	});
	const bind = new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'];
	return {
		kind: 'program',
		slots,
		nodes: program.nodes.length,
		...(resident === undefined ? null : { resident }),
		values,
		events: program.events.map((event, index) => ({ ...event, slot: values.length + index })),
		ranges,
		bind,
		wire: program,
	};
}

function emittedHost(list = false): LynxElementPAPI<FakeNode> & {
	readonly pages: FakeNode[];
	readonly lists: ReturnType<typeof createFakePAPI>['lists'];
} {
	const base = createFakePAPI({ list });
	return {
		...base,
		intrinsics: {
			view: (pageId) => base.createElement('view', pageId, ''),
			text: (pageId) => base.createElement('text', pageId, ''),
			rawText: (text) => base.createElement('#text', 0, text),
		},
		append: (parent, child) => base.insertBefore(parent, child, null),
	};
}

function mountRow(
	store: ReturnType<typeof createLynxCompiledProgramStore<FakeNode>>,
	papi: LynxElementPAPI<FakeNode>,
	page: FakeNode,
	handle = 1,
	plan = emittedPlan(papi),
	before: number | null = null,
): void {
	store.mount({
		firstHandle: handle,
		count: 1,
		parent: page,
		before,
		plan,
		values: [`row-${handle}`, 'cold', `label-${handle}`],
	});
}

function mountCommitted(
	store: ReturnType<typeof createLynxCompiledProgramStore<FakeNode>>,
	papi: LynxElementPAPI<FakeNode>,
	page: FakeNode,
	handle = 1,
): void {
	store.begin();
	mountRow(store, papi, page, handle);
	store.commit();
}

function paintAdoptableRows(
	papi: LynxElementPAPI<FakeNode>,
	page: FakeNode,
	plan: UniversalProgramPlan,
	values: readonly unknown[],
	firstId: number,
	stride: number,
	firstListenerId: number,
): FakeNode[] {
	const count = values.length / plan.values.length;
	const nodes = new Array<FakeNode>(plan.nodes * count);
	const events = Array.from({ length: count }, (_, row) =>
		plan.events.map((event, site) =>
			encodeLynxNativeEventToken({
				root: 47,
				id: firstId + row * stride + event.node,
				generation: 1,
				listener: firstListenerId + row * plan.events.length + site,
				priority: event.priority,
			}),
		),
	).flat();
	const create = plan.bind(papi);
	for (let row = 0; row < count; row++) {
		const valueOffset = row * plan.values.length;
		const eventOffset = row * plan.events.length;
		const created = create(
			papi.getUniqueId(page),
			...values.slice(valueOffset, valueOffset + plan.values.length),
			...events.slice(eventOffset, eventOffset + plan.events.length),
		);
		for (let index = 0; index < plan.nodes; index++) {
			nodes[row * plan.nodes + index] = created[index] as FakeNode;
		}
	}
	for (let row = 0; row < count; row++) {
		papi.insertBefore(page, nodes[row * plan.nodes]!, null);
	}
	return nodes;
}

describe('@octanejs/lynx compact compiled-program store', () => {
	it('publishes resident template ids transactionally and refuses aliasing or gaps', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const plan = emittedPlan(papi);
		const other = { ...plan };
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));

		store.begin();
		expect(store.define(1, plan)).toBe(true);
		expect(store.resolve(1)).toBe(plan);
		store.rollback();
		expect(store.resolve(1)).toBeUndefined();

		store.begin();
		expect(store.define(1, plan)).toBe(true);
		store.commit();
		store.begin();
		expect(store.define(1, plan)).toBe(false);
		expect(() => store.define(1, other)).toThrow(/redefine template 1/);
		expect(() => store.define(3, other)).toThrow(/contiguous template id 2/);
		store.rollback();
		expect(store.resolve(1)).toBe(plan);
		expect(store.resolve(2)).toBeUndefined();
	});

	it('installs deterministic event tokens and restores listener allocation on rollback', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		const plan = emittedEventPlan();
		const values = ['row-7', 'cold', 'seven', 'row-8', 'cold', 'eight'];

		store.begin();
		store.mount({ firstHandle: 7, count: 2, parent: page, before: null, plan, values });
		const firstAttempt = page.children.map((node) => node.events.get('bindEvent:tap'));
		expect(firstAttempt.map(decodeLynxNativeEventToken)).toEqual([
			{ root: 47, id: 7, generation: 1, listener: 1, priority: 'discrete' },
			{ root: 47, id: 8, generation: 1, listener: 2, priority: 'discrete' },
		]);
		store.rollback();
		expect(page.children).toEqual([]);

		store.begin();
		store.mount({ firstHandle: 7, count: 2, parent: page, before: null, plan, values });
		store.commit();
		expect(page.children.map((node) => node.events.get('bindEvent:tap'))).toEqual(firstAttempt);

		store.begin();
		store.remove(7);
		store.remove(8);
		store.commit();
		store.begin();
		store.mount({
			firstHandle: 9,
			count: 1,
			parent: page,
			before: null,
			plan,
			values: ['row-9', 'cold', 'nine'],
		});
		store.commit();
		expect(decodeLynxNativeEventToken(page.children[0]!.events.get('bindEvent:tap'))).toEqual({
			root: 47,
			id: 9,
			generation: 1,
			listener: 3,
			priority: 'discrete',
		});
	});

	it('adopts an accepted first-screen run without repainting and preserves its identities', () => {
		const base = emittedHost();
		let hostWrites = 0;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				hostWrites++;
				base.insertBefore(parent, child, before);
			},
			setEvent(node, kind, name, listener) {
				hostWrites++;
				base.setEvent(node, kind, name, listener);
			},
		};
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan([0, 2]);
		const values = ['row-10', 'cold', 'ten', 'row-14', 'cold', 'fourteen'];
		const nodes = paintAdoptableRows(papi, page, plan, values, 10, 4, 1_000_000);
		expect(nodes.every((node) => node !== undefined)).toBe(true);
		const paintedTokens = page.children.map((node) => node.events.get('bindEvent:tap'));
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47, 1_000_000);
		hostWrites = 0;
		store.begin();
		store.adopt({
			before: null,
			count: 2,
			firstHandle: 2,
			firstId: 10,
			firstListenerId: 1_000_000,
			nodes,
			parent: page,
			plan,
			stride: 4,
			values,
		});
		expect(store.node(2, 0)).toBe(nodes[0]);
		expect(store.node(2, 2)).toBe(nodes[2]);
		expect(() => store.node(2, 1)).toThrow(/lost a static node/);
		store.commit();
		expect(hostWrites).toBe(0);
		expect(store.size()).toBe(2);
		expect(page.children.map((node) => node.id)).toEqual(['row-10', 'row-14']);

		store.begin();
		expect(store.set(3, 2, 'updated')).toBe(true);
		expect(store.visibility(3, false)).toBe(true);
		expect(store.visibility(3, true)).toBe(true);
		store.commit();
		expect(page.children[1]!.children[0]!.children[0]!.text).toBe('updated');
		expect(page.children.map((node) => node.events.get('bindEvent:tap'))).toEqual(paintedTokens);
		expect(paintedTokens.map(decodeLynxNativeEventToken)).toEqual([
			{ root: 47, id: 10, generation: 1, listener: 1_000_000, priority: 'discrete' },
			{ root: 47, id: 14, generation: 1, listener: 1_000_001, priority: 'discrete' },
		]);
	});

	it('repairs painted adoption values in place and rolls those repairs back transactionally', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan();
		const painted = ['painted-10', 'cold', 'painted ten'];
		const target = ['row-10', 'ready', 'ten'];
		const nodes = paintAdoptableRows(papi, page, plan, painted, 10, 4, 1_000_000);
		const root = nodes[0]!;
		const text = root.children[0]!.children[0]!;
		const seed = {
			firstId: 10,
			firstListenerId: 1_000_000,
			nodes,
			stride: 4,
			paintedValues: painted,
		} as const;
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			47,
			1_000_000,
			() => seed,
		);
		const mount = () =>
			store.mount({
				before: null,
				count: 1,
				firstHandle: 2,
				parent: page,
				plan,
				values: target,
			});

		store.begin();
		mount();
		expect(page.children).toEqual([root]);
		expect([root.id, root.classes, text.text]).toEqual(target);
		store.rollback();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([root]);
		expect([root.id, root.classes, text.text]).toEqual(painted);

		store.begin();
		mount();
		store.commit();
		expect(store.size()).toBe(1);
		expect(page.children).toEqual([root]);
		expect([root.id, root.classes, text.text]).toEqual(target);
	});

	it('rolls back first-screen ownership without removing the painted tree and retries exactly', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan();
		const values = ['row-10', 'cold', 'ten'];
		const nodes = paintAdoptableRows(papi, page, plan, values, 10, 4, 1_000_000);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47, 1_000_000);
		const adoption = {
			before: null,
			count: 1,
			firstHandle: 2,
			firstId: 10,
			firstListenerId: 1_000_000,
			nodes,
			parent: page,
			plan,
			stride: 4,
			values,
		} as const;

		store.begin();
		store.adopt(adoption);
		store.rollback();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([nodes[0]]);

		store.begin();
		store.adopt(adoption);
		store.commit();
		store.dispose();
		expect(page.children).toEqual([]);
	});

	it('rejects malformed or identity-divergent first-screen runs before publishing ownership', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan();
		const values = ['row-10', 'cold', 'ten'];
		const nodes = paintAdoptableRows(papi, page, plan, values, 10, 4, 1_000_000);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47, 1_000_000);
		store.begin();
		expect(() =>
			store.adopt({
				before: null,
				count: 1,
				firstHandle: 2,
				firstId: 10,
				firstListenerId: 999_999,
				nodes,
				parent: page,
				plan,
				stride: 4,
				values,
			}),
		).toThrow(/listener identity/);
		expect(() =>
			store.adopt({
				before: null,
				count: 1,
				firstHandle: 2,
				firstId: 10,
				firstListenerId: 1_000_000,
				nodes: nodes.slice(0, 2),
				parent: page,
				plan,
				stride: 4,
				values,
			}),
		).toThrow(/node arity/);
		store.rollback();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([nodes[0]]);
	});

	it('rejects incomplete resident metadata before binding or mutating the host', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const emitted = emittedPlan(papi);
		let binds = 0;
		const plan: UniversalProgramPlan = {
			...emitted,
			resident: [0],
			wire: ROW,
			bind(host) {
				binds++;
				return emitted.bind(host);
			},
		};
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));

		store.begin();
		expect(() =>
			store.mount({
				firstHandle: 1,
				count: 1,
				parent: page,
				before: null,
				plan,
				values: ['row-1', 'cold', 'label-1'],
			}),
		).toThrow(/resident set omits bound node 2/);
		expect(binds).toBe(0);
		expect(page.children).toEqual([]);
		store.rollback();
	});

	it('rejects an incoherent event plan before binding its driver or mutating the host', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		const emitted = emittedEventPlan();
		let binds = 0;
		const plan: UniversalProgramPlan = {
			...emitted,
			events: [{ ...emitted.events[0]!, slot: 0 }],
			bind(host) {
				binds++;
				return emitted.bind(host);
			},
		};

		store.begin();
		expect(() =>
			store.mount({
				firstHandle: 1,
				count: 1,
				parent: page,
				before: null,
				plan,
				values: ['row-1', 'cold', 'one'],
			}),
		).toThrow(/invalid event site/);
		expect(binds).toBe(0);
		expect(page.children).toEqual([]);
		store.rollback();
	});

	it('mounts and addresses a dense instance run from one flat output', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const emitted = emittedPlan(papi);
		const counts: number[] = [];
		const plan: UniversalProgramPlan = {
			...emitted,
			bind(host) {
				const create = emitted.bind(host);
				const run = create.run!;
				Object.defineProperty(create, 'run', {
					value(...args: Parameters<NonNullable<UniversalProgramCreate['run']>>) {
						counts.push(args[1]);
						run(...args);
					},
				});
				return create;
			},
		};
		store.begin();
		store.mount({
			firstHandle: 1,
			count: 3,
			parent: page,
			before: null,
			plan,
			values: ['row-1', 'cold', 'label-1', 'row-2', 'cold', 'label-2', 'row-3', 'cold', 'label-3'],
		});
		store.commit();
		expect(counts).toEqual([3]);
		expect(store.size()).toBe(3);
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2', 'row-3']);
		store.begin();
		expect(store.set(2, 0, 'selected')).toBe(true);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'selected', 'row-3']);
	});

	it('retains only later-observable nodes across mount, update, move, and clear', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const plan = emittedPlan(papi, [0, 2]);
		const profile = lynxWireProfile();
		const ownedBefore = profile.programRunOwnedHosts;
		const retainedBefore = profile.programRunRetainedHostRefs;
		const releasedBefore = profile.programRunReleasedHostRefs;
		const liveBefore = profile.programRunLiveRetainedHostRefs;

		store.begin();
		store.mount({
			firstHandle: 1,
			count: 2,
			parent: page,
			before: null,
			plan,
			values: ['row-1', 'cold', 'label-1', 'row-2', 'cold', 'label-2'],
		});
		expect(store.node(1, 0)).toBe(page.children[0]);
		expect(store.node(1, 2).text).toBe('label-1');
		expect(() => store.node(1, 1)).toThrow(/lost a static node/);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2']);
		expect(profile.programRunOwnedHosts - ownedBefore).toBe(6);
		expect(profile.programRunRetainedHostRefs - retainedBefore).toBe(4);
		expect(profile.programRunReleasedHostRefs - releasedBefore).toBe(2);
		expect(profile.programRunLiveRetainedHostRefs - liveBefore).toBe(4);

		store.begin();
		expect(store.set(2, 2, 'updated')).toBe(true);
		expect(store.move(1, page, null)).toBe(true);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-2', 'row-1']);
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('updated');

		store.begin();
		store.clear(page);
		store.commit();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
		expect(profile.programRunLiveRetainedHostRefs).toBe(liveBefore);
	});

	it.each([1, 1_000])('scales retained references with observable density at %i rows', (count) => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const plan = emittedPlan(papi, [0, 2]);
		const values = Array.from({ length: count }, (_, row) => [
			'row-' + row,
			'cold',
			'label-' + row,
		]).flat();
		const profile = lynxWireProfile();
		const ownedBefore = profile.programRunOwnedHosts;
		const retainedBefore = profile.programRunRetainedHostRefs;
		const releasedBefore = profile.programRunReleasedHostRefs;
		const liveBefore = profile.programRunLiveRetainedHostRefs;

		store.begin();
		store.mount({ firstHandle: 1, count, parent: page, before: null, plan, values });
		store.commit();
		expect(page.children).toHaveLength(count);
		expect(profile.programRunOwnedHosts - ownedBefore).toBe(count * 3);
		expect(profile.programRunRetainedHostRefs - retainedBefore).toBe(count * 2);
		expect(profile.programRunReleasedHostRefs - releasedBefore).toBe(count);
		expect(profile.programRunLiveRetainedHostRefs - liveBefore).toBe(count * 2);

		store.dispose();
		expect(page.children).toEqual([]);
		expect(profile.programRunLiveRetainedHostRefs).toBe(liveBefore);
	});

	it('accepts an opaque non-object Element handle published by a native driver', () => {
		const base = emittedHost();
		const page = base.createPage('0', 0);
		const inserted: unknown[] = [];
		const papi: typeof base = {
			...base,
			insertBefore(_parent, child) {
				inserted.push(child);
			},
		};
		// Native LepusNG Element references have an engine-owned `typeof` result
		// rather than JavaScript's "object". A callable is the closest V8-visible
		// stand-in that still satisfies the public opaque-object TypeScript ABI.
		const opaqueRoot = (() => {}) as unknown as FakeNode;
		const create = (() => [opaqueRoot]) as UniversalProgramCreate;
		Object.defineProperty(create, 'run', {
			value(...args: Parameters<NonNullable<UniversalProgramCreate['run']>>) {
				args[5][0] = opaqueRoot;
			},
		});
		const plan: UniversalProgramPlan = {
			kind: 'program',
			slots: [],
			nodes: 1,
			values: [],
			events: [],
			ranges: [],
			bind: () => create,
		};
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));

		store.begin();
		store.mount({ firstHandle: 1, count: 1, parent: page, before: null, plan, values: [] });
		store.commit();

		expect(inserted).toEqual([opaqueRoot]);
		expect(store.size()).toBe(1);
	});

	it('mounts through the emitted driver and updates generated scalar slots in place', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);

		expect(store.size()).toBe(1);
		expect(shape(page)).toMatchObject({
			children: [
				{
					id: 'row-1',
					classes: 'cold',
					children: [{ children: [{ text: 'label-1' }] }],
				},
			],
		});
		store.begin();
		expect(store.set(1, 0, 'selected')).toBe(true);
		expect(store.set(1, 1, 2)).toBe(true);
		expect(store.set(1, 2, 'renamed')).toBe(true);
		expect(store.set(1, 2, 'renamed')).toBe(false);
		store.commit();
		expect(page.children[0]).toMatchObject({ id: 'selected', classes: '2' });
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('renamed');
	});

	it('rejects invalid handles, arity, slots, values, and unsupported sites before mutation', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const plan = emittedPlan(papi);

		store.begin();
		expect(() =>
			store.mount({
				firstHandle: 0,
				count: 1,
				parent: page,
				before: null,
				plan,
				values: ['a', 'b', 'c'],
			}),
		).toThrow(/positive instance handle/);
		expect(() =>
			store.mount({
				firstHandle: 1,
				count: 1,
				parent: page,
				before: null,
				plan,
				values: ['a'],
			}),
		).toThrow(/value arity/);
		expect(() =>
			store.mount({
				firstHandle: 1,
				count: 1,
				parent: page,
				before: null,
				plan,
				values: ['a', 'b', null],
			}),
		).toThrow(/scalar kind/);
		expect(() =>
			store.mount({
				firstHandle: 1,
				count: 1,
				parent: page,
				before: null,
				plan: { ...plan, ranges: [{ slot: 0, node: 0, id: 1, paintsText: true }] },
				values: ['a', 'b', 'c'],
			}),
		).toThrow(/invalid structural range/);
		expect(page.children).toEqual([]);
		store.rollback();
		expect(page.children).toEqual([]);
		mountCommitted(store, papi, page);
		store.begin();
		expect(() => store.set(1, 3, 'outside')).toThrow(/value slot 3/);
		expect(() => store.set(1, 2, null)).toThrow(/scalar kind/);
		store.rollback();
		expect(page.children[0]!.children[0]!.children[0]!.text).toBe('label-1');
	});

	it('does not publish or attach an instance when emitted creation throws', () => {
		const base = emittedHost();
		let creates = 0;
		const papi: typeof base = {
			...base,
			intrinsics: {
				...base.intrinsics!,
				text(pageId) {
					creates++;
					throw new Error(`create fault ${pageId}`);
				},
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		store.begin();
		expect(() => mountRow(store, papi, page)).toThrow(/create fault/);
		store.rollback();
		expect(creates).toBe(1);
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('cleans a root when insertion mutates and then throws', () => {
		const base = emittedHost();
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				base.insertBefore(parent, child, before);
				throw new Error('insert fault');
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		store.begin();
		expect(() => mountRow(store, papi, page)).toThrow(/insert fault/);
		store.rollback();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('restores the previous scalar when a setter mutates and then throws', () => {
		const base = emittedHost();
		let failNext = false;
		const papi: typeof base = {
			...base,
			setId(node, value) {
				base.setId(node, value);
				if (failNext) {
					failNext = false;
					throw new Error('set fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);
		failNext = true;
		store.begin();
		expect(() => store.set(1, 0, 'broken')).toThrow(/set fault/);
		store.rollback();
		expect(page.children[0]!.id).toBe('row-1');
		store.begin();
		expect(store.set(1, 0, 'good')).toBe(true);
		store.commit();
		expect(page.children[0]!.id).toBe('good');
	});

	it('faults permanently when a scalar rollback also fails', () => {
		const base = emittedHost();
		let failures = 0;
		const papi: typeof base = {
			...base,
			setId(node, value) {
				base.setId(node, value);
				if (failures > 0) {
					failures--;
					throw new Error('set fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);
		failures = 2;
		store.begin();
		expect(() => store.set(1, 0, 'broken')).toThrow(AggregateError);
		expect(() => store.set(1, 1, 'blocked')).toThrow(/faulted/);
	});

	it('keeps a pre-mutation remove failure retryable', () => {
		const base = emittedHost();
		let failNext = true;
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				if (failNext) {
					failNext = false;
					throw new Error('remove fault');
				}
				base.remove(parent, child);
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);
		store.begin();
		expect(() => store.remove(1)).toThrow(/remove fault/);
		store.rollback();
		expect(store.size()).toBe(1);
		store.begin();
		store.remove(1);
		store.commit();
		expect(page.children).toEqual([]);
	});

	it('restores a remove that mutates before throwing so a rejected-frame retry is exact', () => {
		const base = emittedHost();
		let failNext = true;
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				base.remove(parent, child);
				if (failNext) {
					failNext = false;
					throw new Error('remove-after-mutation fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);
		store.begin();
		expect(() => store.remove(1)).toThrow(/remove-after-mutation fault/);
		store.rollback();
		expect(store.size()).toBe(1);
		expect(page.children).toHaveLength(1);
		store.begin();
		store.remove(1);
		store.commit();
		expect(page.children).toEqual([]);
	});

	it('faults but retains disposal ownership when failed remove inspection is unknowable', () => {
		const base = emittedHost();
		let failRemove = false;
		const papi: typeof base = {
			...base,
			isChild(parent, child) {
				if (failRemove) throw new Error('inspection fault');
				return base.isChild(parent, child);
			},
			remove(parent, child) {
				base.remove(parent, child);
				if (failRemove) throw new Error('remove fault');
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page);
		failRemove = true;
		store.begin();
		expect(() => store.remove(1)).toThrow(AggregateError);
		expect(() => store.set(1, 0, 'blocked')).toThrow(/faulted/);
		failRemove = false;
		store.dispose();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('retains disposal ownership when rollback insertion mutates and then throws', () => {
		const base = emittedHost();
		let failInsert = false;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				base.insertBefore(parent, child, before);
				if (failInsert) throw new Error('rollback insert fault');
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page, 1);
		mountCommitted(store, papi, page, 2);
		store.begin();
		store.remove(2);
		failInsert = true;
		expect(() => store.rollback()).toThrow(AggregateError);
		expect(store.size()).toBe(2);
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2']);
		failInsert = false;
		store.dispose();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('rolls a whole mixed frame back in reverse host order', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page, 1);
		mountCommitted(store, papi, page, 2);

		store.begin();
		expect(store.set(1, 0, 'draft')).toBe(true);
		store.remove(2);
		mountRow(store, papi, page, 3);
		store.rollback();

		expect(store.size()).toBe(2);
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2']);
		expect(page.children[0]!.id).toBe('row-1');
		// The rolled-back handle allocator must accept the background retry's
		// exact same monotonic handle rather than treating it as a reuse.
		store.begin();
		mountRow(store, papi, page, 3);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2', 'row-3']);
	});

	it('binds each resident plan once and journals O(1) before-anchor links', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const emitted = emittedPlan(papi);
		let binds = 0;
		const plan: UniversalProgramPlan = {
			...emitted,
			bind(host) {
				binds++;
				return emitted.bind(host);
			},
		};
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		store.begin();
		mountRow(store, papi, page, 1, plan);
		mountRow(store, papi, page, 2, plan);
		store.commit();
		expect(binds).toBe(1);

		store.begin();
		mountRow(store, papi, page, 3, plan, 2);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-3', 'row-2']);
		store.begin();
		store.remove(3);
		store.rollback();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-3', 'row-2']);
	});

	it('restores the old order when a move mutates before throwing', () => {
		const base = emittedHost();
		let failNext = false;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				base.insertBefore(parent, child, before);
				if (failNext) {
					failNext = false;
					throw new Error('move fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page, 1);
		mountCommitted(store, papi, page, 2);
		failNext = true;
		store.begin();
		expect(() => store.move(1, page, null)).toThrow(/move fault/);
		store.rollback();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-2']);
		store.begin();
		expect(store.move(1, page, null)).toBe(true);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-2', 'row-1']);
	});

	it('does not cross to the host for an already-satisfied structure write', () => {
		const base = emittedHost();
		let hostCalls = 0;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				hostCalls++;
				base.insertBefore(parent, child, before);
			},
			setAttribute(node, name, value) {
				hostCalls++;
				base.setAttribute(node, name, value);
			},
			setEvent(node, kind, name, listener) {
				hostCalls++;
				base.setEvent(node, kind, name, listener);
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		store.begin();
		store.mount({
			firstHandle: 1,
			count: 1,
			parent: page,
			before: null,
			plan: emittedEventPlan(),
			values: ['row-1', 'cold', 'one'],
		});
		store.commit();

		hostCalls = 0;
		store.begin();
		expect(store.move(1, page, null)).toBe(false);
		expect(store.move(1, page, 1)).toBe(false);
		expect(store.visibility(1, true)).toBe(false);
		store.commit();
		expect(hostCalls).toBe(0);
	});

	it('restores event reachability when a visibility write mutates before throwing', () => {
		const base = emittedHost();
		let failNext = false;
		const papi: typeof base = {
			...base,
			setEvent(node, kind, name, listener) {
				base.setEvent(node, kind, name, listener);
				if (failNext) {
					failNext = false;
					throw new Error('visibility fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		store.begin();
		store.mount({
			firstHandle: 1,
			count: 1,
			parent: page,
			before: null,
			plan: emittedEventPlan(),
			values: ['row-1', 'cold', 'one'],
		});
		store.commit();
		const root = page.children[0]!;
		const token = root.events.get('bindEvent:tap');
		failNext = true;
		store.begin();
		expect(() => store.visibility(1, false)).toThrow(/visibility fault/);
		store.rollback();
		expect(root.attributes.hidden).toBe(false);
		expect(root.events.get('bindEvent:tap')).toBe(token);
		store.begin();
		expect(store.visibility(1, false)).toBe(true);
		store.commit();
		expect(root.attributes.hidden).toBe(true);
		expect(root.events.has('bindEvent:tap')).toBe(false);
	});

	it('disposes every attached root without leaving retained instances', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		mountCommitted(store, papi, page, 1);
		mountCommitted(store, papi, page, 2);
		expect(page.children).toHaveLength(2);
		store.dispose();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
		expect(() => store.begin()).toThrow(/closing or closed/);
	});
	it('declares native-list rows lazily, rebinds one physical cell, and rejects stale callbacks', () => {
		const papi = emittedHost(true);
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		const shell = emittedListPlan(LIST_SHELL, ['r'], [], [{ slot: 0, node: 1, id: 1 }], [0, 1]);
		const row = emittedListPlan(
			LIST_EVENT_ROW,
			['p:item-key', 'c', 'e:bindtap'],
			[0, 1],
			[],
			[0, 2],
		);

		store.begin();
		store.mount({
			firstHandle: 2,
			count: 1,
			parent: page,
			before: null,
			plan: shell,
			values: [],
		});
		const listNode = store.range(2, 0);
		store.mount({
			firstHandle: 3,
			count: 3,
			parent: listNode,
			before: null,
			plan: row,
			values: ['item-0', 'Row 0', 'item-1', 'Row 1', 'item-2', 'Row 2'],
		});
		store.commit();

		const nativeList = papi.lists[0]!;
		expect(nativeList.node.children).toEqual([]);
		expect(nativeList.node.attributes['update-list-info']).toMatchObject({
			insertAction: [
				{ position: 0, 'item-key': 'item-0' },
				{ position: 1, 'item-key': 'item-1' },
				{ position: 2, 'item-key': 'item-2' },
			],
		});

		const firstSign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0, 11);
		const cell = nativeList.node.children[0]!;
		expect(cell.children[0]!.children[0]!.text).toBe('Row 0');
		nativeList.enqueueComponent(nativeList.node, nativeList.node.uid, firstSign);
		const secondSign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 1, 12);
		expect(secondSign).toBe(firstSign);
		expect(nativeList.node.children[0]).toBe(cell);
		expect(cell.children[0]!.children[0]!.text).toBe('Row 1');
		expect(decodeLynxNativeEventToken(cell.events.get('bindEvent:tap'))).toMatchObject({
			root: 47,
			id: 4,
			listener: 2,
		});

		store.begin();
		expect(store.set(4, 1, 'Row 1 updated')).toBe(true);
		expect(store.move(4, listNode, 3)).toBe(true);
		store.commit();
		expect(cell.children[0]!.children[0]!.text).toBe('Row 1 updated');

		store.begin();
		store.remove(4);
		store.commit();
		expect(nativeList.node.children).toEqual([]);
		const replacementSign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0);
		expect(replacementSign).not.toBe(firstSign);
		const replacement = nativeList.node.children[0]!;
		expect(replacement.children[0]!.children[0]!.text).toBe('Row 0');
		nativeList.enqueueComponent(nativeList.node, nativeList.node.uid, firstSign);
		expect(nativeList.node.children[0]).toBe(replacement);

		store.begin();
		store.clear(listNode);
		store.commit();
		expect(store.size()).toBe(1);
		expect(nativeList.node.children).toEqual([]);
		expect(nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0)).toBe(-1);

		store.dispose();
		expect(nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0)).toBe(-1);
	});
	it('prepares native-list publication before flush and reverses a rejected frame', () => {
		const papi = emittedHost(true);
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		const shell = emittedListPlan(LIST_SHELL, ['r'], [], [{ slot: 0, node: 1, id: 1 }]);
		const row = emittedListPlan(LIST_EVENT_ROW, ['p:item-key', 'c', 'e:bindtap'], [0, 1]);
		store.begin();
		store.mount({
			firstHandle: 2,
			count: 1,
			parent: page,
			before: null,
			plan: shell,
			values: [],
		});
		const listNode = store.range(2, 0);
		store.commit();

		const mount = () =>
			store.mount({
				firstHandle: 3,
				count: 1,
				parent: listNode,
				before: null,
				plan: row,
				values: ['item-0', 'Row 0'],
			});
		store.begin();
		mount();
		store.prepareCommit();
		expect(listNode.attributes['update-list-info']).toMatchObject({
			insertAction: [{ position: 0, 'item-key': 'item-0' }],
		});
		store.rollback();
		expect(listNode.attributes['update-list-info']).toMatchObject({ removeAction: [0] });
		expect(store.isFaulted()).toBe(false);

		store.begin();
		mount();
		store.commit();
		expect(papi.lists[0]!.componentAtIndex(listNode, listNode.uid, 0)).toBeGreaterThan(0);
	});

	it('faults an unknowable list publication and reports an accepted callback failure', () => {
		const base = emittedHost(true);
		let failPublication = true;
		const papi: typeof base = {
			...base,
			setAttribute(node, name, value) {
				base.setAttribute(node, name, value);
				if (name === 'update-list-info' && failPublication) {
					failPublication = false;
					throw new Error('list publication fault');
				}
			},
		};
		const page = papi.createPage('0', 0);
		const reported: unknown[] = [];
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			47,
			1,
			undefined,
			(error) => reported.push(error),
		);
		const shell = emittedListPlan(LIST_SHELL, ['r'], [], [{ slot: 0, node: 1, id: 1 }]);
		const row = emittedListPlan(LIST_EVENT_ROW, ['p:item-key', 'c', 'e:bindtap'], [0, 1]);
		store.begin();
		store.mount({
			firstHandle: 2,
			count: 1,
			parent: page,
			before: null,
			plan: shell,
			values: [],
		});
		const listNode = store.range(2, 0);
		store.commit();
		store.begin();
		store.mount({
			firstHandle: 3,
			count: 1,
			parent: listNode,
			before: null,
			plan: row,
			values: ['item-0', 'Row 0'],
		});
		expect(() => store.commit()).toThrow('list publication fault');
		store.rollback();
		expect(store.isFaulted()).toBe(true);

		store.dispose();
		const cleanPage = base.createPage('1', 0);
		const callbackStore = createLynxCompiledProgramStore(
			base,
			base.getUniqueId(cleanPage),
			48,
			1,
			undefined,
			(error) => reported.push(error),
		);
		callbackStore.begin();
		callbackStore.mount({
			firstHandle: 2,
			count: 1,
			parent: cleanPage,
			before: null,
			plan: shell,
			values: [],
		});
		const cleanList = callbackStore.range(2, 0);
		callbackStore.mount({
			firstHandle: 3,
			count: 1,
			parent: cleanList,
			before: null,
			plan: row,
			values: ['item-0', 'Row 0'],
		});
		callbackStore.commit();
		expect(base.lists.at(-1)!.componentAtIndex(cleanList, cleanList.uid, 99)).toBe(-1);
		expect(callbackStore.isFaulted()).toBe(true);
		expect(reported.at(-1)).toBeInstanceOf(TypeError);
	});
});
