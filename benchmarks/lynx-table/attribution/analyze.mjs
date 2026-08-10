import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import prettier from 'prettier';

import { STACK_TARGETS } from './targets.mjs';

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
	const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
	const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
	let numerator = 0;
	let denominator = 0;
	for (const point of points) {
		numerator += (point.x - xMean) * (point.y - yMean);
		denominator += (point.x - xMean) ** 2;
	}
	return numerator / denominator;
}

function mergeFragments(fragments) {
	const merged = { meta: [], targets: {}, controls: {}, bundleSha256: {} };
	for (const fragment of fragments) {
		merged.meta.push(fragment.meta);
		Object.assign(merged.bundleSha256, fragment.meta.bundleSha256);
		if (fragment.meta.bundleVariant === 'control') {
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
	return {
		wallMs: stats(cpu.map((sample) => sample.wallMs)),
		backgroundActiveMs,
		mainActiveMs: stats(cpu.map((sample) => sample.main.activeMs)),
		stageMs,
		explainedShare:
			Object.values(stageMs).reduce((sum, duration) => sum + duration, 0) /
			backgroundActiveMs.median,
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

export function summarize(fragments) {
	const merged = mergeFragments(fragments);
	const targets = {};
	for (const [id, raw] of Object.entries(merged.targets)) {
		targets[id] = {
			sha: raw.sha,
			...(raw.heap ? { heap: summarizeHeap(raw.heap) } : null),
			...(raw.cpu ? { cpu: summarizeCpu(raw.cpu) } : null),
			...(raw.cold ? { cold: summarizeCold(raw.cold) } : null),
			...(raw.storm ? { storm: summarizeStorm(raw.storm) } : null),
		};
	}
	const controls = {};
	for (const [id, raw] of Object.entries(merged.controls)) {
		controls[id] = {
			sha: raw.sha,
			...(raw.heap ? { heap: summarizeHeap(raw.heap) } : null),
			...(raw.cpu ? { cpu: summarizeCpu(raw.cpu) } : null),
			...(raw.cold ? { cold: summarizeCold(raw.cold) } : null),
		};
	}
	const adjacent = [];
	for (let index = 1; index < STACK_TARGETS.length; index++) {
		const before = targets[STACK_TARGETS[index - 1].id];
		const after = targets[STACK_TARGETS[index].id];
		if (!before || !after) continue;
		const heapRatio =
			before.heap && after.heap ? after.heap.slopeBytesPerRow / before.heap.slopeBytesPerRow : null;
		const coldRatios = {};
		if (before.cold && after.cold) {
			for (const operation of Object.keys(after.cold)) {
				coldRatios[operation] =
					after.cold[operation].first.median / before.cold[operation].first.median;
			}
		}
		adjacent.push({
			from: STACK_TARGETS[index - 1].id,
			to: STACK_TARGETS[index].id,
			heapRatio,
			coldRatios,
		});
	}
	return {
		protocol: merged.meta,
		bundleSha256: merged.bundleSha256,
		targets,
		controls,
		adjacent,
		gates: {
			retainedRegression: adjacent.find((step) => step.heapRatio >= 1.15) ?? null,
			coldRegression:
				adjacent.find((step) => Object.values(step.coldRatios).some((ratio) => ratio >= 1.15)) ??
				null,
			cpuAttributionPass: (targets['pr-22']?.cpu?.explainedShare ?? 0) >= 0.8,
		},
	};
}

function fixed(value, digits = 1) {
	return value === null || value === undefined ? '—' : value.toFixed(digits);
}

function markdown(summary, inputs) {
	const lines = [
		'# Lynx S3 attribution report',
		'',
		'## Provenance',
		'',
		`- Raw inputs: ${inputs.map((input) => `\`${path.basename(input)}\``).join(', ')}`,
		'- The diagnostic `latest.json` cited by issue #23 was not present in the repository, issue attachments, or local workspace; its quoted values are treated as an unverified trigger, not substituted for fresh samples.',
		'- Fresh realms, explicit CDP GC, sample order, host versions, runner options, commit SHAs, and bundle SHA-256 values are preserved in the raw inputs.',
		'',
		'## Retained heap',
		'',
		'| head | bytes/row slope | 1k median MiB | 10k median MiB | 30k median MiB | released |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
	];
	for (const target of STACK_TARGETS) {
		const heap = summary.targets[target.id]?.heap;
		if (!heap) continue;
		const byRows = new Map(heap.scales.map((scale) => [scale.rows, scale]));
		lines.push(
			`| ${target.id} | ${fixed(heap.slopeBytesPerRow, 0)} | ${fixed(byRows.get(1000)?.retained.median / 1048576)} | ${fixed(byRows.get(10000)?.retained.median / 1048576)} | ${fixed(byRows.get(30000)?.retained.median / 1048576)} | ${heap.scales.every((scale) => scale.workerReleased) ? 'yes' : 'no'} |`,
		);
	}
	lines.push(
		'',
		`Retained-heap ≥15% gate: **${summary.gates.retainedRegression ? `triggered at ${summary.gates.retainedRegression.to}` : 'not reproduced'}**.`,
		'',
		'## Create @ 10k CPU',
		'',
		'| head | wall median ms | BTS active ms | MTS active ms | named BTS share |',
		'| --- | ---: | ---: | ---: | ---: |',
	);
	for (const target of STACK_TARGETS) {
		const cpu = summary.targets[target.id]?.cpu;
		if (!cpu) continue;
		lines.push(
			`| ${target.id} | ${fixed(cpu.wallMs.median)} | ${fixed(cpu.backgroundActiveMs.median)} | ${fixed(cpu.mainActiveMs.median)} | ${fixed(cpu.explainedShare * 100)}% |`,
		);
	}
	lines.push(
		'',
		`Named-stage ≥80% gate at #22: **${summary.gates.cpuAttributionPass ? 'pass' : 'fail'}**.`,
		'',
		'### Observer-effect controls',
		'',
		'| head | heap slope profile/control | BTS active profile/control | cold create first profile/control |',
		'| --- | ---: | ---: | ---: |',
	);
	for (const id of ['main', 'pr-22']) {
		const profile = summary.targets[id];
		const control = summary.controls[id];
		if (!profile || !control) continue;
		lines.push(
			`| ${id} | ${fixed(profile.heap.slopeBytesPerRow, 0)} / ${fixed(control.heap.slopeBytesPerRow, 0)} | ${fixed(profile.cpu.backgroundActiveMs.median)} / ${fixed(control.cpu.backgroundActiveMs.median)} | ${fixed(profile.cold.create.first.median)} / ${fixed(control.cold.create.first.median)} |`,
		);
	}
	lines.push(
		'',
		'## Cold versus steady at #22',
		'',
		'| operation | first median ms | steady median ms | ratio | excess ms | semantic |',
		'| --- | ---: | ---: | ---: | ---: | --- |',
	);
	for (const [operation, cold] of Object.entries(summary.targets['pr-22']?.cold ?? {})) {
		lines.push(
			`| ${operation} | ${fixed(cold.first.median)} | ${fixed(cold.steady.median)} | ${fixed(cold.firstSteadyRatio, 2)}× | ${fixed(cold.firstExcessMs)} | ${cold.semantic ? 'pass' : 'fail'} |`,
		);
	}
	lines.push(
		'',
		`Cold ≥15% adjacent-head gate: **${summary.gates.coldRegression ? `triggered at ${summary.gates.coldRegression.to}` : 'not reproduced'}**.`,
		'',
		'## Reference cells',
		'',
		'| cell | heap slope bytes/row | BTS create@10k ms | #22 heap ratio | #22 BTS ratio |',
		'| --- | ---: | ---: | ---: | ---: |',
	);
	for (const id of ['vue-vdom', 'vue-vapor', 'react']) {
		const reference = summary.targets[id];
		const head = summary.targets['pr-22'];
		if (!reference?.heap || !reference.cpu || !head?.heap || !head.cpu) continue;
		lines.push(
			`| ${id} | ${fixed(reference.heap.slopeBytesPerRow, 0)} | ${fixed(reference.cpu.backgroundActiveMs.median)} | ${fixed(head.heap.slopeBytesPerRow / reference.heap.slopeBytesPerRow, 2)}× | ${fixed(head.cpu.backgroundActiveMs.median / reference.cpu.backgroundActiveMs.median, 2)}× |`,
		);
	}
	lines.push(
		'',
		'## Storm semantics at #22',
		'',
		'| operation | wall median ms | presentation commits | changed rows | wire commits | wire commands | semantic |',
		'| --- | ---: | ---: | ---: | ---: | ---: | --- |',
	);
	for (const [operation, storm] of Object.entries(summary.targets['pr-22']?.storm ?? {})) {
		lines.push(
			`| ${operation} | ${fixed(storm.ms.median)} | ${fixed(storm.commits.median, 0)} (${fixed(storm.commits.min, 0)}–${fixed(storm.commits.max, 0)}) | ${fixed(storm.changedRows.median, 0)} | ${fixed(storm.wireCommits.median, 0)} | ${fixed(storm.wireCommands.median, 0)} | ${storm.semantic ? 'pass' : 'fail'} |`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

async function main() {
	const inputs = process.argv.slice(2);
	if (inputs.length === 0) throw new Error('pass one or more raw result JSON files');
	const fragments = inputs.map((input) => {
		const contents = fs.readFileSync(input);
		return JSON.parse((input.endsWith('.gz') ? gunzipSync(contents) : contents).toString('utf8'));
	});
	const summary = summarize(fragments);
	const outputRoot = path.resolve(import.meta.dirname, 'results');
	fs.writeFileSync(
		path.join(outputRoot, 's3-0-summary.json'),
		await prettier.format(JSON.stringify(summary), { parser: 'json' }),
	);
	fs.writeFileSync(
		path.join(outputRoot, 's3-0-report.md'),
		await prettier.format(markdown(summary, inputs), { parser: 'markdown' }),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
