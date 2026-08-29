import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { LOADS, SHAPES, TOPOLOGIES, createFormalSchedule } from './schedule.mjs';

const REQUIRED_CLOCK = 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration';
const FORBIDDEN_CLOCK_PATTERNS = [/date\.now/i, /performance\.now/i, /script.?clock/i];
const MIN_SAMPLES = 15;
const LATENCY_EPSILON_MS = 0.01;

function fail(message) {
	throw new Error(`invalid issue #197 result: ${message}`);
}

function finite(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`);
	return value;
}

function nonEmpty(value, label) {
	if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty`);
	return value;
}

function cellKey(sample) {
	return `${sample.topology}/${sample.shape}/${sample.load}`;
}

function quantileType7(sorted, probability) {
	if (sorted.length === 0) fail('cannot calculate a quantile of an empty sample');
	if (sorted.length === 1) return sorted[0];
	const position = (sorted.length - 1) * probability;
	const lower = Math.floor(position);
	const fraction = position - lower;
	return (
		sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower])
	);
}

function validateMeta(meta) {
	if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) fail('meta is required');
	nonEmpty(meta.windowId, 'meta.windowId');
	nonEmpty(meta.protocolIssue, 'meta.protocolIssue');
	if (meta.protocolIssue !== 'Huxpro/octane#197') fail('meta.protocolIssue must name #197');
	if (meta.devTool !== 'off') fail('meta.devTool must be "off"');
	if (meta.timingClock !== REQUIRED_CLOCK) {
		fail(`meta.timingClock must be ${JSON.stringify(REQUIRED_CLOCK)}`);
	}
	for (const pattern of FORBIDDEN_CLOCK_PATTERNS) {
		if (pattern.test(JSON.stringify(meta))) fail(`meta names forbidden timing source ${pattern}`);
	}
	if (
		meta.platformClockCalibration?.source !==
		'android.os.System.currentTimeMillis/SystemClock.uptimeMillis'
	) {
		fail('meta.platformClockCalibration must name the Android platform clocks');
	}
	finite(
		meta.platformClockCalibration?.startSelected?.bootEpochMs,
		'meta.platformClockCalibration.startSelected.bootEpochMs',
	);
	finite(
		meta.platformClockCalibration?.endSelected?.bootEpochMs,
		'meta.platformClockCalibration.endSelected.bootEpochMs',
	);
	finite(meta.loadControl?.autoScrollRatePxPerSecond, 'meta.loadControl.autoScrollRatePxPerSecond');
	if (meta.loadControl?.element !== 'scroll-view') fail('load control must name scroll-view');
	return meta;
}

function validateSample(sample, index, meta) {
	const label = `samples[${index}]`;
	if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
		fail(`${label} must be an object`);
	}
	if (!TOPOLOGIES.includes(sample.topology)) fail(`${label}.topology is unknown`);
	if (!SHAPES.includes(sample.shape)) fail(`${label}.shape is unknown`);
	if (!LOADS.includes(sample.load)) fail(`${label}.load is unknown`);
	if (sample.windowId !== meta.windowId) fail(`${label}.windowId crosses measurement windows`);
	if (!Number.isSafeInteger(sample.sequence) || sample.sequence < 0) {
		fail(`${label}.sequence must be a non-negative safe integer`);
	}
	if (!Number.isSafeInteger(sample.pair) || sample.pair < 0) fail(`${label}.pair is invalid`);
	if (!['AB', 'BA'].includes(sample.direction)) fail(`${label}.direction must be AB or BA`);
	if (!Number.isSafeInteger(sample.position) || sample.position < 0 || sample.position > 3) {
		fail(`${label}.position is invalid`);
	}

	const input = finite(sample.inputPlatformTimestamp, `${label}.inputPlatformTimestamp`);
	const vsync = finite(
		sample.changedVsyncPlatformTimestamp,
		`${label}.changedVsyncPlatformTimestamp`,
	);
	const latency = finite(sample.latencyMs, `${label}.latencyMs`);
	const bootEpoch = finite(sample.bootEpochCalibrationMs, `${label}.bootEpochCalibrationMs`);
	const inputUptime = finite(
		sample.inputUptimePlatformTimestamp,
		`${label}.inputUptimePlatformTimestamp`,
	);
	if (Math.abs(input - bootEpoch - inputUptime) > LATENCY_EPSILON_MS) {
		fail(`${label}.inputUptimePlatformTimestamp does not match its platform calibration`);
	}
	if (Math.abs(vsync - inputUptime - latency) > LATENCY_EPSILON_MS) {
		fail(`${label}.latencyMs does not equal the calibrated platform timestamp delta`);
	}
	if (latency < 0) fail(`${label}.latencyMs is negative`);
	if (!Number.isSafeInteger(sample.changedFrameOrdinal) || sample.changedFrameOrdinal < 1) {
		fail(`${label}.changedFrameOrdinal must be at least one`);
	}
	if (sample.clock !== REQUIRED_CLOCK) fail(`${label}.clock is not the protocol clock`);

	for (const field of ['deviceModel', 'osVersion', 'lynxSdkVersion', 'lepusVersion']) {
		nonEmpty(sample[field], `${label}.${field}`);
	}
	nonEmpty(sample.bundleSha256, `${label}.bundleSha256`);
	if (!/^[a-f0-9]{64}$/.test(sample.bundleSha256)) fail(`${label}.bundleSha256 is not SHA-256`);
	if (sample.devTool !== 'off') fail(`${label}.devTool must be "off"`);
	if (sample.observer !== 'mts-capture-touchstart-raf-predicate') {
		fail(`${label}.observer is not the shared MTS observer`);
	}
	return sample;
}

function validateSchedule(samples) {
	const pairs = Math.max(...samples.map((sample) => sample.pair)) + 1;
	const expected = createFormalSchedule(pairs);
	if (samples.length !== expected.length) {
		fail(`schedule has ${samples.length} records; expected ${expected.length} for ${pairs} pairs`);
	}
	const ordered = [...samples].sort((a, b) => a.sequence - b.sequence);
	for (let index = 0; index < expected.length; index += 1) {
		const actual = ordered[index];
		const wanted = expected[index];
		for (const field of [
			'sequence',
			'shape',
			'load',
			'pair',
			'direction',
			'position',
			'topology',
		]) {
			if (actual[field] !== wanted[field]) {
				fail(
					`schedule mismatch at sequence ${index}: ${field}=${actual[field]}, expected ${wanted[field]}`,
				);
			}
		}
	}
}

export function analyzeResult(record) {
	const meta = validateMeta(record?.meta);
	if (!Array.isArray(record.samples) || record.samples.length === 0) fail('samples are required');
	const samples = record.samples.map((sample, index) => validateSample(sample, index, meta));
	validateSchedule(samples);

	const cells = new Map();
	for (const sample of samples) {
		const key = cellKey(sample);
		const cell = cells.get(key) ?? [];
		cell.push(sample.latencyMs);
		cells.set(key, cell);
	}

	const distributions = [];
	for (const topology of TOPOLOGIES) {
		for (const shape of SHAPES) {
			for (const load of LOADS) {
				const key = `${topology}/${shape}/${load}`;
				const values = cells.get(key);
				if (values === undefined) fail(`missing matrix cell ${key}`);
				if (values.length < MIN_SAMPLES)
					fail(`${key} has n=${values.length}; n>=${MIN_SAMPLES} required`);
				const sorted = [...values].sort((a, b) => a - b);
				distributions.push({
					topology,
					shape,
					load,
					n: sorted.length,
					min: sorted[0],
					p50: quantileType7(sorted, 0.5),
					p90: quantileType7(sorted, 0.9),
					p99: quantileType7(sorted, 0.99),
					max: sorted.at(-1),
					samples: sorted,
				});
			}
		}
	}

	return { meta, distributions };
}

function main(argv) {
	const input = argv[2];
	if (input === undefined) {
		process.stderr.write('usage: node analyze.mjs <window.json> [report.json]\n');
		process.exitCode = 1;
		return;
	}
	const record = JSON.parse(fs.readFileSync(input, 'utf8'));
	const report = analyzeResult(record);
	const output = `${JSON.stringify(report, null, 2)}\n`;
	if (argv[3] === undefined) process.stdout.write(output);
	else fs.writeFileSync(argv[3], output);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) main(process.argv);
