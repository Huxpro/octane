import type {
	UniversalHostAttachmentBatch,
	UniversalHostBatch,
	UniversalHostDriver,
	UniversalHostParent,
	UniversalHostPropCodecContext,
	UniversalPortalTargetContext,
	UniversalPortalTargetRegistration,
	UniversalSerializableValue,
	UniversalTransportIdentity,
} from 'octane/universal/native';
import { LYNX_DEVELOPMENT } from './environment.js';
import {
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxPublicHandleDelta,
	type LynxHostAttachmentChange,
} from './protocol.js';
import { planLynxHostPropPatch } from './host-props.js';
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
import { decodeLynxPortalTargetId, encodeLynxPortalTargetId } from './portal.js';

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
	rawSnapshot: UniversalSerializableValue;
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
	readonly rawSnapshot: UniversalSerializableValue;
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
			return (entry.clonedSnapshot ??= cloneSnapshot(entry.rawSnapshot));
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
	snapshot: UniversalSerializableValue,
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

/**
 * The background's mirror of one accepted host node's placement. Maintained
 * from the same command stream main stages (protocol 2), so acknowledgement
 * handle deltas — creation state, physical-attachment seeds, and list-ancestry
 * flips — are derived here instead of being computed on main and shipped.
 */
interface LynxTopologyEntry {
	parent: number | null | undefined;
	readonly type: string;
	readonly children: Set<number>;
}

interface LynxClientContainerState {
	handles: Map<number, LynxHandleEntry>;
	readonly generations: Map<number, number>;
	topology: Map<number, LynxTopologyEntry>;
	readonly worklets?: LynxBackgroundFunctionRegistry;
	readonly createSelectorQuery: LynxCreateSelectorQuery;
	readonly attachmentSubscribers: Set<(batch: UniversalHostAttachmentBatch) => void>;
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
			const entry = CONTAINER_STATE.get(container)!.handles.get(id);
			return entry === undefined ? null : handleFacade(entry);
		},
	});
	CONTAINER_STATE.set(container, {
		handles: new Map(),
		generations: new Map(),
		topology: new Map(),
		worklets: options.worklets,
		createSelectorQuery,
		attachmentSubscribers: new Set(),
	});
	return container;
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

/** Bind background closures only after a complete render reaches the transport boundary. */
export function prepareLynxClientWorkletBatch(
	container: LynxClientContainer,
	batch: UniversalHostBatch,
): UniversalHostBatch {
	const worklets = containerState(container).worklets;
	if (worklets === undefined) return batch;
	const retained = new Set<string>();
	try {
		const commands = batch.commands.map((command) => {
			if (command.op !== 'create' && command.op !== 'update' && command.op !== 'recreate') {
				return command;
			}
			let changed = false;
			const props: Record<string, unknown> = { ...command.props };
			for (const name of Object.keys(props)) {
				if (!name.startsWith('main-thread:') || name === 'main-thread:ref') continue;
				const value = props[name];
				if (value === null || value === undefined) continue;
				const descriptor = getThreadFunctionDescriptor(value);
				if (!isLynxMainThreadWorkletDescriptor(descriptor)) {
					throw new TypeError(
						`Octane Lynx ${JSON.stringify(name)} requires a compiler-transformed main-thread function.`,
					);
				}
				const bound = worklets.retain(descriptor as LynxWorkletValue);
				collectWorkletExecutionIds(bound, retained);
				props[name] = bound;
				changed = true;
			}
			return changed ? Object.freeze({ ...command, props: Object.freeze(props) }) : command;
		});
		return Object.freeze({ ...batch, commands: Object.freeze(commands) });
	} catch (error) {
		for (const execution of retained) worklets.release(execution);
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

function validateSnapshotIdentity(
	snapshot: UniversalSerializableValue,
	identity: UniversalTransportIdentity,
	delta: { readonly id: number; readonly type: string; readonly generation: number },
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
	const foreign = (name: string): never => {
		throw new Error(
			`Octane Lynx acknowledgement snapshot has foreign ${name} for handle ${delta.id}.`,
		);
	};
	if (value.$$kind !== 'octane.lynx.element') foreign('$$kind');
	if (value.renderer !== LYNX_TRANSPORT_RENDERER) foreign('renderer');
	if (value.root !== identity.root) foreign('root');
	if (value.id !== delta.id) foreign('id');
	if (value.type !== delta.type) foreign('type');
	if (value.generation !== delta.generation) foreign('generation');
	if (value.selector !== createLynxNodesRefSelector(identity.root, delta.id, delta.generation)) {
		foreign('selector');
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

/** Decode a wire placement parent to the topology mirror's parent id. */
function topologyParentId(parent: UniversalHostParent): number | null | undefined {
	if (parent === null || typeof parent === 'number') return parent;
	return decodeLynxPortalTargetId((parent as { readonly id?: unknown }).id)?.id;
}

/**
 * @internal Used by the background transport immediately before core ACK.
 *
 * Protocol 2 derives every acknowledgement handle delta locally: the commands
 * this thread sent determine which handles are created, recreated, and
 * destroyed; generations follow main's exact rules against the same accepted
 * history; snapshots are pure identity; and the topology mirror answers the
 * placement-derived bits (root connectivity and list ancestry). Physical
 * attachment under a native list is cell materialization, which the derivation
 * seeds as detached for new cells and the host-attachment channel converges —
 * the same channel that owned it when main shipped the deltas.
 *
 * `deltas` is main's development-only cross-check payload: when present, each
 * received delta must match its derived counterpart, modulo the documented
 * attachment tolerance for native-list descendants. Production
 * acknowledgements carry no deltas and the derivation stands alone.
 */
export function prepareLynxHandleDeltas(
	container: LynxClientContainer,
	batch: UniversalHostBatch,
	deltas: readonly LynxPublicHandleDelta[] | undefined,
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
	const topology = state.topology;
	// Copy-on-write topology overlay: committed entries are never mutated while
	// staging, so rollback restores them by reference.
	const stagedTopology = new Map<number, LynxTopologyEntry | null>();
	const readTopology = (id: number): LynxTopologyEntry | undefined => {
		if (stagedTopology.has(id)) return stagedTopology.get(id) ?? undefined;
		return topology.get(id);
	};
	const writeTopology = (id: number): LynxTopologyEntry | undefined => {
		if (stagedTopology.has(id)) return stagedTopology.get(id) ?? undefined;
		const committed = topology.get(id);
		if (committed === undefined) return undefined;
		const clone: LynxTopologyEntry = {
			parent: committed.parent,
			type: committed.type,
			children: new Set(committed.children),
		};
		stagedTopology.set(id, clone);
		return clone;
	};
	const detachFromParent = (id: number, parent: number | null | undefined): void => {
		if (typeof parent === 'number') writeTopology(parent)?.children.delete(id);
	};
	const stagedHandles = new Map<number, LynxHandleEntry | null>();
	const finalHandle = (id: number): LynxHandleEntry | undefined => {
		if (!stagedHandles.has(id)) return originalHandles.get(id);
		return stagedHandles.get(id) ?? undefined;
	};
	const transitions = new Map<number, LynxHandleTransition>();
	const transitionFor = (id: number): LynxHandleTransition => {
		let transition = transitions.get(id);
		if (transition !== undefined) return transition;
		const initial = originalHandles.get(id);
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
	const listAncestryRoots = new Set<number>();
	// Main's exact generation rules against the same accepted history: main
	// stages a bump per create/recreate *command* (not per net transition), a
	// destroy never clears the counter, and every staged entry — including one
	// whose handle the same batch nets away — merges into the committed map on
	// acceptance. Both sides advance only on accepted batches, so the maps
	// agree and the derived generation is the one main assigns.
	const stagedGenerations = new Map<number, number>();
	for (const command of batch.commands) {
		if (command.op === 'insert' || command.op === 'move') {
			const entry = writeTopology(command.id);
			if (entry === undefined) {
				throw new Error(`Octane Lynx batch places missing handle ${command.id}.`);
			}
			detachFromParent(command.id, entry.parent);
			entry.parent = topologyParentId(command.parent);
			if (typeof entry.parent === 'number') {
				writeTopology(entry.parent)?.children.add(command.id);
			}
			listAncestryRoots.add(command.id);
			continue;
		}
		if (command.op === 'remove') {
			const entry = writeTopology(command.id);
			if (entry !== undefined) {
				detachFromParent(command.id, entry.parent);
				entry.parent = undefined;
			}
			listAncestryRoots.add(command.id);
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
		const transition = transitionFor(command.id);
		if (command.op === 'create') {
			if (transition.present) {
				throw new Error(`Octane Lynx batch creates existing handle ${command.id}.`);
			}
			transition.present = true;
			transition.type = command.type;
			transition.snapshotChanged = true;
			stagedGenerations.set(
				command.id,
				(stagedGenerations.get(command.id) ?? state.generations.get(command.id) ?? 0) + 1,
			);
			stagedTopology.set(command.id, {
				parent: undefined,
				type: command.type,
				children: new Set(),
			});
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
			stagedGenerations.set(
				command.id,
				(stagedGenerations.get(command.id) ??
					state.generations.get(command.id) ??
					transition.initial!.generation) + 1,
			);
		} else {
			if (!transition.present) {
				throw new Error(`Octane Lynx batch destroys missing handle ${command.id}.`);
			}
			transition.present = false;
			transition.type = null;
			transition.identityChanged = true;
			detachFromParent(command.id, readTopology(command.id)?.parent);
			stagedTopology.set(command.id, null);
		}
	}

	// One walk-scoped cycle guard, cleared per walk; the topology mirrors
	// commands main validated, so a cycle here is a corrupted mirror.
	const walkGuard = new Set<number>();
	const listDescendantIn = (
		read: (id: number) => LynxTopologyEntry | undefined,
		id: number,
		cache: Map<number, boolean>,
	): boolean => {
		const path: number[] = [];
		walkGuard.clear();
		let currentId = id;
		let current = read(currentId);
		let result = false;
		while (current !== undefined) {
			const known = cache.get(currentId);
			if (known !== undefined) {
				result = known;
				break;
			}
			if (walkGuard.has(currentId)) {
				throw new Error('Octane Lynx host ancestry contains a cycle.');
			}
			walkGuard.add(currentId);
			path.push(currentId);
			const parentId = current.parent;
			if (typeof parentId !== 'number') break;
			const parent = read(parentId);
			if (parent === undefined) break;
			if (parent.type === 'list' && current.type === 'list-item') {
				result = true;
				break;
			}
			currentId = parentId;
			current = parent;
		}
		for (const walked of path) cache.set(walked, result);
		return result;
	};
	const deriveAttached = (id: number): boolean => {
		walkGuard.clear();
		let currentId = id;
		let current = readTopology(currentId);
		while (current !== undefined) {
			if (walkGuard.has(currentId)) {
				throw new Error('Octane Lynx host ancestry contains a cycle.');
			}
			walkGuard.add(currentId);
			const parentId = current.parent;
			if (parentId === null) return true;
			if (typeof parentId !== 'number') return false;
			const parent = readTopology(parentId);
			if (parent === undefined) return false;
			if (parent.type === 'list' && current.type === 'list-item') {
				// Crossing a cell boundary: a cell this batch creates or recreates
				// has no element until the engine materializes it, and an existing
				// cell contributes its channel-owned materialization bit. The walk
				// still continues upward so a list detached in the same batch wins
				// over a live cell.
				const cellTransition = transitions.get(currentId);
				if (
					cellTransition !== undefined &&
					(cellTransition.initial === undefined || cellTransition.identityChanged)
				) {
					return false;
				}
				const cell = originalHandles.get(currentId);
				if (cell === undefined || !cell.attached) return false;
			}
			currentId = parentId;
			current = parent;
		}
		return false;
	};

	const priorStates = new Map<LynxHandleEntry, LynxHandleStateSnapshot>();
	const nextStates = new Map<LynxHandleEntry, LynxHandleStateSnapshot>();
	const createdHandles = new Set<LynxHandleEntry>();
	const priorGenerations = new Map<number, number | undefined>();
	const crossCheck = LYNX_DEVELOPMENT && deltas !== undefined;
	const derived = crossCheck ? new Map<number, LynxPublicHandleDelta>() : null;
	const previousListDescendants = new Map<number, boolean>();
	const nextListDescendants = new Map<number, boolean>();
	const committedTopology = (id: number): LynxTopologyEntry | undefined => topology.get(id);

	for (const [id, transition] of transitions) {
		const expected = expectedHandleDelta(transition);
		// `update` preserves handle identity, generation, and snapshot, and its
		// physical-attachment bit is owned by the host-attachment channel, so an
		// update-only transition derives no delta at all.
		if (expected === 'none' || expected === 'update') continue;
		if (expected === 'remove') {
			const previous = transition.initial!;
			priorStates.set(previous, captureHandleState(previous));
			stagedHandles.set(id, null);
			derived?.set(id, Object.freeze({ op: 'remove', id, generation: previous.generation }));
			continue;
		}
		const type = transition.type!;
		// The final staged value: a create or recreate transition always staged
		// at least one bump in the command loop above.
		const generation = stagedGenerations.get(id)!;
		if (expected === 'recreate') {
			priorStates.set(transition.initial!, captureHandleState(transition.initial!));
		}
		const snapshot: UniversalSerializableValue = Object.freeze({
			$$kind: 'octane.lynx.element',
			renderer: LYNX_TRANSPORT_RENDERER,
			root: identity.root,
			id,
			type,
			generation,
			selector: createLynxNodesRefSelector(identity.root, id, generation),
		});
		const handle = createHandleEntry(
			identity.root,
			id,
			type,
			generation,
			snapshot,
			state.createSelectorQuery,
		);
		createdHandles.add(handle);
		// A handle this preparation just built is unreachable until apply()
		// publishes it into `state.handles`, so its state is written directly
		// rather than staged. Rollback drops the handle outright, so there is
		// no prior state to restore. This keeps a mount from allocating two
		// state clones and two map entries per accepted node.
		const attached = deriveAttached(id);
		const listDescendant = listDescendantIn(readTopology, id, nextListDescendants);
		handle.active = true;
		handle.attachmentEpoch = nextAttachmentEpoch(handle, attached);
		handle.attached = attached;
		handle.listDescendant = listDescendant;
		stagedHandles.set(id, handle);
		derived?.set(
			id,
			Object.freeze({ op: 'upsert', id, type, generation, attached, listDescendant, snapshot }),
		);
	}

	// List-ancestry flips: mirror main's exact walk. Roots are the ids whose
	// placement changed; a root whose own bit flipped walks its final subtree,
	// and every surviving same-handle descendant whose bit flipped stages the
	// new value at its unchanged generation.
	if (listAncestryRoots.size !== 0) {
		const ancestrySeen = new Set<number>();
		const pending: number[] = [];
		for (const rootId of listAncestryRoots) {
			if (topology.get(rootId) === undefined || readTopology(rootId) === undefined) continue;
			if (
				listDescendantIn(committedTopology, rootId, previousListDescendants) ===
				listDescendantIn(readTopology, rootId, nextListDescendants)
			) {
				continue;
			}
			pending.push(rootId);
			while (pending.length !== 0) {
				const descendantId = pending.pop()!;
				if (ancestrySeen.has(descendantId)) continue;
				ancestrySeen.add(descendantId);
				const next = readTopology(descendantId);
				if (next === undefined) continue;
				for (const childId of next.children) pending.push(childId);
				if (topology.get(descendantId) === undefined) continue;
				const transition = transitions.get(descendantId);
				if (
					transition !== undefined &&
					(transition.initial === undefined || transition.identityChanged)
				) {
					continue;
				}
				const entry = originalHandles.get(descendantId);
				if (entry === undefined) continue;
				const listDescendant = listDescendantIn(readTopology, descendantId, nextListDescendants);
				if (
					listDescendantIn(committedTopology, descendantId, previousListDescendants) ===
					listDescendant
				) {
					continue;
				}
				priorStates.set(entry, captureHandleState(entry));
				nextStates.set(entry, { ...captureHandleState(entry), listDescendant });
				derived?.set(
					descendantId,
					Object.freeze({
						op: 'list-ancestry',
						id: descendantId,
						generation: entry.generation,
						listDescendant,
					}),
				);
			}
		}
	}

	if (crossCheck) {
		// Development cross-check: main's computed deltas must match the local
		// derivation delta-for-delta. The one tolerated divergence is `attached`
		// under a native list, where main reads cell materialization after its
		// flush while the derivation seeds the pre-materialization value; the
		// host-attachment channel converges the two either way.
		const seen = new Set<number>();
		for (const delta of deltas!) {
			if (seen.has(delta.id)) {
				throw new Error(`Octane Lynx acknowledgement repeats handle ${delta.id}.`);
			}
			seen.add(delta.id);
			const expected = derived!.get(delta.id);
			if (expected === undefined) {
				throw new Error(`Octane Lynx acknowledgement publishes unchanged handle ${delta.id}.`);
			}
			if (delta.op === 'remove') {
				if (expected.op !== 'remove' || expected.generation !== delta.generation) {
					throw new Error(
						`Octane Lynx acknowledgement removes stale handle ${delta.id}:${delta.generation}.`,
					);
				}
				continue;
			}
			if (delta.op === 'list-ancestry') {
				if (
					expected.op !== 'list-ancestry' ||
					expected.generation !== delta.generation ||
					expected.listDescendant !== delta.listDescendant
				) {
					throw new Error(
						`Octane Lynx acknowledgement changes list ancestry for stale or transitioning handle ${delta.id}:${delta.generation}.`,
					);
				}
				continue;
			}
			if (
				expected.op !== 'upsert' ||
				expected.type !== delta.type ||
				expected.generation !== delta.generation ||
				expected.listDescendant !== delta.listDescendant ||
				(!expected.listDescendant && expected.attached !== delta.attached)
			) {
				throw new Error(
					`Octane Lynx acknowledgement diverges from the derived handle ${delta.id}:${delta.generation}.`,
				);
			}
			validateSnapshotIdentity(delta.snapshot, identity, expected);
		}
		for (const id of derived!.keys()) {
			if (!seen.has(id)) {
				throw new Error(`Octane Lynx acknowledgement omits derived handle ${id}.`);
			}
		}
	}

	let applied = false;
	let rolledBack = false;
	const priorTopology = new Map<number, LynxTopologyEntry | undefined>();
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
			stagedHandles.forEach((handle, id) => {
				if (handle === null) originalHandles.delete(id);
				else originalHandles.set(id, handle);
			});
			stagedGenerations.forEach((generation, id) => {
				priorGenerations.set(id, state.generations.get(id));
				state.generations.set(id, generation);
			});
			stagedTopology.forEach((entry, id) => {
				priorTopology.set(id, topology.get(id));
				if (entry === null) topology.delete(id);
				else topology.set(id, entry);
			});
		},
		rollback() {
			if (!applied || rolledBack) return;
			rolledBack = true;
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
			priorTopology.forEach((entry, id) => {
				if (entry === undefined) topology.delete(id);
				else topology.set(id, entry);
			});
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
	const entry = containerState(container).handles.get(id);
	return (
		entry !== undefined &&
		entry.active &&
		entry.attached &&
		entry.root === root &&
		entry.generation === generation
	);
}

/** @internal Releases query handles when their background transport closes. */
export function invalidateLynxClientContainer(container: LynxClientContainer): void {
	const state = containerState(container);
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
	state.topology = new Map();
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
		const handle = state.handles.get(change.id);
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
export function createLynxClientDriver(): UniversalHostDriver<
	LynxClientContainer,
	LynxPublicHandle
> {
	const driver: UniversalHostDriver<LynxClientContainer, LynxPublicHandle> = {
		id: LYNX_TRANSPORT_RENDERER,
		capabilities: Object.freeze({ text: 'host' as const, visibility: true }),
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
						return state.handles.get(id)?.attached ?? false;
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
				return planLynxHostPropPatch(type, previous, next).requiresRecreate ? 'recreate' : 'update';
			},
		}),
		prepareBatch() {
			throw new Error(
				'Octane Lynx client driver cannot mutate the main-thread host; use the async transport.',
			);
		},
		getPublicInstance(container: LynxClientContainer, id: number) {
			const entry = containerState(container).handles.get(id);
			return entry === undefined ? null : handleFacade(entry);
		},
	};
	return Object.freeze(driver);
}
