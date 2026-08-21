// What a native list retains once it is mounted, measured against what a
// deferred run would retain for the same page.
//
//   node --expose-gc benchmarks/lynx-list/retention.mjs [pairs]
//
// This is deliberately not part of the ratio-guard suite. The deterministic part
// of the finding — how many logical hosts a list retains — is printed here and
// needs no GC at all. The byte figures beside it are `heapUsed` deltas: they are
// host-bound, so only the ratio between the two arms in one sitting is a
// portable number, and even that is reported with its full spread rather than as
// a single figure.
//
// Each sample runs in its own process. Measuring both arms in one process makes
// the second arm's baseline depend on what the first arm left behind, which
// showed up as a bimodal spread wide enough to move the ratio by half. One build
// per process removes that history entirely.
//
// Both arms are handed the same row strings, generated before the baseline is
// taken, so what each delta measures is the structure the arm builds on top of
// the application's own data.

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

// ---------------------------------------------------------------- child mode

const childRequest = process.env.OCTANE_RETENTION_SAMPLE;
if (childRequest !== undefined) {
	const [bundlePath, kind, arm] = childRequest.split('|');
	const workload = await import(pathToFileURL(bundlePath).href);
	const rows = workload.LOGICAL_ITEM_COUNT;
	const data = kind === 'narrow' ? workload.narrowRowData(rows) : workload.wideRowData(rows);
	const before = settle();
	const held =
		arm === 'octane'
			? workload.buildRetainedList(kind, data)
			: workload.buildDeferredRunModel(kind, data);
	await new Promise((resolve) => setImmediate(resolve));
	const after = settle();
	// Read the structure after the measurement so nothing above is dead code.
	const shape =
		arm === 'octane'
			? { logicalHosts: held.logicalHosts, physicalCells: held.physicalCells }
			: { logicalHosts: held.rows.length, physicalCells: 0 };
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

	const sample = (kind, arm) => {
		const output = execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], {
			env: { ...process.env, OCTANE_RETENTION_SAMPLE: `${bundlePath}|${kind}|${arm}` },
			encoding: 'utf8',
		});
		return JSON.parse(output);
	};

	for (const kind of ['narrow', 'wide']) {
		const octane = [];
		const deferred = [];
		let shape = null;
		// AB then BA across process launches, so an ordering effect in the host
		// cannot land on one arm.
		for (let pair = 0; pair < PAIRS; pair++) {
			const order = pair % 2 === 0 ? ['octane', 'deferred'] : ['deferred', 'octane'];
			for (const arm of order) {
				const result = sample(kind, arm);
				if (result.bytes <= 0) throw new Error(`${kind}/${arm}: sample did not settle.`);
				if (arm === 'octane') {
					octane.push(result.bytes);
					shape ??= result;
				} else {
					deferred.push(result.bytes);
				}
			}
		}
		const octaneMedian = median(octane);
		const deferredMedian = median(deferred);
		const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
		const range = (values) => `${mib(Math.min(...values))}-${mib(Math.max(...values))}`;
		console.log(
			`${kind} row — 1,000 logical rows, ${shape.logicalHosts} logical hosts retained, ` +
				`${shape.physicalCells} physical cells ever created`,
		);
		console.log(
			`  octane records:   ${mib(octaneMedian)} MiB (median of ${octane.length}, ` +
				`range ${range(octane)})`,
		);
		console.log(
			`  deferred run:     ${mib(deferredMedian)} MiB (median of ${deferred.length}, ` +
				`range ${range(deferred)})`,
		);
		console.log(
			`  ratio:            ${(octaneMedian / deferredMedian).toFixed(1)}x bytes, ` +
				`${Math.round(octaneMedian / 1000)} B/row vs ${Math.round(deferredMedian / 1000)} B/row`,
		);
	}
	console.log(
		'\nThe logical-host counts are exact. The byte figures are host-bound: only the ' +
			'per-row ratio inside one sitting carries, and the ranges above are the error bars.',
	);
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}
