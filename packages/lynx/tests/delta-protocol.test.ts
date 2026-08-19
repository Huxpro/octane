import { describe, expect, it } from 'vitest';
import {
	LYNX_DELTA_PROTOCOL_VERSION,
	decodeLynxDeltaMessage,
	encodeLynxDeltaMessage,
	type LynxDeltaOperation,
} from '../src/core/delta-protocol.js';

function roundTrip(operations: readonly LynxDeltaOperation[]): readonly LynxDeltaOperation[] {
	const encoded = encodeLynxDeltaMessage(operations);
	expect(encoded[0]).toBe(LYNX_DELTA_PROTOCOL_VERSION);
	const decoded = decodeLynxDeltaMessage(encoded);
	expect(decoded.version).toBe(LYNX_DELTA_PROTOCOL_VERSION);
	return decoded.operations;
}

// The worked examples below are the closure analysis on #61. Each one is a
// structure the previous opcode set could not express, which is why they are
// the contract rather than illustrations.
describe('@octanejs/lynx delta protocol', () => {
	// A template instance's slot index is per-template, so in a 10,000-row list
	// one slot index names 10,000 distinct anchors. An address that is not
	// instance-qualified cannot say which one it means.
	describe('addresses are instance-qualified', () => {
		it('distinguishes the same slot on different instances', () => {
			const rowTemplate = 1;
			const openArm = 2;
			const branchSlot = 3;
			const operations: readonly LynxDeltaOperation[] = [
				{
					op: 'run',
					templateId: openArm,
					parent: { instance: 3, slot: branchSlot },
					before: null,
					firstInstance: 8,
					count: 1,
					values: ['detail of the second row'],
				},
				{
					op: 'run',
					templateId: openArm,
					parent: { instance: 4, slot: branchSlot },
					before: null,
					firstInstance: 9,
					count: 1,
					values: ['detail of the third row'],
				},
			];
			const decoded = roundTrip(operations);
			expect(decoded).toEqual(operations);
			// Same slot, different instance: the two branch sites must not collapse.
			const [first, second] = decoded as [
				Extract<LynxDeltaOperation, { op: 'run' }>,
				Extract<LynxDeltaOperation, { op: 'run' }>,
			];
			expect(first.parent.slot).toBe(second.parent.slot);
			expect(first.parent.instance).not.toBe(second.parent.instance);
			void rowTemplate;
		});

		it('carries the full RUN framing: parent site, anchor, and first handle', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 5 },
					before: null,
					firstInstance: 2,
					count: 3,
					values: ['row', 'alpha', 'row', 'beta', 'row', 'gamma'],
				},
			];
			expect(roundTrip(operations)).toEqual(operations);
		});
	});

	// Anchors name identities, so they are position-invariant across the whole
	// message and the pre-move/post-move question does not arise.
	describe('keyed reorder as LIS moves', () => {
		it('round-trips the [a,b,c,d,e] to [c,a,e,b,d] walk', () => {
			const rows = { instance: 100, slot: 0 };
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'move', instance: 3, parent: rows, before: { instance: 1, slot: 0 } },
				{ op: 'move', instance: 5, parent: rows, before: { instance: 2, slot: 0 } },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});

		it('encodes an append as the END anchor rather than a node reference', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'move', instance: 7, parent: { instance: 1, slot: 2 }, before: null },
			];
			const decoded = roundTrip(operations);
			expect(decoded).toEqual(operations);
			expect((decoded[0] as Extract<LynxDeltaOperation, { op: 'move' }>).before).toBeNull();
		});

		it('lets MOVE retarget to a different parent, as portals require', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'move', instance: 9, parent: { instance: 42, slot: 1 }, before: null },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});
	});

	// Retained Suspense keeps the committed arm and the pending arm live at the
	// same time, which a single-arm branch opcode cannot represent.
	describe('retained @try keeps two arms live at once', () => {
		it('mounts the pending arm alongside the retained body and hides the body', () => {
			const boundary = { instance: 1, slot: 4 };
			const operations: readonly LynxDeltaOperation[] = [
				{
					op: 'run',
					templateId: 9,
					parent: boundary,
					before: null,
					firstInstance: 4,
					count: 1,
					values: [],
				},
				{ op: 'vis', instance: 2, state: 'hidden' },
				{ op: 'vis', instance: 3, state: 'hidden' },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});

		it('resumes the retained instances by handle when the thenable resolves', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'set', instance: 2, slot: 2, value: 'alpha (loaded)' },
				{ op: 'set', instance: 3, slot: 2, value: 'beta (loaded)' },
				{ op: 'remove', firstInstance: 4, count: 1 },
				{ op: 'vis', instance: 2, state: 'visible' },
				{ op: 'vis', instance: 3, state: 'visible' },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});

		it('expresses an arm swap as REMOVE plus RUN into the same site', () => {
			const site = { instance: 3, slot: 3 };
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'remove', firstInstance: 6, count: 1 },
				{
					op: 'run',
					templateId: 2,
					parent: site,
					before: null,
					firstInstance: 8,
					count: 1,
					values: ['the other arm'],
				},
			];
			expect(roundTrip(operations)).toEqual(operations);
		});
	});

	describe('range clearing', () => {
		it('clears an exclusive range site in one operation', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'clear', parent: { instance: 1, slot: 6 } },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});

		it('removes a contiguous handle run in one operation', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'remove', firstInstance: 12, count: 3 },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});
	});

	// Header-only validation is only sound once every value is a scalar: a
	// structured value would have to be walked to be checked, which is the
	// recursive cost the specialized path exists to delete.
	describe('values are scalars so the frame can be checked by header alone', () => {
		it('carries every scalar type a slot can hold', () => {
			const operations: readonly LynxDeltaOperation[] = [
				{ op: 'set', instance: 1, slot: 0, value: 'text' },
				{ op: 'set', instance: 1, slot: 1, value: 42 },
				{ op: 'set', instance: 1, slot: 2, value: true },
				{ op: 'set', instance: 1, slot: 3, value: null },
			];
			expect(roundTrip(operations)).toEqual(operations);
		});

		it.each([
			['an object', {}],
			['an array', []],
			['a function', () => {}],
			['undefined', undefined],
		] as const)('refuses to encode %s as a slot value', (_label, value) => {
			expect(() =>
				encodeLynxDeltaMessage([{ op: 'set', instance: 1, slot: 0, value: value as never }]),
			).toThrow(/delta protocol/i);
		});

		it('rejects a structured value on the wire without walking it', () => {
			const hostile = {
				get nested(): never {
					throw new Error('a rejected value must not be walked');
				},
			};
			// One typeof decides it. If the decoder walked the value to validate
			// it, the getter would throw its own error instead.
			expect(() =>
				decodeLynxDeltaMessage([LYNX_DELTA_PROTOCOL_VERSION, 2, 3, 1, 0, hostile]),
			).toThrow(/delta protocol/i);
		});
	});

	describe('rejects malformed frames', () => {
		it.each([
			['a non-array envelope', null],
			['a missing version', []],
			['a superseded version', [1]],
			['an unsupported future version', [LYNX_DELTA_PROTOCOL_VERSION + 1]],
			['a non-numeric opcode', [LYNX_DELTA_PROTOCOL_VERSION, 'run', 0]],
			['an opcode outside the protocol range', [LYNX_DELTA_PROTOCOL_VERSION, 99, 0]],
			['a missing frame arity', [LYNX_DELTA_PROTOCOL_VERSION, 1]],
			['a negative frame arity', [LYNX_DELTA_PROTOCOL_VERSION, 1, -1]],
			['a frame extending past the message', [LYNX_DELTA_PROTOCOL_VERSION, 1, 40, 0]],
			['a SET frame with the wrong arity', [LYNX_DELTA_PROTOCOL_VERSION, 2, 2, 1, 0]],
			['a RUN with zero instances', [LYNX_DELTA_PROTOCOL_VERSION, 1, 7, 1, 1, 0, 0, 0, 2, 0]],
			[
				'a RUN whose value count contradicts its arity',
				[LYNX_DELTA_PROTOCOL_VERSION, 1, 8, 1, 1, 0, 0, 0, 2, 1, 'a', 'b'],
			],
			['a VIS with an unknown state', [LYNX_DELTA_PROTOCOL_VERSION, 6, 2, 1, 7]],
			[
				'an instance handle of zero outside an anchor',
				[LYNX_DELTA_PROTOCOL_VERSION, 2, 3, 0, 0, 'v'],
			],
		] as const)('rejects %s', (_label, input) => {
			expect(() => decodeLynxDeltaMessage(input)).toThrow(/delta protocol/i);
		});

		it('rejects invalid typed headers before they reach the wire', () => {
			expect(() =>
				encodeLynxDeltaMessage([
					{
						op: 'run',
						templateId: 1,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 0,
						values: [],
					},
				]),
			).toThrow(/delta protocol/i);
			expect(() =>
				encodeLynxDeltaMessage([
					{ op: 'move', instance: 0, parent: { instance: 1, slot: 0 }, before: null },
				]),
			).toThrow(/delta protocol/i);
			expect(() => encodeLynxDeltaMessage([{ op: 'remove', firstInstance: 1, count: 0 }])).toThrow(
				/delta protocol/i,
			);
		});
	});
});
