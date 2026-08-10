import assert from 'node:assert/strict';
import test from 'node:test';

import { linearSlope, markdown, median, summarize } from './analyze.mjs';

test('median preserves the observed middle of odd and even samples', () => {
	assert.equal(median([9, 1, 5]), 5);
	assert.equal(median([9, 1, 5, 3]), 4);
});

test('linearSlope reports bytes per row rather than endpoint bytes', () => {
	assert.equal(
		linearSlope([
			{ x: 1000, y: 2000 },
			{ x: 10000, y: 20000 },
			{ x: 30000, y: 60000 },
		]),
		2,
	);
});

test('heap summary keeps clear, destroy, and worker-release timings separate', () => {
	const summary = summarize([
		{
			meta: {
				bundleVariant: 'profile',
				bundleSha256: { candidate: 'bundle' },
				targetOrder: ['candidate'],
			},
			targets: {
				candidate: {
					sha: 'candidate-sha',
					heap: {
						10000: [
							{
								retainedBytes: 100,
								clearResidualBytes: 10,
								clearMs: 3,
								viewDestroyMs: 1,
								workerReleaseMs: 8,
								oracle: { rows: 10000 },
								workerReleased: true,
							},
						],
					},
				},
			},
		},
	]);
	const scale = summary.targets.candidate.heap.scales[0];
	assert.equal(scale.clearMs.median, 3);
	assert.equal(scale.viewDestroyMs.median, 1);
	assert.equal(scale.workerReleaseMs.median, 8);
	const report = markdown(summary, ['smoke.json']);
	assert.doesNotMatch(report, /NaN/);
	assert.match(report, /not evaluated/);
});

test('derives adjacent comparisons from raw target order and explicit endpoints', () => {
	const heap = (retainedBytes) => ({
		1000: [
			{
				retainedBytes,
				clearResidualBytes: 0,
				oracle: { rows: 1000 },
				workerReleased: true,
			},
		],
		2000: [
			{
				retainedBytes: retainedBytes * 2,
				clearResidualBytes: 0,
				oracle: { rows: 2000 },
				workerReleased: true,
			},
		],
	});
	const summary = summarize(
		[
			{
				meta: {
					bundleVariant: 'profile',
					bundleSha256: {},
					targetOrder: ['base', 'middle', 'head'],
				},
				targets: {
					base: { sha: 'a', heap: heap(100) },
					middle: { sha: 'b', heap: heap(110) },
					head: { sha: 'c', heap: heap(130) },
				},
			},
		],
		{ baseline: 'base', candidate: 'head' },
	);
	assert.deepEqual(summary.comparison, { baseline: 'base', candidate: 'head' });
	assert.deepEqual(
		summary.adjacent.map(({ from, to }) => ({ from, to })),
		[
			{ from: 'base', to: 'middle' },
			{ from: 'middle', to: 'head' },
		],
	);
	assert.equal(summary.gates.retainedRegression.to, 'head');
});
