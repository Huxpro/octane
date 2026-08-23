import type {
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostTemplateProgram,
} from '../../packages/octane/src/universal-core.js';
import {
	createLynxHostContainer,
	disposeLynxHostContainer,
	getLynxHostHandle,
	getLynxListDiagnostics,
	prepareLynxHostBatch,
	type LynxHostAttachmentDelta,
	type LynxHostContainer,
} from '../../packages/lynx/src/core/host-driver.js';
import type {
	LynxElementPAPI,
	LynxListComponentAtIndex,
	LynxListComponentAtIndexes,
	LynxListEnqueueComponent,
} from '../../packages/lynx/src/core/papi.js';

export const LOGICAL_ITEM_COUNT = 1_000;
export const VISIBLE_WINDOW_SIZE = 12;
/** A steady-state step, far from both ends of the scroll. */
const STEP_BREAKDOWN_INDEX = LOGICAL_ITEM_COUNT >> 1;

interface FakeNode {
	readonly sign: number;
	readonly type: string;
	parent: FakeNode | null;
	readonly children: FakeNode[];
	readonly attributes: Map<string, unknown>;
	readonly events: Map<string, string>;
	text: string;
}

interface FakeListCallbacks {
	readonly componentAtIndex: LynxListComponentAtIndex<FakeNode>;
	readonly componentAtIndexes: LynxListComponentAtIndexes<FakeNode>;
	readonly enqueueComponent: LynxListEnqueueComponent<FakeNode>;
}

interface ItemIds {
	readonly item: number;
	readonly text: number;
	readonly raw: number;
}

function idsAt(index: number): ItemIds {
	return { item: index * 3 + 2, text: index * 3 + 3, raw: index * 3 + 4 };
}

function batch(version: number, commands: readonly UniversalHostCommand[]): UniversalHostBatch {
	return { renderer: 'lynx', version, commands };
}

/**
 * The row template this fixture repeats, stated once so the reuse floor below is
 * derived from the same source the rows are built from rather than restated as a
 * constant. Every row is `list-item > text > #text`; `reuse-identifier` is the
 * same string on every row, `item-key` and the text value are not.
 */
const ROW_SLOTS = Object.freeze([
	Object.freeze({ node: 'list-item' as const, name: 'item-key', varies: true }),
	Object.freeze({ node: 'list-item' as const, name: 'reuse-identifier', varies: false }),
	Object.freeze({ node: '#text' as const, name: 'text', varies: true }),
]);

/**
 * What one recycle costs a renderer that keeps the row as a slot table: write the
 * slots whose value differs between the outgoing row and the incoming one, and
 * touch only the nodes that own them. It is a floor, not a target — a real
 * implementation also has list bookkeeping to do — and it is what the measured
 * per-reuse work is reported against.
 */
const REUSE_FLOOR = Object.freeze({
	writes: ROW_SLOTS.filter((slot) => slot.varies).length,
	nodesTouched: new Set(ROW_SLOTS.filter((slot) => slot.varies).map((slot) => slot.node)).size,
});

/**
 * The per-row strings, generated once so both arms of a retention comparison
 * hold the *same* string instances. What is then measured is the structure each
 * arm builds on top of the application's own data, not the data itself.
 */
export interface RowData {
	readonly itemKeys: readonly string[];
	/** The values that differ between rows, in template-slot order. */
	readonly values: readonly (readonly string[])[];
}

export function narrowRowData(itemCount: number): RowData {
	const itemKeys: string[] = [];
	const values: string[][] = [];
	for (let index = 0; index < itemCount; index++) {
		itemKeys.push(`item-${index}`);
		values.push([`Row ${index}`]);
	}
	return Object.freeze({ itemKeys, values });
}

export function wideRowData(itemCount: number): RowData {
	const itemKeys: string[] = [];
	const values: string[][] = [];
	for (let index = 0; index < itemCount; index++) {
		itemKeys.push(`item-${index}`);
		values.push([`Title ${index}`, `Sub ${index}`]);
	}
	return Object.freeze({ itemKeys, values });
}

function listMountCommands(
	itemCount: number,
	data: RowData = narrowRowData(itemCount),
): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [
		{ op: 'create', id: 1, type: 'list', props: { id: 'allocation-bench' } },
	];
	for (let index = 0; index < itemCount; index++) {
		const ids = idsAt(index);
		commands.push(
			{
				op: 'create',
				id: ids.item,
				type: 'list-item',
				props: { 'item-key': data.itemKeys[index]!, 'reuse-identifier': 'bench-row' },
			},
			{ op: 'create', id: ids.text, type: 'text', props: {} },
			{ op: 'create', id: ids.raw, type: '#text', props: { value: data.values[index]![0]! } },
			{ op: 'insert', parent: ids.text, id: ids.raw, before: null },
			{ op: 'insert', parent: ids.item, id: ids.text, before: null },
			{ op: 'insert', parent: 1, id: ids.item, before: null },
		);
	}
	commands.push({ op: 'insert', parent: null, id: 1, before: null });
	return commands;
}

function listUnmountCommands(itemCount: number): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [];
	for (let index = 0; index < itemCount; index++) {
		const ids = idsAt(index);
		commands.push(
			{ op: 'remove', parent: ids.text, id: ids.raw },
			{ op: 'destroy', id: ids.raw },
			{ op: 'remove', parent: ids.item, id: ids.text },
			{ op: 'destroy', id: ids.text },
			{ op: 'remove', parent: 1, id: ids.item },
			{ op: 'destroy', id: ids.item },
		);
	}
	commands.push({ op: 'remove', parent: null, id: 1 }, { op: 'destroy', id: 1 });
	return commands;
}

/**
 * The narrow row as a wire program, describing exactly what
 * `listMountCommands` builds by hand above.
 *
 * The two have to agree node for node and prop for prop, or a comparison
 * between them measures two different pages rather than two ways of holding
 * one. Slot 0 is `item-key` and slot 1 is the row's text; `reuse-identifier` is
 * the same string on every row, so it is a static prop rather than a slot —
 * which is also why a run's values array is two entries per row and not three.
 */
const NARROW_ROW_PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'list-item',
			parent: -1,
			props: Object.freeze({ 'reuse-identifier': 'bench-row' }),
			bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
		}),
		Object.freeze({ type: 'text', parent: 0, props: Object.freeze({}) }),
		Object.freeze({
			type: '#text',
			parent: 1,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
	]),
	events: Object.freeze([]),
});

/** The wide row as a wire program; same correspondence as the narrow one. */
const WIDE_ROW_PROGRAM: UniversalHostTemplateProgram = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			type: 'list-item',
			parent: -1,
			props: Object.freeze({ 'reuse-identifier': 'wide-row' }),
			bindings: Object.freeze([Object.freeze({ name: 'item-key', valueIndex: 0 })]),
		}),
		Object.freeze({
			type: 'view',
			parent: 0,
			props: Object.freeze({ class: 'card', style: 'padding:8px' }),
		}),
		Object.freeze({ type: 'text', parent: 1, props: Object.freeze({ class: 'title' }) }),
		Object.freeze({
			type: '#text',
			parent: 2,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]),
		}),
		Object.freeze({ type: 'text', parent: 1, props: Object.freeze({ class: 'subtitle' }) }),
		Object.freeze({
			type: '#text',
			parent: 4,
			props: Object.freeze({}),
			bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 2 })]),
		}),
		Object.freeze({ type: 'view', parent: 1, props: Object.freeze({ class: 'badges' }) }),
		Object.freeze({ type: 'text', parent: 6, props: Object.freeze({ class: 'badge' }) }),
		Object.freeze({ type: '#text', parent: 7, props: Object.freeze({ value: 'NEW' }) }),
	]),
	events: Object.freeze([]),
});

/** The wire program for a row shape. */
function rowProgram(kind: 'narrow' | 'wide'): UniversalHostTemplateProgram {
	return kind === 'narrow' ? NARROW_ROW_PROGRAM : WIDE_ROW_PROGRAM;
}

/**
 * The same page as `listMountCommands`, declared rather than built: one `<list>`
 * and one deferred `mount-template-run` carrying every row's values.
 *
 * Host ids are laid out `firstId + row * width`, which is what
 * `templateRunRecord` derives from and what `idsAt`/`wideRowIds` already
 * produce — so a row's ids are the same integers in both arms and an update
 * addressed to one is addressed to the same row in the other.
 */
function deferredListMountCommands(
	kind: 'narrow' | 'wide',
	itemCount: number,
	data: RowData,
): UniversalHostCommand[] {
	const program = rowProgram(kind);
	const values: string[] = [];
	for (let index = 0; index < itemCount; index++) {
		values.push(data.itemKeys[index]!, ...data.values[index]!);
	}
	return [
		{
			op: 'create',
			id: 1,
			type: 'list',
			props: { id: kind === 'narrow' ? 'allocation-bench' : 'wide-row-bench' },
		},
		{
			op: 'mount-template-run',
			parent: 1,
			before: null,
			program,
			firstId: 2,
			firstListenerId: null,
			count: itemCount,
			values: Object.freeze(values),
			deferred: true,
		},
		{ op: 'insert', parent: null, id: 1, before: null },
	];
}

/**
 * One `update` per row against the `#text` that carries the row's first varying
 * value — the commit a re-render produces when that value changed.
 *
 * The `#text` is node 2 of the narrow program and node 3 of the wide one, and a
 * host's id is its row's base plus its index in the program, which is the same
 * layout `idsAt`/`wideRowIds` produce and the one `templateRunRecord` derives
 * from. So these ids name the same rows in both arms.
 */
function rowTextUpdates(kind: 'narrow' | 'wide', rows: number): UniversalHostCommand[] {
	const width = rowProgram(kind).nodes.length;
	const textNode = kind === 'narrow' ? 2 : 3;
	const updates: UniversalHostCommand[] = [];
	for (let index = 0; index < rows; index++) {
		updates.push({
			op: 'update',
			id: 2 + index * width + textNode,
			props: { value: `Renamed ${index}` },
		});
	}
	return updates;
}

/** One recorded window of Element PAPI traffic, by kind. */
export interface SampledPapiWork {
	/** Value-carrying calls: every `set*` entry point. */
	readonly writes: number;
	/** Element creation, including the list itself. */
	readonly creates: number;
	/** Tree edits: insert, remove, replace. */
	readonly structural: number;
	/** Non-mutating questions the host asked the platform. */
	readonly queries: number;
	readonly flushes: number;
	/** Distinct native nodes any call above named. */
	readonly nodesTouched: number;
	/** Every entry point that fired, by name, so a total can be explained. */
	readonly byOp: Readonly<Record<string, number>>;
}

const WRITE_OPS = new Set([
	'setAttribute',
	'setClasses',
	'setInlineStyles',
	'setCssId',
	'setRefSelector',
	'setDataset',
	'setEvent',
	'setId',
	'list.updateComponents',
]);
const CREATE_OPS = new Set(['createElement', 'createPage', 'list.create']);
const STRUCTURAL_OPS = new Set(['insertBefore', 'remove', 'replace']);
const QUERY_OPS = new Set(['getUniqueId', 'isChild']);

class FakeLynxPAPI {
	readonly papi: LynxElementPAPI<FakeNode>;
	private nextSign = 1;
	private flushes = 0;
	private readonly nodes = new Map<number, FakeNode>();
	private readonly callbacks = new Map<FakeNode, FakeListCallbacks>();
	private recording = false;
	private readonly recordedOps = new Map<string, number>();
	private readonly recordedNodes = new Set<FakeNode>();
	/** Running write total, so a nested window can be measured without summarizing. */
	private recordedWrites = 0;

	constructor() {
		this.papi = {
			list: Object.freeze({
				create: (
					_parentComponentUniqueId: number,
					componentAtIndex: LynxListComponentAtIndex<FakeNode>,
					enqueueComponent: LynxListEnqueueComponent<FakeNode>,
					componentAtIndexes: LynxListComponentAtIndexes<FakeNode>,
				) => {
					const node = this.createNode('list');
					this.record('list.create', node);
					this.callbacks.set(node, {
						componentAtIndex,
						componentAtIndexes,
						enqueueComponent,
					});
					return node;
				},
				updateCallbacks: (
					node: FakeNode,
					componentAtIndex: LynxListComponentAtIndex<FakeNode>,
					enqueueComponent: LynxListEnqueueComponent<FakeNode>,
					componentAtIndexes: LynxListComponentAtIndexes<FakeNode>,
				) => {
					this.record('list.updateCallbacks', node);
					this.callbacks.set(node, {
						componentAtIndex,
						componentAtIndexes,
						enqueueComponent,
					});
				},
				updateComponents: (node: FakeNode, components: readonly string[]) => {
					this.record('list.updateComponents', node);
					node.attributes.set('list-components', [...components]);
				},
			}),
			createPage: () => this.record('createPage', this.createNode('page')),
			createElement: (type, _parentComponentUniqueId, text) =>
				this.record('createElement', this.createNode(type, text)),
			getUniqueId: (node) => this.record('getUniqueId', node).sign,
			isChild: (parent, child) => child.parent === this.record('isChild', parent),
			insertBefore: (parent, child, before) => {
				this.record('insertBefore', child);
				this.detach(child);
				const index = before === null ? parent.children.length : parent.children.indexOf(before);
				if (index < 0) throw new Error('fake PAPI insertBefore target is not a child.');
				parent.children.splice(index, 0, child);
				child.parent = parent;
			},
			remove: (parent, child) => {
				this.record('remove', child);
				const index = parent.children.indexOf(child);
				if (index < 0 || child.parent !== parent) {
					throw new Error('fake PAPI remove target is not a child.');
				}
				parent.children.splice(index, 1);
				child.parent = null;
			},
			replace: (replacement, previous) => {
				this.record('replace', replacement);
				this.record('replace', previous);
				const parent = previous.parent;
				if (parent === null) throw new Error('fake PAPI cannot replace a detached node.');
				const index = parent.children.indexOf(previous);
				if (index < 0) throw new Error('fake PAPI replace target is not a child.');
				this.detach(replacement);
				parent.children[index] = replacement;
				replacement.parent = parent;
				previous.parent = null;
			},
			setClasses: (node, value) => this.record('setClasses', node).attributes.set('class', value),
			setInlineStyles: (node, value) =>
				this.record('setInlineStyles', node).attributes.set('style', value),
			setCssId: (node, id, entryName) => {
				this.record('setCssId', node);
				node.attributes.set('css-id', id);
				if (entryName !== undefined) node.attributes.set('css-entry-name', entryName);
			},
			setAttribute: (node, name, value) => {
				this.record('setAttribute', node);
				if (value === null || value === undefined) node.attributes.delete(name);
				else node.attributes.set(name, value);
				if (name === 'text') node.text = value == null ? '' : String(value);
			},
			setRefSelector: (node, value) =>
				this.record('setRefSelector', node).attributes.set('lynx-ref', value),
			setDataset: (node, value) => this.record('setDataset', node).attributes.set('dataset', value),
			setEvent: (node, kind, name, listener) => {
				this.record('setEvent', node);
				const key = `${kind}:${name}`;
				if (listener === undefined) node.events.delete(key);
				else node.events.set(key, listener);
			},
			setId: (node, id) => {
				this.record('setId', node);
				if (id === null) node.attributes.delete('id');
				else node.attributes.set('id', id);
			},
			flush: (page) => {
				this.record('flush', page);
				this.flushes += 1;
			},
		};
	}

	get flushCount(): number {
		return this.flushes;
	}

	/**
	 * Writes recorded since `beginSample`. Read from inside a callback the host
	 * invokes, it brackets a sub-window of the surrounding sample.
	 */
	get writeCount(): number {
		return this.recordedWrites;
	}

	/**
	 * Start counting Element PAPI traffic. Counting is off outside a sample so
	 * mount and teardown, which dwarf one recycle, never leak into it.
	 */
	beginSample(): void {
		this.recordedOps.clear();
		this.recordedNodes.clear();
		this.recordedWrites = 0;
		this.recording = true;
	}

	/**
	 * The traffic recorded so far, without ending the sample — so one recycle can
	 * be reported both as its two native callbacks and as a single window whose
	 * node count is a true union rather than a sum of two overlapping sets.
	 */
	sampleSoFar(): SampledPapiWork {
		return this.summarize();
	}

	endSample(): SampledPapiWork {
		const summary = this.summarize();
		this.recording = false;
		return summary;
	}

	private summarize(): SampledPapiWork {
		let writes = 0;
		let creates = 0;
		let structural = 0;
		let queries = 0;
		let flushes = 0;
		for (const [op, count] of this.recordedOps) {
			if (WRITE_OPS.has(op)) writes += count;
			else if (CREATE_OPS.has(op)) creates += count;
			else if (STRUCTURAL_OPS.has(op)) structural += count;
			else if (QUERY_OPS.has(op)) queries += count;
			else if (op === 'flush') flushes += count;
			else throw new Error(`fake PAPI recorded an unclassified op ${JSON.stringify(op)}.`);
		}
		return Object.freeze({
			writes,
			creates,
			structural,
			queries,
			flushes,
			nodesTouched: this.recordedNodes.size,
			byOp: Object.freeze(Object.fromEntries(this.recordedOps)),
		});
	}

	/**
	 * Returns the node so a call site can stay an expression. Every Element PAPI
	 * entry point routes through here, so a new one that forgets to is visible as
	 * work this benchmark cannot see rather than as a silently lower count.
	 */
	private record(op: string, node: FakeNode): FakeNode {
		if (this.recording) {
			this.recordedOps.set(op, (this.recordedOps.get(op) ?? 0) + 1);
			this.recordedNodes.add(node);
			if (WRITE_OPS.has(op)) this.recordedWrites += 1;
		}
		return node;
	}

	getListNode(): FakeNode {
		if (this.callbacks.size !== 1) {
			throw new Error(`expected one fake native list, received ${this.callbacks.size}.`);
		}
		return this.callbacks.keys().next().value as FakeNode;
	}

	enter(list: FakeNode, index: number): number {
		const callbacks = this.callbacks.get(list);
		if (callbacks === undefined) throw new Error('fake native list callbacks are missing.');
		return callbacks.componentAtIndex(list, list.sign, index, index, true);
	}

	leave(list: FakeNode, sign: number): void {
		const callbacks = this.callbacks.get(list);
		if (callbacks === undefined) throw new Error('fake native list callbacks are missing.');
		callbacks.enqueueComponent(list, list.sign, sign);
	}

	textForSign(sign: number): string {
		const node = this.nodes.get(sign);
		if (node === undefined) throw new Error(`fake native node ${sign} does not exist.`);
		return this.textContent(node);
	}

	createdNodeCount(type: string): number {
		let count = 0;
		for (const node of this.nodes.values()) if (node.type === type) count += 1;
		return count;
	}

	reachableNodeCount(root: FakeNode, type: string): number {
		let count = root.type === type ? 1 : 0;
		for (const child of root.children) count += this.reachableNodeCount(child, type);
		return count;
	}

	private createNode(type: string, text = ''): FakeNode {
		const node: FakeNode = {
			sign: this.nextSign++,
			type,
			parent: null,
			children: [],
			attributes: new Map(),
			events: new Map(),
			text,
		};
		this.nodes.set(node.sign, node);
		return node;
	}

	private detach(node: FakeNode): void {
		const parent = node.parent;
		if (parent === null) return;
		const index = parent.children.indexOf(node);
		if (index >= 0) parent.children.splice(index, 1);
		node.parent = null;
	}

	private textContent(node: FakeNode): string {
		if (node.type === '#text' || node.type === 'raw-text') return node.text;
		let text = '';
		for (const child of node.children) text += this.textContent(child);
		return text;
	}
}

/**
 * The main thread's own attachment delivery, replayed against this fake host.
 *
 * One recycle emits an attachment delta per node of the outgoing cell and per
 * node of the incoming one, and `main-thread.ts` filters that batch by looking
 * up each host's identity and comparing generations. Asking that question must
 * not install a `nodes-ref` selector, because a selector exists only where a
 * public instance was requested and the predicate has no idea whether one was.
 * The writes column below is what enforces it: a predicate that installs turns
 * an untouched zero into one write per element node per recycle.
 */
interface AttachmentDelivery {
	/** Wire this as the container's `onAttachments`. */
	readonly hook: (version: number, deltas: readonly LynxHostAttachmentDelta[]) => void;
	bind(container: LynxHostContainer<FakeNode>): void;
	/** Deltas the predicate examined since the last `reset`. */
	readonly examined: number;
	/** Of those, the ones whose generation still matched — what the wire carries. */
	readonly delivered: number;
	/** Element PAPI writes the predicate itself performed since the last `reset`. */
	readonly writes: number;
	reset(): void;
}

function createAttachmentDelivery(environment: FakeLynxPAPI): AttachmentDelivery {
	let container: LynxHostContainer<FakeNode> | null = null;
	let examined = 0;
	let delivered = 0;
	let writes = 0;
	return {
		hook(_version, deltas) {
			if (container === null) {
				throw new Error('attachment delivery ran before its container was bound.');
			}
			const before = environment.writeCount;
			for (const delta of deltas) {
				examined += 1;
				const handle = getLynxHostHandle(container, delta.id);
				if (handle !== null && handle.generation === delta.generation) delivered += 1;
			}
			writes += environment.writeCount - before;
		},
		bind(next: LynxHostContainer<FakeNode>): void {
			container = next;
		},
		get examined(): number {
			return examined;
		},
		get delivered(): number {
			return delivered;
		},
		get writes(): number {
			return writes;
		},
		reset(): void {
			examined = 0;
			delivered = 0;
			writes = 0;
		},
	};
}

export interface WorkSpread {
	readonly min: number;
	readonly median: number;
	readonly max: number;
	readonly total: number;
}

/**
 * What one scroll step costs at the Element PAPI, split the way the platform
 * splits it: `enqueueComponent` gives a cell back, `componentAtIndex` asks for
 * the next row. Their sum is one recycle.
 */
export interface ReuseWorkProfile {
	readonly samples: number;
	readonly enqueueWrites: WorkSpread;
	readonly requestWrites: WorkSpread;
	readonly writes: WorkSpread;
	readonly nodesTouched: WorkSpread;
	readonly creates: WorkSpread;
	readonly structural: WorkSpread;
	readonly queries: WorkSpread;
	readonly floorWrites: number;
	readonly floorNodesTouched: number;
	/** Attachment deltas the main thread's delivery predicate examined per recycle. */
	readonly attachmentDeltas: WorkSpread;
	/**
	 * Element PAPI writes that predicate performed, counted inside `writes` above
	 * rather than added to it. Zero while every selector is installed eagerly.
	 */
	readonly attachmentWrites: WorkSpread;
	/** One representative step, by Element PAPI entry point. */
	readonly stepBreakdown: Readonly<Record<string, number>>;
}

export interface LynxListAllocationResult {
	readonly logicalItems: number;
	readonly visibleWindow: number;
	readonly physicalCells: number;
	readonly createdCells: number;
	readonly reusedCells: number;
	readonly attachedCells: number;
	readonly pooledCells: number;
	readonly nativeCellAllocations: number;
	readonly semanticChecksum: number;
	readonly expectedChecksum: number;
	readonly flushes: number;
	readonly remainingCellsAfterTeardown: number;
	readonly lateCallbackSign: number;
	readonly reuseWork: ReuseWorkProfile;
	readonly failures: readonly string[];
}

function spread(values: readonly number[]): WorkSpread {
	if (values.length === 0) return Object.freeze({ min: 0, median: 0, max: 0, total: 0 });
	const sorted = [...values].sort((first, second) => first - second);
	return Object.freeze({
		min: sorted[0]!,
		median: sorted[sorted.length >> 1]!,
		max: sorted[sorted.length - 1]!,
		total: values.reduce((sum, value) => sum + value, 0),
	});
}

/**
 * One recycle step measured through one window: release the outgoing cell,
 * sample the enqueue half, admit the incoming item, close the sample. The
 * narrow and wide workloads compare their numbers against each other, so the
 * measurement window MUST be the same on both arms — which is why it exists
 * once here rather than inline in each loop.
 */
function sampleRecycle(
	environment: FakeLynxPAPI,
	list: FakeNode,
	releasedSign: number,
	index: number,
): { sign: number; enqueueWork: SampledPapiWork; stepWork: SampledPapiWork } {
	environment.beginSample();
	environment.leave(list, releasedSign);
	const enqueueWork = environment.sampleSoFar();
	const sign = environment.enter(list, index);
	const stepWork = environment.endSample();
	return { sign, enqueueWork, stepWork };
}

export function runLynxListAllocationWorkload(): LynxListAllocationResult {
	const environment = new FakeLynxPAPI();
	const attachments = createAttachmentDelivery(environment);
	const container = createLynxHostContainer(environment.papi, {
		root: 1,
		// The regime the product runs in: the background negotiated lazy public
		// instances, so it announces every host it will query.
		announcesPublicInstances: true,
		onAttachments: attachments.hook,
	});
	attachments.bind(container);
	const failures: string[] = [];
	const check = (condition: boolean, message: string): void => {
		if (!condition) failures.push(message);
	};

	prepareLynxHostBatch(container, batch(1, listMountCommands(LOGICAL_ITEM_COUNT))).apply();
	const list = environment.getListNode();
	const activeSigns: number[] = [];
	const initialSigns = new Set<number>();
	let semanticChecksum = 0;

	const verifyCell = (index: number, sign: number): void => {
		const text = environment.textForSign(sign);
		const expected = `Row ${index}`;
		check(
			text === expected,
			`item ${index} rendered ${JSON.stringify(text)}, expected ${expected}.`,
		);
		if (text === expected) semanticChecksum += index;
	};

	for (let index = 0; index < VISIBLE_WINDOW_SIZE; index++) {
		const sign = environment.enter(list, index);
		activeSigns.push(sign);
		initialSigns.add(sign);
		verifyCell(index, sign);
	}
	check(
		initialSigns.size === VISIBLE_WINDOW_SIZE,
		`visible window used ${initialSigns.size} distinct cells instead of ${VISIBLE_WINDOW_SIZE}.`,
	);

	// One sample per scroll step, recorded around the two native callbacks that
	// make up a recycle. The counts are deterministic, so the spread reported
	// below is a property of the path, not of the host this ran on.
	let stepBreakdown: Readonly<Record<string, number>> = {};
	const enqueueWrites: number[] = [];
	const requestWrites: number[] = [];
	const reuseWrites: number[] = [];
	const reuseNodes: number[] = [];
	const reuseCreates: number[] = [];
	const reuseStructural: number[] = [];
	const reuseQueries: number[] = [];
	const reuseAttachmentDeltas: number[] = [];
	const reuseAttachmentWrites: number[] = [];
	for (let index = VISIBLE_WINDOW_SIZE; index < LOGICAL_ITEM_COUNT; index++) {
		const releasedSign = activeSigns.shift();
		if (releasedSign === undefined) throw new Error('active native list window became empty.');
		attachments.reset();
		const { sign, enqueueWork, stepWork } = sampleRecycle(environment, list, releasedSign, index);
		enqueueWrites.push(enqueueWork.writes);
		requestWrites.push(stepWork.writes - enqueueWork.writes);
		reuseWrites.push(stepWork.writes);
		reuseNodes.push(stepWork.nodesTouched);
		reuseCreates.push(stepWork.creates);
		reuseStructural.push(stepWork.structural);
		reuseQueries.push(stepWork.queries);
		reuseAttachmentDeltas.push(attachments.examined);
		reuseAttachmentWrites.push(attachments.writes);
		if (index === STEP_BREAKDOWN_INDEX) stepBreakdown = stepWork.byOp;
		check(
			attachments.delivered === attachments.examined,
			`item ${index} emitted ${attachments.examined - attachments.delivered} attachment delta(s) ` +
				'the main thread would drop on a generation mismatch.',
		);
		check(sign === releasedSign, `item ${index} did not reuse the released native cell identity.`);
		check(
			initialSigns.has(sign),
			`item ${index} allocated native cell ${sign} outside the window.`,
		);
		activeSigns.push(sign);
		verifyCell(index, sign);
	}

	const steadyState = getLynxListDiagnostics(container, 1);
	if (steadyState === null) throw new Error('list diagnostics disappeared before teardown.');
	check(
		steadyState.logicalItems === LOGICAL_ITEM_COUNT,
		'logical item count changed during scroll.',
	);
	check(
		steadyState.physicalCells <= VISIBLE_WINDOW_SIZE,
		`physical cell count ${steadyState.physicalCells} exceeded the visible window.`,
	);
	check(
		steadyState.attachedCells === VISIBLE_WINDOW_SIZE,
		`attached cell count ${steadyState.attachedCells} did not match the visible window.`,
	);

	for (const sign of activeSigns) environment.leave(list, sign);
	const pooled = getLynxListDiagnostics(container, 1);
	if (pooled === null) throw new Error('list diagnostics disappeared before logical unmount.');
	check(pooled.attachedCells === 0, `${pooled.attachedCells} list cells remained attached.`);
	check(
		pooled.pooledCells === pooled.physicalCells,
		`${pooled.pooledCells}/${pooled.physicalCells} cells entered the reuse pool.`,
	);
	check(
		pooled.createdCells === environment.createdNodeCount('list-item'),
		'host diagnostics and fake PAPI disagreed on physical cell allocation.',
	);
	const expectedChecksum = (LOGICAL_ITEM_COUNT * (LOGICAL_ITEM_COUNT - 1)) / 2;
	check(
		semanticChecksum === expectedChecksum,
		`semantic checksum ${semanticChecksum} did not match ${expectedChecksum}.`,
	);

	prepareLynxHostBatch(container, batch(2, listUnmountCommands(LOGICAL_ITEM_COUNT))).apply();
	const lateCallbackSign = environment.enter(list, 0);
	const remainingCellsAfterTeardown = environment.reachableNodeCount(container.page, 'list-item');
	const cleanup = disposeLynxHostContainer(container);
	check(getLynxListDiagnostics(container, 1) === null, 'list diagnostics survived teardown.');
	check(
		container.instanceCount === 0,
		`${container.instanceCount} logical hosts survived teardown.`,
	);
	check(
		remainingCellsAfterTeardown === 0,
		'a physical list cell remained reachable after teardown.',
	);
	check(lateCallbackSign === -1, `late native callback returned active sign ${lateCallbackSign}.`);
	check(cleanup.complete, 'root-scoped host cleanup did not complete.');
	check(cleanup.errors.length === 0, `host cleanup reported ${cleanup.errors.length} error(s).`);

	return Object.freeze({
		logicalItems: LOGICAL_ITEM_COUNT,
		visibleWindow: VISIBLE_WINDOW_SIZE,
		physicalCells: steadyState.physicalCells,
		createdCells: pooled.createdCells,
		reusedCells: pooled.reusedCells,
		attachedCells: steadyState.attachedCells,
		pooledCells: pooled.pooledCells,
		nativeCellAllocations: environment.createdNodeCount('list-item'),
		semanticChecksum,
		expectedChecksum,
		flushes: environment.flushCount,
		remainingCellsAfterTeardown,
		lateCallbackSign,
		reuseWork: Object.freeze({
			samples: reuseWrites.length,
			enqueueWrites: spread(enqueueWrites),
			requestWrites: spread(requestWrites),
			writes: spread(reuseWrites),
			nodesTouched: spread(reuseNodes),
			creates: spread(reuseCreates),
			structural: spread(reuseStructural),
			queries: spread(reuseQueries),
			floorWrites: REUSE_FLOOR.writes,
			floorNodesTouched: REUSE_FLOOR.nodesTouched,
			attachmentDeltas: spread(reuseAttachmentDeltas),
			attachmentWrites: spread(reuseAttachmentWrites),
			stepBreakdown,
		}),
		failures: Object.freeze(failures),
	});
}

/**
 * A second row shape, because the narrow row above cannot separate two very
 * different answers. It has three values that change between rows and six props
 * that never do, spread over nine nodes instead of three. If per-recycle Element
 * PAPI traffic tracks the changed values, it stays at three writes here; if it
 * tracks the row's size, it grows with the six static props and the extra nodes.
 *
 *   list-item[item-key*, reuse-identifier]
 *     view[class, style]
 *       text[class]   > #text(title*)
 *       text[class]   > #text(subtitle*)
 *       view[class]
 *         text[class] > #text("NEW")
 *
 * Starred props vary per row.
 */
const WIDE_ROW_NODE_COUNT = 9;
const WIDE_ROW_FLOOR = Object.freeze({ writes: 3, nodesTouched: 3 });

function wideRowIds(index: number): number[] {
	const base = index * WIDE_ROW_NODE_COUNT + 2;
	return Array.from({ length: WIDE_ROW_NODE_COUNT }, (_, offset) => base + offset);
}

function wideRowText(index: number): string {
	return `Title ${index}Sub ${index}NEW`;
}

function wideListMountCommands(
	itemCount: number,
	data: RowData = wideRowData(itemCount),
): UniversalHostCommand[] {
	const commands: UniversalHostCommand[] = [
		{ op: 'create', id: 1, type: 'list', props: { id: 'wide-row-bench' } },
	];
	for (let index = 0; index < itemCount; index++) {
		const id = wideRowIds(index);
		commands.push(
			{
				op: 'create',
				id: id[0]!,
				type: 'list-item',
				props: { 'item-key': data.itemKeys[index]!, 'reuse-identifier': 'wide-row' },
			},
			{ op: 'create', id: id[1]!, type: 'view', props: { class: 'card', style: 'padding:8px' } },
			{ op: 'create', id: id[2]!, type: 'text', props: { class: 'title' } },
			{ op: 'create', id: id[3]!, type: '#text', props: { value: data.values[index]![0]! } },
			{ op: 'create', id: id[4]!, type: 'text', props: { class: 'subtitle' } },
			{ op: 'create', id: id[5]!, type: '#text', props: { value: data.values[index]![1]! } },
			{ op: 'create', id: id[6]!, type: 'view', props: { class: 'badges' } },
			{ op: 'create', id: id[7]!, type: 'text', props: { class: 'badge' } },
			{ op: 'create', id: id[8]!, type: '#text', props: { value: 'NEW' } },
			{ op: 'insert', parent: id[2]!, id: id[3]!, before: null },
			{ op: 'insert', parent: id[4]!, id: id[5]!, before: null },
			{ op: 'insert', parent: id[7]!, id: id[8]!, before: null },
			{ op: 'insert', parent: id[6]!, id: id[7]!, before: null },
			{ op: 'insert', parent: id[1]!, id: id[2]!, before: null },
			{ op: 'insert', parent: id[1]!, id: id[4]!, before: null },
			{ op: 'insert', parent: id[1]!, id: id[6]!, before: null },
			{ op: 'insert', parent: id[0]!, id: id[1]!, before: null },
			{ op: 'insert', parent: 1, id: id[0]!, before: null },
		);
	}
	commands.push({ op: 'insert', parent: null, id: 1, before: null });
	return commands;
}

export interface WideRowReuseResult {
	readonly logicalItems: number;
	readonly visibleWindow: number;
	readonly rowNodes: number;
	readonly reuseWork: ReuseWorkProfile;
	readonly failures: readonly string[];
}

/**
 * Same scroll, wider row, and only the per-recycle question: what does one
 * recycle cost at the Element PAPI, against the floor of writing the values that
 * actually differ? Physical-cell allocation is the narrow workload's subject and
 * is not re-asserted here.
 */
export function runWideRowReuseWorkload(): WideRowReuseResult {
	const environment = new FakeLynxPAPI();
	const attachments = createAttachmentDelivery(environment);
	const container = createLynxHostContainer(environment.papi, {
		root: 1,
		// The regime the product runs in: the background negotiated lazy public
		// instances, so it announces every host it will query.
		announcesPublicInstances: true,
		onAttachments: attachments.hook,
	});
	attachments.bind(container);
	const failures: string[] = [];
	prepareLynxHostBatch(container, batch(1, wideListMountCommands(LOGICAL_ITEM_COUNT))).apply();
	const list = environment.getListNode();
	const activeSigns: number[] = [];
	for (let index = 0; index < VISIBLE_WINDOW_SIZE; index++) {
		activeSigns.push(environment.enter(list, index));
	}
	let stepBreakdown: Readonly<Record<string, number>> = {};
	const enqueueWrites: number[] = [];
	const requestWrites: number[] = [];
	const writes: number[] = [];
	const nodes: number[] = [];
	const creates: number[] = [];
	const structural: number[] = [];
	const queries: number[] = [];
	const attachmentDeltas: number[] = [];
	const attachmentWrites: number[] = [];
	for (let index = VISIBLE_WINDOW_SIZE; index < LOGICAL_ITEM_COUNT; index++) {
		const releasedSign = activeSigns.shift();
		if (releasedSign === undefined) throw new Error('active native list window became empty.');
		attachments.reset();
		const { sign, enqueueWork, stepWork } = sampleRecycle(environment, list, releasedSign, index);
		enqueueWrites.push(enqueueWork.writes);
		requestWrites.push(stepWork.writes - enqueueWork.writes);
		writes.push(stepWork.writes);
		nodes.push(stepWork.nodesTouched);
		creates.push(stepWork.creates);
		structural.push(stepWork.structural);
		queries.push(stepWork.queries);
		attachmentDeltas.push(attachments.examined);
		attachmentWrites.push(attachments.writes);
		if (index === STEP_BREAKDOWN_INDEX) stepBreakdown = stepWork.byOp;
		if (attachments.delivered !== attachments.examined) {
			failures.push(
				`wide row ${index} emitted ${attachments.examined - attachments.delivered} attachment ` +
					'delta(s) the main thread would drop on a generation mismatch.',
			);
		}
		activeSigns.push(sign);
		const text = environment.textForSign(sign);
		if (text !== wideRowText(index)) {
			failures.push(`wide row ${index} rendered ${JSON.stringify(text)}.`);
		}
	}
	for (const sign of activeSigns) environment.leave(list, sign);
	disposeLynxHostContainer(container);
	return Object.freeze({
		logicalItems: LOGICAL_ITEM_COUNT,
		visibleWindow: VISIBLE_WINDOW_SIZE,
		rowNodes: WIDE_ROW_NODE_COUNT,
		reuseWork: Object.freeze({
			samples: writes.length,
			enqueueWrites: spread(enqueueWrites),
			requestWrites: spread(requestWrites),
			writes: spread(writes),
			nodesTouched: spread(nodes),
			creates: spread(creates),
			structural: spread(structural),
			queries: spread(queries),
			floorWrites: WIDE_ROW_FLOOR.writes,
			floorNodesTouched: WIDE_ROW_FLOOR.nodesTouched,
			attachmentDeltas: spread(attachmentDeltas),
			attachmentWrites: spread(attachmentWrites),
			stepBreakdown,
		}),
		failures: Object.freeze(failures),
	});
}

/**
 * How far a retention arm was driven past its mount, so both arms can be driven
 * the same way. A ratio between two arms holding different amounts of the page
 * is not a measurement of how they hold it.
 */
export interface RetentionExercise {
	/**
	 * Rows whose text is rewritten by a second commit, one `update` each — the
	 * shape a re-render has when a row's data changed.
	 */
	readonly writtenRows?: number;
	/**
	 * Rows the platform is scrolled across after the first window is entered.
	 * Recycling means this creates no new physical cell; what it does create is
	 * a read of every row it passes.
	 */
	readonly scrolledRows?: number;
	/**
	 * Cells the platform asks for at all, defaulting to a full first screen.
	 * Zero is the state right after the commit lands, before anything has been
	 * shown — the only state in which a declaration has been read by nothing.
	 */
	readonly visibleRows?: number;
}

/**
 * Enter the first window, then scroll it across `scrolledRows` further rows,
 * leaving the window entered at the end. One row enters as one leaves, which is
 * what a native list does and what keeps the physical cell count flat.
 */
function scrollWindow(
	environment: FakeLynxPAPI,
	list: FakeNode,
	rows: number,
	exercise: RetentionExercise,
): number[] {
	const window = Math.min(rows, exercise.visibleRows ?? VISIBLE_WINDOW_SIZE);
	const signs: number[] = [];
	for (let index = 0; index < window; index++) signs.push(environment.enter(list, index));
	if (window === 0) return signs;
	const last = Math.min(rows, window + (exercise.scrolledRows ?? 0));
	for (let index = window; index < last; index++) {
		const released = signs.shift();
		if (released === undefined) throw new Error('active native list window became empty.');
		environment.leave(list, released);
		signs.push(environment.enter(list, index));
	}
	return signs;
}

/**
 * Prove the write commit reached the screen, in the arm that just ran it.
 *
 * A retention arm whose writes silently went nowhere reads as a finding: the
 * eager arm's record count is supposed not to move under writes, so a count is
 * no receipt there, and skipping the commit entirely would look exactly like
 * "the eager arm does not grow". The painted row is the receipt both arms can
 * give, so both give it.
 */
function assertWritesPainted(
	environment: FakeLynxPAPI,
	signs: readonly number[],
	exercise: RetentionExercise,
	arm: string,
): void {
	if ((exercise.writtenRows ?? 0) === 0) return;
	// A scrolled window no longer holds row 0, and no state combines the two.
	if ((exercise.scrolledRows ?? 0) !== 0 || signs.length === 0) return;
	const painted = environment.textForSign(signs[0]!);
	if (!painted.includes('Renamed 0')) {
		throw new Error(`${arm}: row 0 painted ${JSON.stringify(painted)} after its text was written.`);
	}
}

/**
 * A live native list, held so a retention sample can measure it. Nothing is
 * scrolled: this is the steady state right after mount, where every logical row
 * is a record and only the window the platform asked for is physical.
 */
export interface RetainedList {
	readonly logicalHosts: number;
	readonly physicalCells: number;
	dispose(): void;
}

export function buildRetainedList(
	kind: 'narrow' | 'wide',
	data: RowData,
	exercise: RetentionExercise = {},
): RetainedList {
	const rows = data.itemKeys.length;
	const environment = new FakeLynxPAPI();
	const container = createLynxHostContainer(environment.papi, { root: 1 });
	const commands =
		kind === 'narrow' ? listMountCommands(rows, data) : wideListMountCommands(rows, data);
	prepareLynxHostBatch(container, batch(1, commands)).apply();
	const written = exercise.writtenRows ?? 0;
	const beforeWrite = container.instanceCount;
	if (written > 0) {
		prepareLynxHostBatch(container, batch(2, rowTextUpdates(kind, written))).apply();
	}
	// The control's whole value is that its record count does not move, so a
	// write that changed it would mean the two arms are not being asked the same
	// question.
	if (container.instanceCount !== beforeWrite) {
		throw new Error(`writing ${written} rows changed the eager arm's record count.`);
	}
	const list = environment.getListNode();
	const signs = scrollWindow(environment, list, rows, exercise);
	assertWritesPainted(environment, signs, exercise, 'eager');
	return {
		logicalHosts: container.instanceCount,
		physicalCells: environment.createdNodeCount('list-item'),
		dispose: () => {
			for (const sign of signs) environment.leave(list, sign);
			disposeLynxHostContainer(container);
		},
	};
}

/**
 * The same page as `buildRetainedList`, declared instead of built.
 *
 * Same container, same fake PAPI, same row strings, same window entered — the
 * only difference is that the rows arrive as one deferred `mount-template-run`
 * rather than as three `create`s each. So the delta between the two arms is
 * what the driver retains for a row nothing has asked for, which is the whole
 * subject.
 *
 * `exercise` is what drives it past that mount: `writtenRows` rewrites rows the
 * platform has never shown, and `scrolledRows` shows them. A written or shown
 * host cannot be derived from its run any more, so either promotes it to an
 * ordinary record permanently. That is this slice's ceiling, and driving it
 * here is how it gets measured rather than argued.
 */
export interface DeclaredList {
	/** Records the driver holds — the number a declaration exists to keep down. */
	readonly logicalHosts: number;
	readonly physicalCells: number;
	/** Records held when the run had been accepted and nothing had read a row. */
	readonly afterDeclare: number;
	/** Records held once the update commit landed, before the window was entered. */
	readonly afterWrite: number;
	dispose(): void;
}

export function buildDeclaredList(
	kind: 'narrow' | 'wide',
	data: RowData,
	exercise: RetentionExercise = {},
): DeclaredList {
	const rows = data.itemKeys.length;
	const environment = new FakeLynxPAPI();
	const container = createLynxHostContainer(environment.papi, { root: 1 });
	prepareLynxHostBatch(container, batch(1, deferredListMountCommands(kind, rows, data))).apply();
	const afterDeclare = container.instanceCount;
	const written = exercise.writtenRows ?? 0;
	if (written > 0) {
		prepareLynxHostBatch(container, batch(2, rowTextUpdates(kind, written))).apply();
	}
	const afterWrite = container.instanceCount;
	// A retention arm that silently did nothing reads as a win. `written` is only
	// a measurement if the writes landed where the ids said they would, and one
	// write promotes exactly one host, so the count is the receipt.
	if (afterWrite - afterDeclare !== written) {
		throw new Error(`writing ${written} rows promoted ${afterWrite - afterDeclare} hosts.`);
	}
	const list = environment.getListNode();
	const signs = scrollWindow(environment, list, rows, exercise);
	assertWritesPainted(environment, signs, exercise, 'declared');
	return {
		logicalHosts: container.instanceCount,
		physicalCells: environment.createdNodeCount('list-item'),
		afterDeclare,
		afterWrite,
		dispose: () => {
			for (const sign of signs) environment.leave(list, sign);
			disposeLynxHostContainer(container);
		},
	};
}

/**
 * What a deferred run would retain for the same page: one compiled program,
 * shared by every row, plus one value row per logical item. The values are the
 * caller's own strings — this allocates the arrays that hold them and nothing
 * else, which is the point of the comparison.
 */
export interface DeferredRunModel {
	readonly program: unknown;
	readonly rows: readonly (readonly unknown[])[];
}

export function buildDeferredRunModel(kind: 'narrow' | 'wide', data: RowData): DeferredRunModel {
	const program =
		kind === 'narrow'
			? Object.freeze([
					Object.freeze({ type: 'list-item', props: { 'reuse-identifier': 'bench-row' }, slot: 0 }),
					Object.freeze({ type: 'text', props: {}, slot: -1 }),
					Object.freeze({ type: '#text', props: {}, slot: 1 }),
				])
			: Object.freeze([
					Object.freeze({ type: 'list-item', props: { 'reuse-identifier': 'wide-row' }, slot: 0 }),
					Object.freeze({ type: 'view', props: { class: 'card', style: 'padding:8px' }, slot: -1 }),
					Object.freeze({ type: 'text', props: { class: 'title' }, slot: -1 }),
					Object.freeze({ type: '#text', props: {}, slot: 1 }),
					Object.freeze({ type: 'text', props: { class: 'subtitle' }, slot: -1 }),
					Object.freeze({ type: '#text', props: {}, slot: 2 }),
					Object.freeze({ type: 'view', props: { class: 'badges' }, slot: -1 }),
					Object.freeze({ type: 'text', props: { class: 'badge' }, slot: -1 }),
					Object.freeze({ type: '#text', props: { value: 'NEW' }, slot: -1 }),
				]);
	const rows: unknown[][] = [];
	for (let index = 0; index < data.itemKeys.length; index++) {
		rows.push([data.itemKeys[index]!, ...data.values[index]!]);
	}
	return { program, rows };
}

export interface EagerListAllocationResult {
	readonly logicalItems: number;
	readonly physicalCells: number;
	readonly semanticChecksum: number;
}

/** Deterministic one-native-cell-per-item reference, not a timing comparison. */
export function runEagerListAllocationReference(): EagerListAllocationResult {
	const cells = Array.from({ length: LOGICAL_ITEM_COUNT }, (_, index) => ({
		key: `item-${index}`,
		text: `Row ${index}`,
		index,
	}));
	return Object.freeze({
		logicalItems: cells.length,
		physicalCells: cells.length,
		semanticChecksum: cells.reduce((total, cell) => total + cell.index, 0),
	});
}
