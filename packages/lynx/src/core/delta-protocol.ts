/**
 * Versioned header for the Lynx slot-delta wire format.
 *
 * Version 2 replaces the draft opcode set after the closure analysis on #61
 * refuted it. Three changes are load-bearing rather than cosmetic:
 *
 * - Every address is instance-qualified. A slot index is a per-template
 *   property, so a bare slot names one anchor per instance — in a 10,000-row
 *   list, 10,000 of them.
 * - `BRANCH` is gone. Retained Suspense keeps the committed arm and the pending
 *   arm live simultaneously, which a single-arm opcode cannot express, and every
 *   arm swap is already `REMOVE` + `RUN` into the same range site.
 * - `VIS` is added. Activity and retained Suspense are visibility transitions
 *   over instances whose identity does not change, and the draft had no way to
 *   say so.
 *
 * Values are scalars. That restriction is what makes header-only validation
 * sound: a structured value would have to be walked to be checked, which is the
 * recursive cost this format exists to delete.
 */
export const LYNX_DELTA_PROTOCOL_VERSION = 2 as const;

const enum LynxDeltaOpcode {
	Run = 1,
	Set = 2,
	Remove = 3,
	Clear = 4,
	Move = 5,
	Vis = 6,
}

const enum LynxVisibilityState {
	Hidden = 0,
	Visible = 1,
}

/** Instance handle 0 is the `END` sentinel and never denotes a live instance. */
const END_INSTANCE = 0;
const MAX_INSTANCE = 2 ** 31 - 1;
const RUN_HEADER_FIELDS = 7;

/** A slot on a specific template instance. Slot indices are compiler-assigned. */
export interface LynxSlotAddress {
	readonly instance: number;
	readonly slot: number;
}

/** `null` appends into the range site's parent node rather than before a node. */
export type LynxDeltaAnchor = LynxSlotAddress | null;

/** Slot values are scalars so a frame can be validated by its header alone. */
export type LynxDeltaValue = string | number | boolean | null;

export interface LynxRunDelta {
	readonly op: 'run';
	readonly templateId: number;
	readonly parent: LynxSlotAddress;
	readonly before: LynxDeltaAnchor;
	readonly firstInstance: number;
	readonly count: number;
	readonly values: readonly LynxDeltaValue[];
}

export interface LynxSetDelta {
	readonly op: 'set';
	readonly instance: number;
	readonly slot: number;
	readonly value: LynxDeltaValue;
}

/** Instances are allocated in dense runs, so removal takes a run at a time. */
export interface LynxRemoveDelta {
	readonly op: 'remove';
	readonly firstInstance: number;
	readonly count: number;
}

/** Valid only where the range site owns every child of its parent node. */
export interface LynxClearDelta {
	readonly op: 'clear';
	readonly parent: LynxSlotAddress;
}

export interface LynxMoveDelta {
	readonly op: 'move';
	readonly instance: number;
	readonly parent: LynxSlotAddress;
	readonly before: LynxDeltaAnchor;
}

export interface LynxVisibilityDelta {
	readonly op: 'vis';
	readonly instance: number;
	readonly state: 'hidden' | 'visible';
}

export type LynxDeltaOperation =
	| LynxRunDelta
	| LynxSetDelta
	| LynxRemoveDelta
	| LynxClearDelta
	| LynxMoveDelta
	| LynxVisibilityDelta;

export interface LynxDeltaMessage {
	readonly version: typeof LYNX_DELTA_PROTOCOL_VERSION;
	readonly operations: readonly LynxDeltaOperation[];
}

export type LynxEncodedDeltaMessage = readonly unknown[];

function fail(message: string): never {
	throw new TypeError(`Invalid Lynx delta protocol message: ${message}.`);
}

function requireIndex(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		fail(`${name} must be a non-negative integer`);
	return value as number;
}

function requirePositiveCount(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0)
		fail(`${name} must be a positive integer`);
	return value as number;
}

/** A live instance. Handle 0 is reserved for the `END` anchor sentinel. */
function requireInstance(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= END_INSTANCE)
		fail(`${name} must be a positive instance handle`);
	if ((value as number) > MAX_INSTANCE) fail(`${name} exceeds the instance handle range`);
	return value as number;
}

function requireAddress(value: LynxSlotAddress | undefined, name: string): LynxSlotAddress {
	if (value === null || typeof value !== 'object') fail(`${name} must be an instance/slot pair`);
	return {
		instance: requireInstance(value.instance, `${name} instance`),
		slot: requireIndex(value.slot, `${name} slot`),
	};
}

/**
 * The whole of the value check: one `typeof` per value, never a walk. A
 * structured value is rejected on its own type, so a hostile getter is never
 * reached.
 */
function requireValue(value: unknown, name: string): LynxDeltaValue {
	if (value === null) return null;
	const type = typeof value;
	if (type !== 'string' && type !== 'number' && type !== 'boolean')
		fail(`${name} must be a string, number, boolean, or null`);
	return value as LynxDeltaValue;
}

function encodeAnchor(anchor: LynxDeltaAnchor, name: string): readonly [number, number] {
	if (anchor === null) return [END_INSTANCE, 0];
	const address = requireAddress(anchor, name);
	return [address.instance, address.slot];
}

function decodeAnchor(instance: unknown, slot: unknown, name: string): LynxDeltaAnchor {
	const handle = requireIndex(instance, `${name} instance`);
	const index = requireIndex(slot, `${name} slot`);
	if (handle === END_INSTANCE) {
		if (index !== 0) fail(`${name} must not carry a slot with the END sentinel`);
		return null;
	}
	if (handle > MAX_INSTANCE) fail(`${name} instance exceeds the instance handle range`);
	return { instance: handle, slot: index };
}

function pushFrame(target: unknown[], opcode: LynxDeltaOpcode, payload: readonly unknown[]): void {
	target.push(opcode, payload.length, ...payload);
}

export function encodeLynxDeltaMessage(
	operations: readonly LynxDeltaOperation[],
): LynxEncodedDeltaMessage {
	const encoded: unknown[] = [LYNX_DELTA_PROTOCOL_VERSION];
	for (const operation of operations) {
		switch (operation.op) {
			case 'run': {
				const parent = requireAddress(operation.parent, 'RUN parent site');
				const before = encodeAnchor(operation.before, 'RUN anchor');
				pushFrame(encoded, LynxDeltaOpcode.Run, [
					requireIndex(operation.templateId, 'RUN template id'),
					parent.instance,
					parent.slot,
					before[0],
					before[1],
					requireInstance(operation.firstInstance, 'RUN first instance'),
					requirePositiveCount(operation.count, 'RUN count'),
					...operation.values.map((value, index) => requireValue(value, `RUN value ${index}`)),
				]);
				break;
			}
			case 'set':
				pushFrame(encoded, LynxDeltaOpcode.Set, [
					requireInstance(operation.instance, 'SET instance'),
					requireIndex(operation.slot, 'SET slot'),
					requireValue(operation.value, 'SET value'),
				]);
				break;
			case 'remove':
				pushFrame(encoded, LynxDeltaOpcode.Remove, [
					requireInstance(operation.firstInstance, 'REMOVE first instance'),
					requirePositiveCount(operation.count, 'REMOVE count'),
				]);
				break;
			case 'clear': {
				const parent = requireAddress(operation.parent, 'CLEAR range site');
				pushFrame(encoded, LynxDeltaOpcode.Clear, [parent.instance, parent.slot]);
				break;
			}
			case 'move': {
				const parent = requireAddress(operation.parent, 'MOVE parent site');
				const before = encodeAnchor(operation.before, 'MOVE anchor');
				pushFrame(encoded, LynxDeltaOpcode.Move, [
					requireInstance(operation.instance, 'MOVE instance'),
					parent.instance,
					parent.slot,
					before[0],
					before[1],
				]);
				break;
			}
			case 'vis':
				if (operation.state !== 'hidden' && operation.state !== 'visible')
					fail('VIS state must be hidden or visible');
				pushFrame(encoded, LynxDeltaOpcode.Vis, [
					requireInstance(operation.instance, 'VIS instance'),
					operation.state === 'hidden' ? LynxVisibilityState.Hidden : LynxVisibilityState.Visible,
				]);
				break;
		}
	}
	return encoded;
}

export function decodeLynxDeltaMessage(input: unknown): LynxDeltaMessage {
	if (!Array.isArray(input)) fail('the envelope must be an array');
	if (input[0] !== LYNX_DELTA_PROTOCOL_VERSION) fail('the protocol version is unsupported');

	const operations: LynxDeltaOperation[] = [];
	let cursor = 1;
	while (cursor < input.length) {
		const opcode = requirePositiveCount(input[cursor++], 'opcode');
		if (opcode > LynxDeltaOpcode.Vis) fail('opcode is outside the supported range');
		const arity = requireIndex(input[cursor++], 'frame arity');
		const end = cursor + arity;
		if (end > input.length) fail('frame arity extends past the message');

		switch (opcode) {
			case LynxDeltaOpcode.Run: {
				if (arity < RUN_HEADER_FIELDS) fail('RUN requires seven header fields');
				operations.push({
					op: 'run',
					templateId: requireIndex(input[cursor], 'RUN template id'),
					parent: {
						instance: requireInstance(input[cursor + 1], 'RUN parent site instance'),
						slot: requireIndex(input[cursor + 2], 'RUN parent site slot'),
					},
					before: decodeAnchor(input[cursor + 3], input[cursor + 4], 'RUN anchor'),
					firstInstance: requireInstance(input[cursor + 5], 'RUN first instance'),
					count: requirePositiveCount(input[cursor + 6], 'RUN count'),
					values: input
						.slice(cursor + RUN_HEADER_FIELDS, end)
						.map((value, index) => requireValue(value, `RUN value ${index}`)),
				});
				break;
			}
			case LynxDeltaOpcode.Set:
				if (arity !== 3) fail('SET requires exactly three fields');
				operations.push({
					op: 'set',
					instance: requireInstance(input[cursor], 'SET instance'),
					slot: requireIndex(input[cursor + 1], 'SET slot'),
					value: requireValue(input[cursor + 2], 'SET value'),
				});
				break;
			case LynxDeltaOpcode.Remove:
				if (arity !== 2) fail('REMOVE requires exactly two fields');
				operations.push({
					op: 'remove',
					firstInstance: requireInstance(input[cursor], 'REMOVE first instance'),
					count: requirePositiveCount(input[cursor + 1], 'REMOVE count'),
				});
				break;
			case LynxDeltaOpcode.Clear:
				if (arity !== 2) fail('CLEAR requires exactly two fields');
				operations.push({
					op: 'clear',
					parent: {
						instance: requireInstance(input[cursor], 'CLEAR range site instance'),
						slot: requireIndex(input[cursor + 1], 'CLEAR range site slot'),
					},
				});
				break;
			case LynxDeltaOpcode.Move:
				if (arity !== 5) fail('MOVE requires exactly five fields');
				operations.push({
					op: 'move',
					instance: requireInstance(input[cursor], 'MOVE instance'),
					parent: {
						instance: requireInstance(input[cursor + 1], 'MOVE parent site instance'),
						slot: requireIndex(input[cursor + 2], 'MOVE parent site slot'),
					},
					before: decodeAnchor(input[cursor + 3], input[cursor + 4], 'MOVE anchor'),
				});
				break;
			case LynxDeltaOpcode.Vis: {
				if (arity !== 2) fail('VIS requires exactly two fields');
				const instance = requireInstance(input[cursor], 'VIS instance');
				const state = input[cursor + 1];
				if (state !== LynxVisibilityState.Hidden && state !== LynxVisibilityState.Visible)
					fail('VIS state is unsupported');
				operations.push({
					op: 'vis',
					instance,
					state: state === LynxVisibilityState.Hidden ? 'hidden' : 'visible',
				});
				break;
			}
		}
		cursor = end;
	}

	return { version: LYNX_DELTA_PROTOCOL_VERSION, operations };
}
