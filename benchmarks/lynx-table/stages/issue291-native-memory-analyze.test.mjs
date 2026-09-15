import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { issue194LifecycleSequence } from './issue194-device-protocol.mjs';
import {
	analyzeIssue291NativeMemory,
	pairedGeometricBootstrap,
} from './issue291-native-memory-analyze.mjs';

const sequence = issue194LifecycleSequence(20, { x: 100, y: 20 }, { x: 200, y: 20 }).map(
	({ cycle, phase, workload }) => ({ cycle, phase, workload }),
);

function checkpoint(multiplier, state) {
	const nativeHeapAlloc = (state === 'populated' ? 1000 : 500) * multiplier;
	const totalPss = (state === 'populated' ? 2000 : 1200) * multiplier;
	const smapsPss = (state === 'populated' ? 2100 : 1250) * multiplier;
	return {
		capturedAt: '2026-09-15T00:00:00.000Z',
		smapsRollupKb: {
			Rss: smapsPss + 100,
			Pss: smapsPss,
			Private_Clean: 100,
			Private_Dirty: smapsPss - 100,
		},
		statusKb: { VmRSS: smapsPss + 50 },
		dumpsysKb: {
			totalPss,
			totalPrivateDirty: totalPss - 100,
			totalPrivateClean: 100,
			totalSwapDirty: 0,
			nativePss: nativeHeapAlloc,
			nativePrivateDirty: nativeHeapAlloc,
			nativePrivateClean: 0,
			nativeHeapSize: nativeHeapAlloc + 100,
			nativeHeapAlloc,
			nativeHeapFree: 100,
			dalvikPss: 100,
			dalvikPrivateDirty: 100,
			dalvikPrivateClean: 0,
			dalvikHeapSize: 200,
			dalvikHeapAlloc: 100,
			dalvikHeapFree: 100,
		},
	};
}

function sample(ordinal, cell, multiplier, sessionFactor) {
	const factor = multiplier * sessionFactor;
	return {
		ordinal,
		cell,
		accepted: true,
		outcome: 'completed',
		thermalBefore: { batteryTemperatureTenthsC: 340, thermalStatus: 0 },
		devtool: { stayedDisabled: true },
		errors: [],
		engine: { appBundleEngine: cell === 'reference' ? '3.9' : '3.2', lynxSdk: '4.1' },
		sequenceEvidence: sequence.map((step, index) => ({ step: index + 1, ...step })),
		processMemory: {
			measurement: 'synthetic fixture',
			settleMs: 4000,
			pid: 1000 + ordinal,
			baseline: checkpoint(factor, 'empty'),
			steps: sequence.map((step, index) => ({
				step: index + 1,
				...step,
				postReceipt: checkpoint(
					factor * (step.workload === 'create' ? 1.02 : 1),
					step.workload === 'create' ? 'populated' : 'empty',
				),
				settled: checkpoint(factor, step.workload === 'create' ? 'populated' : 'empty'),
			})),
		},
	};
}

function input(candidateMultiplier = 1.04, pairs = 10) {
	const samples = [];
	const pattern = ['reference', 'candidate', 'candidate', 'reference'];
	const accepted = { reference: 0, candidate: 0 };
	for (let index = 0; accepted.reference < pairs || accepted.candidate < pairs; index++) {
		const cell = pattern[index % pattern.length];
		if (accepted[cell] >= pairs) continue;
		const pair = Math.floor(samples.length / 2);
		const multiplier = cell === 'reference' ? 1 : candidateMultiplier;
		samples.push(sample(samples.length + 1, cell, multiplier, 1 + pair / 100));
		accepted[cell]++;
	}
	return {
		protocol: 'octane-issue194-device-v1',
		question: 'is candidate memory non-inferior?',
		device: { model: 'fixture', android: '10' },
		controls: {
			completionMode: 'native-only',
			coldLaunchPerSample: true,
			ordering: 'AB/BA (A,B,B,A repeating)',
			processMemory: {
				settleMs: 4000,
				sources: ['smaps_rollup', '/proc/status', 'dumpsys meminfo'],
				postReceiptIsInstantaneousPeak: false,
			},
			interactionSequence: { cycles: 20, steps: sequence },
		},
		cells: {
			reference: {
				sourceCommit: 'a'.repeat(40),
				bundle: { bytes: 100, sha256: '1'.repeat(64) },
			},
			candidate: {
				sourceCommit: 'b'.repeat(40),
				bundle: { bytes: 101, sha256: '2'.repeat(64) },
			},
		},
		samples,
		invalidAttempts: [],
	};
}

function peakEvidence(window, candidateMultiplier = 1.04) {
	return {
		protocol: 'octane-issue291-native-heap-peak-v1',
		device: window.device,
		traceProcessor: {
			path: '/tmp/trace_processor_shell',
			bytes: 1000,
			sha256: 'e'.repeat(64),
			version: 'Perfetto fixture',
		},
		traces: [{ path: '/tmp/peak.pftrace', bytes: 2000, sha256: 'd'.repeat(64) }],
		measurement: {
			source: 'android.heapprofd',
			mode: 'dump_at_max',
			dumpAtMax: true,
			fromStartup: true,
			profiledHeap: 'libc.malloc',
			targetProcess: 'com.lynx.explorer',
			samplingIntervalBytes: 4096,
			profilePerturbsTiming: true,
			eligibleForLatencyHeadline: false,
		},
		sourceWindow: {
			protocol: window.protocol,
			question: window.question,
			sampleCount: window.samples.length,
			cells: Object.fromEntries(
				Object.entries(window.cells).map(([label, cell]) => [
					label,
					{ sourceCommit: cell.sourceCommit, bundle: cell.bundle },
				]),
			),
			bytes: 3000,
			sha256: 'f'.repeat(64),
		},
		samples: window.samples.map((entry) => ({
			ordinal: entry.ordinal,
			cell: entry.cell,
			pid: entry.processMemory.pid,
			peakNativeHeapRequestedBytes:
				1_000_000 * (entry.cell === 'candidate' ? candidateMultiplier : 1),
			peakNativeHeapSampleCount: 100,
			traceSha256: 'd'.repeat(64),
			producerHealth: {
				bufferOverran: false,
				bufferCorrupted: false,
				rejectedConcurrent: false,
				hitGuardrail: false,
				clientErrors: 0,
				malformedPackets: 0,
				missingPackets: 0,
				nonFinalizedProfiles: 0,
				samplingIntervalAdjustedBytes: 0,
			},
		})),
	};
}

test('issue #291 pairs AB/BA sessions and keeps peak heap explicitly inconclusive', () => {
	const report = analyzeIssue291NativeMemory(input(), {
		reference: 'reference',
		candidate: 'candidate',
	});
	assert.equal(report.protocol, 'octane-issue291-native-memory-comparison-v2');
	assert.equal(report.collection.pairs, 10);
	assert.deepEqual(report.collection.orders, {
		'reference-candidate': 5,
		'candidate-reference': 5,
	});
	assert.ok(
		Math.abs(report.metrics.nativeHeapAllocKb.settledPopulated.bootstrap.pointEstimate - 1.04) <
			1e-12,
	);
	assert.ok(
		Math.abs(report.metrics.nativeHeapAllocKb.afterClear.bootstrap.ci95.upper - 1.04) < 1e-12,
	);
	assert.equal(report.verdict.availableChecksPassed, true);
	assert.equal(report.verdict.peakHeap, 'inconclusive');
	assert.equal(report.verdict.issue291MemoryGate, 'inconclusive');
	assert.match(report.verdict.reason, /not an instantaneous heap peak/);
});

test('issue #291 fails the available non-inferiority checks above the frozen 1.05 limit', () => {
	const report = analyzeIssue291NativeMemory(input(1.06), {
		reference: 'reference',
		candidate: 'candidate',
	});
	assert.equal(report.metrics.nativeHeapAllocKb.settledPopulated.nonInferiority.limit, 1.05);
	assert.equal(report.verdict.availableChecksPassed, false);
	assert.equal(report.verdict.settledHeap, 'fail');
	assert.equal(report.verdict.afterClearHeap, 'fail');
});

test('issue #291 closes the memory gate only with bound Android 11 dump-at-max evidence', () => {
	const window = input();
	window.device.android = '11';
	const report = analyzeIssue291NativeMemory(window, {
		reference: 'reference',
		candidate: 'candidate',
		peak: peakEvidence(window),
	});
	assert.equal(report.metrics.nativeHeapRequestedPeakBytes.peak.unit, 'bytes');
	assert.ok(
		Math.abs(report.metrics.nativeHeapRequestedPeakBytes.peak.bootstrap.ci95.upper - 1.04) < 1e-12,
	);
	assert.equal(report.verdict.peakHeap, 'pass');
	assert.equal(report.verdict.issue291MemoryGate, 'pass');
});

test('issue #291 fails a measured peak and rejects unsupported or unhealthy peak evidence', () => {
	const window = input();
	window.device.android = '11';
	const failed = analyzeIssue291NativeMemory(window, {
		reference: 'reference',
		candidate: 'candidate',
		peak: peakEvidence(window, 1.06),
	});
	assert.equal(failed.verdict.availableChecksPassed, false);
	assert.equal(failed.verdict.peakHeap, 'fail');
	assert.equal(failed.verdict.issue291MemoryGate, 'fail');

	const androidTen = input();
	assert.throws(
		() =>
			analyzeIssue291NativeMemory(androidTen, {
				reference: 'reference',
				candidate: 'candidate',
				peak: peakEvidence(androidTen),
			}),
		/Android 11 or newer/,
	);
	const unhealthy = peakEvidence(window);
	unhealthy.samples[0].producerHealth.bufferOverran = true;
	assert.throws(
		() =>
			analyzeIssue291NativeMemory(window, {
				reference: 'reference',
				candidate: 'candidate',
				peak: unhealthy,
			}),
		/incomplete producer evidence/,
	);
});

test('issue #291 refuses too few pairs and an incomplete claimed lifecycle', () => {
	assert.throws(
		() =>
			analyzeIssue291NativeMemory(input(1.01, 9), {
				reference: 'reference',
				candidate: 'candidate',
			}),
		/at least 10 pairs/,
	);
	const incomplete = input();
	incomplete.samples[0].processMemory.steps.pop();
	assert.throws(
		() =>
			analyzeIssue291NativeMemory(incomplete, {
				reference: 'reference',
				candidate: 'candidate',
			}),
		/complete lifecycle sequence/,
	);
});

test('paired geometric bootstrap is deterministic and resamples whole pair ratios', () => {
	const first = pairedGeometricBootstrap([0.9, 1, 1.1, 1.2], {
		repetitions: 2000,
		seed: 42,
	});
	const second = pairedGeometricBootstrap([0.9, 1, 1.1, 1.2], {
		repetitions: 2000,
		seed: 42,
	});
	assert.deepEqual(first, second);
	assert.equal(first.n, 4);
	assert.equal(first.repetitions, 2000);
	assert.ok(first.ci95.lower <= first.pointEstimate);
	assert.ok(first.ci95.upper >= first.pointEstimate);
});

function collectorArgs() {
	return [
		new URL('./issue194-device-run.mjs', import.meta.url).pathname,
		'--serial',
		'fixture',
		'--disable-url',
		'http://127.0.0.1/disable.lynx.bundle',
		'--disable-file',
		'missing-disable.lynx.bundle',
		'--out',
		'missing-output.json',
		'--question',
		'fixture',
		'--scale',
		'1000',
		'--samples',
		'10',
		'--timeout-ms',
		'600000',
		'--workload',
		'create',
		'--tap-x',
		'1',
		'--tap-y',
		'1',
		'--clear-tap-x',
		'2',
		'--clear-tap-y',
		'2',
		'--create-clear-recreate',
		'--sequence-cycles',
		'20',
		'--native-only',
		'--process-memory',
		'--cell',
		'reference=http://127.0.0.1/reference.lynx.bundle',
		'--cell',
		'candidate=http://127.0.0.1/candidate.lynx.bundle',
	];
}

test('the process-memory collector refuses cells without exact source provenance before ADB', () => {
	const result = spawnSync(process.execPath, collectorArgs(), { encoding: 'utf8' });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /requires one --cell-commit/);
	assert.doesNotMatch(result.stderr, /adb/);
});

test('the process-memory collector pauses only on complete checkpointed cell groups', () => {
	const identified = [
		...collectorArgs(),
		'--cell-commit',
		`reference=${'a'.repeat(40)}`,
		'--cell-commit',
		`candidate=${'b'.repeat(40)}`,
	];
	const splitPair = spawnSync(
		process.execPath,
		[...identified, '--checkpoint', 'fixture-checkpoint.json', '--max-new-samples', '1'],
		{ encoding: 'utf8' },
	);
	assert.notEqual(splitPair.status, 0);
	assert.match(splitPair.stderr, /preserving complete cell groups/);
	assert.doesNotMatch(splitPair.stderr, /adb/);

	const noCheckpoint = spawnSync(process.execPath, [...identified, '--max-new-samples', '2'], {
		encoding: 'utf8',
	});
	assert.notEqual(noCheckpoint.status, 0);
	assert.match(noCheckpoint.stderr, /requires --checkpoint/);
	assert.doesNotMatch(noCheckpoint.stderr, /adb/);
});
