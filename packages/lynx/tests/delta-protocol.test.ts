import { describe, expect, it } from 'vitest';
import {
	LYNX_DELTA_PROTOCOL_VERSION,
	decodeLynxDeltaMessage,
	encodeLynxDeltaMessage,
	type LynxDeltaOperation,
} from '../src/core/delta-protocol.js';

describe('@octanejs/lynx delta protocol', () => {
	it('round-trips every operation and both removal address forms', () => {
		const operations: readonly LynxDeltaOperation[] = [
			{
				op: 'run',
				templateId: 4,
				anchorSlot: 7,
				count: 2,
				values: ['row-1', 1, 'row-2', 2],
			},
			{ op: 'set', instance: 11, slotIndex: 2, value: 'selected' },
			{ op: 'remove', target: { kind: 'instance', instance: 12 } },
			{
				op: 'remove',
				target: { kind: 'range', anchorSlot: 8, members: [13, 14, 15] },
			},
			{ op: 'move', instance: 15, before: 11 },
			{ op: 'move', instance: 11, before: null },
			{ op: 'branch', slot: 9, templateId: 5, values: ['pending'] },
			{ op: 'branch', slot: 9, templateId: null, values: [] },
		];

		const encoded = encodeLynxDeltaMessage(operations);

		expect(encoded[0]).toBe(LYNX_DELTA_PROTOCOL_VERSION);
		expect(decodeLynxDeltaMessage(encoded)).toEqual({
			version: LYNX_DELTA_PROTOCOL_VERSION,
			operations,
		});
	});

	it('treats slot values as opaque instead of recursively validating them', () => {
		const opaque = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(opaque, 'nested', {
			enumerable: true,
			get() {
				throw new Error('slot values must not be walked');
			},
		});

		const decoded = decodeLynxDeltaMessage(
			encodeLynxDeltaMessage([
				{ op: 'set', instance: 1, slotIndex: 0, value: opaque },
				{ op: 'run', templateId: 2, anchorSlot: 3, count: 1, values: [opaque] },
			]),
		);

		const set = decoded.operations[0];
		const run = decoded.operations[1];
		expect(set?.op).toBe('set');
		expect(set?.op === 'set' ? set.value : null).toBe(opaque);
		expect(run?.op).toBe('run');
		expect(run?.op === 'run' ? run.values[0] : null).toBe(opaque);
	});

	it.each([
		['a non-array envelope', null],
		['a missing version', []],
		['an unsupported version', [LYNX_DELTA_PROTOCOL_VERSION + 1]],
		['a non-numeric opcode', [LYNX_DELTA_PROTOCOL_VERSION, 'run', 0]],
		['an opcode outside the protocol range', [LYNX_DELTA_PROTOCOL_VERSION, 99, 0]],
		['a missing frame arity', [LYNX_DELTA_PROTOCOL_VERSION, 1]],
		['a negative frame arity', [LYNX_DELTA_PROTOCOL_VERSION, 1, -1]],
		['a frame extending past the message', [LYNX_DELTA_PROTOCOL_VERSION, 1, 4, 0]],
		['a SET frame with the wrong arity', [LYNX_DELTA_PROTOCOL_VERSION, 2, 2, 1, 0]],
		['a malformed range member count', [LYNX_DELTA_PROTOCOL_VERSION, 3, 4, 1, 0, 2, 1]],
		['a malformed branch value count', [LYNX_DELTA_PROTOCOL_VERSION, 5, 3, 0, null, 1]],
		['a RUN with zero instances', [LYNX_DELTA_PROTOCOL_VERSION, 1, 3, 0, 0, 0]],
	] as const)('rejects %s', (_label, input) => {
		expect(() => decodeLynxDeltaMessage(input)).toThrow(/delta protocol/i);
	});

	it('rejects invalid typed headers before they enter the wire stream', () => {
		expect(() =>
			encodeLynxDeltaMessage([{ op: 'run', templateId: 1, anchorSlot: 0, count: 0, values: [] }]),
		).toThrow(/delta protocol/i);
		expect(() => encodeLynxDeltaMessage([{ op: 'move', instance: 1, before: -1 }])).toThrow(
			/delta protocol/i,
		);
	});
});
