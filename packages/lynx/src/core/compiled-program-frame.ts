declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import {
	decodeLynxDeltaValue,
	isLynxDeltaValue,
	LYNX_DELTA_PROTOCOL_VERSION,
} from './delta-protocol.js';
import type { LynxCompiledProgramStore } from './compiled-program-store.js';
import { LYNX_COMPILED_PROGRAM_HOST_REFS } from './compiled-program-host-ref-feature.js';
import type { LynxCompiledProgramRangeIdentity } from './compiled-program-store.js';
import type { LynxElementRef } from './papi.js';

const enum Opcode {
	Run = 1,
	Set = 2,
	Remove = 3,
	Clear = 4,
	Move = 5,
	Visibility = 6,
	Define = 7,
	RefRun = 8,
}

const END_INSTANCE = 0;
const ROOT_INSTANCE = 1;
const RUN_HEADER_FIELDS = 7;
const LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const LYNX_COMPILED_PROGRAM_FRAME_ERROR = 'Octane Lynx OL485';

export type LynxCompiledProgramResolver = (
	module: string,
	index: number,
) => UniversalProgramPlan | undefined;

function fail(message: string | false): never {
	throw new TypeError(
		LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT
			? `Octane Lynx compact program frame ${message}.`
			: LYNX_COMPILED_PROGRAM_FRAME_ERROR,
	);
}

function index(value: unknown, message: string | false): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) fail(message);
	return value as number;
}

function count(value: unknown, message: string | false): number {
	const result = index(value, message);
	if (result === 0) fail(message);
	return result;
}

/**
 * Decode one proved subset of the v2 slot-delta protocol directly into a store.
 *
 * The router deliberately allocates no operation objects and gives a RUN's
 * value segment to the store by offset, so the retained value table is its only
 * copy. This slice owns range-addressed RUN/SET/REMOVE/MOVE/CLEAR/VIS,
 * including the deterministic event-token run carried by a resident program.
 * DEFINE resolves a build-proven address once and publishes its compact id in
 * the same transaction as the RUN that first uses it. Nested parents resolve
 * through the resident program's compiler slot rather than a physical node id.
 */
export function applyLynxCompiledProgramFrame<Node extends LynxElementRef>(
	store: LynxCompiledProgramStore<Node>,
	page: Node,
	resolve: LynxCompiledProgramResolver,
	input: unknown,
	beforeCommit?: () => void,
): void {
	if (!Array.isArray(input) || input[0] !== LYNX_DELTA_PROTOCOL_VERSION) {
		fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a version-2 array envelope');
	}

	store.begin();
	try {
		const range = (
			at: number,
		): { readonly parent: Node; readonly identity?: LynxCompiledProgramRangeIdentity } => {
			const handle = input[at];
			const slot = input[at + 1];
			if (handle === ROOT_INSTANCE) {
				if (slot !== 0)
					fail(
						(typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) &&
							'requires root range slot 0',
					);
				return { parent: page };
			}
			return {
				parent: store.range(handle as number, slot as number),
				identity: { owner: handle as number, slot: slot as number },
			};
		};
		const anchor = (at: number): { before: number | null; anchor: Node | null } => {
			const handle = input[at];
			const slot = index(
				input[at + 1],
				LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative anchor slot',
			);
			if (handle === END_INSTANCE) {
				if (slot !== 0) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'END anchor must use slot 0');
				}
				return { before: null, anchor: null };
			}
			const instance = count(
				handle,
				LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive anchor instance',
			);
			return slot === 0
				? { before: instance, anchor: null }
				: { before: null, anchor: store.node(instance, slot) };
		};
		let cursor = 1;
		while (cursor < input.length) {
			const opcode = count(
				input[cursor++],
				LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive opcode',
			);
			const arity = index(
				input[cursor++],
				LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative frame arity',
			);
			const end = cursor + arity;
			if (end > input.length)
				fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'frame arity extends past the envelope');
			switch (opcode) {
				case Opcode.Define: {
					if (arity !== 3)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'DEFINE requires three fields');
					const template = count(
						input[cursor],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive DEFINE template',
					);
					const module = input[cursor + 1];
					if (typeof module !== 'string' || module.length === 0)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a DEFINE module');
					const programIndex = index(
						input[cursor + 2],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT &&
							'requires a non-negative DEFINE program index',
					);
					const plan = resolve(module, programIndex);
					if (plan === undefined)
						fail(
							LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT &&
								`cannot resolve DEFINE program ${module}#${programIndex}`,
						);
					store.define(template, plan);
					break;
				}
				case Opcode.Run: {
					if (arity < RUN_HEADER_FIELDS)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'RUN requires seven header fields');
					const template = index(
						input[cursor],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative RUN template',
					);
					const plan = store.resolve(template);
					if (plan === undefined)
						fail(
							LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && `cannot resolve RUN template ${template}`,
						);
					const parent = range(cursor + 1);
					const before = anchor(cursor + 3);
					const firstHandle = input[cursor + 5] as number;
					if (firstHandle === ROOT_INSTANCE)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'reserves instance 1 for the root');
					const runCount = count(
						input[cursor + 6],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive RUN count',
					);
					const valueCount = plan.values.length * runCount;
					if (!Number.isSafeInteger(valueCount) || arity !== RUN_HEADER_FIELDS + valueCount) {
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'received the wrong RUN value arity');
					}
					const firstValue = cursor + RUN_HEADER_FIELDS;
					let values: readonly unknown[] = input;
					let valueOffset = firstValue;
					for (let at = firstValue; at < end; at++) {
						if (isLynxDeltaValue(input[at])) continue;
						values = input
							.slice(firstValue, end)
							.map((value, index) => decodeLynxDeltaValue(value, 'RUN value ' + index));
						valueOffset = 0;
						break;
					}
					store.mount({
						before: before.before,
						anchor: before.anchor,
						count: runCount,
						firstHandle,
						parent: parent.parent,
						range: parent.identity,
						plan,
						valueOffset,
						values,
					});
					break;
				}
				case Opcode.Set: {
					if (arity !== 3)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'SET requires three fields');
					store.set(
						input[cursor] as number,
						input[cursor + 1] as number,
						decodeLynxDeltaValue(input[cursor + 2], 'SET value'),
					);
					break;
				}
				case Opcode.Remove: {
					if (arity !== 2)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'REMOVE requires two fields');
					const firstHandle = count(
						input[cursor],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive REMOVE first instance',
					);
					const removeCount = count(
						input[cursor + 1],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive REMOVE count',
					);
					for (let offset = 0; offset < removeCount; offset++) store.remove(firstHandle + offset);
					break;
				}
				case Opcode.Clear: {
					if (arity !== 2)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'CLEAR requires two fields');
					const parent = range(cursor);
					store.clear(parent.parent, parent.identity);
					break;
				}
				case Opcode.Move: {
					if (arity !== 5)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'MOVE requires five fields');
					const handle = input[cursor] as number;
					const parent = range(cursor + 1);
					const before = anchor(cursor + 3);
					store.move(handle, parent.parent, before.before, before.anchor, parent.identity);
					break;
				}
				case Opcode.Visibility: {
					if (arity !== 2)
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'VIS requires two fields');
					const visible = input[cursor + 1];
					if (visible !== 0 && visible !== 1)
						fail(
							LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a hidden or visible VIS state',
						);
					store.visibility(input[cursor] as number, visible === 1);
					break;
				}
				case Opcode.RefRun: {
					if (LYNX_COMPILED_PROGRAM_HOST_REFS) {
						if (arity !== 3)
							fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'REF-RUN requires three fields');
						store.refs(
							input[cursor] as number,
							input[cursor + 1] as number,
							input[cursor + 2] as number,
						);
						break;
					}
					fail(
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT &&
							'REF-RUN reached a bundle compiled without host-ref support',
					);
					break;
				}
				default:
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && `does not support opcode ${opcode}`);
			}
			cursor = end;
		}
		// Native-list metadata must be staged before the page flush so the flush
		// publishes the same candidate whose logical frame is being accepted.
		store.prepareCommit();
		// A ContextProxy abort can re-enter while Element PAPI work is in
		// progress. Give the owning receiver one last boundary before publication:
		// throwing here rolls the entire frame back through the same journal as a
		// malformed later opcode, so an aborted attempt never becomes accepted
		// merely because its host writes were synchronous.
		beforeCommit?.();
		store.commit();
	} catch (error) {
		try {
			store.rollback();
		} catch (rollbackError) {
			throw new AggregateError(
				[error, rollbackError],
				LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT
					? 'Compiled program frame rollback failed.'
					: LYNX_COMPILED_PROGRAM_FRAME_ERROR,
			);
		}
		throw error;
	}
}
