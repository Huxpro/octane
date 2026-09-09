declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramCreate, UniversalProgramPlan } from 'octane/universal/native';

import type { LynxElementPAPI, LynxElementRef } from './papi.js';

type CompiledProgramCreate = UniversalProgramCreate & {
	readonly set?: (nodes: readonly unknown[], slot: number, value: unknown) => boolean;
};

interface CompiledProgramInstance<Node extends LynxElementRef> {
	readonly create: CompiledProgramCreate;
	readonly nodes: readonly Node[];
	readonly parent: Node;
	readonly plan: UniversalProgramPlan;
	readonly values: unknown[];
}

export interface LynxCompiledProgramMount<Node extends LynxElementRef> {
	readonly before: Node | null;
	readonly events?: readonly unknown[];
	readonly handle: number;
	readonly parent: Node;
	readonly plan: UniversalProgramPlan;
	readonly values: readonly unknown[];
}

export interface LynxCompiledProgramStore<Node extends LynxElementRef = LynxElementRef> {
	begin(): void;
	commit(): void;
	rollback(): void;
	mount(input: LynxCompiledProgramMount<Node>): void;
	remove(handle: number): void;
	set(handle: number, slot: number, value: unknown): boolean;
	size(): number;
	dispose(): void;
}

function fail(message: string): never {
	throw new TypeError(
		typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
			? `Octane Lynx compact program store ${message}.`
			: 'Octane Lynx OL484',
	);
}

function requireHandle(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) fail('requires a positive instance handle');
}

function isScalar(value: unknown): boolean {
	const type = typeof value;
	return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

function cleanupRoot<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	root: Node | undefined,
): void {
	if (root === undefined) return;
	const parent = papi.getParent(root);
	if (parent !== null) papi.remove(parent, root);
}

/**
 * Retain the minimum state a compiled, range-free main-thread program needs.
 *
 * This is intentionally not the product receiver yet. It owns the state and
 * fault boundary that receiver will call after a compact frame has resolved a
 * resident program: emitted code creates and updates hosts, while this store
 * alone publishes instance identity, remembers prior slot values for rollback,
 * and restores a remove even when the host mutates before it throws. A frame
 * publishes only at `commit()`; `rollback()` replays every accepted mutation in
 * reverse order so the background can retry the same handles after rejection.
 */
export function createLynxCompiledProgramStore<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	pageId: unknown,
): LynxCompiledProgramStore<Node> {
	const instances = new Map<number, CompiledProgramInstance<Node>>();
	const roots = new WeakMap<Node, number>();
	const order = new Map<Node, number[]>();
	let journal: (() => void)[] | null = null;
	let journalFirstHandle = 0;
	let lastHandle = 0;
	let faulted = false;
	let closing = false;

	const requireHealthy = (): void => {
		if (faulted) fail('is faulted after an incomplete host rollback');
		if (closing) fail('is closing or closed');
	};
	const requireJournal = (): (() => void)[] => {
		requireHealthy();
		if (journal === null) fail('requires begin() before host operations');
		return journal;
	};
	const rollbackFrame = (): void => {
		if (journal === null) fail('cannot roll back without an active frame');
		const active = journal;
		journal = null;
		const errors: unknown[] = [];
		for (let index = active.length - 1; index >= 0; index--) {
			try {
				active[index]!();
			} catch (error) {
				errors.push(error);
			}
		}
		lastHandle = journalFirstHandle;
		if (errors.length !== 0) {
			faulted = true;
			throw new AggregateError(errors, 'Compiled program frame rollback failed.');
		}
	};

	return {
		begin() {
			requireHealthy();
			if (journal !== null) fail('cannot begin a nested frame');
			journal = [];
			journalFirstHandle = lastHandle;
		},
		commit() {
			requireHealthy();
			if (journal === null) fail('cannot commit without an active frame');
			journal = null;
		},
		rollback() {
			rollbackFrame();
		},
		mount(input) {
			const undo = requireJournal();
			requireHandle(input.handle);
			if (input.handle <= lastHandle) fail(`cannot reuse instance handle ${input.handle}`);
			const plan = input.plan;
			if (plan.kind !== 'program' || plan.nodes <= 0 || plan.ranges.length !== 0) {
				fail('requires a non-empty range-free compiled program');
			}
			if (input.values.length !== plan.values.length) fail('received the wrong value arity');
			const events = input.events ?? [];
			if (events.length !== plan.events.length) fail('received the wrong event arity');
			const siblings = order.get(input.parent) ?? [];
			let position = siblings.length;
			if (input.before !== null) {
				const beforeHandle = roots.get(input.before);
				position = beforeHandle === undefined ? -1 : siblings.indexOf(beforeHandle);
				if (position < 0) fail('received an anchor outside the target range');
			}

			const create = plan.bind(papi) as CompiledProgramCreate;
			if (typeof create.run !== 'function') fail('requires an emitted dense-run driver');
			if (plan.values.length !== 0 && typeof create.set !== 'function') {
				fail('requires an emitted value-slot setter');
			}
			const nodes = new Array<Node>(plan.nodes);
			try {
				create.run(pageId, 1, input.values, events, [], nodes);
				for (let index = 0; index < nodes.length; index++) {
					const node = nodes[index];
					if (node === null || typeof node !== 'object') fail(`did not publish node ${index}`);
				}
				papi.insertBefore(input.parent, nodes[0]!, input.before);
			} catch (error) {
				try {
					cleanupRoot(papi, nodes[0]);
				} catch (cleanupError) {
					faulted = true;
					throw new AggregateError([error, cleanupError], 'Compiled program mount cleanup failed.');
				}
				throw error;
			}
			instances.set(input.handle, {
				create,
				nodes,
				parent: input.parent,
				plan,
				values: [...input.values],
			});
			lastHandle = input.handle;
			roots.set(nodes[0]!, input.handle);
			if (!order.has(input.parent)) order.set(input.parent, siblings);
			siblings.splice(position, 0, input.handle);
			undo.push(() => {
				cleanupRoot(papi, nodes[0]);
				instances.delete(input.handle);
				roots.delete(nodes[0]!);
				const index = siblings.indexOf(input.handle);
				if (index >= 0) siblings.splice(index, 1);
				if (siblings.length === 0) order.delete(input.parent);
			});
		},
		set(handle, slot, value) {
			const undo = requireJournal();
			requireHandle(handle);
			if (!Number.isSafeInteger(slot) || slot < 0) fail('requires a non-negative value slot');
			const instance = instances.get(handle);
			if (instance === undefined) fail(`does not hold instance ${handle}`);
			if (slot >= instance.plan.values.length) fail(`does not hold value slot ${slot}`);
			const planSlot = instance.plan.values[slot]!;
			const kind = instance.plan.slots[planSlot];
			if (
				kind === 'c'
					? typeof value !== 'string'
					: kind?.startsWith('p:') !== true || !isScalar(value)
			) {
				fail(`received a value outside slot ${slot}'s scalar kind`);
			}
			const previous = instance.values[slot];
			if (Object.is(previous, value)) return false;
			const set = instance.create.set;
			if (set === undefined) fail('does not have an emitted value-slot setter');
			try {
				if (!set(instance.nodes, slot, value)) fail(`setter refused value slot ${slot}`);
			} catch (error) {
				try {
					if (!set(instance.nodes, slot, previous)) fail(`setter refused rollback slot ${slot}`);
				} catch (rollbackError) {
					faulted = true;
					throw new AggregateError(
						[error, rollbackError],
						'Compiled program slot rollback failed.',
					);
				}
				throw error;
			}
			instance.values[slot] = value;
			undo.push(() => {
				if (!set(instance.nodes, slot, previous)) fail(`setter refused rollback slot ${slot}`);
				instance.values[slot] = previous;
			});
			return true;
		},
		remove(handle) {
			const undo = requireJournal();
			requireHandle(handle);
			const instance = instances.get(handle);
			if (instance === undefined) fail(`does not hold instance ${handle}`);
			const root = instance.nodes[0]!;
			const parent = papi.getParent(root);
			if (parent === null || !papi.isEqual(parent, instance.parent))
				fail('found a detached instance');
			const siblings = order.get(instance.parent);
			const position = siblings?.indexOf(handle) ?? -1;
			if (siblings === undefined || position < 0) fail('lost the instance range order');
			const beforeHandle = siblings[position + 1];
			const before = beforeHandle === undefined ? null : instances.get(beforeHandle)!.nodes[0]!;
			try {
				papi.remove(parent, root);
			} catch (error) {
				if (!papi.isChild(parent, root)) {
					try {
						papi.insertBefore(parent, root, before);
					} catch (rollbackError) {
						faulted = true;
						throw new AggregateError(
							[error, rollbackError],
							'Compiled program remove rollback failed.',
						);
					}
				}
				throw error;
			}
			instances.delete(handle);
			roots.delete(root);
			siblings.splice(position, 1);
			if (siblings.length === 0) order.delete(instance.parent);
			undo.push(() => {
				papi.insertBefore(parent, root, before);
				instances.set(handle, instance);
				roots.set(root, handle);
				const restored = order.get(instance.parent) ?? siblings;
				if (!order.has(instance.parent)) order.set(instance.parent, restored);
				restored.splice(position, 0, handle);
			});
		},
		size() {
			return instances.size;
		},
		dispose() {
			const errors: unknown[] = [];
			closing = true;
			if (journal !== null) {
				try {
					rollbackFrame();
				} catch (error) {
					errors.push(error);
				}
			}
			for (const [handle, instance] of instances) {
				try {
					cleanupRoot(papi, instance.nodes[0]);
					instances.delete(handle);
					roots.delete(instance.nodes[0]!);
				} catch (error) {
					errors.push(error);
				}
			}
			order.clear();
			if (errors.length !== 0)
				throw new AggregateError(errors, 'Compiled program disposal failed.');
		},
	};
}
