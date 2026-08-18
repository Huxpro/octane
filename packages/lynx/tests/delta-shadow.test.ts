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

interface AppliedDeltaState {
	readonly values: Map<number, unknown[]>;
	readonly order: number[];
}

function applyDelta(state: AppliedDeltaState, operations: readonly LynxDeltaOperation[]): void {
	for (const operation of operations) {
		if (operation.op === 'run') {
			const stride = operation.values.length / operation.count;
			for (let index = 0; index < operation.count; index++) {
				const firstId = 10 + index * PROGRAM.nodes.length;
				state.values.set(firstId, operation.values.slice(index * stride, (index + 1) * stride));
				state.order.push(firstId);
			}
		} else if (operation.op === 'set') {
			state.values.get(operation.instance)![operation.slotIndex] = operation.value;
		} else if (operation.op === 'move') {
			state.order.splice(state.order.indexOf(operation.instance), 1);
			state.order.splice(
				operation.before === null ? state.order.length : state.order.indexOf(operation.before),
				0,
				operation.instance,
			);
		} else if (operation.op === 'remove' && operation.target.kind === 'instance') {
			state.values.delete(operation.target.instance);
			state.order.splice(state.order.indexOf(operation.target.instance), 1);
		}
	}
}

function deltaSnapshot(state: AppliedDeltaState): LynxDeltaShadowSnapshot {
	return {
		instances: [...state.values]
			.sort(([left], [right]) => left - right)
			.map(([firstId, values]) => ({ firstId, templateId: 1, parent: null, values })),
		order: [{ parent: null, instances: [...state.order] }],
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
			expect(shadow.snapshot()).toEqual(deltaSnapshot(applied));
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
