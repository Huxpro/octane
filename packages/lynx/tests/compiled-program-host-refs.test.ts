import type {
	UniversalHostProgramAddress,
	UniversalHostTemplateProgram,
	UniversalProgramPlan,
} from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import {
	activateLynxCompactPublicHandle,
	applyLynxHostAttachments,
	createLynxClientContainer,
	invalidateLynxClientContainer,
	releaseLynxCompactPublicHandle,
} from '../src/core/client-driver.compiled-program.js';
import {
	createLynxBlockDeltaProducer,
	preparedLynxBlockDeltaBatch,
} from '../src/core/block-delta-producer.js';
import { applyLynxCompiledProgramFrame } from '../src/core/compiled-program-frame.js';
import { createLynxCompiledProgramStore } from '../src/core/compiled-program-store.js';
import {
	decodeLynxDeltaMessage,
	encodeLynxDeltaMessage,
	LYNX_DELTA_PROTOCOL_VERSION,
} from '../src/core/delta-protocol.js';
import {
	decodeLynxCompiledProgramMainMessage,
	encodeLynxCompiledProgramMainMessage,
} from '../src/core/compiled-program-wire.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
} from '../src/core/transport-identity.js';
import { createFakePAPI, type FakeNode } from './_fixtures/fake-element-papi.js';

const ADDRESS: UniversalHostProgramAddress = Object.freeze({
	module: 'tests/HostRefRow.lynx.tsrx',
	index: 0,
});

const REF_ROW: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({ type: 'view', parent: -1, props: Object.freeze({}) }),
		Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
	]),
	events: Object.freeze([]),
});

const LIST_SHELL: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({ type: 'view', parent: -1, props: Object.freeze({}) }),
		Object.freeze({ type: 'list', parent: 0, props: Object.freeze({ 'list-type': 'single' }) }),
	]),
	events: Object.freeze([]),
});

const LIST_ROW: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'list-item',
			parent: -1,
			props: Object.freeze({ 'reuse-identifier': 'host-ref-row' }),
			bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
		}),
		Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
		Object.freeze({
			type: '#text',
			parent: 1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
	]),
	events: Object.freeze([]),
});

function emittedHost(list = false): LynxElementPAPI<FakeNode> & {
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

function plan(
	program: UniversalHostTemplateProgram,
	options: {
		readonly slots?: UniversalProgramPlan['slots'];
		readonly values?: UniversalProgramPlan['values'];
		readonly refs?: readonly number[];
	} = {},
): UniversalProgramPlan {
	const emission = emitLynxMainThreadProgram(program, {
		name: 'createHostRefProgram',
		slotUpdates: true,
		structuralRuns: true,
	});
	const bind = new Function('return (' + emission.source + ');')() as UniversalProgramPlan['bind'];
	return Object.freeze({
		kind: 'program',
		slots: options.slots ?? Object.freeze([]),
		nodes: program.nodes.length,
		values: options.values ?? Object.freeze([]),
		events: Object.freeze([]),
		ranges: Object.freeze([]),
		refs: options.refs,
		bind,
		wire: program,
	});
}

describe('@octanejs/lynx compact compiled-program host refs', () => {
	it('round-trips REF-RUN and preserves the exact ref-free frame', () => {
		const refFree = encodeLynxDeltaMessage([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: [],
			},
		]);
		expect(refFree).toEqual([LYNX_DELTA_PROTOCOL_VERSION, 1, 7, 1, 1, 0, 0, 0, 2, 1]);

		const withRefs = encodeLynxDeltaMessage([
			{ op: 'ref-run', firstInstance: 2, firstId: 40, stride: 2 },
		]);
		expect(withRefs).toEqual([LYNX_DELTA_PROTOCOL_VERSION, 8, 3, 2, 40, 2]);
		expect(decodeLynxDeltaMessage(withRefs).operations).toEqual([
			{ op: 'ref-run', firstInstance: 2, firstId: 40, stride: 2 },
		]);
		expect(() => decodeLynxDeltaMessage([LYNX_DELTA_PROTOCOL_VERSION, 8, 2, 2, 40])).toThrow(
			/REF-RUN/,
		);
	});

	it('places REF-RUN directly after the run and rewinds it with the attempt', () => {
		const producer = createLynxBlockDeltaProducer();
		producer.beginAttempt();
		expect(
			producer.run({
				address: ADDRESS,
				parent: { instance: 1, slot: 0 },
				before: null,
				count: 2,
				values: [],
				refs: { firstId: 40, stride: 2 },
			}),
		).toBe(2);
		const rejected = preparedLynxBlockDeltaBatch(producer.flush(1)!);
		expect(rejected!.operations.map((operation) => operation.op)).toEqual(['run', 'ref-run']);
		expect(rejected!.operations[1]).toEqual({
			op: 'ref-run',
			firstInstance: 2,
			firstId: 40,
			stride: 2,
		});
		expect(producer.abortAttempt()).toBe(true);

		producer.beginAttempt();
		expect(
			producer.run({
				address: ADDRESS,
				parent: { instance: 1, slot: 0 },
				before: null,
				count: 1,
				values: [],
				refs: { firstId: 80, stride: 2 },
			}),
		).toBe(2);
		expect(preparedLynxBlockDeltaBatch(producer.flush(1)!)!.operations[1]).toMatchObject({
			firstInstance: 2,
			firstId: 80,
		});
	});

	it('links logical ids to only the resident ref nodes and rolls malformed links back', () => {
		const papi = emittedHost();
		const page = papi.createPage('0', 0);
		const resident = plan(REF_ROW, { refs: Object.freeze([1]) });
		const store = createLynxCompiledProgramStore(papi, papi.getUniqueId(page), 47);
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 2,
					values: [],
				},
				{ op: 'ref-run', firstInstance: 2, firstId: 100, stride: 2 },
			],
			[{ id: 1, address: ADDRESS }],
		);
		applyLynxCompiledProgramFrame(store, page, () => resident, frame);
		expect(page.children.map((node) => node.selector)).toEqual(['', '']);
		expect(page.children.map((node) => node.children[0]!.selector)).toEqual([
			'r47-h101-g1',
			'r47-h103-g1',
		]);

		const before = page.children.slice();
		expect(() =>
			applyLynxCompiledProgramFrame(store, page, () => resident, [
				LYNX_DELTA_PROTOCOL_VERSION,
				8,
				3,
				2,
				200,
				3,
			]),
		).toThrow(/REF-RUN/);
		expect(page.children).toEqual(before);

		const overlap = encodeLynxDeltaMessage([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 4,
				count: 1,
				values: [],
			},
			{ op: 'ref-run', firstInstance: 4, firstId: 103, stride: 2 },
		]);
		expect(() => applyLynxCompiledProgramFrame(store, page, () => resident, overlap)).toThrow(
			/logical host identity/,
		);
		expect(page.children).toEqual(before);

		const retry = encodeLynxDeltaMessage([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 4,
				count: 1,
				values: [],
			},
			{ op: 'ref-run', firstInstance: 4, firstId: 200, stride: 2 },
		]);
		applyLynxCompiledProgramFrame(store, page, () => resident, retry);
		expect(page.children.at(-1)!.children[0]!.selector).toBe('r47-h201-g1');
	});

	it('tracks native-list attach, detach, and recycled logical identity', () => {
		const papi = emittedHost(true);
		const page = papi.createPage('0', 0);
		const attachments: unknown[] = [];
		const store = createLynxCompiledProgramStore(
			papi,
			papi.getUniqueId(page),
			47,
			1,
			undefined,
			undefined,
			(changes) => attachments.push(...changes),
		);
		const shell = plan(LIST_SHELL);
		const row = plan(LIST_ROW, {
			slots: Object.freeze(['p:item-key', 'c']),
			values: Object.freeze([0, 1]),
			refs: Object.freeze([1]),
		});

		store.begin();
		store.mount({ firstHandle: 2, count: 1, parent: page, before: null, plan: shell, values: [] });
		const list = store.node(2, 1);
		store.mount({
			firstHandle: 3,
			count: 2,
			parent: list,
			before: null,
			plan: row,
			values: ['a', 'alpha', 'b', 'beta'],
		});
		store.refs(3, 20, 3);
		store.commit();
		expect(attachments).toEqual([]);

		const nativeList = papi.lists[0]!;
		const firstSign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 0);
		expect(nativeList.node.children[0]!.children[0]!.selector).toBe('r47-h21-g1');
		expect(attachments).toEqual([{ id: 21, generation: 1, attached: true }]);

		nativeList.enqueueComponent(nativeList.node, nativeList.node.uid, firstSign);
		expect(nativeList.node.children[0]!.children[0]!.selector).toBe('');
		expect(attachments.at(-1)).toEqual({ id: 21, generation: 1, attached: false });

		const secondSign = nativeList.componentAtIndex(nativeList.node, nativeList.node.uid, 1);
		expect(secondSign).toBe(firstSign);
		expect(nativeList.node.children[0]!.children[0]!.selector).toBe('r47-h24-g1');
		expect(attachments.at(-1)).toEqual({ id: 24, generation: 1, attached: true });
	});

	it('encodes accepted attachment batches with exact identity and boolean states', () => {
		const message = {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 9,
			version: 4,
			type: 'host-attachment' as const,
			changes: [
				{ id: 7, generation: 1, attached: false },
				{ id: 8, generation: 2, attached: true },
			],
		};
		const encoded = encodeLynxCompiledProgramMainMessage(message);
		expect(JSON.parse(encoded)).toEqual([
			LYNX_TRANSPORT_PROTOCOL_VERSION,
			18,
			9,
			4,
			7,
			1,
			0,
			8,
			2,
			1,
		]);
		expect(decodeLynxCompiledProgramMainMessage(encoded)).toEqual(message);
	});

	it('keeps compact public-handle identity stable across attachment cycles and releases it', () => {
		const container = createLynxClientContainer();
		const handle = activateLynxCompactPublicHandle(container, {
			root: 9,
			id: 7,
			type: 'view',
			attached: false,
		});
		expect(handle.active).toBe(true);
		expect(handle.attached).toBe(false);
		expect(handle.snapshot).toBe(handle.snapshot);

		expect(applyLynxHostAttachments(container, [{ id: 7, generation: 1, attached: true }])).toEqual(
			{ detached: [], attached: [7] },
		);
		expect(handle.attached).toBe(true);
		expect(container.getPublicHandle(7)).toBe(handle);

		expect(
			applyLynxHostAttachments(container, [{ id: 7, generation: 1, attached: false }]),
		).toEqual({ detached: [7], attached: [] });
		expect(handle.attached).toBe(false);
		releaseLynxCompactPublicHandle(container, 7);
		expect(handle.active).toBe(false);
		expect(container.getPublicHandle(7)).toBeNull();

		const second = activateLynxCompactPublicHandle(container, {
			root: 9,
			id: 8,
			type: 'text',
			attached: true,
		});
		invalidateLynxClientContainer(container);
		expect(second.active).toBe(false);
		expect(second.attached).toBe(false);
	});
});
