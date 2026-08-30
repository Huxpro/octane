// Issue #230 Order 3 — the four-build split, as one command.
//
// Reads the run records the `lynx-js-framework-benchmark` runner writes, pools
// the arms it recognises, and emits one checked-in record plus the table that
// goes in the README.
//
//   node benchmarks/lynx-table/stages/issue230-order3-split.mjs \
//     --run <runner>/results/runs/<window-1>.json \
//     --run <runner>/results/runs/<window-2>.json \
//     --out stages/results/issue230-order3-split-10000.json
//
// Split from the collection deliberately, the way #234 D splits judgement from
// collection: the runner lives in another repository and needs a browser, and
// keeping the arithmetic here is what lets the claim be re-derived — and
// re-checked — from records that are already on disk.
//
// ## Why more than one window
//
// The runner captures heap once per entry per window, so a single window gives
// every heap number an n of 1 and no spread at all. Wall clock is the opposite:
// 15 readings per arm inside a window, but between windows the whole machine
// drifts — this window set moved one arm by 77 ms between windows, which is
// wider than any within-window interval in it. So the two metrics are pooled on
// opposite rules, and the record says which rule it used for each:
//
//   wall clock — compared only *within* a window, never across;
//   heap       — one reading per window, trusted only when windows agree.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeEvidenceJson } from '../scripts/evidence.mjs';

export const ORDER3_SPLIT_PROTOCOL = 'octane-lynx-issue230-order3-split-v1';

/** The arms, in the order the report reads them. Control first. */
export const ARMS = ['o3ctl', 'o3cmp', 'o3tear', 'o3gen'];

export const ARM_NOTES = {
	o3ctl: 'control — the shipping build, byte-identical to the vendored octane-hux rows-0',
	o3cmp: 'the enabler alone: incremental compact and the certified dense teardown both reachable',
	o3tear: 'the teardown mirror alone: incremental compact suppressed',
	o3gen: 'incremental compact alone: the teardown mirror suppressed',
};

/** Sampled metrics, compared within a window. */
export const TIMED = ['latency', 'btsCpu', 'mtsCpu', 'fcp', 'settled'];
/** Single-reading metrics, compared across windows. */
export const HEAP = ['heapMts', 'heapBts', 'heapMtsAfterClear', 'heapBtsAfterClear'];

// t(0.975, df), keyed by df. This is the runner's own convention: its reported
// `ci95` reproduces exactly as t * stdev / sqrt(n), which is what lets a table
// built here be read beside one printed by the runner.
const T975 = {
	1: 12.706,
	2: 4.303,
	3: 3.182,
	4: 2.776,
	5: 2.571,
	6: 2.447,
	7: 2.365,
	8: 2.306,
	9: 2.262,
	10: 2.228,
	11: 2.201,
	12: 2.179,
	13: 2.16,
	14: 2.145,
	15: 2.131,
	16: 2.12,
	17: 2.11,
	18: 2.101,
	19: 2.093,
};

export function mean(values) {
	return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Half-width of the 95% interval on the mean. */
export function ci95(values) {
	const n = values.length;
	if (n < 2) return null;
	const m = mean(values);
	const variance = values.reduce((total, v) => total + (v - m) ** 2, 0) / (n - 1);
	return (T975[n - 1] ?? 1.96) * Math.sqrt(variance / n);
}

export function band(values) {
	const m = mean(values);
	const half = ci95(values);
	return half === null
		? { mean: m, lo: m, hi: m, n: values.length }
		: { mean: m, lo: m - half, hi: m + half, n: values.length };
}

/**
 * Whether an arm's interval clears the control's.
 *
 * The only mark the house format lets a delta carry, and deliberately a coarse
 * one: disjoint intervals, not a p-value. Everything else is inside the window
 * and is reported as such rather than as a small effect.
 */
export function disjoint(armBand, controlBand) {
	return armBand.hi < controlBand.lo || armBand.lo > controlBand.hi;
}

/** Pull `{metric: {arm: [values]}}` out of one runner window. */
export function readWindow(record) {
	const rows = Array.isArray(record) ? record : record.records;
	const out = {};
	for (const row of rows) {
		if (!ARMS.includes(row.entry)) continue;
		const samples =
			row.samples ?? (row.value === null || row.value === undefined ? [] : [row.value]);
		if (samples.length === 0) continue;
		(out[row.metric] ??= {})[row.entry] = samples.filter((value) => value !== null);
	}
	return out;
}

/** The Octane commit the arms were patched from, or null off a checkout. */
export function headCommit({ exec = spawnSync } = {}) {
	const result = exec('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
	return result.status === 0 ? String(result.stdout).trim() : null;
}

export function buildSplitRecord({ windows, question, scale, octaneCommit, bundles }) {
	const parsed = windows.map((w) => readWindow(w.record));
	// Wall clock: the first window is the comparison. Later windows replicate it
	// and are reported as replication, never pooled into it — pooling across a
	// drift this size would narrow an interval that the drift has already
	// widened, which is the one arithmetic that could turn this null into a
	// finding.
	const timed = {};
	for (const metric of TIMED) {
		const present = parsed[0][metric];
		if (present === undefined) continue;
		const control = present[ARMS[0]] === undefined ? null : band(present[ARMS[0]]);
		timed[metric] = {
			window: 1,
			arms: Object.fromEntries(
				ARMS.filter((arm) => present[arm] !== undefined).map((arm) => {
					const b = band(present[arm]);
					return [
						arm,
						{
							...b,
							delta: control === null ? null : b.mean - control.mean,
							disjointFromControl: control === null ? null : disjoint(b, control),
						},
					];
				}),
			),
			replication: parsed.slice(1).map((w, index) => {
				const later = w[metric];
				if (later === undefined) return { window: index + 2, arms: {} };
				const laterControl = later[ARMS[0]] === undefined ? null : band(later[ARMS[0]]);
				return {
					window: index + 2,
					arms: Object.fromEntries(
						ARMS.filter((arm) => later[arm] !== undefined).map((arm) => {
							const b = band(later[arm]);
							return [
								arm,
								{ ...b, delta: laterControl === null ? null : b.mean - laterControl.mean },
							];
						}),
					),
				};
			}),
		};
	}

	// Heap: one reading per window, so the windows *are* the samples.
	const heap = {};
	for (const metric of HEAP) {
		const perArm = {};
		for (const arm of ARMS) {
			const readings = parsed.map((w) => w[metric]?.[arm]?.[0]).filter((v) => v !== undefined);
			if (readings.length !== 0) perArm[arm] = readings;
		}
		if (Object.keys(perArm).length === 0) continue;
		const control = perArm[ARMS[0]];
		heap[metric] = Object.fromEntries(
			Object.entries(perArm).map(([arm, readings]) => [
				arm,
				{
					readings,
					mean: mean(readings),
					spread: Math.max(...readings) - Math.min(...readings),
					delta: control === undefined ? null : mean(readings) - mean(control),
				},
			]),
		);
	}

	return {
		protocol: ORDER3_SPLIT_PROTOCOL,
		question,
		createdAt: new Date().toISOString(),
		octaneCommit,
		scale,
		arms: ARM_NOTES,
		windows: windows.map((w, index) => ({ window: index + 1, source: w.source })),
		bundles,
		timed,
		heap,
	};
}

/**
 * The digests the arms were actually built from.
 *
 * A dated record is not an identity: two windows a week apart may have measured
 * the same bytes or four different builds, and #163 C9 lost a scaling series to
 * exactly that gap. The runner already stores a digest per entry, so this reads
 * that rather than keeping a second copy of the decision.
 */
export function readBundleProvenance(entriesDirectory) {
	if (entriesDirectory === null) return null;
	const out = {};
	for (const arm of ARMS) {
		const file = path.join(entriesDirectory, arm, 'entry.json');
		if (!fs.existsSync(file)) continue;
		const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
		out[arm] = {
			label: entry.label ?? null,
			config: entry.config ?? null,
			commit: entry.provenance?.commit ?? null,
			patchFile: entry.provenance?.patchFile ?? null,
			sha256: entry.provenance?.sha256 ?? null,
		};
	}
	return Object.keys(out).length === 0 ? null : out;
}

function readArgs(argv) {
	const args = argv.slice(2);
	const runs = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--run') runs.push(args[++index]);
	}
	const read = (name, fallback) => {
		const at = args.indexOf(name);
		if (at === -1 || args[at + 1] === undefined) {
			if (fallback === undefined) throw new Error(`missing ${name}`);
			return fallback;
		}
		return args[at + 1];
	};
	if (runs.length === 0) throw new Error('missing --run (give one per window)');
	const entries = read('--entries', '');
	return {
		runs,
		entries: entries === '' ? null : path.resolve(entries),
		out: path.resolve(read('--out')),
		scale: Number(read('--scale', '10000')),
		question: read(
			'--question',
			'does reaching the negotiated incremental-compact rung move the create residual?',
		),
	};
}

export async function main(argv, { log = console.log } = {}) {
	const { runs, entries, out, scale, question } = readArgs(argv);
	const windows = runs.map((source) => ({
		source,
		record: JSON.parse(fs.readFileSync(path.resolve(source), 'utf8')),
	}));
	const record = buildSplitRecord({
		windows,
		question,
		scale,
		octaneCommit: headCommit(),
		bundles: readBundleProvenance(entries),
	});
	fs.mkdirSync(path.dirname(out), { recursive: true });
	await writeEvidenceJson(out, record);
	for (const [metric, entry] of Object.entries(record.timed)) {
		const marks = Object.entries(entry.arms)
			.filter(([, value]) => value.disjointFromControl === true)
			.map(([arm]) => arm);
		log(
			`[issue230] ${metric}: ${marks.length === 0 ? 'no arm clears control' : `disjoint: ${marks.join(', ')}`}`,
		);
	}
	for (const [metric, arms] of Object.entries(record.heap)) {
		for (const [arm, value] of Object.entries(arms)) {
			if (arm === ARMS[0] || Math.abs(value.delta) < 1e6) continue;
			log(
				`[issue230] ${metric}: ${arm} ${(value.delta / 1e6).toFixed(2)} MB vs control (spread ${(value.spread / 1e3).toFixed(0)} kB)`,
			);
		}
	}
	log(`[issue230] record → ${out}`);
	return 0;
}

if (
	process.argv[1] !== undefined &&
	path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
	process.exitCode = await main(process.argv);
}
