import type {
	UniversalHostTemplateProgram,
	UniversalProgramCreate,
	UniversalProgramPlan,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import { decodeLynxNativeEventToken } from '../src/core/native-events.js';
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

function emittedPlan(papi: LynxElementPAPI<FakeNode>): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createCompactRow',
		slotUpdates: true,
	});
	const bind = new Function(`return (${emission.source});`)() as (
		host: unknown,
	) => UniversalProgramPlan['bind'] extends (host: unknown) => infer Create ? Create : never;
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c'],
		nodes: ROW.nodes.length,
		values: [0, 1, 2],
		events: [],
		ranges: [],
		bind: bind as UniversalProgramPlan['bind'],
	};
}

function emittedEventPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(EVENT_ROW, {
		name: 'createCompactEventRow',
		slotUpdates: true,
	});
	const bind = new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'];
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c', 'e:bindtap'],
		nodes: EVENT_ROW.nodes.length,
		values: [0, 1, 2],
		events: EVENT_ROW.events.map((event) => ({ ...event, slot: 3 })),
		ranges: [],
		bind,
	};
}

function emittedHost(): LynxElementPAPI<FakeNode> & {
	readonly pages: FakeNode[];
} {
	const base = createFakePAPI();
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
	before: FakeNode | null = null,
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

describe('@octanejs/lynx compact compiled-program store', () => {
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
				plan: { ...plan, ranges: [{ slot: 0, node: 0, id: 1 }] },
				values: ['a', 'b', 'c'],
			}),
		).toThrow(/range-free/);
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
		mountRow(store, papi, page, 3, plan, page.children[1]!);
		store.commit();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-3', 'row-2']);
		store.begin();
		store.remove(3);
		store.rollback();
		expect(page.children.map((node) => node.id)).toEqual(['row-1', 'row-3', 'row-2']);
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
});
