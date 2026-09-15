import type { UniversalSerializableValue } from 'octane/universal/native';

import type { LynxPreparedBlockDeltaBatch } from './block-delta-producer.js';
import { encodeLynxDeltaMessage, type LynxDeltaOperation } from './delta-protocol.js';
import type {
	LynxBackgroundFunctionDescriptor,
	LynxBackgroundFunctionRegistry,
	LynxWorkletValue,
} from './worklets.js';

type Executions = ReadonlySet<string>;

interface SiteChange {
	readonly instance: number;
	readonly slot: number;
	readonly previous: Executions | undefined;
	next: Executions | undefined;
}

export interface LynxPreparedCompiledProgramBackgroundWorklets {
	readonly encoded: readonly unknown[];
	accept(): void;
	reject(): void;
}

export interface LynxCompiledProgramBackgroundWorklets {
	prepare(frame: LynxPreparedBlockDeltaBatch): LynxPreparedCompiledProgramBackgroundWorklets;
	run(fn: LynxBackgroundFunctionDescriptor, args: readonly unknown[]): unknown;
	activeExecutions(): readonly string[];
	close(): void;
}

function visitsBackgroundFunction(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value !== 'object') return false;
	if (seen.has(value)) return false;
	seen.add(value);
	if (
		!Array.isArray(value) &&
		typeof (value as { readonly _jsFnId?: unknown })._jsFnId === 'string'
	) {
		return true;
	}
	for (const key of Object.keys(value)) {
		if (visitsBackgroundFunction((value as Record<string, unknown>)[key], seen)) return true;
	}
	return false;
}

function collectExecutions(value: unknown, output: Set<string>, seen = new Set<object>()): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	if (!Array.isArray(value)) {
		const execution = (value as { readonly _execId?: unknown })._execId;
		if (typeof execution === 'string') output.add(execution);
	}
	for (const key of Object.keys(value)) {
		collectExecutions((value as Record<string, unknown>)[key], output, seen);
	}
}

export function lynxCompiledProgramFrameRequiresBackgroundWorklets(
	frame: LynxPreparedBlockDeltaBatch,
): boolean {
	for (const operation of frame.operations) {
		if (operation.op === 'set' && visitsBackgroundFunction(operation.value)) return true;
		if (operation.op === 'run') {
			for (const value of operation.values) {
				if (visitsBackgroundFunction(value)) return true;
			}
		}
	}
	return false;
}

/** Sparse background execution ownership for direct compact worklet/ref slots. */
export function createLynxCompiledProgramBackgroundWorklets(
	registry: LynxBackgroundFunctionRegistry,
): LynxCompiledProgramBackgroundWorklets {
	const owners = new Map<number, Map<number, Executions>>();
	let closed = false;

	const manager: LynxCompiledProgramBackgroundWorklets = {
		prepare(frame) {
			if (closed) throw new Error('Octane Lynx compact background worklets are closed.');
			const pending = new Set<string>();
			const changes = new Map<number, Map<number, SiteChange>>();
			let operations: LynxDeltaOperation[] | null = null;

			const changeFor = (instance: number, slot: number): SiteChange => {
				let slots = changes.get(instance);
				if (slots === undefined) changes.set(instance, (slots = new Map()));
				let change = slots.get(slot);
				if (change === undefined) {
					const previous = owners.get(instance)?.get(slot);
					change = { instance, slot, previous, next: previous };
					slots.set(slot, change);
				}
				return change;
			};
			const stage = (instance: number, slot: number, next: Executions | undefined): void => {
				changeFor(instance, slot).next = next;
			};
			const retire = (instance: number): void => {
				const slots = new Set<number>();
				for (const slot of owners.get(instance)?.keys() ?? []) slots.add(slot);
				for (const slot of changes.get(instance)?.keys() ?? []) slots.add(slot);
				for (const slot of slots) stage(instance, slot, undefined);
			};
			const retain = (
				value: unknown,
			): { readonly value: unknown; readonly executions: Executions } => {
				const retained = registry.retain(value as LynxWorkletValue);
				const executions = new Set<string>();
				collectExecutions(retained, executions);
				for (const execution of executions) pending.add(execution);
				return { value: retained, executions };
			};

			try {
				for (let index = 0; index < frame.operations.length; index++) {
					const operation = frame.operations[index]!;
					if (operation.op === 'run') {
						if (operation.values.length % operation.count !== 0) {
							throw new TypeError('Octane Lynx compact RUN has an invalid worklet value arity.');
						}
						const slots = operation.values.length / operation.count;
						let values: unknown[] | null = null;
						for (let valueIndex = 0; valueIndex < operation.values.length; valueIndex++) {
							const value = operation.values[valueIndex];
							if (!visitsBackgroundFunction(value)) continue;
							const retained = retain(value);
							(values ??= [...operation.values])[valueIndex] = retained.value;
							stage(
								operation.firstInstance + Math.floor(valueIndex / slots),
								valueIndex % slots,
								retained.executions,
							);
						}
						if (values !== null) {
							(operations ??= [...frame.operations])[index] = Object.freeze({
								...operation,
								values: Object.freeze(values) as readonly UniversalSerializableValue[],
							});
						}
					} else if (operation.op === 'set') {
						if (visitsBackgroundFunction(operation.value)) {
							const retained = retain(operation.value);
							stage(operation.instance, operation.slot, retained.executions);
							(operations ??= [...frame.operations])[index] = Object.freeze({
								...operation,
								value: retained.value as UniversalSerializableValue,
							});
						} else stage(operation.instance, operation.slot, undefined);
					} else if (operation.op === 'remove') {
						for (let offset = 0; offset < operation.count; offset++) {
							retire(operation.firstInstance + offset);
						}
					}
				}
				for (const instance of frame.retiredInstances) retire(instance);
			} catch (error) {
				for (const execution of pending) registry.release(execution);
				throw error;
			}

			const encoded =
				operations === null ? frame.encoded : encodeLynxDeltaMessage(operations, frame.templates);
			let state: 'prepared' | 'accepted' | 'rejected' = 'prepared';
			return Object.freeze({
				encoded,
				accept() {
					if (state !== 'prepared') return;
					state = 'accepted';
					const retained = new Set<string>();
					for (const slots of changes.values()) {
						for (const change of slots.values()) {
							let acceptedSlots = owners.get(change.instance);
							if (change.next === undefined) {
								acceptedSlots?.delete(change.slot);
								if (acceptedSlots?.size === 0) owners.delete(change.instance);
							} else {
								if (acceptedSlots === undefined) {
									owners.set(change.instance, (acceptedSlots = new Map()));
								}
								acceptedSlots.set(change.slot, change.next);
								for (const execution of change.next) retained.add(execution);
							}
							for (const execution of change.previous ?? []) registry.release(execution);
						}
					}
					for (const execution of pending) {
						if (!retained.has(execution)) registry.release(execution);
					}
				},
				reject() {
					if (state !== 'prepared') return;
					state = 'rejected';
					for (const execution of pending) registry.release(execution);
				},
			});
		},
		run(fn, args) {
			return registry.run(fn, args);
		},
		activeExecutions() {
			const result: string[] = [];
			for (const slots of owners.values()) {
				for (const executions of slots.values()) result.push(...executions);
			}
			return Object.freeze(result);
		},
		close() {
			if (closed) return;
			closed = true;
			owners.clear();
			registry.close();
		},
	};
	return Object.freeze(manager);
}
