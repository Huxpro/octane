import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import type { UniversalHostTemplateProgram, UniversalProgramPlan } from 'octane/universal/native';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import { createLynxElementPAPI } from '../src/core/papi.js';
import {
	createLynxMainThreadRefDescriptor,
	createLynxMainThreadWorkletRegistry,
	registerMainThreadWorklet,
	unregisterMainThreadWorklet,
	type LynxActivatedMainThreadWorklet,
} from '../src/core/worklets.js';
import '../src/main-worklets.js';

const IDS = ['compact-list:first', 'compact-list:second', 'compact-list:updated'] as const;

function plan(
	wire: UniversalHostTemplateProgram,
	name: string,
	slots: UniversalProgramPlan['slots'],
	values: UniversalProgramPlan['values'],
	ranges: UniversalProgramPlan['ranges'] = [],
): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(wire, {
		name,
		slotUpdates: true,
		structuralRuns: true,
		ranges: ranges.map((range) => ({ node: range.node, before: range.before })),
	});
	return Object.freeze({
		kind: 'program',
		slots,
		nodes: wire.nodes.length,
		values,
		events: Object.freeze([]),
		ranges,
		bind: new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'],
		wire,
	});
}

afterEach(() => {
	for (const id of IDS) unregisterMainThreadWorklet(id);
});

describe.sequential('@octanejs/lynx compact native-list worklets', () => {
	it('transfers keyed event/ref ownership across demand, recycle, update, and re-entry', () => {
		const dom = new JSDOM();
		installLynxTestingEnv(globalThis, { window: dom.window as never });
		const environment = globalThis.lynxTestingEnv;
		environment.clearGlobal();
		environment.switchToMainThread();
		const registry = createLynxMainThreadWorkletRegistry();
		try {
			const activations: LynxActivatedMainThreadWorklet[] = [];
			const target = globalThis as unknown as Record<string, unknown>;
			const addEvent = target.__AddEvent as (
				node: object,
				kind: string,
				name: string,
				listener: unknown,
			) => void;
			target.__AddEvent = (node: object, kind: string, name: string, listener: unknown) => {
				if (
					listener !== null &&
					typeof listener === 'object' &&
					(listener as { readonly type?: unknown }).type === 'worklet'
				) {
					activations.push((listener as { readonly value: LynxActivatedMainThreadWorklet }).value);
				}
				addEvent.call(target, node, kind, name, listener);
			};

			const first = registerMainThreadWorklet(IDS[0], undefined, () => 'first');
			const second = registerMainThreadWorklet(IDS[1], undefined, () => 'second');
			const updated = registerMainThreadWorklet(IDS[2], undefined, () => 'updated');
			const firstRef = createLynxMainThreadRefDescriptor('compact-list:first-ref');
			const secondRef = createLynxMainThreadRefDescriptor('compact-list:second-ref');
			const updatedRef = createLynxMainThreadRefDescriptor('compact-list:updated-ref');
			const firstCell = registry.retainOwner(firstRef);
			const secondCell = registry.retainOwner(secondRef);
			const updatedCell = registry.retainOwner(updatedRef);

			const shellWire: UniversalHostTemplateProgram = Object.freeze({
				nodes: Object.freeze([
					Object.freeze({ type: 'view', parent: -1, props: Object.freeze({}) }),
					Object.freeze({ type: 'list', parent: 0, props: Object.freeze({ id: 'feed' }) }),
				]),
				events: Object.freeze([]),
			});
			const rowWire: UniversalHostTemplateProgram = Object.freeze({
				nodes: Object.freeze([
					Object.freeze({
						type: 'list-item',
						parent: -1,
						props: Object.freeze({ 'reuse-identifier': 'row' }),
						bindings: Object.freeze([
							Object.freeze({ name: 'item-key', valueIndex: 0 }),
							Object.freeze({ name: 'main-thread:bindtap', valueIndex: 2 }),
							Object.freeze({ name: 'main-thread:ref', valueIndex: 3 }),
						]),
					}),
					Object.freeze({
						type: 'text',
						parent: 0,
						props: Object.freeze({}),
						bindings: Object.freeze([Object.freeze({ name: 'text', valueIndex: 1 })]),
					}),
				]),
				events: Object.freeze([]),
			});
			const shell = plan(
				shellWire,
				'createCompactWorkletList',
				['r'],
				[],
				[{ slot: 0, node: 1, id: 1 }],
			);
			const row = plan(
				rowWire,
				'createCompactWorkletRow',
				['p:item-key', 'p:text', 'p:main-thread:bindtap', 'p:main-thread:ref'],
				[0, 1, 2, 3],
			);
			const papi = createLynxElementPAPI(globalThis);
			const page = papi.createPage('0', 0);
			const store = createLynxCompiledProgramStore(
				papi,
				papi.getUniqueId(page),
				91,
				1,
				undefined,
				undefined,
				undefined,
				registry,
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
				count: 2,
				parent: listNode,
				before: null,
				plan: row,
				values: ['first', 'First', first, firstRef, 'second', 'Second', second, secondRef],
			});
			expect(store.visibility(3, false)).toBe(true);
			expect(store.visibility(4, false)).toBe(true);
			store.commit();
			papi.flush(page);

			const list = (page as unknown as Element).querySelector('#feed')!;
			const activationsBeforeFirstDemand = activations.length;
			const firstRefBeforeDemand = firstCell.current;
			const firstSign = globalThis.elementTree.enterListItemAtIndex(list as never, 0);
			const physicalCell = list.firstElementChild!;
			expect(activations).toHaveLength(activationsBeforeFirstDemand);
			expect(firstCell.current).toBe(firstRefBeforeDemand);

			store.begin();
			expect(store.visibility(3, true)).toBe(true);
			store.commit();
			const firstActive = activations.at(-1)!;
			expect(registry.runWorklet(firstActive)).toBe('first');
			expect(firstCell.current).toBe(physicalCell);

			globalThis.elementTree.leaveListItem(list as never, firstSign);
			expect(firstCell.current).toBeNull();
			expect(() => registry.runWorklet(firstActive)).toThrow(/stale or foreign/);
			const activationsBeforeHiddenDemand = activations.length;
			const secondRefBeforeDemand = secondCell.current;
			const secondSign = globalThis.elementTree.enterListItemAtIndex(list as never, 1);
			expect(secondSign).toBe(firstSign);
			expect(list.firstElementChild).toBe(physicalCell);
			expect(activations).toHaveLength(activationsBeforeHiddenDemand);
			expect(secondCell.current).toBe(secondRefBeforeDemand);

			store.begin();
			expect(store.visibility(4, true)).toBe(true);
			store.commit();
			const secondActive = activations.at(-1)!;
			expect(registry.runWorklet(secondActive)).toBe('second');
			expect(secondCell.current).toBe(physicalCell);

			store.begin();
			expect(store.set(4, 2, updated)).toBe(true);
			expect(store.set(4, 3, updatedRef)).toBe(true);
			store.commit();
			const updatedActive = activations.at(-1)!;
			expect(() => registry.runWorklet(secondActive)).toThrow(/stale or foreign/);
			expect(registry.runWorklet(updatedActive)).toBe('updated');
			expect(secondCell.current).toBeNull();
			expect(updatedCell.current).toBe(physicalCell);

			globalThis.elementTree.leaveListItem(list as never, secondSign);
			expect(updatedCell.current).toBeNull();
			expect(() => registry.runWorklet(updatedActive)).toThrow(/stale or foreign/);
			expect(globalThis.elementTree.enterListItemAtIndex(list as never, 1)).toBe(secondSign);
			const reentered = activations.at(-1)!;
			expect(registry.runWorklet(reentered)).toBe('updated');
			expect(updatedCell.current).toBe(physicalCell);

			store.begin();
			store.remove(4);
			store.commit();
			papi.flush(page);
			expect(updatedCell.current).toBeNull();
			expect(() => registry.runWorklet(reentered)).toThrow(/stale or foreign/);

			store.dispose();
			registry.releaseOwner(firstRef);
			registry.releaseOwner(secondRef);
			registry.releaseOwner(updatedRef);
		} finally {
			registry.close();
			environment.clearGlobal();
			uninstallLynxTestingEnv(globalThis);
			dom.window.close();
		}
	});
});
