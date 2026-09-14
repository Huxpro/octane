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
		slots: ranges.length === 0 ? [] : ['r'],
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
