import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
	issue194CollectionState,
	issue194DeviceCompletionMode,
	issue194DeviceResumeMismatch,
	issue194LifecycleSequence,
	normalizeIssue194NativeReceipt,
	parseIssue194AndroidProcessMemory,
	summarizeIssue194LifecycleCensus,
	validateIssue194ProcessMemoryControls,
} from './issue194-device-protocol.mjs';

const appRoot = path.resolve(import.meta.dirname, '../app/src');
const app = fs.readFileSync(path.join(appRoot, 'App.lynx.tsrx'), 'utf8');
const entry = fs.readFileSync(path.join(appRoot, 'index.ts'), 'utf8');

function nestedBlock(source, anchor) {
	const anchorStart = source.indexOf(anchor);
	assert.notEqual(anchorStart, -1, `missing block anchor: ${anchor}`);
	const blockStart = source.indexOf('{', anchorStart + anchor.length);
	assert.notEqual(blockStart, -1, `missing block start after: ${anchor}`);
	let depth = 0;
	for (let index = blockStart; index < source.length; index++) {
		if (source[index] === '{') depth++;
		if (source[index] !== '}') continue;
		depth--;
		if (depth === 0) return source.slice(blockStart + 1, index);
	}
	assert.fail(`missing block end after: ${anchor}`);
}

test('Native benchmark source does not construct unavailable Web scheduling globals', () => {
	assert.match(app, /typeof MessageChannel === 'function' \? new MessageChannel\(\) : null/);
	const nativeSchedule = nestedBlock(app, 'if (_stormChannel === null)');
	assert.match(nativeSchedule, /lynx\.setTimeout\(cb, 0\)/);
	assert.doesNotMatch(nativeSchedule, /(?<!\.)\bsetTimeout\(/);
});

test('issue #194 Android memory parser keeps process sources and units explicit', () => {
	const memory = parseIssue194AndroidProcessMemory(
		'Rss: 200 kB\nPss: 150 kB\nPrivate_Clean: 20 kB\nPrivate_Dirty: 100 kB\n',
		'VmRSS: 190 kB\n',
		'Native Heap 90 80 5 0 120 70 50\nDalvik Heap 40 30 2 0 60 25 35\nTOTAL 160 120 22 3\n',
	);
	assert.equal(memory.smapsRollupKb.Pss, 150);
	assert.equal(memory.statusKb.VmRSS, 190);
	assert.deepEqual(memory.dumpsysKb, {
		totalPss: 160,
		totalPrivateDirty: 120,
		totalPrivateClean: 22,
		totalSwapDirty: 3,
		nativePss: 90,
		nativePrivateDirty: 80,
		nativePrivateClean: 5,
		nativeHeapSize: 120,
		nativeHeapAlloc: 70,
		nativeHeapFree: 50,
		dalvikPss: 40,
		dalvikPrivateDirty: 30,
		dalvikPrivateClean: 2,
		dalvikHeapSize: 60,
		dalvikHeapAlloc: 25,
		dalvikHeapFree: 35,
	});
	assert.throws(
		() => parseIssue194AndroidProcessMemory('Pss: 1 kB', 'VmRSS: 1 kB', 'TOTAL 1 1 1 1'),
		/could not parse/,
	);
});

test('issue #194 process-memory controls require the Native-only lifecycle lane', () => {
	assert.equal(issue194DeviceCompletionMode([]), 'commit');
	assert.equal(issue194DeviceCompletionMode(['--direct-result', '--native-only']), 'native-only');
	assert.doesNotThrow(() =>
		validateIssue194ProcessMemoryControls({
			processMemory: true,
			mode: 'native-only',
			createClearRecreate: true,
			settleMs: 4000,
		}),
	);
	assert.throws(
		() =>
			validateIssue194ProcessMemoryControls({
				processMemory: true,
				mode: 'commit',
				createClearRecreate: true,
				settleMs: 4000,
			}),
		/requires --native-only/,
	);
	assert.throws(
		() =>
			validateIssue194ProcessMemoryControls({
				processMemory: true,
				mode: 'native-only',
				createClearRecreate: false,
				settleMs: 4000,
			}),
		/requires --create-clear-recreate/,
	);
	assert.throws(
		() =>
			validateIssue194ProcessMemoryControls({
				processMemory: false,
				mode: 'commit',
				createClearRecreate: false,
				settleMs: 0,
			}),
		/positive integer/,
	);
});

test('issue #194 checkpoint resume preserves one runner and physical device identity', () => {
	const current = {
		protocol: 'octane-issue194-device-v1',
		question: 'M0 memory',
		octaneCommit: 'a'.repeat(40),
		serial: 'device:1234',
		device: { fingerprint: 'build/device', abi: 'arm64-v8a' },
		controls: { ordering: 'AB/BA' },
		scale: 1000,
		targetAcceptedSamplesPerCell: 10,
		disableDevToolBundle: { bundle: { sha256: 'b'.repeat(64) } },
		cells: { baseline: { bundle: { sha256: 'c'.repeat(64) } } },
	};
	assert.equal(issue194DeviceResumeMismatch(structuredClone(current), current), null);
	for (const [field, mutate] of [
		['octaneCommit', (value) => (value.octaneCommit = 'd'.repeat(40))],
		['serial', (value) => (value.serial = 'other:1234')],
		['device', (value) => (value.device.fingerprint = 'other/device')],
		['cells', (value) => (value.cells.baseline.bundle.sha256 = 'e'.repeat(64))],
	]) {
		const resumed = structuredClone(current);
		mutate(resumed);
		assert.equal(issue194DeviceResumeMismatch(resumed, current), field);
	}
});

test('issue #194 bounded collection pauses only before the final target', () => {
	assert.equal(
		issue194CollectionState({
			acceptedSamples: 6,
			targetSamples: 20,
			newlyAcceptedSamples: 6,
			maxNewSamples: 6,
		}),
		'paused',
	);
	assert.equal(
		issue194CollectionState({
			acceptedSamples: 20,
			targetSamples: 20,
			newlyAcceptedSamples: 2,
			maxNewSamples: 2,
		}),
		'complete',
	);
	assert.equal(
		issue194CollectionState({
			acceptedSamples: 4,
			targetSamples: 20,
			newlyAcceptedSamples: 4,
			maxNewSamples: 6,
		}),
		'collecting',
	);
	assert.throws(
		() =>
			issue194CollectionState({
				acceptedSamples: 0,
				targetSamples: 20,
				newlyAcceptedSamples: 0,
				maxNewSamples: 0,
			}),
		/positive integer/,
	);
});

test('Native tap receipt encloses action, transport ACK, two frames, and semantic state', () => {
	const measurement = nestedBlock(app, 'function measureNative(');
	const start = measurement.indexOf('const startMs = Date.now()');
	const action = measurement.indexOf('action()');
	const flush = measurement.indexOf('stormEvidence) => flush().then');
	const firstFrame = measurement.indexOf('nextNativeFrame()');
	const secondFrame = measurement.indexOf('nextNativeFrame()', firstFrame + 1);
	const postState = measurement.indexOf('__LYNX_BENCH_SNAPSHOT__?.()', secondFrame);
	const publication = measurement.indexOf("'__NATIVE_BENCH_RESULT__'", postState);

	assert.ok(start !== -1 && start < action);
	assert.ok(action < flush && flush < firstFrame && firstFrame < secondFrame);
	assert.ok(secondFrame < postState && postState < publication);
	assert.match(measurement, /protocol: 'lynx-native-bench-v2'/);
	assert.match(measurement, /kind: 'octane-root\.flushTransport'/);
	assert.match(measurement, /boundary: 'native-input-handler-to-second-native-frame'/);
	assert.match(measurement, /preState,/);
	assert.match(measurement, /postState,/);
	assert.match(measurement, /stormEvidence === undefined/);
	assert.ok(measurement.indexOf('pipelineBefore = ackPipelineSnapshot()') < action);
	assert.ok(measurement.indexOf('pipelineAfter = ackPipelineSnapshot()') > postState);
	assert.match(measurement, /ackPipelineEvidence:/);
	assert.match(measurement, /queueMaxDepthAfter:/);
	assert.match(measurement, /preparationsWhileAck:/);
	assert.match(measurement, /roundTrips:/);
	assert.match(measurement, /firstFeedbackLatencyMs:/);
});

test('Native storms await every transport ACK and frame before publishing tick evidence', () => {
	const storm = nestedBlock(app, 'function runStorm(');
	const native = nestedBlock(storm, 'if (_stormChannel === null)');
	const loop = nestedBlock(native, 'for (let tick = 1; tick <= ticks; tick++)');
	const task = loop.indexOf('await new Promise<void>');
	const step = loop.indexOf('step(tick)');
	const flush = loop.indexOf('await flush()');
	const completed = loop.indexOf('completedTicks = tick');
	const frame = loop.indexOf('await nextNativeFrame()');
	const barrier = loop.indexOf('renderBarriers++');

	assert.ok(task !== -1 && task < step && step < flush);
	assert.ok(flush < completed && completed < frame && frame < barrier);
	assert.match(native, /commit: 'every-tick'/);
	assert.match(native, /expectedTicks: ticks/);
	assert.match(native, /completedTicks,/);
	assert.match(native, /renderBarriers,/);
	assert.match(native, /firstFeedbackMs,/);
	assert.match(app, /tickAcknowledgements: stormEvidence\.completedTicks/);
	assert.match(app, /const stormUpdate = useCallback\(\(\) => \{\s*return runStorm\(/);
	assert.match(app, /const stormSelect = useCallback\(\(\) => \{\s*return runStorm\(/);
	assert.match(app, /measureNativeTap\('updateStorm', stormUpdate\)/);
	assert.match(app, /measureNativeTap\('selectStorm', stormSelect\)/);
});

test('Native startup receipt is emitted only after render ACK, two frames, and state', () => {
	const background = nestedBlock(entry, "if (rendered !== null && typeof rendered === 'object'");
	const renderAck = nestedBlock(background, 'void rendered.then(');
	const firstFrame = nestedBlock(renderAck, 'lynx.requestAnimationFrame(');
	const secondFrame = nestedBlock(firstFrame, 'lynx.requestAnimationFrame(');

	assert.match(renderAck, /commitAckMs = Date\.now\(\)/);
	assert.match(secondFrame, /__LYNX_BENCH_SNAPSHOT__\?\.\(\)/);
	assert.match(secondFrame, /protocol: 'lynx-native-startup-v1'/);
	assert.match(secondFrame, /kind: 'octane-root\.render'/);
	assert.match(secondFrame, /__LYNX_BENCH_STARTUP__ = receipt/);
	assert.match(secondFrame, /'__NATIVE_BENCH_STARTUP__'/);
	assert.equal((entry.match(/__LYNX_BENCH_STARTUP__ = receipt/g) ?? []).length, 1);
});

test('issue #194 runner normalizes app-owned Native v2 create and clear receipts', () => {
	const create = normalizeIssue194NativeReceipt(
		{
			protocol: 'lynx-native-bench-v2',
			name: 'create',
			preState: { rowCount: 0 },
			postState: { rowCount: 1000 },
		},
		2,
	);
	assert.equal(create.interactionOrdinal, 2);
	assert.equal(create.workload, 'create');
	assert.equal(create.scale, 1000);

	const clear = normalizeIssue194NativeReceipt(
		{
			protocol: 'lynx-native-bench-v2',
			name: 'clear',
			preState: { rowCount: 1000 },
			postState: { rowCount: 0 },
		},
		3,
	);
	assert.equal(clear.interactionOrdinal, 3);
	assert.equal(clear.workload, 'clear');
	assert.equal(clear.scale, 1000);
});

test('Native v2 receipts carry stable ordinals and lifecycle cycles reset populated pages', () => {
	const measurement = nestedBlock(app, 'function measureNative(');
	assert.ok(
		measurement.indexOf('interactionOrdinal = ++nativeInteractionOrdinal') <
			measurement.indexOf('action()'),
	);
	assert.match(measurement, /protocol: 'lynx-native-bench-v2',\s*interactionOrdinal,/);

	const normalized = normalizeIssue194NativeReceipt(
		{ name: 'create', interactionOrdinal: 41, postState: { rowCount: 1000 } },
		2,
	);
	assert.equal(normalized.interactionOrdinal, 41);

	assert.deepEqual(
		issue194LifecycleSequence(2, { x: 1, y: 2 }, { x: 3, y: 4 }).map(
			({ cycle, phase, workload }) => `${cycle}:${phase}:${workload}`,
		),
		[
			'0:create:create',
			'0:clear:clear',
			'0:recreate:create',
			'1:reset:clear',
			'1:create:create',
			'1:clear:clear',
			'1:recreate:create',
		],
	);
	assert.throws(
		() => issue194LifecycleSequence(0, { x: 1, y: 2 }, { x: 3, y: 4 }),
		/positive integer/,
	);

	const baseline = {
		handles: 7,
		ranges: 1,
		listenerSlots: 12,
		retainedHostRefs: 28,
		recycledHandles: 0,
		recycledHostRefs: 0,
	};
	const populated = {
		handles: 1007,
		ranges: 2,
		listenerSlots: 2012,
		retainedHostRefs: 4028,
		recycledHandles: 0,
		recycledHostRefs: 0,
	};
	const evidence = [
		{ phase: 'create', workload: 'create', attribution: { census: populated } },
		{ phase: 'clear', workload: 'clear', attribution: { census: baseline } },
		{ phase: 'recreate', workload: 'create', attribution: { census: populated } },
	];
	assert.deepEqual(summarizeIssue194LifecycleCensus(evidence, baseline), {
		valid: true,
		initial: baseline,
		populated,
		cleared: baseline,
		recycling: false,
	});
	evidence[1].attribution.census = { ...baseline, listenerSlots: 13 };
	assert.equal(summarizeIssue194LifecycleCensus(evidence, baseline).valid, false);

	const recycled = {
		...baseline,
		recycledHandles: 1000,
		recycledHostRefs: 4000,
	};
	const recycledEvidence = [
		{ phase: 'create', workload: 'create', attribution: { census: populated } },
		{ phase: 'clear', workload: 'clear', attribution: { census: recycled } },
		{ phase: 'recreate', workload: 'create', attribution: { census: populated } },
		{ phase: 'reset', workload: 'clear', attribution: { census: recycled } },
		{ phase: 'create', workload: 'create', attribution: { census: populated } },
	];
	assert.deepEqual(summarizeIssue194LifecycleCensus(recycledEvidence, baseline), {
		valid: true,
		initial: baseline,
		populated,
		cleared: recycled,
		recycling: true,
	});
	recycledEvidence[3].attribution.census = { ...recycled, recycledHandles: 999 };
	assert.equal(summarizeIssue194LifecycleCensus(recycledEvidence, baseline).valid, false);
});
