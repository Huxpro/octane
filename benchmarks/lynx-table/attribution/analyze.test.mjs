import assert from 'node:assert/strict';
import test from 'node:test';

import { linearSlope, median, summarize } from './analyze.mjs';

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
			meta: { bundleVariant: 'profile', bundleSha256: { workspace: 'bundle' } },
			targets: {
				workspace: {
					sha: 'workspace',
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
	const scale = summary.targets.workspace.heap.scales[0];
	assert.equal(scale.clearMs.median, 3);
	assert.equal(scale.viewDestroyMs.median, 1);
	assert.equal(scale.workerReleaseMs.median, 8);
});
