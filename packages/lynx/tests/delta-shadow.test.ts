import { describe, expect, it } from 'vitest';
import type { UniversalHostBatch, UniversalHostTemplateProgram } from 'octane/universal/native';
import { decodeLynxDeltaMessage, type LynxDeltaOperation } from '../src/core/delta-protocol.js';
import { createLynxDeltaShadow, type LynxDeltaShadowSnapshot } from '../src/core/delta-shadow.js';

const PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'view',
			parent: -1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'class', valueIndex: 0 })]),
		}),
		Object.freeze({
			type: '#text',
			parent: 0,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
	]),
	events: Object.freeze([]),
});

const batch = (version: number, commands: UniversalHostBatch['commands']): UniversalHostBatch => ({
	renderer: 'lynx',
	version,
	commands,
});

// An independent applier that knows nothing about command batches: it addresses
// instances by the handles the wire carries, which is exactly the property the
// instance-qualified opcode set exists to provide.
interface AppliedDeltaState {
	readonly values: Map<number, unknown[]>;
	readonly order: number[];
}

function applyDelta(state: AppliedDeltaState, operations: readonly LynxDeltaOperation[]): void {
	for (const operation of operations) {
		if (operation.op === 'run') {
			const stride = operation.values.length / operation.count;
			for (let index = 0; index < operation.count; index++) {
				const instance = operation.firstInstance + index;
				state.values.set(instance, operation.values.slice(index * stride, (index + 1) * stride));
				const at =
					operation.before === null
						? state.order.length
						: state.order.indexOf(operation.before.instance);
				state.order.splice(at + index, 0, instance);
			}
		} else if (operation.op === 'set') {
			state.values.get(operation.instance)![operation.slot] = operation.value;
		} else if (operation.op === 'move') {
			state.order.splice(state.order.indexOf(operation.instance), 1);
			state.order.splice(
				operation.before === null
					? state.order.length
					: state.order.indexOf(operation.before.instance),
				0,
				operation.instance,
			);
		} else if (operation.op === 'remove') {
			for (let index = 0; index < operation.count; index++) {
				const instance = operation.firstInstance + index;
				state.values.delete(instance);
				state.order.splice(state.order.indexOf(instance), 1);
			}
		}
	}
}

/** The wire-visible projection both sides must agree on. */
function projection(state: AppliedDeltaState): {
	instances: readonly (readonly [number, readonly unknown[]])[];
	order: readonly number[];
} {
	return {
		instances: [...state.values]
			.sort(([left], [right]) => left - right)
			.map(([instance, values]) => [instance, [...values]] as const),
		order: [...state.order],
	};
}

function shadowProjection(snapshot: LynxDeltaShadowSnapshot): ReturnType<typeof projection> {
	return {
		instances: [...snapshot.instances]
			.sort((left, right) => left.handle - right.handle)
			.map((instance) => [instance.handle, [...instance.values]] as const),
		order: snapshot.order.flatMap((entry) => entry.instances),
	};
}

describe('Lynx delta shadow', () => {
	it('applies RUN, SET, MOVE, and REMOVE equivalently across real command commits', () => {
		const shadow = createLynxDeltaShadow();
		const applied: AppliedDeltaState = { values: new Map(), order: [] };
		const commits = [
			batch(1, [
				{
					op: 'mount-template-run',
					parent: null,
					before: null,
					program: PROGRAM,
					firstId: 10,
					firstListenerId: null,
					count: 2,
					values: ['row', 'A', 'row', 'B'],
				},
			]),
			batch(2, [
				{ op: 'update', id: 11, props: { value: 'A!' } },
				{ op: 'update', id: 12, props: { class: 'row danger' } },
			]),
			batch(3, [{ op: 'move', parent: null, id: 12, before: 10 }]),
			batch(4, [
				{ op: 'remove', parent: null, id: 10 },
				{ op: 'destroy', id: 10 },
				{ op: 'destroy', id: 11 },
			]),
		];

		for (const commit of commits) {
			const prepared = shadow.prepare(commit);
			expect(prepared).not.toBeNull();
			applyDelta(applied, decodeLynxDeltaMessage(prepared!.encoded).operations);
			prepared!.commit();
			expect(shadowProjection(shadow.snapshot())).toEqual(projection(applied));
		}
	});

	it('does not mutate its accepted state when a command batch is not representable', () => {
		const shadow = createLynxDeltaShadow();
		const initial = shadow.snapshot();
		expect(shadow.prepare(batch(1, [{ op: 'create', id: 1, type: 'view', props: {} }]))).toBeNull();
		expect(
			shadow.prepare(
				batch(2, [
					{ op: 'event', id: 1, type: 'bindtap', listener: { id: 1, priority: 'discrete' } },
				]),
			),
		).toBeNull();
		expect(shadow.prepare(batch(3, [{ op: 'destroy', id: 99 }]))).toBeNull();
		expect(shadow.snapshot()).toEqual(initial);
	});

	it('declines a value the header-only frame cannot carry', () => {
		const shadow = createLynxDeltaShadow();
		// A structured value would have to be walked to be validated, which is
		// the recursive cost this ABI exists to remove. Declining is the signal
		// that a compiler or background slice still owes a scalar here.
		expect(
			shadow.prepare(
				batch(1, [
					{
						op: 'mount-template-run',
						parent: null,
						before: null,
						program: PROGRAM,
						firstId: 10,
						firstListenerId: null,
						count: 1,
						values: ['row', { toString: () => 'A' }],
					},
				]),
			),
		).toBeNull();
	});

	it('addresses every operation by instance, never by a bare slot', () => {
		const shadow = createLynxDeltaShadow();
		const mounted = shadow.prepare(
			batch(1, [
				{
					op: 'mount-template-run',
					parent: null,
					before: null,
					program: PROGRAM,
					firstId: 10,
					firstListenerId: null,
					count: 2,
					values: ['row', 'A', 'row', 'B'],
				},
			]),
		);
		const run = decodeLynxDeltaMessage(mounted!.encoded).operations[0];
		expect(run?.op).toBe('run');
		// Two instances from one RUN: the handles are dense and allocated by the
		// emitter, so the applier can name each one without a reply.
		expect(run?.op === 'run' ? run.firstInstance : null).toBeGreaterThan(0);
		expect(run?.op === 'run' ? run.count : null).toBe(2);
		expect(run?.op === 'run' ? run.parent.instance : null).toBeGreaterThan(0);
		mounted!.commit();

		const updated = shadow.prepare(batch(2, [{ op: 'update', id: 12, props: { class: 'hot' } }]));
		const set = decodeLynxDeltaMessage(updated!.encoded).operations[0];
		expect(set?.op).toBe('set');
		// The second instance, not the first: a bare slot index could not say so.
		const firstHandle = run?.op === 'run' ? run.firstInstance : 0;
		expect(set?.op === 'set' ? set.instance : null).toBe(firstHandle + 1);
	});

	it('declines a prop change outside the compiler slot table', () => {
		const shadow = createLynxDeltaShadow();
		const mounted = shadow.prepare(
			batch(1, [
				{
					op: 'mount-template-run',
					parent: null,
					before: null,
					program: PROGRAM,
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: ['row', 'A'],
				},
			]),
		);
		mounted!.commit();
		expect(
			shadow.prepare(batch(2, [{ op: 'update', id: 10, props: { class: 'row', id: 'new' } }])),
		).toBeNull();
	});
});
