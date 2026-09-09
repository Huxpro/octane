declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalHostProgramAddress, UniversalProgramPlan } from 'octane/universal/native';

import { LYNX_DELTA_PROTOCOL_VERSION } from './delta-protocol.js';
import type { LynxCompiledProgramStore } from './compiled-program-store.js';
import type { LynxElementRef } from './papi.js';

const enum Opcode {
	Run = 1,
	Set = 2,
	Remove = 3,
	Clear = 4,
	Move = 5,
	Visibility = 6,
	Define = 7,
}

const END_INSTANCE = 0;
const ROOT_INSTANCE = 1;
const MAX_INSTANCE = 2 ** 31 - 1;
const RUN_HEADER_FIELDS = 7;
const LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const LYNX_COMPILED_PROGRAM_FRAME_ERROR = 'Octane Lynx OL485';

export type LynxCompiledProgramResolver = (
	module: string,
	index: number,
) => UniversalProgramPlan | undefined;

/** One first-screen run whose build address and painted state were retained locally. */
export interface LynxCompiledProgramFrameAdoption<Node extends LynxElementRef> {
	readonly address: UniversalHostProgramAddress;
	readonly count: number;
	readonly firstId: number;
	readonly firstListenerId: number | null;
	readonly nodes: readonly Node[];
	readonly plan: UniversalProgramPlan;
	readonly stride: number;
	readonly values: readonly unknown[];
	readonly valuesSelected: boolean;
}

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

function instance(value: unknown, message: string | false): number {
	const result = count(value, message);
	if (result > MAX_INSTANCE) fail(message);
	return result;
}

/**
 * Decode one proved subset of the v2 slot-delta protocol directly into a store.
 *
 * The router deliberately allocates no operation objects and gives a RUN's
 * value segment to the store by offset, so the retained value table is its only
 * copy. This slice owns root-level, range-free RUN/SET/REMOVE/MOVE/CLEAR/VIS,
 * including the deterministic event-token run carried by a resident program.
 * DEFINE resolves a build-proven address once and publishes its compact id in
 * the same transaction as the RUN that first uses it. Non-root range addresses
 * reject transactionally rather than falling through to a command interpreter.
 */
export function applyLynxCompiledProgramFrame<Node extends LynxElementRef>(
	store: LynxCompiledProgramStore<Node>,
	page: Node,
	resolve: LynxCompiledProgramResolver,
	input: unknown,
	adoptions?: readonly LynxCompiledProgramFrameAdoption<Node>[],
): void {
	if (!Array.isArray(input) || input[0] !== LYNX_DELTA_PROTOCOL_VERSION) {
		fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a version-2 array envelope');
	}

	store.begin();
	try {
		const adoptionTemplates: unknown[] | null = adoptions === undefined ? null : [];
		let adoptionAt = 0;
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

			if (opcode === Opcode.Define) {
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
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative DEFINE program index',
				);
				const plan = resolve(module, programIndex);
				if (plan === undefined)
					fail(
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT &&
							`cannot resolve DEFINE program ${module}#${programIndex}`,
					);
				if (!store.define(template, plan) && adoptionTemplates !== null) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'first-screen run identity differs');
				}
				if (adoptionTemplates !== null) {
					adoptionTemplates[template * 2] = module;
					adoptionTemplates[template * 2 + 1] = programIndex;
				}
			} else if (opcode === Opcode.Run) {
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
				if (input[cursor + 1] !== ROOT_INSTANCE || input[cursor + 2] !== 0) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'supports only the root range site');
				}
				const beforeInstance = index(
					input[cursor + 3],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative RUN anchor',
				);
				if (input[cursor + 4] !== 0)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a root RUN anchor');
				const firstHandle = instance(
					input[cursor + 5],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range RUN first instance',
				);
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
				const valueOffset = cursor + RUN_HEADER_FIELDS;
				const adoption = adoptions?.[adoptionAt++];
				if (adoptions !== undefined) {
					if (
						adoption === undefined ||
						adoption.plan !== plan ||
						adoption.count !== runCount ||
						(adoption.valuesSelected ? adoption.values.length !== valueCount : runCount !== 1) ||
						adoption.address.module !== adoptionTemplates![template * 2] ||
						adoption.address.index !== adoptionTemplates![template * 2 + 1] ||
						beforeInstance !== END_INSTANCE
					) {
						fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'first-screen run identity differs');
					}
					for (let index = 0; index < valueCount; index++) {
						const painted = adoption.valuesSelected
							? adoption.values[index]
							: adoption.values[plan.values[index % plan.values.length]!];
						if (!Object.is(painted, input[valueOffset + index])) {
							fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'first-screen run value differs');
						}
					}
				}
				if (adoption === undefined)
					store.mount({
						before:
							beforeInstance === END_INSTANCE
								? null
								: instance(
										beforeInstance,
										LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range RUN anchor',
									),
						count: runCount,
						firstHandle,
						parent: page,
						plan,
						valueOffset,
						values: input,
					});
				else
					store.adopt({
						before: null,
						count: runCount,
						firstHandle,
						firstId: adoption.firstId,
						firstListenerId: adoption.firstListenerId,
						nodes: adoption.nodes,
						parent: page,
						plan,
						stride: adoption.stride,
						valueOffset,
						values: input,
					});
			} else if (opcode === Opcode.Set) {
				if (arity !== 3)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'SET requires three fields');
				store.set(
					instance(
						input[cursor],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range SET instance',
					),
					index(
						input[cursor + 1],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative SET slot',
					),
					input[cursor + 2],
				);
			} else if (opcode === Opcode.Remove) {
				if (arity !== 2)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'REMOVE requires two fields');
				const firstHandle = instance(
					input[cursor],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range REMOVE first instance',
				);
				const removeCount = count(
					input[cursor + 1],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a positive REMOVE count',
				);
				const finalHandle = firstHandle + removeCount - 1;
				if (!Number.isSafeInteger(finalHandle) || finalHandle > MAX_INSTANCE) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'REMOVE run exceeds the instance range');
				}
				for (let handle = firstHandle; handle <= finalHandle; handle++) store.remove(handle);
			} else if (opcode === Opcode.Clear) {
				if (arity !== 2)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'CLEAR requires two fields');
				if (input[cursor] !== ROOT_INSTANCE || input[cursor + 1] !== 0) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'supports only the root range site');
				}
				store.clear(page);
			} else if (opcode === Opcode.Move) {
				if (arity !== 5)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'MOVE requires five fields');
				const handle = instance(
					input[cursor],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range MOVE instance',
				);
				if (input[cursor + 1] !== ROOT_INSTANCE || input[cursor + 2] !== 0) {
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'supports only the root range site');
				}
				const before = index(
					input[cursor + 3],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a non-negative MOVE anchor',
				);
				if (input[cursor + 4] !== 0)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a root MOVE anchor');
				store.move(
					handle,
					before === END_INSTANCE
						? null
						: instance(
								before,
								LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range MOVE anchor',
							),
				);
			} else if (opcode === Opcode.Visibility) {
				if (arity !== 2) fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'VIS requires two fields');
				const visible = index(
					input[cursor + 1],
					LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a VIS state',
				);
				if (visible > 1)
					fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires a hidden or visible VIS state');
				store.visibility(
					instance(
						input[cursor],
						LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'requires an in-range VIS instance',
					),
					visible === 1,
				);
			} else {
				fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && `does not support opcode ${opcode}`);
			}
			cursor = end;
		}
		if (adoptions !== undefined && adoptionAt !== adoptions.length) {
			fail(LYNX_COMPILED_PROGRAM_FRAME_DEVELOPMENT && 'did not consume every first-screen run');
		}
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
