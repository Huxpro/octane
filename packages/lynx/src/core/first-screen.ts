import type { UniversalEventPriority, UniversalSerializableValue } from 'octane/universal/native';
import type { LynxListItemDescriptor } from './list.js';
import type { LynxElementRef } from './papi.js';

/** Clone-safe event identity retained while ordinary events wait for adoption. */
export interface LynxFirstTreeEventSnapshot {
	readonly host: number;
	readonly generation: number;
	readonly type: string;
	readonly listener: number;
	readonly priority: UniversalEventPriority;
}

/** Clone-safe description of one physical node painted by the main runtime. */
export interface LynxFirstTreeNodeSnapshot {
	readonly id: number;
	readonly nativeId: number;
	readonly type: string;
	readonly generation: number;
	readonly parent: number | null;
	readonly children: readonly number[];
	readonly props: Readonly<Record<string, UniversalSerializableValue>>;
	readonly visible: boolean;
	readonly events: readonly LynxFirstTreeEventSnapshot[];
}

/**
 * A record the main runtime painted logically but not physically.
 *
 * Native list rows are the only such records. The platform materializes a row
 * through `componentAtIndex` when it needs one, so an unscrolled first screen
 * holds every row as a live record with no element behind it — a five-row list
 * paints exactly one node, the `<list>` itself.
 *
 * These stay in the main-local journal rather than in the snapshot. The
 * snapshot's contract is one painted physical node each, which is what its
 * `nativeId` means and what its wire validator enforces; widening that to carry
 * rows would change a format every peer validates on receipt, to describe nodes
 * no peer reads. The background only ever tests whether a first tree was offered
 * at all.
 */
export interface LynxFirstTreeLogicalNodeSnapshot {
	readonly id: number;
	/** Never painted, so there is no physical identity to compare. */
	readonly nativeId: null;
	readonly type: string;
	readonly generation: number;
	readonly parent: number | null;
	readonly children: readonly number[];
	readonly props: Readonly<Record<string, UniversalSerializableValue>>;
	readonly visible: boolean;
	readonly events: readonly LynxFirstTreeEventSnapshot[];
}

/** Either half of a captured tree: painted nodes and the rows behind them. */
export type LynxFirstTreeCapturedNode =
	LynxFirstTreeNodeSnapshot | LynxFirstTreeLogicalNodeSnapshot;

/** Main-local record of one native list as the captured tree left it. */
export interface LynxFirstTreeListJournal {
	readonly host: number;
	readonly items: readonly LynxListItemDescriptor[];
	/**
	 * Native recycling traffic this list had seen when it was captured. Adoption
	 * re-reads it: any `componentAtIndex` or `enqueueComponent` call in between
	 * moves it, and a moved epoch means the captured picture is stale.
	 */
	readonly epoch: number;
}

/**
 * Serializable first-paint contract. PAPI node references deliberately remain
 * in the opaque journal carried by {@link LynxFirstTree}.
 */
export interface LynxFirstTreeSnapshot {
	readonly format: 1;
	readonly renderer: 'lynx';
	readonly root: number;
	readonly version: number;
	readonly plan: string | null;
	readonly roots: readonly number[];
	readonly nodes: readonly LynxFirstTreeNodeSnapshot[];
}

export interface CaptureLynxFirstTreeOptions {
	/** Deterministic compiler plan identity used only to enrich mismatch reports. */
	readonly plan?: string;
}

export interface LynxResolvedFirstTreeEvent {
	readonly host: number;
	readonly generation: number;
	readonly type: string;
	readonly listener: number;
	readonly priority: UniversalEventPriority;
}

export const LYNX_FIRST_SCREEN_REFUSED = 'OCTANE_LYNX_FIRST_SCREEN_REFUSED' as const;

/**
 * A first screen this build cannot paint, as opposed to one it painted wrongly.
 *
 * The distinction is #163's C3 boundary. A synchronous first screen is an
 * optimization over a page the background renders anyway, so meeting the edge
 * of what the main thread can paint costs the optimization and nothing else:
 * the receiver retires the attempt as `skipped` and the page arrives on the
 * command path, which is the fallback the design names. A *defect* — a `<list>`
 * nested in a `<list>`, a program whose create disagrees with its own plan, an
 * error out of application setup — is the opposite case and still faults,
 * because nothing about the command path makes a wrong page right and a quiet
 * decline would hide it.
 *
 * Recognized by identity for a reason a comparison against the message could
 * not give: application code renders inside this pass, and an `Error` a
 * component happened to throw with the same text would otherwise buy itself a
 * decline.
 *
 * It lives here rather than beside either thrower because both the renderer and
 * the direct applier raise one, and the boundary is the same boundary from
 * either side: the renderer refuses a component nothing compiled for it, and
 * the applier refuses a tree the renderer can produce but the mount cannot
 * finish.
 */
export class LynxFirstScreenRefusalError extends Error {
	readonly code = LYNX_FIRST_SCREEN_REFUSED;

	constructor(message: string) {
		super(message);
		this.name = 'LynxFirstScreenRefusalError';
	}
}

export const LYNX_FIRST_TREE_MISMATCH = 'OCTANE_LYNX_FIRST_SCREEN_MISMATCH' as const;

/** Stable mismatch category; the host repairs from the background tree. */
export class LynxFirstTreeMismatchError extends Error {
	readonly code = LYNX_FIRST_TREE_MISMATCH;
	readonly path: string;
	readonly plan: string | null;

	constructor(path: string, message: string, plan: string | null = null) {
		super(`Octane Lynx first-screen mismatch at ${path}: ${message}`);
		this.name = 'LynxFirstTreeMismatchError';
		this.path = path;
		this.plan = plan;
	}
}

export const LYNX_FIRST_TREE_STATE: unique symbol = Symbol('octane.lynx.first-tree-state');

export interface LynxFirstTreeState<Node extends LynxElementRef> {
	owner: unknown;
	status: 'available' | 'transferred' | 'disposed' | 'released';
	/** The token index, once a tap has asked for one. */
	eventsByToken: Map<string, LynxResolvedFirstTreeEvent> | null;
	/** Builds it; dropped once it has run or the tree is released. */
	indexEvents: (() => Map<string, LynxResolvedFirstTreeEvent>) | null;
	/** Records under a native list that the platform has not asked for yet. */
	readonly logicalNodes: Map<number, LynxFirstTreeLogicalNodeSnapshot>;
	/** One entry per native list the captured tree holds, keyed by host ID. */
	readonly lists: Map<number, LynxFirstTreeListJournal>;
	/**
	 * Nodes a compiled main-thread program painted, by the ID it took (#163).
	 *
	 * The inverted handoff, as one map. A program writes no record, so these IDs
	 * appear in no snapshot and adoption has nothing of main's to compare the
	 * background's description against — main knows only which physical node
	 * wears each ID, which is exactly what the transfer needs and all it needs.
	 * That the IDs agree at all is C2c's guarantee, established by construction:
	 * the renderer numbers a program's hosts in the same pre-order the background
	 * numbers the same source in, and a differential test pins it.
	 *
	 * Main-local, like `lists`. Nothing here crosses a thread, because the
	 * background already holds every ID from its own render.
	 */
	readonly programNodes: Map<number, Node>;
	/** The description, once something has asked for one. */
	snapshot: LynxFirstTreeSnapshot | null;
	/** Builds it; dropped once it has run or the tree is released. */
	describe: (() => LynxFirstTreeSnapshot) | null;
}

/** Opaque main-local ownership journal paired with its clone-safe snapshot. */
export interface LynxFirstTree<Node extends LynxElementRef = LynxElementRef> {
	readonly snapshot: LynxFirstTreeSnapshot;
	readonly [LYNX_FIRST_TREE_STATE]: LynxFirstTreeState<Node>;
}

/**
 * Pair the main-local ownership journal with the description the background
 * clones when it adopts.
 *
 * The description is built on first read. Capture already validated the tree, so
 * building it is pure allocation over an already-validated result — and capture
 * runs after the page is published to the host, which puts that allocation
 * between the tree reaching the DOM and the browser painting it. Nothing before
 * adoption reads the description, so nothing waits for it either.
 */
export function createLynxFirstTree<Node extends LynxElementRef>(
	describe: () => LynxFirstTreeSnapshot,
	owner: unknown,
	indexEvents: () => Map<string, LynxResolvedFirstTreeEvent>,
	logicalNodes: Map<number, LynxFirstTreeLogicalNodeSnapshot>,
	lists: Map<number, LynxFirstTreeListJournal>,
	programNodes: Map<number, Node>,
): LynxFirstTree<Node> {
	const state: LynxFirstTreeState<Node> = {
		owner,
		status: 'available',
		eventsByToken: null,
		indexEvents,
		logicalNodes,
		lists,
		programNodes,
		snapshot: null,
		describe,
	};
	return Object.freeze({
		get snapshot(): LynxFirstTreeSnapshot {
			if (state.snapshot !== null) return state.snapshot;
			const build = state.describe;
			if (build === null) {
				throw new Error('Octane Lynx first tree was released before it was described.');
			}
			const snapshot = build();
			state.snapshot = snapshot;
			state.describe = null;
			return snapshot;
		},
		[LYNX_FIRST_TREE_STATE]: state,
	});
}

/** Release clone-unsafe journal state after adoption replay has drained. */
export function releaseLynxFirstTree(firstTree: LynxFirstTree): void {
	const state = firstTree[LYNX_FIRST_TREE_STATE];
	if (state.status === 'released') return;
	if (state.status === 'available') {
		throw new Error('Octane Lynx first tree must be adopted or disposed before release.');
	}
	state.owner = null;
	state.eventsByToken?.clear();
	state.eventsByToken = null;
	state.indexEvents = null;
	state.logicalNodes.clear();
	state.lists.clear();
	state.programNodes.clear();
	// The builder closes over the source container's records, so dropping it is
	// what lets a released tree stop retaining the page it described.
	state.describe = null;
	state.status = 'released';
}

const EMPTY_EVENT_INDEX: ReadonlyMap<string, LynxResolvedFirstTreeEvent> = new Map();

/**
 * The painted tree's token index, built on first read.
 *
 * Only a tap resolves through this map, and a tap on the painted tree happens
 * after the paint by definition — while capture, which fills it, runs before
 * one. Building a token-keyed map of every bound event is the largest single
 * item the capture walk spends its time on, so it waits here with the
 * description rather than sitting between the tree reaching the DOM and the
 * browser painting it.
 *
 * The builder closes over what capture already validated and nothing live, so
 * it answers identically whether the first tap comes before adoption, after it,
 * or after terminal cleanup has emptied the container.
 *
 * Nothing else reads it. Adoption compares the description, not the tokens, so a
 * page whose first tap arrives after the background has adopted never builds
 * this at all — and one whose first tap arrives before it pays here instead of
 * in front of the paint.
 */
function lynxFirstTreeEventIndex(
	firstTree: LynxFirstTree,
): ReadonlyMap<string, LynxResolvedFirstTreeEvent> {
	const state = firstTree[LYNX_FIRST_TREE_STATE];
	const index = state.eventsByToken;
	if (index !== null) return index;
	const build = state.indexEvents;
	// A released tree kept no index and can build none; it resolves nothing,
	// which is what an emptied map answered before.
	if (build === null) return EMPTY_EVENT_INDEX;
	const built = build();
	state.eventsByToken = built;
	state.indexEvents = null;
	return built;
}

/** Resolve a painted placeholder token without consulting adopted listeners. */
export function resolveLynxFirstTreeEvent(
	firstTree: LynxFirstTree,
	token: unknown,
): LynxResolvedFirstTreeEvent | null {
	if (typeof token !== 'string') return null;
	return lynxFirstTreeEventIndex(firstTree).get(token) ?? null;
}

/**
 * Every token the painted tree resolves.
 *
 * Its callers are the differential captures, which compare two trees' whole
 * token sets rather than one token. It reads through the same door the resolver
 * does, so no caller can observe an index a tap would not have built.
 */
export function lynxFirstTreeEventTokens(firstTree: LynxFirstTree): readonly string[] {
	return [...lynxFirstTreeEventIndex(firstTree).keys()];
}
