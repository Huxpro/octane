import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeResult } from './analyze.mjs';
import { createFormalSchedule } from './schedule.mjs';

function validRecord(pairCount = 8) {
	return {
		meta: {
			windowId: 'device-window-001',
			protocolIssue: 'Huxpro/octane#197',
			devTool: 'off',
			timingClock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
			platformClockCalibration: {
				source: 'android.os.System.currentTimeMillis/SystemClock.uptimeMillis',
				startSelected: { bootEpochMs: 900 },
				endSelected: { bootEpochMs: 900 },
			},
			loadControl: { element: 'scroll-view', autoScrollRatePxPerSecond: 120 },
		},
		samples: createFormalSchedule(pairCount).map((entry) => {
			const input = 1000 + entry.sequence * 20;
			const latency = 8 + (entry.sequence % 5);
			const inputUptime = input - 900;
			return {
				...entry,
				windowId: 'device-window-001',
				inputPlatformTimestamp: input,
				changedVsyncPlatformTimestamp: inputUptime + latency,
				inputUptimePlatformTimestamp: inputUptime,
				bootEpochCalibrationMs: 900,
				latencyMs: latency,
				changedFrameOrdinal: 1,
				clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
				deviceModel: 'test-device',
				osVersion: 'Android test',
				lynxSdkVersion: 'test-sdk',
				lepusVersion: 'test-lepus',
				bundleSha256: 'a'.repeat(64),
				devTool: 'off',
				observer: 'mts-capture-touchstart-raf-predicate',
			};
		}),
	};
}

test('accepts the formal 24-cell matrix and retains full distributions', () => {
	const result = analyzeResult(validRecord());
	assert.equal(result.distributions.length, 24);
	for (const cell of result.distributions) {
		assert.equal(cell.n, 16);
		assert.equal(cell.samples.length, 16);
		assert.ok(cell.min <= cell.p50);
		assert.ok(cell.p50 <= cell.p90);
		assert.ok(cell.p90 <= cell.p99);
		assert.ok(cell.p99 <= cell.max);
	}
});

test('rejects n below the protocol minimum', () => {
	assert.throws(() => analyzeResult(validRecord(7)), /n=14; n>=15 required/);
});

test('rejects a script clock even when the numeric delta is plausible', () => {
	const record = validRecord();
	record.meta.timingClock = 'performance.now';
	assert.throws(() => analyzeResult(record), /timingClock/);
});

test('rejects latency not derived from the retained platform timestamp pair', () => {
	const record = validRecord();
	record.samples[17].latencyMs += 1;
	assert.throws(() => analyzeResult(record), /does not equal/);
});

test('rejects an order that is not the declared forward/reverse pair', () => {
	const record = validRecord();
	[record.samples[0].topology, record.samples[1].topology] = [
		record.samples[1].topology,
		record.samples[0].topology,
	];
	assert.throws(() => analyzeResult(record), /schedule mismatch/);
});
