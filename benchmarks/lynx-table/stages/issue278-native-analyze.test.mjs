import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyzeIssue278Native, renderIssue278NativeReport } from './issue278-native-analyze.mjs';

const results = path.join(import.meta.dirname, 'results');

function read(name) {
	return JSON.parse(fs.readFileSync(path.join(results, name), 'utf8'));
}

function fixtures() {
	const oneK = read('issue278-native-v6-recycle1-default-1k-20260907.json');
	const twoKThreeK = read('issue278-native-v6-recycle1-default-2k3k-20260907.json');
	const capacity = read('issue278-native-v6-recycle1-default-5k-20260907.json');
	const traceReceipt = read(
		'issue278-native-shipping-control-1k-trace-receipt-aries10-20260907.json',
	);
	const runtimeSwitch = read('issue278-native-runtime-switch-aries10-20260907.json');
	return { oneK, twoKThreeK, capacity, traceReceipt, runtimeSwitch };
}

test('issue #278 report verifies the MTS apply owner without counting the capacity point', () => {
	const input = fixtures();
	const report = analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity], input);
	assert.equal(report.owner.status, 'verified');
	assert.equal(report.owner.segment, 'mtsApply');
	assert.ok(report.owner.anchorShareOfShippingWall > 0.95);
	assert.ok(report.scaling.mtsApply > 1.9);
	assert.equal(report.flags.verifiedNoRestore, true);
	assert.equal(report.overhead.accepted, true);
	assert.equal(report.capacity.status, 'complete');
	assert.equal(report.capacity.countedAsImprovement, false);
	assert.equal(report.trace.capture.dataLossOccurred, false);
	assert.equal(report.runtimeSwitch.verdict.pairedRuntimeComparisonAvailable, false);
	const markdown = renderIssue278NativeReport(report);
	assert.match(markdown, /\*\*verified: mtsApply\.\*\*/);
	assert.match(markdown, /LepusClosureEventListener::Invoke \[slice id: 7110\]/);
	assert.match(markdown, /Runtime-paired attribution is therefore \*\*unavailable\*\*/);
});

test('issue #278 report rejects lifecycle-confounded evidence', () => {
	const input = fixtures();
	input.twoKThreeK.device.explorerRecycleEveryPages = 5;
	assert.throws(
		() => analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity]),
		/one Explorer lifecycle per page/,
	);
});

test('issue #278 report rejects incomplete scale evidence', () => {
	const input = fixtures();
	input.twoKThreeK.validationPairs.pop();
	assert.throws(
		() => analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity]),
		/scale 3000 needs five complete checked\/trusted pairs/,
	);
});

test('issue #278 report rejects a rebuilt bundle mixed into one cohort', () => {
	const input = fixtures();
	input.twoKThreeK.provenance.bundles.timedChecked.sha256 = '0'.repeat(64);
	assert.throws(
		() => analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity]),
		/provenance mismatch for bundles/,
	);
});

test('issue #278 owner remains a hypothesis when instrumentation exceeds its overhead gate', () => {
	const input = fixtures();
	for (const pair of input.oneK.profileOverheadPairs) {
		const timeline = pair.samples.find((entry) => entry.sample?.arm === 'timelineChecked');
		timeline.sample.result.wallMs *= 1.1;
	}
	const report = analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity]);
	assert.equal(report.overhead.accepted, false);
	assert.equal(report.owner.status, 'hypothesis');
});

test('issue #278 report rejects a lossy trace', () => {
	const input = fixtures();
	input.traceReceipt.capture.dataLossOccurred = true;
	assert.throws(
		() => analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity], input),
		/trace failed its capture or correctness gate/,
	);
});

test('issue #278 report accepts exactly one complete capacity shard', () => {
	const input = fixtures();
	const duplicate = structuredClone(input.capacity);
	assert.throws(
		() => analyzeIssue278Native([input.oneK, input.twoKThreeK, input.capacity, duplicate]),
		/one isolated complete create@5k capacity shard/,
	);
});
