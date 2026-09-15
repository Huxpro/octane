import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectIssue291NativeHeapPeak,
	issue291HeapPeakTraceSql,
	parseIssue291HeapPeakRows,
	parseIssue291HeapPeakTraceSpec,
} from './issue291-native-heap-peak-collect.mjs';
import {
	issue291NativeHeapPeakConfig,
	validateIssue291NativeHeapPeakCapability,
} from './issue291-native-heap-peak-run.mjs';

function input(android = '11') {
	return {
		protocol: 'octane-issue194-device-v1',
		question: 'is candidate peak heap non-inferior?',
		device: {
			model: 'fixture',
			product: 'fixture',
			android,
			fingerprint: 'fixture/fingerprint',
			abi: 'arm64-v8a',
			explorer: 'fixture',
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
		samples: ['reference', 'candidate', 'candidate', 'reference'].map((cell, index) => ({
			ordinal: index + 1,
			cell,
			accepted: true,
			processMemory: { pid: 2000 + index },
		})),
	};
}

function row(pid, multiplier = 1) {
	return {
		profileId: pid,
		upid: pid + 100,
		pid,
		processName: 'com.lynx.explorer',
		processStartNs: pid * 1000,
		profileStartNs: pid * 1000,
		profileEndNs: pid * 1000 + 999,
		heapName: 'libc.malloc',
		peakNativeHeapRequestedBytes: 1_000_000 * multiplier,
		peakNativeHeapSampleCount: 100,
		minimumAllocationSize: 4096,
		bufferCorrupted: 0,
		hitGuardrail: 0,
		bufferOverran: 0,
		clientErrors: 0,
		malformedPackets: 0,
		missingPackets: 0,
		rejectedConcurrent: 0,
		nonFinalizedProfiles: 0,
		samplingIntervalAdjustedBytes: 0,
	};
}

function batch(firstOrdinal = 1, lastOrdinal = 4) {
	return {
		firstOrdinal,
		lastOrdinal,
		rows: Array.from({ length: lastOrdinal - firstOrdinal + 1 }, (_, index) => {
			const ordinal = firstOrdinal + index;
			return row(1999 + ordinal, ordinal === 2 || ordinal === 3 ? 1.04 : 1);
		}),
		modeEvidence: {
			selfMaxFields: 20,
			selfAllocatedFields: 0,
			selfFreedFields: 0,
			fromStartupTrueFields: lastOrdinal - firstOrdinal + 1,
			fromStartupFalseFields: 0,
		},
		trace: {
			path: `/tmp/${firstOrdinal}-${lastOrdinal}.pftrace`,
			bytes: 1000,
			sha256: String(firstOrdinal).repeat(64).slice(0, 64),
		},
	};
}

const inputReceipt = { path: '/tmp/window.json', bytes: 999, sha256: 'f'.repeat(64) };
const toolReceipt = {
	path: '/tmp/trace_processor_shell',
	bytes: 1000,
	sha256: 'e'.repeat(64),
	version: 'Perfetto fixture',
};

test('issue #291 parses explicit trace ranges and emits loss-aware Perfetto SQL', () => {
	assert.deepEqual(parseIssue291HeapPeakTraceSpec('2-5=relative.pftrace'), {
		firstOrdinal: 2,
		lastOrdinal: 5,
		file: new URL('relative.pftrace', `file://${process.cwd()}/`).pathname,
	});
	assert.throws(() => parseIssue291HeapPeakTraceSpec('5-2=/tmp/a'), /ascending/);
	const sql = issue291HeapPeakTraceSql();
	assert.match(sql, /heapprofd_buffer_overran/);
	assert.match(sql, /heapprofd_non_finalized_profile/);
	assert.match(sql, /SUM\(a\.size\)/);
});

test('issue #291 builds a detached-file dump-at-max config and gates Android capability', () => {
	const config = issue291NativeHeapPeakConfig(60_000);
	assert.match(config, /write_into_file: true/);
	assert.match(config, /fill_policy: RING_BUFFER/);
	assert.match(config, /flush_period_ms: 2500/);
	assert.match(config, /process_cmdline: "com\.lynx\.explorer"/);
	assert.match(config, /sampling_interval_bytes: 4096/);
	assert.match(config, /block_client: false/);
	assert.match(config, /dump_at_max: true/);
	assert.doesNotThrow(() =>
		validateIssue291NativeHeapPeakCapability(
			'11',
			'data_sources { descriptor { name: "android.heapprofd" } }',
		),
	);
	assert.throws(
		() =>
			validateIssue291NativeHeapPeakCapability(
				'10',
				'data_sources { descriptor { name: "android.heapprofd" } }',
			),
		/Android 11 or newer/,
	);
	assert.throws(
		() => validateIssue291NativeHeapPeakCapability('12', 'data_sources: []'),
		/does not advertise/,
	);
});

test('issue #291 decodes trace-processor rows without CSV quoting ambiguity', () => {
	const value = row(2000);
	const hex = Buffer.from(JSON.stringify(value)).toString('hex').toUpperCase();
	assert.deepEqual(parseIssue291HeapPeakRows(`"row_hex"\n${hex}\n`), [value]);
	assert.throws(() => parseIssue291HeapPeakRows('wrong\n00'), /row_hex/);
});

test('issue #291 binds every dump-at-max process to the exact Native sample', () => {
	const report = collectIssue291NativeHeapPeak(input(), [batch()], inputReceipt, toolReceipt);
	assert.equal(report.protocol, 'octane-issue291-native-heap-peak-v1');
	assert.equal(report.measurement.mode, 'dump_at_max');
	assert.equal(report.measurement.eligibleForLatencyHeadline, false);
	assert.deepEqual(
		report.samples.map((sample) => sample.peakNativeHeapRequestedBytes),
		[1_000_000, 1_040_000, 1_040_000, 1_000_000],
	);
	assert.equal(report.samples[0].producerHealth.bufferOverran, false);
});

test('issue #291 heap peak stays fail-closed on unsupported or incomplete traces', () => {
	assert.throws(
		() => collectIssue291NativeHeapPeak(input('10'), [batch()], inputReceipt, toolReceipt),
		/Android 11 or newer/,
	);
	const lost = batch();
	lost.rows[0].bufferOverran = 1;
	assert.throws(
		() => collectIssue291NativeHeapPeak(input(), [lost], inputReceipt, toolReceipt),
		/loss or producer errors/,
	);
	const wrongMode = batch();
	wrongMode.modeEvidence.selfAllocatedFields = 1;
	assert.throws(
		() => collectIssue291NativeHeapPeak(input(), [wrongMode], inputReceipt, toolReceipt),
		/startup dump_at_max/,
	);
	assert.throws(
		() => collectIssue291NativeHeapPeak(input(), [{ ...batch(1, 2) }], inputReceipt, toolReceipt),
		/do not cover every accepted/,
	);
});
