import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, search, replacement, file) {
	const first = source.indexOf(search);
	if (first === -1) throw new Error(`issue-194 instrument anchor missing in ${file}.`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`issue-194 instrument anchor is ambiguous in ${file}.`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

/**
 * Build-only native instrumentation for issue #194.
 *
 * The app probe owns the native tap -> transport ACK -> two native frames
 * boundary. The main-thread probe snapshots raw Element PAPI calls immediately
 * before and after the accepted commit. Every touched source is restored after
 * the bundle is emitted; production sources and non-profile bundles are never
 * changed by this probe.
 */
export function instrumentIssue194NativeSources(
	repositoryRoot,
	stagedAppRoot,
	{ appendOrder = 'parent-first', directOnly = false } = {},
) {
	if (appendOrder !== 'parent-first' && appendOrder !== 'child-first') {
		throw new Error(`unsupported issue-194 append order ${JSON.stringify(appendOrder)}.`);
	}
	const originals = new Map();
	const updateAbsolute = (file, transform) => {
		if (originals.has(file)) throw new Error(`issue-194 instrument patched ${file} twice.`);
		const source = fs.readFileSync(file, 'utf8');
		originals.set(file, source);
		fs.writeFileSync(file, transform(source, file));
	};
	const updateRepo = (relative, transform) =>
		updateAbsolute(path.join(repositoryRoot, relative), transform);
	const updateStage = (relative, transform) =>
		updateAbsolute(path.join(stagedAppRoot, relative), transform);

	try {
		updateStage('src/index.ts', (source, file) => {
			let next = replaceOnce(
				source,
				'void root.render(\n',
				`declare const __BENCH_AUTOROWS__: number;
const issue194BackgroundStartMs = Date.now();
const issue194Global = globalThis as typeof globalThis & {
\t__ISSUE194_FLUSH__?: () => Promise<void>;
};
issue194Global.__ISSUE194_FLUSH__ = () => root.flushTransport();

void root.render(
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);
`,
				`\t__BENCH_CORE__ === 'block' && __BENCH_BLOCK_MODE__ !== 'derived' ? blockApp(App) : App,
);
if (__BENCH_AUTOROWS__ > 0) {
\tvoid root.flushTransport().then(() => {
\t\tconst commitAckMs = Date.now();
\t\tlynx.requestAnimationFrame(() => {
\t\t\tconst firstFrameMs = Date.now();
\t\t\tlynx.requestAnimationFrame(() => {
\t\t\t\tconst endMs = Date.now();
\t\t\t\tconsole.log('__ISSUE194_NATIVE_RESULT__' + JSON.stringify({
\t\t\t\t\tprotocol: 'octane-issue194-native-v1',
\t\t\t\t\tworkload: 'startup-create',
\t\t\t\t\tscale: __BENCH_AUTOROWS__,
\t\t\t\t\tsource: 'background-script-start',
\t\t\t\t\tboundary: 'background-script-start-to-second-native-frame',
\t\t\t\t\tstartMs: issue194BackgroundStartMs,
\t\t\t\t\tcommitAckMs,
\t\t\t\t\tfirstFrameMs,
\t\t\t\t\tendMs,
\t\t\t\t\tlatencyMs: endMs - issue194BackgroundStartMs,
\t\t\t\t\trenderEvidence: { kind: 'native-animation-frame', frames: 2 },
\t\t\t\t\tpostState: (globalThis as any).__ISSUE194_SNAPSHOT__?.() ?? null,
\t\t\t\t}));
\t\t\t});
\t\t});
\t});
}
`,
				file,
			);
			return next.replaceAll('performance.now()', 'Date.now()');
		});

		updateStage('src/App.lynx.tsrx', (source, file) => {
			let next = replaceOnce(
				source,
				`const INITIAL_ROWS: RowData[] =
\t__BENCH_AUTOROWS__ > 0 ? buildDataSeeded(__BENCH_AUTOROWS__) : [];
`,
				`const INITIAL_ROWS: RowData[] =
\t__BENCH_AUTOROWS__ > 0 ? buildDataSeeded(__BENCH_AUTOROWS__) : [];

interface Issue194Snapshot {
\treadonly rowCount: number;
\treadonly firstId: number | null;
\treadonly secondId: number | null;
\treadonly thirdId: number | null;
\treadonly row998Id: number | null;
\treadonly firstLabel: string | null;
\treadonly selectedId: number | null;
}

type Issue194Global = typeof globalThis & {
\t__ISSUE194_FLUSH__?: () => Promise<void>;
\t__ISSUE194_SNAPSHOT__?: () => Issue194Snapshot;
};

let issue194InteractionOrdinal = 0;

function issue194Frame(): Promise<number> {
\treturn new Promise((resolve) => lynx.requestAnimationFrame(() => resolve(Date.now())));
}

function measureIssue194Tap(workload: string, scale: number, action: () => void): void {
\tconst global = globalThis as Issue194Global;
\tconst flush = global.__ISSUE194_FLUSH__;
\tif (flush === undefined) throw new Error('issue #194 native probe has no transport flush.');
\tconst preState = global.__ISSUE194_SNAPSHOT__?.();
\tif (preState === undefined) throw new Error('issue #194 native probe has no pre-state.');
\tconst interactionOrdinal = ++issue194InteractionOrdinal;
\tconst startMs = Date.now();
\taction();
\tvoid flush().then(() => {
\t\tconst commitAckMs = Date.now();
\t\treturn issue194Frame().then((firstFrameMs) =>
\t\t\tissue194Frame().then((endMs) => {
\t\t\t\tconst postState = global.__ISSUE194_SNAPSHOT__?.();
\t\t\t\tif (postState === undefined) throw new Error('issue #194 native probe has no post-state.');
\t\t\t\tconsole.log('__ISSUE194_NATIVE_RESULT__' + JSON.stringify({
\t\t\t\t\tprotocol: 'octane-issue194-native-v1',
\t\t\t\t\tinteractionOrdinal,
\t\t\t\t\tworkload,
\t\t\t\t\tscale,
\t\t\t\t\tsource: 'native-tap',
\t\t\t\t\tboundary: 'native-input-handler-to-second-native-frame',
\t\t\t\t\tstartMs,
\t\t\t\t\tcommitAckMs,
\t\t\t\t\tfirstFrameMs,
\t\t\t\t\tendMs,
\t\t\t\t\tlatencyMs: endMs - startMs,
\t\t\t\t\trenderEvidence: { kind: 'native-animation-frame', frames: 2 },
\t\t\t\t\tpreState,
\t\t\t\t\tpostState,
\t\t\t\t}));
\t\t\t}),
\t\t);
\t}).catch((error: unknown) => {
\t\tconsole.log('__ISSUE194_NATIVE_ERROR__' + String(error));
\t});
}
`,
				file,
			);
			next = replaceOnce(
				next,
				`const _stormChannel = new MessageChannel();
let _stormPending: (() => void) | null = null;
_stormChannel.port1.onmessage = () => {
\tconst cb = _stormPending;
\t_stormPending = null;
\tif (cb) cb();
};
function nextMacrotask(cb: () => void) {
\t_stormPending = cb;
\t_stormChannel.port2.postMessage(0);
}
`,
				`const _stormChannel: MessageChannel | null = null;
let _stormPending: (() => void) | null = null;
if (_stormChannel) {
\t_stormChannel.port1.onmessage = () => {
\t\tconst cb = _stormPending;
\t\t_stormPending = null;
\t\tif (cb) cb();
\t};
}
function nextMacrotask(cb: () => void) {
\tif (_stormChannel === null) {
\t\tsetTimeout(cb, 0);
\t\treturn;
\t}
\t_stormPending = cb;
\t_stormChannel.port2.postMessage(0);
}
`,
				file,
			);
			next = replaceOnce(
				next,
				`\tconst [rows, setRows] = useState<RowData[]>(INITIAL_ROWS);
\tconst [selected, setSelected] = useState<number | undefined>(undefined);
`,
				`\tconst [rows, setRows] = useState<RowData[]>(INITIAL_ROWS);
\tconst [selected, setSelected] = useState<number | undefined>(undefined);
\tconst rowsRef = useRef<RowData[]>(rows);
\trowsRef.current = rows;
\tconst selectedRef = useRef<number | undefined>(selected);
\tselectedRef.current = selected;
\t(globalThis as Issue194Global).__ISSUE194_SNAPSHOT__ = () => {
\t\tconst current = rowsRef.current;
\t\treturn {
\t\t\trowCount: current.length,
\t\t\tfirstId: current[0]?.id ?? null,
\t\t\tsecondId: current[1]?.id ?? null,
\t\t\tthirdId: current[2]?.id ?? null,
\t\t\trow998Id: current[998]?.id ?? null,
\t\t\tfirstLabel: current[0]?.label ?? null,
\t\t\tselectedId: selectedRef.current ?? null,
\t\t};
\t};
`,
				file,
			);
			for (const [handler, scale] of [
				['run', 1000],
				['run3k', 3000],
				['run5k', 5000],
				['runLots', 10000],
				['run20k', 20000],
				['run30k', 30000],
			]) {
				next = replaceOnce(
					next,
					`<view class="btn" bindtap={${handler}}>`,
					`<view class="btn" bindtap={() => measureIssue194Tap('create', ${scale}, ${handler})}>`,
					file,
				);
			}
			next = replaceOnce(
				next,
				`<view class="btn" bindtap={clear}>`,
				`<view class="btn" bindtap={() => measureIssue194Tap('clear', rowsRef.current.length, clear)}>`,
				file,
			);
			return next;
		});

		updateStage('src/block-program.ts', (source, file) => {
			let next = replaceOnce(
				source,
				'const stormChannel = new MessageChannel();',
				`const stormChannel: {
	port1: { onmessage: (() => void) | null };
	port2: { postMessage(value: number): void };
} = {
	port1: { onmessage: null },
	port2: {
		postMessage() {
			setTimeout(() => stormChannel.port1.onmessage?.(), 0);
		},
	},
};`,
				file,
			);
			next = replaceOnce(
				next,
				`const SCOPED = __BENCH_BLOCK_MODE__ !== 'reconcile';
`,
				`const SCOPED = __BENCH_BLOCK_MODE__ !== 'reconcile';

interface Issue194BlockSnapshot {
	readonly rowCount: number;
	readonly firstId: number | null;
	readonly secondId: number | null;
	readonly thirdId: number | null;
	readonly row998Id: number | null;
	readonly firstLabel: string | null;
	readonly selectedId: number | null;
}

let issue194BlockInteractionOrdinal = 0;

function issue194BlockSnapshot(state: TableState): Issue194BlockSnapshot {
	return {
		rowCount: state.rows.length,
		firstId: state.rows[0]?.id ?? null,
		secondId: state.rows[1]?.id ?? null,
		thirdId: state.rows[2]?.id ?? null,
		row998Id: state.rows[998]?.id ?? null,
		firstLabel: state.rows[0]?.label ?? null,
		selectedId: state.selected ?? null,
	};
}

function issue194BlockFrame(): Promise<number> {
	return new Promise((resolve) => lynx.requestAnimationFrame(() => resolve(Date.now())));
}

function measureIssue194BlockTap(
	state: TableState,
	workload: string,
	scale: number,
	action: () => void,
): void {
	const preState = issue194BlockSnapshot(state);
	const interactionOrdinal = ++issue194BlockInteractionOrdinal;
	const startMs = Date.now();
	action();
	void state.committing
		.then(() => {
			const commitAckMs = Date.now();
			return issue194BlockFrame().then((firstFrameMs) =>
				issue194BlockFrame().then((endMs) => {
					console.log('__ISSUE194_NATIVE_RESULT__' + JSON.stringify({
						protocol: 'octane-issue194-native-v1',
						interactionOrdinal,
						workload,
						scale,
						source: 'native-tap',
						boundary: 'native-input-handler-to-second-native-frame',
						startMs,
						commitAckMs,
						firstFrameMs,
						endMs,
						latencyMs: endMs - startMs,
						renderEvidence: { kind: 'native-animation-frame', frames: 2 },
						preState,
						postState: issue194BlockSnapshot(state),
					}));
				}),
			);
		})
		.catch((error: unknown) => {
			console.log('__ISSUE194_NATIVE_ERROR__' + String(error));
		});
}
`,
				file,
			);
			for (const [handlerIndex, scale] of [
				[0, 1000],
				[1, 3000],
				[2, 5000],
				[3, 10000],
				[4, 20000],
				[5, 30000],
			]) {
				next = replaceOnce(
					next,
					`\t\t\t\t() => create(table, ${scale}),`,
					`\t\t\t\t() => measureIssue194BlockTap(table, 'create', ${scale}, () => create(table, ${scale})),`,
					file,
				);
			}
			next = replaceOnce(
				next,
				`\t\t\t\t() => clear(table),`,
				`\t\t\t\t() => measureIssue194BlockTap(table, 'clear', table.rows.length, () => clear(table)),`,
				file,
			);
			return next;
		});

		updateRepo('packages/lynx/src/core/block-background.ts', (source, file) =>
			replaceOnce(
				source,
				'pending = Promise.allSettled([pending, work]);',
				`pending = Promise.all([
\t\t\tpending.catch(() => undefined),
\t\t\twork.catch(() => undefined),
\t\t]);`,
				file,
			),
		);

		updateRepo('packages/lynx/src/core/papi.ts', (source, file) => {
			let next = replaceOnce(
				source,
				`function requireFunction<
`,
				`interface Issue194PapiCall {
\tcount: number;
\tselfMs: number;
\tcallsBefore?: number[];
}

type Issue194PapiGlobals = typeof globalThis & {
\t__ISSUE194_PAPI__?: Record<string, Issue194PapiCall>;
\t__ISSUE194_PAPI_TOTAL__?: number;
};

function issue194PapiCall(name: string, call: (...args: any[]) => unknown, args: any[]): unknown {
\tconst global = globalThis as Issue194PapiGlobals;
\tconst calls = (global.__ISSUE194_PAPI__ ??= {});
\tconst entry = (calls[name] ??= { count: 0, selfMs: 0 });
\tconst callsBefore = (global.__ISSUE194_PAPI_TOTAL__ ??= 0);
\tif (name === '__FlushElementTree') (entry.callsBefore ??= []).push(callsBefore);
\tconst started = performance.now();
\ttry {
\t\treturn call(...args);
\t} finally {
\t\tentry.count++;
\t\tentry.selfMs += performance.now() - started;
\t\tglobal.__ISSUE194_PAPI_TOTAL__ = callsBefore + 1;
\t}
}

function requireFunction<
`,
				file,
			);
			next = replaceOnce(
				next,
				`\treturn value.bind(target) as LynxElementPAPIGlobals<Node>[Name];
`,
				`\tconst bound = value.bind(target) as (...args: any[]) => unknown;
\treturn ((...args: any[]) => issue194PapiCall(String(name), bound, args)) as LynxElementPAPIGlobals<Node>[Name];
`,
				file,
			);
			next = replaceOnce(
				next,
				`\tconst getParent = typeof getParentValue === 'function' ? getParentValue.bind(target) : undefined;
\tconst elementIsEqual =
\t\ttypeof elementIsEqualValue === 'function' ? elementIsEqualValue.bind(target) : undefined;
`,
				`\tconst getParent = typeof getParentValue === 'function'
\t\t? ((...args: any[]) => issue194PapiCall('__GetParent', getParentValue.bind(target), args)) as typeof getParentValue
\t\t: undefined;
\tconst elementIsEqual = typeof elementIsEqualValue === 'function'
\t\t? ((...args: any[]) => issue194PapiCall('__ElementIsEqual', elementIsEqualValue.bind(target), args)) as typeof elementIsEqualValue
\t\t: undefined;
`,
				file,
			);
			next = replaceOnce(
				next,
				`\tconst append = typeof appendValue === 'function' ? appendValue.bind(target) : undefined;
`,
				`\tconst append = typeof appendValue === 'function'
\t\t? ((...args: any[]) => issue194PapiCall('__AppendElement', appendValue.bind(target), args)) as typeof appendValue
\t\t: undefined;
`,
				file,
			);
			return next.replaceAll('performance.now()', 'Date.now()');
		});

		updateRepo('packages/lynx/src/main-thread.ts', (source, file) => {
			let next = replaceOnce(
				source,
				`\tconst dispatch = (message: LynxBackgroundInboundMessage): void => {
\t\tconst validated = selfCheckLynxBackgroundInboundMessage(message);
\t\tcontext.dispatchEvent({
\t\t\ttype: LYNX_MAIN_TO_BACKGROUND_EVENT,
\t\t\tdata: encodeLynxTransportValue(validated, reportEncodingDiagnostic),
\t\t});
\t};
`,
				`\ttype Issue194CommitWireMessage = {
\t\treadonly type: string;
\t\treadonly encodedPayloadBytes: number;
\t\treadonly contextEventJsonBytes: number;
\t};
\ttype Issue194CommitWire = {
\t\treadonly root: number;
\t\treadonly version: number;
\t\treadonly messages: Issue194CommitWireMessage[];
\t};
\tlet issue194ActiveCommitWire: Issue194CommitWire | null = null;
\tconst dispatch = (message: LynxBackgroundInboundMessage): void => {
\t\tconst validated = selfCheckLynxBackgroundInboundMessage(message);
\t\tconst encoded = encodeLynxTransportValue(validated, reportEncodingDiagnostic);
\t\tconst event = { type: LYNX_MAIN_TO_BACKGROUND_EVENT, data: encoded };
\t\tconst identity = message as Partial<UniversalTransportIdentity> & { type?: unknown };
\t\tif (
\t\t\tissue194ActiveCommitWire !== null &&
\t\t\tidentity.root === issue194ActiveCommitWire.root &&
\t\t\tidentity.version === issue194ActiveCommitWire.version
\t\t) {
\t\t\tissue194ActiveCommitWire.messages.push({
\t\t\t\ttype: typeof identity.type === 'string' ? identity.type : 'unknown',
\t\t\t\tencodedPayloadBytes: encoded.length,
\t\t\t\tcontextEventJsonBytes: JSON.stringify(event).length,
\t\t\t});
\t\t}
\t\tcontext.dispatchEvent(event);
\t};
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\tconst startedApply = LYNX_PROFILE ? performance.now() : 0;
`,
				`\t\tconst issue194CallsBefore = JSON.parse(JSON.stringify(
\t\t\t(globalThis as any).__ISSUE194_PAPI__ ?? {},
\t\t));
\t\tconst issue194ProfileBefore = JSON.parse(JSON.stringify(lynxWireProfile()));
\t\tconst issue194CommitStarted = performance.now();
\t\tissue194ActiveCommitWire = { root: message.root, version: message.version, messages: [] };
\t\tconst startedApply = LYNX_PROFILE ? performance.now() : 0;
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\ttry {
\t\t\tdispatch(acknowledgement);
`,
				`\t\tconst issue194CommitReport = {
\t\t\tprotocol: 'octane-issue194-main-v1',
\t\t\troot: message.root,
\t\t\tversion: message.version,
\t\t\tcommands: message.batch.commands.length,
\t\t\twallMs: performance.now() - issue194CommitStarted,
\t\t\tcallsBefore: issue194CallsBefore,
\t\t\tcallsAfter: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PAPI__ ?? {})),
\t\t\tprofileBefore: issue194ProfileBefore,
\t\t\tprofileAfter: JSON.parse(JSON.stringify(lynxWireProfile())),
\t\t\tprogram: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PROGRAM__ ?? {})),
\t\t\tackEncoding: compactCount === null ? 'handles' : LYNX_COMPACT_ACKNOWLEDGEMENT,
\t\t\tacknowledgedHostCount: compactCount,
\t\t};
\t\ttry {
\t\t\tdispatch(acknowledgement);
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\t\t\tdispatch({ ...identity, type: 'complete' });
\t\t\t\tif (awaitingAdoption === null) drainNativeEvents();
`,
				`\t\t\t\tdispatch({ ...identity, type: 'complete' });
\t\t\t\tconst issue194Wire = issue194ActiveCommitWire;
\t\t\t\tissue194ActiveCommitWire = null;
\t\t\t\tif (issue194Wire === null) {
\t\t\t\t\tthrow new Error('issue #194 native probe lost the active commit wire record.');
\t\t\t\t}
\t\t\t\tconst issue194AckMessages = issue194Wire.messages.filter(
\t\t\t\t\t(entry) => entry.type === 'ack',
\t\t\t\t).length;
\t\t\t\tconsole.log('__ISSUE194_MAIN_COMMIT__' + JSON.stringify({
\t\t\t\t\t...issue194CommitReport,
\t\t\t\t\twireToBts: {
\t\t\t\t\t\tboundary: 'native-context-proxy-main-to-background-encoded-payloads',
\t\t\t\t\t\twireToBtsBytes: issue194Wire.messages.reduce(
\t\t\t\t\t\t\t(total, entry) => total + entry.encodedPayloadBytes,
\t\t\t\t\t\t\t0,
\t\t\t\t\t\t),
\t\t\t\t\t\twireToBtsMsgs: issue194Wire.messages.length,
\t\t\t\t\t\tcontextEventJsonBytes: issue194Wire.messages.reduce(
\t\t\t\t\t\t\t(total, entry) => total + entry.contextEventJsonBytes,
\t\t\t\t\t\t\t0,
\t\t\t\t\t\t),
\t\t\t\t\t\tackMessages: issue194AckMessages,
\t\t\t\t\t\tackEncoding: issue194CommitReport.ackEncoding,
\t\t\t\t\t\tacknowledgedHostCount: issue194CommitReport.acknowledgedHostCount,
\t\t\t\t\t\tmessages: issue194Wire.messages,
\t\t\t\t\t},
\t\t\t\t}));
\t\t\t\tif (awaitingAdoption === null) drainNativeEvents();
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\tif (request !== LYNX_READY_ANNOUNCEMENT_REQUEST && !correlatedReadySent) {
`,
				`\t\t(reply as any).issue194 = {
\t\t\tprotocol: 'octane-issue194-first-screen-v1',
\t\t\trequest,
\t\t\ttreeNodes: snapshot?.nodes.length ?? null,
\t\t\tcalls: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PAPI__ ?? {})),
\t\t\tprofile: JSON.parse(JSON.stringify(lynxWireProfile())),
\t\t\tprogram: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PROGRAM__ ?? {})),
\t\t};
\t\tif (request !== LYNX_READY_ANNOUNCEMENT_REQUEST && !correlatedReadySent) {
`,
				file,
			);
			if (directOnly) {
				next = replaceOnce(
					next,
					`\t\t\tmarkFirstScreenPhase('capture');
\t\t\tconst captured = captureLynxFirstTree(source);
`,
					`\t\t\tcontext.dispatchEvent({
\t\t\t\ttype: 'octane-issue194-direct-result',
\t\t\t\tdata: JSON.stringify({
\t\t\t\t\tprotocol: 'octane-issue194-direct-v1',
\t\t\t\t\tcalls: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PAPI__ ?? {})),
\t\t\t\t\tprofile: JSON.parse(JSON.stringify(lynxWireProfile())),
\t\t\t\t\tprogram: JSON.parse(JSON.stringify((globalThis as any).__ISSUE194_PROGRAM__ ?? {})),
\t\t\t\t}),
\t\t\t});
\t\t\tfirstScreenState = 'painted';
\t\t\tif (firstScreenSync === 'automatic') firstScreenSyncReady = true;
\t\t\tmarkFirstScreenPhase('announce');
\t\t\tannounceReady();
\t\t\treturn result;

\t\t\tmarkFirstScreenPhase('capture');
\t\t\tconst captured = captureLynxFirstTree(source);
`,
					file,
				);
			}
			return next
				.replaceAll('performance.timeOrigin + performance.now()', 'Date.now()')
				.replaceAll('performance.now()', 'Date.now()');
		});

		// The Explorer's native main/background realms intentionally do not
		// expose the Web Performance API. The regular stage probes run in the
		// browser harness too, so keep their high-resolution clock there and
		// lower only this build-only native probe to a shared epoch clock. These
		// sources have already received the standard stage instrumentation when
		// this function runs and are restored by the two nested restore handles.
		for (const relative of [
			'packages/lynx/src/core/profiling.ts',
			'packages/lynx/src/main-renderer.ts',
			'packages/octane/src/profiling.ts',
			'packages/octane/src/universal-core.ts',
		]) {
			updateRepo(relative, (source) =>
				source
					.replaceAll('performance.timeOrigin + performance.now()', 'Date.now()')
					.replaceAll('performance.now()', 'Date.now()'),
			);
		}

		updateRepo('packages/lynx/src/core/transport.ts', (source, file) => {
			let next = replaceOnce(
				source,
				`\tconst handleReady = (message: LynxMainReadyReply) => {
`,
				`\tconst handleReady = (message: LynxMainReadyReply) => {
\t\tconst issue194 = (message as any).issue194;
\t\tif (issue194 !== undefined) {
\t\t\tconsole.log('__ISSUE194_FIRST_SCREEN__' + JSON.stringify(issue194));
\t\t}
`,
				file,
			);
			if (directOnly) {
				next = replaceOnce(
					next,
					`\treceiverAttached = true;
\ttry {
\t\tcontext.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, receive);
`,
					`\treceiverAttached = true;
\ttry {
\t\tcontext.addEventListener('octane-issue194-direct-result', (event) => {
\t\t\tconsole.log('__ISSUE194_DIRECT_RESULT__' + String(event.data));
\t\t});
\t\tcontext.addEventListener(LYNX_MAIN_TO_BACKGROUND_EVENT, receive);
`,
					file,
				);
			}
			return next.replaceAll('performance.now()', 'Date.now()');
		});

		updateRepo('packages/lynx/src/core/protocol.ts', (source, file) => {
			let next = replaceOnce(
				source,
				`...(hasCapabilities ? ['capabilities'] : []),
`,
				`...(hasCapabilities ? ['capabilities'] : []),
\t\t\t...(reply ? ['issue194'] : []),
`,
				file,
			);
			return next;
		});

		updateRepo('packages/lynx/src/core/host-driver.ts', (source, file) => {
			let next = replaceOnce(
				source,
				`\tconst mountProgram = (
\t\tnode: LynxFirstScreenDirectNode,
\t\tparentRecord: LynxHostRecord<Node> | null,
\t\tparentId: number | null,
\t\tphysicalParent: Node,
\t\tparentVisible: boolean,
\t): void => {
\t\tconst plan = node.plan;
\t\tconst ids = node.ids;
`,
				`\tconst mountProgram = (
\t\tnode: LynxFirstScreenDirectNode,
\t\tparentRecord: LynxHostRecord<Node> | null,
\t\tparentId: number | null,
\t\tphysicalParent: Node,
\t\tparentVisible: boolean,
\t): void => {
\t\tconst issue194MountStarted = Date.now();
\t\tconst plan = node.plan;
\t\tconst ids = node.ids;
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\tfor (const text of texts) args.push(text);
\t\tlet bound = boundPrograms.get(plan);
\t\tif (bound === undefined) {
\t\t\tbound = plan.bind(papi);
`,
				`\t\tfor (const text of texts) args.push(text);
\t\tlet bound = boundPrograms.get(plan);
\t\tif (bound === undefined) {
\t\t\tconst issue194BindStarted = Date.now();
\t\t\tbound = plan.bind(papi);
\t\t\tconst issue194Program = ((globalThis as any).__ISSUE194_PROGRAM__ ??= {
\t\t\t\tbindCount: 0,
\t\t\t\tbindMs: 0,
\t\t\t\tcreateCount: 0,
\t\t\t\tcreateExecMs: 0,
\t\t\t\tmountCount: 0,
\t\t\t\tmountMs: 0,
\t\t\t});
\t\t\tissue194Program.bindCount++;
\t\t\tissue194Program.bindMs += Date.now() - issue194BindStarted;
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\tconst created = bound(...args);
`,
				`\t\tconst issue194CreateStarted = Date.now();
\t\tconst created = bound(...args);
\t\tconst issue194Program = ((globalThis as any).__ISSUE194_PROGRAM__ ??= {
\t\t\tbindCount: 0,
\t\t\tbindMs: 0,
\t\t\tcreateCount: 0,
\t\t\tcreateExecMs: 0,
\t\t\tmountCount: 0,
\t\t\tmountMs: 0,
\t\t});
\t\tissue194Program.createCount++;
\t\tissue194Program.createExecMs += Date.now() - issue194CreateStarted;
`,
				file,
			);
			next = replaceOnce(
				next,
				`\t\tif (end !== 0) {
\t\t\tthrow hostError('first-screen program carries keyed range members no range claims.');
\t\t}
\t};
`,
				`\t\tif (end !== 0) {
\t\t\tthrow hostError('first-screen program carries keyed range members no range claims.');
\t\t}
\t\tconst issue194Program = ((globalThis as any).__ISSUE194_PROGRAM__ ??= {
\t\t\tbindCount: 0,
\t\t\tbindMs: 0,
\t\t\tcreateCount: 0,
\t\t\tcreateExecMs: 0,
\t\t\tmountCount: 0,
\t\t\tmountMs: 0,
\t\t});
\t\tissue194Program.mountCount++;
\t\tissue194Program.mountMs += Date.now() - issue194MountStarted;
\t};
`,
				file,
			);
			if (directOnly) {
				next = replaceOnce(
					next,
					`\t\tfor (let index = 0; index < created.length; index++) {
\t\t\tconst element = created[index] as Node;
\t\t\tstate.ownedNodes.add(element);
\t\t\t// The ID this node took, kept because nothing else will remember it.
\t\t\t// Adoption resolves the background's description against this map
\t\t\t// instead of against a record, which is the whole of what main
\t\t\t// contributes to a program's handoff (issue #163).
\t\t\tstate.programNodes.set(ids[index]!, element);
\t\t}
`,
					`\t\t// issue #194 direct-self window omits adoption/cleanup ownership.
`,
					file,
				);
				next = replaceOnce(
					next,
					`\t\tfor (let index = 0; index < plan.events.length; index++) {
\t\t\tconst token = tokens[index];
\t\t\tif (token === undefined) continue;
\t\t\tconst site = plan.events[index]!;
\t\t\tconst binding = parseLynxNativeEventProp(site.type);
\t\t\tif (binding === null) {
\t\t\t\tthrow hostError(\`event \${JSON.stringify(site.type)} is not a Lynx event prop.\`);
\t\t\t}
\t\t\t// Journalled rather than installed: the program already called
\t\t\t// \`setEvent\` with this exact token. What terminal cleanup needs is the
\t\t\t// tuple to clear, and it reads that from here.
\t\t\tnativeEventMap(state, created[site.node] as Node).set(
\t\t\t\tsite.type,
\t\t\t\tObject.freeze({ source: 'background', binding, listener: token }),
\t\t\t);
\t\t}
`,
					`\t\t// The emitted program installed events; cleanup journaling is out of scope.
`,
					file,
				);
				next = replaceOnce(
					next,
					`\t\tif (parentRecord !== null) {
\t\t\tif (parentRecord.children === EMPTY_HOST_CHILDREN) parentRecord.children = [];
\t\t\tparentRecord.children.push(ids[0]!);
\t\t} else if (parentId === null) {
\t\t\tstate.rootChildren.push(ids[0]!);
\t\t}
`,
					`\t\t// Logical parent linkage is consumed only by capture/adoption.
`,
					file,
				);
			}
			return next.replaceAll('performance.now()', 'Date.now()');
		});

		if (appendOrder === 'child-first') {
			updateRepo('packages/lynx/src/compiler/emit-main-thread-program.ts', (source, file) =>
				replaceOnce(
					source,
					`\tfor (let index = 1; index < program.nodes.length; index++) {
\t\tbody.push(\`\\t\\tappend(n\${program.nodes[index]!.parent}, n\${index});\`);
\t}
`,
					`\tfor (let index = program.nodes.length - 1; index >= 1; index--) {
\t\tbody.push(\`\\t\\tappend(n\${program.nodes[index]!.parent}, n\${index});\`);
\t}
`,
					file,
				),
			);
		}
	} catch (error) {
		for (const [file, original] of originals) fs.writeFileSync(file, original);
		throw error;
	}

	return () => {
		for (const [file, original] of originals) fs.writeFileSync(file, original);
	};
}
