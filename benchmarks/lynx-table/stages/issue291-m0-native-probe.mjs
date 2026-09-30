import crypto from 'node:crypto';

function replaceOnce(source, search, replacement, label) {
	const first = source.indexOf(search);
	if (first === -1) throw new Error(`issue #291 M0 probe anchor missing: ${label}`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`issue #291 M0 probe anchor is ambiguous: ${label}`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const RECEIPT_SOURCE = `interface Issue291Snapshot {
	readonly rowCount: number;
	readonly firstId: number | null;
	readonly secondId: number | null;
	readonly thirdId: number | null;
	readonly row998Id: number | null;
	readonly firstLabel: string | null;
	readonly selectedId: number | null;
}

type Issue291Global = typeof globalThis & {
	__ISSUE291_FLUSH__?: () => Promise<void>;
	__LYNX_BENCH_SNAPSHOT__?: () => Issue291Snapshot;
	__LYNX_BENCH_ERROR__?: string;
};

let issue291InteractionOrdinal = 0;

function issue291Frame(): Promise<number> {
	return new Promise((resolve) => lynx.requestAnimationFrame(() => resolve(Date.now())));
}

function issue291NativeTap(name: 'create' | 'clear', action: () => void): void {
	const benchmark = globalThis as Issue291Global;
	const flush = benchmark.__ISSUE291_FLUSH__;
	const preState = benchmark.__LYNX_BENCH_SNAPSHOT__?.();
	if (flush === undefined || preState === undefined) {
		throw new Error('Octane M0 Native memory probe is missing its transport or state boundary.');
	}
	const interactionOrdinal = ++issue291InteractionOrdinal;
	const startMs = Date.now();
	action();
	void flush()
		.then(() => {
			const commitAckMs = Date.now();
			return issue291Frame().then((firstFrameMs) =>
				issue291Frame().then((endMs) => {
					const postState = benchmark.__LYNX_BENCH_SNAPSHOT__?.();
					if (postState === undefined) {
						throw new Error('Octane M0 Native memory probe lost its post-state.');
					}
					console.log(
						'__NATIVE_BENCH_RESULT__',
						JSON.stringify({
							protocol: 'lynx-native-bench-v2',
							interactionOrdinal,
							name,
							source: 'native-tap',
							boundary: 'native-input-handler-to-second-native-frame',
							startMs,
							commitAckMs,
							firstFrameMs,
							endMs,
							latencyMs: endMs - startMs,
							renderEvidence: { kind: 'native-animation-frame', frames: 2 },
							transportEvidence: {
								kind: 'octane-root.flushTransport',
								acknowledged: true,
								ackMs: commitAckMs,
							},
							preState,
							postState,
						}),
					);
				}),
			);
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			benchmark.__LYNX_BENCH_ERROR__ = message;
			console.log('__NATIVE_BENCH_ERROR__', message);
		});
}

`;

const SNAPSHOT_SOURCE = `	const rowsRef = useRef<RowData[]>(rows);
	rowsRef.current = rows;
	const selectedRef = useRef<number | undefined>(selected);
	selectedRef.current = selected;
	(globalThis as Issue291Global).__LYNX_BENCH_SNAPSHOT__ = () => {
		const current = rowsRef.current;
		return {
			rowCount: current.length,
			firstId: current[0]?.id ?? null,
			secondId: current[1]?.id ?? null,
			thirdId: current[2]?.id ?? null,
			row998Id: current[998]?.id ?? null,
			firstLabel: current[0]?.label ?? null,
			selectedId: selectedRef.current ?? null,
		};
	};
`;

const MESSAGE_CHANNEL_SOURCE = `const _stormChannel =
	typeof MessageChannel === 'function' ? new MessageChannel() : null;
let _stormPending: (() => void) | null = null;
if (_stormChannel !== null) {
	_stormChannel.port1.onmessage = () => {
		const cb = _stormPending;
		_stormPending = null;
		if (cb) cb();
	};
}
function nextMacrotask(cb: () => void) {
	if (_stormChannel === null) {
		lynx.setTimeout(cb, 0);
		return;
	}
	_stormPending = cb;
	_stormChannel.port2.postMessage(0);
}`;

export function patchIssue291M0App(source) {
	const hadSnapshot = source.includes('__LYNX_BENCH_SNAPSHOT__');
	let next = source;
	if (next.includes('const _stormChannel = new MessageChannel();')) {
		const start = next.indexOf('const _stormChannel = new MessageChannel();');
		const end = next.indexOf('\n\nfunction runStorm(', start);
		if (end === -1) throw new Error('issue #291 M0 probe MessageChannel block is incomplete.');
		next = next.slice(0, start) + MESSAGE_CHANNEL_SOURCE + next.slice(end);
	} else if (next.includes('\t\tsetTimeout(cb, 0);')) {
		next = replaceOnce(
			next,
			'\t\tsetTimeout(cb, 0);',
			'\t\tlynx.setTimeout(cb, 0);',
			'Native timer',
		);
	}
	next = replaceOnce(next, 'function runStorm(', `${RECEIPT_SOURCE}function runStorm(`, 'runStorm');
	if (!hadSnapshot) {
		next = replaceOnce(
			next,
			`\tconst [selected, setSelected] = useState<number | undefined>(undefined);\n`,
			`\tconst [selected, setSelected] = useState<number | undefined>(undefined);\n${SNAPSHOT_SOURCE}`,
			'component state',
		);
	}
	next = replaceOnce(
		next,
		'bindtap={run}',
		"bindtap={() => issue291NativeTap('create', run)}",
		'create tap',
	);
	next = replaceOnce(
		next,
		'bindtap={clear}',
		"bindtap={() => issue291NativeTap('clear', clear)}",
		'clear tap',
	);
	return next;
}

export function patchIssue291M0Index(source) {
	const install = `type Issue291IndexGlobal = typeof globalThis & {
	__ISSUE291_FLUSH__?: () => Promise<void>;
};
(globalThis as Issue291IndexGlobal).__ISSUE291_FLUSH__ = () => root.flushTransport();

`;
	if (source.includes('void root.render(')) {
		return replaceOnce(
			source,
			'void root.render(',
			`${install}void root.render(`,
			'candidate render',
		);
	}
	if (source.includes('const rendering = root.render(App);')) {
		return replaceOnce(
			source,
			'const rendering = root.render(App);',
			`${install}const rendering = root.render(App);`,
			'upstream render',
		);
	}
	throw new Error('issue #291 M0 probe render anchor is missing.');
}

export function issue291M0ProbeReceipt(app, index) {
	const hash = crypto.createHash('sha256');
	for (const [file, source] of [
		['benchmarks/lynx-table/app/src/App.lynx.tsrx', app],
		['benchmarks/lynx-table/app/src/index.ts', index],
	]) {
		hash.update(file);
		hash.update('\0');
		hash.update(source);
		hash.update('\0');
	}
	return {
		algorithm: 'sha256-path-content-v1',
		capabilities: {
			nativeStartupReceipt: index.includes('__LYNX_BENCH_STARTUP__'),
			semanticSnapshot: app.includes('__LYNX_BENCH_SNAPSHOT__ = () =>'),
			nativeSafeMacrotask: app.includes('lynx.setTimeout(cb, 0)'),
		},
		files: [
			'benchmarks/lynx-table/app/src/App.lynx.tsrx',
			'benchmarks/lynx-table/app/src/index.ts',
		],
		sha256: hash.digest('hex'),
	};
}
