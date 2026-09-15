import type { UniversalHostTemplateProgram } from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import {
	createLynxBlockDeltaProducer,
	preparedLynxBlockDeltaBatch,
} from '../src/core/block-delta-producer.js';
import { decodeLynxDeltaMessage } from '../src/core/delta-protocol.js';

const ADDRESS = Object.freeze({ module: 'tests/DirectDeltaRow.lynx.tsrx', index: 0 });

const PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'view',
			parent: -1,
			props: Object.freeze({ role: 'row' }),
			bindings: Object.freeze([
				Object.freeze({ name: 'class', valueIndex: 0 }),
				Object.freeze({ name: 'id', valueIndex: 1 }),
				Object.freeze({ name: 'data-state', valueIndex: 2 }),
			]),
		}),
	]),
	events: Object.freeze([]),
});

function frameOf(
	batch: NonNullable<ReturnType<ReturnType<typeof createLynxBlockDeltaProducer>['flush']>>,
) {
	const frame = preparedLynxBlockDeltaBatch(batch);
	expect(frame).not.toBeNull();
	return frame!;
}

describe('Lynx Block direct delta producer', () => {
	it('emits one dirty slot without rebuilding the owning host props', () => {
		const producer = createLynxBlockDeltaProducer();
		const core = createLynxBlockCore({
			templateRuns: () => true,
			deltaProducer: producer,
		});
		const template = compileLynxBlockTemplate(PROGRAM, ADDRESS);

		core.beginAttempt();
		const block = core.mount(null, null, template, ['row', 'row-1', 'cold']);
		const mounted = frameOf(core.flush()!);
		expect(mounted.operations).toEqual([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: ['row', 'row-1', 'cold'],
			},
		]);
		core.acceptAttempt();

		core.resetCounters();
		core.beginAttempt();
		expect(core.setSlotValue(block, 1, 'row-2')).toBe(true);
		expect(core.setSlotValue(block, 1, 'row-final')).toBe(true);
		const updatedBatch = core.flush()!;
		const updated = frameOf(updatedBatch);
		expect(updatedBatch.commands).toEqual([]);
		expect(updated.templates).toEqual([]);
		expect(updated.operations).toEqual([{ op: 'set', instance: 2, slot: 1, value: 'row-final' }]);
		expect(decodeLynxDeltaMessage(updated.encoded).operations).toEqual(updated.operations);
		expect(core.counters()).toEqual({ blockLookups: 2, commands: 1 });
		core.acceptAttempt();
	});

	it('keeps create/set, set/move, set/remove, clear, and visibility ordering explicit', () => {
		const producer = createLynxBlockDeltaProducer();
		producer.beginAttempt();
		const first = producer.run({
			address: ADDRESS,
			parent: { instance: 1, slot: 0 },
			before: null,
			count: 2,
			values: ['row', 'a', 'cold', 'row', 'b', 'cold'],
		});
		expect(first).toBe(2);
		expect(producer.set(2, 2, 'warming')).toBe(true);
		expect(producer.set(2, 2, 'hot')).toBe(false);
		producer.move(2, { instance: 1, slot: 0 }, { instance: 3, slot: 0 });
		expect(producer.set(3, 1, 'gone')).toBe(true);
		producer.remove(3, 1);
		producer.visibility(2, false);
		producer.visibility(2, true);
		producer.clear({ instance: 9, slot: 4 });

		const frame = frameOf(producer.flush(1)!);
		expect(frame.templates).toEqual([{ id: 1, address: ADDRESS }]);
		expect(frame.operations).toEqual([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 2,
				values: ['row', 'a', 'cold', 'row', 'b', 'cold'],
			},
			{ op: 'set', instance: 2, slot: 2, value: 'hot' },
			{
				op: 'move',
				instance: 2,
				parent: { instance: 1, slot: 0 },
				before: { instance: 3, slot: 0 },
			},
			{ op: 'set', instance: 3, slot: 1, value: 'gone' },
			{ op: 'remove', firstInstance: 3, count: 1 },
			{ op: 'vis', instance: 2, state: 'visible' },
			{ op: 'clear', parent: { instance: 9, slot: 4 } },
		]);
		expect(decodeLynxDeltaMessage(frame.encoded)).toMatchObject({
			templates: frame.templates,
			operations: frame.operations,
		});
		producer.acceptAttempt();
	});

	it('preserves a retained static-node anchor for RUN and MOVE', () => {
		const producer = createLynxBlockDeltaProducer();
		producer.beginAttempt();
		producer.run({
			address: ADDRESS,
			parent: { instance: 2, slot: 7 },
			before: { instance: 2, slot: 8 },
			count: 1,
			values: ['row', 'a', 'cold'],
		});
		producer.move(2, { instance: 2, slot: 7 }, { instance: 2, slot: 8 });
		const frame = frameOf(producer.flush(1)!);
		expect(frame.operations).toEqual([
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 2, slot: 7 },
				before: { instance: 2, slot: 8 },
				firstInstance: 2,
				count: 1,
				values: ['row', 'a', 'cold'],
			},
			{
				op: 'move',
				instance: 2,
				parent: { instance: 2, slot: 7 },
				before: { instance: 2, slot: 8 },
			},
		]);
		expect(decodeLynxDeltaMessage(frame.encoded).operations).toEqual(frame.operations);
		producer.acceptAttempt();
	});

	it('rewinds template and instance allocation when an attempt aborts after flush', () => {
		const producer = createLynxBlockDeltaProducer();
		producer.beginAttempt();
		expect(
			producer.run({
				address: ADDRESS,
				parent: { instance: 1, slot: 0 },
				before: null,
				count: 2,
				values: [],
			}),
		).toBe(2);
		const rejected = frameOf(producer.flush(1)!);
		expect(producer.abortAttempt()).toBe(true);

		producer.beginAttempt();
		expect(
			producer.run({
				address: ADDRESS,
				parent: { instance: 1, slot: 0 },
				before: null,
				count: 1,
				values: [],
			}),
		).toBe(2);
		const retry = frameOf(producer.flush(1)!);
		expect(retry.templates).toEqual([{ id: 1, address: ADDRESS }]);
		expect(retry.operations[0]).toMatchObject({ firstInstance: 2, count: 1 });
		// Prepared batches are immutable retry artefacts even after logical rollback.
		expect(rejected.operations[0]).toMatchObject({ firstInstance: 2, count: 2 });
		producer.acceptAttempt();
	});

	it('refuses structured values before they reach the compact encoder', () => {
		const producer = createLynxBlockDeltaProducer();
		expect(() => producer.set(2, 0, {})).toThrow(/finite scalar/);
	});
});
