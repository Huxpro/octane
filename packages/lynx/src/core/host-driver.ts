import type {
	UniversalEventListenerDescriptor,
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostCommitContext,
	UniversalHostDriver,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalHostTemplateProgramValue,
	UniversalPreparedHostBatch,
	UniversalPortalTargetHandle,
	UniversalProgramCreate,
	UniversalProgramPlan,
	UniversalSerializableValue,
} from 'octane/universal/native';
import {
	decodeLynxNativeEventToken,
	encodeCheckedLynxNativeEventToken,
	encodePrevalidatedLynxNativeEventToken,
	parseLynxMainThreadEventProp,
	parseLynxNativeEventProp,
	type LynxMainThreadEventBinding,
	type LynxNativeEventBinding,
	type LynxNativeEventToken,
} from './native-events.js';
import { hasCrossRealmPlainPrototype } from './plain-object.js';
import {
	createLynxFirstTree,
	LYNX_FIRST_TREE_STATE,
	lynxFirstTreeProgramIndex,
	LYNX_DENSE_PROGRAM_RANGES,
	programRunEventCount,
	programRunEventToken,
	programRunHostCount,
	programRunHostNode,
	programRunLastId,
	programRunNode,
	programRunPosition,
	LynxFirstScreenRefusalError,
	LynxFirstTreeMismatchError,
	type CaptureLynxFirstTreeOptions,
	type LynxFirstTree,
	type LynxFirstTreeCapturedNode,
	type LynxFirstTreeEventSnapshot,
	type LynxFirstTreeListJournal,
	type LynxFirstTreeLogicalNodeSnapshot,
	type LynxProgramRun,
	type LynxFirstTreeSnapshot,
	type LynxResolvedFirstTreeEvent,
} from './first-screen.js';
import {
	LYNX_CSS_SCOPE_PROP,
	classifyLynxHostPropUpdate,
	hasLynxMainThreadProp,
	planLynxHostPropPatch,
	sameLynxUniversalHostPropValue,
	type LynxHostPropPatch,
	type LynxMainThreadEventPatch,
	type LynxMainThreadRefDescriptor,
	type LynxMainThreadWorkletDescriptor,
} from './host-props.js';
import {
	createLynxListItemDescriptor,
	lynxListReuseKey,
	planLynxListUpdate,
	type LynxListItemDescriptor,
	type LynxListUpdateInfo,
} from './list.js';
import { createLynxNodesRefSelector } from './nodes-ref.js';
import type {
	LynxElementEventListener,
	LynxElementPAPI,
	LynxElementRef,
	LynxListComponentAtIndex,
	LynxListComponentAtIndexes,
	LynxListEnqueueComponent,
} from './papi.js';
import {
	getThreadFunctionDescriptor,
	type LynxActivatedMainThreadWorklet,
	type LynxMainThreadWorkletRegistry,
} from './worklets.js';
import {
	decodeLynxPortalTargetId,
	isLynxPortalTargetHandle,
	lynxPortalTargetKey,
} from './portal.js';
import { LYNX_PROFILE, lynxWireProfile } from './profiling.js';
import { LYNX_RENDERER_ID } from './renderer-id.js';

const LYNX_HOST_STATE: unique symbol = Symbol('octane.lynx.host-state');

interface LynxPortalParent {
	readonly kind: 'portal';
	readonly key: string;
	readonly universalRoot: number;
	readonly target: number;
	readonly generation: number;
}

type LynxAttachedHostParent = number | null | LynxPortalParent;
type LynxHostParent = LynxAttachedHostParent | undefined;

interface LynxPortalChildren {
	readonly parent: LynxPortalParent;
	children: number[];
}

export interface LynxHostHandle {
	readonly $$kind: 'octane.lynx.element';
	readonly renderer: typeof LYNX_RENDERER_ID;
	readonly root: number;
	readonly id: number;
	readonly type: string;
	readonly generation: number;
	readonly selector: string;
}

export type LynxHostHandleDelta =
	| {
			readonly op: 'create' | 'recreate';
			readonly handle: LynxHostHandle;
	  }
	| {
			readonly op: 'destroy';
			readonly renderer: typeof LYNX_RENDERER_ID;
			readonly root: number;
			readonly id: number;
			readonly generation: number;
	  }
	| {
			/** Retires hostCount contiguous same-generation hosts in one delta. */
			readonly op: 'destroy-run';
			readonly renderer: typeof LYNX_RENDERER_ID;
			readonly root: number;
			readonly firstId: number;
			readonly hostCount: number;
			readonly generation: number;
	  };

/** Physical attachment transition emitted by native list enter/leave callbacks. */
export interface LynxHostAttachmentDelta {
	readonly id: number;
	readonly generation: number;
	readonly attached: boolean;
}

interface LynxHostRecord<Node extends LynxElementRef> {
	node: Node | null;
	type: string;
	props: Readonly<Record<string, unknown>>;
	visible: boolean;
	parent: LynxHostParent;
	children: number[];
	events: Map<string, UniversalEventListenerDescriptor>;
	handle: LynxHostHandle;
	/**
	 * Sticky: someone asked this host for a public instance, so a `nodes-ref`
	 * selector must follow it onto whatever physical node it lands on next. A
	 * native list cell changes nodes on every recycle, and nothing re-renders to
	 * re-announce the request, so the want has to outlive the node.
	 */
	selectorWanted: boolean;
	/** Per physical node: the selector is currently installed on `node`. */
	selectorInstalled: boolean;
}

interface LynxHostRecordStore<Node extends LynxElementRef> extends Iterable<
	[number, LynxHostRecord<Node>]
> {
	readonly size: number;
	get(id: number): LynxHostRecord<Node> | undefined;
	has(id: number): boolean;
	set(id: number, record: LynxHostRecord<Node>): unknown;
	delete(id: number): boolean;
	clear(): void;
	keys(): IterableIterator<number>;
}

interface LynxPhysicalTree<Node extends LynxElementRef> {
	node: Node;
	type: string;
	props: Readonly<Record<string, unknown>>;
	visible: boolean;
	logicalId: number;
	children: LynxPhysicalTree<Node>[];
}

interface LynxPhysicalListCell<Node extends LynxElementRef> {
	sign: number;
	tree: LynxPhysicalTree<Node>;
	item: LynxListItemDescriptor;
	logicalItemId: number | null;
	/** The logical item moved before native delivered the old sign's enqueue callback. */
	awaitingEnqueue: boolean;
}

interface LynxListMaterialization<Node extends LynxElementRef> {
	readonly sign: number;
	readonly tree: LynxPhysicalTree<Node>;
	readonly item: LynxListItemDescriptor;
	/** True only when a physical cell crosses logical item ownership. */
	readonly reuseNotification: boolean;
	readonly detachments: LynxHostAttachmentDelta[];
	readonly attachments: LynxHostAttachmentDelta[];
}

interface LynxNativeListState<Node extends LynxElementRef> {
	readonly hostId: number;
	readonly node: Node;
	readonly componentAtIndex: LynxListComponentAtIndex<Node>;
	readonly componentAtIndexes: LynxListComponentAtIndexes<Node>;
	readonly enqueueComponent: LynxListEnqueueComponent<Node>;
	items: readonly LynxListItemDescriptor[];
	readonly cellsBySign: Map<number, LynxPhysicalListCell<Node>>;
	readonly attachedByItem: Map<number, LynxPhysicalListCell<Node>>;
	readonly retainedByItem: Map<number, LynxPhysicalListCell<Node>>;
	readonly recyclePools: Map<string, LynxPhysicalListCell<Node>[]>;
	createdCells: number;
	reusedCells: number;
	enterCount: number;
	leaveCount: number;
	disposed: boolean;
}

/**
 * One number that moves whenever a native list's recycling callbacks touch a
 * cell. Capture journals it and adoption compares it against the live list,
 * so the two sides must agree on the formula — which is why it exists as one
 * function rather than two copies of the arithmetic.
 */
function listRecyclingEpoch(list: {
	readonly enterCount: number;
	readonly leaveCount: number;
	readonly createdCells: number;
	readonly reusedCells: number;
}): number {
	return list.enterCount + list.leaveCount + list.createdCells + list.reusedCells;
}

interface LynxHostState<Node extends LynxElementRef> {
	readonly papi: LynxElementPAPI<Node>;
	readonly worklets?: LynxMainThreadWorkletRegistry;
	records: LynxHostRecordStore<Node>;
	rootChildren: number[];
	generations: Map<number, number>;
	/** Compact first mounts derive live generation-one entries from their records. */
	implicitInitialGenerations: boolean;
	/**
	 * Highest host id that ever carried a stored generation or belonged to an
	 * accepted compact segment. A compact segment publishes implicit
	 * generation-one identities, so it may only cover ids above this ratchet;
	 * the universal allocator issues ids monotonically, so real mounts always
	 * qualify while any id reuse falls back to the explicit path.
	 */
	maxExplicitId: number;
	/**
	 * Generation-one tombstones for whole retired runs, kept as sorted
	 * non-overlapping [first, last] ranges instead of one map entry per host.
	 */
	retiredRanges: [number, number][];
	/** Ordinary pure template runs may retain compact metadata solely for certified teardown. */
	teardownRecords: LynxDenseHostRecordStore<Node> | null;
	/**
	 * Template runs the peer declared under a native `<list>` and asked the host
	 * not to build. `records` holds what has been materialized; these hold what
	 * has only been declared. Null while no run has ever been deferred, which is
	 * every tree without a native list.
	 */
	deferredRuns: LynxDeferredTemplateRun[] | null;
	/** Universal root provenance is fixed by the first accepted portal handle. */
	portalRoot: number | null;
	/** Portal children stay separate from ordinary authored host children. */
	portalChildren: Map<string, LynxPortalChildren>;
	readonly ownedNodes: Set<Node>;
	readonly ownedPageRoots: Set<Node>;
	/** Physical listener journal retained until native removal succeeds. */
	readonly nativeEvents: Map<Node, Map<string, LynxNativeEventRegistration>>;
	/** Main-thread refs retained until their native node is cleared successfully. */
	readonly mainThreadRefs: Map<Node, LynxMainThreadRefDescriptor>;
	readonly mainThreadRefOwners: Map<string, Node>;
	readonly lists: Map<number, LynxNativeListState<Node>>;
	/**
	 * The peer announces every public instance it needs, so a mounted host carries
	 * a `nodes-ref` selector only where one was asked for. A peer that never sends
	 * `ensure-public-instance` — one negotiated below that capability, or one that
	 * announced no capabilities at all — keeps the eager install, because for it
	 * an uninstalled selector is a ref that addresses nothing.
	 *
	 * Monotonic, and set from each commit rather than from the session, because
	 * whether a batch named its hosts is a property of the background that
	 * composed it. Once a commit says it announced, every later one does too.
	 */
	announcesPublicInstances: boolean;
	readonly onAttachments?: (version: number, deltas: readonly LynxHostAttachmentDelta[]) => void;
	readonly onCallbackFault?: (version: number, error: unknown) => void;
	/** Monotonic: ordinary trees never need direct-worklet connectivity walks. */
	hasMainThreadProps: boolean;
	/** Monotonic: ordinary trees never need native-list ancestry bookkeeping. */
	hasNativeListTopology: boolean;
	/**
	 * Every compiled main-thread program this container mounted, one entry each.
	 *
	 * A program writes no record, so this is the only thing that says which
	 * physical node wears which ID — and, at adoption, the only thing main
	 * contributes about that half of the tree. Empty on a container that never
	 * mounted one, which is every container today.
	 *
	 * It is also the answer to "did this container paint a program", which C2d
	 * kept as a separate monotonic flag so that `captureLynxFirstTree` could
	 * decline such a container outright. C2e made capture describe one instead —
	 * from this journal — and the flag went on being written and never read. A
	 * predicate nothing consults is not documentation, so it is gone rather than
	 * kept against a future reader: this answers the same question, and the one
	 * way the two differ is that this one is cleared at hand-over, when there is
	 * no longer a painted tree to answer about.
	 *
	 * One entry per program rather than per node (issue #163 C20). A program's
	 * hosts are numbered together and created together, and the mount already
	 * holds both arrays in one order; writing them out node by node into a `Set`
	 * and a `Map` cost 133 ms of main-thread script at 30,000 rows, and 26 more
	 * re-copying the map at capture, for a per-ID view only adoption reads. So a
	 * program's nodes are *not* in `ownedNodes` either: this is where they are,
	 * and every reader that wants all of them reads both.
	 */
	readonly programRuns: LynxProgramRun<Node>[];
	/**
	 * Whether the runs' event journals have been written into `nativeEvents`.
	 *
	 * A program installs its listeners itself and the run records which, so
	 * nothing per node is written at mount (issue #215 D3). Terminal cleanup is
	 * the one path that wants them in the ordinary journal — it clears every
	 * installed tuple from there, and retries against what is left — so it fills
	 * them in first. This says it already did, which is what keeps a *retry*
	 * from re-adding the entries the first attempt successfully removed.
	 */
	programEventsMaterialized: boolean;
	/**
	 * Whether every run so far begins after the previous one ends.
	 *
	 * True for sibling programs, which is every program a keyed `@for`
	 * emits. False once a program is mounted inside another program's
	 * keyed-range member, because `assignProgramIds` mints the inner
	 * program's ids in the middle of the outer one's span. Tracked here
	 * rather than derived at capture so it costs one comparison per
	 * program instead of a pass over the runs (issue #215 D1).
	 */
	programRunsDisjoint: boolean;
	acceptedVersion: number;
	disposed: boolean;
	disposing: boolean;
	faulted: boolean;
	applying: boolean;
	cleanupNeedsFlush: boolean;
	firstTree: LynxFirstTree<Node> | null;
}

type LynxNativeEventRegistration =
	| {
			readonly source: 'background';
			readonly binding: LynxNativeEventBinding;
			readonly listener: LynxNativeEventToken;
	  }
	| {
			readonly source: 'main-thread';
			readonly binding: LynxMainThreadEventBinding;
			readonly listener: Exclude<LynxElementEventListener, string | undefined>;
			readonly descriptor: LynxMainThreadWorkletDescriptor;
	  };

export interface LynxHostContainer<Node extends LynxElementRef = LynxElementRef> {
	readonly renderer: typeof LYNX_RENDERER_ID;
	readonly root: number;
	readonly page: Node;
	readonly pageComponentUniqueId: number;
	readonly acceptedVersion: number;
	readonly instanceCount: number;
	readonly disposed: boolean;
	readonly [LYNX_HOST_STATE]: LynxHostState<Node>;
}

export interface CreateLynxHostContainerOptions<Node extends LynxElementRef = LynxElementRef> {
	readonly root: number;
	readonly componentId?: string;
	readonly cssId?: number;
	readonly page?: Node;
	/** Main-local execution and ref lifetime registry shared across first-screen adoption. */
	readonly worklets?: LynxMainThreadWorkletRegistry;
	/**
	 * True when the commit creating this container announced every host it will
	 * query, so a mounted host installs a `nodes-ref` selector on request rather
	 * than on sight. Defaults to the eager install, which is the only safe choice
	 * for a batch that announces nothing — a peer too old to announce at all.
	 * Later batches latch it on through
	 * {@link PrepareLynxHostBatchOptions.announcesPublicInstances}.
	 */
	readonly announcesPublicInstances?: boolean;
	/** Main-thread bridge for callback-driven list ref/query attachment state. */
	readonly onAttachments?: (version: number, deltas: readonly LynxHostAttachmentDelta[]) => void;
	/** Accepted-root fault bridge for native callbacks that run after a commit settles. */
	readonly onCallbackFault?: (version: number, error: unknown) => void;
}

export interface LynxPreparedHostBatch extends UniversalPreparedHostBatch {
	/** True once the accepted physical application boundary has been crossed. */
	readonly mutationStarted: boolean;
	/** Clone-safe public-handle changes that must be published before acknowledgement. */
	readonly handleDelta: readonly LynxHostHandleDelta[];
	/** Fresh, attached host count when the caller negotiated a compact first ACK. */
	readonly compactHostCount?: number;
	/** Retained handles whose native-list ancestry changed without changing identity. */
	readonly listAncestryDelta: readonly LynxHostListAncestryDelta[];
	/** First-screen path selected during clone-safe preparation. */
	readonly firstTreeAction: 'none' | 'adopt' | 'repair';
}

export interface LynxHostListAncestryDelta {
	readonly id: number;
	readonly generation: number;
	readonly listDescendant: boolean;
}

export interface PrepareLynxHostBatchOptions<Node extends LynxElementRef> {
	readonly firstTree?: LynxFirstTree<Node>;
	readonly onMismatch?: (error: LynxFirstTreeMismatchError) => void;
	/** Trusted transport may defer per-host legacy ACK deltas for a fresh root. */
	readonly compact?: boolean;
	/** Trusted adopted roots may append one compact generation-one host segment. */
	readonly incrementalCompact?: boolean;
	/** Negotiated safe program mounts install private ref selectors on demand. */
	readonly lazyPublicInstances?: boolean;
	/**
	 * This batch names every host it will query. Latches the container into demand
	 * installs for good.
	 */
	readonly announcesPublicInstances?: boolean;
}

export interface LynxHostDriver<
	Node extends LynxElementRef = LynxElementRef,
> extends UniversalHostDriver<LynxHostContainer<Node>, LynxHostHandle> {
	readonly id: typeof LYNX_RENDERER_ID;
	prepareBatch(
		container: LynxHostContainer<Node>,
		batch: UniversalHostBatch,
		context: UniversalHostCommitContext,
	): LynxPreparedHostBatch;
}

export interface LynxHostCleanupResult {
	/** True only when every owned page root is detached and the cleanup flush succeeds. */
	readonly complete: boolean;
	readonly removedRoots: number;
	/** Roots whose parentage could not yet be cleared or proven detached. */
	readonly remainingRoots: number;
	readonly flushed: boolean;
	readonly errors: readonly Error[];
}

interface LynxPreparedListUpdate {
	readonly hostId: number;
	readonly previous: readonly LynxListItemDescriptor[];
	readonly next: readonly LynxListItemDescriptor[];
	readonly update: LynxListUpdateInfo;
}

type LynxApplyOperation<Node extends LynxElementRef> =
	| {
			readonly op: 'mount-template';
			readonly id: number;
			readonly parent: LynxAttachedHostParent;
			readonly before: number | null;
			readonly records: readonly LynxHostRecord<Node>[];
			readonly patches: readonly LynxHostPropPatch[];
			readonly parents: readonly number[];
			readonly count?: number;
			readonly dense?: LynxDenseHostRecordStore<Node>;
			readonly teardownDense?: LynxDenseHostRecordStore<Node>;
			/** Present only when a compact range owns contiguous lazy host identities. */
			readonly firstId?: number;
			readonly program?: LynxPreparedTemplateProgram;
			readonly firstListenerId?: number | null;
			readonly lazyPublicInstances?: true;
			/** Set when an instance of this run carries a main-thread worklet or ref. */
			readonly mainThreadProps?: true;
	  }
	| {
			readonly op: 'create';
			readonly id: number;
			readonly type: string;
			readonly props: Readonly<Record<string, unknown>>;
			readonly patch: LynxHostPropPatch;
			readonly handle: LynxHostHandle;
			readonly record: LynxHostRecord<Node>;
			readonly visible: boolean;
	  }
	| {
			readonly op: 'update';
			readonly id: number;
			readonly type: string;
			readonly previous: Readonly<Record<string, unknown>>;
			readonly next: Readonly<Record<string, unknown>>;
			readonly patch: LynxHostPropPatch;
			readonly visible: boolean;
	  }
	| {
			readonly op: 'recreate';
			readonly id: number;
			readonly type: string;
			readonly props: Readonly<Record<string, unknown>>;
			readonly parent: LynxHostParent;
			readonly children: readonly number[];
			readonly portalChildren: readonly number[];
			readonly visible: boolean;
			readonly events: ReadonlyMap<string, UniversalEventListenerDescriptor>;
			readonly generation: number;
			readonly patch: LynxHostPropPatch;
			readonly handle: LynxHostHandle;
			readonly record: LynxHostRecord<Node>;
	  }
	| {
			readonly op: 'insert' | 'move';
			readonly id: number;
			readonly parent: LynxAttachedHostParent;
			readonly before: number | null;
			readonly previousParent: LynxHostParent;
			readonly wasConnected: boolean;
			readonly willBeConnected: boolean;
	  }
	| {
			readonly op: 'remove';
			readonly id: number;
			readonly parent: LynxAttachedHostParent;
	  }
	| {
			readonly op: 'visibility';
			readonly id: number;
			readonly state: 'hidden' | 'visible';
			readonly authoredHidden: unknown;
			readonly events: ReadonlyMap<string, UniversalEventListenerDescriptor>;
			readonly generation: number;
	  }
	| {
			readonly op: 'destroy';
			readonly id: number;
			readonly events: ReadonlyMap<string, UniversalEventListenerDescriptor>;
	  }
	| {
			readonly op: 'ensure-public-instance';
			readonly id: number;
	  }
	| {
			readonly op: 'event';
			readonly id: number;
			readonly type: string;
			readonly previous: UniversalEventListenerDescriptor | null;
			readonly next: UniversalEventListenerDescriptor | null;
			readonly generation: number;
			readonly visible: boolean;
	  };

function hostError(message: string): Error {
	return new Error(`Octane Lynx host: ${message}`);
}

function assertSafeId(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw hostError(`${label} must be a positive safe integer.`);
	}
}

function assertHostType(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) {
		throw hostError(`${label} must be a non-empty string.`);
	}
}

function cloneHostValue(value: unknown, clones: WeakMap<object, object>): unknown {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value !== 'object') {
		throw hostError(`host props contain unsupported value ${String(value)}.`);
	}
	const existing = clones.get(value);
	if (existing !== undefined) {
		if (!Object.isFrozen(existing)) throw hostError('host props cannot contain cycles.');
		return existing;
	}
	let clone: unknown[] | Record<string, unknown>;
	if (Array.isArray(value)) {
		clone = [];
	} else {
		// Host props arrive from the background thread, a distinct realm in
		// production, so their prototype is that realm's Object.prototype.
		if (!hasCrossRealmPlainPrototype(value)) {
			throw hostError(
				`host props require plain objects, received ${Object.prototype.toString.call(value)}.`,
			);
		}
		clone = Object.create(null) as Record<string, unknown>;
	}
	clones.set(value, clone);
	if (Array.isArray(value)) {
		const output = clone as unknown[];
		output.length = value.length;
		for (let index = 0; index < value.length; index++) {
			if (!(index in value)) continue;
			output[index] = cloneHostValue(value[index], clones);
		}
	} else {
		const output = clone as Record<string, unknown>;
		for (const name of Object.keys(value)) {
			// Null-prototype objects have no __proto__ setter, so assignment keeps
			// that field as ordinary data without a per-property descriptor object.
			output[name] = cloneHostValue((value as Record<string, unknown>)[name], clones);
		}
	}
	return Object.freeze(clone);
}

const EMPTY_HOST_PROPS: Readonly<Record<string, unknown>> = Object.freeze(Object.create(null));
// Most physical hosts are leaves. This private sentinel is replaced before any
// topology write, avoiding a separate empty array for every template host.
const EMPTY_HOST_CHILDREN: number[] = [];
// Most hosts never own a background event. Keep the shared map private and
// replace it before the first write so ordinary hosts allocate no event table.
const EMPTY_HOST_EVENTS = new Map<string, UniversalEventListenerDescriptor>();

/**
 * The two empty lists a first-tree node snapshot can hold. A large page is
 * mostly leaves with no background events, and copying-then-freezing an empty
 * array for each of them is one allocation per record for a value that is the
 * same value every time.
 */
const EMPTY_FIRST_TREE_CHILDREN: readonly number[] = Object.freeze([]);
const EMPTY_FIRST_TREE_EVENTS: readonly LynxFirstTreeEventSnapshot[] = Object.freeze([]);

/**
 * What a first-screen node carries when its program declares no keyed range at
 * all, so that the common case states nothing rather than restating empty.
 *
 * A program that does declare ranges carries a full entry for every one of
 * them, exactly as it already must for `spans` — these stand in for a missing
 * table, not for missing entries.
 */
const EMPTY_PROGRAM_IDS: readonly number[] = Object.freeze([]);
const EMPTY_PROGRAM_RANGE_TEXTS: readonly (string | undefined)[] = Object.freeze([]);
const EMPTY_PROGRAM_RANGE_IDS: readonly (number | undefined)[] = Object.freeze([]);
// Raw text is initialized by __CreateRawText itself. Its synthetic `value`
// attribute is never forwarded, so an unscoped creation needs no prop diff.
const EMPTY_RAW_TEXT_CREATE_PATCH: LynxHostPropPatch = Object.freeze({
	attributes: Object.freeze([]),
	mainThreadEvents: Object.freeze([]),
	requiresRecreate: false,
});

/**
 * A compact ACK reconstructs host identities on the background thread, so the
 * main thread need not allocate 90,000 frozen public snapshots up front. Keep
 * the full own-data-property snapshot lazy while hot range loops use primitives.
 */
class LynxCompactHostRecord<Node extends LynxElementRef> implements LynxHostRecord<Node> {
	node: Node | null = null;
	visible = true;
	children = EMPTY_HOST_CHILDREN;
	selectorWanted = false;
	selectorInstalled = false;
	private eventTable = EMPTY_HOST_EVENTS;
	private cachedHandle: LynxHostHandle | null = null;

	constructor(
		private readonly root: number,
		readonly id: number,
		readonly generation: number,
		public type: string,
		public props: Readonly<Record<string, unknown>>,
		public parent: LynxHostParent,
	) {}

	get handle(): LynxHostHandle {
		return (this.cachedHandle ??= createHandle(this.root, this.id, this.type, this.generation));
	}

	set handle(handle: LynxHostHandle) {
		this.cachedHandle = handle;
	}

	get events(): Map<string, UniversalEventListenerDescriptor> {
		return this.eventTable;
	}

	set events(events: Map<string, UniversalEventListenerDescriptor>) {
		this.eventTable = events;
	}
}

interface LynxPreparedStaticHostProps {
	readonly props: Readonly<Record<string, unknown>>;
	readonly patch: LynxHostPropPatch;
}

// A compiler-hoisted scalar class bag is immutable and shared by every row.
// Host type remains part of the key because prop channels differ by element.
const PREPARED_STATIC_HOST_PROPS = new WeakMap<object, Map<string, LynxPreparedStaticHostProps>>();

interface LynxPreparedTemplateShape {
	readonly types: readonly string[];
	readonly parents: readonly number[];
}

interface LynxPreparedTemplateProgramEvent {
	readonly node: number;
	readonly index: number;
	readonly type: string;
	readonly priority: UniversalEventListenerDescriptor['priority'];
	readonly binding: LynxNativeEventBinding;
}

/** Logical event maps are needed only when a compact host is later observed. */
class LynxCompactEventHostRecord<Node extends LynxElementRef> extends LynxCompactHostRecord<Node> {
	constructor(
		root: number,
		id: number,
		generation: number,
		type: string,
		props: Readonly<Record<string, unknown>>,
		parent: LynxHostParent,
		private readonly sites: readonly LynxPreparedTemplateProgramEvent[],
		private readonly firstListenerId: number,
	) {
		super(root, id, generation, type, props, parent);
	}

	override get events(): Map<string, UniversalEventListenerDescriptor> {
		const current = super.events;
		if (current !== EMPTY_HOST_EVENTS) return current;
		const events = new Map<string, UniversalEventListenerDescriptor>();
		for (const site of this.sites) {
			events.set(
				site.type,
				Object.freeze({ id: this.firstListenerId + site.index, priority: site.priority }),
			);
		}
		super.events = events;
		return events;
	}

	override set events(events: Map<string, UniversalEventListenerDescriptor>) {
		super.events = events;
	}
}

interface LynxPreparedTemplateProgram {
	readonly shape: LynxPreparedTemplateShape;
	readonly props: readonly Readonly<Record<string, unknown>>[];
	readonly patches: readonly (LynxHostPropPatch | undefined)[];
	readonly bindings: readonly (readonly UniversalHostTemplateProgramBinding[] | undefined)[];
	/** Cached scalar-only creation routes: 0 generic, 1 raw text, 2 class/id. */
	readonly dynamicRoutes: readonly (0 | 1 | 2)[];
	readonly events: readonly (readonly LynxPreparedTemplateProgramEvent[] | undefined)[];
	readonly eventSites: readonly LynxPreparedTemplateProgramEvent[];
	readonly eventCount: number;
	readonly valueCount: number;
	/**
	 * Which value slots a `main-thread:` binding owns, or `null` when the program
	 * has none — which is every program the universal path produces today.
	 *
	 * A worklet descriptor is an object, and every other slot in this format is a
	 * scalar so a frame can be validated by its header alone. Naming the worklet
	 * slots in the program keeps that property: the shape is checked once here and
	 * cached, and a slot bound to `class` that arrives carrying an object is still
	 * the error it always was.
	 */
	readonly mainThreadValues: readonly boolean[] | null;
}

interface LynxDenseTeardownPlan<Node extends LynxElementRef> {
	readonly store: LynxDenseHostRecordStore<Node>;
	readonly records: Map<number, LynxHostRecord<Node>>;
	readonly rootChildren: number[];
	readonly acceptedChildren: readonly number[];
	readonly parent: number | null;
	readonly eventCommands: number;
	readonly direct: boolean;
	readonly firstId: number;
	readonly hostCount: number;
}

/**
 * Everything a template run needs to say what any one of its hosts is.
 *
 * A run is `count` copies of one program, so a host's type, static props, bound
 * props, logical parent, children and listener ids are all arithmetic over the
 * run plus an offset. Two callers depend on that: the compact first screen,
 * which keeps a run as a dense store and derives a record whenever something
 * observes one, and a deferred run under a native `<list>`, which keeps no
 * records at all until the list asks for a cell. They have to agree about what a
 * run's host *is*, so the derivation is written once here rather than once in
 * each.
 */
interface LynxTemplateRunDeclaration {
	readonly root: number;
	readonly program: LynxPreparedTemplateProgram;
	readonly firstId: number;
	readonly count: number;
	readonly parent: LynxAttachedHostParent;
	readonly values: readonly UniversalHostTemplateProgramValue[];
	readonly firstListenerId: number | null;
}

/** Hosts in a run, counting every node of every instance. */
function templateRunHostCount(run: LynxTemplateRunDeclaration): number {
	return run.count * run.program.shape.types.length;
}

/**
 * Derive the record for the host at `offset` within `run`.
 *
 * The caller owns identity: this allocates a fresh record every call, and
 * whoever needs writes to a host to stick is the one that has to keep it.
 */
function templateRunRecord<Node extends LynxElementRef>(
	run: LynxTemplateRunDeclaration,
	offset: number,
	generation: number,
): LynxHostRecord<Node> {
	const program = run.program;
	const width = program.shape.types.length;
	const row = Math.floor(offset / width);
	const node = offset - row * width;
	const rowFirstId = run.firstId + row * width;
	const id = rowFirstId + node;
	const bindings = program.bindings[node];
	let props = program.props[node]!;
	if (bindings !== undefined) {
		const next = Object.create(null) as Record<string, unknown>;
		for (const name in props) next[name] = props[name];
		const valueOffset = row * program.valueCount;
		for (const binding of bindings) {
			next[binding.name] = run.values[valueOffset + binding.valueIndex];
		}
		props = Object.freeze(next);
	}
	const parent = node === 0 ? run.parent : rowFirstId + program.shape.parents[node]!;
	const events = program.events[node];
	const record: LynxHostRecord<Node> =
		events === undefined
			? new LynxCompactHostRecord(
					run.root,
					id,
					generation,
					program.shape.types[node]!,
					props,
					parent,
				)
			: new LynxCompactEventHostRecord(
					run.root,
					id,
					generation,
					program.shape.types[node]!,
					props,
					parent,
					events,
					run.firstListenerId! + row * program.eventCount,
				);
	for (let child = node + 1; child < width; child++) {
		if (program.shape.parents[child] === node) {
			hostChildrenForWrite(record).push(rowFirstId + child);
		}
	}
	return record;
}

/**
 * A compact run already describes every host by a frozen program and identity
 * stride. Keep only physical nodes eagerly; materialize logical records,
 * topology, props, events, and public snapshots when one host is observed.
 */
class LynxDenseHostRecordStore<Node extends LynxElementRef> implements LynxHostRecordStore<Node> {
	readonly nodes: (Node | undefined)[];
	private readonly materialized = new Map<number, LynxHostRecord<Node>>();
	private readonly appended = new Map<number, LynxHostRecord<Node>>();
	private removed: Set<number> | null = null;
	private live: number;
	private cleared = false;
	private mutated = false;

	constructor(
		private readonly prefix: Map<number, LynxHostRecord<Node>>,
		readonly root: number,
		readonly program: LynxPreparedTemplateProgram,
		readonly firstId: number,
		readonly count: number,
		readonly parent: LynxAttachedHostParent,
		readonly values: readonly UniversalHostTemplateProgramValue[],
		readonly firstListenerId: number | null,
		readonly hostGenerations: readonly number[] | null = null,
	) {
		this.live = count * program.shape.types.length;
		this.nodes = new Array(this.live);
	}

	generationAt(offset: number): number {
		return this.hostGenerations?.[offset] ?? 1;
	}

	get size(): number {
		return this.prefix.size + this.live + this.appended.size;
	}

	setNode(offset: number, node: Node): void {
		this.nodes[offset] = node;
		if (this.materialized.size !== 0) {
			const record = this.materialized.get(offset);
			if (record !== undefined) record.node = node;
		}
	}

	private isRunRoot(id: number): boolean {
		const offset = id - this.firstId;
		return (
			Number.isSafeInteger(offset) &&
			offset >= 0 &&
			offset < this.nodes.length &&
			offset % this.program.shape.types.length === 0
		);
	}

	/**
	 * Directly certify the sole destroy-run for this untouched dense store.
	 * Accepted state, not synthesized per-host commands, is the authority: the
	 * store was created from one frozen program and loses this eligibility on
	 * every logical set/delete. Reordered or non-uniform mirrors deliberately
	 * return null so the existing expansion validator remains their fallback.
	 */
	prepareDirectFullTeardown(
		state: LynxHostState<Node>,
		command: Extract<UniversalHostCommand, { op: 'destroy-run' }>,
	): LynxDenseTeardownPlan<Node> | null {
		const width = this.program.shape.types.length;
		if (
			state.records !== this ||
			state.teardownRecords !== null ||
			state.faulted ||
			this.hostGenerations !== null ||
			this.mutated ||
			this.cleared ||
			this.appended.size !== 0 ||
			this.removed?.size ||
			this.live !== this.nodes.length ||
			this.nodes.length === 0 ||
			this.nodes.length !== this.count * width ||
			command.width !== width ||
			command.firstId !== this.firstId ||
			command.count !== this.count ||
			!Object.is(command.parent, this.parent) ||
			state.hasMainThreadProps ||
			state.hasNativeListTopology ||
			state.portalRoot !== null ||
			state.portalChildren.size !== 0 ||
			state.mainThreadRefs.size !== 0 ||
			state.mainThreadRefOwners.size !== 0 ||
			state.lists.size !== 0 ||
			!state.implicitInitialGenerations ||
			state.ownedNodes.size !== this.prefix.size + this.nodes.length
		) {
			return null;
		}
		const parent = this.parent;
		if (isPortalParent(parent)) return null;
		for (const id of state.generations.keys()) {
			if (id >= this.firstId && id < this.firstId + this.nodes.length) return null;
		}

		const parentRecord = typeof parent === 'number' ? this.prefix.get(parent) : undefined;
		if (typeof parent === 'number' && parentRecord === undefined) return null;
		const acceptedChildren = parent === null ? state.rootChildren : parentRecord!.children;
		const survivingChildren: number[] = [];
		let roots = 0;
		for (const id of acceptedChildren) {
			if (this.isRunRoot(id)) {
				if (id !== this.firstId + roots * width) return null;
				roots++;
			} else {
				survivingChildren.push(id);
			}
		}
		if (roots !== this.count) return null;

		const records = new Map(this.prefix);
		if (parentRecord !== undefined) {
			const nextParent = cloneRecord(parentRecord);
			nextParent.children =
				survivingChildren.length === 0 ? EMPTY_HOST_CHILDREN : survivingChildren;
			records.set(parent as number, nextParent);
		}
		return {
			store: this,
			records,
			rootChildren: parent === null ? survivingChildren : state.rootChildren,
			acceptedChildren,
			parent,
			eventCommands: this.count * this.program.eventCount,
			direct: true,
			firstId: this.firstId,
			hostCount: this.nodes.length,
		};
	}

	/**
	 * Expand one destroy-run command into the exact certified per-host
	 * teardown sequence this store would verify: event unbinds, root removes,
	 * then post-order destroys, in the accepted child order. The expansion is
	 * synthesized from accepted state, so a full-store run re-enters the
	 * certified teardown fast path unchanged while partial runs flow through
	 * the general command loop.
	 */
	expandRunTeardown(
		state: LynxHostState<Node>,
		command: Extract<UniversalHostCommand, { op: 'destroy-run' }>,
	): UniversalHostCommand[] | null {
		const width = this.program.shape.types.length;
		if (command.width !== width) return null;
		if (this.cleared) return null;
		if (!Object.is(command.parent, this.parent)) return null;
		const offset = command.firstId - this.firstId;
		const hostCount = command.count * width;
		if (offset < 0 || offset % width !== 0 || offset + hostCount > this.nodes.length) {
			return null;
		}
		const inRange = (id: number): boolean =>
			id >= command.firstId && id < command.firstId + hostCount && this.isRunRoot(id);
		for (let row = 0; row < command.count; row++) {
			if (this.nodes[offset + row * width] === undefined) return null;
			// `removed` stores store-relative offsets, the same unit every other
			// reader of it uses; an absolute id here would test an unrelated row.
			if (this.removed?.has(offset + row * width)) return null;
		}
		const parentRecord = typeof this.parent === 'number' ? this.prefix.get(this.parent) : undefined;
		const acceptedChildren =
			this.parent === null ? state.rootChildren : (parentRecord?.children ?? null);
		const orderedRoots: number[] = [];
		if (acceptedChildren !== null) {
			for (const id of acceptedChildren) if (inRange(id)) orderedRoots.push(id);
		}
		if (orderedRoots.length !== command.count) {
			orderedRoots.length = 0;
			for (let row = 0; row < command.count; row++) {
				orderedRoots.push(command.firstId + row * width);
			}
		}
		const postorder: number[] = [];
		const visit = (node: number): void => {
			for (let child = node + 1; child < width; child++) {
				if (this.program.shape.parents[child] === node) visit(child);
			}
			postorder.push(node);
		};
		visit(0);
		if (postorder.length !== width) return null;
		const commands: UniversalHostCommand[] = [];
		for (const rootId of orderedRoots) {
			for (const node of postorder) {
				const events = this.program.events[node];
				if (events === undefined) continue;
				for (const event of events) {
					commands.push({ op: 'event', id: rootId + node, type: event.type, listener: null });
				}
			}
		}
		for (const rootId of orderedRoots) {
			commands.push({ op: 'remove', parent: command.parent, id: rootId });
		}
		for (const rootId of orderedRoots) {
			for (const node of postorder) {
				commands.push({ op: 'destroy', id: rootId + node });
			}
		}
		return commands;
	}

	prepareFullTeardown(
		state: LynxHostState<Node>,
		batch: UniversalHostBatch,
	): LynxDenseTeardownPlan<Node> | null {
		const lastCommand = batch.commands[batch.commands.length - 1];
		if (batch.commands.length < this.nodes.length + this.count || lastCommand?.op !== 'destroy') {
			return null;
		}
		if (
			this.cleared ||
			this.appended.size !== 0 ||
			this.removed?.size ||
			this.live !== this.nodes.length ||
			this.nodes.length === 0 ||
			state.hasMainThreadProps ||
			state.hasNativeListTopology ||
			state.portalRoot !== null ||
			state.portalChildren.size !== 0 ||
			state.mainThreadRefs.size !== 0 ||
			state.mainThreadRefOwners.size !== 0 ||
			state.lists.size !== 0 ||
			!state.implicitInitialGenerations
		) {
			return null;
		}
		const parent = this.parent;
		if (isPortalParent(parent)) return null;
		const width = this.program.shape.types.length;
		if (this.nodes.length !== this.count * width) return null;
		for (const [id, generation] of state.generations) {
			if (
				id >= this.firstId &&
				id < this.firstId + this.nodes.length &&
				generation !== this.generationAt(id - this.firstId)
			) {
				return null;
			}
		}

		const parentRecord = typeof parent === 'number' ? this.prefix.get(parent) : undefined;
		if (typeof parent === 'number' && parentRecord === undefined) return null;
		const acceptedChildren = parent === null ? state.rootChildren : parentRecord!.children;
		const survivingChildren: number[] = [];
		let roots = 0;
		for (const id of acceptedChildren) {
			if (this.isRunRoot(id)) roots++;
			else survivingChildren.push(id);
		}
		if (roots !== this.count) return null;

		const postorder: number[] = [];
		const visit = (node: number): void => {
			for (let child = node + 1; child < width; child++) {
				if (this.program.shape.parents[child] === node) visit(child);
			}
			postorder.push(node);
		};
		visit(0);
		if (postorder.length !== width) return null;

		let commandIndex = 0;
		for (const rootId of acceptedChildren) {
			if (!this.isRunRoot(rootId)) continue;
			for (const node of postorder) {
				const events = this.program.events[node];
				if (events === undefined) continue;
				const physical = this.nodes[rootId - this.firstId + node];
				if (physical === undefined) return null;
				const registrations = state.nativeEvents.get(physical);
				if (registrations?.size !== events.length) return null;
				for (const event of events) {
					const command = batch.commands[commandIndex++];
					if (
						command?.op !== 'event' ||
						command.id !== rootId + node ||
						command.type !== event.type ||
						command.listener !== null ||
						!registrations.has(event.type)
					) {
						return null;
					}
				}
			}
		}
		const eventCommands = commandIndex;
		for (const rootId of acceptedChildren) {
			if (!this.isRunRoot(rootId)) continue;
			const command = batch.commands[commandIndex++];
			if (command?.op !== 'remove' || command.id !== rootId || command.parent !== parent) {
				return null;
			}
		}
		for (const rootId of acceptedChildren) {
			if (!this.isRunRoot(rootId)) continue;
			for (const node of postorder) {
				const command = batch.commands[commandIndex++];
				if (command?.op !== 'destroy' || command.id !== rootId + node) return null;
			}
		}
		if (commandIndex !== batch.commands.length) return null;

		if (state.ownedNodes.size !== this.prefix.size + this.nodes.length) return null;
		for (const record of this.prefix.values()) {
			if (record.node === null || !state.ownedNodes.has(record.node)) return null;
		}
		for (let offset = 0; offset < this.nodes.length; offset++) {
			const node = this.nodes[offset];
			if (node === undefined || !state.ownedNodes.has(node)) return null;
			const expectedEvents = this.program.events[offset % width];
			if ((state.nativeEvents.get(node)?.size ?? 0) !== (expectedEvents?.length ?? 0)) return null;
		}
		if (parent === null) {
			for (const rootId of acceptedChildren) {
				if (!this.isRunRoot(rootId)) continue;
				const node = this.nodes[rootId - this.firstId];
				if (node === undefined || !state.ownedPageRoots.has(node)) return null;
			}
		}

		const records = new Map(this.prefix);
		if (parentRecord !== undefined) {
			const nextParent = cloneRecord(parentRecord);
			nextParent.children =
				survivingChildren.length === 0 ? EMPTY_HOST_CHILDREN : survivingChildren;
			records.set(parent as number, nextParent);
		}
		return {
			store: this,
			records,
			rootChildren: parent === null ? survivingChildren : state.rootChildren,
			acceptedChildren,
			parent,
			eventCommands,
			direct: false,
			firstId: this.firstId,
			hostCount: this.nodes.length,
		};
	}

	private offset(id: number): number {
		const offset = id - this.firstId;
		return !this.cleared &&
			Number.isSafeInteger(offset) &&
			offset >= 0 &&
			offset < this.nodes.length
			? offset
			: -1;
	}

	get(id: number): LynxHostRecord<Node> | undefined {
		const offset = this.offset(id);
		if (offset === -1) return this.prefix.get(id) ?? this.appended.get(id);
		if (this.removed?.has(offset)) return undefined;
		const previous = this.materialized.get(offset);
		if (previous !== undefined) return previous;
		const record = templateRunRecord<Node>(this, offset, this.generationAt(offset));
		record.node = this.nodes[offset] ?? null;
		this.materialized.set(offset, record);
		return record;
	}

	has(id: number): boolean {
		const offset = this.offset(id);
		return offset === -1
			? this.prefix.has(id) || this.appended.has(id)
			: !this.removed?.has(offset);
	}

	set(id: number, record: LynxHostRecord<Node>): this {
		this.mutated = true;
		const offset = this.offset(id);
		if (offset !== -1) {
			if (this.removed?.delete(offset)) this.live++;
			this.materialized.set(offset, record);
			this.nodes[offset] = record.node ?? undefined;
		} else if (this.prefix.has(id)) {
			this.prefix.set(id, record);
		} else {
			this.appended.set(id, record);
		}
		return this;
	}

	delete(id: number): boolean {
		const offset = this.offset(id);
		if (offset !== -1) {
			if (this.removed?.has(offset)) return false;
			this.mutated = true;
			(this.removed ??= new Set()).add(offset);
			this.materialized.delete(offset);
			this.nodes[offset] = undefined;
			this.live--;
			return true;
		}
		const deleted = this.prefix.delete(id) || this.appended.delete(id);
		if (deleted) this.mutated = true;
		return deleted;
	}

	clear(): void {
		this.prefix.clear();
		this.appended.clear();
		this.materialized.clear();
		this.removed?.clear();
		this.nodes.length = 0;
		this.live = 0;
		this.cleared = true;
	}

	*keys(): IterableIterator<number> {
		yield* this.prefix.keys();
		if (!this.cleared) {
			for (let offset = 0; offset < this.nodes.length; offset++) {
				if (!this.removed?.has(offset)) yield this.firstId + offset;
			}
		}
		yield* this.appended.keys();
	}

	*[Symbol.iterator](): IterableIterator<[number, LynxHostRecord<Node>]> {
		yield* this.prefix;
		if (!this.cleared) {
			for (let offset = 0; offset < this.nodes.length; offset++) {
				if (this.removed?.has(offset)) continue;
				const id = this.firstId + offset;
				yield [id, this.get(id)!];
			}
		}
		yield* this.appended;
	}
}

// Compiler-hoisted immutable shapes repeat once per row. Weak ownership keeps
// validation and topology arrays alive only as long as their authored plan.
const PREPARED_TEMPLATE_SHAPES = new WeakMap<object, LynxPreparedTemplateShape>();
const PREPARED_TEMPLATE_PROGRAMS = new WeakMap<object, LynxPreparedTemplateProgram>();

function prepareTemplateShape(value: unknown, label: string): LynxPreparedTemplateShape {
	if (!Array.isArray(value) || value.length === 0) {
		throw hostError(`${label}.shape must be a non-empty array.`);
	}
	const cached = PREPARED_TEMPLATE_SHAPES.get(value);
	if (cached !== undefined) return cached;
	const types: string[] = new Array(value.length);
	const parents: number[] = new Array(value.length);
	let immutable = Object.isFrozen(value);
	for (let index = 0; index < value.length; index++) {
		const candidate: unknown = value[index];
		if (candidate === null || typeof candidate !== 'object') {
			throw hostError(`${label}.shape[${index}] must be an object.`);
		}
		const entry = candidate as { readonly type: unknown; readonly parent: unknown };
		assertHostType(entry.type, `${label}.shape[${index}].type`);
		// A `<list>` stays out entirely: a template program has no way to carry the
		// row descriptors a list needs. A `<list-item>` is a list's cell, so a run
		// may declare one — that is what a deferred run under a `<list>` is — but
		// never nest one, because a cell has exactly one place it can be.
		if (entry.type === 'list') {
			throw hostError(`${label} cannot contain native-list hosts.`);
		}
		if (entry.type === 'list-item' && index !== 0) {
			throw hostError(`${label} may only declare a <list-item> as its root.`);
		}
		const parent = entry.parent;
		if (
			typeof parent !== 'number' ||
			!Number.isSafeInteger(parent) ||
			(index === 0 ? parent !== -1 : parent < 0 || parent >= index)
		) {
			throw hostError(
				index === 0
					? `${label}.shape[0].parent must be -1.`
					: `${label}.shape[${index}].parent must reference an earlier template node.`,
			);
		}
		if (
			index !== 0 &&
			(entry.type === '#text' || entry.type === 'raw-text') &&
			types[parent] !== 'text'
		) {
			throw hostError(
				`${entry.type} template host ${index} may only be placed directly under a text host.`,
			);
		}
		types[index] = entry.type;
		parents[index] = parent;
		immutable &&= Object.isFrozen(entry);
	}
	const prepared = Object.freeze({ types: Object.freeze(types), parents: Object.freeze(parents) });
	if (immutable) PREPARED_TEMPLATE_SHAPES.set(value, prepared);
	return prepared;
}

function cloneProps(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw hostError(`${label} must be a plain object.`);
	}
	// The render-only main graph authors `main-thread:` event props as tagged
	// callables. Unwrap them to their plain worklet descriptors here, exactly as
	// the background client driver does before transport; an untagged function
	// still fails through cloneHostValue below.
	let source = value as Record<string, unknown>;
	const names = Object.keys(source);
	let rewritten: Record<string, unknown> | null = null;
	for (const name of names) {
		if (!name.startsWith('main-thread:') || name === 'main-thread:ref') continue;
		const item = source[name];
		if (typeof item !== 'function') continue;
		const descriptor = getThreadFunctionDescriptor(item);
		if (descriptor === null) continue;
		if (rewritten === null) rewritten = { ...source };
		rewritten[name] = descriptor;
	}
	if (rewritten !== null) source = rewritten;
	if (!hasCrossRealmPlainPrototype(source)) {
		throw hostError(
			`host props require plain objects, received ${Object.prototype.toString.call(source)}.`,
		);
	}
	if (names.length === 0) return EMPTY_HOST_PROPS;

	const clone = Object.create(null) as Record<string, unknown>;
	let clones: WeakMap<object, object> | null = null;
	for (const name of names) {
		const child = source[name];
		if (
			child === null ||
			child === undefined ||
			typeof child === 'string' ||
			typeof child === 'number' ||
			typeof child === 'bigint' ||
			typeof child === 'boolean'
		) {
			clone[name] = child;
			continue;
		}
		// Scalar-only host props account for most nodes. Seed cycle/alias tracking
		// only when the first nested value actually needs a recursive clone.
		clones ??= new WeakMap<object, object>([[source, clone]]);
		clone[name] = cloneHostValue(child, clones);
	}
	return Object.freeze(clone);
}

function prepareStaticHostProps(
	type: string,
	value: unknown,
	label: string,
): LynxPreparedStaticHostProps | undefined {
	if (type === '#text' || value === null || typeof value !== 'object') {
		return undefined;
	}
	const previous = PREPARED_STATIC_HOST_PROPS.get(value);
	const known = previous?.get(type);
	if (known !== undefined) return known;
	if (!Object.isFrozen(value)) return undefined;
	const names = Object.keys(value);
	if (
		names.length > 1 ||
		(names.length === 1 && names[0] !== 'class' && names[0] !== 'className')
	) {
		return undefined;
	}
	if (names.length !== 0) {
		const descriptor = Object.getOwnPropertyDescriptor(value, names[0]);
		if (
			descriptor === undefined ||
			!('value' in descriptor) ||
			typeof descriptor.value !== 'string'
		) {
			return undefined;
		}
	}
	const props = cloneProps(value, label);
	const prepared = Object.freeze({
		props,
		patch: planLynxHostPropPatch(type, EMPTY_HOST_PROPS, props),
	});
	if (previous === undefined) {
		PREPARED_STATIC_HOST_PROPS.set(value, new Map([[type, prepared]]));
	} else {
		previous.set(type, prepared);
	}
	return prepared;
}

function prepareTemplateProgram(value: unknown, label: string): LynxPreparedTemplateProgram {
	if (value === null || typeof value !== 'object') {
		throw hostError(`${label}.program must be an object.`);
	}
	const cached = PREPARED_TEMPLATE_PROGRAMS.get(value);
	if (cached !== undefined) return cached;
	const program = value as UniversalHostTemplateProgram;
	if (!Array.isArray(program.events)) {
		throw hostError(`${label}.program.events must be an array.`);
	}
	const shape = prepareTemplateShape(program.nodes, `${label}.program`);
	const staticProps: Readonly<Record<string, unknown>>[] = new Array(shape.types.length);
	const staticPatches: (LynxHostPropPatch | undefined)[] = new Array(shape.types.length);
	const bindings: (readonly UniversalHostTemplateProgramBinding[] | undefined)[] = new Array(
		shape.types.length,
	);
	const dynamicRoutes: (0 | 1 | 2)[] = new Array(shape.types.length).fill(0);
	let mainThreadValues: boolean[] | null = null;
	const mainThreadBindings: (string[] | undefined)[] = new Array(shape.types.length);
	const eventSites: (LynxPreparedTemplateProgramEvent[] | undefined)[] = new Array(
		shape.types.length,
	);
	const orderedEvents: LynxPreparedTemplateProgramEvent[] = new Array(program.events.length);
	let immutable =
		Object.isFrozen(value) && Object.isFrozen(program.nodes) && Object.isFrozen(program.events);
	let valueCount = 0;
	const seenValues = new Set<number>();

	for (let nodeIndex = 0; nodeIndex < shape.types.length; nodeIndex++) {
		const node = program.nodes[nodeIndex]!;
		const props = cloneProps(node.props, `${label}.program.nodes[${nodeIndex}].props`);
		for (const name in props) {
			const entry = props[name];
			if (
				entry !== null &&
				entry !== undefined &&
				typeof entry !== 'string' &&
				typeof entry !== 'number' &&
				typeof entry !== 'boolean' &&
				typeof entry !== 'bigint'
			) {
				throw hostError(`${label}.program.nodes[${nodeIndex}].props must contain only scalars.`);
			}
		}
		staticProps[nodeIndex] = props;
		immutable &&= Object.isFrozen(node) && Object.isFrozen(node.props);
		if (node.bindings !== undefined) {
			if (!Array.isArray(node.bindings) || node.bindings.length === 0) {
				throw hostError(`${label}.program.nodes[${nodeIndex}].bindings must be a non-empty array.`);
			}
			const copied: UniversalHostTemplateProgramBinding[] = new Array(node.bindings.length);
			const names = new Set<string>();
			immutable &&= Object.isFrozen(node.bindings);
			for (let bindingIndex = 0; bindingIndex < node.bindings.length; bindingIndex++) {
				const binding = node.bindings[bindingIndex];
				if (binding === null || typeof binding !== 'object') {
					throw hostError(
						`${label}.program.nodes[${nodeIndex}].bindings[${bindingIndex}] must be an object.`,
					);
				}
				assertHostType(
					binding.name,
					`${label}.program.nodes[${nodeIndex}].bindings[${bindingIndex}].name`,
				);
				if (names.has(binding.name)) {
					throw hostError(`${label}.program.nodes[${nodeIndex}] repeats binding ${binding.name}.`);
				}
				names.add(binding.name);
				if (!Number.isSafeInteger(binding.valueIndex) || binding.valueIndex < 0) {
					throw hostError(
						`${label}.program.nodes[${nodeIndex}].bindings[${bindingIndex}].valueIndex must be a non-negative safe integer.`,
					);
				}
				if (seenValues.has(binding.valueIndex)) {
					throw hostError(`${label}.program repeats scalar value index ${binding.valueIndex}.`);
				}
				seenValues.add(binding.valueIndex);
				valueCount = Math.max(valueCount, binding.valueIndex + 1);
				if (binding.name.startsWith('main-thread:')) {
					(mainThreadBindings[nodeIndex] ??= []).push(binding.name);
					// Raw text has no Element surface to own a worklet or a ref, which is
					// why `assertTextProps` refuses every prop but `value` there. Saying so
					// at program time reports the authoring mistake once rather than once
					// per instance.
					const boundType = shape.types[nodeIndex]!;
					if (boundType === '#text' || boundType === 'raw-text') {
						throw hostError(
							`${label}.program.nodes[${nodeIndex}] cannot bind main-thread prop ${JSON.stringify(binding.name)} on ${boundType}.`,
						);
					}
					(mainThreadValues ??= [])[binding.valueIndex] = true;
				}
				copied[bindingIndex] = Object.freeze({
					name: binding.name,
					valueIndex: binding.valueIndex,
				});
				immutable &&= Object.isFrozen(binding);
			}
			bindings[nodeIndex] = Object.freeze(copied);
			const type = shape.types[nodeIndex]!;
			if (
				type === '#text' &&
				Object.keys(props).every((name) => name === 'value') &&
				copied.every((binding) => binding.name === 'value')
			) {
				dynamicRoutes[nodeIndex] = 1;
			} else if (
				(type === 'view' || type === 'text') &&
				Object.keys(props).every(
					(name) => name === 'class' || name === 'className' || name === 'id',
				) &&
				copied.every(
					(binding) =>
						binding.name === 'class' || binding.name === 'className' || binding.name === 'id',
				)
			) {
				dynamicRoutes[nodeIndex] = 2;
			}
		} else {
			assertTextProps(shape.types[nodeIndex]!, props, label);
			const patch =
				shape.types[nodeIndex] === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
					? EMPTY_RAW_TEXT_CREATE_PATCH
					: planLynxHostPropPatch(shape.types[nodeIndex]!, EMPTY_HOST_PROPS, props);
			if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
				throw hostError(`${label}.program.nodes[${nodeIndex}] cannot contain main-thread props.`);
			}
			staticPatches[nodeIndex] = patch;
		}
	}
	if (seenValues.size !== valueCount) {
		throw hostError(`${label}.program scalar value indices must be dense.`);
	}

	for (let eventIndex = 0; eventIndex < program.events.length; eventIndex++) {
		const event = program.events[eventIndex];
		if (event === null || typeof event !== 'object') {
			throw hostError(`${label}.program.events[${eventIndex}] must be an object.`);
		}
		if (!Number.isSafeInteger(event.node) || event.node < 0 || event.node >= shape.types.length) {
			throw hostError(`${label}.program.events[${eventIndex}].node must name a program host.`);
		}
		if (shape.types[event.node] === '#text' || shape.types[event.node] === 'raw-text') {
			throw hostError(`raw-text template host ${event.node} cannot own native events.`);
		}
		const binding = parseLynxNativeEventProp(event.type);
		if (binding === null) {
			throw hostError(`event ${JSON.stringify(event.type)} is not a Lynx event prop.`);
		}
		if (
			event.priority !== 'continuous' &&
			event.priority !== 'default' &&
			event.priority !== 'discrete'
		) {
			throw hostError(`${label}.program.events[${eventIndex}] has invalid event priority.`);
		}
		const events = (eventSites[event.node] ??= []);
		if (events.some((existing) => existing.type === event.type)) {
			throw hostError(`${label}.program host ${event.node} repeats event ${event.type}.`);
		}
		const preparedEvent = Object.freeze({
			node: event.node,
			index: eventIndex,
			type: event.type,
			priority: event.priority,
			binding,
		});
		events.push(preparedEvent);
		orderedEvents[eventIndex] = preparedEvent;
		immutable &&= Object.isFrozen(event);
	}
	for (const events of eventSites) if (events !== undefined) Object.freeze(events);
	if (mainThreadValues !== null) {
		// The same channel cannot carry both a worklet and a background listener,
		// and a program says both statically: the binding names one, the event
		// sites name the other. Refusing here costs nothing per instance and
		// reports the collision with the same words every other applier uses.
		for (let nodeIndex = 0; nodeIndex < mainThreadBindings.length; nodeIndex++) {
			const names = mainThreadBindings[nodeIndex];
			const events = eventSites[nodeIndex];
			if (names === undefined || events === undefined) continue;
			assertNoMainThreadEventCollisionForTypes(
				Object.fromEntries(names.map((name) => [name, true])),
				events.map((event) => event.type),
			);
		}
		for (let slot = 0; slot < valueCount; slot++) mainThreadValues[slot] ??= false;
	}
	const prepared = Object.freeze({
		shape,
		props: Object.freeze(staticProps),
		patches: Object.freeze(staticPatches),
		bindings: Object.freeze(bindings),
		dynamicRoutes: Object.freeze(dynamicRoutes),
		events: Object.freeze(eventSites),
		eventSites: Object.freeze(orderedEvents),
		eventCount: program.events.length,
		valueCount,
		mainThreadValues: mainThreadValues === null ? null : Object.freeze(mainThreadValues),
	});
	if (immutable) PREPARED_TEMPLATE_PROGRAMS.set(value, prepared);
	return prepared;
}

function assertTextProps(
	type: string,
	props: Readonly<Record<string, unknown>>,
	label: string,
): void {
	if (type !== '#text') return;
	if (typeof props.value !== 'string') {
		throw hostError(`${label} for #text must contain a string value and optional CSS scope.`);
	}
	for (const name in props) {
		if (name !== 'value' && name !== LYNX_CSS_SCOPE_PROP) {
			throw hostError(`${label} for #text must contain a string value and optional CSS scope.`);
		}
	}
}

function planScalarClassAndIdCreation(props: Readonly<Record<string, unknown>>): LynxHostPropPatch {
	const patch: {
		id?: { readonly value: string | null };
		classes?: { readonly value: string };
		readonly attributes: readonly never[];
		readonly mainThreadEvents: readonly never[];
		readonly requiresRecreate: false;
	} = {
		attributes: EMPTY_RAW_TEXT_CREATE_PATCH.attributes as readonly never[],
		mainThreadEvents: EMPTY_RAW_TEXT_CREATE_PATCH.mainThreadEvents as readonly never[],
		requiresRecreate: false,
	};
	const id = props.id;
	if (id !== null && id !== undefined) patch.id = Object.freeze({ value: String(id) });
	const candidate = Object.prototype.hasOwnProperty.call(props, 'className')
		? props.className
		: props.class;
	const classes =
		typeof candidate === 'string'
			? candidate
			: typeof candidate === 'number' && candidate
				? String(candidate)
				: '';
	if (classes !== '') patch.classes = Object.freeze({ value: classes });
	return Object.freeze(patch);
}

function applyDenseScalarHostProps<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	node: Node,
	props: Readonly<Record<string, unknown>>,
	bindings: readonly UniversalHostTemplateProgramBinding[],
	values: readonly UniversalHostTemplateProgramValue[],
	valueOffset: number,
): void {
	let id = props.id;
	let ordinaryClass = props.class;
	let aliasedClass = props.className;
	let hasAliasedClass = Object.prototype.hasOwnProperty.call(props, 'className');
	for (const binding of bindings) {
		const value = values[valueOffset + binding.valueIndex];
		if (binding.name === 'id') id = value;
		else if (binding.name === 'className') {
			aliasedClass = value;
			hasAliasedClass = true;
		} else {
			ordinaryClass = value;
		}
	}
	if (id !== null && id !== undefined) papi.setId(node, String(id));
	const candidate = hasAliasedClass ? aliasedClass : ordinaryClass;
	const classes =
		typeof candidate === 'string'
			? candidate
			: typeof candidate === 'number' && candidate
				? String(candidate)
				: '';
	if (classes !== '') papi.setClasses(node, classes);
}

/**
 * A main-thread worklet and a background listener cannot share one native
 * channel: whichever is installed second silently supersedes the other. Both
 * the staged and the direct first-screen path refuse such a host before
 * touching the Element PAPI, so the authoring mistake is reported rather than
 * swallowed, and reported the same way whichever applier owns the page.
 */
function assertNoMainThreadEventCollisionForTypes(
	props: Readonly<Record<string, unknown>>,
	types: Iterable<string>,
): void {
	for (const name of Object.keys(props)) {
		if (props[name] === null || props[name] === undefined) continue;
		const main = parseLynxMainThreadEventProp(name);
		if (main === null) continue;
		for (const type of types) {
			const ordinary = parseLynxNativeEventProp(type);
			if (ordinary?.type !== main.type || ordinary.name !== main.name) continue;
			throw hostError(
				`main-thread event ${JSON.stringify(name)} conflicts with background event ${JSON.stringify(type)} on the same native channel.`,
			);
		}
	}
}

function assertNoMainThreadEventCollision(
	props: Readonly<Record<string, unknown>>,
	events: ReadonlyMap<string, UniversalEventListenerDescriptor>,
): void {
	if (events.size === 0) return;
	assertNoMainThreadEventCollisionForTypes(props, events.keys());
}

function cloneRecord<Node extends LynxElementRef>(
	record: LynxHostRecord<Node>,
): LynxHostRecord<Node> {
	return {
		node: record.node,
		type: record.type,
		props: record.props,
		visible: record.visible,
		parent: record.parent,
		children: record.children.length === 0 ? EMPTY_HOST_CHILDREN : [...record.children],
		events: record.events.size === 0 ? EMPTY_HOST_EVENTS : new Map(record.events),
		handle: record.handle,
		selectorWanted: record.selectorWanted,
		selectorInstalled: record.selectorInstalled,
	};
}

function hostChildrenForWrite<Node extends LynxElementRef>(record: LynxHostRecord<Node>): number[] {
	if (record.children === EMPTY_HOST_CHILDREN) record.children = [];
	return record.children;
}

function createHandle(root: number, id: number, type: string, generation: number): LynxHostHandle {
	return Object.freeze({
		$$kind: 'octane.lynx.element',
		renderer: LYNX_RENDERER_ID,
		root,
		id,
		type,
		generation,
		selector: createLynxNodesRefSelector(root, id, generation),
	});
}

function isPortalParent(parent: LynxHostParent): parent is LynxPortalParent {
	return parent !== null && typeof parent === 'object';
}

function parentHostId(parent: LynxHostParent): number | null | undefined {
	return isPortalParent(parent) ? parent.target : parent;
}

function sameHostParent(first: LynxHostParent, second: LynxHostParent): boolean {
	if (isPortalParent(first) || isPortalParent(second)) {
		return isPortalParent(first) && isPortalParent(second) && first.key === second.key;
	}
	return first === second;
}

function assertNoCycle<Node extends LynxElementRef>(
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	id: number,
	parent: LynxAttachedHostParent,
): void {
	let current = parentHostId(parent);
	const visited = new Set<number>();
	while (typeof current === 'number') {
		if (current === id) throw hostError(`placement of ${id} would create a cycle.`);
		if (visited.has(current)) throw hostError(`existing topology contains a cycle at ${current}.`);
		visited.add(current);
		const record = getRecord(current);
		if (record === undefined) throw hostError(`unknown parent ${current}.`);
		if (record.parent === undefined) return;
		current = parentHostId(record.parent);
	}
}

function isRootConnected<Node extends LynxElementRef>(
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	id: number,
): boolean {
	let current: number | null | undefined = id;
	const visited = new Set<number>();
	while (typeof current === 'number') {
		if (visited.has(current)) throw hostError(`existing topology contains a cycle at ${current}.`);
		visited.add(current);
		const record = getRecord(current);
		if (record === undefined) throw hostError(`topology references unknown host ${current}.`);
		current = parentHostId(record.parent);
	}
	return current === null;
}

function isAcceptedHostConnected<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): boolean {
	let current: number | null | undefined = id;
	const visited = new Set<number>();
	while (typeof current === 'number') {
		if (visited.has(current)) throw hostError(`existing topology contains a cycle at ${current}.`);
		visited.add(current);
		const record = state.records.get(current);
		if (record === undefined) return false;
		current = parentHostId(record.parent);
	}
	return current === null;
}

function nodeFor<Node extends LynxElementRef>(
	nodes: Map<number, Node>,
	id: number,
	label: string,
): Node {
	const node = nodes.get(id);
	if (node === undefined) throw hostError(`${label} references unavailable host ${id}.`);
	return node;
}

function physicalNodeForParent<Node extends LynxElementRef>(
	nodes: Map<number, Node>,
	page: Node,
	parent: LynxAttachedHostParent,
	label: string,
): Node {
	if (parent === null) return page;
	return nodeFor(nodes, isPortalParent(parent) ? parent.target : parent, label);
}

function firstPortalChildNode<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	nodes: Map<number, Node>,
	target: number,
): Node | null {
	const targetNode = nodes.get(target);
	if (targetNode === undefined) return null;
	for (const entry of state.portalChildren.values()) {
		if (entry.parent.target !== target) continue;
		for (const child of entry.children) {
			const node = nodes.get(child);
			// Logical portal state is published before PAPI operations run. During a
			// same-batch retarget, the final destination therefore sees this child
			// before the physical move has happened; it is not a legal `before` node
			// until PAPI confirms that it already belongs to the destination.
			if (node !== undefined && state.papi.isChild(targetNode, node)) return node;
		}
	}
	return null;
}

function textValue(props: Readonly<Record<string, unknown>>): string {
	return typeof props.value === 'string'
		? props.value
		: typeof props.text === 'string'
			? props.text
			: '';
}

function authoredHiddenValue(props: Readonly<Record<string, unknown>>): unknown {
	return props.hidden === null || props.hidden === undefined ? null : props.hidden;
}

function effectiveHiddenValue(visible: boolean, props: Readonly<Record<string, unknown>>): unknown {
	return visible ? authoredHiddenValue(props) : true;
}

function applyProps<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	type: string,
	previous: Readonly<Record<string, unknown>>,
	next: Readonly<Record<string, unknown>>,
	patch: LynxHostPropPatch,
	creating: boolean,
	visible: boolean,
	interactive: boolean,
): void {
	const papi = state.papi;
	if (patch.cssScope !== undefined) {
		papi.setCssId(node, patch.cssScope.value.cssId, patch.cssScope.value.entryName);
	}
	if (type === '#text') {
		if (!creating && !Object.is(previous.value, next.value)) {
			papi.setAttribute(node, 'text', next.value);
		}
		return;
	}
	if (patch.id !== undefined) papi.setId(node, patch.id.value);
	if (patch.classes !== undefined) papi.setClasses(node, patch.classes.value);
	if (patch.inlineStyles !== undefined) papi.setInlineStyles(node, patch.inlineStyles.value);
	if (patch.dataset !== undefined) papi.setDataset(node, patch.dataset.value);
	for (const event of patch.mainThreadEvents) {
		removeNativeEvent(state, node, event.binding.prop);
		if (interactive && event.value !== null) {
			installMainThreadEvent(state, node, event.binding, event.value);
		}
	}
	if (patch.mainThreadRef !== undefined) {
		removeMainThreadRef(state, node);
		if (interactive && patch.mainThreadRef.value !== null) {
			installMainThreadRef(state, node, patch.mainThreadRef.value);
		}
	}
	for (const attribute of patch.attributes) {
		papi.setAttribute(
			node,
			attribute.name,
			attribute.name === 'hidden' ? effectiveHiddenValue(visible, next) : attribute.value,
		);
	}
}

function installNodesRefSelector<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	node: Node,
	handle: LynxHostHandle,
): void {
	// Raw text has no CSS-selectable Element surface. It still receives a cloned
	// identity handle for ref ordering, but query methods fail with node-not-found.
	if (handle.type === '#text' || handle.type === 'raw-text') return;
	papi.setRefSelector(node, `r${handle.root}-h${handle.id}-g${handle.generation}`);
}

function ensureNodesRefSelector<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	record: LynxHostRecord<Node>,
): void {
	if (record.selectorInstalled || record.node === null) return;
	installNodesRefSelector(state.papi, record.node, record.handle);
	record.selectorInstalled = true;
	// An installed selector is a promise to keep answering, so a later physical
	// rebind has to restore it rather than decide again.
	record.selectorWanted = true;
}

/**
 * Decide the selector for a host that has just been given a physical node.
 *
 * A commit that announces every host it will query is answered from the
 * announcement: `ensure-public-instance` is ordered after the creates in the
 * same commit, so a fresh host that needs a handle still gets its selector
 * before the batch ends, and one that never asks costs nothing. A host that
 * asked earlier keeps it, because an installed selector is a promise to keep
 * answering across a physical rebind. Every other commit keeps the eager
 * install: for it an uninstalled selector is a ref that addresses nothing.
 */
function bindNodesRefSelector<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	record: LynxHostRecord<Node>,
): void {
	if (record.selectorWanted || !state.announcesPublicInstances) {
		ensureNodesRefSelector(state, record);
	}
}

/**
 * Record that a public instance was requested, then install if the host owns a
 * physical node right now. A detached native list cell owns none, and the
 * request must survive until the cell is next materialized.
 */
function wantNodesRefSelector<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	record: LynxHostRecord<Node>,
): void {
	record.selectorWanted = true;
	ensureNodesRefSelector(state, record);
}

function nativeEventMap<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
): Map<string, LynxNativeEventRegistration> {
	let events = state.nativeEvents.get(node);
	if (events === undefined) {
		events = new Map();
		state.nativeEvents.set(node, events);
	}
	return events;
}

function requireWorkletRegistry<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
): LynxMainThreadWorkletRegistry {
	if (state.worklets === undefined) {
		throw hostError('main-thread props require a main-thread worklet registry.');
	}
	return state.worklets;
}

function retiredRangeHit(ranges: readonly [number, number][], id: number): boolean {
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const [first, last] = ranges[middle]!;
		if (id < first) high = middle - 1;
		else if (id > last) low = middle + 1;
		else return true;
	}
	return false;
}

function removeNativeEvent<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	type: string,
	// `teardown` says this host is being destroyed by the same batch, so the
	// native unbind describes an element that is already detached and about to
	// be dropped. Dispatch cannot reach it either way: resolveLynxHostNativeEvent
	// refuses a token whose record was deleted, whose generation moved on, or
	// whose host is no longer root-connected, and destroy does all three. The
	// certified direct teardown plan has always skipped these unbinds; this
	// carries the same property to every other teardown route, which is what
	// keeps a 10k-row clear from spending 20,000 setEvent calls to describe
	// listeners on hosts that disappear in the same commit.
	teardown = false,
): void {
	const events = state.nativeEvents.get(node);
	const registration = events?.get(type);
	if (registration === undefined) return;
	if (registration.source === 'main-thread') {
		// Invalidate before native unbind so an engine-retained callback cannot
		// execute after its host lifetime ends. release() is idempotent for retry.
		// This half is never skipped: the engine holds the worklet, so only an
		// explicit release ends its lifetime, whatever happens to the element.
		requireWorkletRegistry(state).release(
			registration.listener.value as LynxActivatedMainThreadWorklet,
		);
	}
	if (teardown) {
		// Bookkeeping still has to go, or the node keeps a native-event entry
		// that outlives its record.
		events!.delete(type);
		if (events!.size === 0) state.nativeEvents.delete(node);
		return;
	}
	let replacement: LynxNativeEventRegistration | undefined;
	for (const [candidateType, candidate] of events!) {
		if (
			candidateType !== type &&
			candidate.binding.type === registration.binding.type &&
			candidate.binding.name === registration.binding.name
		) {
			replacement = candidate;
			break;
		}
	}
	// A single universal commit can transfer one PAPI tuple between the ordinary
	// background channel and a direct main-thread prop. Those semantic commands
	// are intentionally journaled separately, so removing the superseded entry
	// must preserve the already-installed replacement instead of unbinding it.
	state.papi.setEvent(
		node,
		registration.binding.type,
		registration.binding.name,
		replacement?.listener,
	);
	events!.delete(type);
	if (events!.size === 0) state.nativeEvents.delete(node);
}

function installNativeEvent<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	root: number,
	id: number,
	generation: number,
	type: string,
	listener: UniversalEventListenerDescriptor,
): void {
	const binding = parseLynxNativeEventProp(type);
	if (binding === null) throw hostError(`event ${JSON.stringify(type)} is not a Lynx event prop.`);
	const token = encodeCheckedLynxNativeEventToken(
		root,
		id,
		generation,
		listener.id,
		listener.priority,
	);
	const events = nativeEventMap(state, node);
	const current = events.get(type);
	if (current?.source === 'background' && current.listener === token) return;
	// Journal the intended token before entering PAPI. If native replacement
	// mutates and then throws, terminal cleanup still knows which tuple to clear.
	events.set(type, Object.freeze({ source: 'background', binding, listener: token }));
	state.papi.setEvent(node, binding.type, binding.name, token);
}

function installPreparedNativeEvent<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	root: number,
	id: number,
	firstListenerId: number,
	site: LynxPreparedTemplateProgramEvent,
): void {
	const token = encodePrevalidatedLynxNativeEventToken(
		root,
		id,
		1,
		firstListenerId + site.index,
		site.priority,
	);
	let events = state.nativeEvents.get(node);
	if (events === undefined) {
		events = new Map();
		state.nativeEvents.set(node, events);
	}
	// Fresh compact hosts have no earlier binding. Journal before entering PAPI
	// so a mutate-then-throw native failure remains completely disposable.
	events.set(
		site.type,
		Object.freeze({ source: 'background', binding: site.binding, listener: token }),
	);
	state.papi.setEvent(node, site.binding.type, site.binding.name, token);
}

function installMainThreadEvent<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	binding: LynxMainThreadEventBinding,
	worklet: LynxMainThreadWorkletDescriptor,
): void {
	let events = state.nativeEvents.get(node);
	const current = events?.get(binding.prop);
	if (current?.source === 'main-thread' && sameSnapshotValue(current.descriptor, worklet)) {
		return;
	}
	const registry = requireWorkletRegistry(state);
	const active = registry.activate(worklet);
	const listener = Object.freeze({ type: 'worklet' as const, value: active });
	// The direct callback has no background resolver to reject stale identities.
	// Unbind the accepted listener before publishing its replacement.
	if (current !== undefined) {
		try {
			removeNativeEvent(state, node, binding.prop);
		} catch (error) {
			registry.release(active);
			throw error;
		}
		events = nativeEventMap(state, node);
	} else if (events === undefined) {
		events = nativeEventMap(state, node);
	}
	events.set(
		binding.prop,
		Object.freeze({ source: 'main-thread', binding, listener, descriptor: worklet }),
	);
	state.papi.setEvent(node, binding.type, binding.name, listener);
}

function removeMainThreadEvents<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
): void {
	const events = state.nativeEvents.get(node);
	if (events === undefined) return;
	for (const [type, registration] of [...events]) {
		if (registration.source === 'main-thread') removeNativeEvent(state, node, type);
	}
}

function removeMainThreadRef<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
): void {
	const ref = state.mainThreadRefs.get(node);
	if (ref === undefined) return;
	const registry = requireWorkletRegistry(state);
	registry.updateRef(ref, null);
	registry.releaseRef(ref);
	state.mainThreadRefs.delete(node);
	if (state.mainThreadRefOwners.get(ref._wvid) === node) {
		state.mainThreadRefOwners.delete(ref._wvid);
	}
}

function invalidateMainThreadLifetimesAfterFault<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
): void {
	const registry = state.worklets;
	if (registry === undefined) return;
	// An accepted host fault is terminal. Background listener tokens are rejected
	// through state.faulted, but direct PAPI worklets bypass that resolver and must
	// be invalidated explicitly. Keep physical event journals so terminal disposal
	// can retry native unbinding; refs have no PAPI binding and can be released now.
	for (const events of state.nativeEvents.values()) {
		for (const registration of events.values()) {
			if (registration.source !== 'main-thread') continue;
			try {
				registry.release(registration.listener.value as LynxActivatedMainThreadWorklet);
			} catch {
				// Preserve the accepted application error. The retained journal retries
				// release during terminal disposal and reports any persistent failure.
			}
		}
	}
	for (const node of [...state.mainThreadRefs.keys()]) {
		try {
			removeMainThreadRef(state, node);
		} catch {
			// A partially failed registry update retains its journal for disposal.
		}
	}
}

function installMainThreadRef<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	ref: LynxMainThreadRefDescriptor,
): void {
	const current = state.mainThreadRefs.get(node);
	if (current !== undefined && sameSnapshotValue(current, ref)) return;
	const owner = state.mainThreadRefOwners.get(ref._wvid);
	if (owner !== undefined && owner !== node) {
		let ownerIsInteractive = false;
		for (const [id, record] of state.records) {
			if (record.node !== owner) continue;
			const authored = record.props['main-thread:ref'] as
				LynxMainThreadRefDescriptor | null | undefined;
			ownerIsInteractive =
				record.visible && authored?._wvid === ref._wvid && isAcceptedHostConnected(state, id);
			break;
		}
		if (ownerIsInteractive) {
			throw hostError(`main-thread ref ${JSON.stringify(ref._wvid)} is already mounted.`);
		}
		removeMainThreadRef(state, owner);
	}
	if (current !== undefined) removeMainThreadRef(state, node);
	const registry = requireWorkletRegistry(state);
	registry.retainRef(ref, null);
	// Journal first: a native update may mutate and then throw, in which case
	// terminal cleanup must still clear the ref identity.
	state.mainThreadRefs.set(node, ref);
	state.mainThreadRefOwners.set(ref._wvid, node);
	registry.updateRef(ref, node);
}

function installMainThreadProps<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	type: string,
	props: Readonly<Record<string, unknown>>,
): void {
	const patch = planLynxHostPropPatch(type, {}, props);
	for (const event of patch.mainThreadEvents) {
		if (event.value !== null) installMainThreadEvent(state, node, event.binding, event.value);
	}
	if (patch.mainThreadRef?.value !== null && patch.mainThreadRef?.value !== undefined) {
		installMainThreadRef(state, node, patch.mainThreadRef.value);
	}
}

function deactivateMainThreadSubtree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): void {
	const record = state.records.get(id);
	if (record === undefined) return;
	for (const child of record.children) deactivateMainThreadSubtree(state, child);
	if (record.node === null) return;
	removeMainThreadEvents(state, record.node);
	removeMainThreadRef(state, record.node);
}

function activateMainThreadSubtree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): void {
	const record = state.records.get(id);
	if (record === undefined || !record.visible || !isAcceptedHostConnected(state, id)) return;
	if (record.node !== null) installMainThreadProps(state, record.node, record.type, record.props);
	for (const child of record.children) activateMainThreadSubtree(state, child);
}

function removeAllNativeEvents<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	teardown = false,
): void {
	const events = state.nativeEvents.get(node);
	if (events === undefined) return;
	for (const type of [...events.keys()]) removeNativeEvent(state, node, type, teardown);
}

function installNativeEvents<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	node: Node,
	root: number,
	id: number,
	generation: number,
	events: ReadonlyMap<string, UniversalEventListenerDescriptor>,
): void {
	for (const [type, listener] of events) {
		installNativeEvent(state, node, root, id, generation, type, listener);
	}
}

function hasListUpdate(update: LynxListUpdateInfo): boolean {
	return (
		update.insertAction.length !== 0 ||
		update.removeAction.length !== 0 ||
		update.updateAction.length !== 0
	);
}

function sameListItems(
	first: readonly LynxListItemDescriptor[],
	second: readonly LynxListItemDescriptor[],
): boolean {
	if (first.length !== second.length) return false;
	for (let index = 0; index < first.length; index++) {
		const a = first[index]!;
		const b = second[index]!;
		if (
			a.id !== b.id ||
			a.itemKey !== b.itemKey ||
			a.reuseIdentifier !== b.reuseIdentifier ||
			a.recyclable !== b.recyclable ||
			a.defer !== b.defer
		) {
			return false;
		}
	}
	return true;
}

function directListItem<Node extends LynxElementRef>(
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	id: number,
): { readonly listId: number; readonly itemId: number } | null {
	let current = getRecord(id);
	const visited = new Set<number>();
	while (current !== undefined) {
		if (visited.has(current.handle.id)) throw hostError('list ancestry contains a cycle.');
		visited.add(current.handle.id);
		const parentId = parentHostId(current.parent);
		if (typeof parentId !== 'number') return null;
		const parent = getRecord(parentId);
		if (parent === undefined) return null;
		if (parent.type === 'list') {
			return current.type === 'list-item'
				? Object.freeze({ listId: parent.handle.id, itemId: current.handle.id })
				: null;
		}
		current = parent;
	}
	return null;
}

function cachedListDescendant<Node extends LynxElementRef>(
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	id: number,
	cache: Map<number, boolean>,
): boolean {
	const cached = cache.get(id);
	if (cached !== undefined) return cached;
	const path: number[] = [];
	let currentId: number | null | undefined = id;
	let result = false;
	while (typeof currentId === 'number') {
		const known = cache.get(currentId);
		if (known !== undefined) {
			result = known;
			break;
		}
		const current = getRecord(currentId);
		if (current === undefined) break;
		path.push(currentId);
		const parentId = parentHostId(current.parent);
		if (typeof parentId !== 'number') break;
		const parent = getRecord(parentId);
		if (parent === undefined) break;
		if (parent.type === 'list') {
			result = current.type === 'list-item';
			break;
		}
		currentId = parentId;
	}
	for (const pathId of path) cache.set(pathId, result);
	return result;
}

function listItems<Node extends LynxElementRef>(
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	listId: number,
): readonly LynxListItemDescriptor[] {
	const list = getRecord(listId);
	if (list === undefined || list.type !== 'list') return Object.freeze([]);
	const items = list.children.map((id) => {
		const record = getRecord(id);
		if (record === undefined) throw hostError(`<list> ${listId} references unknown child ${id}.`);
		return createLynxListItemDescriptor(id, record.type, record.props);
	});
	// The planner owns native item-key uniqueness validation.
	planLynxListUpdate([], items);
	return Object.freeze(items);
}

function emitAttachments<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	deltas: LynxHostAttachmentDelta[],
	version = state.acceptedVersion,
): void {
	if (deltas.length === 0 || state.disposed || state.disposing) return;
	// Keep one transition per logical host in this phase. Detach and attach
	// phases are emitted separately so NodesRef observes an attachment epoch.
	const seen = new Set<number>();
	const normalized: LynxHostAttachmentDelta[] = [];
	for (let index = deltas.length - 1; index >= 0; index--) {
		const delta = deltas[index]!;
		if (seen.has(delta.id)) continue;
		seen.add(delta.id);
		// A declared host was never built here, so the background derived no
		// handle for it and there is nothing on that side to attach. It cannot
		// carry a ref either — a template program refuses a `ref` on any node —
		// so the transition has no observer even in principle. Dropping it at the
		// source keeps a scroll from posting a message per materialized row that
		// the other side would only discard.
		if (declaringRun(state.deferredRuns, delta.id) !== undefined) continue;
		normalized.push(delta);
	}
	if (normalized.length === 0) return;
	normalized.reverse();
	state.onAttachments?.(version, Object.freeze(normalized));
}

function physicalChildren<Node extends LynxElementRef>(
	record: LynxHostRecord<Node>,
): readonly number[] {
	// Native lists own their direct cells through callbacks rather than ordinary
	// Element PAPI insertion. Descendants inside each cell remain ordinary hosts.
	return record.type === 'list' ? [] : record.children;
}

/**
 * A run whose hosts exist as a declaration rather than as records.
 *
 * A native `<list>` decides for itself which of its rows are on screen, and it
 * asks for one only when it is about to display it. Building every declared
 * instance at mount therefore buys nothing and costs one retained record per
 * host per row — the reason a 10k-row list retains ~70k records to show ~12.
 *
 * So a deferred run keeps the declaration and nothing else. The first read of a
 * host materializes it into `state.records`, after which it is an ordinary
 * record and this run no longer answers for it; reads that must not retain —
 * the per-commit walk that tells the list about every logical row — go through
 * `peekRecord` instead.
 */
interface LynxDeferredTemplateRun extends LynxTemplateRunDeclaration {
	/**
	 * Offsets whose host was destroyed after this run was accepted.
	 *
	 * A declaration outlives the hosts it declares, so without this a destroyed
	 * row would be re-derived by the next read that missed `records`.
	 */
	removed: Set<number> | null;
}

/** Whether any run in `runs` already declares a host in `[first, last]`. */
function runsOverlapRange(
	runs: readonly LynxDeferredTemplateRun[] | null,
	first: number,
	last: number,
): boolean {
	if (runs === null) return false;
	for (const run of runs) {
		if (first <= run.firstId + (templateRunHostCount(run) - 1) && last >= run.firstId) return true;
	}
	return false;
}

/**
 * The run in `runs` that declares `id`, or undefined once nothing declares it.
 *
 * A linear scan because a run is one command per native list: a tree carries as
 * many of these as it has lists, not as it has rows.
 */
function declaringRun(
	runs: readonly LynxDeferredTemplateRun[] | null,
	id: number,
): { readonly run: LynxDeferredTemplateRun; readonly offset: number } | undefined {
	if (runs === null) return undefined;
	for (const run of runs) {
		const offset = id - run.firstId;
		if (offset < 0 || offset >= templateRunHostCount(run)) continue;
		return run.removed?.has(offset) === true ? undefined : { run, offset };
	}
	return undefined;
}

/**
 * The record for `id`, deriving it from a deferred run without retaining it.
 *
 * For readers that only read. The returned record is a fresh object each call,
 * so a write to it is lost — which is the point: the walk that publishes a
 * list's logical rows reads every row of a deferred run on every commit, and
 * retaining what it touched would defeat the deferral.
 */
function peekRecord<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): LynxHostRecord<Node> | undefined {
	const record = state.records.get(id);
	if (record !== undefined) return record;
	const declared = declaringRun(state.deferredRuns, id);
	return declared === undefined
		? undefined
		: templateRunRecord<Node>(declared.run, declared.offset, state.generations.get(id) ?? 1);
}

/**
 * The record for `id`, materializing it from a deferred run if that is the only
 * place it exists.
 *
 * For readers that write — everything that binds a physical node into a host.
 * Materializing is what makes the write stick, and from here on the host is an
 * ordinary record that the run no longer answers for. Only apply may call this:
 * it writes `state.records`.
 */
function resolveRecord<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): LynxHostRecord<Node> | undefined {
	const record = state.records.get(id);
	if (record !== undefined) return record;
	const declared = declaringRun(state.deferredRuns, id);
	if (declared === undefined) return undefined;
	const materialized = templateRunRecord<Node>(
		declared.run,
		declared.offset,
		state.generations.get(id) ?? 1,
	);
	state.records.set(id, materialized);
	// A materialized host is an ordinary record from here on, and ordinary
	// records announce their generation: without this a later destroy-and-reuse
	// of the id would mint a second host with the same (root, id, generation).
	if (!state.generations.has(id)) state.generations.set(id, materialized.handle.generation);
	return materialized;
}

function createPhysicalTree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	id: number,
): LynxPhysicalTree<Node> {
	const record = resolveRecord(state, id);
	if (record === undefined) throw hostError(`native list requested missing host ${id}.`);
	const node =
		record.type === 'list'
			? createNativeListNode(state, container, record)
			: state.papi.createElement(
					record.type,
					container.pageComponentUniqueId,
					textValue(record.props),
				);
	state.ownedNodes.add(node);
	record.node = node;
	record.selectorInstalled = false;
	bindNodesRefSelector(state, record);
	applyProps(
		state,
		node,
		record.type,
		{},
		record.props,
		planLynxHostPropPatch(record.type, {}, record.props),
		true,
		record.visible,
		record.visible && isAcceptedHostConnected(state, id),
	);
	if (record.visible) {
		installNativeEvents(state, node, container.root, id, record.handle.generation, record.events);
	}
	const children: LynxPhysicalTree<Node>[] = [];
	for (const childId of physicalChildren(record)) {
		const child = createPhysicalTree(state, container, childId);
		state.papi.insertBefore(node, child.node, null);
		children.push(child);
	}
	return {
		node,
		type: record.type,
		props: record.props,
		visible: record.visible,
		logicalId: id,
		children,
	};
}

function disposeNativeListState<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	hostId: number,
): void {
	const list = state.lists.get(hostId);
	if (list === undefined || list.disposed) return;
	const listPAPI = state.papi.list;
	if (listPAPI !== undefined) {
		listPAPI.updateCallbacks(
			list.node,
			() => -1,
			() => {},
			() => {},
		);
	}
	list.disposed = true;
	state.lists.delete(hostId);
	for (const cell of list.cellsBySign.values()) disposePhysicalTree(state, cell.tree);
	list.cellsBySign.clear();
	list.attachedByItem.clear();
	list.retainedByItem.clear();
	list.recyclePools.clear();
}

function disposePhysicalTree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	tree: LynxPhysicalTree<Node>,
): void {
	for (const child of tree.children) disposePhysicalTree(state, child);
	if (tree.type === 'list') disposeNativeListState(state, tree.logicalId);
	removeAllNativeEvents(state, tree.node);
	removeMainThreadRef(state, tree.node);
	const record = state.records.get(tree.logicalId);
	if (record?.node === tree.node) record.node = null;
	state.ownedNodes.delete(tree.node);
}

function capturePhysicalTree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	id: number,
): LynxPhysicalTree<Node> {
	const record = state.records.get(id);
	if (record === undefined || record.node === null) {
		throw hostError(`attached native list cell lost logical host ${id}.`);
	}
	return {
		node: record.node,
		type: record.type,
		props: record.props,
		visible: record.visible,
		logicalId: id,
		children: physicalChildren(record).map((childId) => capturePhysicalTree(state, childId)),
	};
}

function clearPhysicalTreeAttachment<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	tree: LynxPhysicalTree<Node>,
	deltas: LynxHostAttachmentDelta[],
): void {
	const record = state.records.get(tree.logicalId);
	if (record !== undefined) {
		deltas.push(
			Object.freeze({
				id: tree.logicalId,
				generation: record.handle.generation,
				attached: false,
			}),
		);
	}
	removeAllNativeEvents(state, tree.node);
	removeMainThreadRef(state, tree.node);
	// A cell heading back to the pool must stop answering its old selector — but
	// only if it ever answered one. Clearing a node that was never selected is
	// the cost this path used to pay on every recycle for every element node.
	if (
		tree.type !== '#text' &&
		tree.type !== 'raw-text' &&
		(record === undefined || record.selectorInstalled)
	) {
		state.papi.setRefSelector(tree.node, '');
	}
	if (record?.node === tree.node) {
		record.node = null;
		record.selectorInstalled = false;
	}
	for (const child of tree.children) clearPhysicalTreeAttachment(state, child, deltas);
}

function collectPhysicalTreeAttachment<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	tree: LynxPhysicalTree<Node>,
	deltas: LynxHostAttachmentDelta[],
): void {
	for (const child of tree.children) collectPhysicalTreeAttachment(state, child, deltas);
	const record = state.records.get(tree.logicalId);
	if (record === undefined) return;
	deltas.push(
		Object.freeze({
			id: tree.logicalId,
			generation: record.handle.generation,
			attached: true,
		}),
	);
}

function collectPhysicalTreeIds<Node extends LynxElementRef>(
	tree: LynxPhysicalTree<Node>,
	output: Set<number>,
): void {
	output.add(tree.logicalId);
	for (const child of tree.children) collectPhysicalTreeIds(child, output);
}

function rebindPhysicalTree<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	tree: LynxPhysicalTree<Node>,
	desiredId: number,
): LynxPhysicalTree<Node> {
	const desired = resolveRecord(state, desiredId);
	if (desired === undefined) throw hostError(`native list requested missing host ${desiredId}.`);
	const patch = planLynxHostPropPatch(desired.type, tree.props, desired.props);
	if (
		tree.type !== desired.type ||
		patch.requiresRecreate ||
		(tree.type === 'list' && tree.logicalId !== desiredId)
	) {
		const replacement = createPhysicalTree(state, container, desiredId);
		state.papi.replace(replacement.node, tree.node);
		disposePhysicalTree(state, tree);
		return replacement;
	}

	const previousRecord = state.records.get(tree.logicalId);
	if (previousRecord?.node === tree.node && tree.logicalId !== desiredId)
		previousRecord.node = null;
	removeAllNativeEvents(state, tree.node);
	removeMainThreadRef(state, tree.node);
	desired.node = tree.node;
	desired.selectorInstalled = false;
	bindNodesRefSelector(state, desired);
	applyProps(
		state,
		tree.node,
		desired.type,
		tree.props,
		desired.props,
		patch,
		false,
		desired.visible,
		desired.visible && isAcceptedHostConnected(state, desiredId),
	);
	if (!desired.visible) state.papi.setAttribute(tree.node, 'hidden', true);
	else {
		const interactive = isAcceptedHostConnected(state, desiredId);
		if (interactive) installMainThreadProps(state, tree.node, desired.type, desired.props);
		installNativeEvents(
			state,
			tree.node,
			container.root,
			desiredId,
			desired.handle.generation,
			desired.events,
		);
	}

	const desiredChildren = physicalChildren(desired);
	const common = Math.min(tree.children.length, desiredChildren.length);
	for (let index = 0; index < common; index++) {
		tree.children[index] = rebindPhysicalTree(
			state,
			container,
			tree.children[index]!,
			desiredChildren[index]!,
		);
	}
	while (tree.children.length > desiredChildren.length) {
		const child = tree.children.pop()!;
		state.papi.remove(tree.node, child.node);
		disposePhysicalTree(state, child);
	}
	for (let index = common; index < desiredChildren.length; index++) {
		const child = createPhysicalTree(state, container, desiredChildren[index]!);
		state.papi.insertBefore(tree.node, child.node, null);
		tree.children.push(child);
	}
	tree.type = desired.type;
	tree.props = desired.props;
	tree.visible = desired.visible;
	tree.logicalId = desiredId;
	return tree;
}

function poolListCell<Node extends LynxElementRef>(
	list: LynxNativeListState<Node>,
	cell: LynxPhysicalListCell<Node>,
): void {
	cell.awaitingEnqueue = false;
	const key = lynxListReuseKey(cell.item);
	let pool = list.recyclePools.get(key);
	if (pool === undefined) list.recyclePools.set(key, (pool = []));
	pool.push(cell);
}

function destroyListCell<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	list: LynxNativeListState<Node>,
	cell: LynxPhysicalListCell<Node>,
): void {
	if (state.papi.isChild(list.node, cell.tree.node)) {
		state.papi.remove(list.node, cell.tree.node);
	}
	list.cellsBySign.delete(cell.sign);
	cell.awaitingEnqueue = false;
	disposePhysicalTree(state, cell.tree);
}

function detachListCell<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	list: LynxNativeListState<Node>,
	cell: LynxPhysicalListCell<Node>,
	mode: 'await-enqueue' | 'destroy' | 'retain' | 'reuse',
	version?: number,
	attachmentDeltas?: LynxHostAttachmentDelta[],
): void {
	const itemId = cell.logicalItemId;
	if (itemId === null) return;
	list.leaveCount += 1;
	cell.tree = capturePhysicalTree(state, itemId);
	const deltas = attachmentDeltas ?? [];
	clearPhysicalTreeAttachment(state, cell.tree, deltas);
	if (list.attachedByItem.get(itemId) === cell) list.attachedByItem.delete(itemId);
	cell.logicalItemId = null;
	if (mode === 'await-enqueue') cell.awaitingEnqueue = true;
	else if (mode === 'retain') {
		cell.awaitingEnqueue = false;
		list.retainedByItem.set(itemId, cell);
	} else if (mode === 'reuse') poolListCell(list, cell);
	else destroyListCell(state, list, cell);
	if (attachmentDeltas === undefined) emitAttachments(state, deltas, version);
}

function materializeListItem<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	list: LynxNativeListState<Node>,
	index: number,
): LynxListMaterialization<Node> {
	const item = list.items[index];
	if (item === undefined) throw hostError(`native list requested out-of-range item ${index}.`);
	const detachments: LynxHostAttachmentDelta[] = [];
	const attachments: LynxHostAttachmentDelta[] = [];
	const attached = list.attachedByItem.get(item.id);
	if (attached !== undefined) {
		// Lynx may ask for the moved logical item before enqueueing its old
		// physical sign. Keep that old tree alive until enqueue, but move logical
		// ownership to a different physical cell immediately.
		detachListCell(state, list, attached, 'await-enqueue', undefined, detachments);
	}
	list.enterCount += 1;

	let cell = list.retainedByItem.get(item.id);
	let reuseNotification = false;
	if (cell !== undefined) list.retainedByItem.delete(item.id);
	if (cell === undefined && item.recyclable) {
		const reuseKey = lynxListReuseKey(item);
		const pool = list.recyclePools.get(reuseKey);
		cell = pool?.pop();
		if (pool?.length === 0) list.recyclePools.delete(reuseKey);
		reuseNotification = cell !== undefined && cell.item.id !== item.id;
	}
	if (cell === undefined) {
		const tree = createPhysicalTree(state, container, item.id);
		state.papi.insertBefore(list.node, tree.node, null);
		const sign = state.papi.getUniqueId(tree.node);
		if (!Number.isSafeInteger(sign) || sign <= 0 || list.cellsBySign.has(sign)) {
			throw hostError('Element PAPI returned an invalid or duplicate native list cell sign.');
		}
		cell = { sign, tree, item, logicalItemId: item.id, awaitingEnqueue: false };
		list.cellsBySign.set(sign, cell);
		list.createdCells += 1;
	} else {
		const previousSign = cell.sign;
		cell.tree = rebindPhysicalTree(state, container, cell.tree, item.id);
		const nextSign = state.papi.getUniqueId(cell.tree.node);
		if (!Number.isSafeInteger(nextSign) || nextSign <= 0) {
			throw hostError('Element PAPI returned an invalid native list cell sign after reuse.');
		}
		if (nextSign !== previousSign) {
			if (list.cellsBySign.has(nextSign)) {
				throw hostError('Element PAPI returned a duplicate native list cell sign after reuse.');
			}
			list.cellsBySign.delete(previousSign);
			list.cellsBySign.set(nextSign, cell);
			cell.sign = nextSign;
		}
		cell.item = item;
		cell.logicalItemId = item.id;
		cell.awaitingEnqueue = false;
		list.reusedCells += 1;
	}
	list.attachedByItem.set(item.id, cell);
	collectPhysicalTreeAttachment(state, cell.tree, attachments);
	return {
		sign: cell.sign,
		tree: cell.tree,
		item,
		reuseNotification,
		detachments,
		attachments,
	};
}

function invokeNativeListCallback<Node extends LynxElementRef, Result>(
	state: LynxHostState<Node>,
	fallback: Result,
	callback: () => Result,
): Result {
	if (state.disposed || state.disposing || state.faulted) return fallback;
	try {
		const result = callback();
		return state.disposed || state.disposing || state.faulted ? fallback : result;
	} catch (error) {
		// Reentrant native callbacks during apply belong to the accepted commit
		// boundary, whose caller publishes the ordinary ACK + fault sequence.
		if (state.applying) throw error;
		if (!state.disposed && !state.disposing && !state.faulted) {
			state.faulted = true;
			invalidateMainThreadLifetimesAfterFault(state);
			state.cleanupNeedsFlush = true;
			try {
				state.onCallbackFault?.(state.acceptedVersion, error);
			} catch {
				// The owner is responsible for diagnosing delivery failures. The host
				// must remain fail-stop even if that diagnostic path itself fails.
			}
		}
		return fallback;
	}
}

/**
 * The three recycling callbacks Lynx invokes against a live `<list>`, bound to
 * one host state and container.
 *
 * The list state arrives through `resolve` rather than as a value because
 * creation is circular: `__CreateList` needs the callbacks, and the state needs
 * the node that call returns. Adoption has no such problem — it holds a state
 * that already exists — but both callers go through the same indirection so
 * that what a live list does is defined once instead of twice.
 */
function bindNativeListCallbacks<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	resolve: () => LynxNativeListState<Node> | undefined,
): Pick<LynxNativeListState<Node>, 'componentAtIndex' | 'enqueueComponent' | 'componentAtIndexes'> {
	const componentAtIndex: LynxListComponentAtIndex<Node> = (
		_list,
		_listId,
		index,
		operationId,
		enableReuseNotification,
	) =>
		invokeNativeListCallback(state, -1, () => {
			const listState = resolve();
			if (listState === undefined || listState.disposed) return -1;
			const result = materializeListItem(state, container, listState, index);
			state.papi.flush(result.tree.node, {
				triggerLayout: true,
				...(operationId === undefined ? null : { operationID: operationId }),
				elementID: result.sign,
				listID: state.papi.getUniqueId(listState.node),
				...(result.reuseNotification && enableReuseNotification
					? {
							listReuseNotification: {
								listElement: listState.node,
								itemKey: result.item.itemKey,
							},
						}
					: null),
			});
			emitAttachments(state, result.detachments);
			emitAttachments(state, result.attachments);
			return result.sign;
		});
	const enqueueComponent: LynxListEnqueueComponent<Node> = (_list, _listId, sign) => {
		invokeNativeListCallback(state, undefined, () => {
			const listState = resolve();
			if (listState === undefined || listState.disposed) return;
			const cell = listState.cellsBySign.get(sign);
			if (cell === undefined) return;
			if (cell.awaitingEnqueue) {
				if (cell.item.recyclable) poolListCell(listState, cell);
				else destroyListCell(state, listState, cell);
				return;
			}
			if (cell.logicalItemId === null) return;
			detachListCell(state, listState, cell, cell.item.recyclable ? 'reuse' : 'retain');
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
		invokeNativeListCallback(state, undefined, () => {
			const listState = resolve();
			if (listState === undefined || listState.disposed) return;
			const results = indexes.map((index) =>
				materializeListItem(state, container, listState, index),
			);
			if (asyncFlush) {
				for (const result of results) {
					state.papi.flush(result.tree.node, {
						asyncFlush: true,
						...(result.reuseNotification && enableReuseNotification
							? {
									listReuseNotification: {
										listElement: listState.node,
										itemKey: result.item.itemKey,
									},
								}
							: null),
					});
				}
			}
			state.papi.flush(listState.node, {
				triggerLayout: true,
				operationIDs: operationIds,
				elementIDs: results.map((result) => result.sign),
				listID: state.papi.getUniqueId(listState.node),
			});
			const detachments: LynxHostAttachmentDelta[] = [];
			const attachments: LynxHostAttachmentDelta[] = [];
			for (const result of results) {
				detachments.push(...result.detachments);
				attachments.push(...result.attachments);
			}
			emitAttachments(state, detachments);
			emitAttachments(state, attachments);
		});
	};
	return { componentAtIndex, enqueueComponent, componentAtIndexes };
}

/**
 * Create the native list and register its main-local state, without publishing
 * any rows.
 *
 * Split from the item publication below because the direct first-screen applier
 * has to do these two things at different points in one walk: the element is
 * created on the way down, so its unique ID is assigned in the same order the
 * staged path assigns it, but the rows it publishes are records that only exist
 * once the subtree has been walked.
 */
function beginNativeListNode<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	record: LynxHostRecord<Node>,
): Node {
	const listPAPI = state.papi.list;
	if (listPAPI === undefined) {
		throw hostError('<list> requires __CreateList and __UpdateListCallbacks.');
	}
	let listState: LynxNativeListState<Node> | undefined;
	const { componentAtIndex, enqueueComponent, componentAtIndexes } = bindNativeListCallbacks(
		state,
		container,
		() => listState,
	);
	const node = listPAPI.create(
		container.pageComponentUniqueId,
		componentAtIndex,
		enqueueComponent,
		componentAtIndexes,
	);
	listState = {
		hostId: record.handle.id,
		node,
		componentAtIndex,
		componentAtIndexes,
		enqueueComponent,
		items: Object.freeze([]),
		cellsBySign: new Map(),
		attachedByItem: new Map(),
		retainedByItem: new Map(),
		recyclePools: new Map(),
		createdCells: 0,
		reusedCells: 0,
		enterCount: 0,
		leaveCount: 0,
		disposed: false,
	};
	state.lists.set(record.handle.id, listState);
	return node;
}

/**
 * Publish a freshly created list's rows as `update-list-info`. Reads the rows
 * off the records, so every child of the list must already be recorded.
 */
function publishNativeListItems<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	record: LynxHostRecord<Node>,
): void {
	const listState = state.lists.get(record.handle.id);
	if (listState === undefined) {
		throw hostError(`<list> ${record.handle.id} has no native list state.`);
	}
	const initialItems = listItems((id) => peekRecord(state, id), record.handle.id);
	listState.items = initialItems;
	const initialUpdate = planLynxListUpdate([], initialItems);
	if (hasListUpdate(initialUpdate)) {
		state.papi.setAttribute(listState.node, 'update-list-info', initialUpdate);
	}
}

function createNativeListNode<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	container: LynxHostContainer<Node>,
	record: LynxHostRecord<Node>,
): Node {
	const node = beginNativeListNode(state, container, record);
	publishNativeListItems(state, record);
	return node;
}

function applyListUpdate<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	update: LynxPreparedListUpdate,
): void {
	const list = state.lists.get(update.hostId);
	if (list === undefined) {
		if (!state.records.has(update.hostId) || state.records.get(update.hostId)?.node === null)
			return;
		throw hostError(`<list> ${update.hostId} has no native list state.`);
	}
	if (sameListItems(list.items, update.next)) return;
	list.items = update.next;
	const nextById = new Map<number, LynxListItemDescriptor>();
	for (const item of update.next) nextById.set(item.id, item);
	for (const cell of list.attachedByItem.values()) {
		const item = cell.logicalItemId === null ? undefined : nextById.get(cell.logicalItemId);
		if (item !== undefined) cell.item = item;
	}
	for (const [itemId, cell] of list.retainedByItem) {
		const item = nextById.get(itemId);
		if (item !== undefined) cell.item = item;
	}
	for (const cell of list.cellsBySign.values()) {
		if (!cell.awaitingEnqueue) continue;
		const item = nextById.get(cell.tree.logicalId);
		if (item !== undefined) cell.item = item;
		else destroyListCell(state, list, cell);
	}
	// Pooled cells retain the metadata that selected their partition. Rekey
	// cells whose logical item is still live, and destroy cells whose item was
	// removed or became explicitly non-recyclable.
	const pooledCells: LynxPhysicalListCell<Node>[] = [];
	for (const pool of list.recyclePools.values()) pooledCells.push(...pool);
	list.recyclePools.clear();
	for (const cell of pooledCells) {
		const item = nextById.get(cell.tree.logicalId);
		if (item === undefined) {
			destroyListCell(state, list, cell);
			continue;
		}
		cell.item = item;
		if (cell.item.recyclable) poolListCell(list, cell);
		else destroyListCell(state, list, cell);
	}
	const listPAPI = state.papi.list!;
	listPAPI.updateCallbacks(
		list.node,
		list.componentAtIndex,
		list.enqueueComponent,
		list.componentAtIndexes,
	);
	if (hasListUpdate(update.update)) {
		state.papi.setAttribute(list.node, 'update-list-info', update.update);
	}
}

export function createLynxHostContainer<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	options: CreateLynxHostContainerOptions<Node>,
): LynxHostContainer<Node> {
	assertSafeId(options.root, 'root');
	const componentId = options.componentId ?? String(options.root);
	if (componentId.length === 0) throw hostError('componentId must be a non-empty string.');
	const cssId = options.cssId ?? 0;
	if (!Number.isSafeInteger(cssId)) throw hostError('cssId must be a safe integer.');
	const page = options.page ?? papi.createPage(componentId, cssId);
	const pageComponentUniqueId = papi.getUniqueId(page);
	if (!Number.isSafeInteger(pageComponentUniqueId)) {
		throw hostError('Element PAPI returned an invalid page component unique ID.');
	}
	const state: LynxHostState<Node> = {
		papi,
		worklets: options.worklets,
		records: new Map(),
		rootChildren: [],
		generations: new Map(),
		implicitInitialGenerations: false,
		maxExplicitId: 0,
		retiredRanges: [],
		teardownRecords: null,
		deferredRuns: null,
		portalRoot: null,
		portalChildren: new Map(),
		ownedNodes: new Set(),
		ownedPageRoots: new Set(),
		nativeEvents: new Map(),
		mainThreadRefs: new Map(),
		mainThreadRefOwners: new Map(),
		lists: new Map(),
		announcesPublicInstances: options.announcesPublicInstances === true,
		onAttachments: options.onAttachments,
		onCallbackFault: options.onCallbackFault,
		hasMainThreadProps: false,
		hasNativeListTopology: false,
		programRuns: [],
		programEventsMaterialized: false,
		programRunsDisjoint: true,
		acceptedVersion: 0,
		disposed: false,
		disposing: false,
		faulted: false,
		applying: false,
		cleanupNeedsFlush: false,
		firstTree: null,
	};
	return Object.freeze({
		renderer: LYNX_RENDERER_ID,
		root: options.root,
		page,
		pageComponentUniqueId,
		get acceptedVersion() {
			return state.acceptedVersion;
		},
		/**
		 * Hosts this driver holds a record for.
		 *
		 * A deferred run declares hosts without building them, so its instances
		 * count from the moment the list asks for one rather than from the commit
		 * that declared them.
		 */
		get instanceCount() {
			return state.records.size;
		},
		get disposed() {
			return state.disposed;
		},
		[LYNX_HOST_STATE]: state,
	});
}

interface SnapshotValuePairs {
	readonly firstToSecond: WeakMap<object, object>;
	readonly secondToFirst: WeakMap<object, object>;
}

function sameSnapshotValueWithPairs(
	first: unknown,
	second: unknown,
	pairs: SnapshotValuePairs,
): boolean {
	if (Object.is(first, second)) return true;
	if (Array.isArray(first)) {
		if (!Array.isArray(second) || first.length !== second.length) return false;
		const pairedSecond = pairs.firstToSecond.get(first);
		if (pairedSecond !== undefined) return pairedSecond === second;
		const pairedFirst = pairs.secondToFirst.get(second);
		if (pairedFirst !== undefined) return pairedFirst === first;
		pairs.firstToSecond.set(first, second);
		pairs.secondToFirst.set(second, first);
		for (let index = 0; index < first.length; index++) {
			if (!sameSnapshotValueWithPairs(first[index], second[index], pairs)) return false;
		}
		return true;
	}
	if (
		first === null ||
		second === null ||
		typeof first !== 'object' ||
		typeof second !== 'object' ||
		Array.isArray(second)
	) {
		return false;
	}
	const pairedSecond = pairs.firstToSecond.get(first);
	if (pairedSecond !== undefined) return pairedSecond === second;
	const pairedFirst = pairs.secondToFirst.get(second);
	if (pairedFirst !== undefined) return pairedFirst === first;
	pairs.firstToSecond.set(first, second);
	pairs.secondToFirst.set(second, first);
	const firstKeys = Object.keys(first).sort();
	const secondKeys = Object.keys(second).sort();
	if (firstKeys.length !== secondKeys.length) return false;
	for (let index = 0; index < firstKeys.length; index++) {
		const key = firstKeys[index]!;
		if (
			key !== secondKeys[index] ||
			!sameSnapshotValueWithPairs(
				(first as Record<string, unknown>)[key],
				(second as Record<string, unknown>)[key],
				pairs,
			)
		) {
			return false;
		}
	}
	return true;
}

function sameSnapshotValue(first: unknown, second: unknown): boolean {
	if (Object.is(first, second)) return true;
	return sameSnapshotValueWithPairs(first, second, {
		firstToSecond: new WeakMap(),
		secondToFirst: new WeakMap(),
	});
}

/** First-screen and background graphs assign different local execution tokens. */
function sameAdoptableSnapshotValueWithPairs(
	first: unknown,
	second: unknown,
	pairs: SnapshotValuePairs,
): boolean {
	if (Object.is(first, second)) return true;
	if (
		first === null ||
		second === null ||
		typeof first !== 'object' ||
		typeof second !== 'object'
	) {
		return false;
	}
	const pairedSecond = pairs.firstToSecond.get(first);
	if (pairedSecond !== undefined) return pairedSecond === second;
	const pairedFirst = pairs.secondToFirst.get(second);
	if (pairedFirst !== undefined) return pairedFirst === first;
	pairs.firstToSecond.set(first, second);
	pairs.secondToFirst.set(second, first);
	if (Array.isArray(first) || Array.isArray(second)) {
		if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length)
			return false;
		for (let index = 0; index < first.length; index++) {
			if (!sameAdoptableSnapshotValueWithPairs(first[index], second[index], pairs)) return false;
		}
		return true;
	}
	const firstRecord = first as Record<string, unknown>;
	const secondRecord = second as Record<string, unknown>;
	const backgroundHandle =
		typeof firstRecord._jsFnId === 'string' && typeof secondRecord._jsFnId === 'string';
	const firstNames = Object.keys(firstRecord)
		.filter((name) => !backgroundHandle || name !== '_execId')
		.sort();
	const secondNames = Object.keys(secondRecord)
		.filter((name) => !backgroundHandle || name !== '_execId')
		.sort();
	if (firstNames.length !== secondNames.length) return false;
	for (let index = 0; index < firstNames.length; index++) {
		const name = firstNames[index]!;
		if (
			name !== secondNames[index] ||
			!sameAdoptableSnapshotValueWithPairs(firstRecord[name], secondRecord[name], pairs)
		) {
			return false;
		}
	}
	return true;
}

function sameAdoptableSnapshotValue(first: unknown, second: unknown): boolean {
	if (Object.is(first, second)) return true;
	return sameAdoptableSnapshotValueWithPairs(first, second, {
		firstToSecond: new WeakMap(),
		secondToFirst: new WeakMap(),
	});
}

function sameIds(first: readonly number[], second: readonly number[]): boolean {
	if (first.length !== second.length) return false;
	for (let index = 0; index < first.length; index++) {
		if (first[index] !== second[index]) return false;
	}
	return true;
}

interface FirstTreeSnapshotCloneState {
	readonly active: Set<object>;
	readonly clones: Map<object, UniversalSerializableValue>;
}

function snapshotFirstTreeValue(
	value: UniversalSerializableValue,
	state: FirstTreeSnapshotCloneState,
): UniversalSerializableValue {
	if (value === null || typeof value !== 'object') return value;
	if (state.active.has(value)) throw hostError('first-tree props cannot contain cycles.');
	const existing = state.clones.get(value);
	if (existing !== undefined) return existing;
	state.active.add(value);
	try {
		if (Array.isArray(value)) {
			const output: UniversalSerializableValue[] = [];
			state.clones.set(value, output);
			for (const entry of value) output.push(snapshotFirstTreeValue(entry, state));
			return Object.freeze(output);
		}
		const output: Record<string, UniversalSerializableValue> = {};
		state.clones.set(value, output);
		for (const key of Object.keys(value)) {
			const entry = snapshotFirstTreeValue(
				(value as Readonly<Record<string, UniversalSerializableValue>>)[key]!,
				state,
			);
			if (key === '__proto__') {
				Object.defineProperty(output, key, {
					configurable: false,
					enumerable: true,
					value: entry,
					writable: false,
				});
			} else {
				output[key] = entry;
			}
		}
		return Object.freeze(output);
	} finally {
		state.active.delete(value);
	}
}

/** Freeze one record's child order, sharing the frozen empty for the leaves. */
function snapshotFirstTreeChildren(children: readonly number[]): readonly number[] {
	return children.length === 0 ? EMPTY_FIRST_TREE_CHILDREN : Object.freeze([...children]);
}

/**
 * Snapshot one record's props. The caller owns the scratch pair and this clears
 * it, so every record still clones against a memo scoped to its own props —
 * exactly what a freshly allocated pair gave it — without allocating a `Set`
 * and a `Map` per record on a page with tens of thousands of them.
 */
function snapshotFirstTreeProps(
	props: Readonly<Record<string, unknown>>,
	state: FirstTreeSnapshotCloneState,
): Readonly<Record<string, UniversalSerializableValue>> {
	state.active.clear();
	state.clones.clear();
	return snapshotFirstTreeValue(
		props as Readonly<Record<string, UniversalSerializableValue>>,
		state,
	) as Readonly<Record<string, UniversalSerializableValue>>;
}

function mismatch(
	firstTree: LynxFirstTree,
	path: string,
	message: string,
): LynxFirstTreeMismatchError {
	return new LynxFirstTreeMismatchError(path, message, firstTree.snapshot.plan);
}

function firstTreeOwner<Node extends LynxElementRef>(
	firstTree: LynxFirstTree<Node>,
): LynxHostContainer<Node> {
	if (firstTree === null || typeof firstTree !== 'object') {
		throw hostError('firstTree must be a captured Lynx first tree.');
	}
	const journal = firstTree[LYNX_FIRST_TREE_STATE];
	if (journal === undefined || journal.status !== 'available') {
		throw hostError('firstTree is no longer available for adoption.');
	}
	const owner = journal.owner;
	if (
		owner === null ||
		typeof owner !== 'object' ||
		!(LYNX_HOST_STATE in owner) ||
		(owner as LynxHostContainer<Node>).renderer !== LYNX_RENDERER_ID
	) {
		throw hostError('firstTree has no valid Lynx host owner.');
	}
	const source = owner as LynxHostContainer<Node>;
	if (source[LYNX_HOST_STATE].firstTree !== firstTree) {
		throw hostError('firstTree is not the current journal for its Lynx host owner.');
	}
	return source;
}

/**
 * Freeze the accepted main-runtime tree into a clone-safe description while
 * retaining PAPI references in a single-consumer, main-local journal.
 *
 * Returns `null` when the tree is well-formed but holds a composition the
 * background cannot adopt, which is a property of the rendered page rather than
 * a defect in the host. Every genuine capture fault still throws, so a caller
 * can retire an unadoptable first screen quietly and still surface a broken
 * host. A native `<list>` is the one such composition today: the platform
 * materializes its rows through the `componentAtIndex`/`enqueueComponent`
 * callbacks created for `listPAPI.create`, and it owns the resulting cell state.
 * Those callbacks are per-instance closures with no cross-thread handle space, so
 * a described tree has nothing to hand over. That is a limit of this design, not
 * an inherent one — a list can cross such a boundary when the callbacks stay
 * host-local and only a descriptor keyed by a stable id travels.
 *
 * The portal guards below keep throwing rather than joining this channel because
 * they are unreachable from the first-screen path: the main renderer rejects a
 * portal while rendering, long before a host container exists. They defend only
 * a direct call to this function, where a fault is the right report.
 */

/**
 * Structural view of the first-screen renderer's node records. Hosts carry
 * type/props/visibility; ranges only pass their children through to the
 * nearest host ancestor. Ids are the pre-order ids the background renderer
 * will independently assign, so adoption identity is positional, not minted.
 */
export interface LynxFirstScreenDirectNode {
	readonly kind: 'host' | 'range' | 'program';
	readonly id: number;
	readonly type?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly visibility?: 'visible' | 'hidden';
	readonly children: readonly LynxFirstScreenDirectNode[];
	/**
	 * The compiled program a `program` node paints itself with (issue #163), the
	 * component value array its positional arguments are drawn from, and the ids
	 * its hosts took, in program order.
	 *
	 * Three members rather than one nested object because they are three separate
	 * things the renderer already holds: the plan is per component and shared by
	 * every instance, the values are the instance's own, and the ids belong to
	 * this pass. Wrapping them would allocate one object per program on the paint
	 * path to describe a grouping neither side needs.
	 */
	readonly plan?: UniversalProgramPlan;
	readonly values?: readonly unknown[];
	readonly ids?: readonly number[];
	/**
	 * How many of `children` belong to each declared keyed range, in order.
	 *
	 * A hole is not a node on either encoding — the interpreted arm splices a
	 * hole's members straight into their parent — so the members are one flat
	 * list and this says where each range's share of it begins and ends.
	 */
	readonly spans?: readonly number[];
	/**
	 * The string handed to each declared range for the program to paint, or
	 * `undefined` for a hole this renderer filled itself — one per range, in
	 * `plan.ranges` order.
	 *
	 * The applier passes these straight through as the create function's range
	 * arguments and compares what comes back against them, which is what keeps
	 * the two answers about one hole from drifting apart.
	 */
	readonly texts?: readonly (string | undefined)[];
	/**
	 * The ID each range the program paints took, and nothing at a hole this
	 * renderer filled — one per range, in `plan.ranges` order.
	 *
	 * A painted hole has no node on this side to carry its ID, and the ID is
	 * still minted where the interpreted arm puts that node, so it travels
	 * beside the hole instead.
	 */
	readonly rangeIds?: readonly (number | undefined)[];
	/**
	 * Where this program's own announcements begin in the envelope's event list,
	 * and how many of them there are — the run the renderer recorded while it
	 * announced them (issue #163 C18).
	 *
	 * A program's sites are announced in one contiguous pass in site order, so a
	 * site's listener sits at a position in that run and this mount reads it
	 * there. A tree built without one gets the search instead: the whole
	 * announcement by host, then that host's list by type, per site per row.
	 *
	 * Both or neither. The count is not derivable from the start, because a
	 * handler prop that came through undefined announces nothing and leaves the
	 * run shorter than the site list.
	 */
	readonly eventsAt?: number;
	readonly eventsCount?: number;
}

/** One background listener the first-screen renderer assigned, by host id. */
export interface LynxFirstScreenDirectEvent {
	readonly id: number;
	readonly type: string;
	readonly listener: UniversalEventListenerDescriptor;
}

/**
 * Everything the direct applier reads that is not the tree itself: the envelope
 * fields it validates, and the background listeners the renderer assigned.
 *
 * This is deliberately not the command batch. The applier only ever consulted
 * the batch's `event` commands, so taking the batch obliged the renderer to
 * build one — at 10k fixture rows, six figures of frozen command objects that
 * this function then walked past. `LynxFirstScreenRenderResult.envelope` is the
 * renderer's matching shape; hand-built trees supply their own.
 */
export interface LynxFirstScreenDirectEnvelope {
	readonly renderer: string;
	readonly version: number;
	readonly events: readonly LynxFirstScreenDirectEvent[];
}

/**
 * Direct host children of one node, with ranges transparent, as records see
 * them. Iterative for the same reason its caller is: a chain of ranges is a
 * chain of nested directives, and nothing here may cap a depth the renderer
 * that produced the tree accepted. Children are pushed in reverse so hosts come
 * back in document order, which is the order the list plan indexes them by.
 */
function firstScreenHostChildren(
	nodes: readonly LynxFirstScreenDirectNode[],
): LynxFirstScreenDirectNode[] {
	const output: LynxFirstScreenDirectNode[] = [];
	const stack: LynxFirstScreenDirectNode[] = [];
	for (let index = nodes.length - 1; index >= 0; index--) stack.push(nodes[index]!);
	while (stack.length !== 0) {
		const node = stack.pop()!;
		if (node.kind === 'host') {
			output.push(node);
			continue;
		}
		for (let index = node.children.length - 1; index >= 0; index--) {
			stack.push(node.children[index]!);
		}
	}
	return output;
}

/**
 * Can the direct applier finish every native `<list>` in this tree?
 *
 * It emits straight to the Element PAPI, so it cannot discover a malformed list
 * halfway through and stop: that leaves a half-painted page, which is the one
 * state the staged path never produces. So it asks before mutating anything,
 * and hands a tree it cannot vouch for back to the staged path, which raises
 * every list diagnostic from where it raises it today.
 *
 * Rather than restating those rules this runs the real validators over the same
 * nodes — the two `list.js` entry points, plus the two placement rules the
 * prepare walk owns and this walk tracks alongside. A tree with no `<list>` in
 * it is trivially buildable and pays one pass.
 *
 * Ranges are transparent, which is what makes this read real code rather than
 * only hand-built trees. `@for` and friends produce no record, so a `<list>`
 * taking its rows from a keyed loop — every authored list — does not own those
 * rows as children. A reader stopping at the immediate children would validate
 * an *empty* list and wave it through, and the applier would then fault on the
 * first row. The staged checks read a record's *host* parent for the same
 * reason, so a `<list-item>` under a range under a `<list>` is placed correctly
 * on both paths.
 */
function firstScreenListsAreDirectBuildable(nodes: readonly LynxFirstScreenDirectNode[]): boolean {
	// Iterative for the same reason its neighbours are: nothing in the
	// first-screen pipeline may impose a tree-depth ceiling the renderer that
	// produced the tree does not have. Each frame carries the nearest enclosing
	// host type, which ranges pass through unchanged, and whether any ancestor
	// was a list.
	const stack: {
		nodes: readonly LynxFirstScreenDirectNode[];
		hostParent: string | undefined;
		insideList: boolean;
	}[] = [{ nodes, hostParent: undefined, insideList: false }];
	while (stack.length !== 0) {
		const frame = stack.pop()!;
		for (const node of frame.nodes) {
			let hostParent = frame.hostParent;
			let insideList = frame.insideList;
			if (node.kind === 'host') {
				if (node.type === 'list') {
					// `nested <list> hosts are not supported by the initial recycling
					// contract.`, raised by the prepare walk.
					if (frame.insideList) return false;
					try {
						// Everything `listItems` validates when the native list state is
						// built: child type, item-key presence and shape, the optional
						// metadata types, and key uniqueness across one list.
						const items = firstScreenHostChildren(node.children).map((child) =>
							createLynxListItemDescriptor(child.id, child.type ?? '', child.props ?? {}),
						);
						planLynxListUpdate([], items);
					} catch {
						return false;
					}
					insideList = true;
				} else if (node.type === 'list-item' && frame.hostParent !== 'list') {
					// `<list-item> N must be placed directly under a <list>.`
					return false;
				}
				hostParent = node.type;
			}
			if (node.children.length !== 0) stack.push({ nodes: node.children, hostParent, insideList });
		}
	}
	return true;
}

function firstScreenTreeHasList(nodes: readonly LynxFirstScreenDirectNode[]): boolean {
	// Iterative for the same reason the applier below is: nothing in the
	// first-screen pipeline may impose a tree-depth ceiling the renderer that
	// produced the tree does not have.
	const stack: (readonly LynxFirstScreenDirectNode[])[] = [nodes];
	while (stack.length !== 0) {
		for (const node of stack.pop()!) {
			if (node.kind === 'host' && (node.type === 'list' || node.type === 'list-item')) return true;
			if (node.children.length !== 0) stack.push(node.children);
		}
	}
	return false;
}

/**
 * Empty a container's program ledger.
 *
 * One function rather than three statements at each of the two sites, because
 * both flags describe *these* runs and neither is observable once they are
 * gone. Both call sites mark the container disposed immediately after, so no
 * behavioural test can reach a container carrying a stale flag: the fallback a
 * stale `programRunsDisjoint` would select is correct, only slower, and a stale
 * `programEventsMaterialized` would only matter to a second mount no path
 * allows. Making the three inseparable is the proof, because there is no test
 * to be one.
 */
function clearProgramRuns<Node extends LynxElementRef>(state: LynxHostState<Node>): void {
	state.programRuns.length = 0;
	state.programRunsDisjoint = true;
	state.programEventsMaterialized = false;
}

/**
 * The PAPI tuple behind each of a program's event sites, resolved once per plan.
 *
 * `plan.events` names a site by its authored-through host event type, and every
 * consumer of the journal wants the `(type, name)` pair the Element PAPI takes.
 * That mapping is a pure function of a string the *build* chose, and a screen
 * holds one program instance per rendered row against one module-scope plan —
 * so resolving it per instance re-answers, 30,000 times, a question with one
 * answer per component (issue #215 D3).
 *
 * The refusal below is the third statement of one guarantee, and the first two
 * are why it can run this rarely. `emit-main-thread-program.ts` refuses to emit
 * a site whose type the native parser does not recognise, and `freezePlanNode`
 * restates the plan's structural guarantees once per plan for the plans that do
 * not come from the compiler. This is the same restatement for the one property
 * those two leave to the driver — that a type names a real PAPI tuple — kept at
 * runtime because a hand-built plan reaches this file without passing either,
 * and kept *here* because once per plan is where the other two already live.
 */
const PROGRAM_EVENT_BINDINGS = new WeakMap<
	UniversalProgramPlan,
	readonly LynxNativeEventBinding[]
>();

function programEventBindings(plan: UniversalProgramPlan): readonly LynxNativeEventBinding[] {
	const cached = PROGRAM_EVENT_BINDINGS.get(plan);
	if (cached !== undefined) return cached;
	const bindings = plan.events.map((site) => {
		const binding = parseLynxNativeEventProp(site.type);
		if (binding === null) {
			throw hostError(`event ${JSON.stringify(site.type)} is not a Lynx event prop.`);
		}
		return binding;
	});
	PROGRAM_EVENT_BINDINGS.set(plan, bindings);
	return bindings;
}

/**
 * The per-node event journal for one host of one program run, built on demand.
 *
 * The run holds `plan.events` and the tokens the mount installed for them,
 * index-aligned, which is the whole journal in the two arrays the mount already
 * had. This turns the slice of it belonging to one host into the `Map` the
 * ordinary paths expect — the shape C20 left being written once per node at
 * mount, and D3 stopped writing until something asks.
 *
 * Two callers ask, and they are the two moments a program's nodes stop being
 * the program's: terminal cleanup, which has to clear every installed tuple,
 * and hand-over, which gives the nodes to a background that will go on
 * installing and removing listeners on them through the ordinary journal.
 * Neither is on the paint path.
 */
function programNodeEvents<Node extends LynxElementRef>(
	run: LynxProgramRun<Node>,
	position: number,
): Map<string, LynxNativeEventRegistration> | undefined {
	const plan = run.plan;
	const sites = plan.events;
	if (sites.length === 0) return undefined;
	// The position is flat across the run's instances and `plan.events` is one
	// instance's site table, so which instance it names decides where in `tokens`
	// that instance's alignment starts. Zero, and free, for a run holding one.
	const instance = run.count === 1 ? 0 : Math.floor(position / plan.nodes);
	const node = position - instance * plan.nodes;
	const base = instance * sites.length;
	let events: Map<string, LynxNativeEventRegistration> | undefined;
	let bindings: readonly LynxNativeEventBinding[] | undefined;
	for (let index = 0; index < sites.length; index++) {
		const site = sites[index]!;
		if (site.node !== node) continue;
		// A site this render passed no handler to installed nothing, so there is
		// no tuple to journal — the same answer the per-node map gave by having no
		// entry for it.
		const token = run.tokens[base + index];
		if (token === undefined) continue;
		bindings ??= programEventBindings(plan);
		(events ??= new Map()).set(
			site.type,
			Object.freeze({ source: 'background', binding: bindings[index]!, listener: token }),
		);
	}
	return events;
}

/**
 * Write every program's event journal into the ordinary per-node one.
 *
 * Terminal cleanup clears `nativeEvents` tuple by tuple and reports itself
 * incomplete while any remain, so the retry semantics live in that map rather
 * than in the runs. Filling it in here is what lets a program's listeners use
 * them unchanged instead of growing a second, parallel unbind-and-retry path.
 */
function materializeProgramEvents<Node extends LynxElementRef>(state: LynxHostState<Node>): void {
	if (state.programEventsMaterialized) return;
	state.programEventsMaterialized = true;
	for (const run of state.programRuns) {
		if (run.plan.events.length === 0) continue;
		// Every host of every instance, which is what a run holding many of them
		// makes flat rather than one deep (issue #215 D8).
		const hosts = programRunHostCount(run);
		for (let position = 0; position < hosts; position++) {
			const events = programNodeEvents(run, position);
			if (events === undefined) continue;
			// Merged rather than assigned. Nothing outside the mount writes into a
			// program's nodes before this runs — every installer is reached through
			// a record, and a program host has none — so the entry should always be
			// absent. But this is the function whose job is to lose no tuple, and
			// not assuming costs one lookup on a path that has already left the
			// paint behind.
			const node = programRunHostNode(run, position);
			const existing = state.nativeEvents.get(node);
			if (existing === undefined) state.nativeEvents.set(node, events);
			else for (const [type, registration] of events) existing.set(type, registration);
		}
	}
}

/**
 * A run of siblings that are all one compiled program, painted together
 * (issue #215 D8).
 *
 * The `@for` shape: one row plan repeated `count` times, which on the bench is
 * 30,000 instances of a five-node row. Painted per member it costs an argument
 * array, a token array, a spread call, a returned array, a walk frame, a journal
 * entry and a pair of id tables *each*; painted as a span it costs four tables
 * and one journal entry for the whole range.
 */
interface DenseMemberSpan {
	readonly plan: UniversalProgramPlan;
	/** The array the members live in, kept rather than sliced out of. */
	readonly children: readonly LynxFirstScreenDirectNode[];
	readonly start: number;
	readonly count: number;
	/** The program node inside each member, which is the member itself or its one child. */
	readonly programs: readonly LynxFirstScreenDirectNode[];
	/** The id of the first member's program, and the base of every other. */
	readonly firstId: number;
	/** How many ids separate one member's program from the next one's. */
	readonly stride: number;
}

/**
 * The compiled program a member paints itself with, seen through the wrapper a
 * component row lowers to.
 *
 * A `@for` of components produces one keyed range per row holding exactly that
 * component, and a range takes an id without making a node — so the members of
 * the shape this whole slice is aimed at are ranges, not programs. A member that
 * *is* a program is the other lowering, and both are one plan repeated.
 */
function memberProgram(member: LynxFirstScreenDirectNode): LynxFirstScreenDirectNode | undefined {
	// A keyed member arrives wrapped, and how many times is a lowering detail:
	// `@for` wraps the member once, and a member that is a component is wrapped
	// again by the component boundary. A range makes no node, so the program
	// under the wrappers is the member for everything the span does with it.
	// Descend the whole chain rather than a fixed depth: pinning the depth at
	// one is what made this decline on `@for (const row of rows) { <Row /> }`,
	// the shape the span was written for.
	let node = member;
	for (;;) {
		if (node.kind === 'program') return node;
		if (node.kind !== 'range' || node.children.length !== 1) return undefined;
		const only = node.children[0];
		if (only === undefined) return undefined;
		node = only;
	}
}

/**
 * Whether `children[start..end)` is such a span, and the span if it is.
 *
 * Everything below is a constant number of comparisons per member against
 * something the renderer already wrote, which is what keeps the test cheaper
 * than the per-member mount it replaces. Three conditions, each here for a
 * different reason:
 *
 *   * **One plan.** A driver belongs to a plan, and instances of two plans
 *     interleave neither their arguments nor their ids.
 *   * **A constant stride.** The run addresses its nodes by arithmetic from
 *     `firstId`, so a member starting anywhere but where the arithmetic says
 *     would put every later reader on the wrong node. The ids the renderer
 *     minted are the only proof of that: the spacing is read off the first two
 *     members and then every member is held to it. Read rather than derived
 *     from the plan, because what sits between two instances is the
 *     description's business — a wrapper here, nothing there — and the plan
 *     cannot see it.
 *   * **Every hole painted.** An open hole holds members whose ids
 *     `assignProgramIds` mints *inside* the member's own span, so two instances
 *     of such a program do not take the same number of ids and the stride is not
 *     constant at all. It is also what makes the run's whole `nodes` table
 *     owned, and the same condition the emitter reports by carrying a driver.
 *
 * A span of one is refused: it would trade an argument array for four tables,
 * and `count === 1` is what every reader takes to mean the per-member shape.
 */
function denseMemberSpan(
	children: readonly LynxFirstScreenDirectNode[],
	start: number,
	end: number,
): DenseMemberSpan | null {
	const count = end - start;
	if (count < 2) return null;
	const first = children[start];
	if (first === undefined) return null;
	const leader = memberProgram(first);
	if (leader === undefined) return null;
	const plan = leader.plan;
	if (plan === undefined) return null;
	const rangeCount = plan.ranges.length;
	const leaderIds = leader.ids;
	if (leaderIds === undefined || leaderIds.length !== plan.nodes) return null;
	const firstId = leaderIds[0];
	if (firstId === undefined) return null;
	const second = memberProgram(children[start + 1]!);
	if (second === undefined || second.plan !== plan) return null;
	const secondId = second.ids?.[0];
	if (secondId === undefined) return null;
	const stride = secondId - firstId;
	// A stride shorter than the program's own span would overlap two instances,
	// which no numbering produces and no arithmetic could unpick.
	if (stride < plan.nodes + rangeCount) return null;
	const programs: LynxFirstScreenDirectNode[] = new Array(count);
	for (let index = 0; index < count; index++) {
		const program = memberProgram(children[start + index]!);
		if (program === undefined || program.plan !== plan) return null;
		if (program.values === undefined) return null;
		const ids = program.ids;
		if (ids === undefined || ids.length !== plan.nodes) return null;
		if (ids[0] !== firstId + index * stride) return null;
		if (rangeCount !== 0) {
			const texts = program.texts;
			if (texts === undefined || texts.length !== rangeCount) return null;
			for (let hole = 0; hole < rangeCount; hole++) {
				if (texts[hole] === undefined) return null;
			}
		}
		programs[index] = program;
	}
	return { plan, children, start, count, programs, firstId, stride };
}

/**
 * Issue-58 L3: apply a first-screen tree with direct Element PAPI emission —
 * no command staging, no cloned record maps, no operation replay — while
 * leaving the container state indistinguishable from the batch path so
 * `captureLynxFirstTree` and background adoption stay byte-compatible. The
 * renderer hands over an envelope rather than a batch: its version, and the
 * background listeners it assigned (the deterministic listener-id assignment
 * stays single-sourced there). A native `<list>` is built here too (issue #66
 * C3); only a tree whose host offers no list PAPI, or whose list topology this
 * applier cannot finish, falls back to the staged path.
 */
export function applyLynxFirstScreenDirect<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	roots: readonly LynxFirstScreenDirectNode[],
	envelope: LynxFirstScreenDirectEnvelope,
): boolean {
	const state = container[LYNX_HOST_STATE];
	if (state.disposed || state.disposing || state.faulted || state.applying) {
		throw hostError('first-screen container is not accepting an initial tree.');
	}
	if (state.acceptedVersion !== 0 || state.records.size !== 0) {
		throw hostError('direct first-screen apply requires an empty container.');
	}
	// A native `<list>` is built here now (issue #66 C3). Two trees still go back
	// to the staged path: one whose host offers no list PAPI, because a page that
	// cannot build a `<list>` at all is owed that diagnostic rather than a silent
	// fallback, and one whose list topology this applier cannot vouch for
	// finishing without faulting mid-walk.
	if (
		firstScreenTreeHasList(roots) &&
		(state.papi.list === undefined || !firstScreenListsAreDirectBuildable(roots))
	) {
		return false;
	}
	// Same envelope contract as the staged path: the applier is exported, so a
	// future caller must not be able to hand it an unvalidated envelope.
	if (envelope.renderer !== LYNX_RENDERER_ID) {
		throw hostError(
			`first-screen envelope renderer ${JSON.stringify(envelope.renderer)} is not "lynx".`,
		);
	}
	if (!Number.isSafeInteger(envelope.version) || envelope.version <= 0) {
		throw hostError(
			`first-screen envelope version ${String(envelope.version)} is not a positive safe integer.`,
		);
	}
	const papiIntrinsics = state.papi.intrinsics;
	const eventsByHost = new Map<number, [string, UniversalEventListenerDescriptor][]>();
	for (const binding of envelope.events) {
		let entries = eventsByHost.get(binding.id);
		if (entries === undefined) {
			entries = [];
			eventsByHost.set(binding.id, entries);
		}
		entries.push([binding.type, binding.listener]);
	}
	// The staged path runs both of these over the batch's final host set during
	// prepare, so a refusal costs zero PAPI calls. The direct path has no prepare
	// stage, so it pre-walks: refusing after the walk has begun would leave a
	// half-painted page, which is exactly the state the staged path never
	// produces.
	//
	// The walk is unconditional. A background listener is announced by the
	// envelope, so a page with none could skip a collision-only walk entirely; a
	// duplicated `main-thread:ref` is announced by nothing but the hosts' own
	// props. This applier is exported, so an envelope field claiming a tree holds
	// no refs would put a correctness check at its caller's discretion. What it
	// costs is a second read-only pass over a tree this function already scans
	// for a `<list>` before it creates anything — the same price as the list
	// pre-walk above, paid for the same reason.
	{
		const refOwners = new Map<string, number>();
		const pending: [readonly LynxFirstScreenDirectNode[], boolean, boolean][] = [
			[roots, true, false],
		];
		while (pending.length !== 0) {
			const [nodes, parentVisible, insideList] = pending.pop()!;
			for (const node of nodes) {
				// Every program this applier cannot paint is refused here, in the
				// pre-walk that runs before anything is created, rather than from
				// inside the mount after earlier roots are painted. That placement is
				// the whole reason this block exists, and a program is the one node
				// kind with more than one way to be unpaintable.
				//
				// All three are `LynxFirstScreenRefusalError` rather than `hostError`,
				// so they cost the first screen rather than the launch (#163 C3):
				// each names a page that is perfectly well formed, that the background
				// renders correctly over the command path, and that this applier
				// declines for a reason of its own. The receiver retires such an
				// attempt as `skipped` and reports the reason, so the diagnostic these
				// were owed is still paid — and the page arrives.
				if (node.kind === 'program') {
					// No intrinsic element factories, so there is nothing for the
					// program's create to make its nodes with. Unlike a `<list>` there
					// is no staged path to fall back *within*: the staged path is
					// commands, and a program exists so that its first screen is not
					// commands. The whole first screen is what falls back instead.
					if (papiIntrinsics === undefined) {
						throw new LynxFirstScreenRefusalError(
							'a compiled main-thread program needs a host with intrinsic element factories.',
						);
					}
					// A native list's row owns no element at paint time — the platform
					// materializes it later, through `componentAtIndex` — and a program
					// paints eagerly. Running one per cell is a different mechanism, not
					// a missing branch here.
					if (insideList) {
						throw new LynxFirstScreenRefusalError(
							'first-screen direct apply cannot yet mount a compiled main-thread program inside a native list row.',
						);
					}
					// A hidden host is marked with a `hidden` attribute unless it is raw
					// text, and which of a program's nodes are raw text is exactly what
					// the program stopped carrying. Guessing would either mark a text
					// node the command path leaves alone or leave a view visible.
					if (!parentVisible || node.visibility === 'hidden') {
						throw new LynxFirstScreenRefusalError(
							'first-screen direct apply cannot yet mount a hidden compiled main-thread program.',
						);
					}
				}
				// Ranges are transparent here exactly as they are in the walk below:
				// they carry no props of their own and pass visibility through.
				const visible =
					node.kind === 'host' ? parentVisible && node.visibility !== 'hidden' : parentVisible;
				if (node.kind === 'host' && node.props != null) {
					const entries = eventsByHost.get(node.id);
					if (entries !== undefined) {
						assertNoMainThreadEventCollisionForTypes(
							node.props,
							entries.map(([type]) => type),
						);
					}
					// Hidden hosts are skipped for the same reason the staged path skips
					// them: an invisible host installs no main-thread props, so it owns no
					// ref to collide over. A malformed descriptor is left to the prop
					// planner, which reports it precisely; guessing here would report a
					// duplicate that is really a bad value.
					const ref = node.props['main-thread:ref'] as
						LynxMainThreadRefDescriptor | null | undefined;
					if (visible && ref != null && typeof ref._wvid === 'string') {
						const previousOwner = refOwners.get(ref._wvid);
						if (previousOwner !== undefined && previousOwner !== node.id) {
							throw hostError(
								`main-thread ref ${JSON.stringify(ref._wvid)} is assigned to hosts ${previousOwner} and ${node.id}.`,
							);
						}
						refOwners.set(ref._wvid, node.id);
					}
				}
				if (node.children.length !== 0) {
					// A row and everything under it, exactly as the paint walk marks
					// them: `insideList` turns on for a `<list>`'s children, not for the
					// list itself.
					pending.push([
						node.children,
						visible,
						insideList || (node.kind === 'host' && node.type === 'list'),
					]);
				}
			}
		}
	}
	const papi = state.papi;
	const append =
		papi.append ?? ((parent: Node, child: Node) => papi.insertBefore(parent, child, null));
	/**
	 * One pending step of the walk. A frame with a `node` materializes that
	 * node; a frame with a `papiNode` instead is the deferred attach that must
	 * run once the node's whole subtree is complete, which is what keeps the
	 * bottom-up attach order the staged path produces.
	 */
	interface WalkFrame {
		readonly node: LynxFirstScreenDirectNode | null;
		readonly papiNode: Node | null;
		/**
		 * Set on the deferred frame that publishes a `<list>`'s rows. The element
		 * itself is created on the way down, so its unique ID lands in the order
		 * the staged path assigns it; only the row metadata has to wait, because it
		 * is read off records the subtree walk has not created yet.
		 */
		readonly listRecord: LynxHostRecord<Node> | null;
		readonly parentRecord: LynxHostRecord<Node> | null;
		readonly parentId: number | null;
		readonly physicalParent: Node;
		readonly parentVisible: boolean;
		/**
		 * True for a `<list>`'s rows and everything beneath them. Such a record is
		 * built without an element: the platform materializes a row through
		 * `componentAtIndex` when it needs one, and the staged path skips exactly
		 * the same `create` operations.
		 */
		readonly insideList: boolean;
		/**
		 * Set on a frame standing for a whole keyed range of one compiled program
		 * (issue #215 D8). It carries the members instead of a `node`, because
		 * what it mounts is not a node — it is `count` of them, painted by one
		 * driver call and journalled as one run.
		 *
		 * A frame rather than work done where the span is found, because the walk
		 * is what owns sibling order: two ranges can name the same parent node, so
		 * a span mounted early would append its members ahead of a range declared
		 * before it.
		 */
		readonly denseSpan: DenseMemberSpan | null;
	}
	// An explicit stack, not recursion. The staged path this replaced walks a
	// flat command array and so has no depth ceiling; one frame per tree level
	// would make the direct applier the first stack-bound stage in the
	// first-screen pipeline and refuse trees the renderer can produce.
	const stack: WalkFrame[] = [];
	const pushChildren = (
		node: LynxFirstScreenDirectNode,
		parentRecord: LynxHostRecord<Node> | null,
		parentId: number | null,
		physicalParent: Node,
		parentVisible: boolean,
		insideList: boolean,
	): void => {
		// A described parent's children are deliberately *not* tested for the dense
		// span here (issue #215 D8). The shape would be the same one
		// `mountProgram` looks for, and a described parent holding nothing but
		// compiled rows cannot arise from this compiler: the backend leaves a
		// parent described only when its range hole is not the parent's last
		// child — that is the one condition `universalTemplateProgramWithoutRanges`
		// declines on — and a hole that is not last has a described sibling after
		// it, which is exactly what an all-or-nothing span over a parent's children
		// refuses. Every other arrangement either compiles the parent into a
		// program, which is the site below, or fails the build outright. So the
		// test here would run once per described host on every first screen and
		// answer `null` every time.
		//
		// Reversed, so the stack pops siblings in authored order.
		for (let index = node.children.length - 1; index >= 0; index--) {
			stack.push({
				node: node.children[index]!,
				papiNode: null,
				listRecord: null,
				denseSpan: null,
				parentRecord,
				parentId,
				physicalParent,
				parentVisible,
				insideList,
			});
		}
	};
	/**
	 * Everything a created host owes its container once its element exists.
	 * Shared with the deferred `<list>` frame, whose element is created after its
	 * subtree rather than before it, so the two cannot share a call site.
	 */
	const emitHostNode = (
		record: LynxHostRecord<Node>,
		id: number,
		type: string,
		props: Readonly<Record<string, unknown>>,
		patch: LynxHostPropPatch,
		visible: boolean,
		hostEvents: [string, UniversalEventListenerDescriptor][] | undefined,
		papiNode: Node,
	): void => {
		state.ownedNodes.add(papiNode);
		record.node = papiNode;
		// The first screen paints before any peer exists, so there is no
		// announcement to answer from and no container flag to read: this path
		// installs eagerly by construction. Adoption re-decides on the accepted
		// container, which is where the demand rule applies.
		ensureNodesRefSelector(state, record);
		applyProps(
			state,
			papiNode,
			type,
			EMPTY_HOST_PROPS,
			props,
			patch,
			true,
			visible,
			visible && state.hasMainThreadProps,
		);
		if (!visible && type !== '#text' && type !== 'raw-text') {
			papi.setAttribute(papiNode, 'hidden', true);
		}
		if (visible && hostEvents !== undefined) {
			for (const [eventType, listener] of hostEvents) {
				installNativeEvent(state, papiNode, container.root, id, 1, eventType, listener);
			}
		}
	};
	/**
	 * Bound create functions for this apply, by plan.
	 *
	 * `bind` reads the host's intrinsic element factories and closes over one
	 * append, so what it produces belongs to the host rather than to the
	 * instance — while a screen holds one program node per rendered instance,
	 * every one of them naming the same module-scope plan. Caching for the
	 * length of the apply is what makes binding once per program instead of once
	 * per row. The map dies with the call, so no closure over this container's
	 * PAPI outlives the container it captured.
	 */
	const boundPrograms = new Map<UniversalProgramPlan, UniversalProgramCreate>();
	/**
	 * Paint one compiled main-thread program (issue #163).
	 *
	 * The program is the paint: it creates its own nodes, writes its own scalar
	 * props, installs its own event sites and appends its own subtree, and the
	 * only thing that comes back is the run's nodes in program order. So there
	 * is no walk here and no record written — a program exists precisely so its
	 * subtree is never described — and what this owes the container is the part
	 * that is not painting: physical ownership for teardown, and the native
	 * event journal that lets terminal cleanup clear the tuples the program set.
	 */
	const mountProgram = (
		node: LynxFirstScreenDirectNode,
		parentRecord: LynxHostRecord<Node> | null,
		parentId: number | null,
		physicalParent: Node,
		parentVisible: boolean,
	): void => {
		const plan = node.plan;
		const ids = node.ids;
		const values = node.values;
		if (plan === undefined || ids === undefined || values === undefined) {
			throw hostError(
				'first-screen program node carries no plan, values, or ids; a compiled main-thread program cannot be mounted from a description.',
			);
		}
		// A hidden program and one inside a native list row are refused by the
		// pre-walk above, before anything is created — that is where a refusal has
		// to live, because refusing from here would leave the roots painted ahead
		// of this one on the page. This mount is not handed `insideList` at all any
		// more, which is the same statement in the signature.
		//
		// Everything this function still throws is the other kind: a program
		// disagreeing with its own plan, which no fallback path makes right.
		if (plan.nodes < 1) {
			throw hostError('a compiled main-thread program makes no nodes; there is nothing to mount.');
		}
		if (ids.length !== plan.nodes) {
			throw hostError(
				`first-screen program declares ${plan.nodes} nodes but was assigned ${ids.length} ids.`,
			);
		}
		const children = node.children;
		const spans = node.spans;
		if (spans === undefined || spans.length !== plan.ranges.length) {
			throw hostError(
				`first-screen program declares ${plan.ranges.length} keyed ranges but carries ${spans?.length ?? 0} member spans.`,
			);
		}
		// One entry per range on both, for the reason `spans` has one: a hole is
		// addressed by its position in `plan.ranges` and by nothing else, so a
		// short table would silently re-address every hole after the gap rather
		// than fail at the one it is missing.
		const texts = node.texts ?? EMPTY_PROGRAM_RANGE_TEXTS;
		const rangeIds = node.rangeIds ?? EMPTY_PROGRAM_RANGE_IDS;
		if (texts.length !== plan.ranges.length || rangeIds.length !== plan.ranges.length) {
			throw hostError(
				`first-screen program declares ${plan.ranges.length} keyed ranges but carries ${texts.length} range texts and ${rangeIds.length} range ids.`,
			);
		}
		const args: unknown[] = [container.pageComponentUniqueId];
		for (const slot of plan.values) args.push(values[slot]);
		// Tokens first, before anything exists: one per event site the renderer
		// announced a listener for, and `undefined` for a site this render did
		// not pass a handler to. The emitted program installs a site only when
		// its argument is defined, which is what makes an absent optional handler
		// install nothing — the same answer the command path gives by simply not
		// listing that host.
		const tokens: (LynxNativeEventToken | undefined)[] = [];
		// The renderer announced this program's sites in one contiguous pass in site
		// order, and `eventsAt`/`eventsCount` are where it recorded that run. So a
		// site's listener is found by walking the run alongside the sites rather
		// than by searching for it: the cursor advances only when an announcement is
		// claimed, which is what leaves a site whose handler came through undefined
		// open without shifting the sites after it onto the wrong listeners.
		// `(node, type)` names at most one site — the plan freeze checks it, and the
		// compiler refuses to emit otherwise — so an announcement matching the site
		// at the cursor is that site's and no other's.
		//
		// A tree built by hand carries no run and gets the search instead. The two
		// answer identically for every announcement the renderer can produce, which
		// is what this applier's own tests hold them to.
		const run = node.eventsAt;
		const count = node.eventsCount;
		// Both or neither, checked rather than assumed. Half a run is a caller
		// error the two readers would otherwise answer silently and differently:
		// a start with no count is an empty run, so every site would come back
		// open and the page would paint with no listeners at all — the failure
		// this whole slice exists to stop being possible.
		if ((run === undefined) !== (count === undefined)) {
			throw hostError(
				'first-screen program carries half an announcement run; `eventsAt` and `eventsCount` are given together or not at all.',
			);
		}
		const runEnd = run === undefined || count === undefined ? -1 : run + count;
		let cursor = run ?? 0;
		let claimed = 0;
		for (const site of plan.events) {
			const hostId = ids[site.node];
			if (hostId === undefined) {
				throw hostError(
					`first-screen program binds an event on node ${site.node}, which it did not number.`,
				);
			}
			let announced: UniversalEventListenerDescriptor | undefined;
			if (run === undefined) {
				announced = eventsByHost.get(hostId)?.find(([type]) => type === site.type)?.[1];
			} else {
				// The run covers the program's whole merged block, a keyed range's
				// members spliced at their hole's position between the program's
				// own sites — because the renderer announces in the same merged
				// order `assignProgramIds` numbers hosts, every binding in the
				// block carries an id minted in one ascending walk. A member's
				// binding therefore sits below the next own site's host id and is
				// skipped by comparison rather than searched past; a site whose
				// handler came through undefined announces nothing, so the cursor
				// stops at an id beyond it and the site stays open without
				// shifting the sites after it onto the wrong listeners.
				while (cursor < runEnd && envelope.events[cursor]!.id < hostId) cursor++;
				if (cursor < runEnd) {
					const binding = envelope.events[cursor];
					if (binding !== undefined && binding.id === hostId && binding.type === site.type) {
						announced = binding.listener;
						cursor++;
						claimed++;
					}
				}
			}
			// Four of this token's five primitives are proven before the mount
			// reaches them, so it is built rather than re-checked per site
			// (issue #215 D6). Where each is proven, in order:
			//
			//   `container.root`  `assertSafeId(options.root, 'root')`, once when
			//                     the container was created.
			//   `hostId`          `node.ids` is this applier's input contract, and
			//                     every other reader of it in this file takes it as
			//                     one: the page-root push, a range member's
			//                     `parentId`, the ownership journal, and the child
			//                     linkage all index it unchecked. A per-site assert
			//                     over the subset of ids that happen to carry an
			//                     event was never that contract's guard, and
			//                     keeping it here would go on implying it was.
			//   `1`               the literal on the line below.
			//   `priority`        `freezePlanNode`, once per plan, and the emitter
			//                     refuses one at build. It is read off the *plan*
			//                     rather than off the announcement for that reason:
			//                     the plan is the half that carries a proof.
			//
			// The fifth, `announced.id`, is the one primitive whose proof lives at
			// neither build nor container time — it arrives on the envelope — so it
			// is still checked here, once per site that claimed an announcement.
			let token: LynxNativeEventToken | undefined;
			if (announced !== undefined) {
				assertSafeId(announced.id, 'first-screen announcement listener id');
				token = encodePrevalidatedLynxNativeEventToken(
					container.root,
					hostId,
					1,
					announced.id,
					site.priority,
				);
			}
			tokens.push(token);
			args.push(token);
		}
		// An announcement of this program's that no site claimed is the one
		// disagreement a position can have with the thing it addresses, and the
		// one the search could never report: a listener announced for one of this
		// program's own hosts that no site of this program answers to. The block
		// also carries the members' announcements — spliced at their hole's
		// position by the same merged walk that numbered them — so the check is
		// membership, not exhaustion: every binding in the block whose id is one
		// of this program's own is counted in one ascending pass against the
		// sorted ids, and that count must equal what the sites claimed. Every
		// other shape of mismatch shows up as a site left open above, which is
		// the answer a missing handler gets too — this is the shape that is
		// never a missing handler.
		if (run !== undefined) {
			let own = 0;
			let at = 0;
			for (let index = run; index < runEnd; index++) {
				const id = envelope.events[index]!.id;
				while (at < ids.length && (ids[at] as number) < id) at++;
				if (at < ids.length && ids[at] === id) own++;
			}
			if (own !== claimed) {
				throw hostError(
					`first-screen program was handed ${own} announcement${own === 1 ? '' : 's'} for its ${plan.events.length} event site${plan.events.length === 1 ? '' : 's'}, and claimed ${claimed} of them.`,
				);
			}
		}
		// Last, after the listeners, exactly as the emission orders its
		// parameters. A hole this renderer filled itself sends `undefined`, which
		// is the value the compiled test declines — so a program is handed the
		// same decision the renderer made rather than re-deciding it.
		for (const text of texts) args.push(text);
		let bound = boundPrograms.get(plan);
		if (bound === undefined) {
			bound = plan.bind(papi);
			if (typeof bound !== 'function') {
				throw hostError(
					'a compiled main-thread program bound to something other than a create function.',
				);
			}
			// Resolved here and not where the journal is read, so a plan naming an
			// event type the native parser does not recognise is still refused by
			// the mount rather than by a teardown one screen later (issue #215 D3).
			// This is the miss branch, so it runs once per plan — which is what
			// makes the refusal cost what the bind costs instead of what the rows
			// cost. It checks every site rather than only the bound ones: a site
			// with no handler this render is still a site the component declares,
			// and the compiler refuses one either way.
			programEventBindings(plan);
			boundPrograms.set(plan, bound);
		}
		// Everything the program makes is detached until this function attaches it,
		// so a throw inside the create leaves an orphan subtree that never entered
		// the page and never entered the ownership journal — nothing half-painted
		// for terminal disposal to find, which is more than the host path can say.
		const created = bound(...args);
		// The returned nodes are the only map back into a subtree with no
		// description, so a program that returns the wrong number of them has
		// left this container holding physical nodes it cannot name. Checked
		// before any of them is journalled, while the fault is still the
		// program's rather than the ownership journal's.
		if (created.length !== plan.nodes + plan.ranges.length) {
			throw hostError(
				`a compiled main-thread program declaring ${plan.nodes} nodes and ${plan.ranges.length} keyed ranges returned ${created.length} entries.`,
			);
		}
		// The trailing half: what the create function painted for each hole. Two
		// processes decided this — the renderer, choosing which holes to hand a
		// string, and the build, choosing which holes compile a test at all — so
		// the answers are compared rather than assumed to match. Disagreeing
		// either way is silent otherwise: a hole this renderer skipped and the
		// program left open is a text that is simply missing, and one they both
		// filled is a node in the page that no journal owns.
		let owned = plan.nodes;
		for (let index = 0; index < plan.ranges.length; index++) {
			const painted = created[plan.nodes + index];
			const text = texts[index];
			if (text === undefined) {
				if (painted !== undefined) {
					throw hostError(
						`a compiled main-thread program painted keyed range ${index}, which this first screen filled itself.`,
					);
				}
				continue;
			}
			if (painted === undefined) {
				throw hostError(
					`a compiled main-thread program left keyed range ${index} open, which this first screen handed it to paint.`,
				);
			}
			const id = rangeIds[index];
			if (id === undefined) {
				throw hostError(
					`a compiled main-thread program painted keyed range ${index}, which this first screen did not number.`,
				);
			}
			// Counted exactly like a node the program made, because that is what it
			// is: the ownership equality this container checks counts every program
			// node once, and a painted text left out would read as an untracked node
			// rather than as one this mount forgot.
			owned++;
		}
		// One entry, after every check above rather than during them: a mount that
		// throws leaves nothing half-journalled for terminal cleanup to find, which
		// is more than the per-node writes this replaced could say. `ids`,
		// `rangeIds`, `created` and `tokens` are arrays this mount already holds,
		// so the run is the only allocation, and the per-ID and per-node views
		// adoption and teardown want are built from it there — after the paint this
		// stands in front of (issues #163 C20 and #215 D1, D3).
		//
		// `plan` and `tokens` are the event journal, and they are one entry rather
		// than one per site for the same reason the rest of this is: the plan is
		// the site table, index-aligned with the tokens this mount installed, and
		// copying that pair into a `Map` per node re-states per row what the build
		// stated per component. It also closes the window the per-site loop had —
		// a throw partway through it left a run pushed and half its sites
		// journalled, and there is now no partway.
		const mounted: LynxProgramRun<Node> = {
			count: 1,
			firstId: ids[0]!,
			// Unread at a count of one — the scanning readers answer from `ids` —
			// and the program's own span, which is what a second instance would
			// have sat one of past this one.
			stride: plan.nodes + plan.ranges.length,
			ids,
			rangeIds,
			nodes: created as readonly (Node | undefined)[],
			owned,
			plan,
			tokens,
		};
		// One comparison, here, so adoption can find a run by searching instead of
		// by remembering every node (issue #215 D1). A sibling program starts after
		// the last one ends; a program mounted inside another program's keyed-range
		// member does not, because `assignProgramIds` mints its ids in the middle
		// of the outer program's span. This says which was built rather than making
		// the lookup guess, and it can only ever turn the flag off.
		const previous = state.programRuns[state.programRuns.length - 1];
		if (previous !== undefined && ids[0]! <= programRunLastId(previous)) {
			state.programRunsDisjoint = false;
		}
		state.programRuns.push(mounted);
		// Where this program's root sits in the description — the whole of what a
		// program owes the logical tree, because it writes no record and so this
		// push is the only thing that will ever name it as its parent's child.
		//
		// The same three cases, resolved in the same order, as a described host
		// (issue #215 D5). Two of them were already here; the first was not, and
		// its absence is why a shell the renderer described could paint a page of
		// compiled rows correctly and then have it refused — the parent's record
		// listed only the children that happened to be described, so the
		// background's description of that parent disagreed and every launch
		// repainted.
		//
		// It runs here rather than after the create so the push lands where the
		// walk is, and the walk is at the row's own position among its parent's
		// children: a range is transparent, so members pop between the siblings
		// declared before the hole and the ones declared after it. Adding them
		// once the walk was done would hold exactly the right nodes in the wrong
		// order, and the background describes an order.
		if (parentRecord !== null) {
			if (parentRecord.children === EMPTY_HOST_CHILDREN) parentRecord.children = [];
			parentRecord.children.push(ids[0]!);
		} else if (parentId === null) {
			// A page root, and `rootChildren` is the logical half of that —
			// `ownedPageRoots` being the physical half.
			state.rootChildren.push(ids[0]!);
		}
		// The remaining case is this program being a keyed range member of another
		// program: a real parent, named by `parentId`, with no record to link into,
		// because a program's subtree is never described. Calling it a page root
		// instead is the mistake the guard above refuses, exactly as the described
		// host branch refuses it for a member that is a host.

		// The attach is queued before the members so it pops after them, which is
		// how the rest of this walk keeps a subtree out of the caller's tree until
		// it is finished. It is the whole reason the emitted create returns its
		// root instead of appending it: a range's members go into a node the
		// program made, and a program that had already attached would make every
		// one of them an insertion into the live page.
		stack.push({
			node: null,
			papiNode: created[0] as Node,
			listRecord: null,
			denseSpan: null,
			parentRecord: null,
			parentId,
			physicalParent,
			parentVisible,
			insideList: false,
		});
		// Reversed twice, so the members pop in `plan.ranges` order and, within a
		// range, in authored order. Two ranges can name the same node — `{a}{b}`
		// in one text host is two holes in one parent — so the order between them
		// is as load-bearing as the order inside one.
		let end = children.length;
		for (let range = plan.ranges.length - 1; range >= 0; range--) {
			const site = plan.ranges[range]!;
			const memberParent = created[site.node];
			if (memberParent === undefined) {
				throw hostError(
					`first-screen program appends a keyed range into node ${site.node}, which it did not make.`,
				);
			}
			const start = end - spans[range]!;
			if (start < 0) {
				throw hostError('first-screen program declares more keyed range members than it carries.');
			}
			// The same span this applier looks for under a described parent, in the
			// other place a keyed range's members are pushed (issue #215 D8).
			const span = LYNX_DENSE_PROGRAM_RANGES ? denseMemberSpan(children, start, end) : null;
			if (span !== null) {
				stack.push({
					node: null,
					papiNode: null,
					listRecord: null,
					denseSpan: span,
					parentRecord: null,
					parentId: ids[site.node]!,
					physicalParent: memberParent as Node,
					parentVisible,
					insideList: false,
				});
				end = start;
				continue;
			}
			for (let member = end - 1; member >= start; member--) {
				stack.push({
					node: children[member]!,
					papiNode: null,
					listRecord: null,
					denseSpan: null,
					// A program's node owns no record — that is what a program is —
					// so a member links into `parentId` and nothing else.
					parentRecord: null,
					parentId: ids[site.node]!,
					physicalParent: memberParent as Node,
					parentVisible,
					insideList: false,
				});
			}
			end = start;
		}
		if (end !== 0) {
			throw hostError('first-screen program carries keyed range members no range claims.');
		}
	};
	/**
	 * Paint a whole span of one compiled program with one driver call, and
	 * journal the result as one run (issue #215 D8).
	 *
	 * The per-member mount below it is still the only other painter: where the
	 * emission carries no driver, the members go back on the stack and take that
	 * path unchanged. So this is an alternative *emission* being used, not an
	 * alternative applier — the tree either path paints is the same tree, which is
	 * what the differential and adoption tests decide rather than argue.
	 *
	 * What it deletes, per member: the argument array and its pushes, the token
	 * array, the `boundPrograms` lookup, the spread call, the array the create
	 * returned, the walk frame that carried the member and the one that attached
	 * it, the journal entry, and the `programRunLastId` comparison beside it.
	 * What it adds: five table writes and one array read per parameter. The
	 * ledger's rows are in `benchmarks/lynx-table/README.md` §8, and D8's
	 * prediction was written from them before this ran.
	 */
	const mountDenseSpan = (
		span: DenseMemberSpan,
		parentId: number,
		physicalParent: Node,
		parentVisible: boolean,
	): void => {
		const plan = span.plan;
		const count = span.count;
		const programs = span.programs;
		const firstId = span.firstId;
		const memberStride = span.stride;
		const sites = plan.events;
		const siteCount = sites.length;
		const rangeCount = plan.ranges.length;
		const slots = plan.values;
		const valueCount = slots.length;
		const stride = plan.nodes + rangeCount;
		let bound = boundPrograms.get(plan);
		if (bound === undefined) {
			bound = plan.bind(papi);
			if (typeof bound !== 'function') {
				throw hostError(
					'a compiled main-thread program bound to something other than a create function.',
				);
			}
			programEventBindings(plan);
			boundPrograms.set(plan, bound);
		}
		const drive = bound.run;
		if (drive === undefined) {
			// A create with no driver beside it. The compiler emits one exactly
			// where this span's condition holds, so this is a hand-built plan — and
			// the honest answer for one is the path it had before this slice
			// existed, not a second loop here that would be a second painter to keep
			// agreeing with the first.
			for (let index = count - 1; index >= 0; index--) {
				stack.push({
					node: span.children[span.start + index]!,
					papiNode: null,
					listRecord: null,
					denseSpan: null,
					// A program's node owns no record, so a member of its keyed range
					// links into `parentId` and nothing else — the same three fields the
					// per-member push below this span's site sets.
					parentRecord: null,
					parentId,
					physicalParent,
					parentVisible,
					insideList: false,
				});
			}
			return;
		}
		// Four tables, sized once, holding what `count` separate calls would have
		// held in `count` argument arrays. `out` is the run's `nodes` table: the
		// driver writes the instances into it and nothing copies it afterwards.
		const values: unknown[] = new Array(count * valueCount);
		const tokens: (LynxNativeEventToken | undefined)[] = new Array(count * siteCount);
		const texts: unknown[] = new Array(count * rangeCount);
		const out: unknown[] = new Array(count * stride);
		for (let instance = 0; instance < count; instance++) {
			const member = programs[instance]!;
			const memberValues = member.values!;
			const valueBase = instance * valueCount;
			for (let slot = 0; slot < valueCount; slot++) {
				values[valueBase + slot] = memberValues[slots[slot]!];
			}
			const memberTexts = member.texts!;
			const textBase = instance * rangeCount;
			for (let hole = 0; hole < rangeCount; hole++) texts[textBase + hole] = memberTexts[hole];
			// The same announcement walk the per-member mount runs, over this
			// member's own run, for the same reason: a site's listener is found at a
			// position in the run rather than searched for, and the cursor advances
			// only when an announcement is claimed.
			const announcedAt = member.eventsAt;
			const announcedCount = member.eventsCount;
			if ((announcedAt === undefined) !== (announcedCount === undefined)) {
				throw hostError(
					'first-screen program carries half an announcement run; `eventsAt` and `eventsCount` are given together or not at all.',
				);
			}
			const runEnd =
				announcedAt === undefined || announcedCount === undefined
					? -1
					: announcedAt + announcedCount;
			let cursor = announcedAt ?? 0;
			const ids = member.ids!;
			const tokenBase = instance * siteCount;
			for (let index = 0; index < siteCount; index++) {
				const site = sites[index]!;
				const hostId = ids[site.node];
				if (hostId === undefined) {
					throw hostError(
						`first-screen program binds an event on node ${site.node}, which it did not number.`,
					);
				}
				let listener: UniversalEventListenerDescriptor | undefined;
				if (announcedAt === undefined) {
					listener = eventsByHost.get(hostId)?.find(([type]) => type === site.type)?.[1];
				} else if (cursor < runEnd) {
					const binding = envelope.events[cursor];
					if (binding !== undefined && binding.id === hostId && binding.type === site.type) {
						listener = binding.listener;
						cursor++;
					}
				}
				if (listener !== undefined) {
					// `announced.id` is the one primitive of the five whose proof lives
					// on the envelope rather than at build or container time, so it is
					// the one still checked here (issue #215 D6).
					assertSafeId(listener.id, 'first-screen announcement listener id');
					tokens[tokenBase + index] = encodePrevalidatedLynxNativeEventToken(
						container.root,
						hostId,
						1,
						listener.id,
						site.priority,
					);
				}
			}
			if (announcedAt !== undefined && cursor !== runEnd) {
				throw hostError(
					`first-screen program was handed ${runEnd - announcedAt} announcements for its ${siteCount} event site${siteCount === 1 ? '' : 's'}, and claimed ${cursor - announcedAt} of them.`,
				);
			}
		}
		drive(container.pageComponentUniqueId, count, values, tokens, texts, out);
		// Two reads rather than `count * stride` of them, and each one answers a
		// question the arithmetic cannot.
		//
		// The first instance's trailing half says the emission filled it at all:
		// every hole of every member was handed a string — that is what
		// `denseMemberSpan` proved, one read per hole — and the compiled test is
		// `typeof r === 'string'`, so one instance painting every hole settles all
		// of them. The last instance's root says the loop ran `count` times with
		// the stride it declared, which is the one way a driver can disagree with
		// the table its caller sized.
		for (let hole = 0; hole < rangeCount; hole++) {
			if (out[plan.nodes + hole] === undefined) {
				throw hostError(
					`a compiled main-thread program left keyed range ${hole} open, which this first screen handed it to paint.`,
				);
			}
		}
		if (out[0] === undefined || out[(count - 1) * stride] === undefined) {
			throw hostError(
				`a compiled main-thread program run painted fewer than the ${count} instances it was given.`,
			);
		}
		const mounted: LynxProgramRun<Node> = {
			count,
			firstId,
			// Empty, and that is the whole point: every id in this run is
			// `firstId + instance * stride + offset`, so a range of 30,000 members
			// carries no per-member id table at all.
			stride: memberStride,
			ids: EMPTY_PROGRAM_IDS,
			rangeIds: EMPTY_PROGRAM_RANGE_IDS,
			nodes: out as readonly (Node | undefined)[],
			// All of them: every instance paints every hole it declares, which is
			// the condition that made this span dense.
			owned: count * stride,
			plan,
			tokens,
		};
		const previous = state.programRuns[state.programRuns.length - 1];
		if (previous !== undefined && firstId <= programRunLastId(previous)) {
			state.programRunsDisjoint = false;
		}
		state.programRuns.push(mounted);
		// Attached here rather than through a deferred frame each: an instance
		// declaring no open hole has no members, so its subtree is complete the
		// moment the driver returns and there is nothing left to wait for. The
		// order is the authored one, which is the order the frames this span
		// replaced would have popped in.
		//
		// Nothing is linked into a record, and there is no page-root case, because
		// a span only ever forms among the keyed range members of a program: those
		// have a real parent named by `parentId` and no record to hold them, which
		// is what a program is (issue #215 D5 states the three cases and where each
		// one is resolved).
		for (let instance = 0; instance < count; instance++) {
			append(physicalParent, out[instance * stride] as Node);
		}
	};
	const visit = (frame: WalkFrame): void => {
		const denseSpan = frame.denseSpan;
		if (denseSpan !== null) {
			mountDenseSpan(denseSpan, frame.parentId!, frame.physicalParent, frame.parentVisible);
			return;
		}
		const { node, parentRecord, parentId, physicalParent, parentVisible, insideList } = frame;
		if (node === null) {
			const listRecord = frame.listRecord;
			if (listRecord !== null) {
				// The rows are records now, which is what publication reads. The
				// platform materializes them later through the callbacks the list was
				// created with; nothing physical is built here.
				publishNativeListItems(state, listRecord);
				return;
			}
			const attached = frame.papiNode!;
			if (parentId === null) state.ownedPageRoots.add(attached);
			append(physicalParent, attached);
			return;
		}
		if (node.kind === 'program') {
			// Handled before the range-transparent branch below, which would
			// otherwise walk past a node carrying no type and no props and publish
			// the page it left out.
			mountProgram(node, parentRecord, parentId, physicalParent, parentVisible);
			return;
		}
		if (node.kind !== 'host') {
			pushChildren(node, parentRecord, parentId, physicalParent, parentVisible, insideList);
			return;
		}
		const type = node.type!;
		// Sticky, and set for the rows as well as the list, exactly as the staged
		// prepare sets it from its `create` commands. It is what tells every later
		// batch on this container that the compact and lazy-public-instance fast
		// paths — which assume ordinary physical parentage — do not apply here.
		if (type === 'list' || type === 'list-item') state.hasNativeListTopology = true;
		// The rendered records carry the main graph's raw props, where a
		// `main-thread:` event prop is still a tagged callable. Records feed
		// `captureLynxFirstTree`, whose snapshot crosses the ContextProxy wire, so
		// the stored props must be the same wire-safe clones the staged applier
		// journals — cloneProps unwraps tagged callables to plain worklet
		// descriptors and rejects everything structured clone would refuse.
		const props =
			node.props == null ? EMPTY_HOST_PROPS : cloneProps(node.props, 'first-screen host props');
		const visible = parentVisible && node.visibility !== 'hidden';
		const patch =
			type === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
				? EMPTY_RAW_TEXT_CREATE_PATCH
				: planLynxHostPropPatch(type, EMPTY_HOST_PROPS, props);
		if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
			state.hasMainThreadProps = true;
		}
		const handle = createHandle(container.root, node.id, type, 1);
		state.generations.set(node.id, 1);
		const hostEvents = eventsByHost.get(node.id);
		const record: LynxHostRecord<Node> = {
			node: null,
			type,
			props,
			visible,
			parent: parentId,
			children: EMPTY_HOST_CHILDREN,
			events:
				hostEvents === undefined
					? EMPTY_HOST_EVENTS
					: new Map(hostEvents as Iterable<[string, UniversalEventListenerDescriptor]>),
			handle,
			selectorWanted: false,
			selectorInstalled: false,
		};
		state.records.set(node.id, record);
		if (parentRecord !== null) {
			if (parentRecord.children === EMPTY_HOST_CHILDREN) parentRecord.children = [];
			parentRecord.children.push(node.id);
		} else if (parentId === null) {
			state.rootChildren.push(node.id);
		}
		// The remaining case is a keyed range member whose parent is a compiled
		// program's node (issue #163): a real parent, named by `record.parent`,
		// with no record to link into — because a program's subtree is never
		// described. Calling it a page root instead would be a lie the ownership
		// journal then disagrees with.
		if (insideList) {
			// A row, or something under one. It owns no element until the platform
			// asks for its cell, so there is nothing to create, apply, attach, or
			// bind an event to — the cell does all of that when it materializes. The
			// record is what the list reads to publish its metadata, and what
			// `captureLynxFirstTree` journals as a logical node.
			pushChildren(node, record, node.id, physicalParent, visible, true);
			return;
		}
		const papiNode =
			type === 'list'
				? beginNativeListNode(state, container, record)
				: papi.createElement(type, container.pageComponentUniqueId, textValue(props));
		emitHostNode(record, node.id, type, props, patch, visible, hostEvents, papiNode);
		if (type !== 'list' && node.children.length === 0) {
			// A leaf queues nothing behind its attach, so the deferred frame would
			// pop with the stack in exactly the state it is in now: same call, same
			// place in the sequence, one frame and one dispatch fewer. Most of a
			// large first screen is leaves — every `#text` host is one — so this is
			// the difference between one frame per host and one per interior host.
			//
			// A `<list>` is excluded rather than tested for rows: it queues its row
			// publication behind its attach, and that frame must still pop first
			// even when the tree gave it nothing to publish.
			if (parentId === null) state.ownedPageRoots.add(papiNode);
			append(physicalParent, papiNode);
			return;
		}
		// The attach is queued before the children so it pops after them.
		stack.push({
			node: null,
			papiNode,
			listRecord: null,
			denseSpan: null,
			parentRecord: null,
			parentId,
			physicalParent,
			parentVisible,
			insideList: false,
		});
		if (type === 'list') {
			// Queued after the attach and before the children, so it pops between
			// them: every row is a record by then, and the list still publishes them
			// before it joins the page, which is the order the staged path produces.
			stack.push({
				node: null,
				papiNode: null,
				listRecord: record,
				denseSpan: null,
				parentRecord: null,
				parentId,
				physicalParent,
				parentVisible,
				insideList: false,
			});
			// A row owns no element, and neither does anything under it, so the
			// physical parent handed down is never used. The list is passed anyway
			// rather than something arbitrary, so a future reader of this frame sees
			// the truthful parent.
			pushChildren(node, record, node.id, papiNode, visible, true);
			return;
		}
		pushChildren(node, record, node.id, papiNode, visible, false);
	};
	state.applying = true;
	try {
		let applicationError: unknown = null;
		try {
			for (let index = roots.length - 1; index >= 0; index--) {
				stack.push({
					node: roots[index]!,
					papiNode: null,
					listRecord: null,
					denseSpan: null,
					parentRecord: null,
					parentId: null,
					physicalParent: container.page as Node,
					parentVisible: true,
					insideList: false,
				});
			}
			while (stack.length !== 0) visit(stack.pop()!);
			state.acceptedVersion = envelope.version;
		} catch (error) {
			applicationError = error;
		}
		// Mirror the staged applier's fault discipline: the flush obligation
		// survives a mid-walk fault (terminal disposal retries it), and directly
		// installed main-thread worklets must be invalidated before any native
		// callback can fire against a faulted container.
		try {
			papi.flush(container.page as Node);
			state.cleanupNeedsFlush = false;
		} catch (error) {
			state.cleanupNeedsFlush = true;
			if (applicationError === null) applicationError = error;
		}
		if (applicationError !== null) {
			state.faulted = true;
			invalidateMainThreadLifetimesAfterFault(state);
			throw applicationError;
		}
	} finally {
		state.applying = false;
	}
	return true;
}

export function captureLynxFirstTree<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	options: CaptureLynxFirstTreeOptions = {},
): LynxFirstTree<Node> | null {
	const state = container[LYNX_HOST_STATE];
	if (state.disposed || state.disposing || state.faulted || state.applying) {
		throw hostError('first tree can only be captured from a stable accepted root.');
	}
	if (state.firstTree !== null) throw hostError('the root already owns a first-tree journal.');
	if (state.acceptedVersion === 0)
		throw hostError('cannot capture a first tree before a batch is accepted.');
	if (
		options.plan !== undefined &&
		(typeof options.plan !== 'string' || options.plan.length === 0)
	) {
		throw hostError('first-tree plan must be a non-empty string when provided.');
	}
	for (const list of state.lists.values()) {
		// A cell the platform already materialized is a physical subtree keyed by a
		// native sign, and nothing here can establish that it survives the window
		// between capture and adoption without a device to observe. Carry the shape a
		// first screen actually has — the `<list>` painted, every row still logical —
		// and decline the rest exactly as this did before.
		if (list.cellsBySign.size !== 0) return null;
	}
	if (state.portalChildren.size !== 0) {
		throw hostError('portals cannot be captured before background adoption.');
	}
	// The token index a tap resolves through is built from these two, on first
	// read, rather than assembled here. Growing a token-keyed map of every bound
	// event is the largest single item this walk spends its time on, and the only
	// thing that reads it is a tap on the painted tree — which cannot happen
	// before the paint this walk is standing in front of. Appending the token and
	// the event capture already made costs one array slot each; the map they
	// index into costs a hash and a rehash per entry, and waits.
	const boundTokens: string[] = [];
	const boundEvents: LynxFirstTreeEventSnapshot[] = [];
	// Capture validates eagerly and describes lazily. Validation and the native
	// ID read stay here because a host that cannot be captured has to fault the
	// synchronous first screen, while its caller still holds the source to retry
	// cleanup against. Turning the validated result into the clone-safe
	// description is what waits: capture runs after the page is already published
	// to the host, so every allocation it makes sits between the tree reaching
	// the DOM and the browser painting it, and nothing before background adoption
	// reads the description.
	const described: {
		readonly id: number;
		readonly nativeId: number;
		readonly parent: number | null;
		readonly record: LynxHostRecord<Node>;
		readonly events: readonly LynxFirstTreeEventSnapshot[];
	}[] = [];
	// Logical rows stay eager. They are the half the ownership equality below
	// counts, and a first screen holds one `<list>` rather than one per host, so
	// there is no per-row allocation here to move off the paint path.
	const logicalNodes = new Map<number, LynxFirstTreeLogicalNodeSnapshot>();
	const cloneState: FirstTreeSnapshotCloneState = { active: new Set(), clones: new Map() };
	// Everything beneath a native `<list>`. The list host is painted; its rows are
	// records the platform has not asked for yet, and so are their descendants.
	// Walked from the list rather than inferred from a null node, so that a
	// missing node anywhere else stays the fault it has always been.
	const insideList = new Set<number>();
	for (const hostId of state.lists.keys()) {
		const pending = [...(state.records.get(hostId)?.children ?? [])];
		while (pending.length !== 0) {
			const id = pending.pop()!;
			if (insideList.has(id)) continue;
			insideList.add(id);
			const record = state.records.get(id);
			if (record !== undefined) pending.push(...record.children);
		}
	}
	const ids = [...state.records.keys()].sort((first, second) => first - second);
	for (const id of ids) {
		const record = state.records.get(id)!;
		const node = record.node;
		if (record.parent === undefined || (node === null && !insideList.has(id))) {
			throw hostError(`first-tree host ${id} must own an attached physical node.`);
		}
		if (node !== null && insideList.has(id)) {
			throw hostError(`first-tree list row ${id} was materialized before capture.`);
		}
		if (isPortalParent(record.parent)) {
			throw hostError('portals cannot be captured before background adoption.');
		}
		if (node !== null && !state.ownedNodes.has(node)) {
			throw hostError(`first-tree host ${id} is missing from the physical ownership journal.`);
		}
		let nativeId = 0;
		if (node !== null) {
			nativeId = state.papi.getUniqueId(node);
			assertSafeId(nativeId, `first-tree host ${id} native ID`);
		}
		// Most records on a large page bind nothing: in the benchmark fixture two
		// of every seven hosts carry an event and the rest carry none. Sorting the
		// spread of an empty map, into an array that stays empty, is three
		// allocations apiece for a result that is always the same empty list.
		let events: readonly LynxFirstTreeEventSnapshot[] = EMPTY_FIRST_TREE_EVENTS;
		if (record.events.size !== 0) {
			const bound: LynxFirstTreeEventSnapshot[] = [];
			// A one-entry sequence is already in sorted order, and most records that
			// bind anything bind exactly one thing, so the common case is two
			// allocations and a comparison sort to reproduce the order it had.
			const eventEntries =
				record.events.size === 1
					? record.events
					: [...record.events].sort(([first], [second]) =>
							first < second ? -1 : first > second ? 1 : 0,
						);
			for (const [type, descriptor] of eventEntries) {
				const event = Object.freeze({
					host: id,
					generation: record.handle.generation,
					type,
					listener: descriptor.id,
					priority: descriptor.priority,
				});
				bound.push(event);
				// An unmaterialized row installs its listeners when its cell is
				// created, so there is no registration to reconcile against yet.
				if (node === null) continue;
				const registration = state.nativeEvents.get(node)?.get(type);
				if (record.visible) {
					if (registration?.source !== 'background') {
						throw hostError(
							`first-tree host ${id} is missing native event ${JSON.stringify(type)}.`,
						);
					}
					boundTokens.push(registration.listener);
					boundEvents.push(event);
				} else if (registration !== undefined) {
					throw hostError(
						`hidden first-tree host ${id} retains native event ${JSON.stringify(type)}.`,
					);
				}
			}
			events = Object.freeze(bound);
		}
		if (node === null) {
			logicalNodes.set(
				id,
				Object.freeze({
					id,
					nativeId: null,
					type: record.type,
					generation: record.handle.generation,
					parent: record.parent,
					children: snapshotFirstTreeChildren(record.children),
					props: snapshotFirstTreeProps(record.props, cloneState),
					visible: record.visible,
					events,
				}),
			);
			continue;
		}
		// Planning a whole prop patch per record, only to read back which
		// main-thread bindings that record expects, is the per-node capture cost
		// issue #62 names. Two facts remove nearly all of it without weakening
		// what is asserted.
		//
		// `state.hasMainThreadProps` is sticky, and every path that accepts props
		// — `create`, `recreate`, `update`, and the direct first-screen walk —
		// sets it from exactly this predicate, so a false value proves no record
		// under this root can expect a main-thread event or ref. And an unscoped
		// raw `#text` record's props are a string `value` and nothing else, which
		// `assertTextProps` enforces at the boundary and both appliers already act
		// on by substituting a constant patch rather than planning one.
		//
		// The ref comparison below still runs for every record, because it asserts
		// the *absence* of an unexpected ref rather than the presence of an
		// expected one, and skipping it would stop checking anything.
		//
		// Upstream's own sweep of this walk reached the same conclusion one record
		// at a time (issue #227): a host that declares no `main-thread:` prop can
		// own neither a main-thread event nor a main-thread ref, so planning it
		// rediscovers an empty answer. The two facts compose rather than replace
		// each other. The sticky flag is the cheaper test and skips the whole page
		// when nothing on it is main-thread-owned; the per-record predicate is what
		// still pays on a page where one host declares such a prop and the rest do
		// not, which the sticky flag alone cannot distinguish.
		const mainThreadPatch =
			state.hasMainThreadProps &&
			!(record.type === '#text' && record.props[LYNX_CSS_SCOPE_PROP] == null) &&
			hasLynxMainThreadProp(record.props)
				? planLynxHostPropPatch(record.type, EMPTY_HOST_PROPS, record.props)
				: null;
		if (mainThreadPatch !== null) {
			for (const event of mainThreadPatch.mainThreadEvents) {
				if (event.value === null) continue;
				const registration = state.nativeEvents.get(node)?.get(event.binding.prop);
				if (
					record.visible &&
					(registration?.source !== 'main-thread' ||
						!sameSnapshotValue(registration.descriptor, event.value))
				) {
					throw hostError(
						`first-tree host ${id} is missing main-thread event ${JSON.stringify(event.binding.prop)}.`,
					);
				}
				if (!record.visible && registration !== undefined) {
					throw hostError(
						`hidden first-tree host ${id} retains main-thread event ${JSON.stringify(event.binding.prop)}.`,
					);
				}
			}
		}
		const expectedRef = mainThreadPatch?.mainThreadRef?.value ?? null;
		const mountedRef = state.mainThreadRefs.get(node) ?? null;
		if (
			(record.visible && !sameSnapshotValue(expectedRef, mountedRef)) ||
			(!record.visible && mountedRef !== null)
		) {
			throw hostError(`first-tree host ${id} has inconsistent main-thread ref ownership.`);
		}
		described.push({ id, nativeId, parent: record.parent, record, events });
	}
	// Still an equality, not a bound: every node in the physical ownership journal
	// is accounted for exactly once, by its record or by the logical map, so an
	// untracked node cannot hide here and neither can an unmaterialized row.
	//
	// Two populations now, where this counted three. A compiled main-thread
	// program's nodes used to be in `ownedNodes` *and* in a per-ID map, and the
	// third term counted the same population back out of the right-hand side —
	// which is why it appeared on both sides and cancelled. Its one job was
	// catching a mount that wrote one of those journals and not the other, and
	// C20 removed that possibility rather than the check: a program is one entry
	// in one journal, pushed after every check the mount makes, so there is no
	// longer a second write to disagree with. What remains is the count, which
	// the first-tree journal carries so adoption's own equality can use it.
	let programNodes = 0;
	for (const run of state.programRuns) programNodes += run.owned;
	if (state.ownedNodes.size !== state.records.size - logicalNodes.size) {
		throw hostError('first-tree physical ownership contains untracked nodes.');
	}
	if (state.ownedPageRoots.size !== state.rootChildren.length) {
		throw hostError('first-tree page-root ownership does not match logical roots.');
	}
	// Both sequences ascend — roots are pushed by the walk in numbering order,
	// and runs are pushed by mounts in the same pre-order — so a single cursor
	// into the runs resolves every root in one combined pass instead of one
	// scan per root, which on a page of thirty thousand top-level program rows
	// is the difference between a capture and a hang.
	let runAt = 0;
	for (const id of state.rootChildren) {
		// A program's root has no record, so its node comes from the run the mount
		// kept — the same substitution adoption makes, for the same reason. Only a
		// program's *first* node is ever a logical root: the mount pushes `ids[0]`
		// and nothing else, and a keyed range's members sit inside a node the
		// program made rather than beside it. So this looks at first ids only, and
		// needs no per-ID view of a journal nothing else here reads by ID.
		//
		// `firstId` rather than `ids[0]`: the same number for a run holding one
		// instance, and the only one a dense run has. A dense run never holds a
		// page root — its instances are keyed range members, and a member has a
		// parent by construction — so this is a shape the cursor walks past
		// rather than one it has to resolve.
		while (runAt < state.programRuns.length && state.programRuns[runAt]!.firstId < id) runAt++;
		const run = runAt < state.programRuns.length ? state.programRuns[runAt] : undefined;
		const programRoot =
			run !== undefined && run.firstId === id ? (run.nodes[0] as Node) : undefined;
		const node = programRoot ?? state.records.get(id)?.node;
		if (node === null || node === undefined || !state.ownedPageRoots.has(node)) {
			throw hostError(`first-tree root ${id} is missing from page-root ownership.`);
		}
	}
	// Read now, not from the builder: adoption and terminal cleanup both empty
	// `rootChildren` and move `acceptedVersion` on, and a description that ran
	// after either would describe the container's state rather than the capture's.
	const capturedVersion = state.acceptedVersion;
	const roots = Object.freeze([...state.rootChildren]);
	const describe = (): LynxFirstTreeSnapshot =>
		Object.freeze({
			format: 1,
			renderer: LYNX_RENDERER_ID,
			root: container.root,
			version: capturedVersion,
			plan: options.plan ?? null,
			roots,
			nodes: Object.freeze(
				described.map((entry) =>
					Object.freeze({
						id: entry.id,
						nativeId: entry.nativeId,
						type: entry.record.type,
						generation: entry.record.handle.generation,
						parent: entry.parent,
						children: snapshotFirstTreeChildren(entry.record.children),
						props: snapshotFirstTreeProps(entry.record.props, cloneState),
						visible: entry.record.visible,
						events: entry.events,
					}),
				),
			),
		});
	const lists = new Map<number, LynxFirstTreeListJournal>();
	for (const [hostId, list] of state.lists) {
		lists.set(
			hostId,
			Object.freeze({
				host: hostId,
				items: list.items,
				epoch: listRecyclingEpoch(list),
			}),
		);
	}
	const indexEvents = (): Map<string, LynxResolvedFirstTreeEvent> => {
		const index = new Map<string, LynxResolvedFirstTreeEvent>();
		for (let position = 0; position < boundTokens.length; position++) {
			index.set(boundTokens[position]!, boundEvents[position]!);
		}
		return index;
	};
	const firstTree = createLynxFirstTree<Node>(
		describe,
		container,
		indexEvents,
		logicalNodes,
		lists,
		// Copied, not aliased. The live journal is emptied when the container hands
		// its nodes over or is disposed, and the capture has to keep describing the
		// tree it took after either — the same reason `roots` is copied above. One
		// reference per program, where this used to copy one entry per node.
		[...state.programRuns],
		programNodes,
		state.programRunsDisjoint,
	);
	state.firstTree = firstTree;
	return firstTree;
}

function compareFirstTree<Node extends LynxElementRef>(
	target: LynxHostContainer<Node>,
	batch: UniversalHostBatch,
	firstTree: LynxFirstTree<Node>,
	source: LynxHostContainer<Node>,
	finalIds: ReadonlySet<number>,
	finalRoots: readonly number[],
	getRecord: (id: number) => LynxHostRecord<Node> | undefined,
	operations: readonly LynxApplyOperation<Node>[],
	listUpdates: readonly LynxPreparedListUpdate[],
): LynxFirstTreeMismatchError | null {
	const snapshot = firstTree.snapshot;
	const targetState = target[LYNX_HOST_STATE];
	const sourceState = source[LYNX_HOST_STATE];
	if (snapshot.format !== 1 || snapshot.renderer !== LYNX_RENDERER_ID) {
		return mismatch(
			firstTree,
			'snapshot.format',
			'the snapshot format or renderer is unsupported.',
		);
	}
	if (snapshot.root !== target.root || source.root !== target.root) {
		return mismatch(firstTree, 'snapshot.root', 'the captured and background root IDs differ.');
	}
	if (source.page !== target.page) {
		return mismatch(
			firstTree,
			'snapshot.page',
			'the captured and background page references differ.',
		);
	}
	let sourceHasMainThreadEvents = false;
	for (const events of sourceState.nativeEvents.values()) {
		if ([...events.values()].some((registration) => registration.source === 'main-thread')) {
			sourceHasMainThreadEvents = true;
			break;
		}
	}
	if (
		(sourceHasMainThreadEvents || sourceState.mainThreadRefs.size !== 0) &&
		sourceState.worklets !== targetState.worklets
	) {
		return mismatch(
			firstTree,
			'snapshot.worklets',
			'the captured and background roots use different main-thread worklet registries.',
		);
	}
	if (snapshot.version !== batch.version || sourceState.acceptedVersion !== snapshot.version) {
		return mismatch(
			firstTree,
			'snapshot.version',
			'the captured and background batch versions differ.',
		);
	}
	if (
		sourceState.disposed ||
		sourceState.disposing ||
		sourceState.faulted ||
		sourceState.applying
	) {
		return mismatch(firstTree, 'snapshot.owner', 'the captured host owner is not stable.');
	}
	// A native list is adoptable, but only against the same list. The main thread
	// already wrote `update-list-info` onto the node being adopted; `listUpdates`
	// is what the background would have written onto a node it created itself.
	// Adoption is sound exactly when those agree, so compare them rather than
	// replaying either.
	//
	// The two checks below state that agreement where adoption relies on it; today
	// they cannot fail alone. Every field of a descriptor comes from a row's `id`,
	// its position among the list's children, and four props, and the walk below
	// compares ids, child order, and props already — more strictly, since an absent
	// `reuse-identifier` and an empty one are one descriptor but two prop sets. A
	// row set that differs at all differs there first. They become load-bearing the
	// moment list metadata stops being a plain prop, or row props stop being
	// compared one-for-one. The epoch check that follows is not in that position:
	// it reads live state no snapshot holds.
	//
	// Not a count comparison: a list with no rows produces no prepared update at
	// all, because there is nothing to insert. An empty feed is an ordinary page,
	// so absence here is agreement, not disagreement.
	const journal = firstTree[LYNX_FIRST_TREE_STATE];
	for (const update of listUpdates) {
		const capturedList = journal.lists.get(update.hostId);
		if (capturedList === undefined) {
			return mismatch(
				firstTree,
				`snapshot.lists[${update.hostId}]`,
				'the background builds a native list the capture does not hold.',
			);
		}
		if (!sameListItems(capturedList.items, update.next)) {
			return mismatch(
				firstTree,
				`snapshot.lists[${update.hostId}].items`,
				'the captured and background list items differ.',
			);
		}
	}
	for (const [hostId, capturedList] of journal.lists) {
		const live = sourceState.lists.get(hostId);
		if (live === undefined || live.disposed) {
			return mismatch(
				firstTree,
				`snapshot.lists[${hostId}]`,
				'the captured native list is no longer live.',
			);
		}
		// Every recycling callback moves this. A list that materialized a cell
		// between capture and adoption holds physical state the captured tree does
		// not describe, so the tree is stale and the page repairs.
		const epoch = listRecyclingEpoch(live);
		if (epoch !== capturedList.epoch) {
			return mismatch(
				firstTree,
				`snapshot.lists[${hostId}].epoch`,
				'the native list materialized cells after capture.',
			);
		}
	}
	for (let index = 0; index < operations.length; index++) {
		const operation = operations[index]!;
		// `ensure-public-instance` is admissible because it neither creates nor
		// mutates a node: it names a host the batch will query. Adoption replays
		// it — alone among the batch's operations — because the unconditional
		// selector stamp at the transfer site only reaches hosts that own a
		// physical node, and a native list row owns none until a cell
		// materializes it.
		if (
			operation.op !== 'create' &&
			operation.op !== 'mount-template' &&
			operation.op !== 'insert' &&
			operation.op !== 'event' &&
			operation.op !== 'visibility' &&
			operation.op !== 'ensure-public-instance'
		) {
			return mismatch(
				firstTree,
				`batch.operations[${index}]`,
				`initial adoption cannot replay a ${operation.op} operation.`,
			);
		}
	}
	// Three populations (issue #163): a compiled main-thread program's hosts are
	// in the background's `finalIds` and in neither the snapshot nor main's
	// records, because a program is compiled so that its subtree is never
	// described. Equalities, still — a program's IDs are counted, not exempted,
	// so a background that described one host too many is a mismatch here rather
	// than a host adopted against nothing.
	//
	// The per-ID view of those hosts is built below rather than at capture, and
	// the count comes from the journal instead of from that map's size, so the
	// two equalities do not force it into existence before the comparison that
	// actually reads it (issue #163 C20).
	if (
		snapshot.nodes.length + journal.logicalNodes.size + journal.programNodeCount !==
			finalIds.size ||
		sourceState.records.size + journal.programNodeCount !== finalIds.size
	) {
		return mismatch(firstTree, 'snapshot.nodes', 'the host counts differ.');
	}
	if (!sameIds(snapshot.roots, finalRoots)) {
		return mismatch(firstTree, 'snapshot.roots', 'the root child order differs.');
	}
	const snapshotsById = new Map<number, LynxFirstTreeCapturedNode>(
		snapshot.nodes.map((node) => [node.id, node]),
	);
	for (const [id, node] of journal.logicalNodes) snapshotsById.set(id, node);
	// Every program node by the ID it took — read out of the runs the mount
	// already wrote, not copied into a table first (issue #215 D1). Nothing is
	// built per node here or at capture; what this allocates is one cursor.
	const programNodes = lynxFirstTreeProgramIndex(firstTree);
	for (const id of [...finalIds].sort((first, second) => first - second)) {
		// Narrowed once and then asked twice: which run could own this ID, then
		// what that run knows about it. The node proves the ID is a program's; the
		// position is what the run's own event table is keyed by (issue #215 D3).
		const programRun = programNodes.runFor(id);
		const programNode = programRun === undefined ? undefined : programRunNode(programRun, id);
		if (programRun !== undefined && programNode !== undefined) {
			// A host a compiled main-thread program painted. There is nothing of
			// main's to compare the background's description against — no snapshot
			// entry and no record, by construction — so this is the one place the
			// inverted handoff is a *narrower* check rather than a differently
			// shaped one, and saying so is better than letting it read as an
			// oversight.
			//
			// What still holds it together: the ID agreement is established at
			// build time, not here. The renderer numbers a program's hosts in the
			// same pre-order the background numbers the same source in, and a
			// differential test pins the two against each other on a real
			// component. What this loop would otherwise re-derive — type, parent,
			// children, props — main never had for these nodes, and inventing a
			// description to compare would rebuild the walk the program exists to
			// delete.
			//
			// So the check is the one main can actually make: the background must
			// describe this ID as a host it expects to own, and the node must still
			// be the one the program painted.
			const next = getRecord(id);
			if (next === undefined) {
				return mismatch(firstTree, `snapshot.nodes[${id}]`, 'the logical host identity differs.');
			}
			if (sourceState.records.has(id)) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}]`,
					'a compiled main-thread program host also holds a record.',
				);
			}
			// What used to sit here — "and this node is in the physical ownership
			// journal" — compared two journals the same loop of the same mount
			// wrote. C20 made a program one entry in one journal, so `programNode`
			// *is* the ownership journal's answer and the comparison has nothing
			// left to disagree with. The check is gone because its failure mode is,
			// not because it stopped mattering.
			//
			// Visibility is the other half main does know, by construction rather
			// than by record: the direct applier refuses a hidden program before
			// painting anything, so every node a program painted is visible and
			// carries no `hidden` attribute. A description that calls one of them
			// hidden therefore disagrees with the painted page — adopting it would
			// keep content on screen that the accepted tree says is hidden, while
			// event routing drops its taps as hidden. Nothing red, which is
			// exactly the class of near-miss this comparator refuses.
			if (!next.visible) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}].visible`,
					'the visibility state differs.',
				);
			}
			// Events are the exception to all of that, and worth taking. Main does
			// know what it bound here: the mount installed a token per site the
			// renderer announced, and journalled it. So the background's record
			// must declare exactly those events, each naming the listener and
			// priority that produced the token already sitting on the node.
			//
			// That is what stops this branch from being "a record exists". Two
			// components agreeing on host count and IDs would otherwise adopt
			// against each other and route taps to handlers the page never wired
			// there — silently, because the tree is never compared. The count and
			// the per-type lookup are what catch that, and they are two halves: a
			// host declaring an event main never installed fails the lookup, and a
			// host that lost one fails the count.
			//
			// The identity comparison below is a narrower claim, and a different
			// one. Listener IDs are handed out in announcement order, so a
			// description agreeing about every host's event types agrees about its
			// IDs too — no *component* can reach it. What it refuses is the two
			// threads disagreeing about what a token names, which is the same
			// thing the physical-identity and generation checks refuse for an
			// ordinary host and is equally unreachable from a well-formed pair.
			//
			// Asked of the run rather than of a per-node map, because the run is
			// where the mount's answer already was (issue #215 D3). Two properties
			// the map carried are now structural rather than checked: an entry
			// exists only where a token was installed, and its source is
			// `background` because a run holds nothing else — nothing outside the
			// mount writes into one, and every path that could install a
			// main-thread listener on these nodes is reached through a record,
			// which a program host has none of until hand-over builds one.
			//
			// `position` is `-1` for a hole the program painted as text. Such a
			// node binds nothing — a site names an emitted node, never a range —
			// so the count is zero and the background must describe it that way,
			// which is the same answer the empty map gave.
			const position = programRunPosition(programRun, id);
			if (programRunEventCount(programRun, position) !== next.events.size) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}].events`,
					'the event binding count differs.',
				);
			}
			for (const [type, descriptor] of next.events) {
				const listener = programRunEventToken(programRun, position, type);
				if (listener === undefined) {
					return mismatch(firstTree, `snapshot.nodes[${id}].events`, 'the event binding differs.');
				}
				// Decoded rather than re-encoded: the token is one main wrote with
				// the checking encoder, so reading it back cannot fault, while
				// building a token out of background-supplied numbers could — and a
				// comparator that throws faults a page whose answer is `repair`.
				const identity = decodeLynxNativeEventToken(listener);
				if (
					identity.id !== id ||
					identity.generation !== next.handle.generation ||
					identity.listener !== descriptor.id ||
					identity.priority !== descriptor.priority
				) {
					return mismatch(firstTree, `snapshot.nodes[${id}].events`, 'the event binding differs.');
				}
			}
			continue;
		}
		const captured = snapshotsById.get(id);
		const next = getRecord(id);
		const sourceRecord = sourceState.records.get(id);
		if (captured === undefined || next === undefined || sourceRecord === undefined) {
			return mismatch(firstTree, `snapshot.nodes[${id}]`, 'the logical host identity differs.');
		}
		if (captured.type !== next.type || sourceRecord.type !== captured.type) {
			return mismatch(firstTree, `snapshot.nodes[${id}].type`, 'the host type differs.');
		}
		if (
			captured.generation !== next.handle.generation ||
			sourceRecord.handle.generation !== captured.generation
		) {
			return mismatch(
				firstTree,
				`snapshot.nodes[${id}].generation`,
				'the host generation differs.',
			);
		}
		if (captured.parent !== next.parent || sourceRecord.parent !== captured.parent) {
			return mismatch(firstTree, `snapshot.nodes[${id}].parent`, 'the host parent differs.');
		}
		if (
			!sameIds(captured.children, next.children) ||
			!sameIds(captured.children, sourceRecord.children)
		) {
			return mismatch(firstTree, `snapshot.nodes[${id}].children`, 'the child order differs.');
		}
		if (captured.visible !== next.visible || sourceRecord.visible !== captured.visible) {
			return mismatch(firstTree, `snapshot.nodes[${id}].visible`, 'the visibility state differs.');
		}
		if (
			!sameAdoptableSnapshotValue(captured.props, next.props) ||
			!sameSnapshotValue(captured.props, sourceRecord.props)
		) {
			return mismatch(firstTree, `snapshot.nodes[${id}].props`, 'the host props differ.');
		}
		// A native list row was captured without an element, because the platform
		// had not asked for one. There is no physical identity or parentage to
		// compare — the cell that materializes it later establishes both — but the
		// row must still be unpainted now, or the capture describes a tree that has
		// moved on.
		if (captured.nativeId === null) {
			if (sourceRecord.node !== null) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}].nativeId`,
					'a captured native list row was materialized after capture.',
				);
			}
		} else {
			if (
				sourceRecord.node === null ||
				sourceState.papi.getUniqueId(sourceRecord.node) !== captured.nativeId
			) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}].nativeId`,
					'the physical node identity changed.',
				);
			}
			// The parent may be a host a compiled main-thread program painted, and
			// those hold no record — a keyed range's members are materialized by
			// the renderer into a node the program made, so an ordinary described
			// host sits under an undescribed one (issue #163). Resolving only
			// through records would read that as "the physical parent changed" and
			// repaint a page whose parentage is exactly what was captured.
			const physicalParent =
				captured.parent === null
					? source.page
					: (programNodes.get(captured.parent) ?? sourceState.records.get(captured.parent)?.node);
			if (physicalParent == null || !sourceState.papi.isChild(physicalParent, sourceRecord.node)) {
				return mismatch(firstTree, `snapshot.nodes[${id}].parent`, 'the physical parent changed.');
			}
		}
		const nextEvents = [...next.events].sort(([first], [second]) =>
			first < second ? -1 : first > second ? 1 : 0,
		);
		const sourceEvents = [...sourceRecord.events].sort(([first], [second]) =>
			first < second ? -1 : first > second ? 1 : 0,
		);
		if (
			captured.events.length !== nextEvents.length ||
			captured.events.length !== sourceEvents.length
		) {
			return mismatch(
				firstTree,
				`snapshot.nodes[${id}].events`,
				'the event binding count differs.',
			);
		}
		for (let index = 0; index < captured.events.length; index++) {
			const event = captured.events[index]!;
			const nextEntry = nextEvents[index]!;
			const sourceEntry = sourceEvents[index]!;
			if (
				event.host !== id ||
				event.generation !== captured.generation ||
				event.type !== nextEntry[0] ||
				event.type !== sourceEntry[0] ||
				event.priority !== nextEntry[1].priority ||
				event.listener !== sourceEntry[1].id ||
				event.priority !== sourceEntry[1].priority
			) {
				return mismatch(
					firstTree,
					`snapshot.nodes[${id}].events[${index}]`,
					'the event binding differs.',
				);
			}
		}
	}
	return null;
}

function transferFirstTree<Node extends LynxElementRef>(
	target: LynxHostContainer<Node>,
	firstTree: LynxFirstTree<Node>,
	source: LynxHostContainer<Node>,
	activeNodes: Map<number, Node>,
): void {
	const targetState = target[LYNX_HOST_STATE];
	const sourceState = source[LYNX_HOST_STATE];
	const journal = firstTree[LYNX_FIRST_TREE_STATE];
	// A second cursor over the same runs, not a second table: the comparison that
	// licensed this transfer built nothing for this one to reuse (issue #215 D1),
	// and the two walks reach the IDs in different orders anyway.
	const programNodes = lynxFirstTreeProgramIndex(firstTree);
	for (const [id, targetRecord] of targetState.records) {
		const sourceRecord = sourceState.records.get(id);
		// A native list row was never painted, so there is nothing to move. It
		// stays a record with no node, and the list's callbacks give it one when
		// the platform asks — the same way it would on a root that never adopted.
		if (journal.logicalNodes.has(id)) {
			if (sourceRecord?.node != null) {
				throw hostError(`captured first-tree list row ${id} gained a physical node.`);
			}
			continue;
		}
		// A host a compiled main-thread program painted has no record to take a
		// node from — that is what a program is (issue #163) — so the run the mount
		// kept is where its node comes from. Everything after this point is
		// identical for both, which is the point: adoption moves a node, and where
		// main remembered it does not change what moving it means.
		const programRun = programNodes.runFor(id);
		const programNode = programRun === undefined ? undefined : programRunNode(programRun, id);
		const node = programNode ?? sourceRecord?.node ?? null;
		if (node === null) {
			throw hostError(`captured first-tree host ${id} lost its physical node.`);
		}
		targetRecord.node = node;
		activeNodes.set(id, node);
		targetState.ownedNodes.add(node);
		if (targetRecord.parent === null) targetState.ownedPageRoots.add(node);
		if (programRun !== undefined && programNode !== undefined) {
			// This is where a program's listeners become ordinary ones. The mount
			// wrote no per-node journal for them (issue #215 D3), and from here the
			// background installs and removes on these nodes through exactly that
			// journal — so the entry is built now, once, straight into the target.
			// Building it in the source first and copying it here is the same two
			// writes into a 30,000-entry map that the mount stopped making.
			const events = programNodeEvents(programRun, programRunPosition(programRun, id));
			if (events !== undefined) targetState.nativeEvents.set(node, events);
		} else {
			const nativeEvents = sourceState.nativeEvents.get(node);
			if (nativeEvents !== undefined) targetState.nativeEvents.set(node, nativeEvents);
		}
		const mainThreadRef = sourceState.mainThreadRefs.get(node);
		if (mainThreadRef !== undefined) {
			targetState.mainThreadRefs.set(node, mainThreadRef);
			targetState.mainThreadRefOwners.set(mainThreadRef._wvid, node);
		}
	}

	// Native lists move whole. Their cells, pools, signs and recycling counters
	// are main-local bookkeeping that never crossed the wire, so adoption carries
	// the state itself rather than rebuilding it. What cannot come along is the
	// callback trio the platform holds: those close over the source, and would
	// materialize cells into a container this function is about to empty. Rebind
	// them against the target and hand the replacements over through the same
	// `updateCallbacks` seam `applyListUpdate` uses.
	//
	// Nothing above or below calls the Element PAPI before that rebind lands, so
	// no native callback can interleave with the move. Adding a `flush`, an
	// `insertBefore` or a `setAttribute` here would open that window.
	if (sourceState.lists.size !== 0) {
		const listPAPI = targetState.papi.list;
		if (listPAPI === undefined) {
			throw hostError('<list> requires __CreateList and __UpdateListCallbacks.');
		}
		for (const [hostId, list] of sourceState.lists) {
			let moved: LynxNativeListState<Node> | undefined;
			const rebound = bindNativeListCallbacks<Node>(targetState, target, () => moved);
			moved = { ...list, ...rebound };
			targetState.lists.set(hostId, moved);
			listPAPI.updateCallbacks(
				list.node,
				rebound.componentAtIndex,
				rebound.enqueueComponent,
				rebound.componentAtIndexes,
			);
		}
		sourceState.lists.clear();
	}

	// From this point the background journal is the only disposal authority.
	// Carry every native placeholder registration into that journal before the
	// background tokens below replace them. If selector/event installation faults
	// partway through adoption, terminal cleanup must still clear registrations on
	// nodes the replacement loop did not reach.
	sourceState.ownedNodes.clear();
	sourceState.ownedPageRoots.clear();
	clearProgramRuns(sourceState);
	sourceState.nativeEvents.clear();
	sourceState.mainThreadRefs.clear();
	sourceState.mainThreadRefOwners.clear();
	sourceState.records.clear();
	sourceState.teardownRecords = null;
	sourceState.deferredRuns = null;
	sourceState.rootChildren.length = 0;
	sourceState.generations.clear();
	sourceState.portalRoot = null;
	sourceState.portalChildren.clear();
	sourceState.firstTree = null;
	sourceState.cleanupNeedsFlush = false;
	sourceState.disposing = false;
	sourceState.disposed = true;
	journal.owner = null;
	journal.status = 'transferred';
}

function prepareDenseTeardown<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	batch: UniversalHostBatch,
	state: LynxHostState<Node>,
	plan: LynxDenseTeardownPlan<Node>,
	run: { firstId: number; hostCount: number } | null = null,
): LynxPreparedHostBatch {
	const baseVersion = state.acceptedVersion;
	const emptyListAncestryDelta = Object.freeze([]) as readonly LynxHostListAncestryDelta[];
	let handleDelta: readonly LynxHostHandleDelta[] | null = null;
	let status: 'prepared' | 'applying' | 'applied' | 'aborted' | 'faulted' = 'prepared';
	let mutationStarted = false;
	let fault: unknown;
	const uniformRun = run !== null && plan.store.hostGenerations === null;
	const materializeHandleDelta = (): readonly LynxHostHandleDelta[] => {
		if (handleDelta !== null) return handleDelta;
		if (uniformRun) {
			// The whole run retires at its uniform implicit generation: one
			// range delta replaces one frozen object per destroyed host.
			handleDelta = Object.freeze([
				Object.freeze({
					op: 'destroy-run' as const,
					renderer: LYNX_RENDERER_ID,
					root: container.root,
					firstId: run.firstId,
					hostCount: run.hostCount,
					generation: 1,
				}),
			]);
			return handleDelta;
		}
		const deltas: LynxHostHandleDelta[] = new Array(plan.hostCount);
		for (let offset = 0; offset < plan.hostCount; offset++) {
			const command = batch.commands[plan.eventCommands + plan.store.count + offset]!;
			if (command.op !== 'destroy') throw hostError('certified teardown order changed.');
			deltas[offset] = Object.freeze({
				op: 'destroy',
				renderer: LYNX_RENDERER_ID,
				root: container.root,
				id: command.id,
				generation: plan.store.generationAt(command.id - plan.firstId),
			});
		}
		handleDelta = Object.freeze(deltas);
		return handleDelta;
	};
	const prepared: LynxPreparedHostBatch = {
		get mutationStarted() {
			return mutationStarted;
		},
		get handleDelta() {
			return materializeHandleDelta();
		},
		listAncestryDelta: emptyListAncestryDelta,
		firstTreeAction: 'none',
		apply() {
			if (status === 'aborted' || status === 'applied') return;
			if (status === 'faulted') throw fault;
			if (status !== 'prepared') return;
			if (state.disposed || state.disposing) {
				throw hostError('cannot apply a batch while root cleanup is pending.');
			}
			if (state.firstTree !== null) {
				throw hostError('a captured first-tree root cannot apply a prepared batch.');
			}
			if (state.acceptedVersion !== baseVersion) {
				throw hostError(
					`prepared batch ${batch.version} was superseded by version ${state.acceptedVersion}.`,
				);
			}
			status = 'applying';
			state.applying = true;
			try {
				mutationStarted = true;
				state.records = plan.records;
				state.teardownRecords = null;
				state.rootChildren = plan.rootChildren;
				if (uniformRun) {
					// One sorted range replaces one tombstone per retired host.
					const last = run!.firstId + run!.hostCount - 1;
					const ranges = state.retiredRanges;
					const previous = ranges[ranges.length - 1];
					if (previous === undefined || run!.firstId > previous[1]) {
						ranges.push([run!.firstId, last]);
					} else {
						ranges.push([run!.firstId, last]);
						ranges.sort((a, b) => a[0] - b[0]);
					}
				} else {
					for (let offset = 0; offset < plan.hostCount; offset++) {
						const id = plan.firstId + offset;
						if (!state.generations.has(id)) state.generations.set(id, 1);
					}
				}
				if (plan.firstId + plan.hostCount - 1 > state.maxExplicitId) {
					state.maxExplicitId = plan.firstId + plan.hostCount - 1;
				}
				if (state.implicitInitialGenerations) {
					// The dense segment was the only supplier of implicit
					// generation-one entries. Its hosts now carry explicit
					// tombstones, so if every surviving record's generation is
					// also stored, the container is back on fully explicit
					// bookkeeping and the next pure template mount may
					// negotiate an incremental compact acknowledgement again
					// instead of republishing every host.
					let explicit = true;
					for (const id of plan.records.keys()) {
						if (!state.generations.has(id)) {
							explicit = false;
							break;
						}
					}
					if (explicit) state.implicitInitialGenerations = false;
				}
				state.acceptedVersion = batch.version;
				let applicationFailed = false;
				let applicationError: unknown;
				try {
					if (!plan.direct) {
						const startedEventDetach = LYNX_PROFILE && run !== null ? performance.now() : 0;
						let completedEventDetaches = 0;
						try {
							for (let index = 0; index < plan.eventCommands; index++) {
								const command = batch.commands[index]!;
								if (command.op !== 'event') {
									throw hostError('certified teardown event changed.');
								}
								const node = plan.store.nodes[command.id - plan.firstId];
								if (node === undefined) throw hostError('certified teardown node changed.');
								removeNativeEvent(state, node, command.type, state.lists.size === 0);
								if (LYNX_PROFILE && run !== null) completedEventDetaches++;
							}
						} finally {
							if (LYNX_PROFILE && run !== null) {
								const profile = lynxWireProfile();
								profile.eventDetachMs += performance.now() - startedEventDetach;
								profile.eventDetachCount += completedEventDetaches;
							}
						}
					}
					const parent =
						plan.parent === null ? container.page : plan.records.get(plan.parent)!.node!;
					const width = plan.store.program.shape.types.length;
					const startedPapiRemove = LYNX_PROFILE && run !== null ? performance.now() : 0;
					let completedPapiRemovals = 0;
					try {
						if (!plan.direct) {
							for (const id of plan.acceptedChildren) {
								const offset = id - plan.firstId;
								if (offset < 0 || offset >= plan.hostCount || offset % width !== 0) continue;
								const node = plan.store.nodes[offset]!;
								state.papi.remove(parent, node);
								if (LYNX_PROFILE && run !== null) completedPapiRemovals++;
							}
						} else {
							const remove = state.papi.remove;
							const nodes = plan.store.nodes;
							for (let offset = 0; offset < plan.hostCount; offset += width) {
								remove(parent, nodes[offset]!);
								if (LYNX_PROFILE && run !== null) completedPapiRemovals++;
							}
						}
					} finally {
						if (LYNX_PROFILE && run !== null) {
							const profile = lynxWireProfile();
							profile.papiRemoveMs += performance.now() - startedPapiRemove;
							profile.papiRemoveCount += completedPapiRemovals;
						}
					}
					if (plan.direct) {
						const startedEventRelease = LYNX_PROFILE && run !== null ? performance.now() : 0;
						try {
							// A certified direct run owns every removed subtree. Native event lifetime
							// therefore ends with structural removal; release Octane's journal only
							// after every root removal succeeds so a fault remains fully disposable.
							const survivingEvents: Array<
								readonly [Node, Map<string, LynxNativeEventRegistration>]
							> = [];
							for (const record of plan.records.values()) {
								const node = record.node!;
								const events = state.nativeEvents.get(node);
								if (events !== undefined) survivingEvents.push([node, events]);
							}
							state.nativeEvents.clear();
							for (const [node, events] of survivingEvents) state.nativeEvents.set(node, events);
						} finally {
							if (LYNX_PROFILE && run !== null) {
								lynxWireProfile().eventDetachMs += performance.now() - startedEventRelease;
							}
						}
					}
					const startedDenseRelease = LYNX_PROFILE && run !== null ? performance.now() : 0;
					try {
						state.ownedNodes.clear();
						for (const record of plan.records.values()) state.ownedNodes.add(record.node!);
						if (plan.parent === null) {
							state.ownedPageRoots.clear();
							for (const record of plan.records.values()) {
								if (record.parent === null) state.ownedPageRoots.add(record.node!);
							}
						}
						plan.store.clear();
						if (LYNX_PROFILE && run !== null) {
							lynxWireProfile().denseReleaseHostCount += plan.hostCount;
						}
					} finally {
						if (LYNX_PROFILE && run !== null) {
							lynxWireProfile().denseReleaseMs += performance.now() - startedDenseRelease;
						}
					}
				} catch (error) {
					applicationFailed = true;
					applicationError = error;
				}
				try {
					state.papi.flush(container.page);
					state.cleanupNeedsFlush = false;
				} catch (error) {
					state.cleanupNeedsFlush = true;
					if (!applicationFailed) {
						applicationFailed = true;
						applicationError = error;
					}
				}
				if (applicationFailed) throw applicationError;
				status = 'applied';
			} catch (error) {
				state.faulted = true;
				invalidateMainThreadLifetimesAfterFault(state);
				status = 'faulted';
				fault = error;
				throw error;
			} finally {
				state.applying = false;
			}
		},
		abort() {
			if (status === 'prepared') status = 'aborted';
		},
	};
	return Object.freeze(prepared);
}

/**
 * Expand a destroy-run against ordinary accepted records when no dense store
 * covers the range — rows that were reordered, adopted, or mounted through the
 * explicit path. Produces the same event-unbind, remove, and post-order
 * destroy sequence the background would have shipped host by host.
 */
function expandRecordsRunTeardown<Node extends LynxElementRef>(
	state: LynxHostState<Node>,
	command: Extract<UniversalHostCommand, { op: 'destroy-run' }>,
): UniversalHostCommand[] | null {
	const events: UniversalHostCommand[] = [];
	const removes: UniversalHostCommand[] = [];
	const destroys: UniversalHostCommand[] = [];
	for (let row = 0; row < command.count; row++) {
		const rootId = command.firstId + row * command.width;
		const root = state.records.get(rootId);
		if (root === undefined || !Object.is(root.parent, command.parent)) return null;
		let visited = 0;
		const visit = (id: number): boolean => {
			const record = state.records.get(id);
			if (record === undefined) return false;
			visited++;
			for (const child of record.children) {
				if (!visit(child)) return false;
			}
			for (const type of record.events.keys()) {
				events.push({ op: 'event', id, type, listener: null });
			}
			destroys.push({ op: 'destroy', id });
			return true;
		};
		if (!visit(rootId) || visited !== command.width) return null;
		removes.push({ op: 'remove', parent: command.parent, id: rootId });
	}
	// Appended one by one: this fallback exists for exactly the runs too large
	// or too reordered for the certified path, and spreading count × width
	// commands into one call blows the engine argument limit near 130k — a
	// 30k-row teardown is over it.
	for (const command of removes) events.push(command);
	for (const command of destroys) events.push(command);
	return events;
}

export function prepareLynxHostBatch<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	batch: UniversalHostBatch,
	options?: PrepareLynxHostBatchOptions<Node>,
): LynxPreparedHostBatch {
	const state = container[LYNX_HOST_STATE];
	if (state.disposed) throw hostError('cannot prepare a batch for a disposed root.');
	if (state.disposing) throw hostError('cannot prepare a batch while root cleanup is pending.');
	if (state.firstTree !== null) {
		throw hostError('a captured first-tree root cannot accept another batch.');
	}
	if (container.renderer !== LYNX_RENDERER_ID || batch.renderer !== LYNX_RENDERER_ID) {
		throw hostError(
			`renderer mismatch: expected ${JSON.stringify(LYNX_RENDERER_ID)}, received ${JSON.stringify(batch.renderer)}.`,
		);
	}
	assertSafeId(batch.version, 'batch.version');
	if (batch.version <= state.acceptedVersion) {
		throw hostError(
			`stale batch version ${batch.version}; accepted version is ${state.acceptedVersion}.`,
		);
	}
	if (!Array.isArray(batch.commands)) throw hostError('batch.commands must be an array.');
	if (options?.onMismatch !== undefined && typeof options.onMismatch !== 'function') {
		throw hostError('onMismatch must be a function when provided.');
	}
	const firstTree = options?.firstTree;
	let firstTreeSource: LynxHostContainer<Node> | null = null;
	if (firstTree !== undefined) {
		if (
			state.acceptedVersion !== 0 ||
			state.records.size !== 0 ||
			state.generations.size !== 0 ||
			state.ownedNodes.size !== 0 ||
			state.ownedPageRoots.size !== 0 ||
			state.nativeEvents.size !== 0 ||
			state.mainThreadRefs.size !== 0 ||
			state.mainThreadRefOwners.size !== 0 ||
			state.lists.size !== 0 ||
			state.portalRoot !== null ||
			state.portalChildren.size !== 0
		) {
			throw hostError('firstTree may only be prepared against an empty background root.');
		}
		firstTreeSource = firstTreeOwner(firstTree);
		if (firstTreeSource === container) {
			throw hostError('firstTree must be adopted by a different Lynx host container.');
		}
	}
	const logicalTeardown = state.faulted;
	let runExpansion: { firstId: number; hostCount: number } | null = null;
	if (firstTree === undefined) {
		const soleCommand = batch.commands.length === 1 ? batch.commands[0] : undefined;
		if (
			!logicalTeardown &&
			soleCommand !== null &&
			typeof soleCommand === 'object' &&
			soleCommand?.op === 'destroy-run' &&
			state.records instanceof LynxDenseHostRecordStore
		) {
			const startedDenseValidate = LYNX_PROFILE ? performance.now() : 0;
			let directTeardown: LynxDenseTeardownPlan<Node> | null = null;
			try {
				directTeardown = state.records.prepareDirectFullTeardown(state, soleCommand);
			} finally {
				if (LYNX_PROFILE) {
					lynxWireProfile().denseValidateMs += performance.now() - startedDenseValidate;
				}
			}
			if (directTeardown !== null) {
				return prepareDenseTeardown(container, batch, state, directTeardown, {
					firstId: soleCommand.firstId,
					hostCount: soleCommand.count * soleCommand.width,
				});
			}
		}
		const teardownStore =
			state.records instanceof LynxDenseHostRecordStore ? state.records : state.teardownRecords;
		let hasRun = false;
		for (const command of batch.commands) {
			if (command !== null && typeof command === 'object' && command.op === 'destroy-run') {
				hasRun = true;
				break;
			}
		}
		if (hasRun) {
			const sole = batch.commands.length === 1;
			const commands: UniversalHostCommand[] = [];
			for (const command of batch.commands) {
				if (command !== null && typeof command === 'object' && command.op === 'destroy-run') {
					const startedRunExpansion = LYNX_PROFILE ? performance.now() : 0;
					let expanded: UniversalHostCommand[] | null = null;
					try {
						expanded =
							teardownStore?.expandRunTeardown(state, command) ??
							expandRecordsRunTeardown(state, command);
					} finally {
						if (LYNX_PROFILE) {
							lynxWireProfile().destroyRunExpandMs += performance.now() - startedRunExpansion;
						}
					}
					if (expanded === null) {
						throw hostError('destroy-run does not match an accepted template run.');
					}
					if (LYNX_PROFILE) lynxWireProfile().synthesizedCommands += expanded.length;
					for (const entry of expanded) commands.push(entry);
					if (sole && expanded !== null && teardownStore !== null) {
						runExpansion = {
							firstId: command.firstId,
							hostCount: command.count * command.width,
						};
					}
				} else {
					commands.push(command);
				}
			}
			batch = { ...batch, commands };
		}
		if (!logicalTeardown) {
			const startedDenseValidate = LYNX_PROFILE && runExpansion !== null ? performance.now() : 0;
			let denseTeardown: LynxDenseTeardownPlan<Node> | null = null;
			try {
				denseTeardown = teardownStore?.prepareFullTeardown(state, batch) ?? null;
			} finally {
				if (LYNX_PROFILE && runExpansion !== null) {
					lynxWireProfile().denseValidateMs += performance.now() - startedDenseValidate;
				}
			}
			if (denseTeardown !== null) {
				return prepareDenseTeardown(container, batch, state, denseTeardown, runExpansion);
			}
		}
	}
	if (
		logicalTeardown &&
		!batch.commands.every(
			(command) =>
				command !== null &&
				typeof command === 'object' &&
				(command.op === 'remove' ||
					command.op === 'destroy' ||
					(command.op === 'event' && command.listener === null)),
		)
	) {
		throw hostError(
			'after a host fault, only listener removal and remove/destroy teardown commands are accepted.',
		);
	}

	const baseVersion = state.acceptedVersion;
	const initiallyEmpty = state.records.size === 0;
	// Preparation is a hot commit path. Stage only records and generation entries
	// touched by this batch; the accepted maps remain unchanged until apply().
	let stagedRecords: LynxHostRecordStore<Node> = new Map<number, LynxHostRecord<Node>>();
	let acceptedDenseRecords: LynxDenseHostRecordStore<Node> | null = null;
	let acceptedTeardownRecords: LynxDenseHostRecordStore<Node> | null = null;
	const deletedRecords = new Set<number>();
	const stagedGenerations = new Map<number, number>();
	const initiallyNoGenerations = state.generations.size === 0;
	// A commit that announced its hosts proves the peer composes under the
	// negotiated capability, which no later commit can undo.
	if (options?.announcesPublicInstances === true) state.announcesPublicInstances = true;
	const acceptedLazyPublicInstances =
		options?.lazyPublicInstances === true &&
		!initiallyEmpty &&
		firstTree === undefined &&
		!state.hasMainThreadProps &&
		!state.hasNativeListTopology &&
		state.portalRoot === null &&
		state.portalChildren.size === 0 &&
		batch.commands.every(
			(command) =>
				command !== null &&
				typeof command === 'object' &&
				(command.op === 'mount-template-range' || command.op === 'mount-template-run'),
		);
	const incrementalCompactRun =
		batch.commands.length === 1 && batch.commands[0]?.op === 'mount-template-run'
			? batch.commands[0]
			: null;
	const incrementalCompactCandidate =
		options?.compact === true &&
		options.incrementalCompact === true &&
		acceptedLazyPublicInstances &&
		!state.implicitInitialGenerations &&
		state.records instanceof Map &&
		incrementalCompactRun !== null &&
		// Implicit generation-one identities require a provably fresh id range.
		incrementalCompactRun.firstId > state.maxExplicitId;
	const teardownMirrorCandidate =
		options?.compact === true &&
		options.incrementalCompact === true &&
		acceptedLazyPublicInstances &&
		state.records instanceof Map &&
		batch.commands.length === 1 &&
		batch.commands[0]?.op === 'mount-template-run';
	let compactCandidate =
		options?.compact === true &&
		firstTree === undefined &&
		!state.hasMainThreadProps &&
		!state.hasNativeListTopology &&
		((initiallyEmpty && initiallyNoGenerations) || incrementalCompactCandidate);
	let compactCreated = 0;
	let compactInserted = 0;
	let sparseCompactNodes = compactCandidate;
	let sawCompactRange = false;
	let stagedPortalChildren: Map<string, LynxPortalChildren> | null = null;
	const readStagedPortalChildren = (): Map<string, LynxPortalChildren> | null =>
		stagedPortalChildren;
	let stagedPortalRoot = state.portalRoot;
	const initialNodes = new Map<number, Node>();
	let stagedRootChildren: number[] | null = null;
	let stagedRecordCount = state.records.size;
	let hasMainThreadProps = state.hasMainThreadProps;
	let hasNativeListTopology = state.hasNativeListTopology;
	let stagedDeferredRuns: LynxDeferredTemplateRun[] | null = null;
	// One boolean rather than two null checks per lookup: a miss is the common
	// answer on the eager template path, where it is the duplicate-id check.
	let anyDeferredRuns = state.deferredRuns !== null;
	/**
	 * The record a deferred run declares for `id`, without retaining it.
	 *
	 * Preparation must not write accepted state, so a declared host observed
	 * here is derived rather than materialized. A caller that needs the write to
	 * survive goes through `writeRecord`, which stages it like any other.
	 */
	const declaredRecord = (id: number): LynxHostRecord<Node> | undefined => {
		if (!anyDeferredRuns) return undefined;
		const declared = declaringRun(stagedDeferredRuns, id) ?? declaringRun(state.deferredRuns, id);
		return declared === undefined
			? undefined
			: templateRunRecord<Node>(declared.run, declared.offset, getGeneration(id) ?? 1);
	};
	/** Whether a deferred run declares `id`, without deriving its record. */
	const isDeclared = (id: number): boolean =>
		anyDeferredRuns &&
		(declaringRun(stagedDeferredRuns, id) ?? declaringRun(state.deferredRuns, id)) !== undefined;
	/**
	 * Promote a declared host to a staged record, because a caller is about to
	 * write it. A written host is no longer derivable from its run, so this is
	 * where a deferred instance stops being free.
	 */
	const stageDeclared = (id: number): LynxHostRecord<Node> | undefined => {
		const record = declaredRecord(id);
		if (record === undefined) return undefined;
		stagedRecords.set(id, record);
		stagedRecordCount++;
		// Promotion is a creation as far as the generation ledger is concerned:
		// a promoted host must announce its generation so a reuse of the id after
		// its destruction bumps rather than repeats it.
		if (!stagedGenerations.has(id) && !state.generations.has(id)) {
			stagedGenerations.set(id, record.handle.generation);
		}
		return record;
	};
	const getRecord = initiallyEmpty
		? (id: number): LynxHostRecord<Node> | undefined => stagedRecords.get(id) ?? declaredRecord(id)
		: (id: number): LynxHostRecord<Node> | undefined => {
				if (deletedRecords.has(id)) return undefined;
				return stagedRecords.get(id) ?? state.records.get(id) ?? declaredRecord(id);
			};
	const writeRecord = initiallyEmpty
		? (id: number): LynxHostRecord<Node> | undefined => stagedRecords.get(id) ?? stageDeclared(id)
		: (id: number): LynxHostRecord<Node> | undefined => {
				if (deletedRecords.has(id)) return undefined;
				const staged = stagedRecords.get(id);
				if (staged !== undefined) {
					if (acceptedDenseRecords !== null && staged === state.records.get(id)) {
						const clone = cloneRecord(staged);
						stagedRecords.set(id, clone);
						return clone;
					}
					return staged;
				}
				const accepted = state.records.get(id);
				if (accepted === undefined) return stageDeclared(id);
				const clone = cloneRecord(accepted);
				stagedRecords.set(id, clone);
				return clone;
			};
	const deleteRecord = (id: number): void => {
		stagedRecordCount -= 1;
		stagedRecords.delete(id);
		deletedRecords.add(id);
	};
	const rangedGeneration = (id: number): number | undefined =>
		retiredRangeHit(state.retiredRanges, id) ? 1 : undefined;
	const getGeneration = state.implicitInitialGenerations
		? (id: number): number | undefined =>
				stagedGenerations.get(id) ??
				state.generations.get(id) ??
				rangedGeneration(id) ??
				state.records.get(id)?.handle.generation
		: initiallyNoGenerations
			? (id: number): number | undefined => stagedGenerations.get(id) ?? rangedGeneration(id)
			: (id: number): number | undefined =>
					stagedGenerations.get(id) ?? state.generations.get(id) ?? rangedGeneration(id);
	const setGeneration = (id: number, generation: number): void => {
		if (compactCandidate && generation === 1) return;
		stagedGenerations.set(id, generation);
	};
	const rootChildrenForWrite = (): number[] => {
		if (stagedRootChildren === null) stagedRootChildren = [...state.rootChildren];
		return stagedRootChildren;
	};
	const portalChildrenForRead = (parent: LynxPortalParent): readonly number[] =>
		stagedPortalChildren?.get(parent.key)?.children ??
		state.portalChildren.get(parent.key)?.children ??
		[];
	const portalChildrenForWrite = (parent: LynxPortalParent): number[] => {
		let entry = stagedPortalChildren?.get(parent.key);
		if (entry !== undefined) return entry.children;
		const previous = state.portalChildren.get(parent.key);
		if (
			previous !== undefined &&
			(previous.parent.target !== parent.target ||
				previous.parent.generation !== parent.generation ||
				previous.parent.universalRoot !== parent.universalRoot)
		) {
			throw hostError('portal target identity changed without a new target handle.');
		}
		entry = {
			parent,
			children: previous === undefined ? [] : [...previous.children],
		};
		(stagedPortalChildren ??= new Map()).set(parent.key, entry);
		return entry.children;
	};
	const portalChildrenForTarget = (target: number): readonly number[] => {
		const children: number[] = [];
		const keys = new Set(state.portalChildren.keys());
		if (stagedPortalChildren !== null) {
			for (const key of stagedPortalChildren.keys()) keys.add(key);
		}
		for (const key of keys) {
			const entry = stagedPortalChildren?.get(key) ?? state.portalChildren.get(key);
			if (entry?.parent.target === target) children.push(...entry.children);
		}
		return children;
	};
	const recreatedIds = new Set<number>();
	const resolveParent = (
		value: unknown,
		label: string,
		currentParent?: LynxHostParent,
	): LynxAttachedHostParent => {
		if (value === null) return null;
		if (typeof value === 'number') {
			assertSafeId(value, label);
			return value;
		}
		if (
			!isLynxPortalTargetHandle(value) ||
			Object.keys(value).length !== 4 ||
			!['$$kind', 'renderer', 'root', 'id'].every((name) =>
				Object.prototype.hasOwnProperty.call(value, name),
			)
		) {
			throw hostError(`${label} is not a valid Lynx portal target handle.`);
		}
		const handle = value as UniversalPortalTargetHandle;
		const identity = decodeLynxPortalTargetId(handle.id)!;
		if (identity.root !== container.root) {
			throw hostError(`${label} belongs to foreign root ${identity.root}.`);
		}
		if (stagedPortalRoot === null) stagedPortalRoot = handle.root;
		else if (stagedPortalRoot !== handle.root) {
			throw hostError(`${label} belongs to a foreign universal root.`);
		}
		const accepted = state.records.get(identity.id);
		const current = getRecord(identity.id);
		const key = lynxPortalTargetKey(handle);
		const removingFromRecreatedTarget =
			isPortalParent(currentParent) && currentParent.key === key && recreatedIds.has(identity.id);
		if (
			accepted === undefined ||
			current === undefined ||
			accepted.node === null ||
			accepted.handle.root !== container.root ||
			accepted.handle.generation !== identity.generation ||
			(current.handle.generation !== identity.generation && !removingFromRecreatedTarget) ||
			!isRootConnected((id) => state.records.get(id), identity.id)
		) {
			throw hostError(
				`${label} targets stale, detached, or unacknowledged host ${identity.id}:${identity.generation}.`,
			);
		}
		if (
			accepted.type === '#text' ||
			accepted.type === 'raw-text' ||
			accepted.type === 'list' ||
			directListItem((id) => state.records.get(id), identity.id) !== null
		) {
			throw hostError(`${label} targets an unsupported text or native-list host.`);
		}
		if (removingFromRecreatedTarget) return currentParent;
		return Object.freeze({
			kind: 'portal' as const,
			key,
			universalRoot: handle.root,
			target: identity.id,
			generation: identity.generation,
		});
	};
	const childrenForRead = (parent: LynxAttachedHostParent): readonly number[] => {
		if (parent === null) return stagedRootChildren ?? state.rootChildren;
		if (isPortalParent(parent)) return portalChildrenForRead(parent);
		const record = getRecord(parent);
		if (record === undefined) throw hostError(`unknown parent ${parent}.`);
		return record.children;
	};
	const childrenForWrite = (parent: LynxAttachedHostParent): number[] => {
		if (parent === null) return rootChildrenForWrite();
		if (isPortalParent(parent)) return portalChildrenForWrite(parent);
		const record = writeRecord(parent);
		if (record === undefined) throw hostError(`unknown parent ${parent}.`);
		return hostChildrenForWrite(record);
	};
	const captureInitialNode = (id: number): void => {
		if (initiallyEmpty || initialNodes.has(id)) return;
		const node = state.records.get(id)?.node;
		if (node != null) initialNodes.set(id, node);
	};
	const capturePortalChildren = (target: number): void => {
		if (state.portalChildren.size === 0) return;
		for (const entry of state.portalChildren.values()) {
			if (entry.parent.target !== target) continue;
			for (const child of entry.children) captureInitialNode(child);
		}
	};
	let destroyedIds: Set<number> | null = null;
	const batchDestroys = (): ReadonlySet<number> => {
		if (destroyedIds === null) {
			destroyedIds = new Set();
			for (const candidate of batch.commands) {
				if (candidate?.op !== 'destroy') continue;
				assertSafeId(candidate.id, 'destroy.id');
				destroyedIds.add(candidate.id);
			}
		}
		return destroyedIds;
	};
	// A native list recycles elements the driver does not own, so a destroyed
	// record there can hand its element back to the engine still carrying a
	// binding. Any list topology keeps the explicit unbind. Read live at each
	// use rather than snapshotted here: a list can appear inside this very
	// batch, and the two readers run in different phases.
	const teardownMaySkipUnbind = (): boolean => state.lists.size === 0;
	const operations: LynxApplyOperation<Node>[] = [];
	const handleOrder: number[] = [];
	let touchedHandles: Set<number> | null = null;
	let listAncestryRoots: Set<number> | null = null;
	const abandonCompact = () => {
		if (!compactCandidate) return;
		compactCandidate = false;
		for (const [id, record] of stagedRecords) {
			handleOrder.push(id);
			if (!stagedGenerations.has(id)) stagedGenerations.set(id, record.handle.generation);
		}
	};
	const touchHandle = (id: number, newlyCreated = false) => {
		if (compactCandidate) return;
		if (newlyCreated && touchedHandles === null) {
			handleOrder.push(id);
			return;
		}
		touchedHandles ??= new Set(handleOrder);
		if (touchedHandles.has(id)) return;
		touchedHandles.add(id);
		handleOrder.push(id);
	};

	for (let index = 0; index < batch.commands.length; index++) {
		const command = batch.commands[index];
		if (command === null || typeof command !== 'object') {
			throw hostError(`command ${index} must be an object.`);
		}
		if (
			sawCompactRange &&
			command.op !== 'mount-template-range' &&
			command.op !== 'mount-template-run'
		) {
			sparseCompactNodes = false;
		}
		if (command.op === 'mount-template-range' || command.op === 'mount-template-run') {
			const label = `command ${index} ${command.op}`;
			const program = prepareTemplateProgram(command.program, label);
			const shape = program.shape;
			const count = command.op === 'mount-template-run' ? command.count : 1;
			assertSafeId(count, `${label}.count`);
			const hostCount = count * shape.types.length;
			assertSafeId(command.firstId, `${label}.firstId`);
			if (
				!Number.isSafeInteger(hostCount) ||
				!Number.isSafeInteger(command.firstId + (hostCount - 1))
			) {
				throw hostError(`${label}.firstId exceeds the host identity range.`);
			}
			const valueCount = count * program.valueCount;
			if (
				!Number.isSafeInteger(valueCount) ||
				!Array.isArray(command.values) ||
				command.values.length !== valueCount
			) {
				throw hostError(`${label}.values must match the program's scalar binding count.`);
			}
			const mainThreadValues = program.mainThreadValues;
			for (let valueIndex = 0; valueIndex < command.values.length; valueIndex++) {
				const value = command.values[valueIndex];
				if (
					value !== null &&
					value !== undefined &&
					typeof value !== 'string' &&
					typeof value !== 'number' &&
					typeof value !== 'boolean' &&
					typeof value !== 'bigint'
				) {
					// A worklet descriptor is an object, so the slot its program bound to
					// a `main-thread:` prop is the one place a non-scalar belongs. Its
					// shape is checked where every other authored main-thread value is
					// checked — `planLynxHostPropPatch` below — rather than by a second
					// validator that could disagree with the first.
					if (mainThreadValues?.[valueIndex % program.valueCount] !== true) {
						throw hostError(`${label}.values[${valueIndex}] must be a scalar.`);
					}
				}
			}
			// A run that installs main-thread props is not compact-acknowledgeable and
			// its hosts need real records, so the decision is taken before the first
			// instance rather than abandoned partway through building them.
			if (mainThreadValues !== null) abandonCompact();
			if (program.eventCount === 0) {
				if (command.firstListenerId !== null) {
					throw hostError(`${label}.firstListenerId must be null without event sites.`);
				}
			} else {
				assertSafeId(command.firstListenerId, `${label}.firstListenerId`);
				const eventCount = count * program.eventCount;
				if (
					!Number.isSafeInteger(eventCount) ||
					!Number.isSafeInteger(command.firstListenerId + (eventCount - 1))
				) {
					throw hostError(`${label}.firstListenerId exceeds the listener identity range.`);
				}
			}
			const parent = resolveParent(command.parent, `${label}.parent`);
			if (isPortalParent(parent)) throw hostError(`${label} cannot target a portal.`);
			if (command.before !== null) assertSafeId(command.before, `${label}.before`);
			const parentRecord = typeof parent === 'number' ? getRecord(parent) : undefined;
			if (typeof parent === 'number' && parentRecord === undefined) {
				throw hostError(`${label} references unknown parent ${parent}.`);
			}
			if (
				parentRecord instanceof LynxCompactHostRecord ||
				(command.before !== null && getRecord(command.before) instanceof LynxCompactHostRecord)
			) {
				sparseCompactNodes = false;
			}
			const deferred = command.op === 'mount-template-run' && command.deferred === true;
			if (deferred) {
				// A native `<list>` is the one parent that owns which of its children
				// are on screen, so it is the one parent for which declaring an
				// instance and building it are different requests.
				if (parentRecord?.type !== 'list') {
					throw hostError(`${label} may only defer directly under a native <list>.`);
				}
				if (command.before !== null) {
					throw hostError(`${label} cannot defer relative to a sibling.`);
				}
				if (shape.types[0] !== 'list-item') {
					throw hostError(`${label} must declare <list-item> instances under a <list>.`);
				}
				// Two per-commit audits walk the hosts this driver has materialized:
				// one collects native lists, one checks main-thread props and refs. A
				// declared host is in neither walk, so a deferred run may not declare
				// anything either walk exists to find. `prepareTemplateShape` already
				// keeps `<list>` out of every program, which leaves this — a property
				// of the program, decided once for the run rather than once per
				// instance, which is the whole point of not building them.
				if (mainThreadValues !== null) {
					throw hostError(`${label} cannot defer a run binding main-thread props.`);
				}
				const declaredFirst = command.firstId;
				const declaredLast = declaredFirst + (hostCount - 1);
				if (
					runsOverlapRange(stagedDeferredRuns, declaredFirst, declaredLast) ||
					runsOverlapRange(state.deferredRuns, declaredFirst, declaredLast)
				) {
					throw hostError(`${label} overlaps another declared host range.`);
				}
				// Walk the range through the same lookups an eager mount would hit:
				// a record answers for every host the driver holds — including one a
				// compact commit accepted with its generation left implicit, which a
				// scan of the generation map alone would miss — and a generation
				// answers for every host that ever lived under the id.
				for (let id = declaredFirst; id <= declaredLast; id++) {
					if (getRecord(id) !== undefined || getGeneration(id) !== undefined) {
						throw hostError(`duplicate host id ${id}.`);
					}
				}
				// Accepting a run means every instance it declares is valid, including
				// the ones nothing will ever build. Unlike the dense path — whose
				// eligibility refuses route-0 bound nodes outright — a deferred run
				// admits a #text carrying a CSS scope beside its binding, so the scan
				// covers every bound #text value rather than only the value-only
				// route; skipping one would move its fault to the scroll position
				// that first builds the row.
				for (let node = 0; node < shape.types.length; node++) {
					if (shape.types[node] !== '#text') continue;
					const nodeBindings = program.bindings[node];
					if (nodeBindings === undefined) continue;
					for (const binding of nodeBindings) {
						if (binding.name !== 'value') continue;
						for (let row = 0; row < count; row++) {
							const value = command.values[row * program.valueCount + binding.valueIndex];
							if (typeof value !== 'string') {
								throw hostError(
									`${label} for #text must contain a string value and optional CSS scope.`,
								);
							}
						}
					}
				}
				abandonCompact();
				if (typeof parent === 'number') captureInitialNode(parent);
				(stagedDeferredRuns ??= []).push({
					root: container.root,
					program,
					firstId: declaredFirst,
					count,
					parent,
					// The declaration outlives the command that carried it, so a mutable
					// array would let the peer rewrite hosts it already mounted. The copy
					// costs what the declaration retains anyway.
					values: Object.isFrozen(command.values)
						? command.values
						: Object.freeze(command.values.slice()),
					firstListenerId: command.firstListenerId,
					removed: null,
				});
				anyDeferredRuns = true;
				// The list is told about every logical row it owns; only which of them
				// are on screen is deferred.
				const declaredSiblings = childrenForWrite(parent);
				const declaredWidth = shape.types.length;
				for (let row = 0; row < count; row++) {
					declaredSiblings.push(declaredFirst + row * declaredWidth);
				}
				continue;
			}
			if (
				parentRecord?.type === 'list' ||
				(hasNativeListTopology &&
					typeof parent === 'number' &&
					directListItem(getRecord, parent) !== null)
			) {
				throw hostError(`${label} cannot target a native-list host or descendant.`);
			}
			const rootType = shape.types[0]!;
			if (rootType === 'list-item') {
				// The shape allows a `<list-item>` root so a deferred run can declare a
				// native list's cells. Building one eagerly is the part that cannot
				// follow: a mount that targets a native list is refused above, so an
				// eager cell has no list to be a cell of.
				throw hostError(`${label} may only mount a <list-item> template as a deferred run.`);
			}
			if ((rootType === '#text' || rootType === 'raw-text') && parentRecord?.type !== 'text') {
				throw hostError(`${rootType} template host may only be placed directly under a text host.`);
			}
			if (typeof parent === 'number') captureInitialNode(parent);
			if (command.before !== null) captureInitialNode(command.before);

			const siblings = childrenForWrite(parent);
			let beforeIndex = siblings.length;
			if (command.before !== null) {
				beforeIndex = siblings.indexOf(command.before);
				if (beforeIndex === -1) {
					throw hostError(`before host ${command.before} is not a child of the requested parent.`);
				}
			}
			let denseEligible =
				command.op === 'mount-template-run' &&
				compactCandidate &&
				options?.lazyPublicInstances === true &&
				Object.isFrozen(command.values) &&
				command.before === null &&
				!sawCompactRange &&
				stagedRecords instanceof Map &&
				program.bindings.every(
					(binding, node) => binding === undefined || program.dynamicRoutes[node] !== 0,
				);
			if (denseEligible) {
				const end = command.firstId + (hostCount - 1);
				if (
					incrementalCompactCandidate &&
					(typeof parent !== 'number' || !isRootConnected((id) => state.records.get(id), parent))
				) {
					denseEligible = false;
				}
				for (const id of stagedRecords.keys()) {
					if (id >= command.firstId && id <= end) {
						denseEligible = false;
						break;
					}
				}
				if (incrementalCompactCandidate) {
					for (const id of state.generations.keys()) {
						if (id >= command.firstId && id <= end) {
							denseEligible = false;
							break;
						}
					}
				}
				for (let later = index + 1; denseEligible && later < batch.commands.length; later++) {
					const next = batch.commands[later];
					if (
						next === null ||
						typeof next !== 'object' ||
						next.op !== 'insert' ||
						(next.parent !== null && typeof next.parent !== 'number') ||
						(next.id >= command.firstId && next.id <= end) ||
						(typeof next.parent === 'number' &&
							next.parent >= command.firstId &&
							next.parent <= end) ||
						(next.before !== null && next.before >= command.firstId && next.before <= end)
					) {
						denseEligible = false;
					}
				}
			}
			if (denseEligible) {
				for (let row = 0; row < count; row++) {
					const valueOffset = row * program.valueCount;
					for (let node = 0; node < shape.types.length; node++) {
						if (program.dynamicRoutes[node] !== 1) continue;
						const binding = program.bindings[node]![0]!;
						if (typeof command.values[valueOffset + binding.valueIndex] !== 'string') {
							throw hostError(
								`${label} for #text must contain a string value and optional CSS scope.`,
							);
						}
					}
				}
				let prefix = stagedRecords as Map<number, LynxHostRecord<Node>>;
				if (incrementalCompactCandidate) {
					prefix = new Map(state.records as Map<number, LynxHostRecord<Node>>);
					for (const [id, record] of stagedRecords) prefix.set(id, record);
				}
				const dense = new LynxDenseHostRecordStore(
					prefix,
					container.root,
					program,
					command.firstId,
					count,
					parent,
					command.values,
					command.firstListenerId,
				);
				if (incrementalCompactCandidate) acceptedDenseRecords = dense;
				stagedRecords = dense;
				for (let row = 0; row < count; row++) {
					siblings.push(command.firstId + row * shape.types.length);
				}
				stagedRecordCount += hostCount;
				compactCreated += hostCount;
				compactInserted += hostCount;
				sawCompactRange = true;
				operations.push({
					op: 'mount-template',
					id: command.firstId,
					parent,
					before: command.before,
					records: [],
					patches: [],
					parents: shape.parents,
					count,
					dense,
					firstId: command.firstId,
					program,
					firstListenerId: command.firstListenerId,
					lazyPublicInstances: true,
				});
				continue;
			}
			if (incrementalCompactCandidate) abandonCompact();
			const templateRecords: LynxHostRecord<Node>[] = new Array(hostCount);
			const templatePatches: LynxHostPropPatch[] = new Array(hostCount);
			let runMainThreadProps = false;
			for (let rowIndex = 0; rowIndex < count; rowIndex++) {
				const rowOffset = rowIndex * shape.types.length;
				const rowFirstId = command.firstId + rowOffset;
				const rowFirstListener =
					command.firstListenerId === null
						? null
						: command.firstListenerId + rowIndex * program.eventCount;
				const valueOffset = rowIndex * program.valueCount;
				for (let nodeIndex = 0; nodeIndex < shape.types.length; nodeIndex++) {
					const recordIndex = rowOffset + nodeIndex;
					const id = rowFirstId + nodeIndex;
					if (getRecord(id) !== undefined) throw hostError(`duplicate host id ${id}.`);
					const type = shape.types[nodeIndex]!;
					const bindings = program.bindings[nodeIndex];
					let props = program.props[nodeIndex]!;
					let patch = program.patches[nodeIndex];
					if (bindings !== undefined) {
						const next = Object.create(null) as Record<string, unknown>;
						for (const name in props) next[name] = props[name];
						for (const binding of bindings) {
							next[binding.name] = command.values[valueOffset + binding.valueIndex];
						}
						props = Object.freeze(next);
						const route = program.dynamicRoutes[nodeIndex]!;
						if (route === 1) {
							if (typeof props.value !== 'string') {
								throw hostError(
									`${label} for #text must contain a string value and optional CSS scope.`,
								);
							}
							patch = EMPTY_RAW_TEXT_CREATE_PATCH;
						} else if (route === 2) {
							patch = planScalarClassAndIdCreation(props);
						} else {
							assertTextProps(type, props, label);
							patch =
								type === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
									? EMPTY_RAW_TEXT_CREATE_PATCH
									: planLynxHostPropPatch(type, EMPTY_HOST_PROPS, props);
							if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
								// Reachable only from a bound slot: a static main-thread prop is
								// an object, and `prepareTemplateProgram` refuses a non-scalar
								// static prop before any instance exists.
								if (mainThreadValues === null) {
									throw hostError(`${label} host ${id} cannot contain direct main-thread props.`);
								}
								hasMainThreadProps = true;
								runMainThreadProps = true;
							}
						}
					}
					const generation = (getGeneration(id) ?? 0) + 1;
					setGeneration(id, generation);
					const logicalParent = nodeIndex === 0 ? parent : rowFirstId + shape.parents[nodeIndex]!;
					const events = program.events[nodeIndex];
					const record: LynxHostRecord<Node> = compactCandidate
						? events === undefined
							? new LynxCompactHostRecord(
									container.root,
									id,
									generation,
									type,
									props,
									logicalParent,
								)
							: new LynxCompactEventHostRecord(
									container.root,
									id,
									generation,
									type,
									props,
									logicalParent,
									events,
									rowFirstListener!,
								)
						: {
								node: null,
								type,
								props,
								visible: true,
								parent: logicalParent,
								children: EMPTY_HOST_CHILDREN,
								events: EMPTY_HOST_EVENTS,
								handle: createHandle(container.root, id, type, generation),
								selectorWanted: false,
								selectorInstalled: false,
							};
					if (events !== undefined && !compactCandidate) {
						record.events = new Map();
						for (const event of events) {
							record.events.set(
								event.type,
								Object.freeze({ id: rowFirstListener! + event.index, priority: event.priority }),
							);
						}
					}
					stagedRecordCount++;
					if (deletedRecords.size !== 0) deletedRecords.delete(id);
					stagedRecords.set(id, record);
					templateRecords[recordIndex] = record;
					templatePatches[recordIndex] = patch!;
					if (nodeIndex !== 0) {
						hostChildrenForWrite(templateRecords[rowOffset + shape.parents[nodeIndex]!]!).push(id);
					}
					touchHandle(id, true);
				}
				if (command.before === null) siblings.push(rowFirstId);
				else siblings.splice(beforeIndex++, 0, rowFirstId);
			}
			let teardownDense: LynxDenseHostRecordStore<Node> | undefined;
			if (
				teardownMirrorCandidate &&
				command.op === 'mount-template-run' &&
				command.before === null &&
				!isPortalParent(parent) &&
				(typeof parent !== 'number' || isRootConnected((id) => state.records.get(id), parent))
			) {
				const prefix = new Map(state.records as Map<number, LynxHostRecord<Node>>);
				const finalId = command.firstId + hostCount - 1;
				for (const [id, record] of stagedRecords) {
					if (id < command.firstId || id > finalId) prefix.set(id, record);
				}
				teardownDense = new LynxDenseHostRecordStore(
					prefix,
					container.root,
					program,
					command.firstId,
					count,
					parent,
					command.values,
					command.firstListenerId,
					templateRecords.map((record) => record.handle.generation),
				);
				acceptedTeardownRecords = teardownDense;
			}
			operations.push({
				op: 'mount-template',
				id: command.firstId,
				parent,
				before: command.before,
				records: templateRecords,
				...(teardownDense === undefined ? null : { teardownDense }),
				patches: templatePatches,
				parents: shape.parents,
				...(count === 1 ? null : { count }),
				...(compactCandidate
					? { firstId: command.firstId, program, firstListenerId: command.firstListenerId }
					: null),
				...(options?.lazyPublicInstances === true &&
				(compactCandidate || acceptedLazyPublicInstances)
					? { lazyPublicInstances: true }
					: null),
				...(runMainThreadProps ? { mainThreadProps: true as const } : null),
			});
			if (compactCandidate) {
				sawCompactRange = true;
				compactCreated += templateRecords.length;
				compactInserted += templateRecords.length;
			}
		} else if (command.op === 'mount-template') {
			const label = `command ${index} mount-template`;
			const shape = prepareTemplateShape(command.shape, label);
			if (!Array.isArray(command.nodes) || command.nodes.length !== shape.types.length) {
				throw hostError(`${label}.nodes must match the template shape length.`);
			}
			const parent = resolveParent(command.parent, `${label}.parent`);
			if (isPortalParent(parent)) {
				throw hostError(`${label} cannot target a portal.`);
			}
			if (command.before !== null) assertSafeId(command.before, `${label}.before`);
			const parentRecord = typeof parent === 'number' ? getRecord(parent) : undefined;
			if (typeof parent === 'number' && parentRecord === undefined) {
				throw hostError(`${label} references unknown parent ${parent}.`);
			}
			if (
				parentRecord?.type === 'list' ||
				(hasNativeListTopology &&
					typeof parent === 'number' &&
					directListItem(getRecord, parent) !== null)
			) {
				throw hostError(`${label} cannot target a native-list host or descendant.`);
			}
			const rootType = shape.types[0]!;
			// Only a deferred run may mount a cell; see the same refusal above.
			if (rootType === 'list-item') {
				throw hostError(`${label} may only mount a <list-item> template as a deferred run.`);
			}
			if ((rootType === '#text' || rootType === 'raw-text') && parentRecord?.type !== 'text') {
				throw hostError(`${rootType} template host may only be placed directly under a text host.`);
			}
			if (typeof parent === 'number') captureInitialNode(parent);
			if (command.before !== null) captureInitialNode(command.before);

			const templateRecords: LynxHostRecord<Node>[] = new Array(shape.types.length);
			const templatePatches: LynxHostPropPatch[] = new Array(shape.types.length);
			for (let nodeIndex = 0; nodeIndex < shape.types.length; nodeIndex++) {
				const descriptor = command.nodes[nodeIndex];
				if (descriptor === null || typeof descriptor !== 'object') {
					throw hostError(`${label}.nodes[${nodeIndex}] must be an object.`);
				}
				if (!Number.isSafeInteger(descriptor.id) || descriptor.id <= 0) {
					throw hostError(`${label}.nodes[${nodeIndex}].id must be a positive safe integer.`);
				}
				if (getRecord(descriptor.id) !== undefined) {
					throw hostError(`duplicate host id ${descriptor.id}.`);
				}
				const type = shape.types[nodeIndex]!;
				const cachedProps = prepareStaticHostProps(type, descriptor.props, label);
				const props = cachedProps?.props ?? cloneProps(descriptor.props, label);
				assertTextProps(type, props, label);
				const patch =
					cachedProps?.patch ??
					(type === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
						? EMPTY_RAW_TEXT_CREATE_PATCH
						: planLynxHostPropPatch(type, EMPTY_HOST_PROPS, props));
				if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
					throw hostError(`${label}.nodes[${nodeIndex}] cannot contain direct main-thread props.`);
				}
				const generation = (getGeneration(descriptor.id) ?? 0) + 1;
				const handle = createHandle(container.root, descriptor.id, type, generation);
				setGeneration(descriptor.id, generation);
				const record: LynxHostRecord<Node> = {
					node: null,
					type,
					props,
					visible: true,
					parent: nodeIndex === 0 ? parent : templateRecords[shape.parents[nodeIndex]!]!.handle.id,
					children: EMPTY_HOST_CHILDREN,
					events: EMPTY_HOST_EVENTS,
					handle,
					selectorWanted: false,
					selectorInstalled: false,
				};
				if (descriptor.events !== undefined) {
					if (!Array.isArray(descriptor.events)) {
						throw hostError(`${label}.nodes[${nodeIndex}].events must be an array when provided.`);
					}
					if ((type === '#text' || type === 'raw-text') && descriptor.events.length !== 0) {
						throw hostError(`raw-text host ${descriptor.id} cannot own native events.`);
					}
					for (let eventIndex = 0; eventIndex < descriptor.events.length; eventIndex++) {
						const event = descriptor.events[eventIndex];
						if (event === null || typeof event !== 'object') {
							throw hostError(
								`${label}.nodes[${nodeIndex}].events[${eventIndex}] must be an object.`,
							);
						}
						if (typeof event.type !== 'string' || event.type.length === 0) {
							throw hostError(
								`${label}.nodes[${nodeIndex}].events[${eventIndex}].type must be a non-empty string.`,
							);
						}
						if (parseLynxNativeEventProp(event.type) === null) {
							throw hostError(`event ${JSON.stringify(event.type)} is not a Lynx event prop.`);
						}
						if (event.listener === null || typeof event.listener !== 'object') {
							throw hostError(
								`${label}.nodes[${nodeIndex}].events[${eventIndex}].listener must be an object.`,
							);
						}
						if (!Number.isSafeInteger(event.listener.id) || event.listener.id <= 0) {
							throw hostError(
								`${label}.nodes[${nodeIndex}].events[${eventIndex}].listener.id must be a positive safe integer.`,
							);
						}
						const priority = event.listener.priority;
						if (priority !== 'continuous' && priority !== 'default' && priority !== 'discrete') {
							throw hostError(
								`${label}.nodes[${nodeIndex}].events[${eventIndex}] has invalid event priority.`,
							);
						}
						if (record.events === EMPTY_HOST_EVENTS) record.events = new Map();
						if (record.events.has(event.type)) {
							throw hostError(
								`${label}.nodes[${nodeIndex}] repeats native event ${JSON.stringify(event.type)}.`,
							);
						}
						record.events.set(event.type, Object.freeze({ id: event.listener.id, priority }));
					}
				}
				stagedRecordCount += 1;
				if (deletedRecords.size !== 0) deletedRecords.delete(descriptor.id);
				stagedRecords.set(descriptor.id, record);
				templateRecords[nodeIndex] = record;
				templatePatches[nodeIndex] = patch;
				if (nodeIndex !== 0) {
					hostChildrenForWrite(templateRecords[shape.parents[nodeIndex]!]!).push(descriptor.id);
				}
				touchHandle(descriptor.id, true);
			}

			const rootRecord = templateRecords[0]!;
			const siblings = childrenForWrite(parent);
			let beforeIndex = siblings.length;
			if (command.before !== null) {
				beforeIndex = siblings.indexOf(command.before);
				if (beforeIndex === -1) {
					throw hostError(`before host ${command.before} is not a child of the requested parent.`);
				}
			}
			siblings.splice(beforeIndex, 0, rootRecord.handle.id);
			operations.push({
				op: 'mount-template',
				id: rootRecord.handle.id,
				parent,
				before: command.before,
				records: templateRecords,
				patches: templatePatches,
				parents: shape.parents,
			});
			if (compactCandidate) {
				compactCreated += templateRecords.length;
				compactInserted += templateRecords.length;
			}
		} else if (command.op === 'create') {
			assertSafeId(command.id, `command ${index} create.id`);
			assertHostType(command.type, `command ${index} create.type`);
			if (command.type === 'list' || command.type === 'list-item') {
				abandonCompact();
				hasNativeListTopology = true;
			}
			if (getRecord(command.id) !== undefined) throw hostError(`duplicate host id ${command.id}.`);
			const props = cloneProps(command.props, `command ${index} create.props`);
			assertTextProps(command.type, props, `command ${index} create.props`);
			const patch =
				command.type === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
					? EMPTY_RAW_TEXT_CREATE_PATCH
					: planLynxHostPropPatch(command.type, EMPTY_HOST_PROPS, props);
			if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
				abandonCompact();
				hasMainThreadProps = true;
			}
			if (compactCandidate) {
				for (const name in props) {
					if (name === 'ref' || name.startsWith('main-thread:')) {
						abandonCompact();
						break;
					}
				}
			}
			const generation = (getGeneration(command.id) ?? 0) + 1;
			const handle = createHandle(container.root, command.id, command.type, generation);
			setGeneration(command.id, generation);
			const record: LynxHostRecord<Node> = {
				node: null,
				type: command.type,
				props,
				visible: true,
				parent: undefined,
				children: EMPTY_HOST_CHILDREN,
				events: EMPTY_HOST_EVENTS,
				handle,
				selectorWanted: false,
				selectorInstalled: false,
			};
			stagedRecordCount += 1;
			if (deletedRecords.size !== 0) deletedRecords.delete(command.id);
			stagedRecords.set(command.id, record);
			operations.push({
				op: 'create',
				id: command.id,
				type: command.type,
				props,
				patch,
				handle,
				record,
				visible: record.visible,
			});
			touchHandle(command.id, true);
			if (compactCandidate) compactCreated++;
		} else if (command.op === 'update') {
			abandonCompact();
			assertSafeId(command.id, `command ${index} update.id`);
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown update target ${command.id}.`);
			captureInitialNode(command.id);
			const props = cloneProps(command.props, `command ${index} update.props`);
			assertTextProps(record.type, props, `command ${index} update.props`);
			const patch = planLynxHostPropPatch(record.type, record.props, props);
			if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
				hasMainThreadProps = true;
			}
			if (patch.requiresRecreate) {
				throw hostError(`update target ${command.id} requires a recreate command.`);
			}
			operations.push({
				op: 'update',
				id: command.id,
				type: record.type,
				previous: record.props,
				next: props,
				patch,
				visible: record.visible,
			});
			record.props = props;
		} else if (command.op === 'recreate') {
			abandonCompact();
			assertSafeId(command.id, `command ${index} recreate.id`);
			assertHostType(command.type, `command ${index} recreate.type`);
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown recreate target ${command.id}.`);
			captureInitialNode(command.id);
			if (record.type !== command.type) {
				throw hostError(`recreate type mismatch for ${command.id}.`);
			}
			const props = cloneProps(command.props, `command ${index} recreate.props`);
			assertTextProps(command.type, props, `command ${index} recreate.props`);
			const patch =
				command.type === '#text' && props[LYNX_CSS_SCOPE_PROP] == null
					? EMPTY_RAW_TEXT_CREATE_PATCH
					: planLynxHostPropPatch(command.type, EMPTY_HOST_PROPS, props);
			if (patch.mainThreadEvents.length !== 0 || patch.mainThreadRef !== undefined) {
				hasMainThreadProps = true;
			}
			const generation = (getGeneration(command.id) ?? record.handle.generation) + 1;
			const handle = createHandle(container.root, command.id, command.type, generation);
			const recreateChildren = Object.freeze([...record.children]);
			const recreatePortalChildren = Object.freeze([...portalChildrenForTarget(command.id)]);
			for (const childId of recreateChildren) captureInitialNode(childId);
			for (const childId of recreatePortalChildren) captureInitialNode(childId);
			operations.push({
				op: 'recreate',
				id: command.id,
				type: command.type,
				props,
				parent: record.parent,
				children: recreateChildren,
				portalChildren: recreatePortalChildren,
				visible: record.visible,
				events: new Map(record.events),
				generation,
				patch,
				handle,
				record,
			});
			setGeneration(command.id, generation);
			recreatedIds.add(command.id);
			record.props = props;
			record.handle = handle;
			record.selectorInstalled = false;
			touchHandle(command.id);
		} else if (command.op === 'insert' || command.op === 'move') {
			if (command.op === 'move') abandonCompact();
			assertSafeId(command.id, `command ${index} ${command.op}.id`);
			const parent = resolveParent(command.parent, `command ${index} ${command.op}.parent`);
			if (compactCandidate && isPortalParent(parent)) abandonCompact();
			if (command.before !== null) {
				assertSafeId(command.before, `command ${index} ${command.op}.before`);
			}
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown ${command.op} target ${command.id}.`);
			if (hasNativeListTopology && state.records.has(command.id)) {
				(listAncestryRoots ??= new Set()).add(command.id);
			}
			captureInitialNode(command.id);
			const physicalParentId = parentHostId(parent);
			if (typeof physicalParentId === 'number') {
				captureInitialNode(physicalParentId);
				if (!isPortalParent(parent)) capturePortalChildren(physicalParentId);
			}
			if (command.before !== null) captureInitialNode(command.before);
			if (command.op === 'insert' && record.parent !== undefined) {
				throw hostError(`insert target ${command.id} is already attached.`);
			}
			if (command.op === 'move' && record.parent === undefined) {
				throw hostError(`move target ${command.id} is detached.`);
			}
			if (record.type === '#text' || record.type === 'raw-text') {
				const parentRecord =
					typeof physicalParentId === 'number' ? getRecord(physicalParentId) : undefined;
				if (parentRecord?.type !== 'text') {
					throw hostError(
						`${record.type} host ${command.id} may only be placed directly under a text host.`,
					);
				}
			}
			if (
				record.type === 'list-item' &&
				(typeof parent !== 'number' || getRecord(parent)?.type !== 'list')
			) {
				throw hostError(`<list-item> ${command.id} must be placed directly under a <list>.`);
			}
			// A newly attached leaf cannot contain its proposed parent. Preserve
			// the explicit self-parent diagnostic and use the full ancestry walk
			// for moves, detached subtrees, and portal-owned topology.
			if (
				command.op === 'insert' &&
				record.children.length === 0 &&
				state.portalChildren.size === 0 &&
				stagedPortalChildren === null
			) {
				if (physicalParentId === command.id) {
					throw hostError(`placement of ${command.id} would create a cycle.`);
				}
			} else {
				assertNoCycle(getRecord, command.id, parent);
			}
			const wasConnected = hasMainThreadProps && isRootConnected(getRecord, command.id);
			const previousParent = record.parent;
			if (previousParent !== undefined) {
				const previousChildren = childrenForWrite(previousParent);
				const previousIndex = previousChildren.indexOf(command.id);
				if (previousIndex === -1) {
					throw hostError(`topology is missing ${command.id} from its current parent.`);
				}
				previousChildren.splice(previousIndex, 1);
			}
			const children = childrenForWrite(parent);
			let beforeIndex = children.length;
			if (command.before !== null) {
				beforeIndex = children.indexOf(command.before);
				if (beforeIndex === -1) {
					throw hostError(`before host ${command.before} is not a child of the requested parent.`);
				}
			}
			children.splice(beforeIndex, 0, command.id);
			record.parent = parent;
			const willBeConnected = hasMainThreadProps && isRootConnected(getRecord, command.id);
			operations.push({
				op: command.op,
				id: command.id,
				parent,
				before: command.before,
				previousParent,
				wasConnected,
				willBeConnected,
			});
			if (compactCandidate) compactInserted++;
		} else if (command.op === 'remove') {
			abandonCompact();
			assertSafeId(command.id, `command ${index} remove.id`);
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown remove target ${command.id}.`);
			if (hasNativeListTopology && state.records.has(command.id)) {
				(listAncestryRoots ??= new Set()).add(command.id);
			}
			const parent = resolveParent(command.parent, `command ${index} remove.parent`, record.parent);
			captureInitialNode(command.id);
			const physicalParentId = parentHostId(parent);
			if (typeof physicalParentId === 'number') captureInitialNode(physicalParentId);
			if (!sameHostParent(record.parent, parent)) {
				throw hostError(`remove parent does not own host ${command.id}.`);
			}
			const children = childrenForWrite(parent);
			const childIndex = children.indexOf(command.id);
			if (childIndex === -1) throw hostError(`remove target ${command.id} is not attached.`);
			children.splice(childIndex, 1);
			record.parent = undefined;
			operations.push({ op: 'remove', id: command.id, parent });
		} else if (command.op === 'ensure-public-instance') {
			abandonCompact();
			assertSafeId(command.id, `command ${index} ensure-public-instance.id`);
			if (getRecord(command.id) === undefined) {
				throw hostError(`unknown public instance target ${command.id}.`);
			}
			captureInitialNode(command.id);
			operations.push({ op: 'ensure-public-instance', id: command.id });
		} else if (command.op === 'visibility') {
			abandonCompact();
			assertSafeId(command.id, `command ${index} visibility.id`);
			if (command.state !== 'hidden' && command.state !== 'visible') {
				throw hostError(`command ${index} has invalid visibility state.`);
			}
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown visibility target ${command.id}.`);
			captureInitialNode(command.id);
			record.visible = command.state === 'visible';
			operations.push({
				op: 'visibility',
				id: command.id,
				state: command.state,
				authoredHidden: authoredHiddenValue(record.props),
				events: new Map(record.events),
				generation: record.handle.generation,
			});
		} else if (command.op === 'event') {
			assertSafeId(command.id, `command ${index} event.id`);
			assertHostType(command.type, `command ${index} event.type`);
			const record = writeRecord(command.id);
			if (record === undefined) throw hostError(`unknown event target ${command.id}.`);
			if (record.type === '#text' || record.type === 'raw-text') {
				throw hostError(`raw-text host ${command.id} cannot own native events.`);
			}
			if (parseLynxNativeEventProp(command.type) === null) {
				throw hostError(`event ${JSON.stringify(command.type)} is not a Lynx event prop.`);
			}
			captureInitialNode(command.id);
			const previous = record.events.get(command.type) ?? null;
			if (command.listener === null) {
				if (record.events !== EMPTY_HOST_EVENTS) record.events.delete(command.type);
			} else {
				assertSafeId(command.listener.id, `command ${index} event.listener.id`);
				if (!['continuous', 'default', 'discrete'].includes(command.listener.priority)) {
					throw hostError(`command ${index} has invalid event priority.`);
				}
				if (record.events === EMPTY_HOST_EVENTS) record.events = new Map();
				record.events.set(
					command.type,
					Object.freeze({
						id: command.listener.id,
						priority: command.listener.priority,
					}),
				);
			}
			// A detach whose host this same batch destroys is subsumed by the
			// destroy: the record goes, the element is already detached, and the
			// destroy lowering clears the native-event bookkeeping. Journalling
			// the detach as well would spend one PAPI call per listener to
			// describe a host that no longer exists by the end of the commit.
			if (
				command.listener !== null ||
				!teardownMaySkipUnbind() ||
				!batchDestroys().has(command.id)
			) {
				operations.push({
					op: 'event',
					id: command.id,
					type: command.type,
					previous,
					next: record.events.get(command.type) ?? null,
					generation: record.handle.generation,
					visible: record.visible,
				});
			}
		} else if (command.op === 'destroy') {
			abandonCompact();
			const destroyed = batchDestroys();
			assertSafeId(command.id, `command ${index} destroy.id`);
			const record = getRecord(command.id);
			if (record === undefined) throw hostError(`unknown destroy target ${command.id}.`);
			captureInitialNode(command.id);
			if (record.children.length !== 0) {
				throw hostError(`destroy target ${command.id} still owns children.`);
			}
			if (isRootConnected(getRecord, command.id)) {
				throw hostError(`destroy target ${command.id} is still attached to the page.`);
			}
			if (isPortalParent(record.parent)) {
				throw hostError(
					`destroy target ${command.id} remains attached to a surviving portal target.`,
				);
			}
			if (typeof record.parent === 'number') {
				if (!destroyed.has(record.parent)) {
					throw hostError(
						`destroy target ${command.id} remains attached to a surviving detached parent.`,
					);
				}
				const siblings = writeRecord(record.parent)?.children;
				const childIndex = siblings?.indexOf(command.id) ?? -1;
				if (childIndex === -1) throw hostError(`destroy topology is missing ${command.id}.`);
				siblings!.splice(childIndex, 1);
			}
			if (
				state.implicitInitialGenerations &&
				!stagedGenerations.has(command.id) &&
				!state.generations.has(command.id)
			) {
				stagedGenerations.set(command.id, record.handle.generation);
			}
			const events = new Map(record.events);
			deleteRecord(command.id);
			operations.push({ op: 'destroy', id: command.id, events });
			touchHandle(command.id);
		} else if (command.op === 'lifecycle' || command.op === 'local-callback') {
			throw hostError(`${command.op} commands are not supported by the Lynx async host.`);
		} else {
			throw hostError(`unsupported command ${JSON.stringify((command as { op?: unknown }).op)}.`);
		}
	}
	if (logicalTeardown && (stagedRecordCount !== 0 || childrenForRead(null).length !== 0)) {
		throw hostError('post-fault teardown must remove every remaining host in one batch.');
	}
	if (
		compactCandidate &&
		(compactCreated === 0 ||
			compactCreated !== compactInserted ||
			compactCreated !==
				stagedRecordCount - (acceptedDenseRecords === null ? 0 : state.records.size) ||
			hasMainThreadProps ||
			hasNativeListTopology ||
			stagedPortalRoot !== null)
	) {
		abandonCompact();
	}
	const compactHostCount = compactCandidate ? compactCreated : undefined;

	const finalIds =
		firstTree !== undefined || hasMainThreadProps || hasNativeListTopology
			? new Set<number>()
			: null;
	if (finalIds !== null) {
		for (const id of state.records.keys()) {
			if (!deletedRecords.has(id)) finalIds.add(id);
		}
		for (const id of stagedRecords.keys()) {
			if (!deletedRecords.has(id)) finalIds.add(id);
		}
	}
	let finalPortalChildren: ReadonlyMap<string, LynxPortalChildren> = state.portalChildren;
	const portalChildrenChanges = readStagedPortalChildren();
	if (portalChildrenChanges !== null) {
		const nextPortalChildren = new Map(state.portalChildren);
		for (const [key, entry] of portalChildrenChanges) {
			if (entry.children.length === 0) nextPortalChildren.delete(key);
			else nextPortalChildren.set(key, entry);
		}
		finalPortalChildren = nextPortalChildren;
	}
	for (const entry of finalPortalChildren.values()) {
		const target = getRecord(entry.parent.target);
		const acceptedTarget = state.records.get(entry.parent.target);
		if (
			target === undefined ||
			acceptedTarget === undefined ||
			acceptedTarget.node === null ||
			target.handle.generation !== entry.parent.generation ||
			acceptedTarget.handle.generation !== entry.parent.generation ||
			!isRootConnected(getRecord, entry.parent.target)
		) {
			throw hostError(
				`portal target ${entry.parent.target}:${entry.parent.generation} became stale or detached in the prepared batch.`,
			);
		}
		if (
			target.type === '#text' ||
			target.type === 'raw-text' ||
			target.type === 'list' ||
			directListItem(getRecord, entry.parent.target) !== null
		) {
			throw hostError('portal targets cannot be text hosts or native-list hosts/descendants.');
		}
		for (const childId of entry.children) {
			const child = getRecord(childId);
			if (child === undefined || !sameHostParent(child.parent, entry.parent)) {
				throw hostError(`portal topology does not own child ${childId}.`);
			}
		}
	}
	const listIds = new Set<number>();
	const finalMainThreadRefOwners = new Map<string, number>();
	if (hasNativeListTopology) {
		for (const [id, record] of state.records) {
			if (record.type === 'list') listIds.add(id);
		}
	}
	for (const id of finalIds ?? []) {
		const record = getRecord(id)!;
		assertNoMainThreadEventCollision(record.props, record.events);
		const mainThreadRef = record.props['main-thread:ref'] as
			LynxMainThreadRefDescriptor | null | undefined;
		if (mainThreadRef != null && record.visible && isRootConnected(getRecord, id)) {
			const previousOwner = finalMainThreadRefOwners.get(mainThreadRef._wvid);
			if (previousOwner !== undefined && previousOwner !== id) {
				throw hostError(
					`main-thread ref ${JSON.stringify(mainThreadRef._wvid)} is assigned to hosts ${previousOwner} and ${id}.`,
				);
			}
			finalMainThreadRefOwners.set(mainThreadRef._wvid, id);
		}
		if (record.type === 'list') listIds.add(id);
		if (record.type === 'list' && directListItem(getRecord, id) !== null) {
			throw hostError('nested <list> hosts are not supported by the initial recycling contract.');
		}
		if (
			record.type === 'list-item' &&
			record.parent !== undefined &&
			(typeof record.parent !== 'number' || getRecord(record.parent)?.type !== 'list')
		) {
			throw hostError(`<list-item> ${id} must be placed directly under a <list>.`);
		}
	}
	const listAncestryDelta: LynxHostListAncestryDelta[] = [];
	if (listAncestryRoots !== null) {
		const getAcceptedRecord = (hostId: number) => state.records.get(hostId);
		const previousListDescendants = new Map<number, boolean>();
		const nextListDescendants = new Map<number, boolean>();
		const ancestrySeen = new Set<number>();
		for (const id of listAncestryRoots) {
			const previous = state.records.get(id);
			const next = getRecord(id);
			if (previous === undefined || next === undefined) continue;
			if (
				cachedListDescendant(getAcceptedRecord, id, previousListDescendants) ===
				cachedListDescendant(getRecord, id, nextListDescendants)
			) {
				continue;
			}
			const pending = [id];
			while (pending.length !== 0) {
				const descendantId = pending.pop()!;
				if (ancestrySeen.has(descendantId)) continue;
				ancestrySeen.add(descendantId);
				const previousDescendant = state.records.get(descendantId);
				const nextDescendant = getRecord(descendantId);
				if (nextDescendant === undefined) continue;
				for (let index = nextDescendant.children.length - 1; index >= 0; index--) {
					pending.push(nextDescendant.children[index]!);
				}
				if (previousDescendant === undefined) continue;
				const listDescendant = cachedListDescendant(getRecord, descendantId, nextListDescendants);
				if (
					previousDescendant.handle === nextDescendant.handle &&
					cachedListDescendant(getAcceptedRecord, descendantId, previousListDescendants) !==
						listDescendant
				) {
					listAncestryDelta.push(
						Object.freeze({
							id: descendantId,
							generation: nextDescendant.handle.generation,
							listDescendant,
						}),
					);
				}
			}
		}
	}
	Object.freeze(listAncestryDelta);
	const listUpdates: LynxPreparedListUpdate[] = [];
	for (const hostId of listIds) {
		const previous = listItems((id) => peekRecord(state, id), hostId);
		const next = listItems(getRecord, hostId);
		const update = planLynxListUpdate(previous, next);
		if (hasListUpdate(update) || previous.length !== next.length || !getRecord(hostId)) {
			listUpdates.push(Object.freeze({ hostId, previous, next, update }));
		}
	}

	let handleDelta: readonly LynxHostHandleDelta[] | null = null;
	const materializeHandleDelta = (): readonly LynxHostHandleDelta[] => {
		if (handleDelta !== null) return handleDelta;
		const deltas: LynxHostHandleDelta[] = [];
		if (compactHostCount !== undefined) {
			// Keep fault and legacy fallback behavior intact without allocating a
			// wrapper for every node on the successful compact-ACK path.
			for (const operation of operations) {
				if (operation.op === 'create') {
					deltas.push(Object.freeze({ op: 'create', handle: operation.handle }));
				} else if (operation.op === 'mount-template') {
					if (operation.dense !== undefined) {
						for (let offset = 0; offset < operation.dense.nodes.length; offset++) {
							const record = operation.dense.get(operation.dense.firstId + offset)!;
							deltas.push(Object.freeze({ op: 'create', handle: record.handle }));
						}
					} else {
						for (const record of operation.records) {
							deltas.push(Object.freeze({ op: 'create', handle: record.handle }));
						}
					}
				}
			}
		} else {
			for (const id of handleOrder) {
				// A declared host publishes no identity: nothing was built for it here,
				// so the background holds no handle to create, replace, or remove.
				// Decided here rather than at acknowledgement because a run is dropped
				// as its last row is destroyed, and that destroy is in this same batch.
				if (isDeclared(id)) continue;
				const previous = state.records.get(id)?.handle;
				const next = getRecord(id)?.handle;
				if (previous === undefined && next !== undefined) {
					deltas.push(Object.freeze({ op: 'create', handle: next }));
				} else if (previous !== undefined && next === undefined) {
					deltas.push(
						Object.freeze({
							op: 'destroy',
							renderer: LYNX_RENDERER_ID,
							root: container.root,
							id,
							generation: previous.generation,
						}),
					);
				} else if (previous !== undefined && next !== undefined && previous !== next) {
					deltas.push(Object.freeze({ op: 'recreate', handle: next }));
				}
			}
		}
		handleDelta = Object.freeze(deltas);
		return handleDelta;
	};
	if (compactHostCount === undefined) materializeHandleDelta();
	let firstTreeAction: LynxPreparedHostBatch['firstTreeAction'] = 'none';
	let firstTreeMismatch: LynxFirstTreeMismatchError | null = null;
	if (firstTree !== undefined && firstTreeSource !== null) {
		firstTreeMismatch = compareFirstTree(
			container,
			batch,
			firstTree,
			firstTreeSource,
			finalIds!,
			childrenForRead(null),
			getRecord,
			operations,
			listUpdates,
		);
		firstTreeAction = firstTreeMismatch === null ? 'adopt' : 'repair';
		if (firstTreeMismatch !== null) options?.onMismatch?.(firstTreeMismatch);
	}
	let status: 'prepared' | 'applying' | 'applied' | 'aborted' | 'faulted' = 'prepared';
	let mutationStarted = false;
	let fault: unknown;

	const prepared: LynxPreparedHostBatch = {
		get mutationStarted() {
			return mutationStarted;
		},
		get handleDelta() {
			return materializeHandleDelta();
		},
		...(compactHostCount === undefined ? null : { compactHostCount }),
		listAncestryDelta,
		firstTreeAction,
		apply() {
			if (status === 'aborted' || status === 'applied') return;
			if (status === 'faulted') throw fault;
			if (status !== 'prepared') return;
			if (state.disposed || state.disposing) {
				throw hostError('cannot apply a batch while root cleanup is pending.');
			}
			if (state.firstTree !== null) {
				throw hostError('a captured first-tree root cannot apply a prepared batch.');
			}
			if (state.acceptedVersion !== baseVersion) {
				throw hostError(
					`prepared batch ${batch.version} was superseded by version ${state.acceptedVersion}.`,
				);
			}
			if (
				firstTree !== undefined &&
				(firstTreeSource === null || firstTreeOwner(firstTree) !== firstTreeSource)
			) {
				throw hostError('firstTree ownership changed after preparation.');
			}
			status = 'applying';
			state.applying = true;
			try {
				mutationStarted = true;
				if (firstTreeAction === 'repair') {
					const cleanup = disposeLynxFirstTree(firstTree!);
					if (!cleanup.complete) {
						const error =
							cleanup.errors[0] ?? hostError('first-tree repair cleanup did not complete.');
						state.faulted = true;
						status = 'faulted';
						fault = error;
						throw error;
					}
				}
				const retiredPhysicalIds = new Set<number>();
				let preApplicationFailed = false;
				let preApplicationError: unknown;
				if (!logicalTeardown) {
					try {
						for (const update of listUpdates) {
							const list = state.lists.get(update.hostId);
							if (list === undefined) continue;
							const nextIds = new Set(update.next.map((item) => item.id));
							for (const cell of [...list.attachedByItem.values()]) {
								if (cell.logicalItemId !== null && !nextIds.has(cell.logicalItemId)) {
									collectPhysicalTreeIds(cell.tree, retiredPhysicalIds);
									detachListCell(
										state,
										list,
										cell,
										getRecord(update.hostId) !== undefined && cell.item.recyclable
											? 'reuse'
											: 'destroy',
										batch.version,
									);
								}
							}
							for (const [itemId, cell] of [...list.retainedByItem]) {
								if (nextIds.has(itemId)) continue;
								list.retainedByItem.delete(itemId);
								if (state.papi.isChild(list.node, cell.tree.node)) {
									state.papi.remove(list.node, cell.tree.node);
								}
								list.cellsBySign.delete(cell.sign);
								disposePhysicalTree(state, cell.tree);
							}
						}
					} catch (error) {
						preApplicationFailed = true;
						preApplicationError = error;
					}
				}
				if (initiallyEmpty || (acceptedDenseRecords !== null && compactHostCount !== undefined)) {
					state.records = stagedRecords;
				} else {
					for (const id of deletedRecords) state.records.delete(id);
					for (const [id, record] of stagedRecords) state.records.set(id, record);
				}
				if (stagedDeferredRuns !== null) {
					state.deferredRuns =
						state.deferredRuns === null
							? stagedDeferredRuns
							: [...state.deferredRuns, ...stagedDeferredRuns];
				}
				if (state.deferredRuns !== null && deletedRecords.size !== 0) {
					// A declaration outlives the hosts it declares, so a destroyed host
					// has to be struck from it. Otherwise the next read that missed
					// `records` would derive the host again, and a destroyed row would
					// come back the moment its list asked for it.
					for (const id of deletedRecords) {
						const declared = declaringRun(state.deferredRuns, id);
						if (declared !== undefined) (declared.run.removed ??= new Set()).add(declared.offset);
					}
					// A run declares hosts under one list. Once that list is gone the
					// declaration answers for nothing, and keeping it would retain the
					// run's whole value array for a tree that no longer has it.
					const live = state.deferredRuns.filter(
						(run) => typeof run.parent !== 'number' || state.records.has(run.parent),
					);
					state.deferredRuns = live.length === 0 ? null : live;
				}
				if (batch.commands.length !== 0) {
					state.teardownRecords = acceptedTeardownRecords;
				}
				if (stagedRootChildren !== null) state.rootChildren = stagedRootChildren;
				if (initiallyNoGenerations) {
					state.generations = stagedGenerations;
					for (const id of stagedGenerations.keys()) {
						if (id > state.maxExplicitId) state.maxExplicitId = id;
					}
				} else {
					for (const [id, generation] of stagedGenerations) {
						state.generations.set(id, generation);
						if (id > state.maxExplicitId) state.maxExplicitId = id;
					}
				}
				if (compactHostCount !== undefined) {
					state.implicitInitialGenerations = true;
					// The accepted segment's implicit identities occupy their id
					// range even though no generation entry is stored for them.
					for (const operation of operations) {
						if (operation.op !== 'mount-template') continue;
						const width = operation.parents.length;
						const rows = operation.count ?? 1;
						const firstId = operation.dense?.firstId ?? operation.firstId;
						if (firstId === undefined) continue;
						const lastId = firstId + rows * width - 1;
						if (lastId > state.maxExplicitId) state.maxExplicitId = lastId;
					}
				}
				state.portalRoot = stagedPortalRoot;
				const portalChildrenChanges = readStagedPortalChildren();
				if (portalChildrenChanges !== null) {
					for (const [key, entry] of portalChildrenChanges) {
						if (entry.children.length === 0) state.portalChildren.delete(key);
						else state.portalChildren.set(key, entry);
					}
				}
				state.hasMainThreadProps = hasMainThreadProps;
				state.hasNativeListTopology = hasNativeListTopology;
				state.acceptedVersion = batch.version;
				if (logicalTeardown) {
					status = 'applied';
					return;
				}
				const activeNodes = new Map(initialNodes);
				try {
					let applicationFailed = preApplicationFailed;
					let applicationError: unknown = preApplicationError;
					try {
						if (applicationFailed) throw applicationError;
						if (firstTreeAction === 'adopt') {
							const logicalRows = firstTree![LYNX_FIRST_TREE_STATE].logicalNodes;
							transferFirstTree(container, firstTree!, firstTreeSource!, activeNodes);
							for (const [id, record] of state.records) {
								// A native list row owns no element yet. Its selector, listeners
								// and main-thread props are installed by the cell that
								// materializes it, exactly as on a root that never adopted.
								if (logicalRows.has(id)) continue;
								const node = nodeFor(activeNodes, id, 'first-tree adoption');
								record.node = node;
								record.selectorInstalled = false;
								// Deliberately unconditional. These are the physical nodes the
								// first-screen container already stamped with its own root's
								// selector, and that root id can equal this one, so a skipped
								// install would leave a node answering an address that now names a
								// different host. Overwriting costs the same single write that
								// clearing would, so there is nothing to defer here.
								ensureNodesRefSelector(state, record);
								if (record.visible) {
									installNativeEvents(
										state,
										node,
										container.root,
										id,
										record.handle.generation,
										record.events,
									);
									if (hasMainThreadProps && isAcceptedHostConnected(state, id)) {
										installMainThreadProps(state, node, record.type, record.props);
									}
								}
							}
						}
						// Adoption replays no structural work, but a public-instance request
						// still has to land: the stamping loop above answers it only for
						// hosts that own a physical node, and a native list row owns none
						// until a cell materializes it, so the request must survive as the
						// record's wanted flag or the row's ref addresses nothing forever.
						const applicationOperations =
							firstTreeAction === 'adopt'
								? operations.filter((operation) => operation.op === 'ensure-public-instance')
								: operations;
						for (const operation of applicationOperations) {
							if (hasNativeListTopology && retiredPhysicalIds.has(operation.id)) continue;
							if (operation.op === 'mount-template') {
								if (operation.dense !== undefined && compactHostCount !== undefined) {
									const dense = operation.dense;
									const program = dense.program;
									const width = program.shape.types.length;
									const parent = physicalNodeForParent(
										activeNodes,
										container.page,
										dense.parent,
										'template run parent',
									);
									const append =
										state.papi.append ??
										((parent: Node, child: Node) => state.papi.insertBefore(parent, child, null));
									const intrinsics = state.papi.intrinsics;
									const intrinsicFactories =
										intrinsics === undefined
											? null
											: program.shape.types.map((type) => {
													if (type === 'view') return intrinsics.view;
													if (type === 'text') return intrinsics.text;
													if (type === '#text' || type === 'raw-text') return intrinsics.rawText;
													return undefined;
												});
									for (let row = 0; row < dense.count; row++) {
										const rowOffset = row * width;
										const valueOffset = row * program.valueCount;
										for (let index = 0; index < width; index++) {
											const offset = rowOffset + index;
											const type = program.shape.types[index]!;
											const props = program.props[index]!;
											const bindings = program.bindings[index];
											const rawText = type === '#text' || type === 'raw-text';
											let text = '';
											if (rawText) {
												text =
													bindings === undefined
														? typeof props.value === 'string'
															? props.value
															: typeof props.text === 'string'
																? props.text
																: ''
														: (dense.values[valueOffset + bindings[0]!.valueIndex] as string);
											}
											const factory = intrinsicFactories?.[index];
											const node =
												factory === undefined
													? state.papi.createElement(type, container.pageComponentUniqueId, text)
													: rawText
														? (factory as (value: string) => Node)(text)
														: (factory as (value: number) => Node)(container.pageComponentUniqueId);
											state.ownedNodes.add(node);
											dense.setNode(offset, node);
											if (bindings !== undefined) {
												if (program.dynamicRoutes[index] === 2) {
													applyDenseScalarHostProps(
														state.papi,
														node,
														props,
														bindings,
														dense.values,
														valueOffset,
													);
												}
											} else {
												const patch = program.patches[index]!;
												if (patch !== EMPTY_RAW_TEXT_CREATE_PATCH) {
													applyProps(
														state,
														node,
														type,
														EMPTY_HOST_PROPS,
														props,
														patch,
														true,
														true,
														false,
													);
												}
											}
										}
										if (dense.firstListenerId !== null) {
											const rowListener = dense.firstListenerId + row * program.eventCount;
											for (const site of program.eventSites) {
												installPreparedNativeEvent(
													state,
													dense.nodes[rowOffset + site.node]!,
													container.root,
													dense.firstId + rowOffset + site.node,
													rowListener,
													site,
												);
											}
										}
										for (let index = 1; index < width; index++) {
											append(
												dense.nodes[rowOffset + program.shape.parents[index]!]!,
												dense.nodes[rowOffset + index]!,
											);
										}
										const root = dense.nodes[rowOffset]!;
										if (dense.parent === null) state.ownedPageRoots.add(root);
										append(parent, root);
									}
									continue;
								}
								const records = operation.records;
								const firstId = compactHostCount === undefined ? undefined : operation.firstId;
								const rows = operation.count ?? 1;
								const width = operation.parents.length;
								const sparse = firstId !== undefined && sparseCompactNodes;
								// Worklet lifetime is owned by connectivity, not by insertion order:
								// a detached subtree installs nothing and `insert` activates it later.
								// A template mount inserts its own root, so the answer is the parent's
								// and it is the same for every instance — one walk for the run rather
								// than one per row.
								const templateParent =
									operation.mainThreadProps === true ? parentHostId(operation.parent) : undefined;
								const templateInteractive =
									templateParent !== undefined &&
									(templateParent === null || isAcceptedHostConnected(state, templateParent));
								for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
									const rowOffset = rowIndex * width;
									for (let nodeIndex = 0; nodeIndex < width; nodeIndex++) {
										const recordIndex = rowOffset + nodeIndex;
										const record = records[recordIndex]!;
										const node = state.papi.createElement(
											record.type,
											container.pageComponentUniqueId,
											record.type === '#text' || record.type === 'raw-text'
												? textValue(record.props)
												: '',
										);
										state.ownedNodes.add(node);
										if (!sparse || nodeIndex === 0) {
											activeNodes.set(
												firstId === undefined ? record.handle.id : firstId + recordIndex,
												node,
											);
										}
										record.node = node;
										operation.teardownDense?.setNode(recordIndex, node);
										// A commit's own `instances` flag says only that this commit's
										// handle deltas are deferred. Whether the peer announces the
										// hosts it will query is a property of the negotiated session,
										// so a commit that does not defer for itself still asks the
										// session — which is what stops a template run in an ordinary
										// later commit from installing a selector on every node it
										// mounts.
										if (
											operation.lazyPublicInstances !== true ||
											(compactHostCount === undefined && !acceptedLazyPublicInstances)
										) {
											bindNodesRefSelector(state, record);
										}
										const patch = operation.patches[recordIndex]!;
										if (patch !== EMPTY_RAW_TEXT_CREATE_PATCH) {
											applyProps(
												state,
												node,
												record.type,
												EMPTY_HOST_PROPS,
												record.props,
												patch,
												true,
												true,
												templateInteractive,
											);
										}
									}
									if (firstId !== undefined && operation.program !== undefined) {
										const listener = operation.firstListenerId;
										if (listener !== null && listener !== undefined) {
											const rowListener = listener + rowIndex * operation.program.eventCount;
											for (const site of operation.program.eventSites) {
												installPreparedNativeEvent(
													state,
													records[rowOffset + site.node]!.node!,
													container.root,
													firstId + rowOffset + site.node,
													rowListener,
													site,
												);
											}
										}
									} else {
										for (let nodeIndex = 0; nodeIndex < width; nodeIndex++) {
											const recordIndex = rowOffset + nodeIndex;
											const record = records[recordIndex]!;
											if (record.events.size === 0) continue;
											installNativeEvents(
												state,
												record.node!,
												container.root,
												firstId === undefined ? record.handle.id : firstId + recordIndex,
												firstId === undefined ? record.handle.generation : 1,
												record.events,
											);
										}
									}
									for (let nodeIndex = 1; nodeIndex < width; nodeIndex++) {
										const record = records[rowOffset + nodeIndex]!;
										state.papi.insertBefore(
											records[rowOffset + operation.parents[nodeIndex]!]!.node!,
											record.node!,
											null,
										);
									}
									const root = records[rowOffset]!.node!;
									const parent = physicalNodeForParent(
										activeNodes,
										container.page,
										operation.parent,
										'template root parent',
									);
									const before =
										operation.before === null
											? typeof operation.parent === 'number' && state.portalChildren.size !== 0
												? firstPortalChildNode(state, activeNodes, operation.parent)
												: null
											: nodeFor(activeNodes, operation.before, 'template before');
									if (operation.parent === null) state.ownedPageRoots.add(root);
									state.papi.insertBefore(parent, root, before);
								}
							} else if (operation.op === 'create') {
								const membership = hasNativeListTopology
									? directListItem((id) => state.records.get(id), operation.id)
									: null;
								if (
									membership !== null &&
									!state.lists.get(membership.listId)?.attachedByItem.has(membership.itemId)
								) {
									continue;
								}
								const node =
									operation.type === 'list'
										? createNativeListNode(state, container, operation.record)
										: state.papi.createElement(
												operation.type,
												container.pageComponentUniqueId,
												textValue(operation.props),
											);
								state.ownedNodes.add(node);
								activeNodes.set(operation.id, node);
								operation.record.node = node;
								bindNodesRefSelector(state, operation.record);
								applyProps(
									state,
									node,
									operation.type,
									{},
									operation.props,
									operation.patch,
									true,
									operation.visible,
									operation.visible &&
										hasMainThreadProps &&
										isAcceptedHostConnected(state, operation.id),
								);
							} else if (operation.op === 'update') {
								if (!activeNodes.has(operation.id)) continue;
								applyProps(
									state,
									nodeFor(activeNodes, operation.id, 'update'),
									operation.type,
									operation.previous,
									operation.next,
									operation.patch,
									false,
									operation.visible,
									operation.visible &&
										hasMainThreadProps &&
										isAcceptedHostConnected(state, operation.id),
								);
							} else if (operation.op === 'recreate') {
								if (!activeNodes.has(operation.id)) continue;
								const previous = nodeFor(activeNodes, operation.id, 'recreate');
								removeAllNativeEvents(state, previous);
								removeMainThreadRef(state, previous);
								if (operation.type === 'list') disposeNativeListState(state, operation.id);
								const replacement =
									operation.type === 'list'
										? createNativeListNode(state, container, operation.record)
										: state.papi.createElement(
												operation.type,
												container.pageComponentUniqueId,
												textValue(operation.props),
											);
								state.ownedNodes.add(replacement);
								activeNodes.set(operation.id, replacement);
								operation.record.node = replacement;
								// Preparation already cleared `selectorInstalled` for the node this
								// one replaces, so a host that had asked is re-answered here on the
								// node that took its place.
								bindNodesRefSelector(state, operation.record);
								applyProps(
									state,
									replacement,
									operation.type,
									{},
									operation.props,
									operation.patch,
									true,
									operation.visible,
									operation.visible &&
										hasMainThreadProps &&
										isAcceptedHostConnected(state, operation.id),
								);
								if (!operation.visible) state.papi.setAttribute(replacement, 'hidden', true);
								if (operation.visible) {
									installNativeEvents(
										state,
										replacement,
										container.root,
										operation.id,
										operation.generation,
										operation.events,
									);
								}
								for (const childId of operation.children) {
									state.papi.insertBefore(
										replacement,
										nodeFor(activeNodes, childId, 'recreate child'),
										null,
									);
								}
								for (const childId of operation.portalChildren) {
									state.papi.insertBefore(
										replacement,
										nodeFor(activeNodes, childId, 'recreate portal child'),
										null,
									);
								}
								if (operation.parent !== undefined) {
									if (operation.parent === null) state.ownedPageRoots.add(replacement);
									state.papi.replace(replacement, previous);
									if (operation.parent === null) state.ownedPageRoots.delete(previous);
								}
								state.ownedNodes.delete(previous);
							} else if (operation.op === 'insert' || operation.op === 'move') {
								const parentRecord =
									typeof operation.parent === 'number'
										? state.records.get(operation.parent)
										: undefined;
								if (parentRecord?.type === 'list') continue;
								if (!activeNodes.has(operation.id)) continue;
								const node = nodeFor(activeNodes, operation.id, operation.op);
								const parent = physicalNodeForParent(
									activeNodes,
									container.page,
									operation.parent,
									`${operation.op} parent`,
								);
								const before =
									operation.before === null
										? typeof operation.parent === 'number'
											? state.portalChildren.size === 0
												? null
												: firstPortalChildNode(state, activeNodes, operation.parent)
											: null
										: nodeFor(activeNodes, operation.before, `${operation.op} before`);
								if (operation.parent === null) state.ownedPageRoots.add(node);
								if (hasMainThreadProps && operation.wasConnected && !operation.willBeConnected) {
									deactivateMainThreadSubtree(state, operation.id);
								}
								state.papi.insertBefore(parent, node, before);
								if (hasMainThreadProps && !operation.wasConnected && operation.willBeConnected) {
									activateMainThreadSubtree(state, operation.id);
								}
								if (operation.previousParent === null && operation.parent !== null) {
									state.ownedPageRoots.delete(node);
								}
							} else if (operation.op === 'remove') {
								const parentRecord =
									typeof operation.parent === 'number'
										? state.records.get(operation.parent)
										: undefined;
								if (parentRecord?.type === 'list' || !activeNodes.has(operation.id)) continue;
								const node = nodeFor(activeNodes, operation.id, 'remove');
								const parent = physicalNodeForParent(
									activeNodes,
									container.page,
									operation.parent,
									'remove parent',
								);
								if (hasMainThreadProps) deactivateMainThreadSubtree(state, operation.id);
								state.papi.remove(parent, node);
								if (operation.parent === null) state.ownedPageRoots.delete(node);
							} else if (operation.op === 'ensure-public-instance') {
								const record = state.records.get(operation.id);
								if (record !== undefined) wantNodesRefSelector(state, record);
							} else if (operation.op === 'visibility') {
								if (!activeNodes.has(operation.id)) continue;
								const record = state.records.get(operation.id)!;
								// Element PAPI cannot attach attributes to raw-text nodes. Their nearest
								// host ancestor receives the same retained-tree visibility command.
								if (record.type === '#text' || record.type === 'raw-text') continue;
								const node = nodeFor(activeNodes, operation.id, 'visibility');
								if (operation.state === 'hidden') {
									removeAllNativeEvents(state, node);
									removeMainThreadRef(state, node);
								}
								state.papi.setAttribute(
									node,
									'hidden',
									operation.state === 'hidden' ? true : operation.authoredHidden,
								);
								if (operation.state === 'visible') {
									if (hasMainThreadProps && isAcceptedHostConnected(state, operation.id)) {
										installMainThreadProps(state, node, record.type, record.props);
									}
									installNativeEvents(
										state,
										node,
										container.root,
										operation.id,
										operation.generation,
										operation.events,
									);
								}
							} else if (operation.op === 'event') {
								if (!activeNodes.has(operation.id)) continue;
								const node = nodeFor(activeNodes, operation.id, 'event');
								if (!operation.visible || operation.next === null) {
									removeNativeEvent(state, node, operation.type);
								} else {
									installNativeEvent(
										state,
										node,
										container.root,
										operation.id,
										operation.generation,
										operation.type,
										operation.next,
									);
								}
							} else if (operation.op === 'destroy') {
								const node = activeNodes.get(operation.id);
								if (node !== undefined) {
									if (state.lists.has(operation.id)) disposeNativeListState(state, operation.id);
									removeAllNativeEvents(state, node, teardownMaySkipUnbind());
									removeMainThreadRef(state, node);
									state.ownedNodes.delete(node);
								}
								activeNodes.delete(operation.id);
							}
						}
						for (const update of listUpdates) {
							if (state.records.has(update.hostId)) applyListUpdate(state, update);
							else disposeNativeListState(state, update.hostId);
						}
					} catch (error) {
						if (!applicationFailed) {
							applicationFailed = true;
							applicationError = error;
						}
					}
					try {
						state.papi.flush(container.page);
						state.cleanupNeedsFlush = false;
					} catch (error) {
						// The logical batch is already accepted, including root removals and
						// destroys. Preserve the flush obligation for terminal disposal.
						state.cleanupNeedsFlush = true;
						if (!applicationFailed) {
							applicationFailed = true;
							applicationError = error;
						}
					}
					if (applicationFailed) throw applicationError;
					status = 'applied';
				} catch (error) {
					state.faulted = true;
					invalidateMainThreadLifetimesAfterFault(state);
					status = 'faulted';
					fault = error;
					throw error;
				}
			} finally {
				state.applying = false;
			}
		},
		abort() {
			if (status === 'prepared') status = 'aborted';
		},
	};
	return Object.freeze(prepared);
}

export function createLynxHostDriver<
	Node extends LynxElementRef = LynxElementRef,
>(): LynxHostDriver<Node> {
	const driver: LynxHostDriver<Node> = {
		id: LYNX_RENDERER_ID,
		capabilities: {
			text: 'host',
			visibility: true,
			templateMount: true,
			templateProgramMount: true,
			templateProgramRuns: true,
			deferredTemplateProgramRuns: true,
			teardownRuns: true,
			lazyPublicInstances: true,
			stableStaticHostProps: true,
		},
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
		prepareBatch(container, batch, _context) {
			return prepareLynxHostBatch(container, batch);
		},
		getPublicInstance(container, id) {
			const state = container[LYNX_HOST_STATE];
			const record = state.records.get(id);
			if (record === undefined) return null;
			wantNodesRefSelector(state, record);
			return record.handle;
		},
	};
	return Object.freeze(driver);
}

/**
 * One host's identity, without requesting a public instance.
 *
 * `driver.getPublicInstance` is the demand path for a `nodes-ref` selector and
 * installs one as a side effect. A caller that only needs to know whether a
 * host exists at a given generation must not pay for that, and must not make
 * every host it asks about permanently selectable — the native list attachment
 * stream asks about every node of every cell on every recycle.
 */
export function getLynxHostHandle<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	id: number,
): LynxHostHandle | null {
	return container[LYNX_HOST_STATE].records.get(id)?.handle ?? null;
}

/**
 * Whether this thread declared `id` rather than building it.
 *
 * Nothing was created here for a declared host, so the background derived no
 * handle for it and nothing about its identity may be published to that side.
 * The answer survives materialization: what decides is that the host was never
 * created, not whether it currently holds a record.
 */
export function isLynxHostDeclared<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	id: number,
): boolean {
	return declaringRun(container[LYNX_HOST_STATE].deferredRuns, id) !== undefined;
}

export function getLynxHostEventListener<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	id: number,
	type: string,
): UniversalEventListenerDescriptor | null {
	return container[LYNX_HOST_STATE].records.get(id)?.events.get(type) ?? null;
}

/** True only while a logical host currently owns a physical Element PAPI node. */
export function isLynxHostAttached<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	id: number,
): boolean {
	const state = container[LYNX_HOST_STATE];
	const record = state.records.get(id);
	return (
		!state.disposed &&
		!state.disposing &&
		!state.faulted &&
		record?.node != null &&
		isRootConnected((hostId) => state.records.get(hostId), id)
	);
}

export interface LynxHostPublicState {
	readonly attached: boolean;
	readonly listDescendant: boolean;
}

/** Commit-time public state derived in one accepted-ancestry walk. */
export function getLynxHostPublicState<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	id: number,
): LynxHostPublicState {
	const state = container[LYNX_HOST_STATE];
	const record = state.records.get(id);
	if (record === undefined) return { attached: false, listDescendant: false };
	let current = record;
	let listDescendant = false;
	let connected = false;
	const visited = new Set<number>();
	while (true) {
		if (visited.has(current.handle.id)) throw hostError('host ancestry contains a cycle.');
		visited.add(current.handle.id);
		const parentId = parentHostId(current.parent);
		if (parentId === null) {
			connected = true;
			break;
		}
		if (parentId === undefined) break;
		const parent = state.records.get(parentId);
		if (parent === undefined) break;
		if (parent.type === 'list' && current.type === 'list-item') listDescendant = true;
		current = parent;
	}
	return {
		attached:
			!state.disposed && !state.disposing && !state.faulted && record.node !== null && connected,
		listDescendant,
	};
}

export interface LynxListDiagnostics {
	readonly hostId: number;
	readonly logicalItems: number;
	readonly physicalCells: number;
	readonly attachedCells: number;
	readonly pooledCells: number;
	readonly createdCells: number;
	readonly reusedCells: number;
	readonly enterCount: number;
	readonly leaveCount: number;
}

/** Deterministic source-level counters for tests and the list allocation benchmark. */
export function getLynxListDiagnostics<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	hostId: number,
): LynxListDiagnostics | null {
	const list = container[LYNX_HOST_STATE].lists.get(hostId);
	if (list === undefined || list.disposed) return null;
	let pooledCells = 0;
	for (const pool of list.recyclePools.values()) pooledCells += pool.length;
	return Object.freeze({
		hostId,
		logicalItems: list.items.length,
		physicalCells: list.cellsBySign.size,
		attachedCells: list.attachedByItem.size,
		pooledCells,
		createdCells: list.createdCells,
		reusedCells: list.reusedCells,
		enterCount: list.enterCount,
		leaveCount: list.leaveCount,
	});
}

export interface LynxResolvedNativeEvent {
	readonly listener: number;
	readonly priority: UniversalEventListenerDescriptor['priority'];
}

/** Resolve an opaque PAPI callback token against the currently accepted physical host. */
export function resolveLynxHostNativeEvent<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
	token: unknown,
): LynxResolvedNativeEvent | null {
	const state = container[LYNX_HOST_STATE];
	const identity = decodeLynxNativeEventToken(token);
	if (state.disposed || state.disposing || state.faulted || identity.root !== container.root) {
		return null;
	}
	const record = state.records.get(identity.id);
	if (
		record === undefined ||
		record.node === null ||
		!record.visible ||
		record.handle.generation !== identity.generation ||
		!isRootConnected((id) => state.records.get(id), identity.id)
	) {
		return null;
	}
	const physical = state.nativeEvents.get(record.node);
	if (physical === undefined || typeof token !== 'string') return null;
	for (const [type, descriptor] of record.events) {
		const registration = physical.get(type);
		if (
			descriptor.id !== identity.listener ||
			registration?.source !== 'background' ||
			registration.listener !== token
		) {
			continue;
		}
		return Object.freeze({ listener: descriptor.id, priority: descriptor.priority });
	}
	return null;
}

function normalizeCleanupError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function indexPhysicalNodes<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	nodes: ReadonlySet<Node>,
): ReadonlyMap<number, Node> {
	const byNativeId = new Map<number, Node>();
	for (const node of nodes) {
		const nativeId = papi.getUniqueId(node);
		if (!Number.isSafeInteger(nativeId)) {
			throw hostError('cleanup native ID must be a safe integer.');
		}
		const previous = byNativeId.get(nativeId);
		if (previous !== undefined && previous !== node && !papi.isEqual(previous, node)) {
			throw hostError(`cleanup native ID ${nativeId} is not unique.`);
		}
		if (previous === undefined) byNativeId.set(nativeId, node);
	}
	return byNativeId;
}

function containsPhysicalNode<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	byNativeId: ReadonlyMap<number, Node>,
	candidate: Node,
): boolean {
	const nativeId = papi.getUniqueId(candidate);
	if (!Number.isSafeInteger(nativeId)) {
		throw hostError('cleanup parent native ID must be a safe integer.');
	}
	const owned = byNativeId.get(nativeId);
	if (owned === undefined) return false;
	// Native parent lookup may return a different opaque wrapper for the same
	// element. The unique native-ID index keeps this equality fallback O(1)
	// instead of rescanning the complete owned tree.
	return owned === candidate || papi.isEqual(owned, candidate);
}

function completedFirstTreeCleanup(): LynxHostCleanupResult {
	return Object.freeze({
		complete: true,
		removedRoots: 0,
		remainingRoots: 0,
		flushed: false,
		errors: Object.freeze([]),
	});
}

/** Dispose a captured tree unless its physical nodes were already transferred. */
export function disposeLynxFirstTree<Node extends LynxElementRef>(
	firstTree: LynxFirstTree<Node>,
): LynxHostCleanupResult {
	if (firstTree === null || typeof firstTree !== 'object') {
		throw hostError('firstTree must be a captured Lynx first tree.');
	}
	const journal = firstTree[LYNX_FIRST_TREE_STATE];
	if (journal === undefined) throw hostError('firstTree has no Lynx ownership journal.');
	if (journal.status !== 'available') return completedFirstTreeCleanup();
	const owner = firstTreeOwner(firstTree);
	return disposeLynxHostContainer(owner);
}

/**
 * Retry-safe terminal cleanup for success and post-accept fault paths.
 * Incomplete attempts retain their ownership journal and logical records so a
 * repeated dispose can finish before the caller acknowledges teardown.
 */
export function disposeLynxHostContainer<Node extends LynxElementRef>(
	container: LynxHostContainer<Node>,
): LynxHostCleanupResult {
	const state = container[LYNX_HOST_STATE];
	if (state.disposed) {
		return Object.freeze({
			complete: true,
			removedRoots: 0,
			remainingRoots: 0,
			flushed: false,
			errors: Object.freeze([]),
		});
	}
	state.disposing = true;
	const errors: Error[] = [];
	// Snapshot every physical reference before list teardown releases its ordinary
	// journals. Failed external-edge removal re-adds that node to ownedNodes so a
	// later dispose attempt can retry it.
	const cleanupNodes = new Set(state.ownedNodes);
	for (const node of state.ownedPageRoots) cleanupNodes.add(node);
	// A compiled main-thread program's nodes are in its run rather than in
	// `ownedNodes` (issue #163 C20), and this is the reader that wants all of
	// them: everything physical the container has to take back out of the page.
	// Walking the runs here is one pass at teardown in place of two writes per
	// node at mount, and a retry that re-adds one puts it in `ownedNodes` — which
	// is why that set is read first and this only ever adds.
	for (const run of state.programRuns) {
		if (run.count !== 1) {
			// Every entry is owned and none of them is `undefined`: a dense instance
			// paints every hole it declares, which is the condition that made the run
			// dense in the first place.
			for (const node of run.nodes) cleanupNodes.add(node as Node);
			continue;
		}
		const hosts = run.ids.length;
		for (let position = 0; position < hosts; position++) {
			cleanupNodes.add(run.nodes[position] as Node);
		}
		for (let range = 0; range < run.rangeIds.length; range++) {
			// A hole this first screen filled itself is an ordinary host with an
			// ordinary record, already in `ownedNodes`; the program painted nothing
			// there and owns nothing to remove.
			if (run.rangeIds[range] === undefined) continue;
			cleanupNodes.add(run.nodes[hosts + range] as Node);
		}
	}
	let cleanupNodeIndex: ReadonlyMap<number, Node> | null = null;
	try {
		cleanupNodeIndex = indexPhysicalNodes(state.papi, cleanupNodes);
	} catch (error) {
		errors.push(normalizeCleanupError(error));
	}
	for (const listId of [...state.lists.keys()]) {
		try {
			disposeNativeListState(state, listId);
			state.cleanupNeedsFlush = true;
		} catch (error) {
			errors.push(normalizeCleanupError(error));
		}
	}
	for (const node of [...state.mainThreadRefs.keys()]) {
		try {
			removeMainThreadRef(state, node);
		} catch (error) {
			errors.push(normalizeCleanupError(error));
		}
	}
	// A program installed its listeners itself and the run says which, so this is
	// where those tuples enter the journal the loop below clears (issue #215 D3).
	// Done as a fill rather than as a second unbind loop so retry stays in one
	// place: `removeNativeEvent` deletes on success and leaves the entry on
	// failure, and `nativeEvents.size` is what the completeness gate reads.
	materializeProgramEvents(state);
	for (const [node, events] of [...state.nativeEvents]) {
		for (const type of [...events.keys()]) {
			try {
				removeNativeEvent(state, node, type);
				state.cleanupNeedsFlush = true;
			} catch (error) {
				errors.push(normalizeCleanupError(error));
			}
		}
	}
	let removedRoots = 0;
	let unresolvedExternalRoots = 0;
	const releaseRootOwnership = (node: Node): void => {
		if (!state.ownedPageRoots.delete(node)) return;
		state.cleanupNeedsFlush = true;
		removedRoots += 1;
	};
	const retainUnresolvedOwnership = (node: Node): void => {
		state.ownedNodes.add(node);
		// Logical page roots already remain counted in ownedPageRoots. A child
		// reparented beneath a non-owned native node is itself another physical
		// cleanup root until that external edge can be removed.
		if (!state.ownedPageRoots.has(node)) unresolvedExternalRoots += 1;
	};
	for (const node of cleanupNodes) {
		let parent: Node | null;
		try {
			parent = state.papi.getParent(node);
		} catch (error) {
			errors.push(normalizeCleanupError(error));
			retainUnresolvedOwnership(node);
			continue;
		}
		if (parent === null) {
			releaseRootOwnership(node);
			continue;
		}
		if (cleanupNodeIndex === null) {
			retainUnresolvedOwnership(node);
			continue;
		}
		let parentIsOwned: boolean;
		try {
			parentIsOwned = containsPhysicalNode(state.papi, cleanupNodeIndex, parent);
		} catch (error) {
			errors.push(normalizeCleanupError(error));
			retainUnresolvedOwnership(node);
			continue;
		}
		if (parentIsOwned) {
			// Nested ownership is released by removing the one external edge above
			// this subtree. Do not turn normal cleanup into one native removal per host.
			releaseRootOwnership(node);
			continue;
		}

		let externalEdgeRemoved = false;
		try {
			state.papi.remove(parent, node);
			externalEdgeRemoved = true;
		} catch (error) {
			try {
				// Native removal may detach and then throw. It is also safe if the node
				// ended up beneath another owned node: the remaining owned boundary edge
				// will release that complete subtree.
				const currentParent = state.papi.getParent(node);
				externalEdgeRemoved =
					currentParent === null ||
					containsPhysicalNode(state.papi, cleanupNodeIndex, currentParent);
				if (!externalEdgeRemoved) errors.push(normalizeCleanupError(error));
			} catch (inspectionError) {
				errors.push(normalizeCleanupError(error));
				errors.push(normalizeCleanupError(inspectionError));
			}
		}
		if (!externalEdgeRemoved) {
			retainUnresolvedOwnership(node);
			continue;
		}
		state.cleanupNeedsFlush = true;
		releaseRootOwnership(node);
	}
	let flushed = false;
	if (state.cleanupNeedsFlush) {
		try {
			state.papi.flush(container.page);
			state.cleanupNeedsFlush = false;
			flushed = true;
		} catch (error) {
			errors.push(normalizeCleanupError(error));
		}
	}
	const remainingRoots = state.ownedPageRoots.size + unresolvedExternalRoots;
	const complete =
		remainingRoots === 0 &&
		state.nativeEvents.size === 0 &&
		state.mainThreadRefs.size === 0 &&
		state.mainThreadRefOwners.size === 0 &&
		state.lists.size === 0 &&
		!state.cleanupNeedsFlush;
	if (complete) {
		const firstTree = state.firstTree;
		state.ownedNodes.clear();
		clearProgramRuns(state);
		state.nativeEvents.clear();
		state.mainThreadRefs.clear();
		state.mainThreadRefOwners.clear();
		state.lists.clear();
		state.records.clear();
		state.teardownRecords = null;
		// A declaration retains its whole value array, which is the one thing a
		// deferred run is deliberately large in. Clearing records without it would
		// keep 10,000 rows of strings alive on a container that has nothing left.
		state.deferredRuns = null;
		state.rootChildren.length = 0;
		state.generations.clear();
		state.portalRoot = null;
		state.portalChildren.clear();
		state.firstTree = null;
		state.disposing = false;
		state.disposed = true;
		if (firstTree !== null) {
			const journal = firstTree[LYNX_FIRST_TREE_STATE];
			journal.owner = null;
			journal.status = 'disposed';
		}
	}
	return Object.freeze({
		complete,
		removedRoots,
		remainingRoots,
		flushed,
		errors: Object.freeze(errors),
	});
}
