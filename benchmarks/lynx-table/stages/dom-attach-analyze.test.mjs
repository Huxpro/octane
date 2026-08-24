// The publication-floor control decides #148 W2's registered prediction, so
// what is worth pinning is not its arithmetic but the ways it could announce a
// verdict it did not earn.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	FLAT_DRIFT,
	NODES_PER_ROW,
	drift,
	summarizeArm,
	verdictFor,
} from './dom-attach-analyze.mjs';

const sample = ({ buildMs = 10, attachMs = 1, frameMs = 1, totalMs = 12 }) => ({
	buildMs,
	attachMs,
	frameMs,
	totalMs,
});

const ARMS = ['build', 'live-incremental', 'live-bulk', 'split-incremental', 'split-bulk'];

/**
 * An arm whose published cost is exactly `perNodeUs` per node at `rows`. A
 * `live-*` arm's published cost is its whole loop, so the milliseconds go in
 * `buildMs`; a `split-*` arm's is its attach span.
 */
function arm(name, rows, perNodeUs) {
	const publishedMs = (perNodeUs * rows * NODES_PER_ROW) / 1000;
	const span = name.startsWith('live-') ? { buildMs: publishedMs } : { attachMs: publishedMs };
	return summarizeArm([sample({ buildMs: 0, attachMs: 0, frameMs: 0, ...span })], rows);
}

function run({ incremental, bulk, split = null, scales = [1000, 10000, 30000] }) {
	const perScale = scales.map((rows, index) => ({
		rows,
		arms: {
			build: arm('build', rows, 1),
			'live-incremental': arm('live-incremental', rows, incremental[index]),
			'live-bulk': arm('live-bulk', rows, bulk[index]),
			'split-incremental': arm(
				'split-incremental',
				rows,
				(split?.incremental ?? incremental)[index],
			),
			'split-bulk': arm('split-bulk', rows, (split?.bulk ?? bulk)[index]),
		},
	}));
	return verdictFor(perScale, ARMS);
}

test('confirms the prediction only when incremental is flat and bulk rises', () => {
	const verdict = run({ incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.6, 3.0] });
	assert.equal(verdict.evaluable, true);
	assert.equal(verdict.incrementalFlat, true);
	assert.equal(verdict.bulkRising, true);
	assert.equal(verdict.predictionConfirmed, true);
});

test('refuses to decide a run that measured a single scale', () => {
	// A drift needs two points. Reporting its absence as a failed flatness test
	// would publish "refuted" for a run that tested nothing — which is how a
	// smoke run turns into a campaign verdict.
	const verdict = run({ incremental: [2.4], bulk: [2.4], scales: [1000] });
	assert.equal(verdict.drifts['live-incremental'], null);
	assert.equal(verdict.drifts['live-bulk'], null);
	assert.equal(verdict.evaluable, false);
	assert.equal(verdict.predictionConfirmed, false);
	// Refuted must be false too: not-evaluable is its own outcome, not a refusal.
	assert.equal(verdict.incrementalFlat, false);
	assert.equal(verdict.bulkRising, false);
	// And two pairs that decided nothing are not two pairs that agree, which is
	// what `false === false` would otherwise report.
	assert.equal(verdict.pairsAgree, null);
});

test('refutes the prediction when both arms rise together', () => {
	// Both rising means the tree costs more per node however it is attached, so
	// the first-screen path's rise is not attributable to bulk publication.
	const verdict = run({ incremental: [2.4, 2.8, 3.2], bulk: [2.4, 2.9, 3.4] });
	assert.equal(verdict.evaluable, true);
	assert.equal(verdict.incrementalFlat, false);
	assert.equal(verdict.predictionConfirmed, false);
});

test('refutes the prediction when bulk stays flat', () => {
	// The outcome that hands publication's residue back to web-core: the
	// platform charges the same per node either way, so the rise Octane measures
	// is not the platform's.
	const verdict = run({ incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.42, 2.38] });
	assert.equal(verdict.evaluable, true);
	assert.equal(verdict.incrementalFlat, true);
	assert.equal(verdict.bulkRising, false);
	assert.equal(verdict.predictionConfirmed, false);
});

test('decides on the calls the stream makes, not on the browser frame', () => {
	// The rate this control has to explain was measured as host self time inside
	// PAPI calls, which contains no style, layout, or paint. Folding the frame
	// into the deciding rate would compare a different quantity — and on a real
	// host the frame is the larger part, so it would decide the verdict.
	const rows = 10000;
	const nodes = rows * NODES_PER_ROW;
	const summary = summarizeArm(
		[sample({ buildMs: 900, attachMs: 70, frameMs: 140, totalMs: 1110 })],
		rows,
	);
	const arms = Object.fromEntries(ARMS.map((name) => [name, summary]));
	const verdict = verdictFor([{ rows, arms }], ARMS);
	// A split arm reports its attach span; a live arm cannot separate insertion
	// from creation, so it reports its whole loop. Neither reads `totalMs`.
	assert.equal(verdict.rates['split-bulk'][0], (70 / nodes) * 1000);
	assert.equal(verdict.rates['live-bulk'][0], ((900 + 70) / nodes) * 1000);
	assert.equal(verdict.frames['split-bulk'][0], (140 / nodes) * 1000);
	// The reading registered before the run is kept, not replaced.
	assert.equal(verdict.registered['split-bulk'][0], ((70 + 140) / nodes) * 1000);
	assert.equal(verdict.registered['live-bulk'][0], ((900 + 70 + 140) / nodes) * 1000);
	assert.equal(summary.nodes, nodes);
});

test('a bulk rate that falls with the tree does not count as rising', () => {
	// `drift` is max over min, so a rate that halves across the range scores
	// exactly like one that doubles. Reading it alone confirms the prediction
	// from data that refutes it, which is the one way this control can publish a
	// platform-floor attribution it has not earned.
	const verdict = run({ incremental: [2.4, 2.38, 2.36], bulk: [3.0, 2.6, 2.4] });
	assert.equal(verdict.drifts['live-bulk'] > FLAT_DRIFT, true);
	assert.equal(verdict.trends['live-bulk'] < 0, true);
	assert.equal(verdict.bulkRising, false);
	assert.equal(verdict.predictionConfirmed, false);
});

test('charging the same for both shapes opens no gap', () => {
	// The prediction stated as one number per scale. Whatever either drift does,
	// a platform that charges the same for an attached and a detached container
	// has not reproduced the split.
	const flat = run({ incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.35, 2.3] });
	assert.deepEqual(flat.deciding.gaps, [1, 1, 1]);
	assert.equal(flat.deciding.gapOpens, false);
	const split = run({ incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.6, 3.0] });
	assert.equal(split.deciding.gapOpens, true);
	assert.ok(split.deciding.gaps[2] > 1 + FLAT_DRIFT);
});

test('the interleaved pair decides, and the split pair cannot overturn it', () => {
	// The split pair carries a deviation the live pair does not — it builds and
	// attaches in two loops where the command stream interleaves them — so a
	// disagreement is reported, never resolved in the split pair's favour.
	const verdict = run({
		incremental: [2.4, 2.35, 2.3],
		bulk: [2.4, 2.6, 3.0],
		split: { incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.42, 2.38] },
	});
	assert.equal(verdict.deciding.predictionConfirmed, true);
	assert.equal(verdict.localizing.predictionConfirmed, false);
	assert.equal(verdict.pairsAgree, false);
	assert.equal(verdict.predictionConfirmed, true);
});

test('the flatness gate is the harness-wide 10%, read against the extremes', () => {
	assert.equal(FLAT_DRIFT, 0.1);
	// Drift is max over min, so a middle scale cannot mask a spread between the
	// ends: 2.0 -> 2.5 -> 2.05 is not flat, whatever the last point does.
	assert.ok(drift([2, 2.05, 2.09]) < FLAT_DRIFT);
	assert.ok(drift([2, 2.5, 2.05]) > FLAT_DRIFT);
	// Order does not matter either; the rate may fall as well as rise.
	assert.equal(drift([2.5, 2]), drift([2, 2.5]));
});

test('refuses an arm with no samples rather than folding an empty median', () => {
	assert.throws(() => summarizeArm([], 1000), /at least one sample/);
	assert.throws(() => summarizeArm([sample({})], 0), /rows must be positive/);
});
