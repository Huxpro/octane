import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeMessages, linearFit, median, parseLogMessages } from './analyze.mjs';

test('computes medians and a slope in ns/op with residuals', () => {
	assert.equal(median([9, 1, 5, 3, 7]), 5);
	const fit = linearFit([
		{ x: 10, y: 1.2 },
		{ x: 20, y: 2.2 },
		{ x: 30, y: 3.2 },
	]);
	assert.ok(Math.abs(fit.nsPerOp - 100000) < 1e-6);
	assert.ok(Math.abs(fit.interceptMs - 0.2) < 1e-9);
	assert.ok(fit.maxAbsResidualMs < 1e-9);
});

test('parses quoted Android console markers', () => {
	const log = '08-26 I lynx: "__OCTANE_LEPUS_COST__{\\"type\\":\\"done\\",\\"checksum\\":7}"';
	assert.deepEqual(parseLogMessages(log), [{ type: 'done', checksum: 7 }]);
});

function fixture({ brokenOrder = false, hostMismatch = false } = {}) {
	const messages = [{ type: 'meta', repetitions: 5, iterations: [10, 20], lepusVersion: 'test' }];
	for (const n of [10, 20]) {
		for (let repetition = 0; repetition < 5; repetition += 1) {
			const order = repetition % 2 === 0 ? ['control', 'candidate'] : ['candidate', 'control'];
			if (brokenOrder && n === 10 && repetition === 0) order.reverse();
			for (const arm of order) {
				messages.push({
					type: 'sample',
					case: 'call',
					group: 'dispatch',
					n,
					repetition,
					order: repetition % 2 === 0 ? 'controlcandidate' : 'candidatecontrol',
					arm,
					durationMs: arm === 'control' ? 1 : 1 + n / 100,
					hostCallsWholeArm: hostMismatch && arm === 'candidate' ? 1 : 0,
				});
			}
		}
	}
	messages.push({ type: 'done', checksum: 1 });
	return messages;
}

test('requires complete AB/BA pairs and equal host-call work', () => {
	const report = analyzeMessages(fixture());
	assert.equal(report.sampleCount, 20);
	assert.ok(Math.abs(report.rows[0].fit.nsPerOp - 10000) < 1e-6);
	assert.throws(() => analyzeMessages(fixture({ brokenOrder: true })), /AB\/BA/);
	assert.throws(() => analyzeMessages(fixture({ hostMismatch: true })), /callsBefore identity/);
});
