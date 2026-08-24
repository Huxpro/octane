// The publication-floor control decides #148 W2's registered prediction, so
// what is worth pinning is not its arithmetic but the ways it could announce a
// verdict it did not earn.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ARM_NAMES,
	FLAT_DRIFT,
	NODES_PER_ROW,
	cellName,
	cellNames,
	drift,
	publishOnlyRates,
	reactionCost,
	summarizeArm,
	verdictFor,
} from './dom-attach-analyze.mjs';

const sample = ({ buildMs = 10, attachMs = 1, frameMs = 1, totalMs = 12 }) => ({
	buildMs,
	attachMs,
	frameMs,
	totalMs,
});

const ARMS = cellNames();

/**
 * A cell whose command cost is exactly `perNodeUs` per node at `rows`. A
 * `live-*` arm's command cost is its whole loop, so the milliseconds go in
 * `buildMs`; a `split-*` arm's is its attach span.
 */
function arm(name, rows, perNodeUs) {
	const publishedMs = (perNodeUs * rows * NODES_PER_ROW) / 1000;
	const span = /(^|:)live-/.test(name) ? { buildMs: publishedMs } : { attachMs: publishedMs };
	return summarizeArm([sample({ buildMs: 0, attachMs: 0, frameMs: 0, ...span })], rows);
}

/**
 * A run at the rates given. The verdict decides on the upgraded kind, so those
 * are the rates a case states; `inertOffset` gives the inert kind a rate that
 * much lower, which is what `reactionCost` subtracts.
 */
function run({
	incremental,
	bulk,
	split = null,
	scales = [1000, 10000, 30000],
	inertOffset = 0.1,
}) {
	const rate = (name, index) =>
		/live-incremental$/.test(name)
			? incremental[index]
			: /live-bulk$/.test(name)
				? bulk[index]
				: /split-incremental$/.test(name)
					? (split?.incremental ?? incremental)[index]
					: (split?.bulk ?? bulk)[index];
	const perScale = scales.map((rows, index) => ({
		rows,
		arms: Object.fromEntries(
			ARMS.map((cell) => [
				cell,
				cell.endsWith(':build')
					? arm(cell, rows, 1)
					: arm(cell, rows, rate(cell, index) - (cell.startsWith('inert:') ? inertOffset : 0)),
			]),
		),
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
	assert.equal(verdict.drifts[cellName('upgraded', 'live-incremental')], null);
	assert.equal(verdict.drifts[cellName('upgraded', 'live-bulk')], null);
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
	assert.equal(verdict.rates[cellName('upgraded', 'split-bulk')][0], (70 / nodes) * 1000);
	assert.equal(verdict.rates[cellName('upgraded', 'live-bulk')][0], ((900 + 70) / nodes) * 1000);
	assert.equal(verdict.frames[cellName('upgraded', 'split-bulk')][0], (140 / nodes) * 1000);
	// The reading registered before the run is kept, not replaced.
	assert.equal(
		verdict.registered[cellName('upgraded', 'split-bulk')][0],
		((70 + 140) / nodes) * 1000,
	);
	assert.equal(
		verdict.registered[cellName('upgraded', 'live-bulk')][0],
		((900 + 70 + 140) / nodes) * 1000,
	);
	assert.equal(summary.nodes, nodes);
});

test('a bulk rate that falls with the tree does not count as rising', () => {
	// `drift` is max over min, so a rate that halves across the range scores
	// exactly like one that doubles. Reading it alone confirms the prediction
	// from data that refutes it, which is the one way this control can publish a
	// platform-floor attribution it has not earned.
	const verdict = run({ incremental: [2.4, 2.38, 2.36], bulk: [3.0, 2.6, 2.4] });
	assert.equal(verdict.drifts[cellName('upgraded', 'live-bulk')] > FLAT_DRIFT, true);
	assert.equal(verdict.trends[cellName('upgraded', 'live-bulk')] < 0, true);
	assert.equal(verdict.bulkRising, false);
	assert.equal(verdict.predictionConfirmed, false);
});

test('reaction cost is the upgraded cell minus the inert one, same window', () => {
	// The reason the kind axis exists. The first run of this control compared
	// web-core's publishing appendChild — which inserts upgraded custom elements
	// and runs a reaction per node — against inert tags, and attributed the whole
	// difference to web-core. Both cells are measured in one window and differ
	// only in whether `customElements.define` ran, so their difference is the
	// platform's reaction dispatch and belongs to the floor.
	const scales = [1000, 10000, 30000];
	const cellRate = (cell) => (cell.startsWith('upgraded:') ? 2.4 : 1.5);
	const perScale = scales.map((rows) => ({
		rows,
		arms: Object.fromEntries(
			cellNames().map((cell) => [
				cell,
				summarizeArm(
					[
						sample({
							buildMs: 0,
							attachMs: (cellRate(cell) * rows * NODES_PER_ROW) / 1000,
							frameMs: 0,
						}),
					],
					rows,
				),
			]),
		),
	}));
	for (const arm of ARM_NAMES.filter((name) => name.startsWith('split-'))) {
		// 2.4 − 1.5 at every scale, and subtracted per scale rather than folded
		// across them, so a kind that diverges at one scale cannot be averaged
		// away by the others.
		assert.deepEqual(
			reactionCost(perScale, arm).map((value) => Number(value.toFixed(6))),
			[0.9, 0.9, 0.9],
		);
	}
	// And the verdict still decides on the upgraded kind only — the inert cells
	// are a subtrahend, never a pair member.
	const verdict = run({ incremental: [2.4, 2.35, 2.3], bulk: [2.4, 2.35, 2.3] });
	assert.equal(verdict.deciding.pair.incremental, cellName('upgraded', 'live-incremental'));
	assert.equal(verdict.localizing.pair.bulk, cellName('upgraded', 'split-bulk'));
});

test('the publishing call is reported alone, not folded into a loop', () => {
	// The attribution rests on this one number, because it is the only span here
	// that is a single call on both sides of the comparison. Reading it from an
	// arm whose attach span is thousands of appends would compare a bulk publish
	// against a loop and inflate the platform's share.
	const rows = 10000;
	const nodes = rows * NODES_PER_ROW;
	const perScale = [
		{
			rows,
			arms: {
				[cellName('upgraded', 'live-bulk')]: summarizeArm(
					[sample({ buildMs: 126.6, attachMs: 45.9, frameMs: 229.2, totalMs: 401.7 })],
					rows,
				),
				[cellName('inert', 'live-bulk')]: summarizeArm(
					[sample({ buildMs: 50.8, attachMs: 10.8, frameMs: 226, totalMs: 287.6 })],
					rows,
				),
			},
		},
	];
	assert.deepEqual(publishOnlyRates(perScale, 'upgraded'), [(45.9 / nodes) * 1000]);
	assert.deepEqual(publishOnlyRates(perScale, 'inert'), [(10.8 / nodes) * 1000]);
	// The build loop is excluded, so the rate is not the whole-loop command cost.
	assert.notEqual(publishOnlyRates(perScale, 'upgraded')[0], ((126.6 + 45.9) / nodes) * 1000);
	assert.throws(() => publishOnlyRates(perScale, 'missing'), /no missing:live-bulk arm/);
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
