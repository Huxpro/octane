import type { UniversalHostTemplateProgram, UniversalProgramPlan } from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { applyLynxCompiledProgramFrame } from '../src/core/compiled-program-frame.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import { encodeLynxDeltaMessage, LYNX_DELTA_PROTOCOL_VERSION } from '../src/core/delta-protocol.js';
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

function emittedPlan(): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(ROW, {
		name: 'createCompactFrameRow',
		slotUpdates: true,
	});
	const bind = new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'];
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c'],
		nodes: ROW.nodes.length,
		values: [0, 1, 2],
		events: [],
		ranges: [],
		bind,
	};
}

function emittedEventPlan(): UniversalProgramPlan {
	const program: UniversalHostTemplateProgram = {
		...ROW,
		events: [{ node: 0, type: 'bindtap', priority: 'discrete' }],
	};
	const emission = emitLynxMainThreadProgram(program, {
		name: 'createCompactFrameEventRow',
		slotUpdates: true,
	});
	return {
		kind: 'program',
		slots: ['p:id', 'p:class', 'c', 'e:bindtap'],
		nodes: program.nodes.length,
		values: [0, 1, 2],
		events: program.events.map((event) => ({ ...event, slot: 3 })),
		ranges: [],
		bind: new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'],
	};
}

function emittedHost(): LynxElementPAPI<FakeNode> {
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

function setup() {
	const papi = emittedHost();
	const page = papi.createPage('0', 0);
	const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
	const plan = emittedPlan();
	const resolve = (template: number) => (template === 7 ? plan : undefined);
	return { page, plan, resolve, store };
}

describe('@octanejs/lynx compact compiled-program frame router', () => {
	it('streams an eventful RUN without adding event fields to the v2 frame', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 73);
		const plan = emittedEventPlan();
		applyLynxCompiledProgramFrame(
			store,
			page,
			(template) => (template === 8 ? plan : undefined),
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 8,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'label-2'],
				},
			]),
		);
		expect(decodeLynxNativeEventToken(page.children[0]!.events.get('bindEvent:tap'))).toEqual({
			root: 73,
			id: 2,
			generation: 1,
			listener: 1,
			priority: 'discrete',
		});
	});

	it('streams dense RUN, SET, and REMOVE frames into the compiled store', () => {
		const { page, resolve, store } = setup();
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 7,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 2,
					values: ['row-2', 'cold', 'label-2', 'row-3', 'cold', 'label-3'],
				},
			]),
		);
		expect(store.size()).toBe(2);
		expect(shape(page)).toMatchObject({
			children: [
				{ id: 'row-2', classes: 'cold', children: [{ children: [{ text: 'label-2' }] }] },
				{ id: 'row-3', classes: 'cold', children: [{ children: [{ text: 'label-3' }] }] },
			],
		});

		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{ op: 'set', instance: 3, slot: 0, value: 'selected' },
				{ op: 'set', instance: 3, slot: 2, value: 'renamed' },
				{ op: 'remove', firstInstance: 2, count: 1 },
			]),
		);
		expect(store.size()).toBe(1);
		expect(shape(page)).toMatchObject({
			children: [
				{
					id: 'selected',
					classes: 'cold',
					children: [{ children: [{ text: 'renamed' }] }],
				},
			],
		});
	});

	it('inserts a RUN before an existing root addressed by instance', () => {
		const { page, resolve, store } = setup();
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 7,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['tail', 'cold', 'tail'],
				},
			]),
		);
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 7,
					parent: { instance: 1, slot: 0 },
					before: { instance: 2, slot: 0 },
					firstInstance: 3,
					count: 1,
					values: ['head', 'cold', 'head'],
				},
			]),
		);
		expect(page.children.map((node) => node.id)).toEqual(['head', 'tail']);
	});

	it('rolls back earlier operations when a later frame is malformed', () => {
		const { page, resolve, store } = setup();
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 7,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'label-2'],
				},
			]),
		);

		expect(() =>
			applyLynxCompiledProgramFrame(store, page, resolve, [
				LYNX_DELTA_PROTOCOL_VERSION,
				2,
				3,
				2,
				0,
				'draft',
				99,
				0,
			]),
		).toThrow(/opcode 99/);
		expect(store.size()).toBe(1);
		expect(page.children[0]!.id).toBe('row-2');
	});

	it('rejects unresolved programs and wrong RUN arity without partial publication', () => {
		const { page, resolve, store } = setup();
		const unresolved = encodeLynxDeltaMessage([
			{
				op: 'run',
				templateId: 8,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: ['row-2', 'cold', 'label-2'],
			},
		]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, unresolved)).toThrow(
			/template 8/,
		);
		expect(() =>
			applyLynxCompiledProgramFrame(
				store,
				page,
				resolve,
				encodeLynxDeltaMessage([
					{
						op: 'run',
						templateId: 7,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 1,
						values: ['missing', 'one-value'],
					},
				]),
			),
		).toThrow(/RUN value arity/);
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it.each([
		['CLEAR', [LYNX_DELTA_PROTOCOL_VERSION, 4, 2, 1, 0]],
		['MOVE', [LYNX_DELTA_PROTOCOL_VERSION, 5, 5, 2, 1, 0, 0, 0]],
		['VIS', [LYNX_DELTA_PROTOCOL_VERSION, 6, 2, 2, 1]],
	] as const)('hard-rejects unsupported %s frames', (_, frame) => {
		const { page, resolve, store } = setup();
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, frame)).toThrow(
			/does not support opcode/,
		);
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('rejects a root sentinel as a live RUN instance', () => {
		const { page, resolve, store } = setup();
		expect(() =>
			applyLynxCompiledProgramFrame(store, page, resolve, [
				LYNX_DELTA_PROTOCOL_VERSION,
				1,
				10,
				7,
				1,
				0,
				0,
				0,
				1,
				1,
				'row-1',
				'cold',
				'label-1',
			]),
		).toThrow(/reserves instance 1/);
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});
});
