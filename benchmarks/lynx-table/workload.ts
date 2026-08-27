/**
 * Deterministic wire-cost workload for the Octane Lynx table app.
 *
 * It drives the production background root, async transport, main-thread
 * receiver, and host driver over an in-process ContextProxy pair with a cheap
 * fake Element PAPI — the same chassis as benchmarks/lynx-render — but runs
 * the full cross-framework table app (benchmarks/lynx-table/app) through real
 * native tap tokens: create rows, update every 10th, select a row, and the
 * update/select storms. The workload build defines `__OCTANE_LYNX_PROFILE__`,
 * so `@octanejs/lynx` accumulates commit/command/byte counters in
 * `globalThis.__OCTANE_LYNX_PROF`; per-operation deltas of those counters are
 * deterministic for a fixed app and interaction, which is what run.mjs gates
 * on. Wall time is not measured here at all.
 */
import { createLynxRoot, type LynxRoot } from '../../packages/lynx/src/index.js';
import { installLynxMainThread } from '../../packages/lynx/src/main-thread.js';
import type {
	LynxContextProxy,
	LynxContextProxyEvent,
} from '../../packages/lynx/src/core/protocol.js';
import type { LynxElementEventListener } from '../../packages/lynx/src/core/papi.js';
import { LYNX_NODES_REF_ATTRIBUTE } from '../../packages/lynx/src/core/nodes-ref.js';
import type { LynxWireProfile } from '../../packages/lynx/src/core/profiling.js';
import { decodeLynxTransportValue } from '../../packages/lynx/src/core/transport-codec.js';
import { App } from './app/src/App.lynx.tsrx';

export interface FakeNode {
	readonly sign: number;
	readonly type: string;
	parent: FakeNode | null;
	readonly children: FakeNode[];
	classes: string;
	id: string | null;
	text: string;
	attributes: Map<string, unknown> | null;
	events: Map<string, LynxElementEventListener> | null;
}

type Listener = (event: LynxContextProxyEvent) => void;

export interface WireMessageSnapshot {
	readonly direction: 'background-to-main' | 'main-to-background';
	readonly type: string;
	readonly bytes: number;
	readonly commandOps: Readonly<Record<string, number>>;
	readonly handleOps: Readonly<Record<string, number>>;
	/** The commit's acknowledgement and public-instance regime, verbatim. */
	readonly ack: string | null;
	readonly instances: string | null;
	readonly announces: string | null;
	/** The capabilities a `ready` reply carried, verbatim. */
	readonly capabilities: Readonly<Record<string, unknown>> | null;
}

/**
 * Two cross-wired synchronous ContextProxy ends. Dispatching on one end runs
 * the other end's listeners, matching the direction the real dual-thread
 * ContextProxy uses. Because delivery is synchronous, acknowledgements return
 * immediately: this harness measures per-commit wire cost, not the
 * backpressure coalescing an asynchronous main thread produces.
 */
export function createContextPair(): {
	background: LynxContextProxy;
	main: LynxContextProxy;
	messages: WireMessageSnapshot[];
} {
	const backgroundListeners = new Map<string, Listener[]>();
	const mainListeners = new Map<string, Listener[]>();
	const messages: WireMessageSnapshot[] = [];
	const end = (
		own: Map<string, Listener[]>,
		other: Map<string, Listener[]>,
		direction: WireMessageSnapshot['direction'],
	): LynxContextProxy => ({
		addEventListener(type, listener) {
			const list = own.get(type);
			if (list === undefined) own.set(type, [listener]);
			else list.push(listener);
		},
		removeEventListener(type, listener) {
			const list = own.get(type);
			if (list === undefined) return;
			const index = list.indexOf(listener);
			if (index !== -1) list.splice(index, 1);
			if (list.length === 0) own.delete(type);
		},
		dispatchEvent(event) {
			// The transport encodes, so what crosses is a string. Observing it
			// means decoding it, the same as the receiver does — reading
			// `event.data` directly would silently report every message as
			// `<unknown>` with no commands, which is a measurement that looks
			// like a result.
			const data = decodeLynxTransportValue(event.data) as {
				type?: unknown;
				ack?: unknown;
				instances?: unknown;
				capabilities?: unknown;
				batch?: { commands?: readonly { op?: unknown }[] };
				handles?: readonly { op?: unknown }[];
			};
			const commandOps: Record<string, number> = {};
			for (const command of data.batch?.commands ?? []) {
				const op = typeof command.op === 'string' ? command.op : '<unknown>';
				commandOps[op] = (commandOps[op] ?? 0) + 1;
			}
			const handleOps: Record<string, number> = {};
			for (const handle of data.handles ?? []) {
				const op = typeof handle.op === 'string' ? handle.op : '<unknown>';
				handleOps[op] = (handleOps[op] ?? 0) + 1;
			}
			let bytes = 0;
			try {
				bytes = JSON.stringify(data).length;
			} catch {
				// Protocol validation owns serialization failures. The observer must
				// not alter delivery while measuring a rejected message.
			}
			messages.push({
				direction,
				type: typeof data.type === 'string' ? data.type : '<unknown>',
				bytes,
				commandOps,
				handleOps,
				ack: typeof data.ack === 'string' ? data.ack : null,
				instances: typeof data.instances === 'string' ? data.instances : null,
				announces: typeof data.announces === 'string' ? data.announces : null,
				capabilities:
					data.capabilities !== null && typeof data.capabilities === 'object'
						? (data.capabilities as Record<string, unknown>)
						: null,
			});
			const list = other.get(event.type);
			if (list === undefined) return;
			for (const listener of list.slice()) listener(event);
		},
	});
	return {
		background: end(backgroundListeners, mainListeners, 'background-to-main'),
		main: end(mainListeners, backgroundListeners, 'main-to-background'),
		messages,
	};
}

export class FakeElementPAPI {
	private nextSign = 1;
	readonly nodes = new Map<number, FakeNode>();
	flushes = 0;
	createdElements = 0;
	/**
	 * `nodes-ref` selector installs and clears, counted separately from ordinary
	 * attribute writes. The main thread installs one wherever a public instance
	 * can be requested; a node nobody ever queries pays the write anyway, and
	 * this is the only place that difference is visible.
	 */
	refSelectorInstalls = 0;
	refSelectorClears = 0;
	/**
	 * Nodes a `nodes-ref` selector can be installed on. Raw text has no
	 * CSS-selectable surface, so it is the element nodes that an eager install
	 * would charge one write each.
	 */
	createdSelectable = 0;
	page: FakeNode | null = null;

	private create(type: string, text = ''): FakeNode {
		const sign = this.nextSign++;
		const node: FakeNode = {
			sign,
			type,
			parent: null,
			children: [],
			classes: '',
			id: null,
			text,
			attributes: null,
			events: null,
		};
		this.nodes.set(sign, node);
		this.createdElements++;
		if (type !== 'raw-text' && type !== '#text') this.createdSelectable++;
		return node;
	}

	globals(): Record<string, unknown> {
		return {
			__CreatePage: (_componentId: string, _cssId: number) => (this.page = this.create('page')),
			__CreateElement: (type: string) => this.create(type),
			__CreateView: () => this.create('view'),
			__CreateScrollView: () => this.create('scroll-view'),
			__CreateText: () => this.create('text'),
			__CreateRawText: (text: string) => this.create('raw-text', text),
			__CreateImage: () => this.create('image'),
			__GetElementUniqueID: (node: FakeNode) => node.sign,
			__GetParent: (node: FakeNode) => node.parent,
			__ElementIsEqual: (first: FakeNode, second: FakeNode) => first === second,
			__InsertElementBefore: (parent: FakeNode, child: FakeNode, before?: FakeNode) => {
				if (child.parent !== null) {
					const previous = child.parent.children.indexOf(child);
					if (previous !== -1) child.parent.children.splice(previous, 1);
				}
				const index = before === undefined ? -1 : parent.children.indexOf(before);
				if (index === -1) parent.children.push(child);
				else parent.children.splice(index, 0, child);
				child.parent = parent;
			},
			__RemoveElement: (parent: FakeNode, child: FakeNode) => {
				const index = parent.children.indexOf(child);
				if (index !== -1) parent.children.splice(index, 1);
				child.parent = null;
			},
			__ReplaceElement: (replacement: FakeNode, previous: FakeNode) => {
				const parent = previous.parent;
				if (parent === null) return;
				const index = parent.children.indexOf(previous);
				if (index !== -1) parent.children.splice(index, 1, replacement);
				replacement.parent = parent;
				previous.parent = null;
			},
			__SetClasses: (node: FakeNode, value: string) => {
				node.classes = value;
			},
			__SetInlineStyles: (node: FakeNode, value: unknown) => {
				(node.attributes ??= new Map()).set('style', value);
			},
			__SetCSSId: (_node: FakeNode, _id: number, _entryName?: string) => {},
			__SetAttribute: (node: FakeNode, name: string, value: unknown) => {
				if (name === 'text') node.text = String(value);
				else {
					if (name === LYNX_NODES_REF_ATTRIBUTE) {
						if (value === '') this.refSelectorClears++;
						else this.refSelectorInstalls++;
					}
					(node.attributes ??= new Map()).set(name, value);
				}
			},
			__SetDataset: (node: FakeNode, value: unknown) => {
				(node.attributes ??= new Map()).set('dataset', value);
			},
			__AddEvent: (
				node: FakeNode,
				kind: string,
				name: string,
				listener: LynxElementEventListener,
			) => {
				const events = (node.events ??= new Map());
				if (listener === undefined) events.delete(`${kind}:${name}`);
				else events.set(`${kind}:${name}`, listener);
			},
			__SetID: (node: FakeNode, id: string | null) => {
				node.id = id;
			},
			__FlushElementTree: () => {
				this.flushes++;
			},
		};
	}
}

/**
 * Everything below a background root: the cross-wired ContextProxy pair, the
 * fake Element PAPI, the real main-thread receiver, and the background-thread
 * globals a root reads. It is shared with `block-workload.ts`, which puts a
 * different background core on the same wire, so a count from either column is
 * a count over the same main thread and the same message accounting.
 */
export interface WireChassis {
	readonly papi: FakeElementPAPI;
	readonly contexts: ReturnType<typeof createContextPair>;
	readonly main: ReturnType<typeof installLynxMainThread>;
	readonly diagnostics: Error[];
	readonly backgroundTarget: Record<string, unknown>;
	readonly wireMessages: WireMessageSnapshot[];
}

/**
 * The same chassis with its main thread not yet installed.
 *
 * A production Lynx background bundle starts before the main thread replies to
 * its readiness request, so every batch composed in that window is composed
 * without the negotiated capabilities. Nothing in the synchronous chassis can
 * reach that state — installing the main thread first makes the handshake
 * complete before the first render — so a caller that wants to measure it needs
 * to choose when the handshake happens relative to the background's first
 * render.
 */
export interface DeferredWireChassis {
	readonly papi: FakeElementPAPI;
	readonly contexts: ReturnType<typeof createContextPair>;
	readonly diagnostics: Error[];
	readonly backgroundTarget: Record<string, unknown>;
	readonly wireMessages: WireMessageSnapshot[];
	/** Install the real main-thread receiver on the main end of the pair. */
	installMainThread(): ReturnType<typeof installLynxMainThread>;
}

export function createDeferredWireChassis(): DeferredWireChassis {
	const contexts = createContextPair();
	const papi = new FakeElementPAPI();
	const diagnostics: Error[] = [];
	const emitter = { addListener() {}, removeListener() {}, emit() {} };
	const mainTarget = {
		...papi.globals(),
		lynx: { getJSContext: () => contexts.main },
	};
	const backgroundTarget = {
		lynxCoreInject: { tt: {} as Record<string, unknown> },
		lynx: {
			getCoreContext: () => contexts.background,
			getJSModule: (name: string) => {
				if (name === 'GlobalEventEmitter') return emitter;
				throw new Error(`getJSModule(${name}) is not available in the benchmark host.`);
			},
			reportError: (error: unknown) => {
				diagnostics.push(error instanceof Error ? error : new Error(String(error)));
			},
		},
		queueMicrotask: (callback: () => void) => queueMicrotask(callback),
	};
	return {
		papi,
		contexts,
		diagnostics,
		wireMessages: contexts.messages,
		backgroundTarget: backgroundTarget as unknown as Record<string, unknown>,
		installMainThread: () =>
			installLynxMainThread({
				target: mainTarget,
				context: contexts.main,
				onDiagnostic: (error) => diagnostics.push(error),
			}),
	};
}

export function createWireChassis(): WireChassis {
	const chassis = createDeferredWireChassis();
	return {
		papi: chassis.papi,
		contexts: chassis.contexts,
		main: chassis.installMainThread(),
		diagnostics: chassis.diagnostics,
		wireMessages: chassis.wireMessages,
		backgroundTarget: chassis.backgroundTarget,
	};
}

interface Harness {
	readonly papi: FakeElementPAPI;
	readonly root: LynxRoot;
	readonly main: ReturnType<typeof installLynxMainThread>;
	readonly diagnostics: Error[];
	readonly backgroundTarget: Record<string, unknown>;
	readonly wireMessages: WireMessageSnapshot[];
	dispose(): Promise<void>;
}

function createHarness(): Harness {
	const chassis = createWireChassis();
	const root = createLynxRoot({
		target: chassis.backgroundTarget,
		onDiagnostic: (error) => chassis.diagnostics.push(error),
	});
	return {
		papi: chassis.papi,
		root,
		main: chassis.main,
		diagnostics: chassis.diagnostics,
		wireMessages: chassis.wireMessages,
		backgroundTarget: chassis.backgroundTarget,
		async dispose() {
			await root.unmount();
			chassis.main.close();
		},
	};
}

// -- profile counters --------------------------------------------------------

interface ProfileGlobals {
	__OCTANE_LYNX_PROF?: LynxWireProfile;
	__BENCH_ROW_RENDERS__?: number;
}

export function profileSnapshot(): {
	commits: number;
	commands: number;
	bytes: number;
	itemRenders: number;
	selfcheckMs: number;
	dispatchMs: number;
	validateMs: number;
	prepareMs: number;
	applyMs: number;
	ackMs: number;
	deltaCommits: number;
	deltaMisses: number;
	deltaOps: number;
	deltaBytes: number;
} {
	const profile = (globalThis as ProfileGlobals).__OCTANE_LYNX_PROF;
	// Both fake threads share this realm, so the main-thread receiver also
	// counted each commit; halve to report per-wire commits and commands once.
	// Row bodies only run on the background side and must not be halved.
	return {
		commits: (profile?.commits ?? 0) / 2,
		commands: (profile?.commands ?? 0) / 2,
		bytes: profile?.bytes ?? 0,
		itemRenders: (globalThis as ProfileGlobals).__BENCH_ROW_RENDERS__ ?? 0,
		selfcheckMs: profile?.selfcheckMs ?? 0,
		dispatchMs: profile?.dispatchMs ?? 0,
		validateMs: profile?.validateMs ?? 0,
		prepareMs: profile?.prepareMs ?? 0,
		applyMs: profile?.applyMs ?? 0,
		ackMs: profile?.ackMs ?? 0,
		deltaCommits: profile?.deltaCommits ?? 0,
		deltaMisses: profile?.deltaMisses ?? 0,
		deltaOps: profile?.deltaOps ?? 0,
		deltaBytes: profile?.deltaBytes ?? 0,
	};
}

function addCounts(target: Record<string, number>, source: Readonly<Record<string, number>>): void {
	for (const [name, count] of Object.entries(source)) target[name] = (target[name] ?? 0) + count;
}

export function summarizeWire(
	messages: readonly WireMessageSnapshot[],
): Pick<
	OpCounters,
	| 'wireToMainBytes'
	| 'wireToBackgroundBytes'
	| 'wireToMainMessages'
	| 'wireToBackgroundMessages'
	| 'commandOps'
	| 'handleOps'
	| 'messageTypes'
> {
	let wireToMainBytes = 0;
	let wireToBackgroundBytes = 0;
	let wireToMainMessages = 0;
	let wireToBackgroundMessages = 0;
	const commandOps: Record<string, number> = {};
	const handleOps: Record<string, number> = {};
	const messageTypes: Record<string, number> = {};
	for (const message of messages) {
		if (message.direction === 'background-to-main') {
			wireToMainBytes += message.bytes;
			wireToMainMessages++;
		} else {
			wireToBackgroundBytes += message.bytes;
			wireToBackgroundMessages++;
		}
		addCounts(commandOps, message.commandOps);
		addCounts(handleOps, message.handleOps);
		const key = `${message.direction}:${message.type}`;
		messageTypes[key] = (messageTypes[key] ?? 0) + 1;
	}
	return {
		wireToMainBytes,
		wireToBackgroundBytes,
		wireToMainMessages,
		wireToBackgroundMessages,
		commandOps,
		handleOps,
		messageTypes,
	};
}

/**
 * The regime every commit in a run went out under, plus the capabilities the one
 * `ready` reply carried. Both peers derive their behavior from that reply, so it
 * is the only place a run says whether lazy public instances were in force.
 */
export function summarizeRegime(messages: readonly WireMessageSnapshot[]): {
	capabilities: Readonly<Record<string, unknown>> | null;
	commitAcks: Record<string, number>;
	commitInstances: Record<string, number>;
	commitAnnouncements: Record<string, number>;
} {
	let capabilities: Readonly<Record<string, unknown>> | null = null;
	const commitAcks: Record<string, number> = {};
	const commitInstances: Record<string, number> = {};
	const commitAnnouncements: Record<string, number> = {};
	for (const message of messages) {
		if (message.capabilities !== null) capabilities ??= message.capabilities;
		if (message.type !== 'commit') continue;
		const ack = message.ack ?? '<full>';
		commitAcks[ack] = (commitAcks[ack] ?? 0) + 1;
		const instances = message.instances ?? '<eager>';
		commitInstances[instances] = (commitInstances[instances] ?? 0) + 1;
		// Whether the commit was composed knowing the negotiated capability, which
		// is what decides eager against demand for the hosts it mounts.
		const announces = message.announces ?? '<unannounced>';
		commitAnnouncements[announces] = (commitAnnouncements[announces] ?? 0) + 1;
	}
	return { capabilities, commitAcks, commitInstances, commitAnnouncements };
}

// -- fake-tree queries -------------------------------------------------------

const hasClass = (node: FakeNode, cls: string): boolean => node.classes.split(/\s+/).includes(cls);

function findAll(papi: FakeElementPAPI, predicate: (node: FakeNode) => boolean): FakeNode[] {
	const out: FakeNode[] = [];
	const walk = (node: FakeNode): void => {
		if (predicate(node)) out.push(node);
		for (const child of node.children) walk(child);
	};
	if (papi.page !== null) walk(papi.page);
	return out;
}

function tapTokenOf(node: FakeNode): string | null {
	const listener = node.events?.get('bindEvent:tap');
	return typeof listener === 'string' ? listener : null;
}

function buttonTapToken(papi: FakeElementPAPI, label: string): string | null {
	for (const raw of findAll(papi, (node) => node.type === 'raw-text' && node.text === label)) {
		let ancestor = raw.parent;
		while (ancestor !== null) {
			const token = tapTokenOf(ancestor);
			if (token !== null) return token;
			ancestor = ancestor.parent;
		}
	}
	return null;
}

function rowViews(papi: FakeElementPAPI): FakeNode[] {
	return findAll(papi, (node) => node.type === 'view' && hasClass(node, 'row'));
}

function cellOf(row: FakeNode, cls: string): FakeNode | null {
	for (const child of row.children) if (hasClass(child, cls)) return child;
	return null;
}

function labelTextOf(row: FakeNode): string {
	const cell = cellOf(row, 'col-label');
	if (cell === null) return '';
	return cell.children.map((child) => child.text).join('') || cell.text;
}

// -- driving -----------------------------------------------------------------

const macrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function settle(harness: Pick<Harness, 'root'>): Promise<void> {
	await harness.root.flushTransport();
	for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

/**
 * Pump transport flushes and macrotasks until the fake tree satisfies the
 * predicate. Macrotasks matter: the app's storm ticks schedule through a
 * MessageChannel, so every tick needs its own turn of the Node event loop.
 */
async function until(
	harness: Pick<Harness, 'root'>,
	predicate: () => boolean,
	what: string,
	turns = 20_000,
): Promise<void> {
	for (let turn = 0; turn < turns; turn++) {
		await settle(harness);
		if (predicate()) return;
		await macrotask();
	}
	throw new Error(`timed out waiting for ${what}`);
}

function tap(harness: Harness, token: string): void {
	const engine = (harness.backgroundTarget as { lynxCoreInject?: { tt?: Record<string, unknown> } })
		.lynxCoreInject?.tt;
	const publishEvent = engine?.publishEvent as
		((handler: unknown, event: unknown) => unknown) | undefined;
	if (typeof publishEvent !== 'function') {
		throw new Error('the background thread installed no engine publishEvent receiver.');
	}
	publishEvent(token, {
		type: 'tap',
		timestamp: 1,
		target: { id: 'bench', uid: 1, dataset: {} },
		currentTarget: { id: 'bench', uid: 1, dataset: {} },
	});
}

async function tapButton(harness: Harness, label: string): Promise<void> {
	const token = buttonTapToken(harness.papi, label);
	if (token === null) throw new Error(`no tap token found for button "${label}"`);
	tap(harness, token);
	await settle(harness);
}

export interface OpCounters {
	readonly commits: number;
	readonly commands: number;
	readonly bytes: number;
	readonly itemRenders: number;
	readonly wireToMainBytes: number;
	readonly wireToBackgroundBytes: number;
	readonly wireToMainMessages: number;
	readonly wireToBackgroundMessages: number;
	readonly commandOps: Readonly<Record<string, number>>;
	readonly handleOps: Readonly<Record<string, number>>;
	readonly messageTypes: Readonly<Record<string, number>>;
	readonly selfcheckMs: number;
	readonly dispatchMs: number;
	readonly validateMs: number;
	readonly prepareMs: number;
	readonly applyMs: number;
	readonly ackMs: number;
	readonly deltaCommits: number;
	readonly deltaMisses: number;
	readonly deltaOps: number;
	readonly deltaBytes: number;
	readonly refSelectorInstalls: number;
	readonly refSelectorClears: number;
	readonly createdElements: number;
	readonly createdSelectable: number;
}

export interface TableRunResult {
	readonly rows: number;
	readonly create: OpCounters;
	readonly update10th: OpCounters;
	readonly select: OpCounters;
	readonly swap: OpCounters;
	readonly swapIdentityChecksum: number;
	readonly swapEventSurvived: boolean;
	readonly updateStorm: OpCounters;
	readonly selectStorm: OpCounters;
	readonly createdElements: number;
	/**
	 * Which regime the run actually negotiated and used, rather than which one the
	 * source permits. A commit's public-instance regime decides whether the main
	 * thread installs a `nodes-ref` selector on every node it mounts or only on
	 * the hosts the background announced, so a count of installs is unreadable
	 * without it.
	 */
	readonly wireRegime: {
		readonly capabilities: Readonly<Record<string, unknown>> | null;
		readonly commitAcks: Readonly<Record<string, number>>;
		readonly commitInstances: Readonly<Record<string, number>>;
	};
	readonly diagnostics: readonly string[];
}

const CREATE_BUTTON: Record<number, string> = {
	1000: 'Create 1,000 rows',
	3000: 'Create 3,000 rows',
	5000: 'Create 5,000 rows',
	10000: 'Create 10,000 rows',
	20000: 'Create 20,000 rows',
	30000: 'Create 30,000 rows',
};

const STORM_UPDATE_TICKS = 50;
const STORM_SELECT_TICKS = 30;

function seededRandom(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** Run the full op sequence at one scale and report per-op counter deltas. */
export async function runTable(rows: number): Promise<TableRunResult> {
	const createButton = CREATE_BUTTON[rows];
	if (createButton === undefined) throw new Error(`no create button for ${rows} rows`);
	const harness = createHarness();
	const previousRandom = Math.random;
	Math.random = seededRandom(0x0c7a_4e11);
	try {
		await harness.root.render(App, {});
		await until(harness, () => buttonTapToken(harness.papi, createButton) !== null, 'mount', 200);

		const measure = async (drive: () => Promise<void>): Promise<OpCounters> => {
			const before = profileSnapshot();
			const wireStart = harness.wireMessages.length;
			const refInstallsBefore = harness.papi.refSelectorInstalls;
			const refClearsBefore = harness.papi.refSelectorClears;
			const elementsBefore = harness.papi.createdElements;
			const selectableBefore = harness.papi.createdSelectable;
			await drive();
			const after = profileSnapshot();
			return {
				refSelectorInstalls: harness.papi.refSelectorInstalls - refInstallsBefore,
				refSelectorClears: harness.papi.refSelectorClears - refClearsBefore,
				createdElements: harness.papi.createdElements - elementsBefore,
				createdSelectable: harness.papi.createdSelectable - selectableBefore,
				commits: after.commits - before.commits,
				commands: after.commands - before.commands,
				bytes: after.bytes - before.bytes,
				itemRenders: after.itemRenders - before.itemRenders,
				...summarizeWire(harness.wireMessages.slice(wireStart)),
				selfcheckMs: after.selfcheckMs - before.selfcheckMs,
				dispatchMs: after.dispatchMs - before.dispatchMs,
				validateMs: after.validateMs - before.validateMs,
				prepareMs: after.prepareMs - before.prepareMs,
				applyMs: after.applyMs - before.applyMs,
				ackMs: after.ackMs - before.ackMs,
				deltaCommits: after.deltaCommits - before.deltaCommits,
				deltaMisses: after.deltaMisses - before.deltaMisses,
				deltaOps: after.deltaOps - before.deltaOps,
				deltaBytes: after.deltaBytes - before.deltaBytes,
			};
		};

		const create = await measure(async () => {
			await tapButton(harness, createButton);
			await until(harness, () => rowViews(harness.papi).length === rows, `${rows} rows`);
		});

		const update10th = await measure(async () => {
			const first = rowViews(harness.papi)[0]!;
			const expected = `${labelTextOf(first)} !!!`;
			await tapButton(harness, 'Update every 10th row');
			await until(
				harness,
				() => labelTextOf(rowViews(harness.papi)[0]!) === expected,
				'updated first label',
			);
		});

		// Two taps: the first turns selection on, the second moves it, so the
		// measured op is the steady state (one row gains .danger, one loses it).
		const preSelect = rowViews(harness.papi)[1]!;
		tap(harness, tapTokenOf(cellOf(preSelect, 'col-label')!)!);
		await until(harness, () => hasClass(rowViews(harness.papi)[1]!, 'danger'), 'first select');
		const select = await measure(async () => {
			const row = rowViews(harness.papi)[2]!;
			tap(harness, tapTokenOf(cellOf(row, 'col-label')!)!);
			await until(harness, () => hasClass(rowViews(harness.papi)[2]!, 'danger'), 'select');
		});

		const rowsBeforeSwap = rowViews(harness.papi).slice();
		const labelsBeforeSwap = rowsBeforeSwap.map(labelTextOf);
		const swap = await measure(async () => {
			await tapButton(harness, 'Swap Rows');
			await until(
				harness,
				() => {
					const current = rowViews(harness.papi);
					return current[1] === rowsBeforeSwap[998] && current[998] === rowsBeforeSwap[1];
				},
				'swapped survivor identity',
			);
		});
		const rowsAfterSwap = rowViews(harness.papi);
		const expectedPermutation = rowsBeforeSwap.map((_, index) =>
			index === 1 ? 998 : index === 998 ? 1 : index,
		);
		for (let index = 0; index < expectedPermutation.length; index++) {
			const source = expectedPermutation[index]!;
			if (
				rowsAfterSwap[index] !== rowsBeforeSwap[source] ||
				labelTextOf(rowsAfterSwap[index]!) !== labelsBeforeSwap[source]
			) {
				harness.diagnostics.push(
					new Error(`swap changed survivor identity or final order at row ${index}.`),
				);
				break;
			}
		}
		const swapIdentityChecksum = rowsAfterSwap.reduce(
			(sum, row, index) => sum + (rowsBeforeSwap.indexOf(row) + 1) * (index + 1),
			0,
		);
		const movedRow = rowsAfterSwap[1]!;
		tap(harness, tapTokenOf(cellOf(movedRow, 'col-label')!)!);
		await until(harness, () => hasClass(rowViews(harness.papi)[1]!, 'danger'), 'moved row event');
		const swapEventSurvived = hasClass(rowViews(harness.papi)[1]!, 'danger');

		const updateStorm = await measure(async () => {
			await tapButton(harness, 'Update storm');
			await until(
				harness,
				() => labelTextOf(rowViews(harness.papi)[0]!) === `bench ${STORM_UPDATE_TICKS}`,
				'update storm',
			);
		});

		const selectStorm = await measure(async () => {
			await tapButton(harness, 'Select storm');
			await until(harness, () => hasClass(rowViews(harness.papi)[0]!, 'danger'), 'select storm');
		});

		return {
			rows,
			create,
			update10th,
			select,
			swap,
			swapIdentityChecksum,
			swapEventSurvived,
			updateStorm,
			selectStorm,
			createdElements: harness.papi.createdElements,
			wireRegime: summarizeRegime(harness.wireMessages),
			diagnostics: harness.diagnostics.map((error) => error.message),
		};
	} finally {
		await harness.dispose();
		Math.random = previousRandom;
	}
}

/**
 * What the first screen costs in `nodes-ref` selectors, on both sides of the
 * handshake.
 *
 * A `nodes-ref` selector is installed on demand: a commit that announces the
 * hosts it will query lets the main thread skip every node nobody named. Only a
 * commit composed while the negotiated capability was already live can make that
 * announcement, and a production background composes its first batch before the
 * main-ready reply reaches it. `runTable` cannot see the difference, because its
 * main thread is installed before the first render and its wire is synchronous,
 * so every commit it sends was composed after the handshake.
 *
 * These two arms differ in exactly one thing — whether the main thread exists
 * when the background renders — and are otherwise the same app, the same tree,
 * and the same counters. `before-render` is what `runTable` measures;
 * `after-render` is the order production starts in.
 *
 * Build the workload with `__BENCH_AUTOROWS__` set to `rows`, or the first
 * commit carries the shell alone and the rows arrive in a later one.
 */
export interface FirstScreenSelectorResult {
	readonly rows: number;
	readonly handshake: FirstScreenHandshake;
	readonly rowsPainted: number;
	readonly createdElements: number;
	readonly createdSelectable: number;
	readonly refSelectorInstalls: number;
	readonly refSelectorClears: number;
	readonly commits: number;
	readonly commands: number;
	readonly wireRegime: ReturnType<typeof summarizeRegime>;
	readonly diagnostics: readonly string[];
}

export type FirstScreenHandshake = 'before-render' | 'after-render';

export async function runFirstScreenSelectors(
	rows: number,
	handshake: FirstScreenHandshake,
): Promise<FirstScreenSelectorResult> {
	const chassis = createDeferredWireChassis();
	const root = createLynxRoot({
		target: chassis.backgroundTarget,
		onDiagnostic: (error) => chassis.diagnostics.push(error),
	});
	let main: ReturnType<typeof installLynxMainThread> | null = null;
	const previousRandom = Math.random;
	Math.random = seededRandom(0x0c7a_4e11);
	const before = profileSnapshot();
	try {
		if (handshake === 'before-render') main = chassis.installMainThread();
		// The first render mounts synchronously, so the batch is composed by the
		// time `render` returns. Installing the main thread here is what puts the
		// reply behind the compose rather than in front of it.
		const rendered = root.render(App, {});
		if (main === null) main = chassis.installMainThread();
		await rendered;
		await until({ root }, () => rowViews(chassis.papi).length === rows, `${rows} rows at mount`);
		const after = profileSnapshot();
		return {
			rows,
			handshake,
			rowsPainted: rowViews(chassis.papi).length,
			createdElements: chassis.papi.createdElements,
			createdSelectable: chassis.papi.createdSelectable,
			refSelectorInstalls: chassis.papi.refSelectorInstalls,
			refSelectorClears: chassis.papi.refSelectorClears,
			commits: after.commits - before.commits,
			commands: after.commands - before.commands,
			wireRegime: summarizeRegime(chassis.wireMessages),
			diagnostics: chassis.diagnostics.map((error) => error.message),
		};
	} finally {
		Math.random = previousRandom;
		await root.unmount();
		main?.close();
	}
}

export { STORM_UPDATE_TICKS, STORM_SELECT_TICKS };
