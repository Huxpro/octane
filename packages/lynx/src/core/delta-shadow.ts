import {
	universalProgramRangeCommandSlot,
	type UniversalHostBatch,
	type UniversalHostTemplateProgram,
} from 'octane/universal/native';
import { producedRunProgram } from './run-program.js';
import {
	encodeLynxDeltaMessage,
	isLynxDeltaValue,
	type LynxDeltaOperation,
	type LynxDeltaTemplate,
	type LynxDeltaValue,
	type LynxEncodedDeltaMessage,
	type LynxSlotAddress,
} from './delta-protocol.js';

/**
 * The container the root commands mount into. Instance handles are dense and
 * monotonic from there, so the shadow allocates its own rather than reusing
 * command-batch node ids, which are per-node and not per-instance.
 */
const ROOT_INSTANCE = 1;

interface ShadowInstance {
	readonly firstId: number;
	readonly handle: number;
	readonly templateId: number;
	readonly program: UniversalHostTemplateProgram;
	readonly parent: number | null;
	readonly parentSlot: number;
	values: unknown[];
}

interface ShadowHost {
	readonly firstId: number;
	readonly nodeIndex: number;
}

export interface LynxDeltaShadowSnapshot {
	readonly instances: readonly {
		readonly firstId: number;
		readonly handle: number;
		readonly templateId: number;
		readonly parent: number | null;
		readonly parentSlot: number;
		readonly values: readonly unknown[];
	}[];
	readonly order: readonly {
		readonly parent: number | null;
		readonly slot: number;
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
	templates: ShadowMap<string, number>;
	nextTemplateId: number;
	nextInstance: number;
	instances: ShadowMap<number, ShadowInstance>;
	hosts: ShadowMap<number, ShadowHost>;
	order: ShadowMap<number | null, Map<number, number[]>>;
	/** Range arrays already detached from the committed map in this draft. */
	writableOrderSlots: Map<number | null, Set<number>>;
}

interface ShadowMap<Key, Value> extends Iterable<readonly [Key, Value]> {
	get(key: Key): Value | undefined;
	set(key: Key, value: Value): unknown;
	delete(key: Key): boolean;
	values(): IterableIterator<Value>;
}

/**
 * Copy-on-write view over one committed map.
 *
 * The profiling bridge originally cloned every live template, instance, host,
 * range order, and value table before encoding even a one-slot SET. At 10k
 * rows that made a constant-size update O(page size) before it crossed either
 * thread. A draft records only changed keys; iteration is reserved for
 * diagnostics/snapshots and the accepted commit applies the small overlay to
 * the long-lived map in place.
 */
class DraftMap<Key, Value> implements ShadowMap<Key, Value> {
	readonly writes = new Map<Key, Value>();
	readonly deletions = new Set<Key>();

	constructor(readonly base: Map<Key, Value>) {}

	get(key: Key): Value | undefined {
		if (this.writes.has(key)) return this.writes.get(key);
		return this.deletions.has(key) ? undefined : this.base.get(key);
	}

	set(key: Key, value: Value): this {
		this.deletions.delete(key);
		this.writes.set(key, value);
		return this;
	}

	delete(key: Key): boolean {
		const present = this.get(key) !== undefined;
		this.writes.delete(key);
		this.deletions.add(key);
		return present;
	}

	*[Symbol.iterator](): IterableIterator<readonly [Key, Value]> {
		for (const entry of this.base) {
			if (!this.deletions.has(entry[0]) && !this.writes.has(entry[0])) yield entry;
		}
		yield* this.writes;
	}

	*values(): IterableIterator<Value> {
		for (const [, value] of this) yield value;
	}

	commit(): void {
		for (const key of this.deletions) this.base.delete(key);
		for (const [key, value] of this.writes) this.base.set(key, value);
	}
}

function draftState(source: ShadowState): ShadowState {
	return {
		templates: new DraftMap(source.templates as Map<string, number>),
		nextTemplateId: source.nextTemplateId,
		nextInstance: source.nextInstance,
		instances: new DraftMap(source.instances as Map<number, ShadowInstance>),
		hosts: new DraftMap(source.hosts as Map<number, ShadowHost>),
		order: new DraftMap(source.order as Map<number | null, Map<number, number[]>>),
		writableOrderSlots: new Map(),
	};
}

function commitDraft(target: ShadowState, draft: ShadowState): void {
	(draft.templates as DraftMap<string, number>).commit();
	(draft.instances as DraftMap<number, ShadowInstance>).commit();
	(draft.hosts as DraftMap<number, ShadowHost>).commit();
	(draft.order as DraftMap<number | null, Map<number, number[]>>).commit();
	target.nextTemplateId = draft.nextTemplateId;
	target.nextInstance = draft.nextInstance;
}

function writableSlots(state: ShadowState, parent: number | null): Map<number, number[]> {
	const draft = state.order as DraftMap<number | null, Map<number, number[]>>;
	if (draft.writes.has(parent)) return draft.writes.get(parent)!;
	const slots = new Map(state.order.get(parent));
	state.order.set(parent, slots);
	return slots;
}

function writableOrder(state: ShadowState, parent: number | null, slot: number): number[] {
	const slots = writableSlots(state, parent);
	let writableSlotsForParent = state.writableOrderSlots.get(parent);
	if (writableSlotsForParent?.has(slot) === true) return slots.get(slot)!;
	const order = slots.get(slot);
	const writable = order === undefined ? [] : [...order];
	slots.set(slot, writable);
	if (writableSlotsForParent === undefined) {
		writableSlotsForParent = new Set();
		state.writableOrderSlots.set(parent, writableSlotsForParent);
	}
	writableSlotsForParent.add(slot);
	return writable;
}

function writableInstance(state: ShadowState, firstId: number): ShadowInstance | undefined {
	const draft = state.instances as DraftMap<number, ShadowInstance>;
	if (draft.writes.has(firstId)) return draft.writes.get(firstId);
	const instance = state.instances.get(firstId);
	if (instance === undefined) return undefined;
	const writable = { ...instance, values: [...instance.values] };
	state.instances.set(firstId, writable);
	return writable;
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
			.map(({ firstId, handle, templateId, parent, parentSlot, values }) => ({
				firstId,
				handle,
				templateId,
				parent,
				parentSlot,
				values: [...values],
			})),
		order: [...state.order]
			.sort(([left], [right]) => (left ?? -1) - (right ?? -1))
			.flatMap(([parent, slots]) =>
				[...slots]
					.sort(([left], [right]) => left - right)
					.map(([slot, instances]) => ({
						parent,
						slot,
						// Reported as wire handles: physical order is what a delta applier
						// reconstructs, and it addresses instances, not command node ids.
						instances: instances.map((firstId) => state.instances.get(firstId)?.handle ?? -1),
					})),
			),
	};
}

function removeInstance(state: ShadowState, firstId: number): void {
	const instance = state.instances.get(firstId);
	if (instance === undefined) return;
	state.instances.delete(firstId);
	for (let index = 0; index < instance.program.nodes.length; index++) {
		state.hosts.delete(firstId + index);
	}
	const currentOrder = state.order.get(instance.parent)?.get(instance.parentSlot);
	if (currentOrder !== undefined) {
		const order = writableOrder(state, instance.parent, instance.parentSlot);
		order.splice(order.indexOf(firstId), 1);
	}
}

/**
 * Resolves a command-batch host id to the instance/slot pair the wire needs.
 *
 * A root command targets the distinguished container slot. Every nested command
 * must carry producer-local provenance from the plan slot that materialized its
 * physical roots. A parent host's physical node index is not interchangeable
 * with that compiler slot: one says where the parent lives, the other says which
 * of its open ranges owns the children.
 */
function siteOf(state: ShadowState, host: number | null, command: object): LynxSlotAddress | null {
	if (host === null) return { instance: ROOT_INSTANCE, slot: 0 };
	const slot = universalProgramRangeCommandSlot(command);
	if (slot === undefined || !Number.isSafeInteger(slot) || slot < 0) return null;
	const entry = state.hosts.get(host);
	if (entry === undefined) return null;
	const instance = state.instances.get(entry.firstId);
	if (instance === undefined) return null;
	return { instance: instance.handle, slot };
}

/**
 * Values reaching the wire must be scalars, because that restriction is what
 * makes the frame checkable by its header alone. A structured value is not a
 * shadow bug; it is a batch this ABI cannot yet carry, so it declines.
 */
function scalarValues(values: readonly unknown[]): LynxDeltaValue[] | null {
	const scalars: LynxDeltaValue[] = [];
	for (const value of values) {
		if (!isLynxDeltaValue(value)) return null;
		scalars.push(value);
	}
	return scalars;
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
 * ABI. It accepts only build-addressed programs whose semantics are fully
 * representable. A new address receives one page-local id and one DEFINE before
 * its first RUN; a miss is evidence for the next compiler/background-core
 * slice, never a lossy fallback.
 */
export function createLynxDeltaShadow(): LynxDeltaShadow {
	let state: ShadowState = {
		templates: new Map(),
		nextTemplateId: 1,
		nextInstance: ROOT_INSTANCE + 1,
		instances: new Map(),
		hosts: new Map(),
		order: new Map(),
		writableOrderSlots: new Map(),
	};

	return {
		prepare(batch) {
			const next = draftState(state);
			const templates: LynxDeltaTemplate[] = [];
			const operations: LynxDeltaOperation[] = [];
			const removedHosts = new Set<number>();
			for (const command of batch.commands) {
				if (command.op === 'mount-template-run') return null;
				if (command.op === 'mount-program-run') {
					if (command.parent !== null && typeof command.parent !== 'number') return null;
					// The shadow's whole job is to decline what it cannot express, so an
					// address it cannot resolve declines rather than throws: this runs
					// beside the real batch, and a throw here would fail a commit the
					// command path would have carried.
					const wire = producedRunProgram(command) as UniversalHostTemplateProgram | undefined;
					if (wire === undefined) return null;
					const stride = valueStride(wire);
					if (stride * command.count !== command.values.length) return null;
					const runValues = scalarValues(command.values);
					if (runValues === null) return null;
					const parentSite = siteOf(next, command.parent, command);
					if (parentSite === null) return null;
					const firstInstance = next.nextInstance;
					const templateKey = `${command.address.module}\u0000${command.address.index}`;
					let templateId = next.templates.get(templateKey);
					if (templateId === undefined) {
						templateId = next.nextTemplateId++;
						next.templates.set(templateKey, templateId);
						templates.push({ id: templateId, address: command.address });
					}
					const parent = command.parent;
					const order = writableOrder(next, parent, parentSite.slot);
					let beforeId: number | null = null;
					let beforeInstance: ShadowInstance | undefined;
					if (command.before !== null) {
						const before = next.hosts.get(command.before);
						if (before === undefined || before.nodeIndex !== 0) return null;
						beforeInstance = next.instances.get(before.firstId);
						if (
							beforeInstance === undefined ||
							beforeInstance.parent !== parent ||
							beforeInstance.parentSlot !== parentSite.slot
						) {
							return null;
						}
						beforeId = before.firstId;
					}
					const insertAt = beforeId === null ? order.length : order.indexOf(beforeId);
					if (insertAt < 0) return null;
					const instanceStride = command.stride ?? wire.nodes.length;
					for (let instanceIndex = 0; instanceIndex < command.count; instanceIndex++) {
						const firstId = command.firstId + instanceIndex * instanceStride;
						const values = command.values.slice(
							instanceIndex * stride,
							(instanceIndex + 1) * stride,
						);
						next.instances.set(firstId, {
							firstId,
							handle: next.nextInstance++,
							templateId,
							program: wire,
							parent,
							parentSlot: parentSite.slot,
							values,
						});
						for (let nodeIndex = 0; nodeIndex < wire.nodes.length; nodeIndex++) {
							next.hosts.set(firstId + nodeIndex, { firstId, nodeIndex });
						}
						order.splice(insertAt + instanceIndex, 0, firstId);
					}
					operations.push({
						op: 'run',
						templateId,
						parent: parentSite,
						before:
							beforeInstance === undefined ? null : { instance: beforeInstance.handle, slot: 0 },
						firstInstance,
						count: command.count,
						values: runValues,
					});
					continue;
				}
				if (command.op === 'update') {
					const host = next.hosts.get(command.id);
					const instance = host === undefined ? undefined : writableInstance(next, host.firstId);
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
						if (!isLynxDeltaValue(value)) return null;
						instance.values[binding.valueIndex] = value;
						operations.push({
							op: 'set',
							instance: instance.handle,
							slot: binding.valueIndex,
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
					const moveSite = siteOf(next, command.parent, command);
					if (moveSite === null) return null;
					if (instance.parent !== command.parent || instance.parentSlot !== moveSite.slot)
						return null;
					if (next.order.get(instance.parent)?.get(instance.parentSlot) === undefined) return null;
					const order = writableOrder(next, instance.parent, instance.parentSlot);
					order.splice(order.indexOf(instance.firstId), 1);
					const beforeId = before?.firstId ?? null;
					const anchored = beforeId === null ? undefined : next.instances.get(beforeId);
					if (
						anchored !== undefined &&
						(anchored.parent !== instance.parent || anchored.parentSlot !== instance.parentSlot)
					)
						return null;
					order.splice(
						beforeId === null ? order.length : order.indexOf(beforeId),
						0,
						instance.firstId,
					);
					const beforeInstance =
						beforeId === null ? null : (next.instances.get(beforeId)?.handle ?? null);
					if (beforeId !== null && beforeInstance === null) return null;
					operations.push({
						op: 'move',
						instance: instance.handle,
						parent: moveSite,
						// Anchors name the instance root, which is slot 0 by construction.
						before: beforeInstance === null ? null : { instance: beforeInstance, slot: 0 },
					});
					continue;
				}
				if (command.op === 'remove') {
					const host = next.hosts.get(command.id);
					if (host === undefined || host.nodeIndex !== 0) return null;
					const instance = next.instances.get(host.firstId)!;
					for (let index = 0; index < instance.program.nodes.length; index++) {
						removedHosts.add(instance.firstId + index);
					}
					operations.push({ op: 'remove', firstInstance: instance.handle, count: 1 });
					removeInstance(next, host.firstId);
					continue;
				}
				if (command.op === 'destroy-run') {
					if (
						(command.parent !== null && typeof command.parent !== 'number') ||
						!Number.isSafeInteger(command.firstId) ||
						!Number.isSafeInteger(command.count) ||
						!Number.isSafeInteger(command.width) ||
						command.firstId <= 0 ||
						command.count <= 0 ||
						command.width <= 0
					) {
						return null;
					}
					const finalId = command.firstId + (command.count - 1) * command.width;
					if (!Number.isSafeInteger(finalId)) return null;
					const first = next.instances.get(command.firstId);
					if (
						first === undefined ||
						first.parent !== command.parent ||
						first.program.nodes.length !== command.width
					) {
						return null;
					}
					for (let offset = 0; offset < command.count; offset++) {
						const instance = next.instances.get(command.firstId + offset * command.width);
						if (
							instance === undefined ||
							instance.handle !== first.handle + offset ||
							instance.parent !== first.parent ||
							instance.parentSlot !== first.parentSlot ||
							instance.templateId !== first.templateId ||
							instance.program !== first.program
						) {
							return null;
						}
					}
					operations.push({ op: 'remove', firstInstance: first.handle, count: command.count });
					for (let offset = 0; offset < command.count; offset++) {
						removeInstance(next, command.firstId + offset * command.width);
					}
					continue;
				}
				if (command.op === 'destroy' && removedHosts.has(command.id)) {
					continue;
				}
				return null;
			}
			const encoded = encodeLynxDeltaMessage(operations, templates);
			return {
				operations,
				encoded,
				commit() {
					commitDraft(state, next);
				},
				snapshot: () => snapshotState(next),
			};
		},
		snapshot: () => snapshotState(state),
	};
}
