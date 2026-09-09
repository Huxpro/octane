declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import { LYNX_DELTA_PROTOCOL_VERSION } from './delta-protocol.js';
import type { LynxCompiledProgramStore } from './compiled-program-store.js';
import type { LynxElementRef } from './papi.js';

const enum Opcode {
	Run = 1,
	Set = 2,
	Remove = 3,
}

const END_INSTANCE = 0;
const ROOT_INSTANCE = 1;
const MAX_INSTANCE = 2 ** 31 - 1;
const RUN_HEADER_FIELDS = 7;

export type LynxCompiledProgramResolver = (template: number) => UniversalProgramPlan | undefined;

function fail(message: string): never {
	throw new TypeError(
		typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
			? `Octane Lynx compact program frame ${message}.`
			: 'Octane Lynx OL485',
	);
}

function index(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`requires ${name}`);
	return value as number;
}

function count(value: unknown, name: string): number {
	const result = index(value, name);
	if (result === 0) fail(`requires ${name}`);
	return result;
}

function instance(value: unknown, name: string): number {
	const result = count(value, name);
	if (result > MAX_INSTANCE) fail(`requires ${name}`);
	return result;
}

/**
 * Decode one proved subset of the v2 slot-delta protocol directly into a store.
 *
 * The router deliberately allocates no operation objects and gives a RUN's
 * value segment to the store by offset, so the retained value table is its only
 * copy. This slice owns root-level, range- and event-free RUN/SET/REMOVE. Every
 * other opcode or address rejects transactionally rather than falling through
 * to a command interpreter.
 */
export function applyLynxCompiledProgramFrame<Node extends LynxElementRef>(
	store: LynxCompiledProgramStore<Node>,
	page: Node,
	resolve: LynxCompiledProgramResolver,
	input: unknown,
): void {
	if (!Array.isArray(input) || input[0] !== LYNX_DELTA_PROTOCOL_VERSION) {
		fail('requires a version-2 array envelope');
	}

	store.begin();
	try {
		let cursor = 1;
		while (cursor < input.length) {
			const opcode = count(input[cursor++], 'a positive opcode');
			const arity = index(input[cursor++], 'a non-negative frame arity');
			const end = cursor + arity;
			if (end > input.length) fail('frame arity extends past the envelope');

			if (opcode === Opcode.Run) {
				if (arity < RUN_HEADER_FIELDS) fail('RUN requires seven header fields');
				const template = index(input[cursor], 'a non-negative RUN template');
				const plan = resolve(template);
				if (plan === undefined) fail(`cannot resolve RUN template ${template}`);
				if (input[cursor + 1] !== ROOT_INSTANCE || input[cursor + 2] !== 0) {
					fail('supports only the root range site');
				}
				const beforeInstance = index(input[cursor + 3], 'a non-negative RUN anchor');
				if (input[cursor + 4] !== 0) fail('requires a root RUN anchor');
				const firstHandle = instance(input[cursor + 5], 'an in-range RUN first instance');
				if (firstHandle === ROOT_INSTANCE) fail('reserves instance 1 for the root');
				const runCount = count(input[cursor + 6], 'a positive RUN count');
				const valueCount = plan.values.length * runCount;
				if (!Number.isSafeInteger(valueCount) || arity !== RUN_HEADER_FIELDS + valueCount) {
					fail('received the wrong RUN value arity');
				}
				store.mount({
					before:
						beforeInstance === END_INSTANCE
							? null
							: store.root(instance(beforeInstance, 'an in-range RUN anchor')),
					count: runCount,
					firstHandle,
					parent: page,
					plan,
					valueOffset: cursor + RUN_HEADER_FIELDS,
					values: input,
				});
			} else if (opcode === Opcode.Set) {
				if (arity !== 3) fail('SET requires three fields');
				store.set(
					instance(input[cursor], 'an in-range SET instance'),
					index(input[cursor + 1], 'a non-negative SET slot'),
					input[cursor + 2],
				);
			} else if (opcode === Opcode.Remove) {
				if (arity !== 2) fail('REMOVE requires two fields');
				const firstHandle = instance(input[cursor], 'an in-range REMOVE first instance');
				const removeCount = count(input[cursor + 1], 'a positive REMOVE count');
				const finalHandle = firstHandle + removeCount - 1;
				if (!Number.isSafeInteger(finalHandle) || finalHandle > MAX_INSTANCE) {
					fail('REMOVE run exceeds the instance range');
				}
				for (let handle = firstHandle; handle <= finalHandle; handle++) store.remove(handle);
			} else {
				fail(`does not support opcode ${opcode}`);
			}
			cursor = end;
		}
		store.commit();
	} catch (error) {
		try {
			store.rollback();
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], 'Compiled program frame rollback failed.');
		}
		throw error;
	}
}
