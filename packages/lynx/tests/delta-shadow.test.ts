import { describe, expect, it } from 'vitest';
import {
	recordUniversalProgramCommand,
	recordUniversalProgramRangeCommand,
	universalProgramRangeCommandSlot,
	type UniversalHostBatch,
	type UniversalHostCommand,
	type UniversalHostTemplateProgram,
} from 'octane/universal/native';
import { decodeLynxDeltaMessage, type LynxDeltaOperation } from '../src/core/delta-protocol.js';
import { createLynxDeltaShadow, type LynxDeltaShadowSnapshot } from '../src/core/delta-shadow.js';
import { promoteProducedProgramManifest } from '../src/core/run-program.js';

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

const PROGRAM_ADDRESS = Object.freeze({ module: 'tests/DeltaShadowRow.lynx.tsrx', index: 0 });

function addressedRun(
	command: Omit<Extract<UniversalHostCommand, { op: 'mount-program-run' }>, 'op' | 'address'>,
): Extract<UniversalHostCommand, { op: 'mount-program-run' }> {
	const addressed = { ...command, op: 'mount-program-run' as const, address: PROGRAM_ADDRESS };
	recordUniversalProgramCommand(addressed, PROGRAM);
	return addressed;
}

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
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 2,
					values: ['row', 'A', 'row', 'B'],
				}),
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
		expect(
			shadow.prepare(
				batch(4, [
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
			),
		).toBeNull();
		expect(shadow.snapshot()).toEqual(initial);
	});

	it('defines each resident address once and re-announces it after an aborted preparation', () => {
		const shadow = createLynxDeltaShadow();
		const first = shadow.prepare(
			batch(1, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: ['row', 'A'],
				}),
			]),
		)!;
		expect(decodeLynxDeltaMessage(first.encoded).templates).toEqual([
			{ id: 1, address: PROGRAM_ADDRESS },
		]);

		const retry = shadow.prepare(
			batch(1, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: ['row', 'A'],
				}),
			]),
		)!;
		expect(decodeLynxDeltaMessage(retry.encoded).templates).toEqual([
			{ id: 1, address: PROGRAM_ADDRESS },
		]);
		retry.commit();

		const next = shadow.prepare(
			batch(2, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 20,
					firstListenerId: null,
					count: 1,
					values: ['row', 'B'],
				}),
			]),
		)!;
		expect(decodeLynxDeltaMessage(next.encoded).templates).toEqual([]);
	});

	it('declines a value the header-only frame cannot carry', () => {
		const shadow = createLynxDeltaShadow();
		// A structured value would have to be walked to be validated, which is
		// the recursive cost this ABI exists to remove. Declining is the signal
		// that a compiler or background slice still owes a scalar here.
		expect(
			shadow.prepare(
				batch(1, [
					addressedRun({
						parent: null,
						before: null,
						firstId: 10,
						firstListenerId: null,
						count: 1,
						values: ['row', { toString: () => 'A' }],
					}),
				]),
			),
		).toBeNull();
	});

	it('addresses every operation by instance, never by a bare slot', () => {
		const shadow = createLynxDeltaShadow();
		const mounted = shadow.prepare(
			batch(1, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 2,
					values: ['row', 'A', 'row', 'B'],
				}),
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

	it('uses the producing compiler range slot for nested runs and moves', () => {
		const shadow = createLynxDeltaShadow();
		const parent = shadow.prepare(
			batch(1, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: ['parent', 'P'],
				}),
			]),
		);
		parent!.commit();

		const nested = addressedRun({
			parent: 10,
			before: null,
			firstId: 20,
			firstListenerId: null,
			count: 2,
			values: ['child', 'A', 'child', 'B'],
		});
		// A host ID proves only the parent instance and physical node. Without the
		// plan slot that owns this placement the shadow must not guess a range.
		expect(shadow.prepare(batch(2, [nested]))).toBeNull();
		recordUniversalProgramRangeCommand(nested, 7);
		const mounted = shadow.prepare(batch(2, [nested]));
		const run = decodeLynxDeltaMessage(mounted!.encoded).operations[0];
		expect(run).toMatchObject({
			op: 'run',
			parent: { instance: 2, slot: 7 },
			count: 2,
		});
		mounted!.commit();

		const otherRange = addressedRun({
			parent: 10,
			before: null,
			firstId: 30,
			firstListenerId: null,
			count: 1,
			values: ['other', 'C'],
		});
		recordUniversalProgramRangeCommand(otherRange, 9);
		shadow.prepare(batch(3, [otherRange]))!.commit();

		const inserted = addressedRun({
			parent: 10,
			before: 20,
			firstId: 40,
			firstListenerId: null,
			count: 1,
			values: ['child', 'Before A'],
		});
		recordUniversalProgramRangeCommand(inserted, 7);
		const insertion = shadow.prepare(batch(4, [inserted]));
		expect(decodeLynxDeltaMessage(insertion!.encoded).operations[0]).toMatchObject({
			op: 'run',
			parent: { instance: 2, slot: 7 },
			before: { instance: 3, slot: 0 },
		});
		insertion!.commit();

		const crossed = { ...inserted, firstId: 50, before: 30 };
		recordUniversalProgramRangeCommand(crossed, 7);
		expect(shadow.prepare(batch(5, [crossed]))).toBeNull();
		expect(shadow.snapshot().order.filter((entry) => entry.parent === 10)).toEqual([
			{ parent: 10, slot: 7, instances: [6, 3, 4] },
			{ parent: 10, slot: 9, instances: [5] },
		]);

		const move = { op: 'move' as const, parent: 10, id: 22, before: 20 };
		expect(shadow.prepare(batch(6, [move]))).toBeNull();
		recordUniversalProgramRangeCommand(move, 7);
		const moved = shadow.prepare(batch(6, [move]));
		expect(decodeLynxDeltaMessage(moved!.encoded).operations[0]).toMatchObject({
			op: 'move',
			instance: 4,
			parent: { instance: 2, slot: 7 },
			before: { instance: 3, slot: 0 },
		});
	});

	it('preserves range provenance when an expanded first-screen manifest is promoted', () => {
		const manifest = Object.freeze({
			op: 'program-manifest' as const,
			parent: 10,
			before: null,
			address: Object.freeze({ module: 'tests/row.tsrx', index: 0 }),
			firstId: 20,
			stride: 2,
			firstListenerId: null,
			count: 1,
			values: Object.freeze(['child', 'A']),
		});
		recordUniversalProgramCommand(manifest, PROGRAM);
		recordUniversalProgramRangeCommand(manifest, 7);
		const promoted = promoteProducedProgramManifest(manifest);
		expect(promoted).not.toBeNull();
		expect(universalProgramRangeCommandSlot(promoted!.command)).toBe(7);
	});

	it('declines a prop change outside the compiler slot table', () => {
		const shadow = createLynxDeltaShadow();
		const mounted = shadow.prepare(
			batch(1, [
				addressedRun({
					parent: null,
					before: null,
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: ['row', 'A'],
				}),
			]),
		);
		mounted!.commit();
		expect(
			shadow.prepare(batch(2, [{ op: 'update', id: 10, props: { class: 'row', id: 'new' } }])),
		).toBeNull();
	});
});
