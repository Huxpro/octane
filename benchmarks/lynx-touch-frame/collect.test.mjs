import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

import {
	CollectionState,
	collectFromLines,
	createCollectionPlan,
	parseCollectorLine,
} from './collect.mjs';
import { createFormalSchedule } from './schedule.mjs';

function metadata() {
	return {
		windowId: 'android-window-001',
		protocolIssue: 'Huxpro/octane#197',
		devTool: 'off',
		timingClock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
		deviceModel: 'physical-test-device',
		osVersion: 'Android test',
		lynxSdkVersion: 'test-sdk',
		lepusVersion: 'test-lepus',
		platformClockCalibration: {
			source: 'android.os.System.currentTimeMillis/SystemClock.uptimeMillis',
			startSelected: { bootEpochMs: 900 },
		},
		loadControl: { element: 'scroll-view', autoScrollRatePxPerSecond: 120 },
	};
}

function fixtureRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue197-collector-'));
	for (const step of createFormalSchedule(1)) {
		let directory;
		if (step.topology === 'T0') directory = path.join(root, 'raw-t0', 'dist', `T0-${step.load}`);
		else if (step.topology === 'T1')
			directory = path.join(root, 'react', 'dist', `T1-${step.load}`);
		else directory = path.join(root, 'octane', 'dist', `${step.topology}-${step.load}`);
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(path.join(directory, `${step.shape}.lynx.bundle`), JSON.stringify(step));
	}
	return root;
}

function sampleLine(step, sequence = step.sequence) {
	const input = 1000 + sequence * 20;
	return `08-26 I/Lynx: ISSUE197_SAMPLE ${JSON.stringify({
		topology: step.topology,
		shape: step.shape,
		load: step.load,
		inputPlatformTimestamp: input,
		changedVsyncPlatformTimestamp: input - 900 + 9,
		changedFrameOrdinal: 1,
		clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
		observer: 'mts-capture-touchstart-raf-predicate',
	})}`;
}

test('builds a complete plan with immutable bundle hashes and per-touch reloads', () => {
	const plan = createCollectionPlan(metadata(), 1, fixtureRoot());
	assert.equal(plan.steps.length, 48);
	for (const step of plan.steps) {
		assert.match(step.bundleSha256, /^[a-f0-9]{64}$/);
		assert.equal(step.reloadBundleBeforeTouch, true);
	}
});

test('parses prefixed logcat samples and ignores unrelated lines', () => {
	assert.equal(parseCollectorLine('I unrelated'), null);
	const parsed = parseCollectorLine(sampleLine(createFormalSchedule(1)[0]));
	assert.equal(parsed.topology, 'T0');
	assert.throws(
		() => parseCollectorLine('E ISSUE197_OBSERVER_FAILURE predicate unchanged'),
		/predicate unchanged/,
	);
});

test('enriches an exact schedule and rejects completion with missing samples', () => {
	const plan = createCollectionPlan(metadata(), 1, fixtureRoot());
	const lines = plan.steps.map((step) => sampleLine(step));
	const record = collectFromLines(plan, ['noise', ...lines]);
	assert.equal(record.samples.length, 48);
	assert.equal(record.samples[0].deviceModel, metadata().deviceModel);
	assert.equal(record.samples[0].bundleSha256, plan.steps[0].bundleSha256);

	const incomplete = new CollectionState(plan);
	incomplete.acceptLine(lines[0]);
	assert.throws(() => incomplete.finish(), /incomplete/);
});

test('rejects an out-of-order sample and a second sample after the schedule', () => {
	const plan = createCollectionPlan(metadata(), 1, fixtureRoot());
	const state = new CollectionState(plan);
	assert.throws(() => state.acceptLine(sampleLine(plan.steps[1])), /expected topology=T0/);

	for (const step of plan.steps) state.acceptLine(sampleLine(step));
	assert.throws(() => state.acceptLine(sampleLine(plan.steps.at(-1))), /after.*completed/);
});
