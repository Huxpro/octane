declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

/**
 * Issue-#103 U2 — the first vertical slice of the Lynx-specialized background
 * core: `runtime.ts`'s Block model with a wire address where the DOM node was.
 *
 * The design this implements is the U1 comment on #103. The one-sentence claim
 * it exists to make testable: a `Block` is a parent plus a marker-delimited
 * child range, a `ForSlot` is `Map<key, Block>` plus a survivor list, and
 * neither is a DOM abstraction — so porting them to a host whose "node" is a
 * host id and whose `insertBefore` is a `move` command makes the update path
 * change-proportional without a reconciler pass over the tree.
 *
 * ## Two emission backends, one resident applier
 *
 * A general transport receives `UniversalHostBatch` commands for compatibility.
 * A paired compiled-program application supplies `LynxBlockDeltaProducer`, so
 * compiler-assigned instance, slot, and range identities go straight to compact
 * RUN/SET/MOVE/REMOVE/CLEAR frames. Both paths still terminate in the same
 * compiled-program store, generated setters, event journal, and PAPI layer.
 *
 * ## Specialized scope
 *
 * Component-local hook scopes sit above these scoped entry points and publish at
 * the same render-attempt boundary. Native lists reuse these instance and range
 * identities while the main-thread store alone materializes physical cells. De-opt
 * regions and portals remain selected out until their slices. Activity and retained
 * Suspense visibility are owned by the component layer and lowered here to
 * transactional VIS operations over the same resident instance identities.
 */

import { sameLynxUniversalHostPropValue } from './host-props.js';
import type { LynxBlockDeltaProducer } from './block-delta-producer.js';
import { LYNX_PROFILE } from './profiling.js';

import {
	recordUniversalProgramCommand,
	recordUniversalProgramRangeCommand,
	type UniversalHostBatch,
	type UniversalHostCommand,
	type UniversalHostParent,
	type UniversalHostProgramAddress,
	type UniversalHostTemplateProgram,
	type UniversalHostTemplateProgramNode,
	type UniversalHostTemplateProgramValue,
} from 'octane/universal/native';

/** Renderer tag every Lynx batch carries; the applier rejects anything else. */
const LYNX_RENDERER = 'lynx';

// The production refusal is the compact OL015 contract. Guard every call-site
// argument too, so descriptions and interpolations do not survive merely to be
// discarded by `fail` after the bundle has already paid for them.
const LYNX_BLOCK_CORE_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;

/**
 * A compiled template plus the two lookup tables a scoped slot write needs:
 * which host node in the run owns each value slot, and which prop that slot
 * writes. `mount-template-run` needs neither — it hands the applier the whole
 * value array — but `update` addresses one node, so a core that could not
 * answer "which node owns slot 3" would have to re-emit the run to change one
 * label, which is precisely the tree-proportional behaviour this replaces.
 */
export interface LynxBlockTemplate {
	readonly program: UniversalHostTemplateProgram;
	/** Build-proven resident address; absent keeps the descriptor command. */
	readonly address?: UniversalHostProgramAddress;
	readonly hostCount: number;
	readonly valueCount: number;
	readonly eventCount: number;
	readonly valueNodes: readonly number[];
	readonly valueNames: readonly string[];
	/** Static props per host node, so an `update` can carry complete next props. */
	readonly staticProps: readonly Readonly<Record<string, unknown>>[];
	/**
	 * Which slots a `main-thread:` binding owns, or `null` when the template has
	 * none. A worklet slot is the one slot whose value is an object rather than a
	 * scalar, which changes both what may be written to it and how "unchanged" is
	 * decided — see `write()`.
	 */
	readonly mainThreadValues: readonly boolean[] | null;
	/** Resident host-node indexes with authored background refs; absent on the hot path. */
	readonly refs?: readonly number[];
}

function fail(message: string | false): never {
	throw new Error(
		LYNX_BLOCK_CORE_DEVELOPMENT ? `Octane Lynx block core: ${message}.` : 'Octane Lynx OL015',
	);
}

/**
 * Compile a template program into the shape this core walks.
 *
 * The program's own invariants (pre-order nodes, `parent === -1` at the root,
 * parents strictly earlier, `#text` only under `text`) are the applier's and
 * are re-checked there. What this adds is the value-slot inverse map. The
 * refusals this slice owes are value-shape constraints. Native-list ownership is
 * selected by the compiled-program store, while a value slot bound twice would
 * make "which node owns this slot" ambiguous.
 */
export function compileLynxBlockTemplate(
	program: UniversalHostTemplateProgram,
	address?: UniversalHostProgramAddress,
	refs?: readonly number[],
): LynxBlockTemplate {
	if (
		address !== undefined &&
		(typeof address.module !== 'string' ||
			address.module === '' ||
			!Number.isSafeInteger(address.index) ||
			address.index < 0)
	) {
		fail(
			LYNX_BLOCK_CORE_DEVELOPMENT && 'a program address requires a module and non-negative index',
		);
	}
	if (!Array.isArray(program.nodes) || program.nodes.length === 0) {
		fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a template needs at least one host node');
	}
	// Annotated rather than inferred: `Array.isArray` widens a `readonly T[]` to
	// `any[]`, which would make every node below implicitly `any`.
	const source: readonly UniversalHostTemplateProgramNode[] = program.nodes;
	const valueNodes: number[] = [];
	const valueNames: string[] = [];
	let mainThreadValues: boolean[] | null = null;
	const staticProps: Readonly<Record<string, unknown>>[] = new Array(source.length);
	const nodes: UniversalHostTemplateProgramNode[] = new Array(source.length);
	for (let index = 0; index < source.length; index++) {
		const node = source[index]!;
		const props = Object.freeze({ ...node.props });
		const bindings = node.bindings;
		staticProps[index] = props;
		nodes[index] = Object.freeze({
			...node,
			props,
			...(bindings === undefined
				? null
				: { bindings: Object.freeze(bindings.map((binding) => Object.freeze({ ...binding }))) }),
		});
		if (bindings === undefined) continue;
		for (const binding of bindings) {
			if (valueNodes[binding.valueIndex] !== undefined) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT &&
						`value slot ${binding.valueIndex} is bound by more than one host node`,
				);
			}
			valueNodes[binding.valueIndex] = index;
			valueNames[binding.valueIndex] = binding.name;
			if (binding.name.startsWith('main-thread:')) {
				// Raw text owns no Element surface, so it can hold neither a worklet
				// nor a ref. The applier refuses it too; refusing at compile time
				// reports the authoring mistake before any instance exists.
				if (node.type === '#text' || node.type === 'raw-text') {
					fail(
						LYNX_BLOCK_CORE_DEVELOPMENT &&
							`slot ${binding.valueIndex} binds ${binding.name} on ${node.type}`,
					);
				}
				(mainThreadValues ??= [])[binding.valueIndex] = true;
			}
		}
	}
	for (let slot = 0; slot < valueNodes.length; slot++) {
		if (valueNodes[slot] === undefined)
			fail(LYNX_BLOCK_CORE_DEVELOPMENT && `value slot ${slot} is declared but never bound`);
		if (mainThreadValues !== null) mainThreadValues[slot] ??= false;
	}
	// A deeply frozen copy, not the caller's object.
	//
	// The wire treats a template program as immutable shared data: it hands the
	// same program to the main thread commit after commit without cloning, and
	// `countLynxCompactAcknowledgementHosts` will only cache its verdict for a
	// program whose nodes, props and bindings are all frozen. A program that is
	// still mutable is therefore re-walked on every mount, and — because the
	// compact acknowledgement it asks for is only *accepted* in its incremental
	// form, which requires a frozen run — a second commit carrying one is
	// rejected outright. Copying rather than freezing in place keeps that out of
	// the caller's object, which it may still own and reuse.
	const frozen: UniversalHostTemplateProgram = Object.freeze({
		nodes: Object.freeze(nodes),
		events: Object.freeze(program.events.map((event) => Object.freeze({ ...event }))),
	});
	let frozenRefs: readonly number[] | undefined;
	if (refs !== undefined) {
		if (!Array.isArray(refs) || refs.length === 0) {
			fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'host refs must be a non-empty node-index array');
		}
		const seen = new Set<number>();
		for (const node of refs) {
			if (
				!Number.isSafeInteger(node) ||
				node < 0 ||
				node >= nodes.length ||
				nodes[node]!.type === '#text' ||
				nodes[node]!.type === 'raw-text' ||
				seen.has(node)
			) {
				fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'invalid host-ref node ' + String(node));
			}
			seen.add(node);
		}
		frozenRefs = Object.freeze([...refs]);
	}
	return Object.freeze({
		program: frozen,
		...(address === undefined
			? null
			: { address: Object.freeze({ module: address.module, index: address.index }) }),
		hostCount: nodes.length,
		valueCount: valueNodes.length,
		eventCount: frozen.events.length,
		valueNodes: Object.freeze(valueNodes),
		valueNames: Object.freeze(valueNames),
		staticProps: Object.freeze(staticProps),
		mainThreadValues: mainThreadValues === null ? null : Object.freeze(mainThreadValues),
		...(frozenRefs === undefined ? null : { refs: frozenRefs }),
	});
}

/**
 * One mounted template instance and its live slot values.
 *
 * This is `runtime.ts`'s `Block` with the host swapped. `firstId` is the dense
 * host-id run the instance owns, which stands in for `parentNode` plus the
 * marker pair: the range is `[firstId, firstId + hostCount)` and needs nothing
 * materialized to delimit it, because the run is dense by construction.
 * `values` is the live slot state, which is what makes a scoped write able to
 * skip an unchanged slot without consulting the main thread.
 */
export interface LynxBlock {
	readonly template: LynxBlockTemplate;
	readonly firstId: number;
	/**
	 * First listener id of this block's own event run, or `null` for a template
	 * with no event sites. A site's id is `firstListenerId + siteIndex`, which is
	 * what lets an inbound delivery be routed back to the block that owns it
	 * without shipping a listener table across the wire.
	 */
	readonly firstListenerId: number | null;
	/** Compact instance identity; absent on the general host-command path. */
	readonly instance: number | null;
	/** True while the instance is a logical native-list row without a physical cell. */
	readonly deferred: boolean;
	/** Last accepted Activity visibility for this retained instance. */
	visible: boolean;
	readonly values: UniversalHostTemplateProgramValue[];
	readonly key: unknown;
	/** Monotonic committed-order token, refreshed by `link`; deletions may leave gaps. */
	index: number;
	/** Survivor list, as in `runtime.ts` — the LIS operates over this order. */
	prev: LynxBlock | null;
	next: LynxBlock | null;
	/** Lazily retained compiler range sites owned by this instance. */
	rangeSites?: LynxBlockProgramRangeSite[];
}

/**
 * A keyed range site and its survivor set.
 *
 * `items` is the entire change-proportionality claim: an update that knows its
 * key does one `Map.get`, where a whole-tree reconciler visits every member to
 * find the same block. `head`/`tail` keep the committed order without asking
 * the host what its children are.
 */
export interface LynxBlockForSlot {
	readonly parent: UniversalHostParent;
	readonly items: Map<unknown, LynxBlock>;
	head: LynxBlock | null;
	tail: LynxBlock | null;
	size: number;
}

/** Producer-only compiler provenance; absent from the public range-site shape. */
type LynxBlockProgramRangeSite = LynxBlockForSlot & {
	/** Compiler range slot on the owning instance. */
	readonly 0: number | undefined;
	/** Owning compact instance, or null on the general command path. */
	readonly 1: number | null;
	/** Compiler node of the next static sibling, or null at the range tail. */
	readonly 2: number | null;
	/** Physical host id of that static sibling on the command path. */
	readonly 3: number | null;
	/** Descendants mounted here are physically deferred native-list rows. */
	readonly 4: boolean;
	/** Next adjacent compiler range sharing the same physical/static anchor. */
	5: LynxBlockProgramRangeSite | null;
};

/**
 * Deterministic accounting for the #103 U0 gate.
 *
 * `blockLookups` is what the architecture visits: the number of blocks this
 * core touched to service an operation. `commands` is what it told the main
 * thread to do. Both are counts rather than milliseconds, so they carry across
 * hosts and sessions, and both are read directly off the core rather than
 * inferred from a wall clock.
 */
export interface LynxBlockCoreCounters {
	readonly blockLookups: number;
	readonly commands: number;
}

/**
 * Where a profile build publishes its cores' counters.
 *
 * A core's counters live in its closure, so only the code that created it can
 * read them. That is right for production and useless for measurement: the
 * cell whose cost this core decides is a compiled application, and nothing in
 * it holds the core — the lowering does. A harness driving that application
 * from outside the bundle has no other way to ask what the background thread
 * visited, and a visit is one of the costs no wire counter can see: a core that
 * walked ten thousand blocks to write one sends exactly what a core that walked
 * one sends.
 *
 * An array rather than a record: a realm may host more than one root, and
 * summing them is the harness's decision to make, not this module's. Nothing
 * prunes it, so a core that is finished is still retained by its entry — which
 * is what a measurement build is for, and is why this is behind the flag rather
 * than beside `counters()`.
 *
 * Gated on `__OCTANE_LYNX_PROFILE__` like every other counter here, so a
 * production bundle neither publishes nor retains anything — see
 * `core/profiling.ts`, which is the same flag and the same reasoning.
 */
export interface LynxBlockCoreProfileGlobals {
	__OCTANE_LYNX_BLOCK_CORES__?: LynxBlockCoreProfileEntry[];
}

/** One published core: what it has visited, and how to start counting again. */
export interface LynxBlockCoreProfileEntry {
	counters(): LynxBlockCoreCounters;
	resetCounters(): void;
}

export interface LynxBlockCoreOptions {
	/** First host id this root may allocate. Ids are dense and monotonic. */
	readonly firstId?: number;
	readonly firstListenerId?: number;
	/**
	 * Whether the peer has negotiated intrinsic template runs (issue #103 B0).
	 *
	 * Asked per mount rather than once, because the capability arrives late. A
	 * main thread that painted a first screen keeps every optional wire
	 * behaviour dormant until the background's first batch has adopted or
	 * repaired that screen — a first tree is compared against a legacy batch,
	 * so `templateRuns` is off for exactly one commit and on afterwards
	 * (`transport.ts`, `main-thread.ts`). A core that assumed otherwise would
	 * have its whole mount rejected as an unnegotiated template run, which is
	 * how this was found.
	 *
	 * Defaults to always-on: a caller that drives the core without a wire has
	 * no negotiation to respect.
	 */
	readonly templateRuns?: () => boolean;
	/** Direct compact producer selected only by a paired compiled-program app. */
	readonly deltaProducer?: LynxBlockDeltaProducer;
}

export interface LynxBlockCore {
	/** Begin one render attempt whose logical writes publish only after host acceptance. */
	beginAttempt(): void;
	/** Publish the active attempt after the host acknowledges its batch. */
	acceptAttempt(): void;
	/** Restore the last accepted logical state after a pre-acknowledgement rejection. */
	abortAttempt(): boolean;
	/** Mount a template into a range site and return its block. */
	mount(
		parent: UniversalHostParent,
		before: number | null,
		template: LynxBlockTemplate,
		values: readonly UniversalHostTemplateProgramValue[],
	): LynxBlock;
	/** Destroy a block mounted at the root after its owned ranges are clear. */
	destroyRoot(block: LynxBlock): void;
	/** Open a keyed range at one host node, optionally retaining its compiler plan slot. */
	openForSlot(
		block: LynxBlock,
		nodeIndex: number,
		programRangeSlot?: number,
		beforeNodeIndex?: number | null,
	): LynxBlockForSlot;
	/**
	 * Fill an empty range site. The mount-linear fast path `runtime.ts` takes
	 * when `oldSize === 0`: there is no survivor to match, so there is no diff.
	 */
	fillForSlot<Item>(
		slot: LynxBlockForSlot,
		template: LynxBlockTemplate,
		items: readonly Item[],
		key: (item: Item, index: number) => unknown,
		values: (item: Item, index: number) => readonly UniversalHostTemplateProgramValue[],
	): void;
	/**
	 * Keyed reconcile with an LIS survivor pass, as `runtime.ts` does.
	 * `departed` is invoked for every block that leaves the range, before its
	 * run is destroyed — the window in which an owner must release the block's
	 * listeners and any other per-block resources it holds. A compiler owner may
	 * pass the ascending indices whose row values it recomputed; omitted retains
	 * the conservative contract and compares every survivor value. When members
	 * own child ranges, `membersOwnRanges` keeps their teardown individual after
	 * `departed` clears those children; the general host validates destroy runs
	 * against the pre-batch tree and cannot accept an outer run across them.
	 */
	reconcileForSlot<Item>(
		slot: LynxBlockForSlot,
		template: LynxBlockTemplate,
		items: readonly Item[],
		key: (item: Item, index: number) => unknown,
		values: (item: Item, index: number) => readonly UniversalHostTemplateProgramValue[],
		departed?: (block: LynxBlock) => void,
		changedIndices?: readonly number[],
		membersOwnRanges?: boolean,
	): void;
	/**
	 * Tear down every member of a range site. `departed` fires per member
	 * before destruction, with the same release obligation and nested-range
	 * teardown rule as reconcile.
	 */
	clearForSlot(
		slot: LynxBlockForSlot,
		departed?: (block: LynxBlock) => void,
		membersOwnRanges?: boolean,
	): void;
	/**
	 * Remove compiler-proven departed keys without rediscovering every survivor.
	 * During a render attempt the host commands are emitted immediately, while
	 * logical membership is published only when that attempt is accepted.
	 */
	removeKeysForSlot(
		slot: LynxBlockForSlot,
		keys: readonly unknown[],
		departed?: (block: LynxBlock) => void,
	): void;
	/**
	 * Every slot of one row of a range, by key, in one visit.
	 *
	 * `setKeyedSlotValue` is the primitive for a caller that knows which slot
	 * moved. A component lowering does not: it knows the row's whole next value
	 * array and lets the per-slot comparison decide, which is the same decision
	 * `reconcileForSlot` makes for a survivor — but for one named row rather than
	 * for the list. Without this a caller would reach the same place through
	 * `valueCount` separate keyed writes, paying a map lookup and a `blockLookups`
	 * tick per slot for a single block it visited once.
	 *
	 * Returns the block it visited, so a caller that has to rebind that row's
	 * listeners too does not pay a second lookup for a key this one just
	 * resolved. `undefined` when the range holds no such row, which is how
	 * `setKeyedSlotValue` answers the same question.
	 */
	writeKeyedValues(
		slot: LynxBlockForSlot,
		key: unknown,
		values: readonly UniversalHostTemplateProgramValue[],
	): LynxBlock | undefined;
	/** Every slot of one retained block, in one logical visit. */
	writeValues(block: LynxBlock, values: readonly UniversalHostTemplateProgramValue[]): void;
	/** The scoped write. One key lookup, one command, independent of list size. */
	setKeyedSlotValue(
		slot: LynxBlockForSlot,
		key: unknown,
		valueIndex: number,
		value: UniversalHostTemplateProgramValue,
	): boolean;
	/** The same write against a block already in hand. */
	setSlotValue(
		block: LynxBlock,
		valueIndex: number,
		value: UniversalHostTemplateProgramValue,
	): boolean;
	/** Retain an instance while switching its native/event visibility. */
	setVisibility(block: LynxBlock, visible: boolean): boolean;
	/** Hand the accumulated frame to the caller. Null when nothing changed. */
	flush(): UniversalHostBatch | null;
	counters(): LynxBlockCoreCounters;
	resetCounters(): void;
}

/**
 * The longest increasing subsequence of `sequence`, returned in the
 * predecessor buffer with each stable index marked `-2`. Entries equal to
 * `-1` are new members and never join it.
 *
 * This is the same choice `runtime.ts` makes and the same one
 * `docs/differences-from-react.md` documents: survivors in the subsequence stay
 * put and everything else moves, so the final order is guaranteed while the set
 * of physically moved nodes is not.
 */
function longestIncreasingSubsequence(sequence: readonly number[]): number[] {
	const length = sequence.length;
	const predecessors = new Array<number>(length).fill(-1);
	const tails: number[] = [];
	for (let index = 0; index < length; index++) {
		const value = sequence[index]!;
		if (value === -1) continue;
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (sequence[tails[middle]!]! < value) low = middle + 1;
			else high = middle;
		}
		if (low > 0) predecessors[index] = tails[low - 1]!;
		if (low === tails.length) tails.push(index);
		else tails[low] = index;
	}
	let cursor = tails.length === 0 ? -1 : tails[tails.length - 1]!;
	while (cursor !== -1) {
		const predecessor = predecessors[cursor]!;
		predecessors[cursor] = -2;
		cursor = predecessor;
	}
	return predecessors;
}

export function createLynxBlockCore(options: LynxBlockCoreOptions = {}): LynxBlockCore {
	// The instance allocator U1 §2 names as the core's only new global state:
	// a monotonic counter handing out dense runs. Nothing about a handle is
	// shipped for adoption — both threads run the same counter over the same
	// deterministic render, which is what U1 §4 turns adoption into.
	let nextId = options.firstId ?? 1;
	let nextListenerId = options.firstListenerId ?? 1;
	const templateRunsAllowed = options.templateRuns ?? (() => true);
	let commands: UniversalHostCommand[] = [];
	const deltaProducer = options.deltaProducer ?? null;
	// Where this frame's live `update` sits, per host id. An `update` carries the
	// node's complete next props, so a later write to the same host makes the
	// earlier command dead payload: applying only the last leaves the same tree.
	// Rewriting it in place keeps the frame's length proportional to the hosts
	// that changed rather than to the writes that changed them.
	let pendingUpdates = new Map<number, number>();
	let version = 0;
	let blockLookups = 0;
	let commandCount = 0;
	interface SlotSnapshot {
		readonly slot: LynxBlockForSlot;
		readonly items: Map<unknown, LynxBlock>;
		readonly ordered: readonly LynxBlock[];
	}
	type ValueSnapshotPart = LynxBlock | number | UniversalHostTemplateProgramValue;
	let attemptActive = false;
	let attemptNextId = 0;
	let attemptNextListenerId = 0;
	let attemptSlots: SlotSnapshot[] | null = null;
	let attemptCapturedSlots: Set<LynxBlockForSlot> | null = null;
	let attemptValues: ValueSnapshotPart[] | null = null;
	let attemptCapturedValues: Map<LynxBlock, number | Set<number>> | null = null;
	let attemptVisibility: (LynxBlock | boolean)[] | null = null;
	let attemptCapturedVisibility: Set<LynxBlock> | null = null;
	let attemptAccepts: (() => void)[] | null = null;

	const captureSlot = (slot: LynxBlockForSlot): void => {
		if (!attemptActive) return;
		const captured = (attemptCapturedSlots ??= new Set());
		if (captured.has(slot)) return;
		captured.add(slot);
		const ordered: LynxBlock[] = [];
		for (let block = slot.head; block !== null; block = block.next) ordered.push(block);
		(attemptSlots ??= []).push({ slot, items: new Map(slot.items), ordered });
	};

	const emit = (command: UniversalHostCommand): void => {
		commands.push(command);
		commandCount++;
	};

	const allocate = (template: LynxBlockTemplate, count: number): number => {
		const firstId = nextId;
		nextId += template.hostCount * count;
		return firstId;
	};

	const allocateListeners = (template: LynxBlockTemplate, count: number): number | null => {
		if (template.eventCount === 0) return null;
		const first = nextListenerId;
		nextListenerId += template.eventCount * count;
		return first;
	};

	const nextSiblingHead = (site: LynxBlockProgramRangeSite): LynxBlock | null => {
		let sibling = site[5];
		while (sibling !== null) {
			if (sibling.head !== null) return sibling.head;
			sibling = sibling[5];
		}
		return null;
	};

	/**
	 * A run of `count` instances mounted at one site with one command.
	 *
	 * This is the emission that makes a mount change-proportional in the number
	 * of *commands* rather than the number of hosts: 10,000 rows of a 7-host
	 * template is one command carrying 30,000 values, not 70,000 creates.
	 */
	const mountRun = (
		parent: UniversalHostParent,
		before: number | null,
		template: LynxBlockTemplate,
		rows: readonly (readonly UniversalHostTemplateProgramValue[])[],
		keys: readonly unknown[],
		rangeSite?: LynxBlockProgramRangeSite,
		beforeBlock?: LynxBlock | null,
	): LynxBlock[] => {
		const count = rows.length;
		const firstId = allocate(template, count);
		const firstListenerId = allocateListeners(template, count);
		const values: UniversalHostTemplateProgramValue[] = new Array(count * template.valueCount);
		for (let row = 0; row < count; row++) {
			const source = rows[row]!;
			if (source.length !== template.valueCount) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT &&
						`a row supplied ${source.length} values for a ${template.valueCount}-slot template`,
				);
			}
			for (let slot = 0; slot < template.valueCount; slot++) {
				values[row * template.valueCount + slot] = source[slot];
			}
		}
		let firstInstance: number | null = null;
		if (deltaProducer !== null) {
			if (!templateRunsAllowed()) {
				fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'the direct delta producer requires resident runs');
			}
			if (template.address === undefined) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT && 'the direct delta producer requires an addressed program',
				);
			}
			const parentSite =
				parent === null
					? { instance: 1, slot: 0 }
					: rangeSite !== undefined &&
						  rangeSite.parent === parent &&
						  rangeSite[0] !== undefined &&
						  rangeSite[1] !== null
						? { instance: rangeSite[1], slot: rangeSite[0] }
						: fail(
								LYNX_BLOCK_CORE_DEVELOPMENT &&
									'a nested direct RUN requires its owning compiler range site',
							);
			const beforeSite =
				beforeBlock !== null && beforeBlock !== undefined
					? beforeBlock.firstId === before && beforeBlock.instance !== null
						? { instance: beforeBlock.instance, slot: 0 }
						: fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a direct RUN dynamic anchor is not retained')
					: rangeSite !== undefined && rangeSite[3] === before && rangeSite[2] !== null
						? rangeSite[1] === null
							? fail(
									LYNX_BLOCK_CORE_DEVELOPMENT &&
										'a direct RUN static anchor requires an owning instance',
								)
							: { instance: rangeSite[1], slot: rangeSite[2] }
						: before === null
							? null
							: fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a direct RUN anchor is not retained');
			firstInstance = deltaProducer.run({
				address: template.address,
				parent: parentSite,
				before: beforeSite,
				count,
				values,
				...(template.refs === undefined ? null : { refs: { firstId, stride: template.hostCount } }),
			});
			commandCount++;
		} else if (templateRunsAllowed()) {
			const physicalBefore =
				beforeBlock === null || beforeBlock === undefined
					? ((rangeSite === undefined ? null : nextSiblingHead(rangeSite)?.firstId) ?? before)
					: before;
			// Frozen, like the program it carries: the incremental compact
			// acknowledgement the wire offers for a post-first-screen run is only
			// accepted for a command the producer promised not to mutate.
			const shared = {
				parent,
				before: physicalBefore,
				firstId,
				firstListenerId,
				count,
				values: Object.freeze(values),
			};
			const run = Object.freeze(
				template.address === undefined
					? { ...shared, op: 'mount-template-run' as const, program: template.program }
					: { ...shared, op: 'mount-program-run' as const, address: template.address },
			);
			if (template.address !== undefined) recordUniversalProgramCommand(run, template.program);
			if (rangeSite?.[0] != null) {
				recordUniversalProgramRangeCommand(run, rangeSite[0]);
			}
			emit(run);
		} else {
			const physicalBefore =
				beforeBlock === null || beforeBlock === undefined
					? ((rangeSite === undefined ? null : nextSiblingHead(rangeSite)?.firstId) ?? before)
					: before;
			mountRunLegacy(parent, physicalBefore, template, values, firstId, firstListenerId, count);
		}
		const blocks: LynxBlock[] = new Array(count);
		for (let row = 0; row < count; row++) {
			blocks[row] = {
				template,
				firstId: firstId + row * template.hostCount,
				instance: firstInstance === null ? null : firstInstance + row,
				deferred: rangeSite?.[4] === true,
				visible: true,
				// The listener run is dense in exactly the way the host run is, so a
				// block's own base is its row offset into the run's base. This is the
				// `firstListenerId + rowIndex * eventCount + siteIndex` derivation the
				// applier already uses, resolved once at mount instead of per delivery.
				firstListenerId:
					firstListenerId === null ? null : firstListenerId + row * template.eventCount,
				values: [...rows[row]!],
				key: keys[row],
				index: row,
				prev: null,
				next: null,
			};
		}
		return blocks;
	};

	/**
	 * The same mount, spelled in the vocabulary every peer understands.
	 *
	 * Command-proportional to the hosts rather than to the sites, which is the
	 * cost `mount-template-run` exists to avoid — so this runs only where the
	 * protocol leaves no choice: the one commit that has to adopt or repair a
	 * main-painted first screen. Ids and listener ids are the ones the run
	 * already allocated, so a block mounted this way is indistinguishable
	 * afterwards and a scoped write addresses the same host either way.
	 */
	const mountRunLegacy = (
		parent: UniversalHostParent,
		before: number | null,
		template: LynxBlockTemplate,
		values: readonly UniversalHostTemplateProgramValue[],
		firstId: number,
		firstListenerId: number | null,
		count: number,
	): void => {
		const nodes = template.program.nodes;
		const hostCount = template.hostCount;
		const valueCount = template.valueCount;
		for (let row = 0; row < count; row++) {
			const base = firstId + row * hostCount;
			const rowValues = row * valueCount;
			// Every host first: a child's `insert` needs its parent to exist, and
			// the program's pre-order guarantee only orders parents before children
			// within one pass.
			for (let node = 0; node < hostCount; node++) {
				const descriptor = nodes[node]!;
				let props: Record<string, unknown> = template.staticProps[node]!;
				if (descriptor.bindings !== undefined) {
					props = { ...props };
					for (const binding of descriptor.bindings) {
						props[binding.name] = values[rowValues + binding.valueIndex];
					}
				}
				emit({
					op: 'create',
					id: base + node,
					type: descriptor.type,
					props: Object.freeze(props),
				});
			}
			for (let node = 0; node < hostCount; node++) {
				const descriptor = nodes[node]!;
				emit(
					descriptor.parent === -1
						? { op: 'insert', parent, id: base + node, before }
						: { op: 'insert', parent: base + descriptor.parent, id: base + node, before: null },
				);
			}
			if (firstListenerId === null) continue;
			const rowListener = firstListenerId + row * template.eventCount;
			for (let site = 0; site < template.eventCount; site++) {
				const event = template.program.events[site]!;
				emit({
					op: 'event',
					id: base + event.node,
					type: event.type,
					listener: { id: rowListener + site, priority: event.priority },
				});
			}
		}
	};

	/**
	 * Tear one block's run down.
	 *
	 * A partial keyed removal still uses the explicit vocabulary: `destroy`
	 * refuses a target that is attached or owns children, so one block of H hosts
	 * costs one `remove` plus H `destroy`s in strict child-before-parent order.
	 * Whole-range clear is different: `destroyRange` below can retain the dense
	 * run proof and emit the existing `destroy-run` command instead.
	 */
	const destroyBlock = (parent: UniversalHostParent, block: LynxBlock): void => {
		if (deltaProducer !== null) {
			if (block.instance === null) {
				fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a direct REMOVE requires an instance');
			}
			deltaProducer.remove(block.instance, 1);
			commandCount++;
			return;
		}
		emit({ op: 'remove', parent, id: block.firstId });
		for (let node = block.template.hostCount - 1; node >= 0; node--) {
			const id = block.firstId + node;
			// The frame may still carry an `update` for this host; it stays where
			// it is, ahead of the destroy, and is harmless. What must not survive
			// is its index: ids are never reused, but leaving the entry would keep
			// a dead block's row in the map for the rest of the frame.
			pendingUpdates.delete(id);
			emit({ op: 'destroy', id });
		}
	};

	/**
	 * Tear down a complete range without expanding its dense instance runs on
	 * the background thread or across the wire.
	 *
	 * A range can contain several allocation runs after append/remove cycles, or
	 * even several templates through the public core API. Map insertion order is
	 * allocation order for every core-owned write, so adjacent blocks with the
	 * same template and exact next id form one certified run; every other boundary
	 * starts another command. A reordered physical list does not change that id
	 * proof — the host validates each instance against accepted state before
	 * applying the teardown.
	 */
	const destroyRange = (
		slot: LynxBlockForSlot,
		departed?: (block: LynxBlock) => void,
		membersOwnRanges = false,
	): void => {
		if (deltaProducer !== null) {
			const site = slot as LynxBlockProgramRangeSite;
			if (site[0] === undefined || site[1] === null) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT && 'a direct CLEAR requires its owning compiler range site',
				);
			}
			const retiredInstances: number[] = [];
			for (const block of slot.items.values()) {
				departed?.(block);
				if (block.instance === null) {
					fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a direct CLEAR requires child instances');
				}
				retiredInstances.push(block.instance);
			}
			deltaProducer.clear({ instance: site[1], slot: site[0] }, retiredInstances);
			commandCount++;
			return;
		}
		if (membersOwnRanges) {
			for (const block of slot.items.values()) {
				departed?.(block);
				destroyBlock(slot.parent, block);
			}
			return;
		}
		let first: LynxBlock | null = null;
		let count = 0;
		const flush = (): void => {
			if (first === null) return;
			emit({
				op: 'destroy-run',
				parent: slot.parent,
				firstId: first.firstId,
				count,
				width: first.template.hostCount,
			});
			first = null;
			count = 0;
		};
		for (const block of slot.items.values()) {
			departed?.(block);
			if (
				first !== null &&
				block.template === first.template &&
				block.firstId === first.firstId + count * first.template.hostCount
			) {
				count++;
				continue;
			}
			flush();
			first = block;
			count = 1;
		}
		flush();
	};

	const link = (slot: LynxBlockForSlot, ordered: readonly LynxBlock[]): void => {
		slot.head = ordered.length === 0 ? null : ordered[0]!;
		slot.tail = ordered.length === 0 ? null : ordered[ordered.length - 1]!;
		for (let index = 0; index < ordered.length; index++) {
			const block = ordered[index]!;
			block.index = index;
			block.prev = index === 0 ? null : ordered[index - 1]!;
			block.next = index === ordered.length - 1 ? null : ordered[index + 1]!;
		}
		slot.size = ordered.length;
	};

	const write = (
		block: LynxBlock,
		valueIndex: number,
		value: UniversalHostTemplateProgramValue,
	): boolean => {
		const template = block.template;
		if (valueIndex < 0 || valueIndex >= template.valueCount) {
			fail(LYNX_BLOCK_CORE_DEVELOPMENT && `value slot ${valueIndex} is outside this template`);
		}
		// An unchanged slot emits nothing. The live value lives here, so deciding
		// that costs one comparison and never a round trip.
		// A worklet slot carries an object the compiler rebuilds every render, so
		// identity is never true there and an identity-only compare would re-send an
		// unchanged handler on every re-render. The structural compare runs only for
		// the slots the template marked, so an ordinary slot still costs one
		// `Object.is`. The catching comparator is load-bearing: a malformed
		// descriptor already in the slot must decline equality and ship the update
		// (the applier reports it in its own words), never throw here — otherwise a
		// later valid value could not repair the slot through this API.
		if (
			template.mainThreadValues?.[valueIndex] === true
				? sameLynxUniversalHostPropValue(
						template.valueNames[valueIndex]!,
						block.values[valueIndex],
						value,
					)
				: Object.is(block.values[valueIndex], value)
		) {
			return false;
		}
		if (attemptActive) {
			const capturedByBlock = (attemptCapturedValues ??= new Map());
			const captured = capturedByBlock.get(block);
			if (captured !== valueIndex && !(captured instanceof Set && captured.has(valueIndex))) {
				capturedByBlock.set(
					block,
					captured === undefined
						? valueIndex
						: captured instanceof Set
							? (captured.add(valueIndex), captured)
							: new Set([captured, valueIndex]),
				);
				(attemptValues ??= []).push(block, valueIndex, block.values[valueIndex]!);
			}
		}
		block.values[valueIndex] = value;
		if (deltaProducer !== null) {
			if (block.instance === null) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT &&
						'a direct SET requires the block compact instance identity',
				);
			}
			if (deltaProducer.set(block.instance, valueIndex, value)) commandCount++;
			return true;
		}
		const nodeIndex = template.valueNodes[valueIndex]!;
		// `update` carries the node's complete next props; the applier diffs it
		// against what it holds. Static props are re-sent because they are part of
		// "complete", and every other slot on the same node is re-sent at its live
		// value for the same reason.
		const props: Record<string, unknown> = { ...template.staticProps[nodeIndex] };
		for (let slot = 0; slot < template.valueCount; slot++) {
			if (template.valueNodes[slot] !== nodeIndex) continue;
			props[template.valueNames[slot]!] = block.values[slot];
		}
		const id = block.firstId + nodeIndex;
		const command: UniversalHostCommand = { op: 'update', id, props: Object.freeze(props) };
		// Supersede rather than append. The command above is built from the block's
		// live values, so it already states everything the command it replaces
		// stated: the host lands in the same place and the wire is strictly
		// shorter. This is not the slot-merging U1 §3 left to a scheduler — that
		// asks whether two *different* changes may share one command; this drops a
		// command the core itself has already invalidated.
		//
		// Rewriting at the original index rather than appending keeps the command
		// ordered against this frame's structural work: a `move` or `remove` for
		// the same host does not read its props, and no other host's command can
		// observe them, so the earlier position stays correct.
		const superseded = pendingUpdates.get(id);
		if (superseded !== undefined) {
			commands[superseded] = command;
			return true;
		}
		pendingUpdates.set(id, commands.length);
		emit(command);
		return true;
	};

	const writeBlockValues = (
		block: LynxBlock,
		values: readonly UniversalHostTemplateProgramValue[],
	): void => {
		const template = block.template;
		if (values.length !== template.valueCount) {
			fail(
				LYNX_BLOCK_CORE_DEVELOPMENT &&
					`a block supplied ${values.length} values for a ${template.valueCount}-slot template`,
			);
		}
		for (let valueIndex = 0; valueIndex < template.valueCount; valueIndex++) {
			write(block, valueIndex, values[valueIndex]!);
		}
	};

	const fillForSlot = <Item>(
		slot: LynxBlockForSlot,
		template: LynxBlockTemplate,
		items: readonly Item[],
		key: (item: Item, index: number) => unknown,
		values: (item: Item, index: number) => readonly UniversalHostTemplateProgramValue[],
	): void => {
		if (slot.size !== 0)
			fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'fillForSlot requires an empty range site');
		if (items.length === 0) return;
		captureSlot(slot);
		const rows = items.map((item, index) => values(item, index));
		const keys = items.map((item, index) => key(item, index));
		// Refused, not mis-rendered: a duplicate key would overwrite its twin in
		// the key map, leaking a mounted run no later reconcile or clear can
		// reach. The same stance `runtime.ts` takes for keyed for-blocks.
		const seen = new Set(keys);
		if (seen.size !== keys.length) {
			if (LYNX_BLOCK_CORE_DEVELOPMENT) {
				seen.clear();
				for (const itemKey of keys) {
					if (seen.has(itemKey)) fail(`duplicate key ${String(itemKey)} in a keyed range`);
					seen.add(itemKey);
				}
			}
			fail(false);
		}
		const blocks = mountRun(
			slot.parent,
			(slot as LynxBlockProgramRangeSite)[3],
			template,
			rows,
			keys,
			slot as LynxBlockProgramRangeSite,
		);
		for (const block of blocks) slot.items.set(block.key, block);
		link(slot, blocks);
	};

	const clearForSlot = (
		slot: LynxBlockForSlot,
		departed?: (block: LynxBlock) => void,
		membersOwnRanges = false,
	): void => {
		if (slot.size === 0) return;
		captureSlot(slot);
		// The range site owns every child of its parent node, so all members can
		// retain the dense proof `mountRun` established instead of spelling their
		// host teardown individually.
		destroyRange(slot, departed, membersOwnRanges);
		slot.items.clear();
		slot.head = null;
		slot.tail = null;
		slot.size = 0;
	};

	/**
	 * Apply a proven deletion in O(number of departed blocks).
	 *
	 * The ordinary reconciler must snapshot and rediscover the whole range because
	 * an arbitrary next item list may insert, move, or duplicate members. A
	 * compiler owner that already proved a strict survivor subsequence has none of
	 * those questions left. Its only draft work is the departed blocks themselves.
	 * Keep the logical links and Map committed until ACK, so a rejected transport
	 * drops this closure instead of paying an O(range size) rollback snapshot.
	 */
	const removeKeysForSlot = (
		slot: LynxBlockForSlot,
		keys: readonly unknown[],
		departed?: (block: LynxBlock) => void,
	): void => {
		if (keys.length === 0) return;
		const blocks: LynxBlock[] = new Array(keys.length);
		const seen = new Set<LynxBlock>();
		for (let index = 0; index < keys.length; index++) {
			const block = slot.items.get(keys[index]);
			blockLookups++;
			if (block === undefined || seen.has(block)) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT &&
						'a proven keyed deletion must name distinct members of the committed range',
				);
			}
			seen.add(block);
			blocks[index] = block;
		}
		for (const block of blocks) {
			departed?.(block);
			destroyBlock(slot.parent, block);
		}
		const publish = (): void => {
			for (const block of blocks) {
				const previous = block.prev;
				const next = block.next;
				if (previous === null) slot.head = next;
				else previous.next = next;
				if (next === null) slot.tail = previous;
				else next.prev = previous;
				slot.items.delete(block.key);
				block.prev = null;
				block.next = null;
				slot.size--;
			}
		};
		if (attemptActive) (attemptAccepts ??= []).push(publish);
		else publish();
	};

	const core: LynxBlockCore = {
		beginAttempt() {
			if (attemptActive) fail(LYNX_BLOCK_CORE_DEVELOPMENT && 'a render attempt is already active');
			if (commands.length !== 0 || deltaProducer?.hasPending() === true)
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT && 'a render attempt cannot begin with an unflushed batch',
				);
			deltaProducer?.beginAttempt();
			attemptActive = true;
			attemptNextId = nextId;
			attemptNextListenerId = nextListenerId;
		},

		acceptAttempt() {
			deltaProducer?.acceptAttempt();
			attemptActive = false;
			const accepts = attemptAccepts;
			attemptAccepts = null;
			attemptSlots = null;
			attemptCapturedSlots = null;
			attemptValues = null;
			attemptCapturedValues = null;
			attemptVisibility = null;
			attemptCapturedVisibility = null;
			for (const accept of accepts ?? []) accept();
		},

		abortAttempt() {
			if (!attemptActive) return false;
			attemptActive = false;
			commands = [];
			pendingUpdates = new Map();
			deltaProducer?.abortAttempt();
			nextId = attemptNextId;
			nextListenerId = attemptNextListenerId;
			for (let index = (attemptValues?.length ?? 0) - 3; index >= 0; index -= 3) {
				const block = attemptValues![index] as LynxBlock;
				const valueIndex = attemptValues![index + 1] as number;
				block.values[valueIndex] = attemptValues![index + 2] as UniversalHostTemplateProgramValue;
			}
			for (let index = (attemptVisibility?.length ?? 0) - 2; index >= 0; index -= 2) {
				const block = attemptVisibility![index] as LynxBlock;
				block.visible = attemptVisibility![index + 1] as boolean;
			}
			for (let index = (attemptSlots?.length ?? 0) - 1; index >= 0; index--) {
				const { slot, items, ordered } = attemptSlots![index]!;
				slot.items.clear();
				for (const [key, block] of items) slot.items.set(key, block);
				link(slot, ordered);
			}
			attemptSlots = null;
			attemptCapturedSlots = null;
			attemptValues = null;
			attemptCapturedValues = null;
			attemptVisibility = null;
			attemptCapturedVisibility = null;
			attemptAccepts = null;
			return true;
		},

		mount(parent, before, template, values) {
			return mountRun(parent, before, template, [values], [undefined])[0]!;
		},
		destroyRoot(block) {
			destroyBlock(null, block);
		},

		openForSlot(block, nodeIndex, programRangeSlot, beforeNodeIndex = null) {
			if (nodeIndex < 0 || nodeIndex >= block.template.hostCount) {
				fail(LYNX_BLOCK_CORE_DEVELOPMENT && `host node ${nodeIndex} is outside this template`);
			}
			if (
				beforeNodeIndex !== null &&
				(!Number.isSafeInteger(beforeNodeIndex) ||
					beforeNodeIndex < 0 ||
					beforeNodeIndex >= block.template.hostCount ||
					block.template.program.nodes[beforeNodeIndex]!.parent !== nodeIndex)
			) {
				fail(
					LYNX_BLOCK_CORE_DEVELOPMENT &&
						`static anchor node ${String(beforeNodeIndex)} is not a child of host node ${nodeIndex}`,
				);
			}
			const site = {
				0: programRangeSlot,
				parent: block.firstId + nodeIndex,
				1: block.instance,
				2: beforeNodeIndex,
				3: beforeNodeIndex === null ? null : block.firstId + beforeNodeIndex,
				4: block.deferred || block.template.program.nodes[nodeIndex]!.type === 'list',
				5: null,
				items: new Map(),
				head: null,
				tail: null,
				size: 0,
			} as LynxBlockProgramRangeSite;
			const sites = (block.rangeSites ??= []);
			for (let index = sites.length - 1; index >= 0; index--) {
				const previous = sites[index]!;
				if (previous.parent !== site.parent || previous[3] !== site[3]) continue;
				previous[5] = site;
				break;
			}
			sites.push(site);
			return site;
		},

		fillForSlot,

		clearForSlot,

		removeKeysForSlot,

		reconcileForSlot(
			slot,
			template,
			items,
			key,
			values,
			departed,
			changedIndices,
			membersOwnRanges = false,
		) {
			captureSlot(slot);
			const previous = slot.items;
			if (previous.size === 0) {
				fillForSlot(slot, template, items, key, values);
				return;
			}
			if (items.length === 0) {
				// `departed` travels with the clear. A range that empties is the one
				// departure path an owner cannot see coming: every other member leaves
				// through the removal sweep below, so an owner that released listeners
				// there would still leak every listener of the last list it held.
				clearForSlot(slot, departed, membersOwnRanges);
				return;
			}
			if (LYNX_BLOCK_CORE_DEVELOPMENT && changedIndices !== undefined) {
				let previous = -1;
				for (const index of changedIndices) {
					if (!Number.isSafeInteger(index) || index <= previous || index >= items.length) {
						fail('changed row indices must be unique, ascending, and inside the next range');
					}
					previous = index;
				}
			}
			const keys: unknown[] = new Array(items.length);
			const survivors: (LynxBlock | null)[] = new Array(items.length);
			const sequence: number[] = new Array(items.length);
			let orderedSurvivors = true;
			let lastSurvivorIndex = -1;
			// Refused, not mis-rendered: with a duplicate key the same survivor
			// would match twice, its second placement would anchor a move on
			// itself, and `slot.size` would diverge from the item count. After that
			// check, the same set is the exact desired-key set for the removal pass.
			const seen = new Set<unknown>();
			for (let index = 0; index < items.length; index++) {
				const itemKey = key(items[index]!, index);
				if (seen.has(itemKey))
					fail(LYNX_BLOCK_CORE_DEVELOPMENT && `duplicate key ${String(itemKey)} in a keyed range`);
				seen.add(itemKey);
				keys[index] = itemKey;
				const survivor = previous.get(itemKey);
				blockLookups++;
				if (survivor === undefined) {
					survivors[index] = null;
					sequence[index] = -1;
				} else {
					survivors[index] = survivor;
					const previousIndex = survivor.index;
					sequence[index] = previousIndex;
					if (previousIndex < lastSurvivorIndex) orderedSurvivors = false;
					else lastSurvivorIndex = previousIndex;
				}
			}

			// Removals first: a survivor's `before` anchor must not name a block
			// that is about to leave.
			for (const [itemKey, block] of previous) {
				if (seen.has(itemKey)) continue;
				departed?.(block);
				destroyBlock(slot.parent, block);
				previous.delete(itemKey);
			}

			// Insertions and removals preserve survivor order. Their right-to-left
			// mounts need no LIS and no survivor moves; only a real reorder pays for
			// the subsequence that decides which instances stay put.
			const stable = orderedSurvivors ? null : longestIncreasingSubsequence(sequence);
			const ordered: LynxBlock[] = new Array(items.length);
			let changedCursor = (changedIndices?.length ?? 0) - 1;
			// Right to left, so the anchor is always a block already placed.
			for (let index = items.length - 1; index >= 0; index--) {
				const valuesChanged =
					changedIndices === undefined || changedIndices[changedCursor] === index;
				if (valuesChanged && changedIndices !== undefined) changedCursor--;
				const beforeBlock = index + 1 < items.length ? ordered[index + 1]! : null;
				const site = slot as LynxBlockProgramRangeSite;
				const before = beforeBlock?.firstId ?? site[3];
				const survivor = survivors[index];
				if (survivor === null) {
					const block = mountRun(
						slot.parent,
						before,
						template,
						[values(items[index]!, index)],
						[keys[index]],
						slot as LynxBlockProgramRangeSite,
						beforeBlock,
					)[0]!;
					previous.set(block.key, block);
					ordered[index] = block;
					continue;
				}
				// A survivor's values are patched in place, never re-run: the
				// instance carries host-resident state (input value, scroll offset,
				// selection) that a fresh `RUN` would destroy. This is the same
				// requirement `runtime.ts:17389` states for the DOM host.
				if (valuesChanged) {
					const next = values(items[index]!, index);
					if (next.length !== template.valueCount) {
						fail(
							LYNX_BLOCK_CORE_DEVELOPMENT &&
								`a row supplied ${next.length} values for a ${template.valueCount}-slot template`,
						);
					}
					for (let valueIndex = 0; valueIndex < template.valueCount; valueIndex++) {
						write(survivor, valueIndex, next[valueIndex]);
					}
				}
				if (stable !== null && stable[index] !== -2) {
					if (deltaProducer !== null) {
						if (
							survivor.instance === null ||
							site[0] === undefined ||
							site[1] === null ||
							(beforeBlock !== null && beforeBlock.instance === null)
						) {
							fail(
								LYNX_BLOCK_CORE_DEVELOPMENT &&
									'a direct MOVE requires retained instance and compiler range identities',
							);
						}
						deltaProducer.move(
							survivor.instance,
							{ instance: site[1], slot: site[0] },
							beforeBlock !== null
								? { instance: beforeBlock.instance!, slot: 0 }
								: site[2] === null
									? null
									: site[1] === null
										? fail(
												LYNX_BLOCK_CORE_DEVELOPMENT &&
													'a direct MOVE static anchor requires an owning instance',
											)
										: { instance: site[1], slot: site[2] },
						);
						commandCount++;
					} else {
						const move: UniversalHostCommand = {
							op: 'move',
							parent: slot.parent,
							id: survivor.firstId,
							before: beforeBlock?.firstId ?? nextSiblingHead(site)?.firstId ?? site[3],
						};
						if (site[0] != null) recordUniversalProgramRangeCommand(move, site[0]);
						emit(move);
					}
				}
				ordered[index] = survivor;
			}
			link(slot, ordered);
		},

		writeValues(block, values) {
			blockLookups++;
			writeBlockValues(block, values);
		},

		writeKeyedValues(slot, key, values) {
			blockLookups++;
			const block = slot.items.get(key);
			if (block === undefined) return undefined;
			writeBlockValues(block, values);
			return block;
		},

		setKeyedSlotValue(slot, key, valueIndex, value) {
			// The whole architectural claim in three lines: one map lookup, one
			// comparison, at most one command. The list's size does not appear.
			blockLookups++;
			const block = slot.items.get(key);
			if (block === undefined) return false;
			return write(block, valueIndex, value);
		},

		setSlotValue(block, valueIndex, value) {
			blockLookups++;
			return write(block, valueIndex, value);
		},

		setVisibility(block, visible) {
			if (block.visible === visible) return false;
			blockLookups++;
			if (attemptActive) {
				const captured = (attemptCapturedVisibility ??= new Set());
				if (!captured.has(block)) {
					captured.add(block);
					(attemptVisibility ??= []).push(block, block.visible);
				}
			}
			block.visible = visible;
			if (deltaProducer !== null) {
				if (block.instance === null) {
					fail(
						LYNX_BLOCK_CORE_DEVELOPMENT &&
							'a direct VIS requires the block compact instance identity',
					);
				}
				deltaProducer.visibility(block.instance, visible);
				commandCount++;
			} else {
				// Match the universal visibility walk: descendants hide before their
				// ancestors so resources detach from live parents, while reveal runs in
				// pre-order so parents exist before descendants reconnect. A compact
				// resident instance expresses the same transition as one VIS delta.
				if (visible) {
					for (let node = 0; node < block.template.hostCount; node++) {
						emit({ op: 'visibility', id: block.firstId + node, state: 'visible' });
					}
				} else {
					for (let node = block.template.hostCount - 1; node >= 0; node--) {
						emit({ op: 'visibility', id: block.firstId + node, state: 'hidden' });
					}
				}
			}
			return true;
		},

		flush() {
			if (deltaProducer !== null) {
				if (commands.length !== 0) {
					fail(
						LYNX_BLOCK_CORE_DEVELOPMENT &&
							'the direct delta path accumulated a general host command',
					);
				}
				const batch = deltaProducer.flush(version + 1);
				if (batch !== null) version++;
				return batch;
			}
			if (commands.length === 0) return null;
			// U1 §3: a commit's ops are handed over as one frame. A partial frame
			// can name a `before` anchor the main thread has not allocated yet,
			// which the applier cannot represent and must not guess at.
			const batch: UniversalHostBatch = {
				renderer: LYNX_RENDERER,
				version: ++version,
				commands: Object.freeze(commands),
			};
			commands = [];
			pendingUpdates = new Map();
			return batch;
		},

		counters() {
			return { blockLookups, commands: commandCount };
		},

		resetCounters() {
			blockLookups = 0;
			commandCount = 0;
		},
	};
	if (LYNX_PROFILE) {
		const globals = globalThis as LynxBlockCoreProfileGlobals;
		(globals.__OCTANE_LYNX_BLOCK_CORES__ ??= []).push({
			counters: () => core.counters(),
			resetCounters: () => core.resetCounters(),
		});
	}
	return core;
}
