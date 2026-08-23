// What a native list retains once it is mounted, measured three ways: built
// eagerly, declared as a deferred run, and — for one row of the table — the
// hand-written model that stood in for the deferred run before one existed.
//
//   node --expose-gc benchmarks/lynx-list/retention.mjs [pairs]
//
// This is deliberately not part of the ratio-guard suite. The deterministic part
// of the finding — how many logical hosts each arm retains — is printed first
// and needs no GC at all. The byte figures beside it are `heapUsed` deltas: they
// are host-bound, so only the ratio between two arms in one sitting is a
// portable number, and even that is reported with its full spread rather than as
// a single figure.
//
// Each sample runs in its own process. Measuring several arms in one process
// makes each one's baseline depend on what the last left behind, which showed up
// as a bimodal spread wide enough to move the ratio by half. One build per
// process removes that history entirely.
//
// Every arm is handed the same row strings, generated before the baseline is
// taken, so what each delta measures is the structure the arm builds on top of
// the application's own data.
//
// The five states each arm is measured in are what separate "a declaration is
// cheap" from "a declaration stays cheap":
//
//   mounted   the commit landed and nothing has been shown
//   idle      the first screen and nothing more — 12 cells of a 1,000-row list
//   half      half the rows' text rewritten by a commit, then the first screen
//   written   every row's text rewritten, then the first screen
//   scrolled  the first screen, then scrolled end to end
//
// `written` and `scrolled` are the two ways a declared host stops being one, and
// they are not the same size.
//
// `half` is in the table because it is what keeps the `written` row honest. The
// declared arm's write cost is linear — the two points sit on the same slope —
// while the eager arm's does not move with writes at all, so an eager figure
// that jumps between `half` and `written` is the heap resizing rather than the
// commit retaining anything. Two points is what tells those apart.

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

if (typeof globalThis.gc !== 'function') {
	throw new Error('run with --expose-gc: a retained-heap delta needs a forced collection.');
}

/**
 * Collect until the heap reading stops moving, so a delta is a retained-size
 * difference and not a GC schedule. Four unconditional rounds first, because one
 * `gc()` leaves finalizable and just-promoted objects behind.
 */
function settle() {
	for (let round = 0; round < 4; round++) globalThis.gc();
	let previous = process.memoryUsage().heapUsed;
	for (let attempt = 0; attempt < 8; attempt++) {
		globalThis.gc();
		const used = process.memoryUsage().heapUsed;
		if (Math.abs(used - previous) < 64 * 1024) return used;
		previous = used;
	}
	return previous;
}

/**
 * How far each arm is driven past its mount. `rows` is filled in per run so the
 * `written`/`scrolled` states name the whole list rather than a magic number.
 */
function exerciseFor(state, rows) {
	if (state === 'mounted') return { visibleRows: 0 };
	if (state === 'idle') return {};
	if (state === 'half') return { writtenRows: rows >> 1 };
	if (state === 'written') return { writtenRows: rows };
	if (state === 'scrolled') return { scrolledRows: rows };
	throw new TypeError(`unknown page state ${state}.`);
}

const STATES = ['mounted', 'idle', 'half', 'written', 'scrolled'];
/** Real arms, in the order they are printed. `model` is measured `mounted` only. */
const ARMS = ['eager', 'declared'];

// ---------------------------------------------------------------- child mode

const childRequest = process.env.OCTANE_RETENTION_SAMPLE;
if (childRequest !== undefined) {
	const [bundlePath, kind, arm, state] = childRequest.split('|');
	const workload = await import(pathToFileURL(bundlePath).href);
	const rows = workload.LOGICAL_ITEM_COUNT;
	const data = kind === 'narrow' ? workload.narrowRowData(rows) : workload.wideRowData(rows);
	const exercise = exerciseFor(state, rows);
	const before = settle();
	const held =
		arm === 'eager'
			? workload.buildRetainedList(kind, data, exercise)
			: arm === 'declared'
				? workload.buildDeclaredList(kind, data, exercise)
				: workload.buildDeferredRunModel(kind, data);
	await new Promise((resolve) => setImmediate(resolve));
	const after = settle();
	// Read the structure after the measurement so nothing above is dead code.
	const shape =
		arm === 'model'
			? { logicalHosts: held.rows.length, physicalCells: 0 }
			: { logicalHosts: held.logicalHosts, physicalCells: held.physicalCells };
	if (shape.logicalHosts <= 0) throw new Error('retained structure is empty.');
	process.stdout.write(JSON.stringify({ bytes: after - before, ...shape }));
	process.exit(0);
}

// --------------------------------------------------------------- parent mode

const rawPairs = process.argv[2] ?? '5';
const PAIRS = Number(rawPairs);
if (!Number.isSafeInteger(PAIRS) || PAIRS < 3) {
	throw new TypeError(`pairs must be a safe integer of at least 3, received ${rawPairs}.`);
}

const load = os.loadavg()[0];
if (load > 0.5 * os.cpus().length) {
	throw new Error(
		`host is busy (1-minute load ${load.toFixed(2)} on ${os.cpus().length} cpus); ` +
			'a retained-heap measurement needs a quiet host.',
	);
}

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	return sorted[sorted.length >> 1];
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-retention-'));
const bundlePath = path.join(tempDir, 'workload.mjs');

try {
	await build({
		absWorkingDir: REPO,
		entryPoints: [path.join(__dirname, 'workload.ts')],
		outfile: bundlePath,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node22',
		logLevel: 'silent',
		define: { 'process.env.NODE_ENV': '"production"' },
	});

	const sample = (kind, arm, state) => {
		const output = execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], {
			env: { ...process.env, OCTANE_RETENTION_SAMPLE: `${bundlePath}|${kind}|${arm}|${state}` },
			encoding: 'utf8',
		});
		return JSON.parse(output);
	};

	const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
	const range = (values) => `${mib(Math.min(...values))}-${mib(Math.max(...values))}`;

	// The report names the shape it measured from the constants the samples read,
	// so a workload edit cannot leave the header describing a different list.
	const workloadShape = await import(pathToFileURL(bundlePath).href);
	const logicalRows = workloadShape.LOGICAL_ITEM_COUNT;
	const windowSize = workloadShape.VISIBLE_WINDOW_SIZE;

	for (const kind of ['narrow', 'wide']) {
		console.log(
			`\n${kind} row — ${logicalRows.toLocaleString('en-US')} logical rows, ${windowSize}-cell window\n`,
		);
		const bytesByCell = new Map();
		const hostsByCell = new Map();
		for (const state of STATES) {
			// AB then BA across process launches, so an ordering effect in the host
			// cannot land on one arm. The #120 model arm is sampled only at
			// `mounted`, and it rides the same rotation for the same reason: a
			// block of model launches at the end would collect the whole run's
			// drift in the one column that is ratioed against `declared/mounted`.
			const arms = state === 'mounted' ? [...ARMS, 'model'] : ARMS;
			for (let pair = 0; pair < PAIRS; pair++) {
				const order = pair % 2 === 0 ? arms : [...arms].reverse();
				for (const arm of order) {
					const result = sample(kind, arm, state);
					if (result.bytes <= 0) throw new Error(`${kind}/${arm}/${state}: sample did not settle.`);
					const cell = `${arm}/${state}`;
					if (!bytesByCell.has(cell)) bytesByCell.set(cell, []);
					bytesByCell.get(cell).push(result.bytes);
					const seen = hostsByCell.get(cell);
					if (seen !== undefined && seen !== result.logicalHosts) {
						throw new Error(
							`${cell}: host count is not deterministic (${seen} then ${result.logicalHosts}).`,
						);
					}
					hostsByCell.set(cell, result.logicalHosts);
				}
			}
		}

		console.log('  records held (exact, no GC involved)');
		console.log('    state     | eager | declared');
		for (const state of STATES) {
			const eager = hostsByCell.get(`eager/${state}`);
			const declared = hostsByCell.get(`declared/${state}`);
			console.log(`    ${state.padEnd(9)} | ${String(eager).padStart(5)} | ${declared}`);
		}

		console.log('\n  retained heap (host-bound; the ratio inside this sitting is the number)');
		const eagerMedians = [];
		for (const state of STATES) {
			const eager = bytesByCell.get(`eager/${state}`);
			const declared = bytesByCell.get(`declared/${state}`);
			const eagerMedian = median(eager);
			const declaredMedian = median(declared);
			eagerMedians.push(eagerMedian);
			console.log(
				`    ${state.padEnd(9)} | eager ${mib(eagerMedian)} MiB (${range(eager)}) | ` +
					`declared ${mib(declaredMedian)} MiB (${range(declared)}) | ` +
					`${(eagerMedian / declaredMedian).toFixed(1)}x`,
			);
		}

		// The eager arm is the control: its record count is the same integer in
		// every state above. Its byte column is not expected to be flat, though —
		// two components genuinely differ between states at that same record
		// count: the replacement strings a write leaves retained on the rewritten
		// rows, and the visible window's physical cells, which `mounted` alone
		// never creates. Both are small (hundreds of short strings, a dozen
		// cells), so the spread is an upper bound on the instrument plus those,
		// and a declared-arm difference inside that band is still not a reading.
		//
		// One state carrying most of the spread — far beyond what those two
		// components can account for — is a heap-sizing step rather than a floor
		// under the whole table, so it is named instead of quietly widening every
		// row's error bar. That is derived from the data here, not asserted: drop
		// the farthest state and see whether the spread collapses.
		const spread = (values) => Math.max(...values) - Math.min(...values);
		const floor = spread(eagerMedians);
		const centre = median(eagerMedians);
		let outlier = 0;
		for (let index = 1; index < eagerMedians.length; index++) {
			if (Math.abs(eagerMedians[index] - centre) > Math.abs(eagerMedians[outlier] - centre)) {
				outlier = index;
			}
		}
		const without = spread(eagerMedians.filter((_unused, index) => index !== outlier));
		console.log(
			`\n  instrument floor: the eager arm holds the same ` +
				`${hostsByCell.get('eager/mounted')} records in every state above, and its byte ` +
				`column still spans ${mib(floor)} MiB — the instrument, plus the two small ` +
				`things the states do not share at that record count (a write's retained ` +
				`replacement strings; the visible window's cells, absent in \`mounted\`). ` +
				`Nothing smaller than that span is a reading` +
				(without * 2 < floor
					? `, and \`${STATES[outlier]}\` carries most of it — without that one state the ` +
						`control spans ${mib(without)} MiB. A step that size, unmatched by neighbours ` +
						'at the same record count, is the heap resizing rather than a commit retaining.'
					: '.'),
		);

		// The stand-in #120 used to size this slice before a deferred run existed:
		// one frozen program plus one value row per item, and no container, list,
		// cell, or record at all. It is a floor, so it is compared against the one
		// state that has read nothing — `mounted` — and reported as the distance
		// from that floor rather than retired quietly. Its samples were collected
		// in the interleaved rotation above, under the same settle guard as the
		// two real arms.
		const modelMedian = median(bytesByCell.get('model/mounted'));
		const model = bytesByCell.get('model/mounted');
		const declaredMounted = median(bytesByCell.get('declared/mounted'));
		console.log(
			`\n  #120's model (program + values, no container): ${mib(modelMedian)} MiB ` +
				`(${range(model)}) — the shipped declaration is ` +
				`${(declaredMounted / modelMedian).toFixed(2)}x that with a live list behind it`,
		);
	}
	console.log(
		'\nThe record counts are exact. The byte figures are host-bound: only a ratio ' +
			'inside one sitting carries, and the ranges above are the error bars.',
	);
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}
