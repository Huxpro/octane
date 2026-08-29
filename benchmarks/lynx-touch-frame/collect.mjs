import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFormalSchedule } from './schedule.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_MARKER = 'ISSUE197_SAMPLE ';
const FAILURE_MARKER = 'ISSUE197_OBSERVER_FAILURE ';
const REQUIRED_CLOCK = 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration';
const REQUIRED_OBSERVER = 'mts-capture-touchstart-raf-predicate';

function fail(message) {
	throw new Error(`issue #197 collector: ${message}`);
}

function requiredString(value, label) {
	if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty`);
	return value;
}

function bundlePath(step, root = here) {
	const file = `${step.shape}.lynx.bundle`;
	if (step.topology === 'T0') {
		return path.join(root, 'raw-t0', 'dist', `T0-${step.load}`, file);
	}
	if (step.topology === 'T1') {
		return path.join(root, 'react', 'dist', `T1-${step.load}`, file);
	}
	return path.join(root, 'octane', 'dist', `${step.topology}-${step.load}`, file);
}

function sha256(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function validateMetadata(metadata) {
	if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
		fail('metadata must be an object');
	}
	for (const field of ['windowId', 'deviceModel', 'osVersion', 'lynxSdkVersion', 'lepusVersion']) {
		requiredString(metadata[field], `metadata.${field}`);
	}
	if (metadata.protocolIssue !== 'Huxpro/octane#197') {
		fail('metadata.protocolIssue must be Huxpro/octane#197');
	}
	if (metadata.devTool !== 'off') fail('metadata.devTool must be off');
	if (metadata.timingClock !== REQUIRED_CLOCK) {
		fail(`metadata.timingClock must be ${REQUIRED_CLOCK}`);
	}
	if (
		metadata.platformClockCalibration?.source !==
			'android.os.System.currentTimeMillis/SystemClock.uptimeMillis' ||
		!Number.isFinite(metadata.platformClockCalibration?.startSelected?.bootEpochMs)
	) {
		fail('metadata.platformClockCalibration must retain an Android platform clock pair');
	}
	if (
		metadata.loadControl?.element !== 'scroll-view' ||
		metadata.loadControl?.autoScrollRatePxPerSecond !== 120
	) {
		fail('metadata.loadControl must name scroll-view at 120 px/s');
	}
	return metadata;
}

export function createCollectionPlan(metadata, pairCount = 8, root = here) {
	validateMetadata(metadata);
	const steps = createFormalSchedule(pairCount).map((entry) => {
		const absoluteBundlePath = bundlePath(entry, root);
		if (!fs.existsSync(absoluteBundlePath)) {
			fail(`missing bundle for sequence ${entry.sequence}: ${absoluteBundlePath}`);
		}
		return {
			...entry,
			bundlePath: path.relative(root, absoluteBundlePath).split(path.sep).join('/'),
			bundleSha256: sha256(absoluteBundlePath),
			reloadBundleBeforeTouch: true,
			settleCondition:
				entry.load === 'sustained-scroll' ? 'native-auto-scroll-active' : 'idle-tree-stable',
		};
	});
	return { meta: structuredClone(metadata), steps };
}

export function parseCollectorLine(line) {
	if (typeof line !== 'string') fail('log line must be a string');
	const failureAt = line.indexOf(FAILURE_MARKER);
	if (failureAt !== -1) fail(line.slice(failureAt + FAILURE_MARKER.length).trim());
	const sampleAt = line.indexOf(SAMPLE_MARKER);
	if (sampleAt === -1) return null;
	const payload = line.slice(sampleAt + SAMPLE_MARKER.length).trim();
	try {
		return JSON.parse(payload);
	} catch (error) {
		fail(`malformed sample JSON: ${error.message}`);
	}
}

export class CollectionState {
	#plan;
	#samples = [];

	constructor(plan) {
		if (!Array.isArray(plan?.steps) || plan.steps.length === 0) fail('plan.steps are required');
		validateMetadata(plan.meta);
		this.#plan = structuredClone(plan);
	}

	get nextStep() {
		return this.#plan.steps[this.#samples.length] ?? null;
	}

	get completedSampleCount() {
		return this.#samples.length;
	}

	acceptLine(line) {
		const raw = parseCollectorLine(line);
		if (raw === null) return false;
		const expected = this.nextStep;
		if (expected === null) fail('received a sample after the formal schedule completed');
		for (const field of ['topology', 'shape', 'load']) {
			if (raw[field] !== expected[field]) {
				fail(
					`sequence ${expected.sequence} expected ${field}=${expected[field]}, received ${raw[field]}`,
				);
			}
		}
		if (raw.clock !== REQUIRED_CLOCK) fail('sample used a non-platform timing clock');
		if (raw.observer !== REQUIRED_OBSERVER) fail('sample used a different observation boundary');
		const input = raw.inputPlatformTimestamp;
		const vsync = raw.changedVsyncPlatformTimestamp;
		if (!Number.isFinite(input) || !Number.isFinite(vsync)) {
			fail('sample has an invalid retained platform timestamp pair');
		}
		const bootEpochCalibrationMs =
			this.#plan.meta.platformClockCalibration.startSelected.bootEpochMs;
		const inputUptimePlatformTimestamp = input - bootEpochCalibrationMs;
		const latencyMs = vsync - inputUptimePlatformTimestamp;
		if (!Number.isFinite(latencyMs) || latencyMs < 0) {
			fail('sample has a negative calibrated platform latency');
		}
		if (!Number.isSafeInteger(raw.changedFrameOrdinal) || raw.changedFrameOrdinal < 1) {
			fail('sample changedFrameOrdinal must be a positive safe integer');
		}

		const meta = this.#plan.meta;
		this.#samples.push({
			sequence: expected.sequence,
			shape: expected.shape,
			load: expected.load,
			pair: expected.pair,
			direction: expected.direction,
			position: expected.position,
			topology: expected.topology,
			windowId: meta.windowId,
			inputPlatformTimestamp: input,
			changedVsyncPlatformTimestamp: vsync,
			inputUptimePlatformTimestamp,
			bootEpochCalibrationMs,
			latencyMs,
			changedFrameOrdinal: raw.changedFrameOrdinal,
			clock: raw.clock,
			observer: raw.observer,
			deviceModel: meta.deviceModel,
			osVersion: meta.osVersion,
			lynxSdkVersion: meta.lynxSdkVersion,
			lepusVersion: meta.lepusVersion,
			bundleSha256: expected.bundleSha256,
			devTool: meta.devTool,
		});
		return true;
	}

	finish() {
		if (this.nextStep !== null) {
			fail(
				`measurement window incomplete: received ${this.#samples.length}/${this.#plan.steps.length} samples`,
			);
		}
		return { meta: structuredClone(this.#plan.meta), samples: structuredClone(this.#samples) };
	}
}

export function collectFromLines(plan, lines) {
	const state = new CollectionState(plan);
	for (const line of lines) state.acceptLine(line);
	return state.finish();
}

function usage() {
	return [
		'usage:',
		'  node collect.mjs plan <metadata.json> <plan.json>',
		'  node collect.mjs ingest <plan.json> <logcat.txt> <window.json>',
	].join('\n');
}

function main(argv) {
	const [command, input, second, third] = argv.slice(2);
	if (command === 'plan' && input !== undefined && second !== undefined && third === undefined) {
		const metadata = JSON.parse(fs.readFileSync(input, 'utf8'));
		fs.writeFileSync(second, `${JSON.stringify(createCollectionPlan(metadata), null, 2)}\n`);
		return;
	}
	if (command === 'ingest' && input !== undefined && second !== undefined && third !== undefined) {
		const plan = JSON.parse(fs.readFileSync(input, 'utf8'));
		const lines = fs.readFileSync(second, 'utf8').split(/\r?\n/);
		const record = collectFromLines(plan, lines);
		fs.writeFileSync(third, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
		return;
	}
	process.stderr.write(`${usage()}\n`);
	process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) main(process.argv);
