import type {
	UniversalEventPriority,
	UniversalProgramPlan,
	UniversalSerializableValue,
} from 'octane/universal/native';
import type { LynxListItemDescriptor } from './list.js';
import type { LynxNativeEventToken } from './native-events.js';
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
	/**
	 * How many instances of `plan` this one run holds (issue #215 D8).
	 *
	 * `1` for every run a single `mountProgram` call pushes, which is what a
	 * program that is not a homogeneous keyed-range member produces. Above one
	 * the run is *dense*: `ids` and `rangeIds` are empty, and every ID in it is
	 * `firstId + instance * stride + offset`, with `offset` running over the
	 * program's own span of `plan.nodes + plan.ranges.length`.
	 *
	 * That arithmetic exists only because a dense run's instances paint every
	 * hole they declare. An open hole holds members, and `assignProgramIds`
	 * mints their IDs at the hole's own position — inside the instance's span —
	 * so two instances of such a program do not take the same number of IDs and
	 * the second one cannot be addressed from the first. It is the emitter's
	 * `denseRun` condition restated where the IDs are actually minted, and the
	 * mount holds to both.
	 */
	readonly count: number;
	/**
	 * The ID of the first instance's first node: `ids[0]` at a count of one, and
	 * the base every dense address is measured from.
	 *
	 * Its own field rather than a read off `ids` so a reader narrowing by ID asks
	 * one question of both shapes, and so an empty `ids` is not a special case
	 * every caller has to know about.
	 */
	readonly firstId: number;
	/**
	 * How many IDs separate one instance's first node from the next one's.
	 *
	 * Not always the program's own span. A `@for` of components lowers each row
	 * to a keyed range holding that component, and a range takes an ID without
	 * making a node — so a row of a five-node, two-hole program occupies eight
	 * IDs and the program's own seven start at the second of them. Carried rather
	 * than derived for exactly that reason: the spacing is a property of the
	 * description the mount walked, and the plan cannot see it.
	 *
	 * IDs in the gap belong to no node of this run's, and the readers answer
	 * `undefined` for them the same way they answer for an ID past the run.
	 */
	readonly stride: number;
	/**
	 * The ids `assignProgramIds` gave this program's hosts, in plan order —
	 * empty for a dense run, whose ids are the arithmetic above.
	 */
	readonly ids: readonly number[];
	/**
	 * Per keyed range: the id of a hole the program painted, or `undefined` —
	 * empty for a dense run, every one of whose holes is painted at the hole's
	 * own offset.
	 */
	readonly rangeIds: readonly (number | undefined)[];
	/**
	 * What the create returned: `plan.nodes` hosts, then one entry per range —
	 * the painted node, or `undefined` for a hole this first screen filled itself.
	 *
	 * A dense run holds `count` of those end to end, member-major. It is the
	 * `out` table its driver filled rather than a copy of one, which is the
	 * allocation per instance the dense path exists to delete.
	 */
	readonly nodes: readonly (Node | undefined)[];
	/** How many of `nodes` this container owns: hosts plus painted holes. */
	readonly owned: number;
	/**
	 * The plan the create came from, kept so a reader can ask what it bound.
	 *
	 * `plan.events` is the event table already: one entry per site, naming the
	 * emitted node, the host event type and the priority. Copying that into a
	 * per-node map at mount re-states, once per row, something the build stated
	 * once per component (issue #215 D3).
	 */
	readonly plan: UniversalProgramPlan;
	/**
	 * What the mount installed for each of `plan.events`, index-aligned with it.
	 *
	 * `undefined` where this render passed the site no handler — the same entry
	 * the emitted create was handed, and the same reason: an absent optional
	 * handler installs nothing. The alignment is what makes the pair a journal:
	 * site `i` describes the tuple, token `i` says whether it is bound and with
	 * what, and neither is meaningful without the other. A dense run holds
	 * `count` such alignments end to end, in the same member-major order as
	 * `nodes`.
	 */
	readonly tokens: readonly (LynxNativeEventToken | undefined)[];
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
	/**
	 * Per-ID, which run numbered it — built only when the runs cannot answer
	 * directly. The run and not the node, so an entry is a reference to something
	 * the mount already allocated and every question is answered by the code the
	 * disjoint index runs (issue #215 D3).
	 */
	programNodes: Map<number, LynxProgramRun<Node>> | null;
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
 * What a compiled main-thread program left for one ID: the node it painted, and
 * the run that can say what it bound there (issues #215 D1 and D3).
 *
 * This is the whole of main's side of the inverted handoff: the background
 * describes a tree and asks, per ID, for the node wearing it — and, where that
 * host carries listeners, for the tokens main installed on it. Before #215 the
 * answer came from a `Map` of every program node, and C20 had already stopped
 * *writing* that map at mount by keeping the runs instead and building it on
 * first read. Building it later is still building it — at 30,000 rows it is
 * 210,000 insertions the first adopting launch pays — so the lookup now reads
 * the runs directly, and the map is what is left for the shape that cannot.
 *
 * A program's ids are minted in one increasing sweep, so within a run `ids` and
 * the defined entries of `rangeIds` are each sorted; and when the runs are
 * disjoint (§`programRunsDisjoint`) the run that could own an ID is found by
 * one search over runs rather than by remembering every node. Finding the run
 * is also what answers the event questions, which is why this narrows to a run
 * rather than resolving straight to a node. The cursor is
 * what makes the common case free rather than logarithmic: adoption walks the
 * background's description in id order, so the run that answered the last
 * question usually answers this one too.
 *
 * Read from the runs and nothing live, so it answers identically whether the
 * background adopts before or after terminal cleanup emptied the container.
 */
export interface LynxProgramIndex<Node extends LynxElementRef> {
	/** The node wearing this ID, or `undefined` for an ID no program numbered. */
	get(id: number): Node | undefined;
	/**
	 * The one run that could have numbered this ID, for a reader wanting more
	 * than the node — what the program bound there, and with which token.
	 *
	 * A run comes back for an ID it does not own, because proving ownership means
	 * scanning the run's own tables and that is what `programRunNode` and the
	 * event accessors do anyway. A caller confirms with one of those; a run alone
	 * is not yet an answer. `undefined` means no run could have, which is the
	 * only miss this can report without scanning.
	 *
	 * Two accessors rather than one because they are two questions: the transfer
	 * wants the node, and the comparison wants what was bound on it. One
	 * accessor answering both would allocate a pair per ID on the adoption path
	 * to answer either — the shape this train removes, met from the reader's side.
	 */
	runFor(id: number): LynxProgramRun<Node> | undefined;
}

/**
 * Whether a homogeneous keyed range mounts as one dense run (issue #215 D8).
 *
 * A constant rather than an option, because it is an ablation switch and not a
 * product choice: turning it off puts the mount back on the per-member path
 * exactly as it stood before this slice, which is what the A/B control arm is
 * built from. One constant, read by the one site that decides — the keyed range
 * a program's own mount is about to walk — so a control build cannot end up
 * half-ablated.
 */
export const LYNX_DENSE_PROGRAM_RANGES = true;

/**
 * Where each offset of one instance's ID span lands: a position in `plan.nodes`
 * when it is not negative, and the keyed range `-slot - 1` when it is.
 *
 * This is `assignProgramIds`'s interleave walk, lifted out of its per-member
 * loop and kept per plan. Both sides read this one table — the renderer numbers
 * from it, the readers address from it — so where a program's holes sit is
 * worked out once per component rather than once per row, and there is no
 * second walk for the first to drift from.
 */
const programSlotTables = new WeakMap<UniversalProgramPlan, Int32Array>();

export function programSlotTable(plan: UniversalProgramPlan): Int32Array {
	const cached = programSlotTables.get(plan);
	if (cached !== undefined) return cached;
	const ranges = plan.ranges;
	const table = new Int32Array(plan.nodes + ranges.length);
	let host = 0;
	let hole = 0;
	for (let offset = 0; offset < table.length; offset++) {
		if (hole < ranges.length && ranges[hole]!.id === offset) {
			table[offset] = -(hole + 1);
			hole++;
			continue;
		}
		table[offset] = host++;
	}
	// A range whose position this walk never reaches leaves the table naming a
	// host where a hole sits, which mis-addresses every node after it instead of
	// failing. Checked once per plan, here, because this is now the only place
	// the order is worked out.
	if (hole !== ranges.length || host !== plan.nodes) {
		throw new TypeError(
			`A compiled main-thread program declares ${plan.nodes} nodes and ` +
				`${ranges.length} ranges, but its range positions do not fit that order.`,
		);
	}
	programSlotTables.set(plan, table);
	return table;
}

/** An instance's ID span, which is also how many entries it takes in `nodes`. */
function programStride(plan: UniversalProgramPlan): number {
	return plan.nodes + plan.ranges.length;
}

/**
 * Which entry of a dense run's `nodes` wears an ID, or `-1`.
 *
 * Two divisions and a table read where the scan below walks: a dense run's ids
 * are `count` consecutive strides from `firstId`, so the instance and the
 * offset inside it are arithmetic, and the slot table turns that offset into a
 * position. It is what makes one run of 30,000 instances cost a reader what one
 * instance cost, rather than 30,000 cursor advances (issue #215 D8).
 */
function denseRunSlot(run: LynxProgramRun<LynxElementRef>, id: number): number {
	const plan = run.plan;
	const span = programStride(plan);
	const within = id - run.firstId;
	if (within < 0) return -1;
	const instance = Math.floor(within / run.stride);
	if (instance >= run.count) return -1;
	const offset = within - instance * run.stride;
	// Past the instance's own span: an ID the description minted between two
	// instances — the transparent keyed range each row is wrapped in — which
	// names no node this run made.
	//
	// What it holds up is the assertion on the next line, not a behaviour, and
	// **no test goes red for deleting it**. Said plainly because that is worth
	// knowing before deleting it, and because it is worth knowing *why*: nothing
	// asks. A wrapper's ID is a range on both sides of the handoff, and a range
	// is transparent — the background describes hosts, the comparator walks
	// hosts, so the one ID class this rejects is the one nobody names. Without
	// the line the table read is out of bounds, `undefined` reaches the
	// arithmetic, and the result is `NaN`; `nodes[NaN]` is `undefined` and the
	// caller sees the same miss, so even a reader that did ask would be right by
	// accident. `programRunPosition` repeats the guard for the same reason and
	// with the same standing, except that its `NaN` would be a returned
	// *position* — and `NaN < 0` is false, so it would read as a hit rather than
	// degrade to a miss.
	if (offset >= span) return -1;
	const slot = programSlotTable(plan)[offset]!;
	return instance * span + (slot < 0 ? plan.nodes + (-slot - 1) : slot);
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
	// Every instance takes the same stride and paints every hole it declares, so
	// a dense run ends at the last node of its last instance with nothing to
	// scan for a trailing hole. The last instance's *span*, not a whole stride:
	// anything the description put between two instances sits before the next
	// one, never after the last.
	if (run.count !== 1) {
		return run.firstId + (run.count - 1) * run.stride + programStride(run.plan) - 1;
	}
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
 *
 * Exported alongside `runFor`, which narrows to the one run that could own an
 * ID without proving that it does: this is the proof, and a caller that wants
 * the node and something else besides does both steps once rather than paying
 * the narrowing twice.
 */
export function programRunNode<Node extends LynxElementRef>(
	run: LynxProgramRun<Node>,
	id: number,
): Node | undefined {
	if (run.count !== 1) {
		const slot = denseRunSlot(run, id);
		return slot < 0 ? undefined : (run.nodes[slot] as Node);
	}
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

/**
 * Where in one run's `ids` an ID sits, or `-1`.
 *
 * The event accessors below address a site by this position rather than by ID,
 * because that is the number `plan.events` was written in: a site names the
 * emitted node it binds on, and `ids[position]` is the ID that node took. A
 * reader holding an ID converts once and then asks as many questions as it has.
 */
export function programRunPosition(run: LynxProgramRun<LynxElementRef>, id: number): number {
	if (run.count !== 1) {
		const plan = run.plan;
		const within = id - run.firstId;
		if (within < 0) return -1;
		const instance = Math.floor(within / run.stride);
		if (instance >= run.count) return -1;
		const offset = within - instance * run.stride;
		// The same guard `denseRunSlot` states at length, with the same standing:
		// unreachable from any description this renderer produces, and the reason
		// the assertion below holds.
		if (offset >= programStride(plan)) return -1;
		const slot = programSlotTable(plan)[offset]!;
		// A painted hole is a node this run owns but not a host it declares, so
		// it has no position: `plan.events` names hosts and only hosts, which is
		// what a position addresses.
		return slot < 0 ? -1 : instance * plan.nodes + slot;
	}
	const ids = run.ids;
	for (let position = 0; position < ids.length; position++) {
		const candidate = ids[position]!;
		if (candidate === id) return position;
		if (candidate > id) break;
	}
	return -1;
}

/**
 * How many listeners the program installed on the host at `position`.
 *
 * Counted from the plan rather than from a per-node map, which is D3 itself:
 * `plan.events` names every site the component has, and `tokens` says which of
 * them this render bound. A site whose token is `undefined` was handed no
 * handler, so nothing was installed and nothing is counted — exactly the entry
 * the per-node map would not have held.
 */
export function programRunEventCount(
	run: LynxProgramRun<LynxElementRef>,
	position: number,
): number {
	const plan = run.plan;
	const events = plan.events;
	// A position is flat across the run's instances and `plan.events` is one
	// instance's site table, so the two are related by which instance the
	// position is in — zero, and therefore free, for a run holding one.
	const instance = run.count === 1 ? 0 : Math.floor(position / plan.nodes);
	const node = position - instance * plan.nodes;
	const base = instance * events.length;
	let count = 0;
	for (let index = 0; index < events.length; index++) {
		if (events[index]!.node === node && run.tokens[base + index] !== undefined) count++;
	}
	return count;
}

/** The token installed for one `(position, type)` pair, or `undefined`. */
export function programRunEventToken(
	run: LynxProgramRun<LynxElementRef>,
	position: number,
	type: string,
): LynxNativeEventToken | undefined {
	const plan = run.plan;
	const events = plan.events;
	const instance = run.count === 1 ? 0 : Math.floor(position / plan.nodes);
	const node = position - instance * plan.nodes;
	const base = instance * events.length;
	for (let index = 0; index < events.length; index++) {
		const site = events[index]!;
		// `(node, type)` names at most one site — the plan freeze checks it — so
		// the first match is the only one and there is nothing to disambiguate.
		if (site.node === node && site.type === type) return run.tokens[base + index];
	}
	return undefined;
}

/** How many host positions a run has: `plan.nodes` once per instance. */
export function programRunHostCount(run: LynxProgramRun<LynxElementRef>): number {
	return run.count * run.plan.nodes;
}

/**
 * The node at a flat host position — the number `programRunPosition` returns.
 *
 * A run's hosts are not contiguous in `nodes` once it holds more than one
 * instance: each instance contributes its hosts and then its painted holes. Two
 * readers walk every host of every run, and this is the one place that layout is
 * spelled out for them.
 */
export function programRunHostNode<Node extends LynxElementRef>(
	run: LynxProgramRun<Node>,
	position: number,
): Node {
	if (run.count === 1) return run.nodes[position] as Node;
	const plan = run.plan;
	const instance = Math.floor(position / plan.nodes);
	const slot = instance * programStride(plan) + (position - instance * plan.nodes);
	return run.nodes[slot] as Node;
}

class LynxDisjointProgramIndex<Node extends LynxElementRef> implements LynxProgramIndex<Node> {
	private cursor = 0;
	private cursorLastId = -1;

	constructor(private readonly runs: readonly LynxProgramRun<Node>[]) {
		if (runs.length !== 0) this.cursorLastId = programRunLastId(runs[0]!);
	}

	get(id: number): Node | undefined {
		const run = this.runFor(id);
		return run === undefined ? undefined : programRunNode(run, id);
	}

	runFor(id: number): LynxProgramRun<Node> | undefined {
		const runs = this.runs;
		if (runs.length === 0) return undefined;
		// Both readers walk ascending IDs across a page whose programs are one
		// keyed row each, so the run that answered last is usually the run that
		// answers now, and the one after it is usually the next. Two comparisons
		// buy that; the search below is what happens when they do not.
		const cursor = this.cursor;
		if (id >= runs[cursor]!.firstId && id <= this.cursorLastId) {
			return runs[cursor]!;
		}
		if (cursor + 1 < runs.length) {
			const next = runs[cursor + 1]!;
			if (id >= next.firstId) {
				const lastId = programRunLastId(next);
				if (id <= lastId) {
					this.cursor = cursor + 1;
					this.cursorLastId = lastId;
					return next;
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
			if (runs[middle]!.firstId <= id) {
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
		// A run starting at or before this id and ending at or after it still need
		// not own it: the id can fall in a gap the run left, which is what an
		// ordinary described host between two programs is. `programRunNode` and the
		// accessors answer that by scanning the run's own tables, so a caller
		// holding this run has not yet been told the id is a program's.
		return runs[found]!;
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
 * behaviour kept intact for the case that needs it: build the map once, narrow
 * with it after.
 */
function lynxProgramRunMap<Node extends LynxElementRef>(
	state: LynxFirstTreeState<Node>,
): Map<number, LynxProgramRun<Node>> {
	const existing = state.programNodes;
	if (existing !== null) return existing;
	const built = new Map<number, LynxProgramRun<Node>>();
	for (const run of state.programRuns) {
		if (run.count !== 1) {
			// One entry per node, which is the instance's own span rather than its
			// stride: an ID the description minted between two instances names no
			// node of this run's, and mapping it would answer *this run* for
			// something the run does not own.
			const span = programStride(run.plan);
			for (let instance = 0; instance < run.count; instance++) {
				const base = run.firstId + instance * run.stride;
				for (let offset = 0; offset < span; offset++) built.set(base + offset, run);
			}
			continue;
		}
		const hosts = run.ids.length;
		for (let position = 0; position < hosts; position++) built.set(run.ids[position]!, run);
		for (let range = 0; range < run.rangeIds.length; range++) {
			const id = run.rangeIds[range];
			if (id === undefined) continue;
			built.set(id, run);
		}
	}
	state.programNodes = built;
	return built;
}

/**
 * The overlapping-run index: which run, from a map, then the same accessors.
 *
 * The map holds the run and not the node, so an entry is a reference to
 * something the mount already allocated rather than a second copy of it, and
 * every question — node, event count, token — is answered by the same code the
 * disjoint index runs. Only "which run" differs between the two, which is what
 * `programRunsDisjoint` actually selects.
 */
class LynxMappedProgramIndex<Node extends LynxElementRef> implements LynxProgramIndex<Node> {
	constructor(private readonly runs: ReadonlyMap<number, LynxProgramRun<Node>>) {}

	get(id: number): Node | undefined {
		const run = this.runs.get(id);
		return run === undefined ? undefined : programRunNode(run, id);
	}

	runFor(id: number): LynxProgramRun<Node> | undefined {
		return this.runs.get(id);
	}
}

export function lynxFirstTreeProgramIndex<Node extends LynxElementRef>(
	firstTree: LynxFirstTree<Node>,
): LynxProgramIndex<Node> {
	const state = firstTree[LYNX_FIRST_TREE_STATE];
	if (!state.programRunsDisjoint) return new LynxMappedProgramIndex(lynxProgramRunMap(state));
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
