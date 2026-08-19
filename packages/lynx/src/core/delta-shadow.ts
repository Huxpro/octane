import type { UniversalHostBatch, UniversalHostTemplateProgram } from 'octane/universal/native';
import {
	encodeLynxDeltaMessage,
	type LynxDeltaOperation,
	type LynxEncodedDeltaMessage,
} from './delta-protocol.js';

interface ShadowInstance {
	readonly firstId: number;
	readonly templateId: number;
	readonly program: UniversalHostTemplateProgram;
	readonly parent: number | null;
	values: unknown[];
}

interface ShadowHost {
	readonly firstId: number;
	readonly nodeIndex: number;
}

export interface LynxDeltaShadowSnapshot {
	readonly instances: readonly {
		readonly firstId: number;
		readonly templateId: number;
		readonly parent: number | null;
		readonly values: readonly unknown[];
	}[];
	readonly order: readonly {
		readonly parent: number | null;
		readonly instances: readonly number[];
	}[];
}

export interface LynxPreparedDeltaShadow {
	readonly operations: readonly LynxDeltaOperation[];
	readonly encoded: LynxEncodedDeltaMessage;
	commit(): void;
	snapshot(): LynxDeltaShadowSnapshot;
}

export interface LynxDeltaShadow {
	prepare(batch: UniversalHostBatch): LynxPreparedDeltaShadow | null;
	snapshot(): LynxDeltaShadowSnapshot;
}

interface ShadowState {
	templates: Map<UniversalHostTemplateProgram, number>;
	nextTemplateId: number;
	instances: Map<number, ShadowInstance>;
	hosts: Map<number, ShadowHost>;
	order: Map<number | null, number[]>;
}

function cloneState(source: ShadowState): ShadowState {
	return {
		templates: new Map(source.templates),
		nextTemplateId: source.nextTemplateId,
		instances: new Map(
			[...source.instances].map(([id, instance]) => [
				id,
				{ ...instance, values: [...instance.values] },
			]),
		),
		hosts: new Map(source.hosts),
		order: new Map([...source.order].map(([parent, instances]) => [parent, [...instances]])),
	};
}

function valueStride(program: UniversalHostTemplateProgram): number {
	let stride = 0;
	for (const node of program.nodes) {
		for (const binding of node.bindings ?? []) stride = Math.max(stride, binding.valueIndex + 1);
	}
	return stride;
}

function snapshotState(state: ShadowState): LynxDeltaShadowSnapshot {
	return {
		instances: [...state.instances.values()]
			.sort((left, right) => left.firstId - right.firstId)
			.map(({ firstId, templateId, parent, values }) => ({
				firstId,
				templateId,
				parent,
				values: [...values],
			})),
		order: [...state.order]
			.sort(([left], [right]) => (left ?? -1) - (right ?? -1))
			.map(([parent, instances]) => ({ parent, instances: [...instances] })),
	};
}

function removeInstance(state: ShadowState, firstId: number): void {
	const instance = state.instances.get(firstId);
	if (instance === undefined) return;
	state.instances.delete(firstId);
	for (let index = 0; index < instance.program.nodes.length; index++) {
		state.hosts.delete(firstId + index);
	}
	const order = state.order.get(instance.parent);
	if (order !== undefined) order.splice(order.indexOf(firstId), 1);
}

function hostProps(instance: ShadowInstance, nodeIndex: number): Record<string, unknown> {
	const node = instance.program.nodes[nodeIndex]!;
	const props = { ...node.props };
	for (const binding of node.bindings ?? [])
		props[binding.name] = instance.values[binding.valueIndex];
	return props;
}

/**
 * Profiling-only bridge from the current command ABI to the future slot-delta
 * ABI. It accepts only batches whose semantics are fully representable, so a
 * miss is evidence for the next compiler/background-core slice, never a lossy
 * fallback.
 */
export function createLynxDeltaShadow(): LynxDeltaShadow {
	let state: ShadowState = {
		templates: new Map(),
		nextTemplateId: 1,
		instances: new Map(),
		hosts: new Map(),
		order: new Map(),
	};

	return {
		prepare(batch) {
			const next = cloneState(state);
			const operations: LynxDeltaOperation[] = [];
			const removedHosts = new Set<number>();
			for (const command of batch.commands) {
				if (command.op === 'mount-template-run') {
					if (
						command.before !== null ||
						(command.parent !== null && typeof command.parent !== 'number')
					)
						return null;
					const stride = valueStride(command.program);
					if (stride * command.count !== command.values.length) return null;
					let templateId = next.templates.get(command.program);
					if (templateId === undefined) {
						templateId = next.nextTemplateId++;
						next.templates.set(command.program, templateId);
					}
					const parent = command.parent;
					const order = next.order.get(parent) ?? [];
					next.order.set(parent, order);
					for (let instanceIndex = 0; instanceIndex < command.count; instanceIndex++) {
						const firstId = command.firstId + instanceIndex * command.program.nodes.length;
						const values = command.values.slice(
							instanceIndex * stride,
							(instanceIndex + 1) * stride,
						);
						next.instances.set(firstId, {
							firstId,
							templateId,
							program: command.program,
							parent,
							values,
						});
						for (let nodeIndex = 0; nodeIndex < command.program.nodes.length; nodeIndex++) {
							next.hosts.set(firstId + nodeIndex, { firstId, nodeIndex });
						}
						order.push(firstId);
					}
					operations.push({
						op: 'run',
						templateId,
						anchorSlot: parent ?? 0,
						count: command.count,
						values: command.values,
					});
					continue;
				}
				if (command.op === 'update') {
					const host = next.hosts.get(command.id);
					const instance = host === undefined ? undefined : next.instances.get(host.firstId);
					if (host === undefined || instance === undefined) return null;
					const previous = hostProps(instance, host.nodeIndex);
					const bindings = instance.program.nodes[host.nodeIndex]!.bindings ?? [];
					const bindingNames = new Set(bindings.map((binding) => binding.name));
					for (const name of new Set([...Object.keys(previous), ...Object.keys(command.props)])) {
						if (!Object.is(previous[name], command.props[name]) && !bindingNames.has(name))
							return null;
					}
					for (const binding of bindings) {
						const value = command.props[binding.name];
						if (Object.is(instance.values[binding.valueIndex], value)) continue;
						instance.values[binding.valueIndex] = value;
						operations.push({
							op: 'set',
							instance: instance.firstId,
							slotIndex: binding.valueIndex,
							value,
						});
					}
					continue;
				}
				if (command.op === 'move') {
					if (command.parent !== null && typeof command.parent !== 'number') return null;
					const host = next.hosts.get(command.id);
					const before = command.before === null ? null : next.hosts.get(command.before);
					if (host === undefined || (command.before !== null && before === undefined)) return null;
					if (host.nodeIndex !== 0 || (before != null && before.nodeIndex !== 0)) return null;
					const instance = next.instances.get(host.firstId)!;
					if (instance.parent !== command.parent) return null;
					const order = next.order.get(instance.parent)!;
					order.splice(order.indexOf(instance.firstId), 1);
					const beforeId = before?.firstId ?? null;
					order.splice(
						beforeId === null ? order.length : order.indexOf(beforeId),
						0,
						instance.firstId,
					);
					operations.push({ op: 'move', instance: instance.firstId, before: beforeId });
					continue;
				}
				if (command.op === 'remove') {
					const host = next.hosts.get(command.id);
					if (host === undefined || host.nodeIndex !== 0) return null;
					const instance = next.instances.get(host.firstId)!;
					for (let index = 0; index < instance.program.nodes.length; index++) {
						removedHosts.add(instance.firstId + index);
					}
					operations.push({ op: 'remove', target: { kind: 'instance', instance: host.firstId } });
					removeInstance(next, host.firstId);
					continue;
				}
				if (command.op === 'destroy' && removedHosts.has(command.id)) {
					continue;
				}
				return null;
			}
			const encoded = encodeLynxDeltaMessage(operations);
			return {
				operations,
				encoded,
				commit() {
					state = next;
				},
				snapshot: () => snapshotState(next),
			};
		},
		snapshot: () => snapshotState(state),
	};
}
