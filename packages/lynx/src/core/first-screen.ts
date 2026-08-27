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

/**
 * One compiled main-thread program, as the mount left it (issue #163 C20).
 *
 * A program's hosts are numbered together and created together, so main already
 * holds them as two arrays in one order: the ids the renderer assigned and the
 * nodes the create returned. Journalling them per node copies that pair into a
 * `Set` and a `Map` one entry at a time — C19 priced it at 133 ms of main-thread
 * script at 30,000 rows, plus 26 more re-copying the map at capture. Keeping the
 * pair is the same information without the copy, and the per-node view is built
 * where it is actually read.
 */
export interface LynxProgramRun<Node extends LynxElementRef> {
	/** The ids `assignProgramIds` gave this program's hosts, in plan order. */
	readonly ids: readonly number[];
	/** Per keyed range: the id of a hole the program painted, or `undefined`. */
	readonly rangeIds: readonly (number | undefined)[];
	/**
	 * What the create returned: `ids.length` hosts, then one entry per range —
	 * the painted node, or `undefined` for a hole this first screen filled itself.
	 */
	readonly nodes: readonly (Node | undefined)[];
	/** How many of `nodes` this container owns: hosts plus painted holes. */
	readonly owned: number;
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
	 * Every compiled main-thread program the captured tree holds, one entry each.
	 *
	 * The inverted handoff. A program writes no record, so its IDs appear in no
	 * snapshot and adoption has nothing of main's to compare the background's
	 * description against — main knows only which physical node wears each ID,
	 * which is exactly what the transfer needs and all it needs. That the IDs
	 * agree at all is C2c's guarantee, established by construction: the renderer
	 * numbers a program's hosts in the same pre-order the background numbers the
	 * same source in, and a differential test pins it.
	 *
	 * Main-local, like `lists`. Nothing here crosses a thread, because the
	 * background already holds every ID from its own render.
	 */
	programRuns: LynxProgramRun<Node>[];
	/** How many physical nodes those runs account for, summed once at capture. */
	readonly programNodeCount: number;
	/**
	 * Whether every run's ids sit strictly after the previous run's, which is
	 * what lets a lookup answer from the runs themselves (issue #215 D1).
	 *
	 * Sibling programs — a keyed `@for` of rows, the shape the whole train is
	 * aimed at — take adjacent id spans, so a search can decide *not a program
	 * node* from the gap between two runs. A program nested inside another
	 * program's keyed-range member does not: its ids are minted in the middle of
	 * the outer program's span, so the two spans overlap and a gap proves
	 * nothing. The mount says which of the two it built rather than this
	 * guessing, and the overlapping case falls back to the per-ID map below.
	 */
	readonly programRunsDisjoint: boolean;
	/** The per-ID map, built only when the runs cannot answer directly. */
	programNodes: Map<number, Node> | null;
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
	programRuns: LynxProgramRun<Node>[],
	programNodeCount: number,
	programRunsDisjoint: boolean,
): LynxFirstTree<Node> {
	const state: LynxFirstTreeState<Node> = {
		owner,
		status: 'available',
		eventsByToken: null,
		indexEvents,
		logicalNodes,
		lists,
		programRuns,
		programNodeCount,
		programRunsDisjoint,
		programNodes: null,
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

/**
 * The node a compiled main-thread program painted for one ID, or `undefined`
 * when no program owns that ID (issue #215 D1).
 *
 * This is the whole of main's side of the inverted handoff: the background
 * describes a tree and asks, per ID, for the node wearing it. Before #215 the
 * answer came from a `Map` of every program node, and C20 had already stopped
 * *writing* that map at mount by keeping the runs instead and building it on
 * first read. Building it later is still building it — at 30,000 rows it is
 * 210,000 insertions the first adopting launch pays — so the lookup now reads
 * the runs directly, and the map is what is left for the shape that cannot.
 *
 * A program's ids are minted in one increasing sweep, so within a run `ids` and
 * the defined entries of `rangeIds` are each sorted; and when the runs are
 * disjoint (§`programRunsDisjoint`) the run that could own an ID is found by
 * one search over runs rather than by remembering every node. The cursor is
 * what makes the common case free rather than logarithmic: adoption walks the
 * background's description in id order, so the run that answered the last
 * question usually answers this one too.
 *
 * Read from the runs and nothing live, so it answers identically whether the
 * background adopts before or after terminal cleanup emptied the container.
 */
export interface LynxProgramIndex<Node extends LynxElementRef> {
	get(id: number): Node | undefined;
}

/**
 * The largest ID a run owns: its last host, or a hole it painted after it.
 *
 * Exported because the mount asks the same question the readers do — it decides
 * whether a program started inside the previous one — and two copies of this
 * would be two places for "defined range ids increase with their position" to
 * drift apart. It is also the only way the profiler can name it: minified, the
 * two copies were textually identical, so a probe could not tell the mount's
 * call from a reader's and the mount's landed in a bucket named for emitted
 * program code (issue #163 C15-C17's class of defect).
 */
export function programRunLastId(run: LynxProgramRun<LynxElementRef>): number {
	const last = run.ids[run.ids.length - 1]!;
	for (let range = run.rangeIds.length - 1; range >= 0; range--) {
		const id = run.rangeIds[range];
		if (id === undefined) continue;
		// Defined range ids increase with their position, so the last one present
		// is the largest, and a hole after the final host is the only way an id
		// can sit past `ids`.
		return id > last ? id : last;
	}
	return last;
}

/**
 * Which node in one run wears an ID, by scanning the two sorted tables the
 * mount already holds.
 *
 * Linear rather than binary: `ids.length` is `plan.nodes`, a count the compiler
 * fixed at build time and which is small for anything a template emits — the
 * bench row is four. A binary search over four entries costs more than the walk
 * and reads worse.
 */
function programRunNode<Node extends LynxElementRef>(
	run: LynxProgramRun<Node>,
	id: number,
): Node | undefined {
	const ids = run.ids;
	const hosts = ids.length;
	for (let position = 0; position < hosts; position++) {
		const candidate = ids[position]!;
		if (candidate === id) return run.nodes[position] as Node;
		// Sorted, so nothing past here can match. An early exit and not a check:
		// removing it changes no answer, only how long the miss takes, and no
		// test distinguishes the two.
		if (candidate > id) break;
	}
	for (let range = 0; range < run.rangeIds.length; range++) {
		const candidate = run.rangeIds[range];
		// An entry the program left empty is a hole holding members rather than
		// text: nothing of the program's wears an id there, and the members were
		// numbered where the hole sits, so a later hole can still carry a larger
		// id than this one. Stepped over, not stopped at.
		if (candidate === undefined) continue;
		if (candidate === id) return run.nodes[hosts + range] as Node;
		if (candidate > id) break;
	}
	return undefined;
}

class LynxDisjointProgramIndex<Node extends LynxElementRef> implements LynxProgramIndex<Node> {
	private cursor = 0;
	private cursorLastId = -1;

	constructor(private readonly runs: readonly LynxProgramRun<Node>[]) {
		if (runs.length !== 0) this.cursorLastId = programRunLastId(runs[0]!);
	}

	get(id: number): Node | undefined {
		const runs = this.runs;
		if (runs.length === 0) return undefined;
		// Both readers walk ascending IDs across a page whose programs are one
		// keyed row each, so the run that answered last is usually the run that
		// answers now, and the one after it is usually the next. Two comparisons
		// buy that; the search below is what happens when they do not.
		const cursor = this.cursor;
		if (id >= runs[cursor]!.ids[0]! && id <= this.cursorLastId) {
			return programRunNode(runs[cursor]!, id);
		}
		if (cursor + 1 < runs.length) {
			const next = runs[cursor + 1]!;
			if (id >= next.ids[0]!) {
				const lastId = programRunLastId(next);
				if (id <= lastId) {
					this.cursor = cursor + 1;
					this.cursorLastId = lastId;
					return programRunNode(next, id);
				}
			}
		}
		// The runs are disjoint and sorted, so the run that could own this id is
		// the last one starting at or before it — and if that run does not own it,
		// nothing does. That is what lets an id belonging to an ordinary described
		// host be refused here without a map to miss in.
		let low = 0;
		let high = runs.length - 1;
		let found = -1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			if (runs[middle]!.ids[0]! <= id) {
				found = middle;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}
		if (found === -1) return undefined;
		const lastId = programRunLastId(runs[found]!);
		this.cursor = found;
		this.cursorLastId = lastId;
		if (id > lastId) return undefined;
		return programRunNode(runs[found]!, id);
	}
}

/**
 * The per-ID map, for runs whose id spans overlap.
 *
 * A program nested inside another program's keyed-range member takes its ids in
 * the middle of the outer program's span, so "the last run starting at or
 * before this id" stops being the only run that could own it and the search
 * above stops being able to prove a miss. Rather than teach that search to walk
 * a nesting chain — bounded by nothing the plan states — this is the pre-#215
 * behaviour kept intact for the case that needs it: build the map once, answer
 * from it after.
 */
function lynxProgramNodeMap<Node extends LynxElementRef>(
	state: LynxFirstTreeState<Node>,
): Map<number, Node> {
	const existing = state.programNodes;
	if (existing !== null) return existing;
	const built = new Map<number, Node>();
	for (const run of state.programRuns) {
		const hosts = run.ids.length;
		for (let position = 0; position < hosts; position++) {
			built.set(run.ids[position]!, run.nodes[position] as Node);
		}
		for (let range = 0; range < run.rangeIds.length; range++) {
			const id = run.rangeIds[range];
			if (id === undefined) continue;
			built.set(id, run.nodes[hosts + range] as Node);
		}
	}
	state.programNodes = built;
	return built;
}

export function lynxFirstTreeProgramIndex<Node extends LynxElementRef>(
	firstTree: LynxFirstTree<Node>,
): LynxProgramIndex<Node> {
	const state = firstTree[LYNX_FIRST_TREE_STATE];
	if (!state.programRunsDisjoint) return lynxProgramNodeMap(state);
	return new LynxDisjointProgramIndex(state.programRuns);
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
	state.programRuns.length = 0;
	state.programNodes?.clear();
	state.programNodes = null;
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
