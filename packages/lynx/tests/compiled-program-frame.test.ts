import type {
	UniversalHostTemplateProgram,
	UniversalProgramCreate,
	UniversalProgramPlan,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import { applyLynxCompiledProgramFrame } from '../src/core/compiled-program-frame.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import { encodeLynxDeltaMessage, LYNX_DELTA_PROTOCOL_VERSION } from '../src/core/delta-protocol.js';
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

function emittedStructuralPlan(): UniversalProgramPlan {
	const program: UniversalHostTemplateProgram = {
		nodes: [
			{ type: 'view', parent: -1, props: { id: 'shell' } },
			{ type: 'view', parent: 0, props: { id: 'rows' } },
		],
		events: [],
	};
	const range = { slot: 7, node: 1, id: 2, paintsText: false } as const;
	const emission = emitLynxMainThreadProgram(program, {
		name: 'createCompactStructuralShell',
		ranges: [range],
	});
	const emitted = new Function(`return (${emission.source});`)() as UniversalProgramPlan['bind'];
	const bind: UniversalProgramPlan['bind'] = (host) => {
		const create = emitted(host) as UniversalProgramCreate & {
			run?: UniversalProgramCreate['run'];
		};
		create.run = (pageId, count, _values, _events, ranges, out) => {
			for (let instance = 0; instance < count; instance++) {
				const created = create(pageId, ranges[instance]);
				for (let index = 0; index < created.length; index++) {
					out[instance * created.length + index] = created[index];
				}
			}
		};
		return create;
	};
	return {
		kind: 'program',
		slots: [null, null, null, null, null, null, null, 'r'],
		nodes: program.nodes.length,
		values: [],
		events: [],
		ranges: [range],
		bind,
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
				root: 73,
				id: firstId + row * stride + event.node,
				generation: 1,
				listener: firstListenerId + row * plan.events.length + site,
				priority: event.priority,
			}),
		),
	).flat();
	plan.bind(papi).run!(papi.getUniqueId(page), count, values, events, [], nodes);
	for (let row = 0; row < count; row++) {
		papi.insertBefore(page, nodes[row * plan.nodes]!, null);
	}
	return nodes;
}

function setup() {
	const papi = emittedHost();
	const page = papi.createPage('0', 0);
	const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
	const plan = emittedPlan();
	store.begin();
	store.define(1, plan);
	store.commit();
	const resolve = () => undefined;
	return { page, plan, resolve, store };
}

describe('@octanejs/lynx compact compiled-program frame router', () => {
	it('rolls back template settlement with a malformed frame and accepts the exact retry', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const plan = emittedPlan();
		const address = { module: 'tests/Row.lynx.tsrx', index: 0 };
		const resolve = (module: string, index: number) =>
			module === address.module && index === address.index ? plan : undefined;
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'label-2'],
				},
			],
			[{ id: 1, address }],
		);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...frame, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(store.resolve(1)).toBeUndefined();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);

		applyLynxCompiledProgramFrame(store, page, resolve, frame);
		expect(store.resolve(1)).toBe(plan);
		expect(store.size()).toBe(1);
		expect(page.children[0]!.id).toBe('row-2');
	});

	it('streams an eventful RUN without adding event fields to the v2 frame', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 73);
		const plan = emittedEventPlan();
		const address = { module: 'tests/EventRow.lynx.tsrx', index: 0 };
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'label-2'],
				},
			],
			[{ id: 1, address }],
		);
		expect(frame).toEqual([
			LYNX_DELTA_PROTOCOL_VERSION,
			7,
			3,
			1,
			'tests/EventRow.lynx.tsrx',
			0,
			1,
			10,
			1,
			1,
			0,
			0,
			0,
			2,
			1,
			'row-2',
			'cold',
			'label-2',
		]);
		applyLynxCompiledProgramFrame(
			store,
			page,
			(module, index) => (module === address.module && index === address.index ? plan : undefined),
			frame,
		);
		expect(decodeLynxNativeEventToken(page.children[0]!.events.get('bindEvent:tap'))).toEqual({
			root: 73,
			id: 2,
			generation: 1,
			listener: 1,
			priority: 'discrete',
		});
	});

	it('matches a first-screen run and adopts it without replaying host writes', () => {
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
		const plan = emittedEventPlan();
		const address = { module: 'tests/AdoptedRow.lynx.tsrx', index: 0 };
		const values = ['row-10', 'cold', 'ten', 'row-14', 'cold', 'fourteen'];
		const nodes = paintAdoptableRows(papi, page, plan, values, 10, 4, 1_000_000);
		const tokens = page.children.map((node) => node.events.get('bindEvent:tap'));
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			73,
			1_000_000,
			(firstHandle) =>
				firstHandle === 2
					? {
							firstId: 10,
							firstListenerId: 1_000_000,
							nodes,
							stride: 4,
						}
					: undefined,
		);
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 2,
					values,
				},
			],
			[{ id: 1, address }],
		);
		hostWrites = 0;
		applyLynxCompiledProgramFrame(
			store,
			page,
			(module, index) => (module === address.module && index === address.index ? plan : undefined),
			frame,
		);
		expect(hostWrites).toBe(0);
		expect(store.size()).toBe(2);

		applyLynxCompiledProgramFrame(
			store,
			page,
			() => undefined,
			encodeLynxDeltaMessage([
				{ op: 'set', instance: 3, slot: 2, value: 'updated' },
				{ op: 'vis', instance: 3, state: 'hidden' },
				{ op: 'vis', instance: 3, state: 'visible' },
			]),
		);
		expect(page.children[1]!.children[0]!.children[0]!.text).toBe('updated');
		expect(page.children.map((node) => node.events.get('bindEvent:tap'))).toEqual(tokens);

		applyLynxCompiledProgramFrame(
			store,
			page,
			() => undefined,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 4,
					count: 1,
					values: ['row-20', 'warm', 'twenty'],
				},
			]),
		);
		expect(page.children.map((node) => node.id)).toEqual(['row-10', 'row-14', 'row-20']);
	});

	it('rolls back a divergent first-screen proof and accepts the exact retry', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const plan = emittedEventPlan();
		const address = { module: 'tests/AdoptedRow.lynx.tsrx', index: 0 };
		const values = ['row-10', 'cold', 'ten'];
		const nodes = paintAdoptableRows(papi, page, plan, values, 10, 4, 1_000_000);
		const adoption = {
			firstId: 10,
			firstListenerId: 1_000_000,
			nodes,
			stride: 4,
		};
		let seed = { ...adoption, firstListenerId: 999_999 };
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			73,
			1_000_000,
			(firstHandle) => (firstHandle === 2 ? seed : undefined),
		);
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values,
				},
			],
			[{ id: 1, address }],
		);
		const resolve = (module: string, index: number) =>
			module === address.module && index === address.index ? plan : undefined;

		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, frame)).toThrow(
			/listener identity/,
		);
		expect(store.resolve(1)).toBeUndefined();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([nodes[0]]);
		seed = adoption;
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...frame, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(store.resolve(1)).toBeUndefined();
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([nodes[0]]);

		applyLynxCompiledProgramFrame(store, page, resolve, frame);
		expect(store.resolve(1)).toBe(plan);
		expect(store.size()).toBe(1);
		expect(page.children).toEqual([nodes[0]]);
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
					templateId: 1,
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
					templateId: 1,
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
					templateId: 1,
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
					templateId: 1,
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
						templateId: 1,
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

	it('moves and clears the root range transactionally', () => {
		const { page, resolve, store } = setup();
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 2,
					values: ['row-2', 'cold', 'two', 'row-3', 'cold', 'three'],
				},
			]),
		);
		const move = encodeLynxDeltaMessage([
			{ op: 'move', instance: 2, parent: { instance: 1, slot: 0 }, before: null },
		]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...move, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(page.children.map((node) => node.id)).toEqual(['row-2', 'row-3']);

		applyLynxCompiledProgramFrame(store, page, resolve, move);
		expect(page.children.map((node) => node.id)).toEqual(['row-3', 'row-2']);
		const clear = encodeLynxDeltaMessage([{ op: 'clear', parent: { instance: 1, slot: 0 } }]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...clear, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(page.children.map((node) => node.id)).toEqual(['row-3', 'row-2']);
		expect(store.size()).toBe(2);
		applyLynxCompiledProgramFrame(store, page, resolve, clear);
		expect(page.children).toEqual([]);
		expect(store.size()).toBe(0);
	});

	it('routes nested RUN, MOVE, CLEAR, and disposal through compiler range slots', () => {
		const base = emittedHost();
		const removed: string[] = [];
		const papi: typeof base = {
			...base,
			remove(parent, child) {
				removed.push(child.id ?? '');
				base.remove(parent, child);
			},
		};
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page));
		const shell = emittedStructuralPlan();
		const row = emittedPlan();
		const shellAddress = { module: 'tests/Shell.lynx.tsrx', index: 0 };
		const rowAddress = { module: 'tests/Row.lynx.tsrx', index: 0 };
		const resolve = (module: string, index: number) => {
			if (module === shellAddress.module && index === shellAddress.index) return shell;
			if (module === rowAddress.module && index === rowAddress.index) return row;
			return undefined;
		};
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage(
				[
					{
						op: 'run',
						templateId: 1,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 1,
						values: [],
					},
					{
						op: 'run',
						templateId: 2,
						parent: { instance: 2, slot: 7 },
						before: null,
						firstInstance: 3,
						count: 2,
						values: ['row-3', 'cold', 'three', 'row-4', 'cold', 'four'],
					},
				],
				[
					{ id: 1, address: shellAddress },
					{ id: 2, address: rowAddress },
				],
			),
		);
		const rows = page.children[0]!.children[0]!;
		expect(rows.children.map((node) => node.id)).toEqual(['row-3', 'row-4']);
		expect(store.size()).toBe(3);
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([{ op: 'set', instance: 4, slot: 2, value: 'updated four' }]),
		);
		expect(rows.children[1]!.children[0]!.children[0]!.text).toBe('updated four');

		expect(() =>
			applyLynxCompiledProgramFrame(
				store,
				page,
				resolve,
				encodeLynxDeltaMessage([{ op: 'remove', firstInstance: 2, count: 1 }]),
			),
		).toThrow(/range slot 7 owns children/);
		expect(page.children[0]!.id).toBe('shell');

		const move = encodeLynxDeltaMessage([
			{
				op: 'move',
				instance: 3,
				parent: { instance: 2, slot: 7 },
				before: null,
			},
		]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...move, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(rows.children.map((node) => node.id)).toEqual(['row-3', 'row-4']);
		applyLynxCompiledProgramFrame(store, page, resolve, move);
		expect(rows.children.map((node) => node.id)).toEqual(['row-4', 'row-3']);

		expect(() =>
			applyLynxCompiledProgramFrame(
				store,
				page,
				resolve,
				encodeLynxDeltaMessage([
					{ op: 'move', instance: 3, parent: { instance: 1, slot: 0 }, before: null },
				]),
			),
		).toThrow(/outside the instance range/);
		expect(rows.children.map((node) => node.id)).toEqual(['row-4', 'row-3']);

		const clear = encodeLynxDeltaMessage([{ op: 'clear', parent: { instance: 2, slot: 7 } }]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...clear, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(rows.children.map((node) => node.id)).toEqual(['row-4', 'row-3']);
		applyLynxCompiledProgramFrame(store, page, resolve, clear);
		expect(rows.children).toEqual([]);
		expect(store.size()).toBe(1);
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 2,
					parent: { instance: 2, slot: 7 },
					before: null,
					firstInstance: 5,
					count: 1,
					values: ['row-5', 'warm', 'five'],
				},
			]),
		);
		expect(rows.children.map((node) => node.id)).toEqual(['row-5']);
		removed.length = 0;
		store.dispose();
		expect(removed).toEqual(['row-5', 'shell']);
		expect(page.children).toEqual([]);
	});

	it('hides and restores an eventful instance with the original compact token', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 73);
		const plan = emittedEventPlan();
		store.begin();
		store.define(1, plan);
		store.commit();
		const resolve = () => undefined;
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'two'],
				},
			]),
		);
		const root = page.children[0]!;
		const token = root.events.get('bindEvent:tap');
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([{ op: 'vis', instance: 2, state: 'hidden' }]),
		);
		expect(root.attributes.hidden).toBe(true);
		expect(root.events.has('bindEvent:tap')).toBe(false);

		const visible = encodeLynxDeltaMessage([{ op: 'vis', instance: 2, state: 'visible' }]);
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, [...visible, 99, 0])).toThrow(
			/opcode 99/,
		);
		expect(root.attributes.hidden).toBe(true);
		expect(root.events.has('bindEvent:tap')).toBe(false);
		applyLynxCompiledProgramFrame(store, page, resolve, visible);
		expect(root.attributes.hidden).toBe(false);
		expect(root.events.get('bindEvent:tap')).toBe(token);
	});

	it.each([
		['CLEAR', [LYNX_DELTA_PROTOCOL_VERSION, 4, 2, 2, 0], /instance 2/],
		['MOVE parent', [LYNX_DELTA_PROTOCOL_VERSION, 5, 5, 2, 2, 0, 0, 0], /instance 2/],
		['MOVE anchor', [LYNX_DELTA_PROTOCOL_VERSION, 5, 5, 2, 1, 0, 0, 1], /root/],
	] as const)('rejects unresolved non-root %s addresses', (_, frame, error) => {
		const { page, resolve, store } = setup();
		expect(() => applyLynxCompiledProgramFrame(store, page, resolve, frame)).toThrow(error);
		expect(store.size()).toBe(0);
		expect(page.children).toEqual([]);
	});

	it('rejects an invalid VIS state without changing the instance', () => {
		const { page, resolve, store } = setup();
		applyLynxCompiledProgramFrame(
			store,
			page,
			resolve,
			encodeLynxDeltaMessage([
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: ['row-2', 'cold', 'two'],
				},
			]),
		);
		expect(() =>
			applyLynxCompiledProgramFrame(store, page, resolve, [
				LYNX_DELTA_PROTOCOL_VERSION,
				6,
				2,
				2,
				2,
			]),
		).toThrow(/hidden or visible/);
		expect(page.children[0]!.attributes.hidden).toBeUndefined();
	});

	it('rejects a root sentinel as a live RUN instance', () => {
		const { page, resolve, store } = setup();
		expect(() =>
			applyLynxCompiledProgramFrame(store, page, resolve, [
				LYNX_DELTA_PROTOCOL_VERSION,
				1,
				10,
				1,
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
