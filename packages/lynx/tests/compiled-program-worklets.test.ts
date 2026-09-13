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
});
