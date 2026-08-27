// Issue-#196 M1.5: the Node/V8 driver for the ledger primitives.
//
// #196 asks for per-op cost from a scaling series rather than a single point,
// n>=5, AB/BA, engine-version stamped, one record per window. This runs that on
// V8. It is deliberately the *second* half of a pair: the bodies live in
// `ledger-primitives.source.mjs` and import nothing, so a device runner on
// LepusNG executes the same source and the two columns are comparable rather
// than merely adjacent.
//
// What a row means: `nsPerOp` is the slope of a least-squares fit of elapsed
// time against operation count across `SERIES`, and `fixedMs` is its intercept —
// the cost of arriving at the loop, which an interpreter does not give away.
// `residual` is the largest relative distance of any series point from that fit;
// a row whose work is not linear in N shows up there instead of being averaged
// into a number that means nothing. Such a row also carries `nsPerOpByCount`,
// its own medians divided by their own counts, because the useful question
// about a growing hash table is not its average cost across sizes it will never
// be but its cost at the size the ledger actually reaches.
//
// Absolute V8 numbers are context only and are never spendable on a device
// decision (#194's protocol section, and #196's own "web columns are context").
// What they are good for is the ratio between rows and the "a JIT would have
// hidden this" comparison the device column is read against.

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PRIMITIVES, SERIES } from './ledger-primitives.source.mjs';
import { writeEvidenceJson } from '../scripts/evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const options = { reps: 5, label: 'm196-m15-ledger-primitives', warmup: 1 };
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (flag === '--reps') options.reps = Number(argv[++index]);
		else if (flag === '--label') options.label = argv[++index];
		else if (flag === '--warmup') options.warmup = Number(argv[++index]);
		else throw new Error(`unknown option ${flag}`);
	}
	if (!Number.isInteger(options.reps) || options.reps < 5) {
		throw new Error('--reps must be an integer >= 5; #196 fixes n>=5.');
	}
	return options;
}

/**
 * Rotate the primitive order per rep, so a row is not permanently first or last
 * in a window. This is the same reason `mts-profile.mjs` rotates its cells: a
 * fixed order lets warm-up, GC pressure and thermal drift land on the same row
 * every time and read as that row's cost.
 */
function rotated(list, by) {
	const offset = by % list.length;
	return [...list.slice(offset), ...list.slice(0, offset)];
}

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Least squares over (count, ms). Returns ns/op, the intercept, and the fit's worst relative miss. */
function fit(points) {
	const n = points.length;
	let sumX = 0;
	let sumY = 0;
	let sumXX = 0;
	let sumXY = 0;
	for (const [x, y] of points) {
		sumX += x;
		sumY += y;
		sumXX += x * x;
		sumXY += x * y;
	}
	const denominator = n * sumXX - sumX * sumX;
	const slope = (n * sumXY - sumX * sumY) / denominator;
	const intercept = (sumY - slope * sumX) / n;
	let residual = 0;
	for (const [x, y] of points) {
		const predicted = slope * x + intercept;
		// Guard the smallest point: a sub-millisecond y makes a relative miss
		// meaningless, so it is measured against the fit rather than against y.
		const scale = Math.max(Math.abs(predicted), 1e-3);
		residual = Math.max(residual, Math.abs(y - predicted) / scale);
	}
	return { nsPerOp: slope * 1e6, fixedMs: intercept, residual };
}

/**
 * Past this, the least-squares slope is not describing the series and the row is
 * reported per count instead. Chosen to sit above the noise of a flat row —
 * every flat row here lands under 0.7 — and below the growing hash tables, whose
 * worst point misses the fit by more than a whole multiple of itself.
 */
const LINEAR_RESIDUAL_LIMIT = 1;

function timeOnce(primitive, count) {
	const started = process.hrtime.bigint();
	const checksum = primitive.run(count);
	const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
	// Consumed, not discarded: V8 deletes a loop whose result nothing reads, and
	// a deleted loop measures as free rather than as fast.
	if (!Number.isFinite(checksum)) {
		throw new Error(`${primitive.name} returned a non-finite checksum`);
	}
	return elapsed;
}

function engineStamp() {
	let v8 = null;
	try {
		v8 = process.versions.v8 ?? null;
	} catch {
		v8 = null;
	}
	return {
		runtime: 'node',
		node: process.version,
		v8,
		platform: process.platform,
		release: os.release(),
		cpus: os.cpus().length,
		cpuModel: os.cpus()[0]?.model ?? null,
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const load = os.loadavg()[0];
	if (load > 2) {
		throw new Error(
			`host load ${load.toFixed(2)} is above 2; a busy host prices the interpreter, not the primitive.`,
		);
	}
	// One untimed pass so the first timed rep is not paying for lazy compilation
	// of the primitive bodies themselves.
	for (let pass = 0; pass < options.warmup; pass++) {
		for (const primitive of PRIMITIVES) primitive.run(SERIES[0]);
	}

	/** name -> count -> ms samples */
	const samples = new Map(
		PRIMITIVES.map((primitive) => [primitive.name, new Map(SERIES.map((count) => [count, []]))]),
	);
	for (let rep = 0; rep < options.reps; rep++) {
		for (const primitive of rotated(PRIMITIVES, rep)) {
			for (const count of rotated(SERIES, rep)) {
				samples.get(primitive.name).get(count).push(timeOnce(primitive, count));
			}
		}
		process.stdout.write(`[m15] rep ${rep + 1}/${options.reps}\n`);
	}

	const rows = [];
	for (const primitive of PRIMITIVES) {
		const perCount = samples.get(primitive.name);
		const points = SERIES.map((count) => [count, median(perCount.get(count))]);
		const fitted = fit(points);
		rows.push({
			name: primitive.name,
			note: primitive.note,
			subtract: primitive.subtract ?? null,
			nsPerOp: Number(fitted.nsPerOp.toFixed(2)),
			fixedMs: Number(fitted.fixedMs.toFixed(4)),
			residual: Number(fitted.residual.toFixed(4)),
			medianMs: Object.fromEntries(
				SERIES.map((count, index) => [count, Number(points[index][1].toFixed(4))]),
			),
			// The fit's slope is one number for the whole series, which is only the
			// per-op cost if the row is actually linear. A growing hash table is
			// not: it rehashes and falls out of cache, so its cost per op rises
			// with its size. This is the same medians divided by their own count,
			// so a non-linear row can be read at the size it will really run at
			// rather than at an average of sizes it never sees.
			nsPerOpByCount: Object.fromEntries(
				SERIES.map((count, index) => [
					count,
					Number(((points[index][1] * 1e6) / count).toFixed(2)),
				]),
			),
		});
	}
	// A row that names a `subtract` is measuring a compound: the build plus the
	// operation. The net is reported beside the gross rather than instead of it,
	// because the subtraction is an assumption about what the two rows share and
	// the reader should be able to see both halves.
	const byName = new Map(rows.map((row) => [row.name, row]));
	for (const row of rows) {
		if (row.subtract === null) continue;
		const base = byName.get(row.subtract);
		row.netNsPerOp = base === undefined ? null : Number((row.nsPerOp - base.nsPerOp).toFixed(2));
	}

	const record = {
		meta: {
			date: new Date().toISOString(),
			issue: 196,
			slice: 'M1.5',
			label: options.label,
			reps: options.reps,
			series: SERIES,
			engine: engineStamp(),
			loadavg1: Number(load.toFixed(2)),
			source: path.relative(path.join(HERE, '..'), path.join(HERE, 'ledger-primitives.source.mjs')),
		},
		rows,
		claims: {
			spendable:
				'Ratios between rows, and the presence or absence of a cost a JIT hides. Absolute ns/op on V8 is context only.',
			notSpendable:
				'Any device decision. LepusNG has no JIT; #196 M2 exists because the web instrument mispredicted the device by 19x.',
		},
	};
	const out = path.join(HERE, 'results', `${options.label}.json`);
	await writeEvidenceJson(out, record);
	process.stdout.write(`[m15] wrote results/${path.basename(out)}\n`);
	for (const row of rows) {
		const net = row.netNsPerOp === undefined ? '' : ` (net ${row.netNsPerOp})`;
		// A row the line above would misreport says so here instead of being
		// printed as though one slope described it. The threshold is not a
		// significance test — it is the point past which the fit is visibly not
		// the data, and the per-count column is what to read instead.
		const shape =
			row.residual > LINEAR_RESIDUAL_LIMIT
				? `  NOT LINEAR — read nsPerOpByCount: ${SERIES.map((count) => row.nsPerOpByCount[count]).join(' → ')}`
				: '';
		process.stdout.write(
			`[m15] ${row.name.padEnd(20)} ${String(row.nsPerOp).padStart(8)} ns/op${net}  residual ${row.residual}${shape}\n`,
		);
	}
}

await main();
