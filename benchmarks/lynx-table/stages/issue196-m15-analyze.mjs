import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = path.resolve(process.argv[2] ?? '');
if (process.argv.length < 3) throw new Error('usage: node issue196-m15-analyze.mjs <record>');

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFile = path.join(here, 'ledger-primitives.source.mjs');
const v8File = path.join(here, 'results/m196-m15-ledger-primitives.json');
const record = JSON.parse(fs.readFileSync(input, 'utf8'));
const v8 = JSON.parse(fs.readFileSync(v8File, 'utf8'));
const evidence = record.samples?.[0]?.m15Evidence;
if (evidence?.protocol !== 'octane-issue196-m15-lepus-v1') {
	throw new Error('record has no accepted LepusNG M1.5 evidence');
}
const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
if (sourceSha256 !== evidence.sourceSha256) {
	throw new Error(`measured source hash mismatch: ${evidence.sourceSha256} != ${sourceSha256}`);
}

function median(values) {
	const sorted = [...values].sort((first, second) => first - second);
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

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
		residual = Math.max(residual, Math.abs(y - predicted) / Math.max(Math.abs(predicted), 1e-3));
	}
	return { nsPerOp: slope * 1e6, fixedMs: intercept, residual };
}

const contextByName = new Map(v8.rows.map((row) => [row.name, row]));
const rows = evidence.rows.map((row) => {
	const points = evidence.series.map((count) => [count, median(row.samples[String(count)])]);
	const fitted = fit(points);
	const context = contextByName.get(row.name);
	return {
		name: row.name,
		note: row.note,
		subtract: row.subtract,
		nsPerOp: Number(fitted.nsPerOp.toFixed(2)),
		fixedMs: Number(fitted.fixedMs.toFixed(4)),
		residual: Number(fitted.residual.toFixed(4)),
		medianMs: Object.fromEntries(points.map(([count, value]) => [count, Number(value.toFixed(4))])),
		nsPerOpByCount: Object.fromEntries(
			points.map(([count, value]) => [count, Number(((value * 1e6) / count).toFixed(2))]),
		),
		v8Context: context
			? {
					nsPerOp: context.nsPerOp,
					residual: context.residual,
					nsPerOpByCount: context.nsPerOpByCount,
				}
			: null,
	};
});
const byName = new Map(rows.map((row) => [row.name, row]));
for (const row of rows) {
	if (row.subtract === null) continue;
	const base = byName.get(row.subtract);
	row.netNsPerOp = base === undefined ? null : Number((row.nsPerOp - base.nsPerOp).toFixed(2));
}

record.analysis = {
	protocol: 'octane-issue196-m15-analysis-v1',
	boundary: 'median Date.now milliseconds at each count; least-squares slope across 10k..1m',
	clockResolutionMs: 1,
	sourceSha256,
	deviceRows: rows,
	v8Context: {
		file: path.relative(path.dirname(input), v8File),
		engine: v8.meta.engine,
		claim: 'context only; no V8 absolute is spendable on a LepusNG decision',
	},
};

const temporary = `${input}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
fs.renameSync(temporary, input);
