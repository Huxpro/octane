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
 * ## Why this emits host commands rather than delta frames
 *
 * `UniversalHostBatch` already carries the whole vocabulary the Block model
 * needs: `mount-template-run` is `RUN`, `update` is `SET`, `move` is `MOVE`,
 * `remove`/`destroy` is `REMOVE`, `visibility` is `VIS`. The v2 delta protocol
 * (`delta-protocol.ts`) is a compact *encoding* of that vocabulary, not new
 * applier capability. Emitting commands keeps the applier, the wire, the PAPI
 * layer, and the event journal shared with the universal path — which is the
 * only thing that makes a physical-tree comparison between the two cores mean
 * anything. Fork the applier and byte-equality of the tree proves nothing.
 *
 * ## What this slice is not
 *
 * No hooks. The scoped entry points here (`setSlotValue`, `reconcileForSlot`)
 * are what a `useState` setter would call; the hook cells that call them are
 * the next slice. No de-opt regions, Suspense, Activity, portals, or native
 * lists — every one of those is refused explicitly by `compileLynxBlockTemplate`
 * or by the caller, rather than mis-rendered.
 */

import { sameLynxMainThreadPropValue } from './host-props.js';
import type {
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostParent,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramValue,
} from 'octane/universal/native';

/** Renderer tag every Lynx batch carries; the applier rejects anything else. */
const LYNX_RENDERER = 'lynx';

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
}

function fail(message: string): never {
	throw new Error(`Octane Lynx block core: ${message}.`);
}

/**
 * Compile a template program into the shape this core walks.
 *
 * The program's own invariants (pre-order nodes, `parent === -1` at the root,
 * parents strictly earlier, `#text` only under `text`) are the applier's and
 * are re-checked there. What this adds is the value-slot inverse map, and the
 * refusals this slice owes: a native list is not adoptable by the specialized
 * path, and a value slot bound twice would make "which node owns this slot"
 * ambiguous.
 */
export function compileLynxBlockTemplate(program: UniversalHostTemplateProgram): LynxBlockTemplate {
	const nodes = program.nodes;
	if (!Array.isArray(nodes) || nodes.length === 0) fail('a template needs at least one host node');
	const valueNodes: number[] = [];
	const valueNames: string[] = [];
	let mainThreadValues: boolean[] | null = null;
	const staticProps: Readonly<Record<string, unknown>>[] = new Array(nodes.length);
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]!;
		if (node.type === 'list' || node.type === 'list-item') {
			fail('native lists are not in the specialized core (issue #103 U2 scope)');
		}
		staticProps[index] = node.props;
		if (node.bindings === undefined) continue;
		for (const binding of node.bindings) {
			if (valueNodes[binding.valueIndex] !== undefined) {
				fail(`value slot ${binding.valueIndex} is bound by more than one host node`);
			}
			valueNodes[binding.valueIndex] = index;
			valueNames[binding.valueIndex] = binding.name;
			if (binding.name.startsWith('main-thread:')) {
				// Raw text owns no Element surface, so it can hold neither a worklet
				// nor a ref. The applier refuses it too; refusing at compile time
				// reports the authoring mistake before any instance exists.
				if (node.type === '#text' || node.type === 'raw-text') {
					fail(`slot ${binding.valueIndex} binds ${binding.name} on ${node.type}`);
				}
				(mainThreadValues ??= [])[binding.valueIndex] = true;
			}
		}
	}
	for (let slot = 0; slot < valueNodes.length; slot++) {
		if (valueNodes[slot] === undefined) fail(`value slot ${slot} is declared but never bound`);
		if (mainThreadValues !== null) mainThreadValues[slot] ??= false;
	}
	return Object.freeze({
		program,
		hostCount: nodes.length,
		valueCount: valueNodes.length,
		eventCount: program.events.length,
		valueNodes: Object.freeze(valueNodes),
		valueNames: Object.freeze(valueNames),
		staticProps: Object.freeze(staticProps),
		mainThreadValues: mainThreadValues === null ? null : Object.freeze(mainThreadValues),
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
	readonly values: UniversalHostTemplateProgramValue[];
	readonly key: unknown;
	/** Survivor list, as in `runtime.ts` — the LIS operates over this order. */
	prev: LynxBlock | null;
	next: LynxBlock | null;
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

export interface LynxBlockCoreOptions {
	/** First host id this root may allocate. Ids are dense and monotonic. */
	readonly firstId?: number;
	readonly firstListenerId?: number;
}

export interface LynxBlockCore {
	/** Mount a template into a range site and return its block. */
	mount(
		parent: UniversalHostParent,
		before: number | null,
		template: LynxBlockTemplate,
		values: readonly UniversalHostTemplateProgramValue[],
	): LynxBlock;
	/** Open a keyed range site rooted at one host node of an existing block. */
	openForSlot(block: LynxBlock, nodeIndex: number): LynxBlockForSlot;
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
	 * listeners and any other per-block resources it holds.
	 */
	reconcileForSlot<Item>(
		slot: LynxBlockForSlot,
		template: LynxBlockTemplate,
		items: readonly Item[],
		key: (item: Item, index: number) => unknown,
		values: (item: Item, index: number) => readonly UniversalHostTemplateProgramValue[],
		departed?: (block: LynxBlock) => void,
	): void;
	/**
	 * Tear down every member of a range site. `departed` fires per member
	 * before destruction, with the same release obligation as reconcile.
	 */
	clearForSlot(slot: LynxBlockForSlot, departed?: (block: LynxBlock) => void): void;
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
	/** Hand the accumulated frame to the caller. Null when nothing changed. */
	flush(): UniversalHostBatch | null;
	counters(): LynxBlockCoreCounters;
	resetCounters(): void;
}

/**
 * The longest increasing subsequence of `sequence`, returned as indices into
 * it. Entries equal to `-1` are new members and never join the subsequence.
 *
 * This is the same choice `runtime.ts` makes and the same one
 * `docs/differences-from-react.md` documents: survivors in the subsequence stay
 * put and everything else moves, so the final order is guaranteed while the set
 * of physically moved nodes is not.
 */
function longestIncreasingSubsequence(sequence: readonly number[]): number[] {
	const length = sequence.length;
	if (length === 0) return [];
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
	const result: number[] = [];
	let cursor = tails.length === 0 ? -1 : tails[tails.length - 1]!;
	while (cursor !== -1) {
		result.push(cursor);
		cursor = predecessors[cursor]!;
	}
	result.reverse();
	return result;
}

export function createLynxBlockCore(options: LynxBlockCoreOptions = {}): LynxBlockCore {
	// The instance allocator U1 §2 names as the core's only new global state:
	// a monotonic counter handing out dense runs. Nothing about a handle is
	// shipped for adoption — both threads run the same counter over the same
	// deterministic render, which is what U1 §4 turns adoption into.
	let nextId = options.firstId ?? 1;
	let nextListenerId = options.firstListenerId ?? 1;
	let commands: UniversalHostCommand[] = [];
	let version = 0;
	let blockLookups = 0;
	let commandCount = 0;

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
	): LynxBlock[] => {
		const count = rows.length;
		const firstId = allocate(template, count);
		const firstListenerId = allocateListeners(template, count);
		const values: UniversalHostTemplateProgramValue[] = new Array(count * template.valueCount);
		for (let row = 0; row < count; row++) {
			const source = rows[row]!;
			if (source.length !== template.valueCount) {
				fail(`a row supplied ${source.length} values for a ${template.valueCount}-slot template`);
			}
			for (let slot = 0; slot < template.valueCount; slot++) {
				values[row * template.valueCount + slot] = source[slot];
			}
		}
		emit({
			op: 'mount-template-run',
			parent,
			before,
			program: template.program,
			firstId,
			firstListenerId,
			count,
			values: Object.freeze(values),
		});
		const blocks: LynxBlock[] = new Array(count);
		for (let row = 0; row < count; row++) {
			blocks[row] = {
				template,
				firstId: firstId + row * template.hostCount,
				// The listener run is dense in exactly the way the host run is, so a
				// block's own base is its row offset into the run's base. This is the
				// `firstListenerId + rowIndex * eventCount + siteIndex` derivation the
				// applier already uses, resolved once at mount instead of per delivery.
				firstListenerId:
					firstListenerId === null ? null : firstListenerId + row * template.eventCount,
				values: [...rows[row]!],
				key: keys[row],
				prev: null,
				next: null,
			};
		}
		return blocks;
	};

	/**
	 * Tear one block's run down.
	 *
	 * This is the one place the command vocabulary is measurably weaker than the
	 * v2 delta protocol rather than merely more verbose. `destroy` refuses a
	 * target that is still attached or still owns children, so a run of H hosts
	 * costs one `remove` plus H `destroy`s in strict child-before-parent order —
	 * the pre-order node array run backwards. `REMOVE {firstInstance, count}`
	 * says the same thing in one frame because the run is dense by construction.
	 * Recorded rather than worked around: it is a reason the delta encoding earns
	 * its keep beyond compactness, and it is why the counts below report the
	 * teardown path as O(hosts) honestly instead of claiming O(1).
	 */
	const destroyBlock = (parent: UniversalHostParent, block: LynxBlock): void => {
		emit({ op: 'remove', parent, id: block.firstId });
		for (let node = block.template.hostCount - 1; node >= 0; node--) {
			emit({ op: 'destroy', id: block.firstId + node });
		}
	};

	const link = (slot: LynxBlockForSlot, ordered: readonly LynxBlock[]): void => {
		slot.head = ordered.length === 0 ? null : ordered[0]!;
		slot.tail = ordered.length === 0 ? null : ordered[ordered.length - 1]!;
		for (let index = 0; index < ordered.length; index++) {
			const block = ordered[index]!;
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
			fail(`value slot ${valueIndex} is outside this template`);
		}
		// An unchanged slot emits nothing. The live value lives here, so deciding
		// that costs one comparison and never a round trip.
		//
		// Two changed slots on the same host node emit two `update` commands
		// rather than one merged command. Both are correct — each carries the
		// node's complete live props and the applier diffs them in order — and
		// merging is a coalescing decision this slice deliberately leaves to the
		// scheduler (U1 §3) rather than hiding inside the write.
		// A worklet slot carries an object the compiler rebuilds every render, so
		// identity is never true there and an identity-only compare would re-send an
		// unchanged handler on every re-render. The structural compare runs only for
		// the slots the template marked, so an ordinary slot still costs one
		// `Object.is`.
		if (
			template.mainThreadValues?.[valueIndex] === true
				? sameLynxMainThreadPropValue(
						template.valueNames[valueIndex]!,
						block.values[valueIndex],
						value,
					)
				: Object.is(block.values[valueIndex], value)
		) {
			return false;
		}
		block.values[valueIndex] = value;
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
		emit({ op: 'update', id: block.firstId + nodeIndex, props: Object.freeze(props) });
		return true;
	};

	const fillForSlot = <Item>(
		slot: LynxBlockForSlot,
		template: LynxBlockTemplate,
		items: readonly Item[],
		key: (item: Item, index: number) => unknown,
		values: (item: Item, index: number) => readonly UniversalHostTemplateProgramValue[],
	): void => {
		if (slot.size !== 0) fail('fillForSlot requires an empty range site');
		if (items.length === 0) return;
		const rows = items.map((item, index) => values(item, index));
		const keys = items.map((item, index) => key(item, index));
		// Refused, not mis-rendered: a duplicate key would overwrite its twin in
		// the key map, leaking a mounted run no later reconcile or clear can
		// reach. The same stance `runtime.ts` takes for keyed for-blocks.
		const seen = new Set<unknown>();
		for (const itemKey of keys) {
			if (seen.has(itemKey)) fail(`duplicate key ${String(itemKey)} in a keyed range`);
			seen.add(itemKey);
		}
		const blocks = mountRun(slot.parent, null, template, rows, keys);
		for (const block of blocks) slot.items.set(block.key, block);
		link(slot, blocks);
	};

	const clearForSlot = (slot: LynxBlockForSlot, departed?: (block: LynxBlock) => void): void => {
		if (slot.size === 0) return;
		// The range site owns every child of its parent node, which is the
		// condition `delta-protocol.ts` states for `CLEAR` — but the command
		// vocabulary has no clear, so this pays `destroyBlock` per member. See
		// its comment: the gap is the protocol's, not this core's.
		for (const block of slot.items.values()) {
			departed?.(block);
			destroyBlock(slot.parent, block);
		}
		slot.items.clear();
		slot.head = null;
		slot.tail = null;
		slot.size = 0;
	};

	return {
		mount(parent, before, template, values) {
			return mountRun(parent, before, template, [values], [undefined])[0]!;
		},

		openForSlot(block, nodeIndex) {
			if (nodeIndex < 0 || nodeIndex >= block.template.hostCount) {
				fail(`host node ${nodeIndex} is outside this template`);
			}
			return {
				parent: block.firstId + nodeIndex,
				items: new Map(),
				head: null,
				tail: null,
				size: 0,
			};
		},

		fillForSlot,

		clearForSlot,

		reconcileForSlot(slot, template, items, key, values, departed) {
			const previous = slot.items;
			if (previous.size === 0) {
				fillForSlot(slot, template, items, key, values);
				return;
			}
			if (items.length === 0) {
				clearForSlot(slot);
				return;
			}
			const keys: unknown[] = new Array(items.length);
			const survivors: (LynxBlock | null)[] = new Array(items.length);
			const oldOrder = new Map<LynxBlock, number>();
			{
				let position = 0;
				for (let cursor = slot.head; cursor !== null; cursor = cursor.next) {
					oldOrder.set(cursor, position++);
				}
			}
			const sequence: number[] = new Array(items.length);
			const matched = new Set<LynxBlock>();
			// Refused, not mis-rendered: with a duplicate key the same survivor
			// would match twice, its second placement would anchor a move on
			// itself, and `slot.size` would diverge from the item count.
			const seen = new Set<unknown>();
			for (let index = 0; index < items.length; index++) {
				const itemKey = key(items[index]!, index);
				if (seen.has(itemKey)) fail(`duplicate key ${String(itemKey)} in a keyed range`);
				seen.add(itemKey);
				keys[index] = itemKey;
				const survivor = previous.get(itemKey);
				blockLookups++;
				if (survivor === undefined) {
					survivors[index] = null;
					sequence[index] = -1;
				} else {
					survivors[index] = survivor;
					sequence[index] = oldOrder.get(survivor)!;
					matched.add(survivor);
				}
			}

			// Removals first: a survivor's `before` anchor must not name a block
			// that is about to leave.
			for (const [itemKey, block] of previous) {
				if (matched.has(block)) continue;
				departed?.(block);
				destroyBlock(slot.parent, block);
				previous.delete(itemKey);
			}

			const stable = new Set(longestIncreasingSubsequence(sequence));
			const ordered: LynxBlock[] = new Array(items.length);
			// Right to left, so the anchor is always a block already placed.
			for (let index = items.length - 1; index >= 0; index--) {
				const before = index + 1 < items.length ? ordered[index + 1]!.firstId : null;
				const survivor = survivors[index];
				if (survivor === null) {
					const block = mountRun(
						slot.parent,
						before,
						template,
						[values(items[index]!, index)],
						[keys[index]],
					)[0]!;
					previous.set(block.key, block);
					ordered[index] = block;
					continue;
				}
				// A survivor's values are patched in place, never re-run: the
				// instance carries host-resident state (input value, scroll offset,
				// selection) that a fresh `RUN` would destroy. This is the same
				// requirement `runtime.ts:17389` states for the DOM host.
				const next = values(items[index]!, index);
				if (next.length !== template.valueCount) {
					fail(`a row supplied ${next.length} values for a ${template.valueCount}-slot template`);
				}
				for (let valueIndex = 0; valueIndex < template.valueCount; valueIndex++) {
					write(survivor, valueIndex, next[valueIndex]);
				}
				if (!stable.has(index)) {
					emit({ op: 'move', parent: slot.parent, id: survivor.firstId, before });
				}
				ordered[index] = survivor;
			}
			link(slot, ordered);
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

		flush() {
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
}
