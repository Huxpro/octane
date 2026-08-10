import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import prettier from 'prettier';

export function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function stats(values) {
	return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

function optionalStats(samples, name) {
	const values = samples.map((sample) => sample[name]).filter((value) => Number.isFinite(value));
	return values.length === 0 ? null : stats(values);
}

export function linearSlope(points) {
	if (points.length < 2) return null;
	const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
	const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
	let numerator = 0;
	let denominator = 0;
	for (const point of points) {
		numerator += (point.x - xMean) * (point.y - yMean);
		denominator += (point.x - xMean) ** 2;
	}
	return denominator === 0 ? null : numerator / denominator;
}

function mergeFragments(fragments) {
	const merged = {
		meta: [],
		targets: {},
		controls: {},
		bundleSha256: { control: {}, profile: {} },
		targetOrder: [],
	};
	const seen = new Set();
	for (const fragment of fragments) {
		merged.meta.push(fragment.meta);
		const variant = fragment.meta.bundleVariant;
		if (variant !== 'control' && variant !== 'profile') {
			throw new Error(`unknown bundle variant ${String(variant)}.`);
		}
		Object.assign(merged.bundleSha256[variant], fragment.meta.bundleSha256);
		for (const id of fragment.meta.targetOrder ?? Object.keys(fragment.targets)) {
			if (!seen.has(id)) {
				seen.add(id);
				merged.targetOrder.push(id);
			}
		}
		if (variant === 'control') {
			Object.assign(merged.controls, fragment.targets);
			continue;
		}
		for (const [id, result] of Object.entries(fragment.targets)) {
			merged.targets[id] = { ...(merged.targets[id] ?? {}), ...result };
		}
	}
	return merged;
}

function summarizeHeap(heap) {
	const scales = Object.entries(heap)
		.map(([rows, samples]) => {
			const clearMs = optionalStats(samples, 'clearMs');
			const viewDestroyMs = optionalStats(samples, 'viewDestroyMs');
			const workerReleaseMs = optionalStats(samples, 'workerReleaseMs');
			return {
				rows: Number(rows),
				retained: stats(samples.map((sample) => sample.retainedBytes)),
				clearResidual: stats(samples.map((sample) => sample.clearResidualBytes)),
				...(clearMs === null ? null : { clearMs }),
				...(viewDestroyMs === null ? null : { viewDestroyMs }),
				...(workerReleaseMs === null ? null : { workerReleaseMs }),
				semantic: samples.every((sample) => sample.oracle.rows === Number(rows)),
				workerReleased: samples.every((sample) => sample.workerReleased),
			};
		})
		.sort((a, b) => a.rows - b.rows);
	return {
		scales,
		slopeBytesPerRow: linearSlope(
			scales.map((scale) => ({ x: scale.rows, y: scale.retained.median })),
		),
	};
}

const CPU_STAGES = ['ownerMaterializationMs', 'transactionStagingMs', 'planFoldingMs'];
function summarizeCpu(cpu) {
	const stageMs = Object.fromEntries(
		CPU_STAGES.map((stage) => [stage, median(cpu.map((sample) => sample.allocation[stage] ?? 0))]),
	);
	const backgroundActiveMs = stats(cpu.map((sample) => sample.background.activeMs));
	const explainedMs = Object.values(stageMs).reduce((sum, duration) => sum + duration, 0);
	return {
		wallMs: stats(cpu.map((sample) => sample.wallMs)),
		backgroundActiveMs,
		mainActiveMs: stats(cpu.map((sample) => sample.main.activeMs)),
		stageMs,
		explainedShare:
			backgroundActiveMs.median === 0 ? null : explainedMs / backgroundActiveMs.median,
		semantic: cpu.every((sample) => sample.oracle.rows === 10000),
	};
}

function summarizeCold(cold) {
	return Object.fromEntries(
		Object.entries(cold).map(([operation, realms]) => {
			const first = stats(realms.map((samples) => samples[0].ms));
			const steady = stats(
				realms.flatMap((samples) => samples.slice(1).map((sample) => sample.ms)),
			);
			const samples = realms.flat();
			return [
				operation,
				{
					first,
					steady,
					firstSteadyRatio: first.median / steady.median,
					firstExcessMs: first.median - steady.median,
					semantic: samples.every((sample) => {
						if (operation === 'create' || operation === 'replace')
							return sample.after.rows === 1000;
						if (operation === 'clear') return sample.after.rows === 0;
						return sample.after.rows === 1000 && sample.survivors === true;
					}),
					presentation: {
						commits: stats(samples.map((sample) => sample.presentation.commits)),
						changedRows: stats(samples.map((sample) => sample.presentation.changedRows)),
					},
				},
			];
		}),
	);
}

function summarizeStorm(storm) {
	return Object.fromEntries(
		['updateStorm', 'selectStorm'].map((operation) => {
			const samples = storm.map((sample) => sample[operation]);
			return [
				operation,
				{
					ms: stats(samples.map((sample) => sample.ms)),
					commits: stats(samples.map((sample) => sample.presentation.commits)),
					changedRows: stats(samples.map((sample) => sample.presentation.changedRows)),
					wireCommits: stats(samples.map((sample) => sample.wire.commits ?? 0)),
					wireCommands: stats(samples.map((sample) => sample.wire.commands ?? 0)),
					semantic: samples.every(
						(sample) => sample.after.rows === 1000 && sample.survivors === true,
					),
				},
			];
		}),
	);
}

function summarizeTarget(raw) {
	return {
		sha: raw.sha,
		...(raw.reference ? { reference: true } : null),
		...(raw.heap ? { heap: summarizeHeap(raw.heap) } : null),
		...(raw.cpu ? { cpu: summarizeCpu(raw.cpu) } : null),
		...(raw.cold ? { cold: summarizeCold(raw.cold) } : null),
		...(raw.storm ? { storm: summarizeStorm(raw.storm) } : null),
	};
}

export function summarize(fragments, options = {}) {
	const merged = mergeFragments(fragments);
	const targets = Object.fromEntries(
		Object.entries(merged.targets).map(([id, raw]) => [id, summarizeTarget(raw)]),
	);
	const controls = Object.fromEntries(
		Object.entries(merged.controls).map(([id, raw]) => [id, summarizeTarget(raw)]),
	);
	const targetOrder = merged.targetOrder.filter((id) => targets[id] !== undefined);
	const comparisonOrder = targetOrder.filter((id) => !targets[id].reference);
	const baseline = options.baseline ?? comparisonOrder[0] ?? null;
	const candidate = options.candidate ?? comparisonOrder.at(-1) ?? null;
	for (const [name, id] of Object.entries({ baseline, candidate })) {
		if (id !== null && !comparisonOrder.includes(id)) {
			throw new Error(`unknown non-reference ${name} target ${id}.`);
		}
	}
	const adjacent = [];
	for (let index = 1; index < comparisonOrder.length; index++) {
		const from = comparisonOrder[index - 1];
		const to = comparisonOrder[index];
		const before = targets[from];
		const after = targets[to];
		const heapRatio =
			before.heap?.slopeBytesPerRow != null && after.heap?.slopeBytesPerRow != null
				? after.heap.slopeBytesPerRow / before.heap.slopeBytesPerRow
				: null;
		const coldRatios = {};
		if (before.cold && after.cold) {
			for (const operation of Object.keys(after.cold)) {
				coldRatios[operation] =
					after.cold[operation].first.median / before.cold[operation].first.median;
			}
		}
		adjacent.push({ from, to, heapRatio, coldRatios });
	}
	const candidateShare =
		candidate === null ? null : (targets[candidate]?.cpu?.explainedShare ?? null);
	return {
		protocol: merged.meta,
		bundleSha256: merged.bundleSha256,
		targetOrder,
		comparison: { baseline, candidate },
		targets,
		controls,
		adjacent,
		gates: {
			retainedRegression:
				adjacent.find((step) => step.heapRatio !== null && step.heapRatio >= 1.15) ?? null,
			coldRegression:
				adjacent.find((step) => Object.values(step.coldRatios).some((ratio) => ratio >= 1.15)) ??
				null,
			cpuAttributionPass: candidateShare === null ? null : candidateShare >= 0.8,
		},
	};
}

function fixed(value, digits = 1) {
	return value === null || value === undefined ? '—' : value.toFixed(digits);
}

function mebibytes(scale) {
	return scale === undefined ? null : scale.retained.median / 1048576;
}

function gateResult(regression, evaluated) {
	if (!evaluated) return 'not evaluated';
	return regression ? `triggered at ${regression.to}` : 'not reproduced';
}

export function markdown(summary, inputs) {
	const candidateId = summary.comparison.candidate;
	const candidate = candidateId === null ? null : summary.targets[candidateId];
	const retainedEvaluated = summary.adjacent.some((step) => step.heapRatio !== null);
	const coldEvaluated = summary.adjacent.some((step) => Object.keys(step.coldRatios).length !== 0);
	const lines = [
		'# Lynx attribution report',
		'',
		'## Provenance',
		'',
		`- Raw inputs: ${inputs.map((input) => `\`${path.basename(input)}\``).join(', ')}`,
		`- Comparison: ${summary.comparison.baseline ?? '—'} → ${candidateId ?? '—'}`,
		'- Fresh realms, explicit CDP GC, sample order, host versions, runner options, commit SHAs, and bundle SHA-256 values are preserved in the raw inputs.',
		'',
		'## Retained heap',
		'',
		'| target | bytes/row slope | 1k median MiB | 10k median MiB | 30k median MiB | released |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
	];
	for (const id of summary.targetOrder) {
		const heap = summary.targets[id]?.heap;
		if (!heap) continue;
		const byRows = new Map(heap.scales.map((scale) => [scale.rows, scale]));
		lines.push(
			`| ${id} | ${fixed(heap.slopeBytesPerRow, 0)} | ${fixed(mebibytes(byRows.get(1000)))} | ${fixed(mebibytes(byRows.get(10000)))} | ${fixed(mebibytes(byRows.get(30000)))} | ${heap.scales.every((scale) => scale.workerReleased) ? 'yes' : 'no'} |`,
		);
	}
	lines.push(
		'',
		`Retained-heap ≥15% adjacent-target gate: **${gateResult(summary.gates.retainedRegression, retainedEvaluated)}**.`,
		'',
		'## Create @ 10k CPU',
		'',
		'| target | wall median ms | BTS active ms | MTS active ms | named BTS share |',
		'| --- | ---: | ---: | ---: | ---: |',
	);
	for (const id of summary.targetOrder) {
		const cpu = summary.targets[id]?.cpu;
		if (!cpu) continue;
		lines.push(
			`| ${id} | ${fixed(cpu.wallMs.median)} | ${fixed(cpu.backgroundActiveMs.median)} | ${fixed(cpu.mainActiveMs.median)} | ${fixed(cpu.explainedShare === null ? null : cpu.explainedShare * 100)}% |`,
		);
	}
	lines.push(
		'',
		`Named-stage ≥80% candidate gate: **${summary.gates.cpuAttributionPass === null ? 'not measured' : summary.gates.cpuAttributionPass ? 'pass' : 'fail'}**.`,
		'',
		'### Observer-effect controls',
		'',
		'| target | heap slope profile/control | BTS active profile/control | cold create first profile/control |',
		'| --- | ---: | ---: | ---: |',
	);
	for (const id of summary.targetOrder) {
		const profile = summary.targets[id];
		const control = summary.controls[id];
		if (!profile || !control) continue;
		lines.push(
			`| ${id} | ${fixed(profile.heap?.slopeBytesPerRow, 0)} / ${fixed(control.heap?.slopeBytesPerRow, 0)} | ${fixed(profile.cpu?.backgroundActiveMs.median)} / ${fixed(control.cpu?.backgroundActiveMs.median)} | ${fixed(profile.cold?.create.first.median)} / ${fixed(control.cold?.create.first.median)} |`,
		);
	}
	lines.push('', `## Cold versus steady at ${candidateId ?? 'candidate'}`, '');
	lines.push(
		'| operation | first median ms | steady median ms | ratio | excess ms | semantic |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
	);
	for (const [operation, cold] of Object.entries(candidate?.cold ?? {})) {
		lines.push(
			`| ${operation} | ${fixed(cold.first.median)} | ${fixed(cold.steady.median)} | ${fixed(cold.firstSteadyRatio, 2)}× | ${fixed(cold.firstExcessMs)} | ${cold.semantic ? 'pass' : 'fail'} |`,
		);
	}
	lines.push(
		'',
		`Cold ≥15% adjacent-target gate: **${gateResult(summary.gates.coldRegression, coldEvaluated)}**.`,
		'',
		'## Reference cells',
		'',
		'| cell | heap slope bytes/row | BTS create@10k ms | candidate heap ratio | candidate BTS ratio |',
		'| --- | ---: | ---: | ---: | ---: |',
	);
	for (const id of summary.targetOrder) {
		const reference = summary.targets[id];
		if (
			!reference?.reference ||
			reference.heap?.slopeBytesPerRow == null ||
			!reference.cpu ||
			candidate?.heap?.slopeBytesPerRow == null ||
			!candidate.cpu
		)
			continue;
		lines.push(
			`| ${id} | ${fixed(reference.heap.slopeBytesPerRow, 0)} | ${fixed(reference.cpu.backgroundActiveMs.median)} | ${fixed(candidate.heap.slopeBytesPerRow / reference.heap.slopeBytesPerRow, 2)}× | ${fixed(candidate.cpu.backgroundActiveMs.median / reference.cpu.backgroundActiveMs.median, 2)}× |`,
		);
	}
	lines.push(
		'',
		`## Storm semantics at ${candidateId ?? 'candidate'}`,
		'',
		'| operation | wall median ms | presentation commits | changed rows | wire commits | wire commands | semantic |',
		'| --- | ---: | ---: | ---: | ---: | ---: | --- |',
	);
	for (const [operation, storm] of Object.entries(candidate?.storm ?? {})) {
		lines.push(
			`| ${operation} | ${fixed(storm.ms.median)} | ${fixed(storm.commits.median, 0)} (${fixed(storm.commits.min, 0)}–${fixed(storm.commits.max, 0)}) | ${fixed(storm.changedRows.median, 0)} | ${fixed(storm.wireCommits.median, 0)} | ${fixed(storm.wireCommands.median, 0)} | ${storm.semantic ? 'pass' : 'fail'} |`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

async function main() {
	const { values, positionals: inputs } = parseArgs({
		allowPositionals: true,
		options: {
			baseline: { type: 'string' },
			candidate: { type: 'string' },
			'summary-output': { type: 'string', default: 'results/summary.json' },
			'report-output': { type: 'string', default: 'results/report.md' },
		},
	});
	if (inputs.length === 0) throw new Error('pass one or more raw result JSON files');
	const fragments = inputs.map((input) => {
		const contents = fs.readFileSync(input);
		return JSON.parse((input.endsWith('.gz') ? gunzipSync(contents) : contents).toString('utf8'));
	});
	const summary = summarize(fragments, values);
	const summaryOutput = path.resolve(import.meta.dirname, values['summary-output']);
	const reportOutput = path.resolve(import.meta.dirname, values['report-output']);
	fs.mkdirSync(path.dirname(summaryOutput), { recursive: true });
	fs.mkdirSync(path.dirname(reportOutput), { recursive: true });
	fs.writeFileSync(
		summaryOutput,
		await prettier.format(JSON.stringify(summary), { parser: 'json' }),
	);
	fs.writeFileSync(
		reportOutput,
		await prettier.format(markdown(summary, inputs), { parser: 'markdown' }),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
