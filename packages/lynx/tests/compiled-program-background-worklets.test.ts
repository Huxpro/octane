import { afterEach, describe, expect, it } from 'vitest';

import type { LynxPreparedBlockDeltaBatch } from '../src/core/block-delta-producer.js';
import {
	createLynxCompiledProgramBackgroundWorklets,
	lynxCompiledProgramFrameRequiresBackgroundWorklets,
} from '../src/core/compiled-program-background-worklets.js';
import {
	decodeLynxDeltaMessage,
	encodeLynxDeltaMessage,
	type LynxDeltaOperation,
} from '../src/core/delta-protocol.js';
import {
	createLynxBackgroundFunctionRegistry,
	registerBackgroundFunction,
	unregisterBackgroundFunction,
} from '../src/core/worklets.js';

const BACKGROUND = 'compact-background:test';
const echoBackground = (value: unknown): unknown => value;

function frame(
	operations: readonly LynxDeltaOperation[],
	retiredInstances: readonly number[] = [],
): LynxPreparedBlockDeltaBatch {
	return Object.freeze({
		source: 'block',
		templates: Object.freeze([]),
		operations: Object.freeze(operations),
		retiredInstances: Object.freeze(retiredInstances),
		encoded: encodeLynxDeltaMessage(operations),
	});
}

function descriptor(label: string) {
	return {
		_wkltId: 'compact-main:' + label,
		_c: { background: registerBackgroundFunction(BACKGROUND, echoBackground) },
	} as never;
}

afterEach(() => unregisterBackgroundFunction(BACKGROUND));

describe('@octanejs/lynx compact background worklet ownership', () => {
	it('does not select or allocate ownership for ordinary scalar/ref-only frames', () => {
		expect(
			lynxCompiledProgramFrameRequiresBackgroundWorklets(
				frame([
					{
						op: 'run',
						templateId: 1,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 1,
						values: ['ordinary', { _wvid: 'ref-only' }],
					},
				]),
			),
		).toBe(false);
	});

	it('retains per-instance executions and settles update rejection and removal atomically', () => {
		const registry = createLynxBackgroundFunctionRegistry();
		const worklets = createLynxCompiledProgramBackgroundWorklets(registry);
		const mounted = worklets.prepare(
			frame([
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 2,
					values: [descriptor('a'), descriptor('b')],
				},
			]),
		);
		const mountedOperation = decodeLynxDeltaMessage(mounted.encoded).operations[0];
		expect(mountedOperation).toMatchObject({
			op: 'run',
			values: [
				{ _c: { background: { _execId: expect.any(String) } } },
				{ _c: { background: { _execId: expect.any(String) } } },
			],
		});
		mounted.accept();
		const initial = worklets.activeExecutions();
		expect(initial).toHaveLength(2);
		expect(new Set(initial).size).toBe(2);

		const rejected = worklets.prepare(
			frame([{ op: 'set', instance: 2, slot: 0, value: descriptor('rejected') }]),
		);
		rejected.reject();
		expect(worklets.activeExecutions()).toEqual(initial);

		const updated = worklets.prepare(
			frame([{ op: 'set', instance: 2, slot: 0, value: descriptor('accepted') }]),
		);
		updated.accept();
		const afterUpdate = worklets.activeExecutions();
		expect(afterUpdate).toHaveLength(2);
		expect(afterUpdate).not.toContain(initial[0]);
		expect(registry.isActive(initial[0]!)).toBe(false);

		const removed = worklets.prepare(frame([{ op: 'remove', firstInstance: 2, count: 2 }]));
		removed.accept();
		expect(worklets.activeExecutions()).toEqual([]);
		for (const execution of afterUpdate) expect(registry.isActive(execution)).toBe(false);
		worklets.close();
	});

	it('uses exact CLEAR retirement metadata without retaining range topology', () => {
		const registry = createLynxBackgroundFunctionRegistry();
		const worklets = createLynxCompiledProgramBackgroundWorklets(registry);
		worklets
			.prepare(
				frame([
					{
						op: 'run',
						templateId: 1,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 3,
						values: [descriptor('a'), descriptor('b'), descriptor('c')],
					},
				]),
			)
			.accept();
		const initial = worklets.activeExecutions();
		expect(initial).toHaveLength(3);

		worklets.prepare(frame([{ op: 'clear', parent: { instance: 1, slot: 0 } }], [2, 4])).accept();
		expect(worklets.activeExecutions()).toEqual([initial[1]]);
		expect(registry.isActive(initial[0]!)).toBe(false);
		expect(registry.isActive(initial[2]!)).toBe(false);
		worklets.close();
	});
});
