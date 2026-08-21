import type {
	UniversalHostBatch,
	UniversalHostCommand,
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

function listMountCommands(itemCount: number): UniversalHostCommand[] {
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
				props: { 'item-key': `item-${index}`, 'reuse-identifier': 'bench-row' },
			},
			{ op: 'create', id: ids.text, type: 'text', props: {} },
			{ op: 'create', id: ids.raw, type: '#text', props: { value: `Row ${index}` } },
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
		environment.beginSample();
		environment.leave(list, releasedSign);
		const enqueueWork = environment.sampleSoFar();
		const sign = environment.enter(list, index);
		const stepWork = environment.endSample();
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

function wideListMountCommands(itemCount: number): UniversalHostCommand[] {
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
				props: { 'item-key': `item-${index}`, 'reuse-identifier': 'wide-row' },
			},
			{ op: 'create', id: id[1]!, type: 'view', props: { class: 'card', style: 'padding:8px' } },
			{ op: 'create', id: id[2]!, type: 'text', props: { class: 'title' } },
			{ op: 'create', id: id[3]!, type: '#text', props: { value: `Title ${index}` } },
			{ op: 'create', id: id[4]!, type: 'text', props: { class: 'subtitle' } },
			{ op: 'create', id: id[5]!, type: '#text', props: { value: `Sub ${index}` } },
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
		environment.beginSample();
		environment.leave(list, releasedSign);
		const enqueueWork = environment.sampleSoFar();
		const sign = environment.enter(list, index);
		const stepWork = environment.endSample();
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
