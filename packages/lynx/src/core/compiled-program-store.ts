declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramCreate, UniversalProgramPlan } from 'octane/universal/native';

import { encodePrevalidatedLynxNativeEventToken } from './native-events.js';
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
	readonly listener: number;
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
	visible: boolean;
}

interface CompiledProgramRange {
	head: number | null;
	tail: number | null;
}

const enum JournalOpcode {
	Mount = 1,
	Set = 2,
	Remove = 3,
	Move = 4,
	Visibility = 5,
	Adopt = 6,
}

const MAX_INSTANCE_HANDLE = 2 ** 31 - 1;
const LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const LYNX_COMPILED_PROGRAM_STORE_ERROR = 'Octane Lynx OL484';

export interface LynxCompiledProgramMount<Node extends LynxElementRef> {
	readonly before: number | null;
	readonly count: number;
	readonly firstHandle: number;
	readonly parent: Node;
	readonly plan: UniversalProgramPlan;
	/** Offset of this run's contiguous value segment inside `values`. */
	readonly valueOffset?: number;
	readonly values: readonly unknown[];
}

export interface LynxCompiledProgramAdoption<
	Node extends LynxElementRef,
> extends LynxCompiledProgramMount<Node> {
	readonly before: null;
	/** Existing first-screen host id of the first program root. */
	readonly firstId: number;
	/** Listener identity already installed by the accepted first screen. */
	readonly firstListenerId: number | null;
	/** Existing program nodes in member-major order; ownership transfers on commit. */
	readonly nodes: readonly Node[];
	/** Logical host-id distance between consecutive first-screen instances. */
	readonly stride: number;
}

export interface LynxCompiledProgramStore<Node extends LynxElementRef = LynxElementRef> {
	begin(): void;
	commit(): void;
	rollback(): void;
	define(template: number, plan: UniversalProgramPlan): boolean;
	resolve(template: number): UniversalProgramPlan | undefined;
	adopt(input: LynxCompiledProgramAdoption<Node>): void;
	mount(input: LynxCompiledProgramMount<Node>): void;
	clear(parent: Node): void;
	move(handle: number, before: number | null): boolean;
	remove(handle: number): void;
	set(handle: number, slot: number, value: unknown): boolean;
	visibility(handle: number, visible: boolean): boolean;
	size(): number;
	dispose(): void;
}

function fail(message: string | false): never {
	throw new TypeError(
		LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT
			? `Octane Lynx compact program store ${message}.`
			: LYNX_COMPILED_PROGRAM_STORE_ERROR,
	);
}

function failAggregate(errors: unknown[], message: string | false): never {
	throw new AggregateError(
		errors,
		LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && message
			? message
			: LYNX_COMPILED_PROGRAM_STORE_ERROR,
	);
}

function requireHandle(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_INSTANCE_HANDLE) {
		fail(
			LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires an in-range positive instance handle',
		);
	}
}

function requireCount(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires a positive instance count');
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
 * alone publishes template and instance identity, remembers prior slot values
 * for rollback, and restores a remove even when the host mutates before it
 * throws. A frame publishes only at `commit()`; `rollback()` replays every
 * accepted mutation in reverse order and drops its new template suffix so the
 * background can retry the exact definitions and handles after rejection.
 */
export function createLynxCompiledProgramStore<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	pageId: unknown,
	root = pageId,
	firstListener = 1,
): LynxCompiledProgramStore<Node> {
	const instances = new Map<number, CompiledProgramInstance<Node>>();
	const creates = new WeakMap<UniversalProgramPlan, CompiledProgramCreate>();
	const templates: (UniversalProgramPlan | undefined)[] = [undefined];
	const ranges = new Map<Node, CompiledProgramRange>();
	let journal: unknown[] | null = null;
	let journalFirstHandle = 0;
	let lastHandle = 0;
	// The Block producer reserves one listener id for every compiled event site,
	// bound handler or not. Its v2 RUN therefore needs no event payload: both
	// threads advance this cursor over the same resident plan and run count.
	let journalFirstListener = 0;
	let journalFirstTemplates = 1;
	let nextListener = firstListener;
	let faulted = false;
	let closing = false;

	const requireHealthy = (): void => {
		if (faulted)
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'is faulted after an incomplete host rollback',
			);
		if (closing) fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'is closing or closed');
	};
	const requireJournal = (): unknown[] => {
		requireHealthy();
		if (journal === null)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires begin() before host operations');
		return journal;
	};
	const rootOf = (instance: CompiledProgramInstance<Node>): Node =>
		instance.run.nodes[instance.index * instance.run.plan.nodes]!;
	const requireInstance = (handle: number): CompiledProgramInstance<Node> => {
		requireHandle(handle);
		const instance = instances.get(handle);
		if (instance === undefined)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `does not hold instance ${handle}`);
		return instance;
	};
	const rollbackFrame = (): void => {
		if (journal === null)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'cannot roll back without an active frame');
		const active = journal;
		journal = null;
		const errors: unknown[] = [];
		while (active.length !== 0) {
			try {
				const opcode = active.pop();
				if (opcode === JournalOpcode.Mount || opcode === JournalOpcode.Adopt) {
					const range = active.pop() as CompiledProgramRange;
					const count = active.pop() as number;
					const firstHandle = active.pop() as number;
					for (let index = count - 1; index >= 0; index--) {
						const handle = firstHandle + index;
						const instance = instances.get(handle)!;
						if (opcode === JournalOpcode.Mount) cleanupRoot(papi, rootOf(instance));
						unlink(instance, range);
						instances.delete(handle);
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
						fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused rollback slot ${slot}`);
					}
					run.values[valueIndex] = previous;
				} else if (opcode === JournalOpcode.Remove) {
					const before = active.pop() as Node | null;
					const parent = active.pop() as Node;
					const range = active.pop() as CompiledProgramRange;
					const instance = active.pop() as CompiledProgramInstance<Node>;
					const handle = active.pop() as number;
					const root = rootOf(instance);
					instances.set(handle, instance);
					relink(handle, instance, range);
					// Restore ownership before the host call so a mutate-then-throw
					// insertion remains reachable by terminal disposal after faulting.
					papi.insertBefore(parent, root, before);
				} else if (opcode === JournalOpcode.Move) {
					const before = active.pop() as number | null;
					const handle = active.pop() as number;
					moveInstance(handle, instances.get(handle)!, before);
				} else if (opcode === JournalOpcode.Visibility) {
					const visible = active.pop() as boolean;
					const handle = active.pop() as number;
					writeVisibility(handle, instances.get(handle)!, visible);
				} else {
					fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'journal contains an unknown operation');
				}
			} catch (error) {
				errors.push(error);
			}
		}
		lastHandle = journalFirstHandle;
		nextListener = journalFirstListener;
		templates.length = journalFirstTemplates;
		if (errors.length !== 0) {
			faulted = true;
			failAggregate(
				errors,
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program frame rollback failed.',
			);
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
	const moveInstance = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		before: number | null,
	): void => {
		const range = ranges.get(instance.parent)!;
		const oldBefore = instance.next;
		const root = rootOf(instance);
		const anchorInstance = before === null ? undefined : instances.get(before)!;
		const anchor = anchorInstance === undefined ? null : rootOf(anchorInstance);
		try {
			papi.insertBefore(instance.parent, root, anchor);
		} catch (error) {
			try {
				const previousInstance = oldBefore === null ? undefined : instances.get(oldBefore)!;
				const previous = previousInstance === undefined ? null : rootOf(previousInstance);
				papi.insertBefore(instance.parent, root, previous);
			} catch (rollbackError) {
				faulted = true;
				failAggregate(
					[error, rollbackError],
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program move rollback failed.',
				);
			}
			throw error;
		}
		unlink(instance, range);
		instance.next = before;
		instance.previous = before === null ? range.tail : instances.get(before)!.previous;
		relink(handle, instance, range);
	};
	const applyVisibility = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		visible: boolean,
	): void => {
		const run = instance.run;
		const offset = instance.index * run.plan.nodes;
		const node = rootOf(instance);
		const firstId = run.values[run.values.length - 2] as number;
		const stride = run.values[run.values.length - 1] as number;
		if (visible) papi.setAttribute(node, 'hidden', false);
		const set = run.create.set!;
		for (let site = 0; site < run.plan.events.length; site++) {
			const event = run.plan.events[site]!;
			if (
				!set(
					run.nodes,
					~site,
					visible
						? encodePrevalidatedLynxNativeEventToken(
								root as number,
								firstId === 0 ? handle : firstId + instance.index * stride + event.node,
								1,
								run.listener + instance.index * run.plan.events.length + site,
								event.priority,
							)
						: undefined,
					offset,
				)
			) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused event site ${site}`);
			}
		}
		if (!visible) papi.setAttribute(node, 'hidden', true);
	};
	const writeVisibility = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		visible: boolean,
	): void => {
		const previous = instance.visible;
		try {
			applyVisibility(handle, instance, visible);
		} catch (error) {
			try {
				applyVisibility(handle, instance, previous);
			} catch (rollbackError) {
				faulted = true;
				failAggregate(
					[error, rollbackError],
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program visibility rollback failed.',
				);
			}
			throw error;
		}
		instance.visible = visible;
	};
	const removeInstance = (handle: number, undo: unknown[]): void => {
		const instance = requireInstance(handle);
		const root = rootOf(instance);
		const parent = papi.getParent(root);
		if (parent === null || !papi.isEqual(parent, instance.parent))
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'found a detached instance');
		const range = ranges.get(instance.parent);
		if (range === undefined)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'lost the instance range order');
		const nextInstance = instance.next === null ? undefined : instances.get(instance.next)!;
		const before = nextInstance === undefined ? null : rootOf(nextInstance);
		try {
			papi.remove(parent, root);
		} catch (error) {
			let attached: boolean;
			try {
				attached = papi.isChild(parent, root);
			} catch (inspectionError) {
				faulted = true;
				failAggregate(
					[error, inspectionError],
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program remove inspection failed.',
				);
			}
			if (!attached) {
				try {
					papi.insertBefore(parent, root, before);
				} catch (rollbackError) {
					faulted = true;
					failAggregate(
						[error, rollbackError],
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program remove rollback failed.',
					);
				}
			}
			throw error;
		}
		unlink(instance, range);
		instances.delete(handle);
		undo.push(handle, instance, range, parent, before, JournalOpcode.Remove);
	};
	const writeRun = (
		input: LynxCompiledProgramMount<Node>,
		adopted?: LynxCompiledProgramAdoption<Node>,
	): void => {
		const undo = requireJournal();
		const adoption = adopted !== undefined;
		requireHandle(input.firstHandle);
		requireCount(input.count);
		const finalHandle = input.firstHandle + input.count - 1;
		if (!Number.isSafeInteger(finalHandle) || finalHandle > MAX_INSTANCE_HANDLE) {
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'instance run exceeds the handle range');
		}
		if (input.firstHandle <= lastHandle) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					`cannot reuse instance handle ${input.firstHandle}`,
			);
		}
		const plan = input.plan;
		if (plan.nodes <= 0 || plan.ranges.length !== 0) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					'requires a non-empty range-free compiled program',
			);
		}
		const valueOffset = input.valueOffset ?? 0;
		if (!Number.isSafeInteger(valueOffset) || valueOffset < 0) {
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received an invalid value offset');
		}
		const valueCount = plan.values.length * input.count;
		const valueEnd = valueOffset + valueCount;
		if (
			!Number.isSafeInteger(valueEnd) ||
			valueEnd > input.values.length ||
			(input.valueOffset === undefined && valueEnd !== input.values.length)
		) {
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received the wrong value arity');
		}
		for (let index = valueOffset; index < valueEnd; index++) {
			const slot = (index - valueOffset) % plan.values.length;
			if (!isSlotValue(plan, slot, input.values[index])) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						`received a value outside slot ${slot}'s scalar kind`,
				);
			}
		}
		const values = input.values.slice(valueOffset, valueEnd);
		const eventCount = plan.events.length;
		const finalListener = nextListener + eventCount * input.count;
		if (
			eventCount !== 0 &&
			(!Number.isSafeInteger(root) ||
				(root as number) <= 0 ||
				nextListener <= 0 ||
				!Number.isSafeInteger(finalListener))
		) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'event identity exceeds the safe integer range',
			);
		}
		for (let site = 0; site < eventCount; site++) {
			const event = plan.events[site]!;
			if (
				plan.slots[event.slot] !== `e:${event.type}` ||
				(event.priority !== 'discrete' &&
					event.priority !== 'continuous' &&
					event.priority !== 'default') ||
				!Number.isSafeInteger(event.node) ||
				event.node < 0 ||
				event.node >= plan.nodes
			) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `received an invalid event site ${site}`);
			}
		}
		if (adoption && adopted.firstListenerId !== (eventCount === 0 ? null : nextListener)) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					'first-screen listener identity disagrees with the compact cursor',
			);
		}
		const range = ranges.get(input.parent) ?? { head: null, tail: null };
		let next: number | null = null;
		if (input.before !== null) {
			requireHandle(input.before);
			const anchor = instances.get(input.before);
			if (anchor === undefined || !papi.isEqual(anchor.parent, input.parent)) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received an anchor outside the target range',
				);
			}
			next = input.before;
		}
		const previous = next === null ? range.tail : instances.get(next)!.previous;
		let create = creates.get(plan);
		if (create === undefined) {
			create = plan.bind(papi) as CompiledProgramCreate;
			if (typeof create.run !== 'function')
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires an emitted dense-run driver');
			if ((plan.values.length !== 0 || eventCount !== 0) && typeof create.set !== 'function') {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires an emitted slot setter');
			}
			creates.set(plan, create);
		}
		let nodes: readonly Node[];
		if (adoption) {
			nodes = adopted.nodes;
			if (nodes.length !== plan.nodes * input.count) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received the wrong adopted node arity');
			}
		} else {
			const tokens = new Array<string>(eventCount * input.count);
			for (let row = 0; row < input.count; row++) {
				for (let site = 0; site < eventCount; site++) {
					const event = plan.events[site]!;
					// A compact handle is the lifetime identity of the entire fixed-shape
					// instance. Its event host cannot leave independently, so it is the
					// stale-event key; the listener id still distinguishes every site.
					tokens[row * eventCount + site] = encodePrevalidatedLynxNativeEventToken(
						root as number,
						input.firstHandle + row,
						1,
						nextListener + row * eventCount + site,
						event.priority,
					);
				}
			}
			const created = new Array<Node>(plan.nodes * input.count);
			try {
				create.run(pageId, input.count, values, tokens, [], created);
				const before = next === null ? null : rootOf(instances.get(next)!);
				for (let index = 0; index < input.count; index++) {
					const node = created[index * plan.nodes];
					if (node === null || typeof node !== 'object')
						fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `did not publish root ${index}`);
					papi.insertBefore(input.parent, node, before);
				}
			} catch (error) {
				const cleanupErrors: unknown[] = [];
				for (let index = input.count - 1; index >= 0; index--) {
					try {
						cleanupRoot(papi, created[index * plan.nodes]);
					} catch (cleanupError) {
						cleanupErrors.push(cleanupError);
					}
				}
				if (cleanupErrors.length !== 0) {
					faulted = true;
					failAggregate(
						[error, ...cleanupErrors],
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program mount cleanup failed.',
					);
				}
				throw error;
			}
			nodes = created;
		}
		if (eventCount !== 0) {
			values.push(adoption ? adopted.firstId : 0, adoption ? adopted.stride : 0);
		}
		const run: CompiledProgramRun<Node> = {
			create,
			listener: nextListener,
			nodes,
			plan,
			values,
		};
		let runPrevious = previous;
		for (let index = 0; index < input.count; index++) {
			const handle = input.firstHandle + index;
			const instance: CompiledProgramInstance<Node> = {
				index,
				parent: input.parent,
				previous: runPrevious,
				next,
				run,
				visible: true,
			};
			instances.set(handle, instance);
			relink(handle, instance, range);
			runPrevious = handle;
		}
		lastHandle = finalHandle;
		nextListener = finalListener;
		undo.push(
			input.firstHandle,
			input.count,
			range,
			adoption ? JournalOpcode.Adopt : JournalOpcode.Mount,
		);
	};

	return {
		begin() {
			requireHealthy();
			if (journal !== null)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'cannot begin a nested frame');
			journal = [];
			journalFirstHandle = lastHandle;
			journalFirstListener = nextListener;
			journalFirstTemplates = templates.length;
		},
		commit() {
			requireHealthy();
			if (journal === null)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'cannot commit without an active frame');
			journal = null;
		},
		rollback() {
			rollbackFrame();
		},
		define(template, plan) {
			requireJournal();
			if (template === templates.length) {
				templates.push(plan);
				return true;
			}
			if (templates[template] === plan) return false;
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					(templates[template] === undefined
						? `requires contiguous template id ${templates.length}`
						: `cannot redefine template ${template}`),
			);
		},
		resolve(template) {
			return templates[template];
		},
		clear(parent) {
			const undo = requireJournal();
			const range = ranges.get(parent);
			while (range !== undefined && range.head !== null) {
				removeInstance(range.head!, undo);
			}
		},
		move(handle, before) {
			const undo = requireJournal();
			const instance = requireInstance(handle);
			if (before !== null) {
				requireHandle(before);
				const anchor = instances.get(before);
				if (anchor === undefined || !papi.isEqual(anchor.parent, instance.parent)) {
					fail(
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
							'received a move anchor outside the target range',
					);
				}
			}
			if (before === handle || instance.next === before) return false;
			const previous = instance.next;
			moveInstance(handle, instance, before);
			undo.push(handle, previous, JournalOpcode.Move);
			return true;
		},
		adopt(input) {
			writeRun(input, input);
		},
		mount(input) {
			writeRun(input);
		},
		set(handle, slot, value) {
			const undo = requireJournal();
			if (!Number.isSafeInteger(slot) || slot < 0)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires a non-negative value slot');
			const instance = requireInstance(handle);
			const run = instance.run;
			if (slot >= run.plan.values.length)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `does not hold value slot ${slot}`);
			if (!isSlotValue(run.plan, slot, value)) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						`received a value outside slot ${slot}'s scalar kind`,
				);
			}
			const valueIndex = instance.index * run.plan.values.length + slot;
			const previous = run.values[valueIndex];
			if (Object.is(previous, value)) return false;
			const set = run.create.set;
			if (set === undefined)
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'does not have an emitted value-slot setter',
				);
			const nodeOffset = instance.index * run.plan.nodes;
			try {
				if (!set(run.nodes, slot, value, nodeOffset))
					fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused value slot ${slot}`);
			} catch (error) {
				try {
					if (!set(run.nodes, slot, previous, nodeOffset)) {
						fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused rollback slot ${slot}`);
					}
				} catch (rollbackError) {
					faulted = true;
					failAggregate(
						[error, rollbackError],
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program slot rollback failed.',
					);
				}
				throw error;
			}
			run.values[valueIndex] = value;
			undo.push(handle, slot, previous, JournalOpcode.Set);
			return true;
		},
		visibility(handle, visible) {
			const undo = requireJournal();
			const instance = requireInstance(handle);
			if (instance.visible === visible) return false;
			const previous = instance.visible;
			writeVisibility(handle, instance, visible);
			undo.push(handle, previous, JournalOpcode.Visibility);
			return true;
		},
		remove(handle) {
			const undo = requireJournal();
			removeInstance(handle, undo);
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
					const root = rootOf(instance);
					cleanupRoot(papi, root);
					instances.delete(handle);
				} catch (error) {
					errors.push(error);
				}
			}
			ranges.clear();
			templates.length = 1;
			if (errors.length !== 0)
				failAggregate(
					errors,
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program disposal failed.',
				);
		},
	};
}
