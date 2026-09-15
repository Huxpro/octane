import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { writeEvidenceJson } from '../scripts/evidence.mjs';
import { issue194LifecycleSequence } from './issue194-device-protocol.mjs';

const INPUT_PROTOCOL = 'octane-issue194-device-v1';
const OUTPUT_PROTOCOL = 'octane-issue291-native-memory-comparison-v1';
const REQUIRED_PAIRS = 10;
const REQUIRED_CYCLES = 20;
const NON_INFERIORITY_LIMIT = 1.05;
const BOOTSTRAP_REPETITIONS = 20_000;
const BOOTSTRAP_SEED = 0x291c0de;

function object(value, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value;
}

function positive(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive finite number.`);
	}
	return value;
}

function quantile(sorted, probability) {
	const index = (sorted.length - 1) * probability;
	const lower = Math.floor(index);
	const fraction = index - lower;
	return (
		sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
	);
}

function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function geometricMean(values) {
	return Math.exp(
		values.reduce((sum, value) => sum + Math.log(positive(value, 'ratio')), 0) / values.length,
	);
}

/** Deterministic paired bootstrap over the session-level ratio observations. */
export function pairedGeometricBootstrap(
	values,
	{ repetitions = BOOTSTRAP_REPETITIONS, seed = BOOTSTRAP_SEED } = {},
) {
	if (!Array.isArray(values) || values.length < 2) {
		throw new Error('paired bootstrap requires at least two ratios.');
	}
	if (!Number.isSafeInteger(repetitions) || repetitions < 1000) {
		throw new TypeError('paired bootstrap requires at least 1000 repetitions.');
	}
	const ratios = values.map((value) => positive(value, 'paired ratio'));
	const draw = random(seed);
	const distribution = new Array(repetitions);
	for (let iteration = 0; iteration < repetitions; iteration++) {
		let logSum = 0;
		for (let index = 0; index < ratios.length; index++) {
			logSum += Math.log(ratios[Math.floor(draw() * ratios.length)]);
		}
		distribution[iteration] = Math.exp(logSum / ratios.length);
	}
	distribution.sort((left, right) => left - right);
	return {
		method: 'paired session-level percentile bootstrap of geometric-mean ratios',
		n: ratios.length,
		repetitions,
		seed,
		pointEstimate: geometricMean(ratios),
		ci95: {
			lower: quantile(distribution, 0.025),
			upper: quantile(distribution, 0.975),
		},
	};
}

function memoryValue(checkpoint, metric, label) {
	const memory = object(checkpoint, label);
	if (metric === 'nativeHeapAllocKb') {
		return positive(object(memory.dumpsysKb, `${label}.dumpsysKb`).nativeHeapAlloc, label);
	}
	if (metric === 'totalPssKb') {
		return positive(object(memory.dumpsysKb, `${label}.dumpsysKb`).totalPss, label);
	}
	return positive(object(memory.smapsRollupKb, `${label}.smapsRollupKb`).Pss, label);
}

function sampleMemory(sample, metric) {
	const memory = object(sample.processMemory, `sample ${sample.ordinal} processMemory`);
	if (!Array.isArray(memory.steps) || memory.steps.length === 0) {
		throw new Error(`sample ${sample.ordinal} has no process-memory steps.`);
	}
	const creates = memory.steps.filter((step) => step.workload === 'create');
	const clears = memory.steps.filter((step) => step.workload === 'clear');
	if (creates.length === 0 || clears.length === 0) {
		throw new Error(`sample ${sample.ordinal} needs populated and cleared memory checkpoints.`);
	}
	return {
		emptyBaseline: memoryValue(memory.baseline, metric, `sample ${sample.ordinal} baseline`),
		operationalCreateHighWater: Math.max(
			...creates.map((step) =>
				memoryValue(
					step.postReceipt,
					metric,
					`sample ${sample.ordinal} step ${step.step} postReceipt`,
				),
			),
		),
		settledPopulated: memoryValue(
			creates.at(-1).settled,
			metric,
			`sample ${sample.ordinal} final populated settle`,
		),
		afterClear: memoryValue(
			clears.at(-1).settled,
			metric,
			`sample ${sample.ordinal} final clear settle`,
		),
	};
}

function validateSampleSequence(sample, expected, settleMs) {
	const memory = object(sample.processMemory, `sample ${sample.ordinal} processMemory`);
	if (memory.settleMs !== settleMs || !Array.isArray(memory.steps)) {
		throw new Error(`sample ${sample.ordinal} disagrees with the session memory controls.`);
	}
	if (
		memory.steps.length !== expected.length ||
		!Array.isArray(sample.sequenceEvidence) ||
		sample.sequenceEvidence.length !== expected.length
	) {
		throw new Error(`sample ${sample.ordinal} does not contain the complete lifecycle sequence.`);
	}
	for (let index = 0; index < expected.length; index++) {
		const control = expected[index];
		const memoryStep = memory.steps[index];
		const stateStep = sample.sequenceEvidence[index];
		object(memoryStep.postReceipt, `sample ${sample.ordinal} step ${index + 1} postReceipt`);
		object(memoryStep.settled, `sample ${sample.ordinal} step ${index + 1} settled`);
		for (const field of ['cycle', 'phase', 'workload']) {
			if (memoryStep[field] !== control[field] || stateStep[field] !== control[field]) {
				throw new Error(
					`sample ${sample.ordinal} lifecycle step ${index + 1} disagrees on ${field}.`,
				);
			}
		}
	}
}

function validateAcceptedSample(sample) {
	const thermal = object(sample.thermalBefore, `sample ${sample.ordinal} thermalBefore`);
	const devtool = object(sample.devtool, `sample ${sample.ordinal} devtool`);
	if (
		sample.outcome !== 'completed' ||
		devtool.stayedDisabled !== true ||
		!Number.isFinite(thermal.batteryTemperatureTenthsC) ||
		thermal.batteryTemperatureTenthsC > 350 ||
		thermal.thermalStatus !== 0 ||
		!Array.isArray(sample.errors) ||
		sample.errors.length !== 0
	) {
		throw new Error(`sample ${sample.ordinal} did not preserve the Native device controls.`);
	}
}

function summary(values) {
	const sorted = values.slice().sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return {
		n: sorted.length,
		median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
		min: sorted[0],
		max: sorted.at(-1),
	};
}

function compareMetric(pairs, checkpoint, metric, seedOffset) {
	const reference = pairs.map((pair) => pair.reference.metrics[metric][checkpoint]);
	const candidate = pairs.map((pair) => pair.candidate.metrics[metric][checkpoint]);
	const ratios = candidate.map((value, index) => value / reference[index]);
	const bootstrap = pairedGeometricBootstrap(ratios, { seed: BOOTSTRAP_SEED + seedOffset });
	return {
		unit: metric.endsWith('Kb') ? 'kB' : null,
		reference: summary(reference),
		candidate: summary(candidate),
		pairedRatios: ratios,
		bootstrap,
		nonInferiority: {
			limit: NON_INFERIORITY_LIMIT,
			passed: bootstrap.ci95.upper <= NON_INFERIORITY_LIMIT,
		},
	};
}

function cellReceipt(input, label) {
	const cell = object(object(input.cells, 'cells')[label], `cell ${label}`);
	if (!/^[0-9a-f]{40}$/.test(cell.sourceCommit)) {
		throw new Error(`cell ${label} needs a full lowercase source commit.`);
	}
	const bundle = object(cell.bundle, `cell ${label} bundle`);
	if (
		!/^[0-9a-f]{64}$/.test(bundle.sha256) ||
		!Number.isSafeInteger(bundle.bytes) ||
		bundle.bytes < 1
	) {
		throw new Error(`cell ${label} needs a complete bundle receipt.`);
	}
	return { sourceCommit: cell.sourceCommit, bundle };
}

function engineReceipts(samples, label) {
	const values = samples
		.filter((sample) => sample.cell === label)
		.map((sample) => JSON.stringify(object(sample.engine, `sample ${sample.ordinal} engine`)));
	const unique = [...new Set(values)];
	if (unique.length !== 1)
		throw new Error(`cell ${label} changed engine configuration within one session.`);
	return JSON.parse(unique[0]);
}

/** Re-judge one cold-launch AB/BA process-memory session without a device. */
export function analyzeIssue291NativeMemory(input, { reference, candidate }) {
	object(input, 'input');
	if (input.protocol !== INPUT_PROTOCOL) throw new Error('unexpected native device protocol.');
	if (typeof reference !== 'string' || typeof candidate !== 'string' || reference === candidate) {
		throw new Error('analysis requires distinct reference and candidate cell labels.');
	}
	const controls = object(input.controls, 'controls');
	if (
		controls.completionMode !== 'native-only' ||
		object(controls.processMemory, 'process-memory controls').postReceiptIsInstantaneousPeak !==
			false
	) {
		throw new Error('issue #291 memory analysis requires the Native-only non-peak sampling lane.');
	}
	if (
		!Array.isArray(controls.processMemory.sources) ||
		!['smaps_rollup', '/proc/status', 'dumpsys meminfo'].every((source) =>
			controls.processMemory.sources.includes(source),
		)
	) {
		throw new Error('issue #291 memory analysis requires all three Android accounting sources.');
	}
	if (
		!Number.isSafeInteger(controls.processMemory.settleMs) ||
		controls.processMemory.settleMs < 1
	) {
		throw new Error('issue #291 memory analysis requires a positive settle delay.');
	}
	const sequence = object(controls.interactionSequence, 'interaction sequence');
	if (!Number.isSafeInteger(sequence.cycles) || sequence.cycles < REQUIRED_CYCLES) {
		throw new Error(`issue #291 memory analysis requires at least ${REQUIRED_CYCLES} cycles.`);
	}
	if (!Array.isArray(sequence.steps) || sequence.steps.length !== sequence.cycles * 4 - 1) {
		throw new Error('issue #291 memory analysis requires the complete 4N-1 lifecycle recipe.');
	}
	const expectedSequence = issue194LifecycleSequence(sequence.cycles, {}, {}).map(
		({ cycle, phase, workload }) => ({ cycle, phase, workload }),
	);
	if (
		!sequence.steps.every((step, index) =>
			['cycle', 'phase', 'workload'].every(
				(field) => step[field] === expectedSequence[index][field],
			),
		)
	) {
		throw new Error('issue #291 memory analysis requires the registered lifecycle phase order.');
	}
	if (controls.coldLaunchPerSample !== true || !String(controls.ordering).includes('AB/BA')) {
		throw new Error('issue #291 memory analysis requires cold-launch AB/BA collection.');
	}
	if (Object.keys(object(input.cells, 'cells')).length !== 2) {
		throw new Error('issue #291 memory analysis requires exactly two cells in one session.');
	}
	const cells = {
		reference: cellReceipt(input, reference),
		candidate: cellReceipt(input, candidate),
	};
	if (!Array.isArray(input.samples) || input.samples.length % 2 !== 0) {
		throw new Error('issue #291 memory analysis requires complete adjacent sample pairs.');
	}
	const samples = input.samples.slice().sort((left, right) => left.ordinal - right.ordinal);
	const pairs = [];
	const orders = { 'reference-candidate': 0, 'candidate-reference': 0 };
	for (let index = 0; index < samples.length; index += 2) {
		const adjacent = samples.slice(index, index + 2);
		if (
			adjacent[0].ordinal !== index + 1 ||
			adjacent[1].ordinal !== index + 2 ||
			adjacent.some((sample) => sample.accepted !== true)
		) {
			throw new Error(`pair ${index / 2 + 1} is not a complete accepted adjacent session pair.`);
		}
		for (const sample of adjacent) {
			validateAcceptedSample(sample);
			validateSampleSequence(sample, sequence.steps, controls.processMemory.settleMs);
		}
		const referenceSample = adjacent.find((sample) => sample.cell === reference);
		const candidateSample = adjacent.find((sample) => sample.cell === candidate);
		if (referenceSample === undefined || candidateSample === undefined) {
			throw new Error(`pair ${index / 2 + 1} does not contain one sample from each cell.`);
		}
		const order = adjacent[0] === referenceSample ? 'reference-candidate' : 'candidate-reference';
		orders[order]++;
		pairs.push({
			pair: index / 2 + 1,
			order,
			reference: {
				ordinal: referenceSample.ordinal,
				metrics: {
					nativeHeapAllocKb: sampleMemory(referenceSample, 'nativeHeapAllocKb'),
					totalPssKb: sampleMemory(referenceSample, 'totalPssKb'),
					smapsPssKb: sampleMemory(referenceSample, 'smapsPssKb'),
				},
			},
			candidate: {
				ordinal: candidateSample.ordinal,
				metrics: {
					nativeHeapAllocKb: sampleMemory(candidateSample, 'nativeHeapAllocKb'),
					totalPssKb: sampleMemory(candidateSample, 'totalPssKb'),
					smapsPssKb: sampleMemory(candidateSample, 'smapsPssKb'),
				},
			},
		});
	}
	if (pairs.length < REQUIRED_PAIRS) {
		throw new Error(`issue #291 memory analysis requires at least ${REQUIRED_PAIRS} pairs.`);
	}
	if (Math.abs(orders['reference-candidate'] - orders['candidate-reference']) > 1) {
		throw new Error('issue #291 memory analysis requires balanced AB/BA pair order.');
	}

	const checkpoints = [
		'emptyBaseline',
		'operationalCreateHighWater',
		'settledPopulated',
		'afterClear',
	];
	const metrics = {};
	for (const [metricIndex, metric] of ['nativeHeapAllocKb', 'totalPssKb', 'smapsPssKb'].entries()) {
		metrics[metric] = Object.fromEntries(
			checkpoints.map((checkpoint, checkpointIndex) => [
				checkpoint,
				compareMetric(pairs, checkpoint, metric, metricIndex * 10 + checkpointIndex),
			]),
		);
	}
	const registered = metrics.nativeHeapAllocKb;
	const availableChecksPassed =
		registered.settledPopulated.nonInferiority.passed &&
		registered.afterClear.nonInferiority.passed;
	return {
		protocol: OUTPUT_PROTOCOL,
		question: input.question,
		createdAt: new Date().toISOString(),
		comparison: {
			reference: { label: reference, ...cells.reference },
			candidate: { label: candidate, ...cells.candidate },
		},
		device: input.device,
		engines: {
			reference: engineReceipts(samples, reference),
			candidate: engineReceipts(samples, candidate),
		},
		collection: {
			pairs: pairs.length,
			orders,
			cyclesPerSample: sequence.cycles,
			settleMs: controls.processMemory.settleMs,
			invalidAttempts: Array.isArray(input.invalidAttempts) ? input.invalidAttempts.length : null,
		},
		method: {
			pairing: 'adjacent cold-launch AB/BA sessions',
			aggregate: 'geometric mean of within-pair candidate/reference ratios',
			bootstrap: 'paired session-level percentile bootstrap',
			bootstrapRepetitions: BOOTSTRAP_REPETITIONS,
			bootstrapSeed: `${BOOTSTRAP_SEED} + metric/checkpoint ordinal`,
			nonInferiorityLimit: NON_INFERIORITY_LIMIT,
		},
		metrics,
		verdict: {
			availableChecksPassed,
			settledHeap: registered.settledPopulated.nonInferiority.passed ? 'pass' : 'fail',
			afterClearHeap: registered.afterClear.nonInferiority.passed ? 'pass' : 'fail',
			peakHeap: 'inconclusive',
			issue291MemoryGate: 'inconclusive',
			reason:
				'postReceipt is an operational high-water checkpoint after the Native ACK and second frame, not an instantaneous heap peak; this record cannot close the registered peak-heap requirement',
		},
		pairs,
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			input: { type: 'string' },
			reference: { type: 'string' },
			candidate: { type: 'string' },
			out: { type: 'string' },
		},
		strict: true,
	});
	for (const name of ['input', 'reference', 'candidate', 'out']) {
		if (values[name] === undefined) throw new Error(`missing --${name}.`);
	}
	const inputFile = path.resolve(values.input);
	const bytes = fs.readFileSync(inputFile);
	const report = analyzeIssue291NativeMemory(JSON.parse(bytes), {
		reference: values.reference,
		candidate: values.candidate,
	});
	report.input = {
		path: path.relative(process.cwd(), inputFile),
		bytes: bytes.length,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
	};
	await writeEvidenceJson(path.resolve(values.out), report);
	if (!report.verdict.availableChecksPassed) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
