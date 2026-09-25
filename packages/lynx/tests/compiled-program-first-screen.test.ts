import type { UniversalHostTemplateProgram, UniversalProgramPlan } from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { paintLynxCompiledProgramFirstScreen } from '../src/core/compiled-program-first-screen.js';
import type { LynxFirstScreenRenderResult } from '../src/main-renderer-product.js';
import { createFakePAPI } from './_fixtures/fake-element-papi.js';

function emittedPlan(
	program: UniversalHostTemplateProgram,
	name: string,
	ranges: UniversalProgramPlan['ranges'] = [],
): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(program, { name, ranges, structuralRuns: true });
	return {
		kind: 'program',
		slots: ranges.map(() => 'r'),
		nodes: program.nodes.length,
		values: [],
		events: [],
		ranges,
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
		wire: program,
	};
}

describe('compiled-program first-screen painter', () => {
	it('paints a nested program before its retained static range anchor', () => {
		const shellWire: UniversalHostTemplateProgram = {
			nodes: [
				{ type: 'view', parent: -1, props: { class: 'shell' } },
				{ type: 'text', parent: 0, props: { class: 'footer' } },
			],
			events: [],
		};
		const range = { slot: 0, node: 0, before: 1, id: 1, paintsText: false } as const;
		const shell = emittedPlan(shellWire, 'createAnchoredFirstScreenShell', [range]);
		const row = emittedPlan(
			{
				nodes: [{ type: 'view', parent: -1, props: { class: 'row' } }],
				events: [],
			},
			'createAnchoredFirstScreenRow',
		);
		const result: LynxFirstScreenRenderResult = {
			batch: undefined as never,
			envelope: { renderer: 'lynx', version: 1, events: [] },
			hostCount: 3,
			logicalCount: 3,
			programs: 2,
			nodes: [
				{
					kind: 'program',
					id: 1,
					plan: shell,
					values: [],
					ids: [1, 3],
					spans: [1],
					texts: [undefined],
					rangeIds: [undefined],
					children: [
						{
							kind: 'program',
							id: 2,
							plan: row,
							values: [],
							ids: [2],
							spans: [],
							texts: [],
							rangeIds: [],
							children: [],
						},
					],
				},
			],
		};
		const base = createFakePAPI();
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
		};
		const page = papi.createPage('0', 0);
		const adoption = paintLynxCompiledProgramFirstScreen(result, papi, page);
		expect(page.children[0]!.children.map((child) => child.classes)).toEqual(['row', 'footer']);
		adoption.dispose();
		expect(page.children).toEqual([]);
	});

	it('paints sibling ranges in compiler order before their shared static anchor', () => {
		const shellWire: UniversalHostTemplateProgram = {
			nodes: [
				{ type: 'view', parent: -1, props: { class: 'shell' } },
				{ type: 'text', parent: 0, props: { class: 'footer' } },
			],
			events: [],
		};
		const shell = emittedPlan(shellWire, 'createSiblingFirstScreenShell', [
			{ slot: 0, node: 0, before: 1, id: 1, paintsText: false },
			{ slot: 1, node: 0, before: 1, id: 2, paintsText: false },
		]);
		const row = (name: string, className: string) =>
			emittedPlan(
				{ nodes: [{ type: 'view', parent: -1, props: { class: className } }], events: [] },
				name,
			);
		const first = row('createFirstSiblingRow', 'first');
		const second = row('createSecondSiblingRow', 'second');
		const child = (id: number, plan: UniversalProgramPlan) => ({
			kind: 'program' as const,
			id,
			plan,
			values: [],
			ids: [id],
			spans: [],
			texts: [],
			rangeIds: [],
			children: [],
		});
		const result: LynxFirstScreenRenderResult = {
			batch: undefined as never,
			envelope: { renderer: 'lynx', version: 1, events: [] },
			hostCount: 4,
			logicalCount: 4,
			programs: 3,
			nodes: [
				{
					kind: 'program',
					id: 1,
					plan: shell,
					values: [],
					ids: [1, 4],
					spans: [1, 1],
					texts: [undefined, undefined],
					rangeIds: [undefined, undefined],
					children: [child(2, first), child(3, second)],
				},
			],
		};
		const base = createFakePAPI();
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
		};
		const page = papi.createPage('0', 0);
		const adoption = paintLynxCompiledProgramFirstScreen(result, papi, page);

		expect(page.children[0]!.children.map((node) => node.classes)).toEqual([
			'first',
			'second',
			'footer',
		]);
		adoption.dispose();
	});

	it('hides an Activity program before attaching it to the page', () => {
		const plan = emittedPlan(
			{ nodes: [{ type: 'view', parent: -1, props: { class: 'hidden' } }], events: [] },
			'createHiddenFirstScreenProgram',
		);
		const result: LynxFirstScreenRenderResult = {
			batch: undefined as never,
			envelope: { renderer: 'lynx', version: 1, events: [] },
			hostCount: 1,
			logicalCount: 1,
			programs: 1,
			nodes: [
				{
					kind: 'program',
					id: 1,
					plan,
					values: [],
					ids: [1],
					spans: [],
					texts: [],
					rangeIds: [],
					visibility: 'hidden',
					children: [],
				},
			],
		};
		const base = createFakePAPI();
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
		};
		const page = papi.createPage('0', 0);
		const writes: unknown[] = [];
		const setAttribute = papi.setAttribute;
		const observingPAPI = {
			...papi,
			setAttribute(node: Parameters<typeof setAttribute>[0], name: string, value: unknown) {
				writes.push([name, value, page.children.length]);
				setAttribute(node, name, value);
			},
		};

		const adoption = paintLynxCompiledProgramFirstScreen(result, observingPAPI, page);
		expect(writes).toContainEqual(['hidden', true, 0]);
		expect(page.children[0]?.attributes.hidden).toBe(true);
		adoption.dispose();
	});

	it('transfers nested sibling programs when the background batches their parent run', () => {
		const range = { slot: 0, node: 0, id: 1, paintsText: false } as const;
		const group = emittedPlan(
			{
				nodes: [{ type: 'view', parent: -1, props: { class: 'group' } }],
				events: [],
			},
			'createBatchedFirstScreenGroup',
			[range],
		);
		const leaf = emittedPlan(
			{
				nodes: [{ type: 'text', parent: -1, props: { class: 'leaf' } }],
				events: [],
			},
			'createBatchedFirstScreenLeaf',
		);
		const child = (id: number) => ({
			kind: 'program' as const,
			id,
			plan: leaf,
			values: [],
			ids: [id],
			spans: [],
			texts: [],
			rangeIds: [],
			children: [],
		});
		const parent = (id: number) => ({
			kind: 'program' as const,
			id,
			plan: group,
			values: [],
			ids: [id],
			spans: [1],
			texts: [undefined],
			rangeIds: [undefined],
			children: [child(id + 1)],
		});
		const result: LynxFirstScreenRenderResult = {
			batch: undefined as never,
			envelope: { renderer: 'lynx', version: 1, events: [] },
			hostCount: 4,
			logicalCount: 4,
			programs: 4,
			nodes: [parent(1), parent(3)],
		};
		const base = createFakePAPI();
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
		};
		const page = papi.createPage('0', 0);
		const adoption = paintLynxCompiledProgramFirstScreen(result, papi, page);
		const parents = adoption.resolveSeed({
			firstHandle: 2,
			count: 2,
			parent: page,
			before: null,
			plan: group,
			values: [],
		});
		expect(parents).toBeDefined();
		const firstParent = parents!.nodes[0]!;
		const secondParent = parents!.nodes[2]!;
		const firstLeaf = adoption.resolveSeed({
			firstHandle: 4,
			count: 1,
			parent: firstParent,
			before: null,
			plan: leaf,
			values: [],
		});
		const secondLeaf = adoption.resolveSeed({
			firstHandle: 5,
			count: 1,
			parent: secondParent,
			before: null,
			plan: leaf,
			values: [],
		});

		expect(page.children).toEqual([firstParent, secondParent]);
		expect(firstLeaf?.nodes[0]).toBe(firstParent.children[0]);
		expect(secondLeaf?.nodes[0]).toBe(secondParent.children[0]);
		expect(() => adoption.verify()).not.toThrow();
		adoption.finish();
		adoption.dispose();
		expect(page.children).toEqual([firstParent, secondParent]);
	});

	it('defers a native-list first screen without creating a generic host or requiring adoption', () => {
		const list = emittedPlan(
			{ nodes: [{ type: 'list', parent: -1, props: { 'list-type': 'single' } }], events: [] },
			'createDeferredFirstScreenList',
		);
		const result: LynxFirstScreenRenderResult = {
			batch: undefined as never,
			envelope: { renderer: 'lynx', version: 1, events: [] },
			hostCount: 1,
			logicalCount: 1,
			programs: 1,
			nodes: [
				{
					kind: 'program',
					id: 1,
					plan: list,
					values: [],
					ids: [1],
					spans: [],
					texts: [],
					rangeIds: [],
					children: [],
				},
			],
		};
		const papi = createFakePAPI();
		const page = papi.createPage('0', 0);
		const adoption = paintLynxCompiledProgramFirstScreen(result, papi, page);
		expect(adoption.firstScreen).toBe('deferred-native-list');
		expect(page.children).toEqual([]);
		expect(
			adoption.resolveSeed({
				firstHandle: 2,
				count: 1,
				parent: page,
				before: null,
				plan: list,
				values: [],
			}),
		).toBeUndefined();
		expect(() => adoption.verify()).not.toThrow();
		adoption.finish();
		adoption.dispose();
	});
});
