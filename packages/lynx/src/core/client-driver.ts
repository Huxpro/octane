import type {
	UniversalHostAttachmentBatch,
	UniversalHostBatch,
	UniversalHostDriver,
	UniversalHostPropCodecContext,
	UniversalHostTemplateCapability,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalHostTemplateProgramValue,
	UniversalPortalTargetContext,
	UniversalPortalTargetRegistration,
	UniversalSerializableValue,
	UniversalTemplateHostPlacement,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	LYNX_COMPACT_ACKNOWLEDGEMENT_MIN_HOSTS,
	countLynxCompactAcknowledgementHosts,
	lynxLazyPublicInstancesNegotiated,
	type LynxMainThreadCapabilities,
	type LynxPublicHandleDelta,
	type LynxHostAttachmentChange,
} from './protocol.js';
import { classifyLynxHostPropUpdate, sameLynxUniversalHostPropValue } from './host-props.js';
import { parseLynxNativeEventProp } from './native-events.js';
import { isLynxNativeResource } from '../resource.js';
import {
	getThreadFunctionDescriptor,
	isLynxMainThreadWorkletDescriptor,
	type LynxBackgroundFunctionRegistry,
	type LynxWorkletValue,
} from './worklets.js';
import {
	createLynxNodesRef,
	createLynxNodesRefSelector,
	type LynxCreateSelectorQuery,
	type LynxMeasureOptions,
	type LynxMeasureResult,
	type LynxNodesRefBinding,
	type LynxNodesRefFieldsOptions,
	type LynxNodesRefFieldsResult,
	type LynxNodesRefPathResult,
} from './nodes-ref.js';
import { encodeLynxPortalTargetId } from './portal.js';
import { producedRunProgram } from './run-program.js';

export interface LynxPublicHandle {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly active: boolean;
	/** Physical Element presence; false while a native list cell is recycled. */
	readonly attached: boolean;
	readonly snapshot: UniversalSerializableValue;
	invoke<Result extends UniversalSerializableValue = UniversalSerializableValue>(
		method: string,
		params?: Readonly<Record<string, UniversalSerializableValue>>,
	): Promise<Result>;
	measure(options?: LynxMeasureOptions): Promise<LynxMeasureResult>;
	fields(options: LynxNodesRefFieldsOptions): Promise<LynxNodesRefFieldsResult>;
	path(): Promise<LynxNodesRefPathResult | null>;
	setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>): Promise<void>;
}

/**
 * The background's record of one accepted host node.
 *
 * A mount acknowledges one of these per node, so the entry is the shape the
 * whole subsystem is tuned around: a single monomorphic object holding
 * identity plus mutable acknowledgement state, allocated once and mutated in
 * place. Everything a consumer can *observe* about a node — the frozen
 * `LynxPublicHandle` facade, its `NodesRef` query binding, and the defensive
 * snapshot clone — is built on first use instead. Refs, queries, and portals
 * reach a handful of nodes in a real screen; eagerly building three objects
 * and a WeakMap entry for all of them charged every mount for a feature
 * almost none of its nodes use.
 */
interface LynxHandleEntry {
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	active: boolean;
	attached: boolean;
	listDescendant: boolean;
	attachmentEpoch: number;
	/** Acknowledged snapshot, still owned by the inbound message. */
	rawSnapshot: UniversalSerializableValue | undefined;
	/** Cached defensive clone handed to consumers; built on first read. */
	clonedSnapshot: UniversalSerializableValue | undefined;
	facade: LynxPublicHandle | null;
	binding: LynxNodesRefBinding | null;
	/** Sticky invalidation recorded while `binding` was still unmaterialized. */
	invalidation: { readonly reason: unknown } | null;
}

/** The mutable half of an entry, captured so a rejected acknowledgement can roll back. */
interface LynxHandleStateSnapshot {
	readonly active: boolean;
	readonly attached: boolean;
	readonly listDescendant: boolean;
	readonly attachmentEpoch: number;
	readonly rawSnapshot: UniversalSerializableValue | undefined;
	readonly clonedSnapshot: UniversalSerializableValue | undefined;
}

/** Reverse lookup for the few facades that were actually handed out. */
const FACADE_ENTRY = new WeakMap<LynxPublicHandle, LynxHandleEntry>();

function captureHandleState(entry: LynxHandleEntry): LynxHandleStateSnapshot {
	return {
		active: entry.active,
		attached: entry.attached,
		listDescendant: entry.listDescendant,
		attachmentEpoch: entry.attachmentEpoch,
		rawSnapshot: entry.rawSnapshot,
		clonedSnapshot: entry.clonedSnapshot,
	};
}

function restoreHandleState(
	entry: LynxHandleEntry,
	state: LynxHandleStateSnapshot,
	attachmentEpoch = state.attachmentEpoch,
): void {
	entry.active = state.active;
	entry.attached = state.attached;
	entry.listDescendant = state.listDescendant;
	entry.attachmentEpoch = attachmentEpoch;
	entry.rawSnapshot = state.rawSnapshot;
	entry.clonedSnapshot = state.clonedSnapshot;
}

function nextAttachmentEpoch(entry: LynxHandleEntry, attached: boolean): number {
	if (entry.attached === attached) return entry.attachmentEpoch;
	if (entry.attachmentEpoch === Number.MAX_SAFE_INTEGER) {
		throw new Error('Octane Lynx physical attachment epoch is exhausted.');
	}
	return entry.attachmentEpoch + 1;
}

/**
 * Invalidate a handle's query binding, replaying the reason if the binding has
 * not been materialized yet. An unmaterialized binding owns no pending
 * operations, so nothing observable is deferred by recording the reason here.
 */
function invalidateHandleBinding(entry: LynxHandleEntry, reason: unknown): void {
	if (entry.binding !== null) {
		entry.binding.invalidate(reason);
		return;
	}
	entry.invalidation ??= { reason };
}

/** Reject in-flight operations owned by a detached cell. Inert without a binding. */
function invalidateHandleAttachment(entry: LynxHandleEntry): void {
	entry.binding?.invalidateAttachment();
}

function handleBinding(entry: LynxHandleEntry): LynxNodesRefBinding {
	let binding = entry.binding;
	if (binding !== null) return binding;
	const { root, id, type, generation } = entry;
	const selector = createLynxNodesRefSelector(root, id, generation);
	binding = createLynxNodesRef({
		identity: { root, id, type, generation, selector },
		createSelectorQuery: entry.createSelectorQuery,
		readState() {
			return {
				root,
				id,
				type,
				generation,
				selector,
				active: entry.active && entry.attached,
				attachmentEpoch: entry.attachmentEpoch,
			};
		},
	});
	entry.binding = binding;
	if (entry.invalidation !== null) binding.invalidate(entry.invalidation.reason);
	return binding;
}

/** Build the frozen public facade for one entry, once. */
function handleFacade(entry: LynxHandleEntry): LynxPublicHandle {
	let facade = entry.facade;
	if (facade !== null) return facade;
	facade = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		root: entry.root,
		id: entry.id,
		type: entry.type,
		generation: entry.generation,
		get active(): boolean {
			return entry.active;
		},
		get attached(): boolean {
			return entry.attached;
		},
		get snapshot(): UniversalSerializableValue {
			const snapshot = (entry.rawSnapshot ??= Object.freeze({
				$$kind: 'octane.lynx.element',
				renderer: LYNX_TRANSPORT_RENDERER,
				root: entry.root,
				id: entry.id,
				type: entry.type,
				generation: entry.generation,
				selector: createLynxNodesRefSelector(entry.root, entry.id, entry.generation),
			}));
			return (entry.clonedSnapshot ??= cloneSnapshot(snapshot));
		},
		invoke<Result extends UniversalSerializableValue = UniversalSerializableValue>(
			method: string,
			params?: Readonly<Record<string, UniversalSerializableValue>>,
		) {
			return handleBinding(entry).handle.invoke<Result>(method, params);
		},
		measure(options?: LynxMeasureOptions) {
			return handleBinding(entry).handle.measure(options);
		},
		fields(options: LynxNodesRefFieldsOptions) {
			return handleBinding(entry).handle.fields(options);
		},
		path() {
			return handleBinding(entry).handle.path();
		},
		setNativeProps(props: Readonly<Record<string, UniversalSerializableValue>>) {
			return handleBinding(entry).handle.setNativeProps(props);
		},
	}) as LynxPublicHandle;
	entry.facade = facade;
	FACADE_ENTRY.set(facade, entry);
	return facade;
}

function createHandleEntry(
	root: number,
	id: number,
	type: string,
	generation: number,
	snapshot: UniversalSerializableValue | undefined,
	createSelectorQuery: LynxCreateSelectorQuery,
): LynxHandleEntry {
	return {
		root,
		id,
		type,
		generation,
		createSelectorQuery,
		active: false,
		attached: false,
		listDescendant: false,
		attachmentEpoch: 0,
		rawSnapshot: snapshot,
		clonedSnapshot: undefined,
		facade: null,
		binding: null,
		invalidation: null,
	};
}

interface LynxClientContainerState {
	handles: Map<number, LynxHandleEntry>;
	generations: Map<number, number>;
	compactHosts: LynxCompactHostMetadata | null;
	/** Generation-one tombstones for whole retired runs as sorted [first, last] ranges. */
	retiredRanges: [number, number][];
	readonly worklets?: LynxBackgroundFunctionRegistry;
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	readonly attachmentSubscribers: Set<(batch: UniversalHostAttachmentBatch) => void>;
	templateMount: boolean;
	templateProgramMount: boolean;
	templateProgramRuns: boolean;
	deferredTemplateProgramRuns: boolean;
	addressedProgramRuns: boolean;
	teardownRuns: boolean;
	lazyPublicInstances: boolean;
	/** Hosts a deferred run declared, which main never built. */
	declaredRuns: LynxDeclaredHostRun[] | null;
}

/**
 * One contiguous range of host IDs a deferred template run declared.
 *
 * Main creates nothing for a declared host, so this side never receives a
 * transition for one and never holds a handle. The core owns it as an ordinary
 * host regardless — it updates one whose row scrolled past and destroys one
 * whose row was removed — so the commands naming it have to be recognized here
 * rather than refused as naming a handle that went missing.
 *
 * `live` counts the declared hosts the core has not destroyed yet. It is a
 * count and not the set of surviving offsets on purpose: the set would cost one
 * retained entry per row, which is the cost a deferred run exists to avoid.
 */
interface LynxDeclaredHostRun {
	readonly firstId: number;
	readonly lastId: number;
	live: number;
}

/**
 * The run that declares `id`, or undefined when no host of this container does.
 *
 * A linear scan because a run is one command per native list: a tree carries as
 * many of these as it has lists, not as it has rows.
 */
function declaringHostRun(
	runs: readonly LynxDeclaredHostRun[] | null,
	id: number,
): LynxDeclaredHostRun | undefined {
	if (runs === null) return undefined;
	for (const run of runs) if (id >= run.firstId && id <= run.lastId) return run;
	return undefined;
}

/** One dense typed range owns every untouched generation-one compact host. */
interface LynxCompactHostMetadata {
	readonly root: number;
	readonly base: number;
	readonly types: Uint16Array | null;
	readonly sparse: Map<number, number> | null;
	readonly names: readonly string[];
	active: boolean;
	/** Non-zero codes still reachable; at zero the segment is fully retired. */
	live: number;
}

function compactHostCode(metadata: LynxCompactHostMetadata, id: number): number {
	if (!metadata.active || !Number.isSafeInteger(id)) return 0;
	if (metadata.sparse !== null) return metadata.sparse.get(id) ?? 0;
	const offset = id - metadata.base;
	return offset >= 0 && offset < metadata.types!.length ? metadata.types![offset]! : 0;
}

function setCompactHostCode(metadata: LynxCompactHostMetadata, id: number, code: number): void {
	if (metadata.sparse !== null) {
		const previous = metadata.sparse.get(id) ?? 0;
		if (code === 0) metadata.sparse.delete(id);
		else metadata.sparse.set(id, code);
		metadata.live += (code === 0 ? 0 : 1) - (previous === 0 ? 0 : 1);
		return;
	}
	const offset = id - metadata.base;
	if (offset >= 0 && offset < metadata.types!.length) {
		const previous = metadata.types![offset]!;
		metadata.types![offset] = code;
		metadata.live += (code === 0 ? 0 : 1) - (previous === 0 ? 0 : 1);
	}
}

function retiredRangeGeneration(ranges: readonly [number, number][], id: number): 0 | 1 {
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const range = ranges[middle]!;
		if (id < range[0]) {
			high = middle - 1;
		} else if (id > range[1]) {
			low = middle + 1;
		} else {
			return 1;
		}
	}
	return 0;
}

function compactHandle(state: LynxClientContainerState, id: number): LynxHandleEntry | undefined {
	const existing = state.handles.get(id);
	if (existing !== undefined) return existing;
	const metadata = state.compactHosts;
	if (metadata === null) return undefined;
	const code = compactHostCode(metadata, id);
	if (code === 0) return undefined;
	const entry = createHandleEntry(
		metadata.root,
		id,
		metadata.names[code - 1]!,
		1,
		undefined,
		state.createSelectorQuery,
	);
	entry.active = true;
	entry.attached = true;
	entry.attachmentEpoch = 1;
	state.handles.set(id, entry);
	state.generations.set(id, 1);
	return entry;
}

const CONTAINER_STATE = new WeakMap<LynxClientContainer, LynxClientContainerState>();

export interface LynxClientContainer {
	readonly renderer: typeof LYNX_TRANSPORT_RENDERER;
	getPublicHandle(id: number): LynxPublicHandle | null;
}

export interface CreateLynxClientContainerOptions {
	readonly createSelectorQuery?: LynxCreateSelectorQuery;
	/** Background-owned execution lifetimes embedded in main-thread captures. */
	readonly worklets?: LynxBackgroundFunctionRegistry;
}

export function createLynxClientContainer(
	options: CreateLynxClientContainerOptions = {},
): LynxClientContainer {
	const createSelectorQuery =
		options.createSelectorQuery ??
		(() => {
			throw new Error(
				'Octane Lynx NodesRef requires the public background-thread lynx.createSelectorQuery() API.',
			);
		});
	if (typeof createSelectorQuery !== 'function') {
		throw new TypeError('Octane Lynx createSelectorQuery must be a function when provided.');
	}
	const container: LynxClientContainer = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		getPublicHandle(id: number) {
			const entry = compactHandle(CONTAINER_STATE.get(container)!, id);
			return entry === undefined ? null : handleFacade(entry);
		},
	});
	CONTAINER_STATE.set(container, {
		handles: new Map(),
		generations: new Map(),
		compactHosts: null,
		retiredRanges: [],
		worklets: options.worklets,
		createSelectorQuery,
		attachmentSubscribers: new Set(),
		templateMount: false,
		templateProgramMount: false,
		templateProgramRuns: false,
		deferredTemplateProgramRuns: false,
		addressedProgramRuns: false,
		teardownRuns: false,
		lazyPublicInstances: false,
		declaredRuns: null,
	});
	return container;
}

/**
 * A Lynx background names every host it will query in the batch that mounts it,
 * whatever the session has negotiated.
 *
 * The main thread decides at mount whether a host carries a `nodes-ref`
 * selector, and a root's first batch is composed before the reply that could
 * grant a capability reaches the background. An announcement that waited for
 * that reply would arrive after the decision it exists to inform, which is the
 * whole first screen installing selectors nothing will ever query.
 *
 * An invariant, not a switch: the transport attaches `announces` to every
 * commit unconditionally, and the main thread rejects a lazy commit from a
 * peer that never announced, so nothing is prepared to run with this false.
 * The literal type keeps any future branch on it visibly dead.
 */
export const LYNX_PUBLIC_INSTANCE_ANNOUNCEMENTS = true;

/** @internal Publish capabilities only from this container's correlated ready reply. */
export function setLynxClientCapabilities(
	container: LynxClientContainer,
	capabilities: LynxMainThreadCapabilities | undefined,
): void {
	const state = containerState(container);
	state.templateMount = capabilities?.templateMount === 1;
	state.templateProgramMount = state.templateMount && capabilities?.templateProgram === 1;
	state.templateProgramRuns = state.templateProgramMount && capabilities?.templateRuns === 1;
	state.deferredTemplateProgramRuns =
		state.templateProgramRuns && capabilities?.deferredTemplateRuns === 1;
	// Addressing is a claim about the peer's chunk, not about this one: the
	// background always holds the descriptor it lowered, so what it learns here
	// is whether the main thread compiled the same plans and can resolve a name.
	// Nothing derives this locally — a background that dropped the descriptor
	// from the wire while the peer held no program would mount nothing at all.
	state.addressedProgramRuns =
		state.templateProgramRuns && capabilities?.addressedProgramRuns === 1;
	state.teardownRuns = state.templateProgramMount && capabilities?.teardownRuns === 1;
	// Upstream reads the same three flags inline here. The predicate moved to
	// `protocol.ts` so a core that never builds a driver can ask the same
	// question; the answer is unchanged.
	state.lazyPublicInstances = lynxLazyPublicInstancesNegotiated(capabilities);
}

/**
 * @internal Whether the peer has negotiated intrinsic template runs.
 *
 * `createLynxClientDriver` answers the same question through its capability
 * bag, but a core that never builds a driver — the issue-#103 Block core —
 * still has to respect the negotiation, and pulling the whole driver in to read
 * one flag would put the universal renderer back into a bundle that selected
 * the other core.
 */
export function lynxClientTemplateRunsNegotiated(container: LynxClientContainer): boolean {
	return containerState(container).templateProgramRuns;
}

function collectWorkletExecutionIds(
	value: unknown,
	output: Set<string>,
	seen = new Set<object>(),
): void {
	if (value === null || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const entry of value) collectWorkletExecutionIds(entry, output, seen);
		return;
	}
	const execution = (value as { readonly _execId?: unknown })._execId;
	if (typeof execution === 'string' && execution.length !== 0) output.add(execution);
	for (const entry of Object.values(value)) collectWorkletExecutionIds(entry, output, seen);
}

/**
 * Which value slots of a template program carry a retained main-thread worklet,
 * and which node of an instance owns each one.
 *
 * A `main-thread:ref` is not here: the create path does not retain one either,
 * because a ref cell holds no background closure to give an execution lifetime.
 *
 * The applier, the outbound self-check and the Block core each derive the same
 * fact inside a walk they already perform for their own validation. This layer
 * has no such walk, so it derives it once per program and caches it with the
 * program, which is the same lifetime the other three get from their caches.
 */
interface LynxTemplateProgramWorkletSlots {
	/** Value slots one instance occupies, so a run's flat array can be indexed. */
	readonly arity: number;
	readonly slots: readonly (LynxTemplateProgramWorkletSlot | undefined)[];
}

interface LynxTemplateProgramWorkletSlot {
	readonly node: number;
	readonly name: string;
}

const TEMPLATE_PROGRAM_WORKLET_SLOTS = new WeakMap<
	UniversalHostTemplateProgram,
	LynxTemplateProgramWorkletSlots | null
>();

function templateProgramWorkletSlots(
	program: UniversalHostTemplateProgram,
): LynxTemplateProgramWorkletSlots | null {
	const cached = TEMPLATE_PROGRAM_WORKLET_SLOTS.get(program);
	if (cached !== undefined) return cached;
	let slots: (LynxTemplateProgramWorkletSlot | undefined)[] | null = null;
	let arity = 0;
	for (let node = 0; node < program.nodes.length; node++) {
		for (const binding of program.nodes[node]!.bindings ?? []) {
			if (binding.valueIndex + 1 > arity) arity = binding.valueIndex + 1;
			if (!binding.name.startsWith('main-thread:') || binding.name === 'main-thread:ref') {
				continue;
			}
			(slots ??= [])[binding.valueIndex] = Object.freeze({ node, name: binding.name });
		}
	}
	const derived = slots === null ? null : Object.freeze({ arity, slots: Object.freeze(slots) });
	TEMPLATE_PROGRAM_WORKLET_SLOTS.set(program, derived);
	return derived;
}

/**
 * Background-only ownership recorded without adding fields to the cross-thread
 * batch, keyed by the host that owns the callbacks rather than by the command:
 * one template run installs worklets on many hosts, and each is replaced or
 * destroyed on its own.
 */
const PREPARED_WORKLET_EXECUTIONS = new WeakMap<
	UniversalHostBatch,
	ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<string>>>
>();

/** @internal Background execution ownership for commands that actually retained callbacks. */
export function getLynxClientWorkletBatchExecutions(
	batch: UniversalHostBatch,
): ReadonlyMap<number, ReadonlyMap<number, ReadonlySet<string>>> | undefined {
	return PREPARED_WORKLET_EXECUTIONS.get(batch);
}

/** Bind background closures only after a complete render reaches the transport boundary. */
export function prepareLynxClientWorkletBatch(
	container: LynxClientContainer,
	batch: UniversalHostBatch,
): UniversalHostBatch {
	const worklets = containerState(container).worklets;
	if (worklets === undefined) return batch;
	let retained: Set<string> | undefined;
	let executions: Map<number, ReadonlyMap<number, ReadonlySet<string>>> | undefined;
	let commands: Array<UniversalHostBatch['commands'][number]> | undefined;
	try {
		for (let index = 0; index < batch.commands.length; index++) {
			const command = batch.commands[index]!;
			if (
				command.op === 'mount-template-run' ||
				command.op === 'mount-template-range' ||
				command.op === 'mount-program-run'
			) {
				// The background registered this program before it named it, so the
				// resolution cannot miss here — but a miss must not be read as "no
				// worklet slots", which would silently strip a worklet from a run.
				const wire = producedRunProgram(command) as UniversalHostTemplateProgram | undefined;
				if (wire === undefined) {
					throw new Error(
						'Octane Lynx cannot stage an addressed run whose program this realm does not hold.',
					);
				}
				const program = templateProgramWorkletSlots(wire);
				if (program === null) continue;
				const hostCount = wire.nodes.length;
				let values: UniversalHostTemplateProgramValue[] | undefined;
				let owners: Map<number, Set<string>> | undefined;
				for (let slot = 0; slot < command.values.length; slot++) {
					const binding = program.slots[slot % program.arity];
					if (binding === undefined) continue;
					const value = command.values[slot];
					if (value === null || value === undefined) continue;
					// The prop codec already ran, so this is the descriptor rather than the
					// tagged function the `create` path sees. Accepting both keeps one
					// error for a value neither step could make sense of.
					const descriptor = isLynxMainThreadWorkletDescriptor(value)
						? value
						: getThreadFunctionDescriptor(value);
					if (!isLynxMainThreadWorkletDescriptor(descriptor)) {
						throw new TypeError(
							`Octane Lynx ${JSON.stringify(binding.name)} requires a compiler-transformed main-thread function.`,
						);
					}
					const bound = worklets.retain(descriptor);
					// The host that owns this slot, not the run: an `update` later replaces
					// exactly this host's callbacks, and its `destroy` is what releases them.
					const owner =
						command.firstId + Math.floor(slot / program.arity) * hostCount + binding.node;
					let ids = owners?.get(owner);
					if (ids === undefined) (owners ??= new Map()).set(owner, (ids = new Set()));
					collectWorkletExecutionIds(bound, ids);
					for (const execution of ids) (retained ??= new Set()).add(execution);
					(values ??= [...command.values])[slot] = bound;
				}
				if (values === undefined) continue;
				(commands ??= [...batch.commands])[index] = Object.freeze({
					...command,
					values: Object.freeze(values),
				});
				if (owners !== undefined) {
					for (const [owner, ids] of owners) if (ids.size === 0) owners.delete(owner);
					if (owners.size !== 0) (executions ??= new Map()).set(index, owners);
				}
				continue;
			}
			if (command.op !== 'create' && command.op !== 'update' && command.op !== 'recreate') {
				continue;
			}
			let props: Record<string, unknown> | undefined;
			let commandExecutions: Set<string> | undefined;
			for (const name of Object.keys(command.props)) {
				if (!name.startsWith('main-thread:') || name === 'main-thread:ref') continue;
				const value = command.props[name];
				if (value === null || value === undefined) continue;
				const descriptor = getThreadFunctionDescriptor(value);
				if (!isLynxMainThreadWorkletDescriptor(descriptor)) {
					throw new TypeError(
						`Octane Lynx ${JSON.stringify(name)} requires a compiler-transformed main-thread function.`,
					);
				}
				const bound = worklets.retain(descriptor as LynxWorkletValue);
				collectWorkletExecutionIds(bound, (commandExecutions ??= new Set()));
				for (const execution of commandExecutions) (retained ??= new Set()).add(execution);
				(props ??= { ...command.props })[name] = bound;
			}
			if (props === undefined) continue;
			(commands ??= [...batch.commands])[index] = Object.freeze({
				...command,
				props: Object.freeze(props),
			});
			if (commandExecutions !== undefined && commandExecutions.size !== 0) {
				(executions ??= new Map()).set(index, new Map([[command.id, commandExecutions]]));
			}
		}
		if (commands === undefined) return batch;
		const prepared = Object.freeze({ ...batch, commands: Object.freeze(commands) });
		if (executions !== undefined) PREPARED_WORKLET_EXECUTIONS.set(prepared, executions);
		return prepared;
	} catch (error) {
		if (retained !== undefined) {
			for (const execution of retained) worklets.release(execution);
		}
		throw error;
	}
}

function containerState(container: LynxClientContainer): LynxClientContainerState {
	const state = CONTAINER_STATE.get(container);
	if (state === undefined) {
		throw new TypeError('Octane Lynx client driver received a foreign container.');
	}
	return state;
}

function cloneSnapshot(value: UniversalSerializableValue): UniversalSerializableValue {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return Object.freeze(value.map(cloneSnapshot));
	const source = value as Record<string, UniversalSerializableValue>;
	const output: Record<string, UniversalSerializableValue> = {};
	// Assignment, not defineProperty: this runs once per accepted host node, and
	// a property definition per field is measurably slower. `__proto__` is the
	// one name assignment would route to the prototype setter instead of an own
	// data property, so it keeps the explicit definition.
	for (const name of Object.keys(source)) {
		const child = cloneSnapshot(source[name]!);
		if (name === '__proto__') {
			Object.defineProperty(output, name, {
				configurable: true,
				enumerable: true,
				value: child,
				writable: true,
			});
		} else {
			output[name] = child;
		}
	}
	return Object.freeze(output);
}

function foreignSnapshotIdentity(id: number, name: string): never {
	throw new Error(`Octane Lynx acknowledgement snapshot has foreign ${name} for handle ${id}.`);
}

function validateSnapshotIdentity(
	snapshot: UniversalSerializableValue,
	identity: UniversalTransportIdentity,
	delta: Extract<LynxPublicHandleDelta, { readonly op: 'upsert' }>,
): void {
	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		throw new Error(
			`Octane Lynx acknowledgement snapshot for handle ${delta.id} is not an object.`,
		);
	}
	// One acknowledged node per accepted host node runs this, so the checks are
	// written as direct comparisons: an expected-shape object plus Object.entries
	// allocated two objects and an array of pairs per node, and the selector
	// string was built even when the snapshot already carried a matching one.
	const value = snapshot as Record<string, UniversalSerializableValue>;
	if (value.$$kind !== 'octane.lynx.element') foreignSnapshotIdentity(delta.id, '$$kind');
	if (value.renderer !== LYNX_TRANSPORT_RENDERER) foreignSnapshotIdentity(delta.id, 'renderer');
	if (value.root !== identity.root) foreignSnapshotIdentity(delta.id, 'root');
	if (value.id !== delta.id) foreignSnapshotIdentity(delta.id, 'id');
	if (value.type !== delta.type) foreignSnapshotIdentity(delta.id, 'type');
	if (value.generation !== delta.generation) foreignSnapshotIdentity(delta.id, 'generation');
	if (value.selector !== createLynxNodesRefSelector(identity.root, delta.id, delta.generation)) {
		foreignSnapshotIdentity(delta.id, 'selector');
	}
}

export interface LynxPreparedHandleDeltas {
	apply(): void;
	rollback(): void;
}

interface LynxHandleTransition {
	readonly initial: LynxHandleEntry | undefined;
	present: boolean;
	type: string | null;
	identityChanged: boolean;
	snapshotChanged: boolean;
}

type LynxExpectedHandleDelta = 'none' | 'create' | 'update' | 'recreate' | 'remove';

function expectedHandleDelta(transition: LynxHandleTransition): LynxExpectedHandleDelta {
	if (transition.initial === undefined) return transition.present ? 'create' : 'none';
	if (!transition.present) return 'remove';
	if (transition.identityChanged) return 'recreate';
	return transition.snapshotChanged ? 'update' : 'none';
}

/**
 * Derive initial, fully attached identities from the background's own trusted
 * batch. No main-owned snapshot crosses the wire; public snapshots/selectors
 * are reconstructed only when a ref or query actually observes one.
 */
export function prepareLynxCompactHandleDeltas(
	container: LynxClientContainer,
	batch: UniversalHostBatch,
	count: number,
	identity: UniversalTransportIdentity,
	knownHostCount?: number,
	incremental = false,
): LynxPreparedHandleDeltas {
	const state = containerState(container);
	if (
		identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
		identity.renderer !== LYNX_TRANSPORT_RENDERER ||
		batch.renderer !== LYNX_TRANSPORT_RENDERER ||
		identity.version !== batch.version ||
		!Number.isSafeInteger(identity.root) ||
		identity.root <= 0
	) {
		throw new Error('Octane Lynx compact acknowledgement has a foreign transport identity.');
	}
	if (
		state.compactHosts !== null ||
		(!incremental && (state.handles.size !== 0 || state.generations.size !== 0))
	) {
		throw new Error('Octane Lynx compact acknowledgement requires a fresh client container.');
	}
	if (
		!Number.isSafeInteger(count) ||
		count < LYNX_COMPACT_ACKNOWLEDGEMENT_MIN_HOSTS ||
		(knownHostCount === undefined
			? countLynxCompactAcknowledgementHosts(batch, producedRunProgram) !== count
			: knownHostCount !== count)
	) {
		throw new Error('Octane Lynx compact acknowledgement has a mismatched host count or batch.');
	}

	const originalHandles = state.handles;
	const originalGenerations = state.generations;
	const originalCompactHosts = state.compactHosts;
	if (incremental) {
		const run = batch.commands.length === 1 ? batch.commands[0] : undefined;
		if (
			(run?.op !== 'mount-template-run' && run?.op !== 'mount-program-run') ||
			!Object.isFrozen(run) ||
			!Object.isFrozen(run.values) ||
			// The same statement for either shape: nothing this acknowledgement
			// stages handles against can be mutated afterwards. A descriptor run
			// carries the program, an addressed one carries the name of one — the
			// program it names is resident and was frozen when its chunk registered
			// it, which is not this side's object to check.
			!Object.isFrozen(run.op === 'mount-program-run' ? run.address : run.program) ||
			!Number.isSafeInteger(run.firstId) ||
			run.firstId <= 0 ||
			run.firstId > Number.MAX_SAFE_INTEGER - (count - 1)
		) {
			throw new Error('Octane Lynx incremental acknowledgement requires one frozen host run.');
		}
		const finalId = run.firstId + (count - 1);
		for (const [id, handle] of originalHandles) {
			if (handle.root !== identity.root || (id >= run.firstId && id <= finalId)) {
				throw new Error('Octane Lynx incremental acknowledgement overlaps an accepted handle.');
			}
		}
		for (const id of originalGenerations.keys()) {
			if (id >= run.firstId && id <= finalId) {
				throw new Error('Octane Lynx incremental acknowledgement reuses a retired handle.');
			}
		}
		for (const [first, last] of state.retiredRanges) {
			if (!(finalId < first || run.firstId > last)) {
				throw new Error('Octane Lynx incremental acknowledgement reuses a retired handle.');
			}
		}
	}
	const stagedHandles = new Map<number, LynxHandleEntry>(incremental ? originalHandles : undefined);
	const stagedGenerations = new Map<number, number>(incremental ? originalGenerations : undefined);
	const names: string[] = [];
	const codes = new Map<string, number>();
	let base = 0;
	let dense: Uint16Array | null = null;
	let sparse: Map<number, number> | null = null;
	let stagedCount = 0;
	const patterns = new WeakMap<UniversalHostTemplateProgram, Uint16Array>();
	const typeCode = (type: string): number => {
		if (typeof type !== 'string' || type.length === 0) {
			throw new Error('Octane Lynx compact acknowledgement contains an invalid host identity.');
		}
		let code = codes.get(type);
		if (code === undefined) {
			code = names.push(type);
			codes.set(type, code);
		}
		return code;
	};
	const initializeDense = (id: number): void => {
		base = id;
		// Logical owner/range IDs share the allocator with physical hosts. A
		// keyed row therefore leaves ordinary holes; twice the host count
		// keeps that common near-contiguous layout dense without allocating
		// across an attacker-sized sparse ID range.
		dense = new Uint16Array(count * 2);
	};
	const stage = (id: number, type: string): void => {
		if (!Number.isSafeInteger(id) || id <= 0) {
			throw new Error('Octane Lynx compact acknowledgement contains an invalid host identity.');
		}
		const code = typeCode(type);
		if (stagedCount === 0) {
			initializeDense(id);
		}
		const offset = id - base;
		if (sparse === null && (offset < 0 || offset >= dense!.length || code > 0xffff)) {
			sparse = new Map<number, number>();
			for (let index = 0; index < dense!.length; index++) {
				const prior = dense![index]!;
				if (prior !== 0) sparse.set(base + index, prior);
			}
			dense = null;
		}
		if (sparse !== null) {
			if (sparse.has(id)) {
				throw new Error(`Octane Lynx compact acknowledgement repeats handle ${id}.`);
			}
			sparse.set(id, code);
		} else {
			if (dense![offset] !== 0) {
				throw new Error(`Octane Lynx compact acknowledgement repeats handle ${id}.`);
			}
			dense![offset] = code;
		}
		stagedCount++;
	};
	const stageProgramRange = (firstId: number, program: UniversalHostTemplateProgram): void => {
		const length = program.nodes.length;
		if (
			!Number.isSafeInteger(firstId) ||
			firstId <= 0 ||
			length === 0 ||
			firstId > Number.MAX_SAFE_INTEGER - (length - 1)
		) {
			throw new Error('Octane Lynx compact acknowledgement contains an invalid host identity.');
		}
		let pattern = patterns.get(program);
		if (pattern === undefined) {
			pattern = new Uint16Array(length);
			let immutable = Object.isFrozen(program) && Object.isFrozen(program.nodes);
			for (let index = 0; index < length; index++) {
				const node = program.nodes[index]!;
				if (immutable && !Object.isFrozen(node)) immutable = false;
				const code = typeCode(node.type);
				if (code > 0xffff) {
					for (let fallback = 0; fallback < length; fallback++) {
						stage(firstId + fallback, program.nodes[fallback]!.type);
					}
					return;
				}
				pattern[index] = code;
			}
			if (immutable) patterns.set(program, pattern);
		}
		if (stagedCount === 0) initializeDense(firstId);
		const offset = firstId - base;
		if (sparse === null && offset >= 0 && offset <= dense!.length - length) {
			for (let index = 0; index < length; index++) {
				if (dense![offset + index] !== 0) {
					throw new Error(`Octane Lynx compact acknowledgement repeats handle ${firstId + index}.`);
				}
			}
			dense!.set(pattern, offset);
			stagedCount += length;
			return;
		}
		for (let index = 0; index < length; index++) {
			stage(firstId + index, program.nodes[index]!.type);
		}
	};
	for (let index = 0; index < batch.commands.length; index++) {
		const command = batch.commands[index]!;
		if (command.op === 'create') {
			stage(command.id, command.type);
		} else if (command.op === 'mount-template') {
			for (let node = 0; node < command.nodes.length; node++) {
				stage(command.nodes[node]!.id, command.shape[node]!.type);
			}
		} else if (command.op === 'mount-template-range') {
			stageProgramRange(command.firstId, command.program);
		} else if (command.op === 'mount-template-run' || command.op === 'mount-program-run') {
			const wire = producedRunProgram(command) as UniversalHostTemplateProgram | undefined;
			if (wire === undefined) {
				throw new Error(
					'Octane Lynx compact acknowledgement names a program this realm does not hold.',
				);
			}
			const length = wire.nodes.length;
			const hosts = command.count * length;
			if (
				!Number.isSafeInteger(command.count) ||
				command.count <= 0 ||
				!Number.isSafeInteger(hosts) ||
				command.firstId > Number.MAX_SAFE_INTEGER - (hosts - 1)
			) {
				throw new Error('Octane Lynx compact acknowledgement contains an invalid host identity.');
			}
			stageProgramRange(command.firstId, wire);
			if (command.count === 1) continue;
			const offset = command.firstId - base;
			if (sparse === null && offset >= 0 && offset <= dense!.length - hosts) {
				for (let node = length; node < hosts; node++) {
					if (dense![offset + node] !== 0) {
						throw new Error(
							`Octane Lynx compact acknowledgement repeats handle ${command.firstId + node}.`,
						);
					}
				}
				let written = length;
				while (written < hosts) {
					const next = Math.min(written, hosts - written);
					dense!.copyWithin(offset + written, offset, offset + next);
					written += next;
				}
				stagedCount += hosts - length;
				continue;
			}
			for (let instance = 1; instance < command.count; instance++) {
				stageProgramRange(command.firstId + instance * length, wire);
			}
		}
	}
	if (stagedCount !== count) {
		throw new Error('Octane Lynx compact acknowledgement omitted an accepted host.');
	}
	const stagedCompactHosts: LynxCompactHostMetadata = {
		root: identity.root,
		base,
		types: dense,
		sparse,
		names,
		active: true,
		live: stagedCount,
	};

	let applied = false;
	let rolledBack = false;
	return {
		apply() {
			if (applied || rolledBack) return;
			applied = true;
			state.handles = stagedHandles;
			state.generations = stagedGenerations;
			state.compactHosts = stagedCompactHosts;
		},
		rollback() {
			if (!applied || rolledBack) return;
			rolledBack = true;
			stagedCompactHosts.active = false;
			state.handles = originalHandles;
			state.generations = originalGenerations;
			state.compactHosts = originalCompactHosts;
			for (const [id, handle] of stagedHandles) {
				if (originalHandles.get(id) === handle) continue;
				handle.active = false;
				handle.attached = false;
				if (handle.facade !== null || handle.binding !== null) {
					invalidateHandleBinding(
						handle,
						new Error(`Octane Lynx handle ${handle.id}:${handle.generation} was rolled back.`),
					);
				}
			}
		},
	};
}

/** @internal Used by the background transport immediately before core ACK. */
export function prepareLynxHandleDeltas(
	container: LynxClientContainer,
	batch: UniversalHostBatch,
	deltas: readonly LynxPublicHandleDelta[],
	identity: UniversalTransportIdentity,
): LynxPreparedHandleDeltas {
	const state = containerState(container);
	if (
		identity.protocol !== LYNX_TRANSPORT_PROTOCOL_VERSION ||
		identity.renderer !== LYNX_TRANSPORT_RENDERER ||
		batch.renderer !== LYNX_TRANSPORT_RENDERER ||
		identity.version !== batch.version ||
		!Number.isSafeInteger(identity.root) ||
		identity.root <= 0
	) {
		throw new Error('Octane Lynx acknowledgement has a foreign transport identity.');
	}
	const originalHandles = state.handles;
	const stagedHandles = new Map<number, LynxHandleEntry | null>();
	const finalHandle = (id: number): LynxHandleEntry | undefined => {
		if (!stagedHandles.has(id)) return compactHandle(state, id);
		return stagedHandles.get(id) ?? undefined;
	};
	// Staged rather than applied while scanning: a preparation that is rolled
	// back must leave the ledger exactly as it found it, and nothing here reads
	// a run's liveness during the scan.
	let stagedDeclaredRuns: LynxDeclaredHostRun[] | null = null;
	let declaredDestroys: Map<LynxDeclaredHostRun, number> | null = null;
	const declaredRun = (id: number): LynxDeclaredHostRun | undefined =>
		declaringHostRun(stagedDeclaredRuns, id) ?? declaringHostRun(state.declaredRuns, id);
	const transitions = new Map<number, LynxHandleTransition>();
	const transitionFor = (id: number): LynxHandleTransition => {
		let transition = transitions.get(id);
		if (transition !== undefined) return transition;
		const initial = compactHandle(state, id);
		transition = {
			initial,
			present: initial !== undefined,
			type: initial?.type ?? null,
			identityChanged: false,
			snapshotChanged: false,
		};
		transitions.set(id, transition);
		return transition;
	};
	const runCommands: { firstId: number; hostCount: number; remaining: number }[] = [];
	for (const command of batch.commands) {
		if (command.op === 'destroy-run') {
			const hostCount = command.count * command.width;
			runCommands.push({ firstId: command.firstId, hostCount, remaining: hostCount });
			continue;
		}
		if (command.op === 'mount-template-run' || command.op === 'mount-program-run') {
			const wire = producedRunProgram(command) as UniversalHostTemplateProgram | undefined;
			if (wire === undefined) {
				throw new Error('Octane Lynx batch names a program this realm does not hold.');
			}
			// A declared instance is not a host yet, so main creates nothing for it
			// and there is no transition to acknowledge. Remember the range: the
			// core goes on owning these hosts, and the updates and destroys it
			// sends for them name handles this side will never hold.
			if (command.deferred === true) {
				const hosts = wire.nodes.length * command.count;
				(stagedDeclaredRuns ??= []).push({
					firstId: command.firstId,
					lastId: command.firstId + hosts - 1,
					live: hosts,
				});
				continue;
			}
			const length = wire.nodes.length;
			for (let instance = 0; instance < command.count; instance++) {
				const firstId = command.firstId + instance * length;
				for (let index = 0; index < length; index++) {
					const id = firstId + index;
					const transition = transitionFor(id);
					if (transition.present) {
						throw new Error(`Octane Lynx batch creates existing handle ${id}.`);
					}
					transition.present = true;
					transition.type = wire.nodes[index]!.type;
					transition.snapshotChanged = true;
				}
			}
			continue;
		}
		if (command.op === 'mount-template-range') {
			for (let index = 0; index < command.program.nodes.length; index++) {
				const id = command.firstId + index;
				const transition = transitionFor(id);
				if (transition.present) {
					throw new Error(`Octane Lynx batch creates existing handle ${id}.`);
				}
				transition.present = true;
				transition.type = command.program.nodes[index]!.type;
				transition.snapshotChanged = true;
			}
			continue;
		}
		if (command.op === 'mount-template') {
			for (let index = 0; index < command.nodes.length; index++) {
				const node = command.nodes[index]!;
				const transition = transitionFor(node.id);
				if (transition.present) {
					throw new Error(`Octane Lynx batch creates existing handle ${node.id}.`);
				}
				transition.present = true;
				transition.type = command.shape[index]!.type;
				transition.snapshotChanged = true;
			}
			continue;
		}
		if (
			command.op !== 'create' &&
			command.op !== 'update' &&
			command.op !== 'recreate' &&
			command.op !== 'destroy'
		) {
			continue;
		}
		const declared = declaredRun(command.id);
		if (declared !== undefined) {
			// No handle exists for a declared host, so an update moves no identity
			// and a destroy releases none. Both are ordinary core commands against
			// a host main has not built; only building one would be a fault, and
			// the core does that by mounting it eagerly instead.
			if (command.op === 'update') continue;
			if (command.op === 'destroy') {
				declaredDestroys ??= new Map();
				declaredDestroys.set(declared, (declaredDestroys.get(declared) ?? 0) + 1);
				continue;
			}
			throw new Error(`Octane Lynx batch rebuilds declared handle ${command.id}.`);
		}
		const transition = transitionFor(command.id);
		if (command.op === 'create') {
			if (transition.present) {
				throw new Error(`Octane Lynx batch creates existing handle ${command.id}.`);
			}
			transition.present = true;
			transition.type = command.type;
			transition.snapshotChanged = true;
		} else if (command.op === 'update') {
			if (!transition.present) {
				throw new Error(`Octane Lynx batch updates missing handle ${command.id}.`);
			}
			transition.snapshotChanged = true;
		} else if (command.op === 'recreate') {
			if (!transition.present || transition.type !== command.type) {
				throw new Error(`Octane Lynx batch recreates invalid handle ${command.id}.`);
			}
			transition.identityChanged = true;
			transition.snapshotChanged = true;
		} else {
			if (!transition.present) {
				throw new Error(`Octane Lynx batch destroys missing handle ${command.id}.`);
			}
			transition.present = false;
			transition.type = null;
			transition.identityChanged = true;
		}
	}

	const seen = new Set<number>();
	const priorStates = new Map<LynxHandleEntry, LynxHandleStateSnapshot>();
	const nextStates = new Map<LynxHandleEntry, LynxHandleStateSnapshot>();
	const createdHandles = new Set<LynxHandleEntry>();
	const priorGenerations = new Map<number, number | undefined>();
	const nextGenerations = new Map<number, number>();
	// Main owns the accepted host topology and publishes this derived bit. The
	// command gate prevents ancestry state from changing on a non-structural ACK;
	// identity, generation, transition, and change checks guard its lifecycle.
	let hasTopologyMutation: boolean | undefined;
	const stageGeneration = (id: number, generation: number) => {
		if (!priorGenerations.has(id)) priorGenerations.set(id, state.generations.get(id));
		nextGenerations.set(id, generation);
	};
	const runRemovals: {
		firstId: number;
		hostCount: number;
		entries: LynxHandleEntry[];
	}[] = [];
	for (const delta of deltas) {
		if (delta.op === 'remove-run') {
			const matched = runCommands.findIndex(
				(candidate) =>
					candidate.firstId === delta.firstId &&
					candidate.hostCount === delta.hostCount &&
					candidate.remaining === candidate.hostCount,
			);
			if (matched === -1 || delta.generation !== 1) {
				throw new Error(
					`Octane Lynx acknowledgement retires an uncommanded run ${delta.firstId}+${delta.hostCount}.`,
				);
			}
			runCommands.splice(matched, 1);
			const last = delta.firstId + delta.hostCount - 1;
			const entries: LynxHandleEntry[] = [];
			for (const [id, entry] of state.handles) {
				if (id >= delta.firstId && id <= last) {
					entries.push(entry);
					priorStates.set(entry, captureHandleState(entry));
				}
			}
			runRemovals.push({ firstId: delta.firstId, hostCount: delta.hostCount, entries });
			continue;
		}
		if (seen.has(delta.id)) {
			throw new Error(`Octane Lynx acknowledgement repeats handle ${delta.id}.`);
		}
		seen.add(delta.id);
		let transition = transitions.get(delta.id);
		if (transition === undefined && delta.op === 'remove') {
			// A destroy-run command creates no per-host transitions; when the
			// main thread answers one with per-host removals (partial ranges or
			// explicit-path stores), derive the destroyed transition on demand.
			const covered = runCommands.find(
				(candidate) =>
					delta.id >= candidate.firstId && delta.id < candidate.firstId + candidate.hostCount,
			);
			if (covered !== undefined) {
				transition = transitionFor(delta.id);
				if (transition.present) {
					transition.present = false;
					transition.type = null;
					transition.identityChanged = true;
					covered.remaining -= 1;
				}
			}
		}
		const expected = transition === undefined ? 'none' : expectedHandleDelta(transition);
		if (delta.op === 'list-ancestry') {
			hasTopologyMutation ??= batch.commands.some(
				(command) => command.op === 'insert' || command.op === 'move' || command.op === 'remove',
			);
			const handle = compactHandle(state, delta.id);
			if (
				!hasTopologyMutation ||
				expected !== 'none' ||
				handle === undefined ||
				!handle.active ||
				handle.root !== identity.root ||
				handle.generation !== delta.generation
			) {
				throw new Error(
					`Octane Lynx acknowledgement changes list ancestry for stale or transitioning handle ${delta.id}:${delta.generation}.`,
				);
			}
			if (handle.listDescendant === delta.listDescendant) {
				throw new Error(
					`Octane Lynx acknowledgement publishes unchanged list ancestry for handle ${delta.id}.`,
				);
			}
			priorStates.set(handle, captureHandleState(handle));
			nextStates.set(handle, {
				...captureHandleState(handle),
				listDescendant: delta.listDescendant,
			});
			continue;
		}
		if (transition === undefined || expected === 'none') {
			throw new Error(`Octane Lynx acknowledgement publishes unchanged handle ${delta.id}.`);
		}
		if (delta.op === 'remove') {
			if (expected !== 'remove') {
				throw new Error(`Octane Lynx acknowledgement removes non-destroyed handle ${delta.id}.`);
			}
			const previous = transition.initial!;
			if (previous.generation !== delta.generation) {
				throw new Error(
					`Octane Lynx acknowledgement removes stale handle ${delta.id}:${delta.generation}.`,
				);
			}
			priorStates.set(previous, captureHandleState(previous));
			stagedHandles.set(delta.id, null);
			continue;
		}

		if (expected === 'remove') {
			throw new Error(`Octane Lynx acknowledgement retains destroyed handle ${delta.id}.`);
		}
		validateSnapshotIdentity(delta.snapshot, identity, delta);
		const finalType = transition.type!;
		if (expected === 'create') {
			const previousGeneration =
				state.generations.get(delta.id) ?? retiredRangeGeneration(state.retiredRanges, delta.id);
			if (delta.type !== finalType || delta.generation <= previousGeneration) {
				throw new Error(`Octane Lynx acknowledgement has invalid created handle ${delta.id}.`);
			}
			const handle = createHandleEntry(
				identity.root,
				delta.id,
				delta.type,
				delta.generation,
				delta.snapshot,
				state.createSelectorQuery,
			);
			createdHandles.add(handle);
			stageGeneration(delta.id, delta.generation);
			// A handle this preparation just built is unreachable until apply()
			// publishes it into `state.handles`, so its state is written directly
			// rather than staged. Rollback drops the handle outright, so there is
			// no prior state to restore. This keeps a mount from allocating two
			// state clones and two map entries per accepted node.
			handle.active = true;
			handle.attachmentEpoch = nextAttachmentEpoch(handle, delta.attached);
			handle.attached = delta.attached;
			handle.listDescendant = delta.listDescendant;
			stagedHandles.set(delta.id, handle);
			continue;
		}
		const previous = transition.initial!;
		if (previous.root !== identity.root) {
			throw new Error(`Octane Lynx acknowledgement changes root for retained handle ${delta.id}.`);
		}
		if (expected === 'recreate') {
			const previousGeneration = state.generations.get(delta.id) ?? previous.generation;
			if (
				delta.type !== finalType ||
				delta.generation <= previous.generation ||
				delta.generation <= previousGeneration
			) {
				throw new Error(`Octane Lynx acknowledgement has stale recreated handle ${delta.id}.`);
			}
			priorStates.set(previous, captureHandleState(previous));
			const handle = createHandleEntry(
				identity.root,
				delta.id,
				delta.type,
				delta.generation,
				delta.snapshot,
				state.createSelectorQuery,
			);
			createdHandles.add(handle);
			stageGeneration(delta.id, delta.generation);
			// A handle this preparation just built is unreachable until apply()
			// publishes it into `state.handles`, so its state is written directly
			// rather than staged. Rollback drops the handle outright, so there is
			// no prior state to restore. This keeps a mount from allocating two
			// state clones and two map entries per accepted node.
			handle.active = true;
			handle.attachmentEpoch = nextAttachmentEpoch(handle, delta.attached);
			handle.attached = delta.attached;
			handle.listDescendant = delta.listDescendant;
			stagedHandles.set(delta.id, handle);
			continue;
		}
		if (delta.type !== finalType || delta.generation !== previous.generation) {
			throw new Error(`Octane Lynx acknowledgement changes retained handle ${delta.id}.`);
		}
		priorStates.set(previous, captureHandleState(previous));
		nextStates.set(previous, {
			active: true,
			attached: delta.attached,
			listDescendant: delta.listDescendant,
			attachmentEpoch: nextAttachmentEpoch(previous, delta.attached),
			rawSnapshot: delta.snapshot,
			clonedSnapshot: undefined,
		});
	}

	for (const [id, transition] of transitions) {
		if (seen.has(id)) continue;
		const expected = expectedHandleDelta(transition);
		if (expected !== 'none') {
			throw new Error(`Octane Lynx acknowledgement omits ${expected}d handle ${id}.`);
		}
	}
	for (const command of runCommands) {
		if (command.remaining !== 0) {
			throw new Error(
				`Octane Lynx acknowledgement omits destroyed run ${command.firstId}+${command.hostCount}.`,
			);
		}
	}

	const removedCompactHosts = new Map<number, number>();
	const pushedRetiredRanges: [number, number][] = [];
	let restoreRetiredCompactHosts: () => void = () => {};
	let applied = false;
	let rolledBack = false;
	return {
		apply() {
			if (applied || rolledBack) return;
			applied = true;
			for (const handle of priorStates.keys()) {
				if (finalHandle(handle.id) !== handle) {
					handle.active = false;
					handle.attached = false;
					invalidateHandleBinding(
						handle,
						new Error(`Octane Lynx handle ${handle.id}:${handle.generation} was replaced.`),
					);
				}
			}
			for (const [handle, next] of nextStates) {
				const detached = handle.attached && !next.attached;
				restoreHandleState(handle, next);
				if (detached) invalidateHandleAttachment(handle);
			}
			// forEach, not for-of destructuring: Map iteration allocates an iterator
			// result and a two-element entry array per step, and a mount walks one
			// entry per accepted node.
			let retiredCompactHosts: LynxCompactHostMetadata | null = null;
			for (const removal of runRemovals) {
				const last = removal.firstId + removal.hostCount - 1;
				for (const entry of removal.entries) {
					state.handles.delete(entry.id);
					entry.active = false;
					entry.attached = false;
					invalidateHandleBinding(
						entry,
						new Error(`Octane Lynx handle ${entry.id}:${entry.generation} was removed.`),
					);
				}
				const metadata = state.compactHosts;
				if (metadata !== null) {
					for (let id = removal.firstId; id <= last; id++) {
						const code = compactHostCode(metadata, id);
						if (code !== 0) {
							removedCompactHosts.set(id, code);
							setCompactHostCode(metadata, id, 0);
						}
					}
				}
			}
			for (const removal of runRemovals) {
				const range: [number, number] = [removal.firstId, removal.firstId + removal.hostCount - 1];
				pushedRetiredRanges.push(range);
				state.retiredRanges.push(range);
			}
			// Exact remove-run acknowledgements were spliced above; every
			// remaining command reached zero through complete per-host removals.
			for (const removal of runCommands) {
				const range: [number, number] = [removal.firstId, removal.firstId + removal.hostCount - 1];
				pushedRetiredRanges.push(range);
				state.retiredRanges.push(range);
			}
			if (pushedRetiredRanges.length !== 0) {
				state.retiredRanges.sort((a, b) => a[0] - b[0]);
			}
			stagedHandles.forEach((handle, id) => {
				if (handle === null) {
					originalHandles.delete(id);
					const metadata = state.compactHosts;
					if (metadata !== null) {
						const code = compactHostCode(metadata, id);
						if (code !== 0) {
							removedCompactHosts.set(id, code);
							setCompactHostCode(metadata, id, 0);
						}
					}
				} else {
					originalHandles.set(id, handle);
				}
			});
			// A fully retired segment leaves no reachable compact host, so drop
			// the metadata: the container is back to explicit handles only and a
			// later pure template mount may negotiate a fresh incremental
			// compact acknowledgement.
			if (state.compactHosts !== null && state.compactHosts.live === 0) {
				retiredCompactHosts = state.compactHosts;
				retiredCompactHosts.active = false;
				state.compactHosts = null;
			}
			restoreRetiredCompactHosts = () => {
				if (retiredCompactHosts !== null) {
					retiredCompactHosts.active = true;
					state.compactHosts = retiredCompactHosts;
					retiredCompactHosts = null;
				}
			};
			nextGenerations.forEach((generation, id) => state.generations.set(id, generation));
			if (stagedDeclaredRuns !== null || declaredDestroys !== null) {
				let runs = state.declaredRuns === null ? [] : state.declaredRuns;
				if (stagedDeclaredRuns !== null) runs = [...runs, ...stagedDeclaredRuns];
				if (declaredDestroys !== null) {
					declaredDestroys.forEach((count, run) => {
						run.live -= count;
					});
					runs = runs.filter((run) => run.live > 0);
				}
				state.declaredRuns = runs.length === 0 ? null : runs;
			}
		},
		rollback() {
			if (!applied || rolledBack) return;
			rolledBack = true;
			restoreRetiredCompactHosts();
			if (state.compactHosts !== null) {
				for (const [id, code] of removedCompactHosts) {
					setCompactHostCode(state.compactHosts, id, code);
				}
			}
			if (pushedRetiredRanges.length !== 0) {
				state.retiredRanges = state.retiredRanges.filter(
					(range) => !pushedRetiredRanges.includes(range),
				);
				for (const removal of runRemovals) {
					for (const entry of removal.entries) {
						state.handles.set(entry.id, entry);
					}
				}
			}
			for (const id of stagedHandles.keys()) {
				const previous = transitions.get(id)?.initial;
				if (previous === undefined) originalHandles.delete(id);
				else originalHandles.set(id, previous);
			}
			for (const [handle, previous] of priorStates) {
				const detached = handle.attached && !previous.attached;
				restoreHandleState(handle, previous, nextAttachmentEpoch(handle, previous.attached));
				if (detached) invalidateHandleAttachment(handle);
			}
			for (const handle of createdHandles) {
				handle.active = false;
				handle.attached = false;
				invalidateHandleBinding(
					handle,
					new Error(`Octane Lynx handle ${handle.id}:${handle.generation} was rolled back.`),
				);
			}
			for (const [id, previous] of priorGenerations) {
				if (previous === undefined) state.generations.delete(id);
				else state.generations.set(id, previous);
			}
		},
	};
}

/**
 * @internal Whether a decoded native event token still names a live, physically
 * attached host of this container.
 *
 * The engine delivers a background `bind*` event straight to this thread, so
 * this is the background's own staleness gate: it stands in for the main-thread
 * host-tree check that a main-delivered event would get.
 */
export function isLynxClientEventTarget(
	container: LynxClientContainer,
	root: number,
	id: number,
	generation: number,
): boolean {
	const state = containerState(container);
	const entry = state.handles.get(id);
	if (entry !== undefined) {
		return entry.active && entry.attached && entry.root === root && entry.generation === generation;
	}
	const metadata = state.compactHosts;
	return (
		metadata !== null &&
		metadata.root === root &&
		generation === 1 &&
		compactHostCode(metadata, id) !== 0
	);
}

/** @internal Releases query handles when their background transport closes. */
export function invalidateLynxClientContainer(container: LynxClientContainer): void {
	const state = containerState(container);
	if (state.compactHosts !== null) {
		state.compactHosts.active = false;
		state.compactHosts = null;
	}
	state.declaredRuns = null;
	const handles = [...state.handles.values()];
	const subscribers = [...state.attachmentSubscribers];
	const detached: number[] = [];
	let hasError = false;
	let firstError: unknown;
	const capture = (work: () => void) => {
		try {
			work();
		} catch (error) {
			if (!hasError) {
				hasError = true;
				firstError = error;
			}
		}
	};
	for (const handle of handles) {
		if (handle.active && handle.attached) {
			capture(() => {
				handle.attachmentEpoch = nextAttachmentEpoch(handle, false);
			});
			handle.attached = false;
			detached.push(handle.id);
			capture(() => invalidateHandleAttachment(handle));
		}
		handle.active = false;
		handle.attached = false;
		capture(() =>
			invalidateHandleBinding(
				handle,
				new Error(`Octane Lynx handle ${handle.id}:${handle.generation} was disposed.`),
			),
		);
	}
	state.handles = new Map();
	try {
		if (detached.length !== 0) {
			const batch = Object.freeze({
				detached: Object.freeze(detached),
				attached: Object.freeze([] as number[]),
			});
			for (const subscriber of subscribers) capture(() => subscriber(batch));
		}
	} finally {
		state.attachmentSubscribers.clear();
	}
	if (hasError) throw firstError;
}

/** Apply one generation-gated native list attachment message and notify refs. */
export function applyLynxHostAttachments(
	container: LynxClientContainer,
	changes: readonly LynxHostAttachmentChange[],
): UniversalHostAttachmentBatch {
	if (!Array.isArray(changes)) {
		throw new TypeError('Octane Lynx host attachment changes must be an array.');
	}
	const state = containerState(container);
	const staged: Array<{
		readonly handle: LynxHandleEntry;
		readonly attached: boolean;
		readonly attachmentEpoch: number;
	}> = [];
	const seen = new Set<number>();
	for (const change of changes) {
		if (change === null || typeof change !== 'object' || Array.isArray(change)) {
			throw new TypeError('Octane Lynx host attachment change must be an object.');
		}
		if (seen.has(change.id)) {
			throw new Error(`Octane Lynx host attachment repeats handle ${change.id}.`);
		}
		seen.add(change.id);
		const handle = compactHandle(state, change.id);
		if (
			handle === undefined ||
			!handle.active ||
			handle.generation !== change.generation ||
			typeof change.attached !== 'boolean'
		) {
			throw new Error(
				`Octane Lynx host attachment targets stale or invalid handle ${change.id}:${change.generation}.`,
			);
		}
		if (handle.attached !== change.attached) {
			staged.push({
				handle,
				attached: change.attached,
				attachmentEpoch: nextAttachmentEpoch(handle, change.attached),
			});
		}
	}
	const detached: number[] = [];
	const attached: number[] = [];
	for (const change of staged) {
		const entry = change.handle;
		entry.attached = change.attached;
		entry.attachmentEpoch = change.attachmentEpoch;
		if (!change.attached) invalidateHandleAttachment(entry);
		(change.attached ? attached : detached).push(entry.id);
	}
	const batch = Object.freeze({
		detached: Object.freeze(detached),
		attached: Object.freeze(attached),
	});
	if (detached.length !== 0 || attached.length !== 0) {
		for (const subscriber of [...state.attachmentSubscribers]) subscriber(batch);
	}
	return batch;
}

const DISCRETE_EVENTS = new Set([
	'blur',
	'change',
	'focus',
	'input',
	'longpress',
	'longtap',
	'tap',
	'touchend',
	'touchstart',
]);
const CONTINUOUS_EVENTS = new Set(['layoutchange', 'scroll', 'touchmove', 'wheel']);

const EMPTY_TEMPLATE_BINDINGS: readonly UniversalHostTemplateProgramBinding[] = Object.freeze([]);

/**
 * Where Lynx's two native-list hosts may sit in a template program, and when a
 * program rooted at a cell may be sent as a declaration.
 *
 * A `<list>` stays out of every program: a program has no way to carry the row
 * descriptors a list needs, and the host driver refuses one that contains it. A
 * `<list-item>` is a list's cell, so it has exactly one place it can be — which
 * makes it a program root and never a program's interior — and the only mount
 * the driver takes for it is a run that declares its instances without building
 * them.
 */
const LYNX_TEMPLATE_HOSTS: UniversalHostTemplateCapability = Object.freeze({
	placement(type: string): UniversalTemplateHostPlacement {
		if (type === 'list') return 'none';
		return type === 'list-item' ? 'root' : 'any';
	},
	defer(parentType: string, program: UniversalHostTemplateProgram): boolean {
		// Every one of these is refused by the host driver rather than degraded,
		// so answering `false` here is what keeps the command from being sent at
		// all. A worklet is the interesting one: a declared host is in neither of
		// the driver's per-commit audits, one of which is what binds main-thread
		// props, so a row carrying one has to be built.
		if (parentType !== 'list') return false;
		for (const node of program.nodes) {
			for (const binding of node.bindings ?? EMPTY_TEMPLATE_BINDINGS) {
				if (binding.name.startsWith('main-thread:')) return false;
			}
		}
		return true;
	},
});

export function createLynxClientDriver(
	container?: LynxClientContainer,
): UniversalHostDriver<LynxClientContainer, LynxPublicHandle> {
	const negotiatedState = container === undefined ? null : containerState(container);
	const driver: UniversalHostDriver<LynxClientContainer, LynxPublicHandle> = {
		id: LYNX_TRANSPORT_RENDERER,
		capabilities: Object.freeze({
			text: 'host' as const,
			visibility: true,
			stableStaticHostProps: true,
			collapsedTemplateMount: true,
			get templateMount() {
				return negotiatedState?.templateMount === true;
			},
			get templateProgramMount() {
				return negotiatedState?.templateProgramMount === true;
			},
			get templateProgramRuns() {
				return negotiatedState?.templateProgramRuns === true;
			},
			get deferredTemplateProgramRuns() {
				return negotiatedState?.deferredTemplateProgramRuns === true;
			},
			get addressedProgramRuns() {
				return negotiatedState?.addressedProgramRuns === true;
			},
			get teardownRuns() {
				return negotiatedState?.teardownRuns === true;
			},
			get lazyPublicInstances() {
				return negotiatedState?.lazyPublicInstances === true;
			},
			publicInstanceAnnouncements: LYNX_PUBLIC_INSTANCE_ANNOUNCEMENTS,
		}),
		templates: LYNX_TEMPLATE_HOSTS,
		portals: Object.freeze({
			prepareTarget({
				container,
				target,
				transported,
				createPortalTargetHandle,
			}: UniversalPortalTargetContext<LynxClientContainer>): UniversalPortalTargetRegistration {
				const state = containerState(container);
				const entry =
					target !== null && typeof target === 'object'
						? FACADE_ENTRY.get(target as LynxPublicHandle)
						: undefined;
				const handle = target as LynxPublicHandle;
				if (
					!transported ||
					entry === undefined ||
					state.handles.get(entry.id) !== entry ||
					!entry.active
				) {
					throw new TypeError(
						'Octane Lynx portals require a current, active LynxPublicHandle from this root. Initial portals must wait for the target ref acknowledgement.',
					);
				}
				if (!entry.attached) {
					throw new Error(
						`Octane Lynx portal target ${handle.id}:${handle.generation} is not physically attached.`,
					);
				}
				if (
					handle.type === '#text' ||
					handle.type === 'raw-text' ||
					handle.type === 'list' ||
					handle.type === 'list-item'
				) {
					throw new Error(
						`Octane Lynx portal target type ${JSON.stringify(handle.type)} is not supported.`,
					);
				}
				if (entry.listDescendant) {
					throw new Error(
						`Octane Lynx portal target ${handle.id}:${handle.generation} is a native-list descendant.`,
					);
				}
				const portalHandle = createPortalTargetHandle(
					encodeLynxPortalTargetId({
						root: handle.root,
						id: handle.id,
						generation: handle.generation,
					}),
				);
				return Object.freeze({
					handle: portalHandle,
					release() {},
				});
			},
		}),
		attachments: Object.freeze({
			subscribe(
				container: LynxClientContainer,
				onChange: (batch: UniversalHostAttachmentBatch) => void,
			) {
				if (typeof onChange !== 'function') {
					throw new TypeError('Octane Lynx host attachment subscriber must be a function.');
				}
				const state = containerState(container);
				state.attachmentSubscribers.add(onChange);
				let active = true;
				return Object.freeze({
					isAttached(id: number) {
						const materialized = state.handles.get(id);
						return materialized === undefined
							? state.compactHosts !== null && compactHostCode(state.compactHosts, id) !== 0
							: materialized.attached;
					},
					unsubscribe() {
						if (!active) return;
						active = false;
						state.attachmentSubscribers.delete(onChange);
					},
				});
			},
		}),
		props: Object.freeze({
			encode(context: UniversalHostPropCodecContext<LynxClientContainer>) {
				if (isLynxNativeResource(context.value)) {
					return {
						kind: 'resource' as const,
						handle: context.createResourceHandle(context.value.id),
					};
				}
				if (context.name.startsWith('main-thread:') && context.name !== 'main-thread:ref') {
					if (context.value === null || context.value === undefined) {
						return { kind: 'value' as const, value: context.value };
					}
					const descriptor = getThreadFunctionDescriptor(context.value);
					if (!isLynxMainThreadWorkletDescriptor(descriptor)) {
						throw new TypeError(
							`Octane Lynx ${JSON.stringify(context.name)} requires a compiler-transformed main-thread function.`,
						);
					}
					return {
						kind: 'value' as const,
						value: descriptor as never,
					};
				}
				return { kind: 'value' as const, value: context.value as never };
			},
		}),
		events: Object.freeze({
			classify(name: string) {
				const binding = parseLynxNativeEventProp(name);
				if (binding === null) return null;
				const nativeName = binding.name;
				return {
					type: name,
					priority: DISCRETE_EVENTS.has(nativeName)
						? ('discrete' as const)
						: CONTINUOUS_EVENTS.has(nativeName)
							? ('continuous' as const)
							: ('default' as const),
				};
			},
		}),
		updates: Object.freeze({
			classify(
				type: string,
				previous: Readonly<Record<string, unknown>>,
				next: Readonly<Record<string, unknown>>,
			) {
				return classifyLynxHostPropUpdate(type, previous, next);
			},
			same: sameLynxUniversalHostPropValue,
		}),
		prepareBatch() {
			throw new Error(
				'Octane Lynx client driver cannot mutate the main-thread host; use the async transport.',
			);
		},
		getPublicInstance(container: LynxClientContainer, id: number) {
			const entry = compactHandle(containerState(container), id);
			return entry === undefined ? null : handleFacade(entry);
		},
	};
	return Object.freeze(driver);
}
