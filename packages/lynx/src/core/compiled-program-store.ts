declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramCreate, UniversalProgramPlan } from 'octane/universal/native';

import { encodePrevalidatedLynxNativeEventToken } from './native-events.js';
import type { LynxHostAttachmentChange } from './protocol.js';
import { requireLynxMainThreadWorkletFeature } from './main-thread-worklet-feature.js';
import type { LynxCompiledProgramWorkletStore } from './compiled-program-worklets.js';
import type { LynxMainThreadWorkletRegistry } from './worklets.js';
import { LYNX_PROFILE, lynxWireProfile } from './profiling.js';
import {
	createLynxListItemDescriptor,
	lynxListReuseKey,
	planLynxListUpdate,
	type LynxListItemDescriptor,
} from './list.js';
import type {
	LynxElementPAPI,
	LynxElementRef,
	LynxListComponentAtIndex,
	LynxListComponentAtIndexes,
	LynxListEnqueueComponent,
} from './papi.js';

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
	readonly deferred: boolean;
	nodes: (Node | undefined)[];
	readonly plan: UniversalProgramPlan;
	readonly stride: number;
	readonly values: unknown[];
	readonly count: number;
	refFirstId: number | null;
	refStride: number;
}

interface CompiledProgramInstance<Node extends LynxElementRef> {
	readonly index: number;
	readonly parent: Node;
	/** Logical structural range; sibling compiler slots may share `parent`. */
	readonly range: CompiledProgramRangeKey<Node>;
	/** Stable compiler-slot identities allocated only when a child range is used. */
	rangeKeys?: object[];
	readonly run: CompiledProgramRun<Node>;
	next: number | null;
	previous: number | null;
	visible: boolean;
}

interface CompiledProgramRange<Node extends LynxElementRef> {
	head: number | null;
	tail: number | null;
	readonly before: Node | null;
	/** Later adjacent compiler ranges whose first live member is this range's anchor. */
	readonly nextRanges: readonly CompiledProgramRangeKey<Node>[] | null;
}

type CompiledProgramRangeKey<Node extends LynxElementRef> = Node | object;

interface CompiledProgramListItem<Node extends LynxElementRef> {
	readonly descriptor: LynxListItemDescriptor;
	readonly handle: number;
	readonly instance: CompiledProgramInstance<Node>;
}

interface CompiledProgramListCell<Node extends LynxElementRef> {
	sign: number;
	readonly nodes: (Node | undefined)[];
	item: CompiledProgramListItem<Node>;
	owner: CompiledProgramInstance<Node> | null;
	awaitingEnqueue: boolean;
}

interface CompiledProgramListState<Node extends LynxElementRef> {
	readonly node: Node;
	/** Logical child range, learned when the first deferred row run arrives. */
	range: CompiledProgramRangeKey<Node> | null;
	readonly componentAtIndex: LynxListComponentAtIndex<Node>;
	readonly componentAtIndexes: LynxListComponentAtIndexes<Node>;
	readonly enqueueComponent: LynxListEnqueueComponent<Node>;
	items: readonly CompiledProgramListItem<Node>[];
	readonly cellsBySign: Map<number, CompiledProgramListCell<Node>>;
	readonly attachedByHandle: Map<number, CompiledProgramListCell<Node>>;
	readonly retainedByHandle: Map<number, CompiledProgramListCell<Node>>;
	readonly recyclePools: Map<string, CompiledProgramListCell<Node>[]>;
	disposed: boolean;
}

interface CompiledProgramPreparedList<Node extends LynxElementRef> {
	readonly list: CompiledProgramListState<Node>;
	readonly previous: readonly CompiledProgramListItem<Node>[];
	readonly next: readonly CompiledProgramListItem<Node>[];
}

function hasListUpdate(update: ReturnType<typeof planLynxListUpdate>): boolean {
	return (
		update.insertAction.length !== 0 ||
		update.removeAction.length !== 0 ||
		update.updateAction.length !== 0
	);
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

const enum StoreFailure {
	Handle,
	Count,
	Faulted,
	Closing,
	Begin,
	Rollback,
	Journal,
	RangeSlot,
	Detached,
	RangeOrder,
	AppendProof,
	HandleRange,
	StructuralProgram,
	ValueOffset,
	ValueArity,
	EventRange,
	ListenerIdentity,
	RunDriver,
	SlotSetter,
	AdoptedArity,
	NestedFrame,
	Commit,
	MoveRange,
	MoveAnchor,
	ValueSlot,
}

const STORE_FAILURES = [
	'requires an in-range positive instance handle',
	'requires a positive instance count',
	'is faulted after an incomplete host rollback',
	'is closing or closed',
	'requires begin() before host operations',
	'cannot roll back without an active frame',
	'journal contains an unknown operation',
	'requires a non-negative range slot',
	'found a detached instance',
	'lost the instance range order',
	'requires append-only first-screen proof',
	'instance run exceeds the handle range',
	'requires a non-empty compiled program with structural ranges',
	'received an invalid value offset',
	'received the wrong value arity',
	'event identity exceeds the safe integer range',
	'first-screen listener identity disagrees with the compact cursor',
	'requires an emitted dense-run driver',
	'requires an emitted slot setter',
	'received the wrong adopted node arity',
	'cannot begin a nested frame',
	'cannot commit without an active frame',
	'received a move outside the instance range',
	'received a move anchor outside the target range',
	'requires a non-negative value slot',
] as const;

export interface LynxCompiledProgramMount<Node extends LynxElementRef> {
	readonly before: number | null;
	/** Static insertion anchor when `before` is null; omitted/null means the range tail. */
	readonly anchor?: Node | null;
	readonly count: number;
	readonly firstHandle: number;
	readonly parent: Node;
	/** Compiler-owned parent identity when several ranges share one native host. */
	readonly range?: LynxCompiledProgramRangeIdentity;
	readonly plan: UniversalProgramPlan;
	/** Offset of this run's contiguous value segment inside `values`. */
	readonly valueOffset?: number;
	readonly values: readonly unknown[];
}

export interface LynxCompiledProgramRangeIdentity {
	readonly owner: number;
	readonly slot: number;
}

export interface LynxCompiledProgramAdoptionSeed<Node extends LynxElementRef> {
	/** Existing first-screen host id of the first program root. */
	readonly firstId: number;
	/** Listener identity already installed by the accepted first screen. */
	readonly firstListenerId: number | null;
	/** Existing program outputs in member-major order; ownership transfers on commit. */
	readonly nodes: readonly (Node | undefined)[];
	/** Logical host-id distance between consecutive first-screen instances. */
	readonly stride: number;
	/**
	 * Values currently painted into `nodes`.
	 *
	 * When present, adoption repairs differences to the background run in the
	 * same transaction; omission means the source already proved an exact match.
	 */
	readonly paintedValues?: readonly unknown[];
}

export interface LynxCompiledProgramAdoption<Node extends LynxElementRef>
	extends LynxCompiledProgramMount<Node>, LynxCompiledProgramAdoptionSeed<Node> {
	/** Adoption follows the accepted first-screen order, so it is append-only. */
	readonly before: null;
}

/** Resolve one already-proved first-screen run by the compact handle that will own it. */
export type LynxCompiledProgramAdoptionSeedResolver<Node extends LynxElementRef> = (
	input: LynxCompiledProgramMount<Node>,
) => LynxCompiledProgramAdoptionSeed<Node> | undefined;

/**
 * Main-painted program ownership offered to the first compact frame.
 *
 * `verify` runs inside the frame transaction, before the store commits, so an
 * incomplete adoption still rolls the frame back. `finish` is the no-throw,
 * irreversible hand-over boundary after that commit: until then `dispose`
 * remains the only terminal owner, and a rejected frame may retry the same
 * handle/proof assignments. Once finished, later mounts return no seed and the
 * compact store is the sole owner of every transferred node.
 */
export interface LynxCompiledProgramAdoptionSource<Node extends LynxElementRef> {
	/** Native lists explicitly defer paint to the first compact commit. */
	readonly firstScreen?: 'painted' | 'deferred-native-list';
	readonly firstListener: number;
	readonly resolveSeed: LynxCompiledProgramAdoptionSeedResolver<Node>;
	verify(): void;
	finish(): void;
	dispose(): void;
}

export interface LynxCompiledProgramStore<Node extends LynxElementRef = LynxElementRef> {
	begin(): void;
	prepareCommit(): void;
	commit(): void;
	rollback(): void;
	define(template: number, plan: UniversalProgramPlan): boolean;
	resolve(template: number): UniversalProgramPlan | undefined;
	adopt(input: LynxCompiledProgramAdoption<Node>): void;
	mount(input: LynxCompiledProgramMount<Node>): void;
	node(instance: number, index: number): Node;
	range(instance: number, slot: number): Node;
	clear(parent: Node, range?: LynxCompiledProgramRangeIdentity): void;
	move(
		handle: number,
		parent: Node,
		before: number | null,
		anchor?: Node | null,
		range?: LynxCompiledProgramRangeIdentity,
	): boolean;
	remove(handle: number): void;
	set(handle: number, slot: number, value: unknown): boolean;
	visibility(handle: number, visible: boolean): boolean;
	refs(firstHandle: number, firstId: number, stride: number): void;
	size(): number;
	isFaulted(): boolean;
	dispose(): void;
}

function fail(message: string | false | StoreFailure): never {
	if (
		(typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) &&
		typeof message === 'number'
	) {
		message = STORE_FAILURES[message]!;
	}
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
		fail(StoreFailure.Handle);
	}
}

function requireCount(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) fail(StoreFailure.Count);
}

function isScalar(value: unknown): boolean {
	const type = typeof value;
	return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

function isSlotValue<Node extends LynxElementRef>(
	plan: UniversalProgramPlan,
	slot: number,
	value: unknown,
	worklets: LynxCompiledProgramWorkletStore<Node> | null,
): boolean {
	const kind = plan.slots[plan.values[slot]!];
	if (kind === 'c') return typeof value === 'string';
	if (kind?.startsWith('p:') !== true) return false;
	return isScalar(value) || worklets?.validValue(plan, slot, value) === true;
}

function validateResidentNodes(plan: UniversalProgramPlan): void {
	const resident = plan.resident;
	if (resident === undefined) return;
	if (!Array.isArray(resident) || resident.length === 0 || resident[0] !== 0) {
		fail('requires resident node 0');
	}
	const retained = new Set<number>();
	let previous = -1;
	for (const node of resident) {
		if (!Number.isSafeInteger(node) || node <= previous || node >= plan.nodes) {
			fail('requires sorted unique resident node indexes');
		}
		retained.add(node);
		previous = node;
	}
	const requireNode = (node: number, purpose: string): void => {
		if (!retained.has(node)) fail('resident set omits ' + purpose + ' node ' + node);
	};
	for (const event of plan.events) requireNode(event.node, 'event');
	for (const range of plan.ranges) {
		requireNode(range.node, 'range-parent');
		if (range.before !== undefined && range.before !== null)
			requireNode(range.before, 'range-anchor');
	}
	for (const node of plan.refs ?? []) requireNode(node, 'ref');
	for (let index = 0; index < (plan.wire?.nodes.length ?? 0); index++) {
		const wire = plan.wire!.nodes[index]!;
		if ((wire.bindings?.length ?? 0) !== 0 || wire.type === 'list') requireNode(index, 'bound');
	}
}

function compactResidentNodes<Node extends LynxElementRef>(
	plan: UniversalProgramPlan,
	count: number,
	stride: number,
	source: readonly (Node | undefined)[],
): (Node | undefined)[] | null {
	const resident = plan.resident;
	if (resident === undefined) return null;
	const compact = new Array<Node | undefined>(stride * count);
	for (let row = 0; row < count; row++) {
		const offset = row * stride;
		for (const node of resident) compact[offset + node] = source[offset + node];
	}
	return compact;
}

function transferResidentNodes<Node extends LynxElementRef>(
	plan: UniversalProgramPlan,
	stride: number,
	source: (Node | undefined)[],
	sourceOffset: number,
	target: (Node | undefined)[],
	targetOffset: number,
): void {
	const resident = plan.resident;
	if (resident === undefined) {
		for (let index = 0; index < stride; index++) {
			target[targetOffset + index] = source[sourceOffset + index];
			source[sourceOffset + index] = undefined;
		}
		return;
	}
	for (const index of resident) {
		target[targetOffset + index] = source[sourceOffset + index];
		source[sourceOffset + index] = undefined;
	}
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
 * Retain the minimum state a compiled main-thread program needs.
 *
 * This is intentionally not the product receiver yet. It owns the state and
 * fault boundary that receiver will call after a compact frame has resolved a
 * resident program: emitted code creates and updates hosts, compiler range
 * slots resolve nested children without a host-id map, while this store
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
	seed?: LynxCompiledProgramAdoptionSeedResolver<Node>,
	onCallbackFault?: (error: unknown) => void,
	onAttachments?: (changes: readonly LynxHostAttachmentChange[]) => void,
	workletRegistry?: LynxMainThreadWorkletRegistry,
): LynxCompiledProgramStore<Node> {
	const instances = new Map<number, CompiledProgramInstance<Node>>();
	const creates = new WeakMap<UniversalProgramPlan, CompiledProgramCreate>();
	const templates: (UniversalProgramPlan | undefined)[] = [undefined];
	const ranges = new Map<CompiledProgramRangeKey<Node>, CompiledProgramRange<Node>>();
	let lists: Map<Node, CompiledProgramListState<Node>> | null = null;
	let dirtyLists: Set<CompiledProgramListState<Node>> | null = null;
	let pendingListDisposals: Set<CompiledProgramListState<Node>> | null = null;
	let preparedLists: CompiledProgramPreparedList<Node>[] | null = null;
	let listCallbackDuringFrame = false;
	const planIds = new WeakMap<UniversalProgramPlan, number>();
	let nextPlanId = 1;
	let journal: unknown[] | null = null;
	let journalFirstHandle = 0;
	let lastHandle = 0;
	let journalFirstRefHost = 0;
	let lastRefHost = 0;
	// The Block producer reserves one listener id for every compiled event site,
	// bound handler or not. Its v2 RUN therefore needs no event payload: both
	// threads advance this cursor over the same resident plan and run count.
	let journalFirstListener = 0;
	let journalFirstTemplates = 1;
	let nextListener = firstListener;
	let faulted = false;
	let closing = false;
	let workletStore: LynxCompiledProgramWorkletStore<Node> | null = null;
	const noWorkletPlans = new WeakSet<UniversalProgramPlan>();
	const listNodeIndexes = new WeakMap<UniversalProgramPlan, readonly number[]>();
	const retainedHostRefs = (plan: UniversalProgramPlan): number =>
		plan.resident?.length ?? plan.nodes;
	const publishInstance = (handle: number, instance: CompiledProgramInstance<Node>): void => {
		instances.set(handle, instance);
		if (LYNX_PROFILE && !instance.run.deferred) {
			lynxWireProfile().programRunLiveRetainedHostRefs += retainedHostRefs(instance.run.plan);
		}
	};
	const releaseInstance = (handle: number, instance: CompiledProgramInstance<Node>): void => {
		if (!instances.delete(handle) || !LYNX_PROFILE || instance.run.deferred) return;
		lynxWireProfile().programRunLiveRetainedHostRefs -= retainedHostRefs(instance.run.plan);
	};
	const profileRunOwnership = (plan: UniversalProgramPlan, count: number): void => {
		if (!LYNX_PROFILE) return;
		const owned = plan.nodes * count;
		const retained = retainedHostRefs(plan) * count;
		const profile = lynxWireProfile();
		profile.programRunOwnedHosts += owned;
		profile.programRunRetainedHostRefs += retained;
		profile.programRunReleasedHostRefs += owned - retained;
	};
	const publishListCellOwnership = (plan: UniversalProgramPlan): void => {
		if (!LYNX_PROFILE) return;
		const retained = retainedHostRefs(plan);
		const profile = lynxWireProfile();
		profile.listProgramCellRuns++;
		profile.listProgramCellHosts += plan.nodes;
		profile.listProgramCellRetainedHostRefs += retained;
		profile.listProgramCellReleasedHostRefs += plan.nodes - retained;
		profile.listProgramCellLiveRetainedHostRefs += retained;
	};
	const releaseListCellOwnership = (plan: UniversalProgramPlan): void => {
		if (LYNX_PROFILE) {
			lynxWireProfile().listProgramCellLiveRetainedHostRefs -= retainedHostRefs(plan);
		}
	};
	const workletsFor = (
		plan: UniversalProgramPlan,
	): LynxCompiledProgramWorkletStore<Node> | null => {
		if (noWorkletPlans.has(plan)) return null;
		if (workletStore !== null) {
			if (workletStore.hasSites(plan)) return workletStore;
			noWorkletPlans.add(plan);
			return null;
		}
		const wire = plan.wire;
		let found = false;
		for (const node of wire?.nodes ?? []) {
			if (node.bindings?.some((binding) => binding.name.startsWith('main-thread:'))) {
				found = true;
				break;
			}
		}
		if (!found) {
			noWorkletPlans.add(plan);
			return null;
		}
		if (workletRegistry === undefined) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					'main-thread props require the compact worklet feature',
			);
		}
		workletStore = requireLynxMainThreadWorkletFeature().createCompiledProgramStore(
			papi,
			workletRegistry,
		);
		return workletStore;
	};

	const requireHealthy = (): void => {
		if (faulted) fail(StoreFailure.Faulted);
		if (closing) fail(StoreFailure.Closing);
	};
	const requireJournal = (): unknown[] => {
		requireHealthy();
		if (journal === null) fail(StoreFailure.Begin);
		return journal;
	};
	const rootOf = (instance: CompiledProgramInstance<Node>): Node => {
		const rootNode = instance.run.nodes[instance.index * instance.run.stride];
		if (rootNode === undefined) fail(StoreFailure.Detached);
		return rootNode;
	};
	const refId = (run: CompiledProgramRun<Node>, index: number, node: number): number => {
		if (run.refFirstId === null)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'ref run is not linked');
		return run.refFirstId + index * run.refStride + node;
	};
	const updateCellRefs = (instance: CompiledProgramInstance<Node>, attached: boolean): void => {
		const refs = instance.run.plan.refs;
		if (refs === undefined || instance.run.refFirstId === null) return;
		const changes: LynxHostAttachmentChange[] = [];
		const offset = instance.index * instance.run.stride;
		for (const node of refs) {
			const physical = instance.run.nodes[offset + node];
			if (physical === undefined)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'lost a ref-bearing list node');
			const id = refId(instance.run, instance.index, node);
			papi.setRefSelector(physical, attached ? 'r' + String(root) + '-h' + id + '-g1' : '');
			changes.push(Object.freeze({ id, generation: 1, attached }));
		}
		if (changes.length !== 0) onAttachments?.(Object.freeze(changes));
	};
	const requireInstance = (handle: number): CompiledProgramInstance<Node> => {
		requireHandle(handle);
		const instance = instances.get(handle);
		if (instance === undefined)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `does not hold instance ${handle}`);
		return instance;
	};
	const planWire = (plan: UniversalProgramPlan) => {
		const wire = plan.wire;
		if (wire === undefined || wire.nodes.length !== plan.nodes) {
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires resident host metadata');
		}
		return wire;
	};
	const deferredItem = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
	): CompiledProgramListItem<Node> => {
		const run = instance.run;
		const wire = planWire(run.plan);
		const rootNode = wire.nodes[0]!;
		if (rootNode.type !== 'list-item' || run.plan.ranges.length !== 0) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					'requires a fixed-shape list-item root for a deferred native-list run',
			);
		}
		const props: Record<string, unknown> = { ...rootNode.props };
		const valueOffset = instance.index * run.plan.values.length;
		for (const binding of rootNode.bindings ?? []) {
			props[binding.name] = run.values[valueOffset + binding.valueIndex];
		}
		return {
			descriptor: createLynxListItemDescriptor(handle, rootNode.type, props),
			handle,
			instance,
		};
	};
	const listItems = (
		list: CompiledProgramListState<Node>,
	): readonly CompiledProgramListItem<Node>[] => {
		const range = ranges.get(list.range ?? list.node);
		const items: CompiledProgramListItem<Node>[] = [];
		let handle = range?.head ?? null;
		while (handle !== null) {
			const instance = instances.get(handle);
			if (instance === undefined || !instance.run.deferred) fail(StoreFailure.RangeOrder);
			items.push(deferredItem(handle, instance));
			handle = instance.next;
		}
		return Object.freeze(items);
	};
	const poolKey = (item: CompiledProgramListItem<Node>): string => {
		let id = planIds.get(item.instance.run.plan);
		if (id === undefined) {
			id = nextPlanId++;
			planIds.set(item.instance.run.plan, id);
		}
		return String(id) + '\u0000' + lynxListReuseKey(item.descriptor);
	};
	const markListDirty = (parent: Node): void => {
		const list = lists?.get(parent);
		if (list !== undefined) (dirtyLists ??= new Set()).add(list);
	};
	const writeCellEvents = (item: CompiledProgramListItem<Node>, visible: boolean): void => {
		const run = item.instance.run;
		const set = run.create.set;
		const offset = item.instance.index * run.stride;
		if (run.plan.events.length !== 0 && set === undefined) fail(StoreFailure.SlotSetter);
		for (let site = 0; site < run.plan.events.length; site++) {
			const event = run.plan.events[site]!;
			const value = visible
				? encodePrevalidatedLynxNativeEventToken(
						root as number,
						item.handle,
						1,
						run.listener + item.instance.index * run.plan.events.length + site,
						event.priority,
					)
				: undefined;
			if (!set!(run.nodes, ~site, value, offset)) fail(StoreFailure.SlotSetter);
		}
	};
	const clearCellOwner = (cell: CompiledProgramListCell<Node>): void => {
		const owner = cell.owner;
		if (owner === null) return;
		deactivateInstanceWorklets(owner);
		if (owner.visible) updateCellRefs(owner, false);
		writeCellEvents(cell.item, false);
		const run = owner.run;
		const offset = owner.index * run.stride;
		transferResidentNodes(run.plan, run.stride, run.nodes, offset, cell.nodes, 0);
		cell.owner = null;
	};
	const destroyListCell = (
		list: CompiledProgramListState<Node>,
		cell: CompiledProgramListCell<Node>,
	): void => {
		clearCellOwner(cell);
		const rootNode = cell.nodes[0];
		if (rootNode !== undefined && papi.isChild(list.node, rootNode)) {
			papi.remove(list.node, rootNode);
		}
		if (list.cellsBySign.delete(cell.sign)) releaseListCellOwnership(cell.item.instance.run.plan);
		list.attachedByHandle.delete(cell.item.handle);
		list.retainedByHandle.delete(cell.item.handle);
		cell.awaitingEnqueue = false;
	};
	const poolListCell = (
		list: CompiledProgramListState<Node>,
		cell: CompiledProgramListCell<Node>,
	): void => {
		cell.awaitingEnqueue = false;
		let pool = list.recyclePools.get(poolKey(cell.item));
		if (pool === undefined) list.recyclePools.set(poolKey(cell.item), (pool = []));
		pool.push(cell);
	};
	const detachListCell = (
		list: CompiledProgramListState<Node>,
		cell: CompiledProgramListCell<Node>,
		mode: 'await' | 'pool' | 'retain' | 'destroy',
	): void => {
		const handle = cell.item.handle;
		if (list.attachedByHandle.get(handle) === cell) list.attachedByHandle.delete(handle);
		clearCellOwner(cell);
		if (mode === 'await') cell.awaitingEnqueue = true;
		else if (mode === 'pool') poolListCell(list, cell);
		else if (mode === 'retain') {
			cell.awaitingEnqueue = false;
			list.retainedByHandle.set(handle, cell);
		} else destroyListCell(list, cell);
	};
	const attachCellOwner = (
		cell: CompiledProgramListCell<Node>,
		item: CompiledProgramListItem<Node>,
	): void => {
		const run = item.instance.run;
		const offset = item.instance.index * run.stride;
		transferResidentNodes(run.plan, run.stride, cell.nodes, 0, run.nodes, offset);
		cell.item = item;
		cell.owner = item.instance;
		cell.awaitingEnqueue = false;
		if (item.instance.visible) updateCellRefs(item.instance, true);
	};
	const rootOfCell = (cell: CompiledProgramListCell<Node>): Node =>
		cell.owner === null ? cell.nodes[0]! : rootOf(cell.owner);
	const writeListPhysicalSlot = (
		instance: CompiledProgramInstance<Node>,
		slot: number,
		value: unknown,
	): boolean => {
		const run = instance.run;
		const worklets = workletsFor(run.plan);
		if (!instance.visible && worklets?.validValue(run.plan, slot, value) === true) {
			return worklets.set(run.plan, run.nodes, instance.index * run.stride, slot, undefined);
		}
		return writePhysicalSlot(instance, slot, value);
	};
	const materializeListItem = (
		list: CompiledProgramListState<Node>,
		index: number,
	): {
		readonly cell: CompiledProgramListCell<Node>;
		readonly reuseNotification: boolean;
	} => {
		const item = list.items[index];
		if (item === undefined)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requested an out-of-range native-list item');
		const attached = list.attachedByHandle.get(item.handle);
		if (attached !== undefined) detachListCell(list, attached, 'await');
		let cell = list.retainedByHandle.get(item.handle);
		if (cell !== undefined) list.retainedByHandle.delete(item.handle);
		if (cell === undefined && item.descriptor.recyclable) {
			const key = poolKey(item);
			const pool = list.recyclePools.get(key);
			cell = pool?.pop();
			if (pool?.length === 0) list.recyclePools.delete(key);
		}
		const run = item.instance.run;
		const valuesAt = item.instance.index * run.plan.values.length;
		const values = run.values.slice(valuesAt, valuesAt + run.plan.values.length);
		const reused = cell !== undefined;
		const reuseNotification = reused && cell!.item.handle !== item.handle;
		if (cell === undefined) {
			const directWorklets = workletsFor(run.plan);
			const preparedWorklets =
				directWorklets?.prepareMount(run.plan, 1, values, item.instance.visible) ?? null;
			const physicalValues = preparedWorklets?.values ?? values;
			const nodes = new Array<Node | undefined>(run.stride);
			const tokens = new Array<string | undefined>(run.plan.events.length);
			for (let site = 0; site < run.plan.events.length; site++) {
				const event = run.plan.events[site]!;
				tokens[site] = item.instance.visible
					? encodePrevalidatedLynxNativeEventToken(
							root as number,
							item.handle,
							1,
							run.listener + item.instance.index * run.plan.events.length + site,
							event.priority,
						)
					: undefined;
			}
			try {
				run.create.run(pageId, 1, physicalValues, tokens, [], nodes);
				preparedWorklets?.publish(nodes, run.stride);
				const rootNode = nodes[0];
				if (rootNode === undefined)
					fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'list row did not publish its root');
				papi.insertBefore(list.node, rootNode, null);
				const sign = papi.getUniqueId(rootNode);
				if (!Number.isSafeInteger(sign) || sign <= 0 || list.cellsBySign.has(sign)) {
					fail(
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received an invalid native-list cell sign',
					);
				}
				const retainedNodes = compactResidentNodes(run.plan, 1, run.stride, nodes) ?? nodes;
				cell = { sign, nodes: retainedNodes, item, owner: null, awaitingEnqueue: false };
				list.cellsBySign.set(sign, cell);
				publishListCellOwnership(run.plan);
			} catch (error) {
				const cleanupErrors: unknown[] = [];
				try {
					preparedWorklets?.abort();
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
				try {
					cleanupRoot(papi, nodes[0]);
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
				if (cleanupErrors.length !== 0) {
					faulted = true;
					failAggregate(
						[error, ...cleanupErrors],
						LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled native-list cell cleanup failed.',
					);
				}
				throw error;
			}
		} else {
			attachCellOwner(cell, item);
			const set = run.create.set;
			if (run.plan.values.length !== 0 && set === undefined) fail(StoreFailure.SlotSetter);
			for (let slot = 0; slot < values.length; slot++) {
				if (!writeListPhysicalSlot(item.instance, slot, values[slot]))
					fail(StoreFailure.SlotSetter);
			}
			writeCellEvents(item, item.instance.visible);
		}
		if (cell.owner === null) attachCellOwner(cell, item);
		if (!item.instance.visible) papi.setAttribute(rootOfCell(cell), 'hidden', true);
		else if (reused) papi.setAttribute(rootOfCell(cell), 'hidden', false);
		list.attachedByHandle.set(item.handle, cell);
		return { cell, reuseNotification };
	};
	const invokeListCallback = <Result>(fallback: Result, callback: () => Result): Result => {
		if (faulted || closing) return fallback;
		if (journal !== null) listCallbackDuringFrame = true;
		try {
			return callback();
		} catch (error) {
			// Reentrant callbacks still belong to the frame journal.
			if (journal !== null) throw error;
			faulted = true;
			try {
				onCallbackFault?.(error);
			} catch {}
			return fallback;
		}
	};
	const createListNode = (parentComponentUniqueId: number): Node => {
		const listPAPI = papi.list;
		if (listPAPI === undefined)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'requires native list PAPI');
		let state: CompiledProgramListState<Node> | undefined;
		const componentAtIndex: LynxListComponentAtIndex<Node> = (
			_list,
			_listId,
			index,
			operationId,
			enableReuseNotification,
		) =>
			invokeListCallback(-1, () => {
				if (state === undefined || state.disposed) return -1;
				const result = materializeListItem(state, index);
				papi.flush(rootOfCell(result.cell), {
					triggerLayout: true,
					...(operationId === undefined ? null : { operationID: operationId }),
					elementID: result.cell.sign,
					listID: papi.getUniqueId(state.node),
					...(result.reuseNotification && enableReuseNotification
						? {
								listReuseNotification: {
									listElement: state.node,
									itemKey: result.cell.item.descriptor.itemKey,
								},
							}
						: null),
				});
				return result.cell.sign;
			});
		const enqueueComponent: LynxListEnqueueComponent<Node> = (_list, _listId, sign) => {
			invokeListCallback(undefined, () => {
				if (state === undefined || state.disposed) return;
				const cell = state.cellsBySign.get(sign);
				if (cell === undefined) return;
				if (cell.awaitingEnqueue) {
					if (cell.item.descriptor.recyclable) poolListCell(state, cell);
					else destroyListCell(state, cell);
					return;
				}
				if (cell.owner === null) return;
				detachListCell(state, cell, cell.item.descriptor.recyclable ? 'pool' : 'retain');
			});
		};
		const componentAtIndexes: LynxListComponentAtIndexes<Node> = (
			_list,
			_listId,
			indexes,
			operationIds,
			enableReuseNotification,
			asyncFlush,
		) => {
			invokeListCallback(undefined, () => {
				if (state === undefined || state.disposed) return;
				const results = indexes.map((index) => materializeListItem(state!, index));
				if (asyncFlush) {
					for (const result of results) {
						papi.flush(rootOfCell(result.cell), {
							asyncFlush: true,
							...(result.reuseNotification && enableReuseNotification
								? {
										listReuseNotification: {
											listElement: state!.node,
											itemKey: result.cell.item.descriptor.itemKey,
										},
									}
								: null),
						});
					}
				}
				papi.flush(state.node, {
					triggerLayout: true,
					operationIDs: operationIds,
					elementIDs: results.map((result) => result.cell.sign),
					listID: papi.getUniqueId(state.node),
				});
			});
		};
		const node = listPAPI.create(
			parentComponentUniqueId,
			componentAtIndex,
			enqueueComponent,
			componentAtIndexes,
		);
		state = {
			node,
			range: null,
			componentAtIndex,
			componentAtIndexes,
			enqueueComponent,
			items: Object.freeze([]),
			cellsBySign: new Map(),
			attachedByHandle: new Map(),
			retainedByHandle: new Map(),
			recyclePools: new Map(),
			disposed: false,
		};
		(lists ??= new Map()).set(node, state);
		return node;
	};
	const disposeList = (list: CompiledProgramListState<Node>): void => {
		if (!list.disposed) {
			papi.list?.updateCallbacks(
				list.node,
				() => -1,
				() => {},
				() => {},
			);
			list.disposed = true;
			list.items = Object.freeze([]);
		}
		const errors: unknown[] = [];
		for (const cell of [...list.cellsBySign.values()]) {
			try {
				destroyListCell(list, cell);
			} catch (error) {
				errors.push(error);
			}
		}
		if (list.cellsBySign.size === 0) {
			list.attachedByHandle.clear();
			list.retainedByHandle.clear();
			list.recyclePools.clear();
			lists?.delete(list.node);
		}
		if (errors.length !== 0) {
			failAggregate(
				errors,
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled native-list cell disposal failed.',
			);
		}
	};
	const listsInInstance = (
		instance: CompiledProgramInstance<Node>,
	): CompiledProgramListState<Node>[] => {
		if (lists === null) return [];
		const output: CompiledProgramListState<Node>[] = [];
		const plan = instance.run.plan;
		let indexes = listNodeIndexes.get(plan);
		if (indexes === undefined) {
			const found: number[] = [];
			const wire = planWire(plan);
			for (let index = 0; index < wire.nodes.length; index++) {
				if (wire.nodes[index]!.type === 'list') found.push(index);
			}
			indexes = Object.freeze(found);
			listNodeIndexes.set(plan, indexes);
		}
		const offset = instance.index * instance.run.stride;
		for (const index of indexes) {
			const node = instance.run.nodes[offset + index];
			const list = node === undefined ? undefined : lists.get(node);
			if (list !== undefined) output.push(list);
		}
		return output;
	};
	const prepareDirtyLists = (): void => {
		if (preparedLists !== null) return;
		const prepared: CompiledProgramPreparedList<Node>[] = [];
		preparedLists = prepared;
		if (dirtyLists === null) return;
		const active = dirtyLists;
		dirtyLists = null;
		for (const list of active) {
			if (list.disposed) continue;
			const previous = list.items;
			const next = listItems(list);
			const update = planLynxListUpdate(
				previous.map((item) => item.descriptor),
				next.map((item) => item.descriptor),
			);
			try {
				if (hasListUpdate(update)) papi.setAttribute(list.node, 'update-list-info', update);
			} catch (error) {
				// Element PAPI has no list-state read-back, so a mutate-then-throw
				// result is unknowable. Retain ownership and refuse an exact retry.
				faulted = true;
				throw error;
			}
			list.items = next;
			prepared.push({ list, previous, next });
		}
	};
	const finalizePreparedList = ({ list, next }: CompiledProgramPreparedList<Node>): void => {
		const byHandle = new Map(next.map((item) => [item.handle, item]));
		for (const cell of [...list.attachedByHandle.values()]) {
			const item = byHandle.get(cell.item.handle);
			if (item === undefined) detachListCell(list, cell, 'await');
			else cell.item = item;
		}
		for (const [handle, cell] of [...list.retainedByHandle]) {
			const item = byHandle.get(handle);
			if (item === undefined) destroyListCell(list, cell);
			else cell.item = item;
		}
		const pooled = [...list.recyclePools.values()].flat();
		list.recyclePools.clear();
		for (const cell of pooled) {
			const item = byHandle.get(cell.item.handle);
			if (item === undefined) destroyListCell(list, cell);
			else {
				cell.item = item;
				poolListCell(list, cell);
			}
		}
		for (const cell of [...list.cellsBySign.values()]) {
			if (cell.awaitingEnqueue && !byHandle.has(cell.item.handle)) destroyListCell(list, cell);
		}
	};
	const rollbackPreparedLists = (errors: unknown[]): void => {
		if (preparedLists !== null) {
			for (let index = preparedLists.length - 1; index >= 0; index--) {
				const { list, previous, next } = preparedLists[index]!;
				list.items = previous;
				try {
					const reverse = planLynxListUpdate(
						next.map((item) => item.descriptor),
						previous.map((item) => item.descriptor),
					);
					if (hasListUpdate(reverse)) papi.setAttribute(list.node, 'update-list-info', reverse);
				} catch (error) {
					errors.push(error);
				}
			}
		}
		preparedLists = null;
		if (listCallbackDuringFrame) {
			errors.push(
				new Error(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT
						? 'A native-list callback crossed a rejected compact frame.'
						: LYNX_COMPILED_PROGRAM_STORE_ERROR,
				),
			);
		}
		listCallbackDuringFrame = false;
	};
	let listProgramPAPI: LynxElementPAPI<Node> | null = null;
	const programHost = (plan: UniversalProgramPlan): LynxElementPAPI<Node> => {
		if (plan.wire?.nodes.some((node) => node.type === 'list') !== true) return papi;
		return (listProgramPAPI ??= {
			...papi,
			createElement(type, componentId, text) {
				return type === 'list'
					? createListNode(componentId)
					: papi.createElement(type, componentId, text);
			},
		});
	};
	const nodeOf = (handle: number, index: number): Node => {
		const instance = requireInstance(handle);
		if (!Number.isSafeInteger(index) || index < 0 || index >= instance.run.plan.nodes) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					`instance ${handle} does not hold static node ${String(index)}`,
			);
		}
		const node = instance.run.nodes[instance.index * instance.run.stride + index];
		if (node === undefined) fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'lost a static node');
		return node;
	};
	const rangeOf = (handle: number, slot: number): Node => {
		if (!Number.isSafeInteger(slot) || slot < 0) fail(StoreFailure.RangeSlot);
		const instance = requireInstance(handle);
		const run = instance.run;
		let node: Node | undefined;
		for (const range of run.plan.ranges) {
			if (range.slot !== slot) continue;
			node = run.nodes[instance.index * run.stride + range.node];
			break;
		}
		if (node === undefined)
			fail(
				(typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) &&
					`instance ${handle} does not hold range slot ${slot}`,
			);
		return node;
	};
	const rangeSiteIndex = (owner: CompiledProgramInstance<Node>, slot: number): number => {
		const index = owner.run.plan.ranges.findIndex((site) => site.slot === slot);
		if (index < 0) fail(StoreFailure.RangeSlot);
		return index;
	};
	const rangeIdentityKey = (ownerHandle: number, slot: number): object => {
		const owner = requireInstance(ownerHandle);
		const index = rangeSiteIndex(owner, slot);
		const keys = (owner.rangeKeys ??= new Array(owner.run.plan.ranges.length));
		return (keys[index] ??= Object.freeze({}));
	};
	const rangeKeyOf = (
		parent: Node,
		identity: LynxCompiledProgramRangeIdentity | undefined,
	): CompiledProgramRangeKey<Node> => {
		if (identity === undefined) return parent;
		const expected = rangeOf(identity.owner, identity.slot);
		if (!papi.isEqual(expected, parent)) {
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'range identity names another host');
		}
		return rangeIdentityKey(identity.owner, identity.slot);
	};
	const nextSiblingRangeKeys = (
		identity: LynxCompiledProgramRangeIdentity | undefined,
	): readonly CompiledProgramRangeKey<Node>[] | null => {
		if (identity === undefined) return null;
		const owner = requireInstance(identity.owner);
		const sites = owner.run.plan.ranges;
		const current = rangeSiteIndex(owner, identity.slot);
		const site = sites[current]!;
		let siblings: CompiledProgramRangeKey<Node>[] | null = null;
		for (let index = current + 1; index < sites.length; index++) {
			const candidate = sites[index]!;
			if (candidate.node === site.node && (candidate.before ?? null) === (site.before ?? null)) {
				(siblings ??= []).push(rangeIdentityKey(identity.owner, candidate.slot));
			}
		}
		return siblings;
	};
	const rangeEndAnchor = (range: CompiledProgramRange<Node>): Node | null => {
		for (const key of range.nextRanges ?? []) {
			const next = ranges.get(key);
			if (next?.head !== null && next?.head !== undefined) {
				return rootOf(requireInstance(next.head));
			}
		}
		return range.before;
	};
	const writePhysicalSlot = (
		instance: CompiledProgramInstance<Node>,
		slot: number,
		value: unknown,
	): boolean => {
		const run = instance.run;
		const offset = instance.index * run.stride;
		const worklets = workletsFor(run.plan);
		if (worklets?.set(run.plan, run.nodes, offset, slot, value) === true) return true;
		return run.create.set!(run.nodes, slot, value, offset);
	};
	const deactivateInstanceWorklets = (instance: CompiledProgramInstance<Node>): void => {
		const run = instance.run;
		const offset = instance.index * run.stride;
		if (run.nodes[offset] === undefined) return;
		workletsFor(run.plan)?.deactivateInstance(run.plan, run.nodes, offset);
	};
	const activateInstanceWorklets = (instance: CompiledProgramInstance<Node>): void => {
		const run = instance.run;
		const offset = instance.index * run.stride;
		if (run.nodes[offset] === undefined) return;
		workletsFor(run.plan)?.activateInstance(
			run.plan,
			run.nodes,
			offset,
			run.values,
			instance.index * run.plan.values.length,
		);
	};
	const rollbackFrame = (): void => {
		if (journal === null) fail(StoreFailure.Rollback);
		const active = journal;
		journal = null;
		const errors: unknown[] = [];
		rollbackPreparedLists(errors);
		while (active.length !== 0) {
			try {
				const opcode = active.pop();
				if (opcode === JournalOpcode.Mount || opcode === JournalOpcode.Adopt) {
					const range = active.pop() as CompiledProgramRange<Node>;
					const count = active.pop() as number;
					const firstHandle = active.pop() as number;
					for (let index = count - 1; index >= 0; index--) {
						const handle = firstHandle + index;
						const instance = instances.get(handle)!;
						deactivateInstanceWorklets(instance);
						if (opcode === JournalOpcode.Mount && !instance.run.deferred) {
							for (const list of listsInInstance(instance)) disposeList(list);
							cleanupRoot(papi, rootOf(instance));
						}
						unlink(instance, range);
						releaseInstance(handle, instance);
					}
				} else if (opcode === JournalOpcode.Set) {
					const previous = active.pop();
					const slot = active.pop() as number;
					const handle = active.pop() as number;
					const instance = instances.get(handle)!;
					const run = instance.run;
					const valueIndex = instance.index * run.plan.values.length + slot;
					if (run.nodes[instance.index * run.stride] !== undefined) {
						if (!writePhysicalSlot(instance, slot, previous)) {
							fail(
								LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused rollback slot ${slot}`,
							);
						}
					}
					run.values[valueIndex] = previous;
				} else if (opcode === JournalOpcode.Remove) {
					const before = active.pop() as Node | null;
					const parent = active.pop() as Node;
					const range = active.pop() as CompiledProgramRange<Node>;
					const instance = active.pop() as CompiledProgramInstance<Node>;
					const handle = active.pop() as number;
					publishInstance(handle, instance);
					relink(handle, instance, range);
					if (instance.run.deferred) {
						markListDirty(parent);
					} else {
						const rootNode = rootOf(instance);
						for (const list of listsInInstance(instance)) pendingListDisposals?.delete(list);
						// Restore ownership before the host call so a mutate-then-throw
						// insertion remains reachable by terminal disposal after faulting.
						papi.insertBefore(parent, rootNode, before);
						activateInstanceWorklets(instance);
					}
				} else if (opcode === JournalOpcode.Move) {
					const before = active.pop() as number | null;
					const handle = active.pop() as number;
					moveInstance(handle, instances.get(handle)!, before);
				} else if (opcode === JournalOpcode.Visibility) {
					const visible = active.pop() as boolean;
					const handle = active.pop() as number;
					writeVisibility(handle, instances.get(handle)!, visible);
				} else {
					fail(StoreFailure.Journal);
				}
			} catch (error) {
				errors.push(error);
			}
		}
		lastHandle = journalFirstHandle;
		lastRefHost = journalFirstRefHost;
		nextListener = journalFirstListener;
		templates.length = journalFirstTemplates;
		dirtyLists = null;
		pendingListDisposals = null;
		if (errors.length !== 0) {
			faulted = true;
			failAggregate(
				errors,
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'Compiled program frame rollback failed.',
			);
		}
	};
	const unlink = (
		instance: CompiledProgramInstance<Node>,
		range: CompiledProgramRange<Node>,
	): void => {
		if (instance.previous === null) range.head = instance.next;
		else instances.get(instance.previous)!.next = instance.next;
		if (instance.next === null) range.tail = instance.previous;
		else instances.get(instance.next)!.previous = instance.previous;
		if (range.head === null) ranges.delete(instance.range);
	};
	const relink = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		range: CompiledProgramRange<Node>,
	): void => {
		if (!ranges.has(instance.range)) ranges.set(instance.range, range);
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
		const range = ranges.get(instance.range)!;
		const oldBefore = instance.next;
		if (!instance.run.deferred) {
			const root = rootOf(instance);
			const anchor = before === null ? rangeEndAnchor(range) : rootOf(instances.get(before)!);
			try {
				papi.insertBefore(instance.parent, root, anchor);
			} catch (error) {
				try {
					const previousInstance = oldBefore === null ? undefined : instances.get(oldBefore)!;
					const previous =
						previousInstance === undefined ? rangeEndAnchor(range) : rootOf(previousInstance);
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
		}
		unlink(instance, range);
		instance.next = before;
		instance.previous = before === null ? range.tail : instances.get(before)!.previous;
		if (instance.run.deferred) markListDirty(instance.parent);
		relink(handle, instance, range);
	};
	const applyVisibility = (
		handle: number,
		instance: CompiledProgramInstance<Node>,
		visible: boolean,
	): void => {
		const run = instance.run;
		const offset = instance.index * run.stride;
		if (run.deferred && run.nodes[offset] === undefined) return;
		const node = rootOf(instance);
		const listCell = run.deferred
			? lists?.get(instance.parent)?.attachedByHandle.get(handle)
			: undefined;
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
		if (visible) activateInstanceWorklets(instance);
		else deactivateInstanceWorklets(instance);
		if (listCell !== undefined) updateCellRefs(instance, visible);
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
		const run = instance.run;
		for (let index = 0; index < run.plan.ranges.length; index++) {
			const site = run.plan.ranges[index]!;
			const rangeKey = instance.rangeKeys?.[index];
			if (rangeKey !== undefined && ranges.has(rangeKey)) {
				fail(
					(typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) &&
						`cannot remove instance ${handle} while range slot ${site.slot} owns children`,
				);
			}
		}
		if (run.deferred) {
			const range = ranges.get(instance.range);
			if (range === undefined) fail(StoreFailure.RangeOrder);
			unlink(instance, range);
			releaseInstance(handle, instance);
			markListDirty(instance.parent);
			undo.push(handle, instance, range, instance.parent, null, JournalOpcode.Remove);
			return;
		}
		const root = rootOf(instance);
		const parent = papi.getParent(root);
		if (parent === null || !papi.isEqual(parent, instance.parent)) fail(StoreFailure.Detached);
		const range = ranges.get(instance.range);
		if (range === undefined) fail(StoreFailure.RangeOrder);
		const nextInstance = instance.next === null ? undefined : instances.get(instance.next)!;
		const before = nextInstance === undefined ? rangeEndAnchor(range) : rootOf(nextInstance);
		deactivateInstanceWorklets(instance);
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
			try {
				activateInstanceWorklets(instance);
			} catch (rollbackError) {
				faulted = true;
				failAggregate(
					[error, rollbackError],
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						'Compiled program worklet remove rollback failed.',
				);
			}
			throw error;
		}
		unlink(instance, range);
		for (const list of listsInInstance(instance)) (pendingListDisposals ??= new Set()).add(list);
		releaseInstance(handle, instance);
		undo.push(handle, instance, range, parent, before, JournalOpcode.Remove);
	};
	const writeSet = (handle: number, slot: number, value: unknown): boolean => {
		const undo = requireJournal();
		if (!Number.isSafeInteger(slot) || slot < 0) fail(StoreFailure.ValueSlot);
		const instance = requireInstance(handle);
		const run = instance.run;
		if (slot >= run.plan.values.length)
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `does not hold value slot ${slot}`);
		if (!isSlotValue(run.plan, slot, value, workletsFor(run.plan))) {
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
			fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'does not have an emitted value-slot setter');
		const nodeOffset = instance.index * run.stride;
		if (run.nodes[nodeOffset] !== undefined) {
			try {
				if (!writePhysicalSlot(instance, slot, value))
					fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `setter refused value slot ${slot}`);
			} catch (error) {
				try {
					if (!writePhysicalSlot(instance, slot, previous)) {
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
		}
		run.values[valueIndex] = value;
		if (run.deferred) markListDirty(instance.parent);
		undo.push(handle, slot, previous, JournalOpcode.Set);
		return true;
	};
	const writeRun = (
		input: LynxCompiledProgramMount<Node>,
		adopted?: LynxCompiledProgramAdoptionSeed<Node>,
	): void => {
		const undo = requireJournal();
		const adoption = adopted !== undefined;
		if (adoption && input.before !== null) {
			fail(StoreFailure.AppendProof);
		}
		requireHandle(input.firstHandle);
		requireCount(input.count);
		const finalHandle = input.firstHandle + input.count - 1;
		if (!Number.isSafeInteger(finalHandle) || finalHandle > MAX_INSTANCE_HANDLE) {
			fail(StoreFailure.HandleRange);
		}
		if (input.firstHandle <= lastHandle) {
			fail(
				LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
					`cannot reuse instance handle ${input.firstHandle}`,
			);
		}
		const plan = input.plan;
		const directWorklets = workletsFor(plan);
		if (typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) {
			if (plan.nodes <= 0) fail(StoreFailure.StructuralProgram);
			const slots = new Set<number>();
			for (const range of plan.ranges) {
				if (
					range.paintsText === true ||
					!Number.isSafeInteger(range.slot) ||
					range.slot < 0 ||
					plan.slots[range.slot] !== 'r' ||
					!Number.isSafeInteger(range.node) ||
					range.node < 0 ||
					range.node >= plan.nodes ||
					(range.before !== undefined &&
						range.before !== null &&
						(!Number.isSafeInteger(range.before) ||
							range.before < 0 ||
							range.before >= plan.nodes ||
							range.before === range.node)) ||
					slots.has(range.slot)
				) {
					fail(`received an invalid structural range ${range.slot}`);
				}
				slots.add(range.slot);
			}
			const refNodes = new Set<number>();
			for (const node of plan.refs ?? []) {
				if (
					!Number.isSafeInteger(node) ||
					node < 0 ||
					node >= plan.nodes ||
					plan.wire?.nodes[node]?.type === '#text' ||
					plan.wire?.nodes[node]?.type === 'raw-text' ||
					refNodes.has(node)
				) {
					fail(`received an invalid ref site ${String(node)}`);
				}
				refNodes.add(node);
			}
		}
		const nodeStride = plan.nodes + plan.ranges.length;
		const valueOffset = input.valueOffset ?? 0;
		if (!Number.isSafeInteger(valueOffset) || valueOffset < 0) {
			fail(StoreFailure.ValueOffset);
		}
		const valueCount = plan.values.length * input.count;
		const valueEnd = valueOffset + valueCount;
		if (
			!Number.isSafeInteger(valueEnd) ||
			valueEnd > input.values.length ||
			(input.valueOffset === undefined && valueEnd !== input.values.length)
		) {
			fail(StoreFailure.ValueArity);
		}
		for (let index = valueOffset; index < valueEnd; index++) {
			const slot = (index - valueOffset) % plan.values.length;
			if (!isSlotValue(plan, slot, input.values[index], directWorklets)) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						`received a value outside slot ${slot}'s scalar kind`,
				);
			}
		}
		const targetValues = input.values.slice(valueOffset, valueEnd);
		const values =
			adoption && adopted.paintedValues !== undefined
				? adopted.paintedValues.slice()
				: targetValues;
		if (values.length !== valueCount) fail(StoreFailure.ValueArity);
		for (let index = 0; index < values.length; index++) {
			const slot = index % plan.values.length;
			if (!isSlotValue(plan, slot, values[index], directWorklets)) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						`received a painted value outside slot ${slot}'s scalar kind`,
				);
			}
		}
		const eventCount = plan.events.length;
		const finalListener = nextListener + eventCount * input.count;
		if (
			eventCount !== 0 &&
			(!Number.isSafeInteger(root) ||
				(root as number) <= 0 ||
				nextListener <= 0 ||
				!Number.isSafeInteger(finalListener))
		) {
			fail(StoreFailure.EventRange);
		}
		if (adoption && adopted.firstListenerId !== (eventCount === 0 ? null : nextListener)) {
			fail(StoreFailure.ListenerIdentity);
		}
		const staticAnchor = input.anchor ?? null;
		if (input.before !== null && staticAnchor !== null) fail(StoreFailure.MoveAnchor);
		if (staticAnchor !== null && !papi.isChild(input.parent, staticAnchor)) {
			fail(StoreFailure.MoveAnchor);
		}
		const rangeKey = rangeKeyOf(input.parent, input.range);
		let range = ranges.get(rangeKey);
		if (range === undefined) {
			range = {
				head: null,
				tail: null,
				before: staticAnchor,
				nextRanges: nextSiblingRangeKeys(input.range),
			};
		} else if (
			input.before === null &&
			((range.before === null) !== (staticAnchor === null) ||
				(range.before !== null &&
					staticAnchor !== null &&
					!papi.isEqual(range.before, staticAnchor)))
		) {
			fail(StoreFailure.MoveAnchor);
		}
		let next: number | null = null;
		if (input.before !== null) {
			requireHandle(input.before);
			const anchor = instances.get(input.before);
			if (anchor === undefined || anchor.range !== rangeKey) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'received an anchor outside the target range',
				);
			}
			next = input.before;
		}
		const previous = next === null ? range.tail : instances.get(next)!.previous;
		const deferred = lists?.has(input.parent) === true;
		if (deferred) {
			const list = lists!.get(input.parent)!;
			if (list.range !== null && list.range !== rangeKey) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						'a native list cannot materialize more than one logical child range',
				);
			}
			list.range = rangeKey;
		}
		let create = creates.get(plan);
		if (create === undefined) {
			// The resolver returns the immutable plan whose digest the two build
			// outputs already compared. Keep compiler-bug diagnostics in development
			// without re-validating that build-owned table in production; every value
			// and identity arriving from the other thread remains checked.
			if (typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) {
				validateResidentNodes(plan);
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
						fail(`received an invalid event site ${site}`);
					}
				}
			}
			create = plan.bind(programHost(plan)) as CompiledProgramCreate;
			if (typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__) {
				if (typeof create.run !== 'function') fail(StoreFailure.RunDriver);
				if ((plan.values.length !== 0 || eventCount !== 0) && typeof create.set !== 'function') {
					fail(StoreFailure.SlotSetter);
				}
			}
			creates.set(plan, create);
		}
		let nodes: (Node | undefined)[];
		if (deferred) {
			if (adoption)
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'cannot adopt native-list rows');
			const rootType = planWire(plan).nodes[0]?.type;
			if (rootType !== 'list-item' || plan.ranges.length !== 0) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						'requires fixed-shape list-item runs under a native list',
				);
			}
			nodes = new Array<Node | undefined>(nodeStride * input.count);
		} else if (adoption) {
			const expectedNodes = nodeStride * input.count;
			if (adopted.nodes.length !== expectedNodes) fail(StoreFailure.AdoptedArity);
			nodes = compactResidentNodes(plan, input.count, nodeStride, adopted.nodes) ?? [
				...adopted.nodes,
			];
		} else {
			const preparedWorklets = directWorklets?.prepareMount(plan, input.count, values) ?? null;
			const physicalValues = preparedWorklets?.values ?? values;
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
			const created = new Array<Node | undefined>(nodeStride * input.count);
			let compact: (Node | undefined)[] | null = null;
			try {
				create.run(pageId, input.count, physicalValues, tokens, [], created);
				preparedWorklets?.publish(created, nodeStride);
				compact = compactResidentNodes(plan, input.count, nodeStride, created);
				const before = next === null ? rangeEndAnchor(range) : rootOf(instances.get(next)!);
				for (let index = 0; index < input.count; index++) {
					const node = created[index * nodeStride];
					if (node === null || node === undefined)
						fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && `did not publish root ${index}`);
					papi.insertBefore(input.parent, node, before);
				}
			} catch (error) {
				const cleanupErrors: unknown[] = [];
				try {
					preparedWorklets?.abort();
				} catch (cleanupError) {
					cleanupErrors.push(cleanupError);
				}
				for (let index = input.count - 1; index >= 0; index--) {
					try {
						cleanupRoot(papi, created[index * nodeStride]);
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
			nodes = compact ?? created;
		}
		if (eventCount !== 0) {
			values.push(adoption ? adopted.firstId : 0, adoption ? adopted.stride : 0);
		}
		const run: CompiledProgramRun<Node> = {
			deferred,
			create,
			count: input.count,
			listener: nextListener,
			nodes,
			plan,
			stride: nodeStride,
			values,
			refFirstId: null,
			refStride: 0,
		};
		if (!deferred) profileRunOwnership(plan, input.count);
		let runPrevious = previous;
		for (let index = 0; index < input.count; index++) {
			const handle = input.firstHandle + index;
			const instance: CompiledProgramInstance<Node> = {
				index,
				parent: input.parent,
				range: rangeKey,
				previous: runPrevious,
				next,
				run,
				visible: true,
			};
			publishInstance(handle, instance);
			relink(handle, instance, range);
			runPrevious = handle;
		}
		undo.push(
			input.firstHandle,
			input.count,
			range,
			adoption ? JournalOpcode.Adopt : JournalOpcode.Mount,
		);
		if (adoption && directWorklets !== null) {
			for (let index = 0; index < input.count; index++) {
				activateInstanceWorklets(instances.get(input.firstHandle + index)!);
			}
		}
		lastHandle = finalHandle;
		nextListener = finalListener;
		if (deferred) markListDirty(input.parent);
		if (adoption && adopted.paintedValues !== undefined) {
			for (let index = 0; index < targetValues.length; index++) {
				if (Object.is(values[index], targetValues[index])) continue;
				const row = Math.floor(index / plan.values.length);
				const slot = index % plan.values.length;
				writeSet(input.firstHandle + row, slot, targetValues[index]);
			}
		}
	};

	return {
		begin() {
			requireHealthy();
			if (journal !== null) fail(StoreFailure.NestedFrame);
			journal = [];
			journalFirstHandle = lastHandle;
			journalFirstRefHost = lastRefHost;
			journalFirstListener = nextListener;
			journalFirstTemplates = templates.length;
			preparedLists = null;
			listCallbackDuringFrame = false;
		},
		prepareCommit() {
			requireJournal();
			prepareDirtyLists();
		},
		commit() {
			requireHealthy();
			if (journal === null) fail(StoreFailure.Commit);
			prepareDirtyLists();
			try {
				for (const prepared of preparedLists!) finalizePreparedList(prepared);
				if (pendingListDisposals !== null) {
					for (const list of pendingListDisposals) disposeList(list);
					pendingListDisposals = null;
				}
			} catch (error) {
				faulted = true;
				throw error;
			}
			preparedLists = null;
			listCallbackDuringFrame = false;
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
		clear(parent, identity) {
			const undo = requireJournal();
			const range = ranges.get(rangeKeyOf(parent, identity));
			while (range !== undefined && range.head !== null) {
				removeInstance(range.head!, undo);
			}
		},
		move(handle, parent, before, anchor = null, identity) {
			const undo = requireJournal();
			const instance = requireInstance(handle);
			const rangeKey = rangeKeyOf(parent, identity);
			if (!papi.isEqual(instance.parent, parent) || instance.range !== rangeKey) {
				fail(StoreFailure.MoveRange);
			}
			const range = ranges.get(rangeKey);
			if (
				range === undefined ||
				(before !== null && anchor !== null) ||
				(before === null &&
					((range.before === null) !== (anchor === null) ||
						(range.before !== null && anchor !== null && !papi.isEqual(range.before, anchor))))
			) {
				fail(StoreFailure.MoveAnchor);
			}
			if (before !== null) {
				requireHandle(before);
				const anchor = instances.get(before);
				if (anchor === undefined || anchor.range !== rangeKey) {
					fail(StoreFailure.MoveAnchor);
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
			writeRun(input, seed?.(input));
		},
		node(instance, index) {
			requireJournal();
			return nodeOf(instance, index);
		},
		range(instance, slot) {
			requireJournal();
			return rangeOf(instance, slot);
		},
		set(handle, slot, value) {
			return writeSet(handle, slot, value);
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
		refs(firstHandle, firstId, stride) {
			requireJournal();
			requireHandle(firstHandle);
			if (firstHandle <= journalFirstHandle) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT &&
						'REF-RUN must follow a mount in the same frame',
				);
			}
			const instance = requireInstance(firstHandle);
			const run = instance.run;
			const refs = run.plan.refs;
			if (!Number.isSafeInteger(root) || (root as number) <= 0) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN requires a positive root identity',
				);
			}
			if (instance.index !== 0 || refs === undefined || refs.length === 0) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN requires a ref-bearing run root');
			}
			requireHandle(firstId);
			if (!Number.isSafeInteger(stride) || stride !== run.plan.nodes) {
				fail(
					LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN stride disagrees with its program',
				);
			}
			const lastHost = firstId + run.count * stride - 1;
			if (!Number.isSafeInteger(lastHost)) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN exhausts logical host identity');
			}
			if (firstId <= lastRefHost) {
				fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN reuses logical host identity');
			}
			if (run.refFirstId !== null) {
				if (run.refFirstId !== firstId || run.refStride !== stride) {
					fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'REF-RUN changes an existing link');
				}
				return;
			}
			lastRefHost = lastHost;
			run.refFirstId = firstId;
			run.refStride = stride;
			if (run.deferred) return;
			for (let row = 0; row < run.count; row++) {
				const offset = row * run.stride;
				for (const node of refs) {
					const physical = run.nodes[offset + node];
					if (physical === undefined)
						fail(LYNX_COMPILED_PROGRAM_STORE_DEVELOPMENT && 'lost a ref-bearing node');
					const id = refId(run, row, node);
					papi.setRefSelector(physical, 'r' + String(root) + '-h' + id + '-g1');
				}
			}
		},
		size() {
			return instances.size;
		},
		isFaulted() {
			return faulted;
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
			if (lists !== null) {
				for (const list of lists.values()) {
					try {
						disposeList(list);
					} catch (error) {
						errors.push(error);
					}
				}
			}
			for (const [handle, instance] of [...instances].reverse()) {
				let rootReleased = instance.run.deferred;
				if (!instance.run.deferred) {
					try {
						deactivateInstanceWorklets(instance);
					} catch (error) {
						errors.push(error);
					}
					try {
						cleanupRoot(papi, rootOf(instance));
						rootReleased = true;
					} catch (error) {
						errors.push(error);
					}
				}
				if (rootReleased) releaseInstance(handle, instance);
			}
			try {
				workletStore?.close();
			} catch (error) {
				errors.push(error);
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
