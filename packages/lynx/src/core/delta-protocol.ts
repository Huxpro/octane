/** Versioned header for the Lynx slot-delta wire format. */
export const LYNX_DELTA_PROTOCOL_VERSION = 1 as const;

const enum LynxDeltaOpcode {
	Run = 1,
	Set = 2,
	Remove = 3,
	Move = 4,
	Branch = 5,
}

const enum LynxDeltaRemovalKind {
	Instance = 0,
	Range = 1,
}

export interface LynxRunDelta {
	readonly op: 'run';
	readonly templateId: number;
	readonly anchorSlot: number;
	readonly count: number;
	readonly values: readonly unknown[];
}

export interface LynxSetDelta {
	readonly op: 'set';
	readonly instance: number;
	readonly slotIndex: number;
	readonly value: unknown;
}

export type LynxRemovalTarget =
	| { readonly kind: 'instance'; readonly instance: number }
	| { readonly kind: 'range'; readonly anchorSlot: number; readonly members: readonly number[] };

export interface LynxRemoveDelta {
	readonly op: 'remove';
	readonly target: LynxRemovalTarget;
}

export interface LynxMoveDelta {
	readonly op: 'move';
	readonly instance: number;
	readonly before: number | null;
}

export interface LynxBranchDelta {
	readonly op: 'branch';
	readonly slot: number;
	readonly templateId: number | null;
	readonly values: readonly unknown[];
}

export type LynxDeltaOperation =
	LynxRunDelta | LynxSetDelta | LynxRemoveDelta | LynxMoveDelta | LynxBranchDelta;

export interface LynxDeltaMessage {
	readonly version: typeof LYNX_DELTA_PROTOCOL_VERSION;
	readonly operations: readonly LynxDeltaOperation[];
}

export type LynxEncodedDeltaMessage = readonly unknown[];

/**
 * The transport boundary intentionally checks only the frame headers. Slot
 * values are typed by their compiler-owned tables and must stay opaque here.
 */
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

function requireNullableIndex(value: unknown, name: string): number | null {
	return value === null ? null : requireIndex(value, name);
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
			case 'run':
				requireIndex(operation.templateId, 'RUN template id');
				requireIndex(operation.anchorSlot, 'RUN anchor slot');
				requirePositiveCount(operation.count, 'RUN count');
				pushFrame(encoded, LynxDeltaOpcode.Run, [
					operation.templateId,
					operation.anchorSlot,
					operation.count,
					...operation.values,
				]);
				break;
			case 'set':
				requireIndex(operation.instance, 'SET instance');
				requireIndex(operation.slotIndex, 'SET slot index');
				pushFrame(encoded, LynxDeltaOpcode.Set, [
					operation.instance,
					operation.slotIndex,
					operation.value,
				]);
				break;
			case 'remove':
				if (operation.target.kind === 'instance') {
					requireIndex(operation.target.instance, 'REMOVE instance');
					pushFrame(encoded, LynxDeltaOpcode.Remove, [
						LynxDeltaRemovalKind.Instance,
						operation.target.instance,
					]);
				} else {
					requireIndex(operation.target.anchorSlot, 'REMOVE range anchor slot');
					for (const member of operation.target.members) {
						requireIndex(member, 'REMOVE range member');
					}
					pushFrame(encoded, LynxDeltaOpcode.Remove, [
						LynxDeltaRemovalKind.Range,
						operation.target.anchorSlot,
						operation.target.members.length,
						...operation.target.members,
					]);
				}
				break;
			case 'move':
				requireIndex(operation.instance, 'MOVE instance');
				requireNullableIndex(operation.before, 'MOVE before instance');
				pushFrame(encoded, LynxDeltaOpcode.Move, [operation.instance, operation.before]);
				break;
			case 'branch':
				requireIndex(operation.slot, 'BRANCH slot');
				requireNullableIndex(operation.templateId, 'BRANCH template id');
				pushFrame(encoded, LynxDeltaOpcode.Branch, [
					operation.slot,
					operation.templateId,
					operation.values.length,
					...operation.values,
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
		if (opcode > LynxDeltaOpcode.Branch) fail('opcode is outside the supported range');
		const arity = requireIndex(input[cursor++], 'frame arity');
		const end = cursor + arity;
		if (end > input.length) fail('frame arity extends past the message');

		switch (opcode) {
			case LynxDeltaOpcode.Run: {
				if (arity < 3) fail('RUN requires at least three header fields');
				operations.push({
					op: 'run',
					templateId: requireIndex(input[cursor], 'RUN template id'),
					anchorSlot: requireIndex(input[cursor + 1], 'RUN anchor slot'),
					count: requirePositiveCount(input[cursor + 2], 'RUN count'),
					values: input.slice(cursor + 3, end),
				});
				break;
			}
			case LynxDeltaOpcode.Set:
				if (arity !== 3) fail('SET requires exactly three fields');
				operations.push({
					op: 'set',
					instance: requireIndex(input[cursor], 'SET instance'),
					slotIndex: requireIndex(input[cursor + 1], 'SET slot index'),
					value: input[cursor + 2],
				});
				break;
			case LynxDeltaOpcode.Remove: {
				const kind = input[cursor];
				if (kind === LynxDeltaRemovalKind.Instance) {
					if (arity !== 2) fail('instance REMOVE requires exactly two fields');
					operations.push({
						op: 'remove',
						target: {
							kind: 'instance',
							instance: requireIndex(input[cursor + 1], 'REMOVE instance'),
						},
					});
				} else if (kind === LynxDeltaRemovalKind.Range) {
					if (arity < 3) fail('range REMOVE requires at least three header fields');
					const memberCount = requireIndex(input[cursor + 2], 'REMOVE range member count');
					if (arity !== 3 + memberCount) fail('range REMOVE member count does not match arity');
					const members = input
						.slice(cursor + 3, end)
						.map((member) => requireIndex(member, 'REMOVE range member'));
					operations.push({
						op: 'remove',
						target: {
							kind: 'range',
							anchorSlot: requireIndex(input[cursor + 1], 'REMOVE range anchor slot'),
							members,
						},
					});
				} else {
					fail('REMOVE target kind is unsupported');
				}
				break;
			}
			case LynxDeltaOpcode.Move:
				if (arity !== 2) fail('MOVE requires exactly two fields');
				operations.push({
					op: 'move',
					instance: requireIndex(input[cursor], 'MOVE instance'),
					before: requireNullableIndex(input[cursor + 1], 'MOVE before instance'),
				});
				break;
			case LynxDeltaOpcode.Branch: {
				if (arity < 3) fail('BRANCH requires at least three header fields');
				const valueCount = requireIndex(input[cursor + 2], 'BRANCH value count');
				if (arity !== 3 + valueCount) fail('BRANCH value count does not match arity');
				operations.push({
					op: 'branch',
					slot: requireIndex(input[cursor], 'BRANCH slot'),
					templateId: requireNullableIndex(input[cursor + 1], 'BRANCH template id'),
					values: input.slice(cursor + 3, end),
				});
				break;
			}
		}
		cursor = end;
	}

	return { version: LYNX_DELTA_PROTOCOL_VERSION, operations };
}
