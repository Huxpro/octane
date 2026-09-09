declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramCreate, UniversalProgramPlan } from 'octane/universal/native';

import type { LynxElementPAPI, LynxElementRef } from './papi.js';

type CompiledProgramCreate = UniversalProgramCreate & {
	readonly run: NonNullable<UniversalProgramCreate['run']>;
	readonly set?: (
		nodes: readonly unknown[],
		slot: number,
		value: unknown,
		offset?: number,
	) => boolean;
};

interface CompiledProgramRun<Node extends LynxElementRef> {
	readonly create: CompiledProgramCreate;
	readonly nodes: readonly Node[];
	readonly plan: UniversalProgramPlan;
	readonly values: unknown[];
}

interface CompiledProgramInstance<Node extends LynxElementRef> {
	readonly index: number;
	readonly parent: Node;
	readonly run: CompiledProgramRun<Node>;
	next: number | null;
	previous: number | null;
}

interface CompiledProgramRange {
	head: number | null;
	tail: number | null;
}

const enum JournalOpcode {
	Mount = 1,
	Set = 2,
	Remove = 3,
}

const MAX_INSTANCE_HANDLE = 2 ** 31 - 1;

export interface LynxCompiledProgramMount<Node extends LynxElementRef> {
	readonly before: Node | null;
	readonly count: number;
	readonly firstHandle: number;
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
	if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_INSTANCE_HANDLE) {
		fail('requires an in-range positive instance handle');
	}
}

function requireCount(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) fail('requires a positive instance count');
}

function isScalar(value: unknown): boolean {
	const type = typeof value;
	return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

function isSlotValue(plan: UniversalProgramPlan, slot: number, value: unknown): boolean {
	const kind = plan.slots[plan.values[slot]!];
	return kind === 'c'
		? typeof value === 'string'
		: kind?.startsWith('p:') === true && isScalar(value);
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
	const creates = new WeakMap<UniversalProgramPlan, CompiledProgramCreate>();
	const roots = new WeakMap<Node, number>();
	const ranges = new Map<Node, CompiledProgramRange>();
	let journal: unknown[] | null = null;
	let journalFirstHandle = 0;
	let lastHandle = 0;
	let faulted = false;
	let closing = false;

	const requireHealthy = (): void => {
		if (faulted) fail('is faulted after an incomplete host rollback');
		if (closing) fail('is closing or closed');
	};
	const requireJournal = (): unknown[] => {
		requireHealthy();
		if (journal === null) fail('requires begin() before host operations');
		return journal;
	};
	const rollbackFrame = (): void => {
		if (journal === null) fail('cannot roll back without an active frame');
		const active = journal;
		journal = null;
		const errors: unknown[] = [];
		while (active.length !== 0) {
			try {
				const opcode = active.pop();
				if (opcode === JournalOpcode.Mount) {
					const range = active.pop() as CompiledProgramRange;
					const count = active.pop() as number;
					const firstHandle = active.pop() as number;
					for (let index = count - 1; index >= 0; index--) {
						const handle = firstHandle + index;
						const instance = instances.get(handle)!;
						const root = instance.run.nodes[instance.index * instance.run.plan.nodes]!;
						cleanupRoot(papi, root);
						unlink(instance, range);
						instances.delete(handle);
						roots.delete(root);
					}
				} else if (opcode === JournalOpcode.Set) {
					const previous = active.pop();
					const slot = active.pop() as number;
					const handle = active.pop() as number;
					const instance = instances.get(handle)!;
					const run = instance.run;
					const valueIndex = instance.index * run.plan.values.length + slot;
					const set = run.create.set!;
					if (!set(run.nodes, slot, previous, instance.index * run.plan.nodes)) {
						fail(`setter refused rollback slot ${slot}`);
					}
					run.values[valueIndex] = previous;
				} else if (opcode === JournalOpcode.Remove) {
					const before = active.pop() as Node | null;
					const parent = active.pop() as Node;
					const range = active.pop() as CompiledProgramRange;
					const instance = active.pop() as CompiledProgramInstance<Node>;
					const handle = active.pop() as number;
					const root = instance.run.nodes[instance.index * instance.run.plan.nodes]!;
					papi.insertBefore(parent, root, before);
					instances.set(handle, instance);
					roots.set(root, handle);
					relink(handle, instance, range);
				} else {
					throw new Error('Compiled program journal contains an unknown operation.');
				}
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
	const unlink = (instance: CompiledProgramInstance<Node>, range: CompiledProgramRange): void => {
		if (instance.previous === null) range.head = instance.next;
		else instances.get(instance.previous)!.next = instance.next;
		if (instance.next === null) range.tail = instance.previous;
		else instances.get(instance.next)!.previous = instance.previous;
		if (range.head === null) ranges.delete(instance.parent);
	};
	const relink = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		range: CompiledProgramRange,
	): void => {
		if (!ranges.has(instance.parent)) ranges.set(instance.parent, range);
		if (instance.previous === null) range.head = handle;
		else instances.get(instance.previous)!.next = handle;
		if (instance.next === null) range.tail = handle;
		else instances.get(instance.next)!.previous = handle;
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
			requireHandle(input.firstHandle);
			requireCount(input.count);
			const finalHandle = input.firstHandle + input.count - 1;
			if (!Number.isSafeInteger(finalHandle) || finalHandle > MAX_INSTANCE_HANDLE) {
				fail('instance run exceeds the handle range');
			}
			if (input.firstHandle <= lastHandle) {
				fail(`cannot reuse instance handle ${input.firstHandle}`);
			}
			const plan = input.plan;
			if (
				plan.kind !== 'program' ||
				plan.nodes <= 0 ||
				plan.ranges.length !== 0 ||
				plan.events.length !== 0
			) {
				fail('requires a non-empty range- and event-free compiled program');
			}
			if (input.values.length !== plan.values.length * input.count) {
				fail('received the wrong value arity');
			}
			for (let index = 0; index < input.values.length; index++) {
				const slot = index % plan.values.length;
				if (!isSlotValue(plan, slot, input.values[index])) {
					fail(`received a value outside slot ${slot}'s scalar kind`);
				}
			}
			const range = ranges.get(input.parent) ?? { head: null, tail: null };
			let next: number | null = null;
			if (input.before !== null) {
				const beforeHandle = roots.get(input.before);
				if (beforeHandle === undefined) fail('received an anchor outside the target range');
				const anchor = instances.get(beforeHandle);
				if (anchor === undefined || !papi.isEqual(anchor.parent, input.parent)) {
					fail('received an anchor outside the target range');
				}
				next = beforeHandle;
			}
			const previous = next === null ? range.tail : instances.get(next)!.previous;

			let create = creates.get(plan);
			if (create === undefined) {
				const candidate = plan.bind(papi) as CompiledProgramCreate;
				if (typeof candidate.run !== 'function') fail('requires an emitted dense-run driver');
				if (plan.values.length !== 0 && typeof candidate.set !== 'function') {
					fail('requires an emitted value-slot setter');
				}
				create = candidate;
				creates.set(plan, create);
			}
			const nodes = new Array<Node>(plan.nodes * input.count);
			try {
				create.run(pageId, input.count, input.values, [], [], nodes);
				for (let index = 0; index < input.count; index++) {
					const node = nodes[index * plan.nodes];
					if (node === null || typeof node !== 'object') fail(`did not publish root ${index}`);
					papi.insertBefore(input.parent, node, input.before);
				}
			} catch (error) {
				const cleanupErrors: unknown[] = [];
				for (let index = input.count - 1; index >= 0; index--) {
					try {
						cleanupRoot(papi, nodes[index * plan.nodes]);
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
				}
				if (cleanupErrors.length !== 0) {
					faulted = true;
					throw new AggregateError(
						[error, ...cleanupErrors],
						'Compiled program mount cleanup failed.',
					);
				}
				throw error;
			}
			const run: CompiledProgramRun<Node> = {
				create,
				nodes,
				plan,
				values: [...input.values],
			};
			let runPrevious = previous;
			for (let index = 0; index < input.count; index++) {
				const handle = input.firstHandle + index;
				const nodeOffset = index * plan.nodes;
				const instance: CompiledProgramInstance<Node> = {
					index,
					parent: input.parent,
					previous: runPrevious,
					next,
					run,
				};
				instances.set(handle, instance);
				roots.set(nodes[nodeOffset]!, handle);
				relink(handle, instance, range);
				runPrevious = handle;
			}
			lastHandle = finalHandle;
			undo.push(input.firstHandle, input.count, range, JournalOpcode.Mount);
		},
		set(handle, slot, value) {
			const undo = requireJournal();
			requireHandle(handle);
			if (!Number.isSafeInteger(slot) || slot < 0) fail('requires a non-negative value slot');
			const instance = instances.get(handle);
			if (instance === undefined) fail(`does not hold instance ${handle}`);
			const run = instance.run;
			if (slot >= run.plan.values.length) fail(`does not hold value slot ${slot}`);
			if (!isSlotValue(run.plan, slot, value)) {
				fail(`received a value outside slot ${slot}'s scalar kind`);
			}
			const valueIndex = instance.index * run.plan.values.length + slot;
			const previous = run.values[valueIndex];
			if (Object.is(previous, value)) return false;
			const set = run.create.set;
			if (set === undefined) fail('does not have an emitted value-slot setter');
			const nodeOffset = instance.index * run.plan.nodes;
			try {
				if (!set(run.nodes, slot, value, nodeOffset)) fail(`setter refused value slot ${slot}`);
			} catch (error) {
				try {
					if (!set(run.nodes, slot, previous, nodeOffset)) {
						fail(`setter refused rollback slot ${slot}`);
					}
				} catch (rollbackError) {
					faulted = true;
					throw new AggregateError(
						[error, rollbackError],
						'Compiled program slot rollback failed.',
					);
				}
				throw error;
			}
			run.values[valueIndex] = value;
			undo.push(handle, slot, previous, JournalOpcode.Set);
			return true;
		},
		remove(handle) {
			const undo = requireJournal();
			requireHandle(handle);
			const instance = instances.get(handle);
			if (instance === undefined) fail(`does not hold instance ${handle}`);
			const root = instance.run.nodes[instance.index * instance.run.plan.nodes]!;
			const parent = papi.getParent(root);
			if (parent === null || !papi.isEqual(parent, instance.parent))
				fail('found a detached instance');
			const range = ranges.get(instance.parent);
			if (range === undefined) fail('lost the instance range order');
			const nextInstance = instance.next === null ? undefined : instances.get(instance.next)!;
			const before =
				nextInstance === undefined
					? null
					: nextInstance.run.nodes[nextInstance.index * nextInstance.run.plan.nodes]!;
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
			unlink(instance, range);
			instances.delete(handle);
			roots.delete(root);
			undo.push(handle, instance, range, parent, before, JournalOpcode.Remove);
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
					const root = instance.run.nodes[instance.index * instance.run.plan.nodes]!;
					cleanupRoot(papi, root);
					instances.delete(handle);
					roots.delete(root);
				} catch (error) {
					errors.push(error);
				}
			}
			ranges.clear();
			if (errors.length !== 0)
				throw new AggregateError(errors, 'Compiled program disposal failed.');
		},
	};
}
