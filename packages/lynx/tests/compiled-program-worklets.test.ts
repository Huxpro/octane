import type { UniversalHostTemplateProgram, UniversalProgramPlan } from 'octane/universal/native';
import { afterEach, describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	createLynxMainThreadRefDescriptor,
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
	unregisterMainThreadWorklet,
	type LynxActivatedMainThreadWorklet,
	type LynxMainThreadRefDescriptor,
	type LynxMainThreadWorkletDescriptor,
} from '../src/core/worklets.js';
import '../src/main-worklets.js';
import { createFakePAPI, type FakeNode } from './_fixtures/fake-element-papi.js';

const IDS = ['compact:first', 'compact:second'] as const;

const PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'view',
			parent: -1,
			props: Object.freeze({}),
			bindings: Object.freeze([
				Object.freeze({ name: 'class', valueIndex: 0 }),
				Object.freeze({ name: 'main-thread:bindtap', valueIndex: 1 }),
				Object.freeze({ name: 'main-thread:ref', valueIndex: 2 }),
			]),
		}),
	]),
	events: Object.freeze([]),
});

function emittedHost(): LynxElementPAPI<FakeNode> {
	const base = createFakePAPI();
	return {
		...base,
		intrinsics: {
			view: (pageId) => base.createElement('view', pageId, ''),
			text: (pageId) => base.createElement('text', pageId, ''),
			rawText: (value) => base.createElement('#text', 0, value),
		},
		append: (parent, child) => base.insertBefore(parent, child, null),
	};
}

function plan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(PROGRAM, {
		name: 'createCompactWorkletRow',
		slotUpdates: true,
	});
	return Object.freeze({
		kind: 'program',
		slots: Object.freeze([
			'p:class',
			'p:main-thread:bindtap',
			'p:main-thread:ref',
		]) as UniversalProgramPlan['slots'],
		nodes: 1,
		values: Object.freeze([0, 1, 2]),
		events: Object.freeze([]),
		ranges: Object.freeze([]),
		bind: new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'],
		wire: PROGRAM,
	});
}

function listener(node: FakeNode): LynxActivatedMainThreadWorklet {
	return (
		node.events.get('bindEvent:tap') as {
			readonly type: 'worklet';
			readonly value: LynxActivatedMainThreadWorklet;
		}
	).value;
}

function mount(
	store: ReturnType<typeof createLynxCompiledProgramStore<FakeNode>>,
	page: FakeNode,
	program: UniversalProgramPlan,
	worklet: LynxMainThreadWorkletDescriptor,
	ref: LynxMainThreadRefDescriptor,
): void {
	store.mount({
		firstHandle: 1,
		count: 1,
		parent: page,
		before: null,
		plan: program,
		values: ['row', worklet, ref],
	});
}

afterEach(() => {
	for (const id of IDS) unregisterMainThreadWorklet(id);
});

describe('@octanejs/lynx compact compiled-program worklets', () => {
	it('owns event and ref lifetimes across rollback, visibility, removal, and teardown', () => {
		const first = registerMainThreadWorklet(IDS[0], undefined, () => 'first');
		const second = registerMainThreadWorklet(IDS[1], undefined, () => 'second');
		const firstRef = createLynxMainThreadRefDescriptor('compact:first-ref');
		const secondRef = createLynxMainThreadRefDescriptor('compact:second-ref');
		const registry = createLynxMainThreadWorkletRegistry();
		const firstCell = registry.retainOwner(firstRef);
		const secondCell = registry.retainOwner(secondRef);
		const papi = emittedHost();
		const page = papi.createPage('entry', 0);
		const program = plan();
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			47,
			1,
			undefined,
			undefined,
			undefined,
			registry,
		);

		store.begin();
		mount(store, page, program, first, firstRef);
		store.commit();
		const node = page.children[0]!;
		const mounted = listener(node);
		expect(registry.runWorklet(mounted)).toBe('first');
		expect(firstCell.current).toBe(node);

		store.begin();
		expect(store.set(1, 1, second)).toBe(true);
		expect(store.set(1, 2, secondRef)).toBe(true);
		const rejected = listener(node);
		expect(registry.runWorklet(rejected)).toBe('second');
		expect(firstCell.current).toBeNull();
		expect(secondCell.current).toBe(node);
		store.rollback();
		expect(registry.runWorklet(listener(node))).toBe('first');
		expect(() => registry.runWorklet(rejected)).toThrow(/stale or foreign/);
		expect(firstCell.current).toBe(node);
		expect(secondCell.current).toBeNull();

		store.begin();
		store.set(1, 1, second);
		store.set(1, 2, secondRef);
		store.commit();
		expect(() => registry.runWorklet(mounted)).toThrow(/stale or foreign/);
		expect(registry.runWorklet(listener(node))).toBe('second');
		expect(firstCell.current).toBeNull();
		expect(secondCell.current).toBe(node);

		const beforeHide = listener(node);
		store.begin();
		store.visibility(1, false);
		store.commit();
		expect(node.events.has('bindEvent:tap')).toBe(false);
		expect(secondCell.current).toBeNull();
		expect(() => registry.runWorklet(beforeHide)).toThrow(/stale or foreign/);

		store.begin();
		store.visibility(1, true);
		store.commit();
		const revealed = listener(node);
		expect(registry.runWorklet(revealed)).toBe('second');
		expect(secondCell.current).toBe(node);

		store.begin();
		store.remove(1);
		expect(page.children).toEqual([]);
		expect(secondCell.current).toBeNull();
		store.rollback();
		expect(page.children).toEqual([node]);
		expect(secondCell.current).toBe(node);
		expect(() => registry.runWorklet(revealed)).toThrow(/stale or foreign/);
		expect(registry.runWorklet(listener(node))).toBe('second');

		store.dispose();
		expect(page.children).toEqual([]);
		expect(secondCell.current).toBeNull();
		registry.releaseOwner(firstRef);
		registry.releaseOwner(secondRef);
		registry.close();
	});

	it('keeps ordinary programs independent from the optional registry', () => {
		const papi = emittedHost();
		const page = papi.createPage('entry', 0);
		const ordinaryProgram: UniversalProgramPlan = {
			...plan(),
			slots: Object.freeze(['p:class']),
			values: Object.freeze([0]),
			wire: Object.freeze({
				nodes: Object.freeze([
					Object.freeze({
						type: 'view',
						parent: -1,
						props: Object.freeze({}),
						bindings: Object.freeze([Object.freeze({ name: 'class', valueIndex: 0 })]),
					}),
				]),
				events: Object.freeze([]),
			}),
		};
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));

		store.begin();
		store.mount({
			firstHandle: 1,
			count: 1,
			parent: page,
			before: null,
			plan: ordinaryProgram,
			values: ['ordinary'],
		});
		store.commit();
		expect(page.children[0]!.classes).toBe('ordinary');
		store.dispose();
	});

	it('still removes a partially inserted root when worklet abort also fails', () => {
		const descriptor = registerMainThreadWorklet(IDS[0], undefined, () => 'fault');
		const ref = createLynxMainThreadRefDescriptor('compact:fault-ref');
		const baseRegistry = createLynxMainThreadWorkletRegistry();
		const registry = {
			...baseRegistry,
			release(value: LynxActivatedMainThreadWorklet | number) {
				baseRegistry.release(value);
				throw new Error('worklet abort fault');
			},
		};
		const base = emittedHost();
		let failInsert = true;
		const papi: typeof base = {
			...base,
			insertBefore(parent, child, before) {
				base.insertBefore(parent, child, before);
				if (failInsert) {
					failInsert = false;
					throw new Error('insert-after-mutation fault');
				}
			},
		};
		const page = papi.createPage('entry', 0);
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			47,
			1,
			undefined,
			undefined,
			undefined,
			registry,
		);

		store.begin();
		expect(() => mount(store, page, plan(), descriptor, ref)).toThrow(AggregateError);
		expect(page.children).toEqual([]);
		expect(store.isFaulted()).toBe(true);
		store.dispose();
		baseRegistry.close();
	});

	describe('a main-thread ref moving between hosts', () => {
		// `<view main-thread:ref={c ? r : null} /><view main-thread:ref={c ? null : r} />`
		// as two rows of one program: toggling `c` moves `r` in one frame, and the
		// frame's slot writes may name the new owner before they clear the old one.
		function setup() {
			const ref = createLynxMainThreadRefDescriptor('compact:moving-ref');
			const registry = createLynxMainThreadWorkletRegistry();
			const cell = registry.retainOwner(ref);
			const papi = emittedHost();
			const page = papi.createPage('entry', 0);
			const store = createLynxCompiledProgramStore(
				papi,
				papi.getUniqueId(page),
				47,
				1,
				undefined,
				undefined,
				undefined,
				registry,
			);
			store.begin();
			store.mount({
				firstHandle: 1,
				count: 2,
				parent: page,
				before: null,
				plan: plan(),
				values: ['a', null, ref, 'b', null, null],
			});
			store.commit();
			const [a, b] = page.children as [FakeNode, FakeNode];
			const close = () => {
				store.dispose();
				expect(cell.current).toBeNull();
				registry.releaseOwner(ref);
				registry.close();
			};
			return { ref, cell, store, a, b, close };
		}

		it('hands the ref over in either direction whichever slot the frame writes first', () => {
			const { ref, cell, store, a, b, close } = setup();
			expect(cell.current).toBe(a);

			store.begin();
			expect(store.set(2, 2, ref)).toBe(true);
			expect(store.set(1, 2, null)).toBe(true);
			store.commit();
			expect(cell.current).toBe(b);

			store.begin();
			expect(store.set(1, 2, ref)).toBe(true);
			expect(store.set(2, 2, null)).toBe(true);
			store.commit();
			expect(cell.current).toBe(a);

			store.begin();
			expect(store.set(1, 2, null)).toBe(true);
			expect(store.set(2, 2, ref)).toBe(true);
			store.commit();
			expect(cell.current).toBe(b);

			// The previous owner no longer holds the ref: tearing it down leaves the
			// new owner's target in place.
			store.begin();
			store.visibility(1, false);
			store.commit();
			expect(cell.current).toBe(b);
			store.begin();
			store.remove(1);
			store.commit();
			expect(cell.current).toBe(b);
			close();
		});

		it('restores the previous owner when a frame that moved the ref is rejected', () => {
			const { ref, cell, store, a, close } = setup();

			store.begin();
			expect(store.set(2, 2, ref)).toBe(true);
			store.rollback();
			expect(cell.current).toBe(a);

			store.begin();
			expect(store.set(2, 2, ref)).toBe(true);
			expect(store.set(1, 2, null)).toBe(true);
			store.rollback();
			expect(cell.current).toBe(a);

			// Ownership, not just the cell, was restored: the original host still
			// releases the ref, and the other host never kept a claim on it.
			store.begin();
			expect(store.set(1, 2, null)).toBe(true);
			store.commit();
			expect(cell.current).toBeNull();
			close();
		});

		it('rejects a frame that leaves the ref on two live hosts', () => {
			const { ref, cell, store, a, close } = setup();

			store.begin();
			expect(store.set(2, 2, ref)).toBe(true);
			expect(() => store.commit()).toThrow(/ref "compact:moving-ref" is already mounted/);
			store.rollback();
			expect(cell.current).toBe(a);

			store.begin();
			expect(store.set(2, 2, ref)).toBe(true);
			expect(() => store.prepareCommit()).toThrow(/ref "compact:moving-ref" is already mounted/);
			store.rollback();
			expect(cell.current).toBe(a);
			close();
		});
	});
});
