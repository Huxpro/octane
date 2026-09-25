import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { writeEvidenceJson } from '../scripts/evidence.mjs';
import { issue194LifecycleSequence } from './issue194-device-protocol.mjs';

const INPUT_PROTOCOL = 'octane-issue194-device-v1';
const PEAK_INPUT_PROTOCOL = 'octane-issue291-native-heap-peak-v1';
const OUTPUT_PROTOCOL = 'octane-issue291-native-memory-comparison-v2';
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

function sameReceipt(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function androidMajor(release) {
	const match = String(release).match(/^\d+/);
	return match === null ? null : Number(match[0]);
}

function validatePeakEvidence(peak, input, samples, cells, reference, candidate) {
	object(peak, 'peak evidence');
	if (peak.protocol !== PEAK_INPUT_PROTOCOL) {
		throw new Error('unexpected native heap-peak protocol.');
	}
	const measurement = object(peak.measurement, 'peak measurement');
	if (
		measurement.source !== 'android.heapprofd' ||
		measurement.mode !== 'dump_at_max' ||
		measurement.dumpAtMax !== true ||
		measurement.fromStartup !== true ||
		measurement.profiledHeap !== 'libc.malloc' ||
		measurement.targetProcess !== 'com.lynx.explorer' ||
		measurement.profilePerturbsTiming !== true ||
		measurement.eligibleForLatencyHeadline !== false ||
		!Number.isSafeInteger(measurement.samplingIntervalBytes) ||
		measurement.samplingIntervalBytes < 1
	) {
		throw new Error('issue #291 peak evidence requires startup heapprofd dump_at_max controls.');
	}
	if (androidMajor(input.device?.android) < 11 || androidMajor(peak.device?.android) < 11) {
		throw new Error('heapprofd dump_at_max requires Android 11 or newer.');
	}
	if (!sameReceipt(peak.device, input.device)) {
		throw new Error('heap-peak evidence was not collected on the process-memory device.');
	}
	const sourceWindow = object(peak.sourceWindow, 'peak source window');
	if (
		sourceWindow.protocol !== input.protocol ||
		sourceWindow.question !== input.question ||
		sourceWindow.sampleCount !== samples.length ||
		!Number.isSafeInteger(sourceWindow.bytes) ||
		sourceWindow.bytes < 1 ||
		!/^[0-9a-f]{64}$/.test(sourceWindow.sha256)
	) {
		throw new Error('heap-peak evidence is not bound to this Native device window.');
	}
	const peakCells = object(sourceWindow.cells, 'peak source cells');
	if (
		!sameReceipt(peakCells[reference], cells.reference) ||
		!sameReceipt(peakCells[candidate], cells.candidate)
	) {
		throw new Error('heap-peak evidence disagrees with the measured cell receipts.');
	}
	if (!Array.isArray(peak.samples) || peak.samples.length !== samples.length) {
		throw new Error('heap-peak evidence needs one profile for every accepted sample.');
	}
	const traceProcessor = object(peak.traceProcessor, 'peak trace processor');
	if (
		!Number.isSafeInteger(traceProcessor.bytes) ||
		traceProcessor.bytes < 1 ||
		!/^[0-9a-f]{64}$/.test(traceProcessor.sha256) ||
		typeof traceProcessor.version !== 'string' ||
		traceProcessor.version === ''
	) {
		throw new Error('heap-peak evidence needs an immutable trace-processor receipt.');
	}
	if (!Array.isArray(peak.traces) || peak.traces.length === 0) {
		throw new Error('heap-peak evidence needs its raw trace receipts.');
	}
	const traceHashes = new Set();
	for (const trace of peak.traces) {
		if (
			!Number.isSafeInteger(trace.bytes) ||
			trace.bytes < 1 ||
			!/^[0-9a-f]{64}$/.test(trace.sha256)
		) {
			throw new Error('heap-peak evidence contains an incomplete trace receipt.');
		}
		traceHashes.add(trace.sha256);
	}
	const byOrdinal = new Map();
	for (const profile of peak.samples) {
		if (
			!Number.isSafeInteger(profile.ordinal) ||
			profile.ordinal < 1 ||
			byOrdinal.has(profile.ordinal)
		) {
			throw new Error('heap-peak sample ordinals must be unique positive integers.');
		}
		if (!traceHashes.has(profile.traceSha256)) {
			throw new Error(`heap-peak sample ${profile.ordinal} has no matching raw trace receipt.`);
		}
		const health = object(profile.producerHealth, `heap-peak sample ${profile.ordinal} health`);
		if (
			health.bufferOverran !== false ||
			health.bufferCorrupted !== false ||
			health.rejectedConcurrent !== false ||
			health.hitGuardrail !== false ||
			health.clientErrors !== 0 ||
			health.malformedPackets !== 0 ||
			health.missingPackets !== 0 ||
			health.nonFinalizedProfiles !== 0 ||
			health.samplingIntervalAdjustedBytes !== 0
		) {
			throw new Error(`heap-peak sample ${profile.ordinal} has incomplete producer evidence.`);
		}
		positive(profile.peakNativeHeapRequestedBytes, `heap-peak sample ${profile.ordinal}`);
		if (!Number.isSafeInteger(profile.peakNativeHeapRequestedBytes)) {
			throw new Error(`heap-peak sample ${profile.ordinal} byte count must be an integer.`);
		}
		if (
			!Number.isSafeInteger(profile.peakNativeHeapSampleCount) ||
			profile.peakNativeHeapSampleCount < 0
		) {
			throw new Error(`heap-peak sample ${profile.ordinal} needs a non-negative sample count.`);
		}
		byOrdinal.set(profile.ordinal, profile);
	}
	return samples.map((sample) => {
		const profile = byOrdinal.get(sample.ordinal);
		if (
			profile === undefined ||
			profile.cell !== sample.cell ||
			profile.pid !== sample.processMemory.pid
		) {
			throw new Error(`heap-peak sample ${sample.ordinal} is not bound to its fresh process.`);
		}
		return profile.peakNativeHeapRequestedBytes;
	});
}

/** Re-judge one cold-launch AB/BA process-memory session without a device. */
export function analyzeIssue291NativeMemory(input, { reference, candidate, peak = null }) {
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
	const processMemoryChecksPassed =
		registered.settledPopulated.nonInferiority.passed &&
		registered.afterClear.nonInferiority.passed;
	let peakComparison = null;
	if (peak !== null) {
		const peakValues = validatePeakEvidence(peak, input, samples, cells, reference, candidate);
		for (let index = 0; index < pairs.length; index++) {
			pairs[index].reference.metrics.nativeHeapRequestedPeakBytes = {
				peak: peakValues[pairs[index].reference.ordinal - 1],
			};
			pairs[index].candidate.metrics.nativeHeapRequestedPeakBytes = {
				peak: peakValues[pairs[index].candidate.ordinal - 1],
			};
		}
		peakComparison = compareMetric(pairs, 'peak', 'nativeHeapRequestedPeakBytes', 100);
		peakComparison.unit = 'bytes';
		metrics.nativeHeapRequestedPeakBytes = { peak: peakComparison };
	}
	const peakPassed = peakComparison?.nonInferiority.passed ?? null;
	const availableChecksPassed = processMemoryChecksPassed && peakPassed !== false;
	const issue291MemoryGate =
		peakPassed === null
			? 'inconclusive'
			: processMemoryChecksPassed && peakPassed
				? 'pass'
				: 'fail';
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
			peakHeap: peakPassed === null ? 'inconclusive' : peakPassed ? 'pass' : 'fail',
			issue291MemoryGate,
			reason:
				peakPassed === null
					? 'postReceipt is an operational high-water checkpoint after the Native ACK and second frame, not an instantaneous heap peak; this record cannot close the registered peak-heap requirement'
					: issue291MemoryGate === 'pass'
						? 'settled, after-clear, and heapprofd dump-at-max native heap checks satisfy the registered non-inferiority limit'
						: 'at least one registered native heap non-inferiority check exceeds the frozen limit',
		},
		pairs,
	};
}

async function main() {
	const { values } = parseArgs({
		options: {
			input: { type: 'string' },
			peak: { type: 'string' },
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
	const peakFile = values.peak === undefined ? null : path.resolve(values.peak);
	const peakBytes = peakFile === null ? null : fs.readFileSync(peakFile);
	const peak = peakBytes === null ? null : JSON.parse(peakBytes);
	if (
		peak !== null &&
		(object(peak.sourceWindow, 'peak source window').bytes !== bytes.length ||
			peak.sourceWindow.sha256 !== crypto.createHash('sha256').update(bytes).digest('hex'))
	) {
		throw new Error('heap-peak evidence does not match the raw Native device-window bytes.');
	}
	const report = analyzeIssue291NativeMemory(JSON.parse(bytes), {
		reference: values.reference,
		candidate: values.candidate,
		peak,
	});
	report.input = {
		path: path.relative(process.cwd(), inputFile),
		bytes: bytes.length,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
	};
	if (peakBytes !== null) {
		report.peakInput = {
			path: path.relative(process.cwd(), peakFile),
			bytes: peakBytes.length,
			sha256: crypto.createHash('sha256').update(peakBytes).digest('hex'),
		};
	}
	await writeEvidenceJson(path.resolve(values.out), report);
	if (!report.verdict.availableChecksPassed) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
