// The arithmetic in the split is the part that can lie quietly: a pooled
// interval, a mis-keyed t, or a heap reading averaged across windows would all
// still print a plausible table. These are the checks that would catch that.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	ARMS,
	band,
	buildSplitRecord,
	ci95,
	disjoint,
	readWindow,
} from './issue230-order3-split.mjs';

/** One runner row, in the shape `results/runs/*.json` uses. */
function row(entry, metric, samples) {
	return {
		entry,
		metric,
		samples: Array.isArray(samples) ? samples : null,
		value: Array.isArray(samples) ? null : samples,
		n: Array.isArray(samples) ? samples.length : 1,
	};
}

describe('issue #230 Order 3 split: the interval', () => {
	it('reproduces the runner’s own ci95 rather than a second convention', () => {
		// Taken from a real record: the runner reported this ci95 for these three
		// samples. If the t table were keyed by n instead of by df, or the
		// variance were the population one, this would not match.
		const samples = [1450.7749999985099, 1596.195000000298, 1697.4249999970198];
		assert.ok(Math.abs(ci95(samples) - 308.0157142101119) < 1e-9);
	});

	it('declines to invent an interval for a single reading', () => {
		assert.equal(ci95([51202248]), null);
		const only = band([51202248]);
		assert.equal(only.lo, only.hi);
		assert.equal(only.n, 1);
	});

	it('marks a delta only when the intervals do not overlap', () => {
		const control = band([100, 100, 100, 100, 100]);
		const far = band([200, 200, 200, 200, 200]);
		const near = band([101, 99, 100, 102, 98]);
		assert.equal(disjoint(far, control), true);
		assert.equal(disjoint(near, control), false);
	});
});

describe('issue #230 Order 3 split: reading a window', () => {
	it('takes sampled metrics and single-reading metrics alike', () => {
		const parsed = readWindow([
			row('o3ctl', 'latency', [10, 12, 14]),
			row('o3ctl', 'heapMts', 51202248),
			row('octane-hux', 'latency', [1, 2, 3]),
		]);
		assert.deepEqual(parsed.latency.o3ctl, [10, 12, 14]);
		assert.deepEqual(parsed.heapMts.o3ctl, [51202248]);
		// Entries outside the split are not part of it, and silently absorbing
		// one would put a foreign build in the control column.
		assert.equal(parsed.latency['octane-hux'], undefined);
	});
});

describe('issue #230 Order 3 split: the record', () => {
	const windows = [
		{
			source: 'w1.json',
			record: [
				row('o3ctl', 'latency', [100, 100, 100, 100, 100]),
				row('o3cmp', 'latency', [101, 101, 101, 101, 101]),
				row('o3ctl', 'heapMts', 51_000_000),
				row('o3tear', 'heapMts', 82_000_000),
			],
		},
		{
			source: 'w2.json',
			record: [
				row('o3ctl', 'latency', [300, 300, 300, 300, 300]),
				row('o3cmp', 'latency', [301, 301, 301, 301, 301]),
				row('o3ctl', 'heapMts', 51_100_000),
				row('o3tear', 'heapMts', 82_100_000),
			],
		},
	];

	it('compares wall clock inside one window and keeps later windows as replication', () => {
		const record = buildSplitRecord({
			windows,
			question: 'q',
			scale: 10000,
			octaneCommit: null,
			bundles: null,
		});
		// The headline mean is window 1's alone. Pooling 100 with 300 would put
		// the between-window drift inside the interval and could only ever make a
		// null look like a finding.
		assert.equal(record.timed.latency.arms.o3ctl.mean, 100);
		assert.equal(record.timed.latency.window, 1);
		assert.equal(record.timed.latency.replication.length, 1);
		assert.equal(record.timed.latency.replication[0].window, 2);
		assert.equal(record.timed.latency.replication[0].arms.o3ctl.mean, 300);
		// And the replication carries its own within-window delta, which is the
		// only number from window 2 that can be read beside window 1's.
		assert.equal(record.timed.latency.replication[0].arms.o3cmp.delta, 1);
	});

	it('treats the windows themselves as the heap samples, and reports their spread', () => {
		const record = buildSplitRecord({
			windows,
			question: 'q',
			scale: 10000,
			octaneCommit: null,
			bundles: null,
		});
		assert.deepEqual(record.heap.heapMts.o3tear.readings, [82_000_000, 82_100_000]);
		assert.equal(record.heap.heapMts.o3tear.spread, 100_000);
		assert.equal(record.heap.heapMts.o3tear.delta, 31_000_000);
		// The spread is what makes the delta readable: a 31 MB difference between
		// arms means nothing until the same arm repeats to within a fraction of it.
		assert.ok(record.heap.heapMts.o3tear.spread < record.heap.heapMts.o3tear.delta / 100);
	});

	it('names the arms and the windows it read, so the record can be re-derived', () => {
		const record = buildSplitRecord({
			windows,
			question: 'q',
			scale: 10000,
			octaneCommit: null,
			bundles: null,
		});
		assert.deepEqual(Object.keys(record.arms), ARMS);
		assert.deepEqual(
			record.windows.map((w) => w.source),
			['w1.json', 'w2.json'],
		);
	});
});
