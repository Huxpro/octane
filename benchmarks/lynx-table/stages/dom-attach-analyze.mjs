// Analysis for the publication-floor control (`dom-attach-floor.mjs`).
//
// Separate from the probe because this half decides a claim: it prints
// "prediction confirmed" or "prediction refuted" for #148 W2, and a claim
// generator is worth testing without spending a measurement window.
import { stats } from '../web/driver-client.mjs';

// 7 elements per row, the shape `createElementAPI.js` builds: one `x-view` row,
// three `x-text` cells, three `raw-text` children.
export const NODES_PER_ROW = 7;

// The same 10% gate the rest of the harness uses to call an owner real. A rate
// that drifts within it across a 30x scale range is a per-node cost; one that
// drifts past it is growing with the tree.
export const FLAT_DRIFT = 0.1;

export const SPANS = ['buildMs', 'attachMs', 'frameMs', 'totalMs'];

/** Fold one arm's samples at one scale into medians and per-node rates. */
export function summarizeArm(armSamples, rows) {
	if (!Array.isArray(armSamples) || armSamples.length === 0) {
		throw new TypeError('an arm summary needs at least one sample.');
	}
	if (!Number.isSafeInteger(rows) || rows <= 0) throw new TypeError('rows must be positive.');
	const nodes = rows * NODES_PER_ROW;
	const spans = {};
	for (const key of SPANS) {
		const stat = stats(armSamples.map((sample) => sample[key]));
		if (stat === null) throw new TypeError(`${key} carried no finite sample.`);
		spans[key] = stat;
	}
	return {
		rows,
		nodes,
		spans,
		// Per node in microseconds: the portable form of the claim. Absolute
		// milliseconds are host-bound and belong to one window only.
		perNodeUs: Object.fromEntries(SPANS.map((key) => [key, (spans[key].median / nodes) * 1000])),
	};
}

/**
 * How far a rate moves across the measured scales, as a fraction. `null` when
 * fewer than two scales carry a usable rate — a drift cannot be computed from
 * one point, and reporting that as zero would read as perfect flatness.
 */
export function drift(rates) {
	const finite = rates.filter((rate) => Number.isFinite(rate) && rate > 0);
	if (finite.length < 2) return null;
	return Math.max(...finite) / Math.min(...finite) - 1;
}

/**
 * Signed change from the smallest scale to the largest, as a fraction. `drift`
 * is direction-blind by design — it answers "is this a per-node cost" — so it
 * cannot distinguish a rate that grows with the tree from one that falls. The
 * prediction is specifically about a rise, and scoring a falling rate as rising
 * would publish a confirmation for data that refutes it.
 */
export function trend(rates) {
	const finite = rates.filter((rate) => Number.isFinite(rate) && rate > 0);
	if (finite.length < 2) return null;
	return finite[finite.length - 1] / finite[0] - 1;
}

export const ARM_NAMES = [
	'build',
	'live-incremental',
	'live-bulk',
	'split-incremental',
	'split-bulk',
];

/**
 * The two element kinds the same arms are measured with. `inert` uses
 * unregistered tags and is the floor for inserting plain DOM nodes; `upgraded`
 * registers the same tags as custom elements with an empty `connectedCallback`,
 * which is what the harness page actually holds — `@lynx-js/web-elements`
 * defines `x-view`, `x-text`, and `raw-text`, so web-core's publishing
 * `appendChild` runs one reaction per node inside the insertion.
 *
 * Measuring both in one window is the point: `upgraded` minus `inert` is the
 * platform's cost for running a reaction per node, which is irreducible for
 * anyone whose host elements are custom elements at all, and it is a
 * subtraction only if nothing but the registration differs between them.
 */
export const ELEMENT_KINDS = ['inert', 'upgraded'];

/** One measured cell: an arm run against one element kind. */
export const cellName = (kind, arm) => `${kind}:${arm}`;

/** Every cell name, in the order the schedule rotates them. */
export function cellNames(kinds = ELEMENT_KINDS, arms = ARM_NAMES) {
	return kinds.flatMap((kind) => arms.map((arm) => cellName(kind, arm)));
}

// The pair that decides the prediction, and the pair that localizes it.
//
// `live-*` interleaves creation and attachment per row, exactly as the command
// stream does, so its whole loop is comparable to Octane's `papi_topology`
// (plus `papi_flush` on the bulk side) and it carries no deviation. `split-*`
// builds first and attaches second, which costs a deviation but buys a
// separable `attachMs`.
export const pairsFor = (kind) => ({
	deciding: {
		incremental: cellName(kind, 'live-incremental'),
		bulk: cellName(kind, 'live-bulk'),
	},
	localizing: {
		incremental: cellName(kind, 'split-incremental'),
		bulk: cellName(kind, 'split-bulk'),
	},
});

export const DECIDING_PAIR = pairsFor('upgraded').deciding;
export const LOCALIZING_PAIR = pairsFor('upgraded').localizing;

// A live arm is one whose loop interleaves creation and attachment, whatever
// element kind it ran with.
const isLive = (arm) => /(^|:)live-/.test(arm);

function armAt(perScale, arm) {
	return perScale.map((scale) => {
		const summary = scale.arms[arm];
		if (summary === undefined) throw new TypeError(`no ${arm} arm at ${scale.rows} rows.`);
		return summary;
	});
}

/**
 * Per-node cost of the calls the command stream actually makes — creation and
 * attachment, no browser frame. This is what the prediction is about, because
 * the rate it has to explain was measured as `papi_topology (+ papi_flush)`
 * self time, which is time inside `appendChild` and contains no style, layout,
 * or paint at all.
 *
 * A `split-*` arm reports its attach span, which is the insertion alone. A
 * `live-*` arm cannot separate insertion from creation without a clock read per
 * append, so it reports its whole loop. The two forms are never compared to
 * each other — the prediction compares incremental against bulk within one
 * pair, and both members of a pair are measured the same way.
 */
export function commandRates(perScale, arm) {
	return armAt(perScale, arm).map((summary) =>
		isLive(arm)
			? summary.perNodeUs.buildMs + summary.perNodeUs.attachMs
			: summary.perNodeUs.attachMs,
	);
}

/** Per-node cost of the frame that follows: style, layout, paint. */
export function frameRates(perScale, arm) {
	return armAt(perScale, arm).map((summary) => summary.perNodeUs.frameMs);
}

/**
 * The reading registered before the run: command cost plus the frame. Reported
 * beside `commandRates` and never used to decide, because the frame is 95% of
 * it on this host and swamps the signal the prediction is about. Both readings
 * are printed so the registered one can be checked against the one that
 * matches the comparand.
 */
export function publishRates(perScale, arm) {
	const command = commandRates(perScale, arm);
	return frameRates(perScale, arm).map((frame, index) => command[index] + frame);
}

/**
 * Bulk cost over incremental cost, per scale — the prediction stated as a
 * single number. Above 1 the first-screen shape costs more than the post-mount
 * one; at 1 the platform charges the same for both.
 */
export function shapeGaps(perScale, pair) {
	const incremental = commandRates(perScale, pair.incremental);
	return commandRates(perScale, pair.bulk).map((bulk, index) => bulk / incremental[index]);
}

// The one arm whose attach span is a single call. `live-bulk` appends every row
// into a detached container inside its build loop, so its `attachMs` is only the
// `shadow.appendChild(page)` that publishes the tree — the same one call
// `__FlushElementTree` makes. Every other arm's attach span is thousands of
// appends.
export const PUBLISH_ONLY_ARM = 'live-bulk';

/**
 * The publishing `appendChild` alone, per node. This is the one comparison in
 * this control that is free of per-call instrument overhead on both sides: one
 * call here against the two `papi_flush` calls a first-screen window makes,
 * where every per-element group is thousands of calls measured through an
 * instrument that costs 0.5–0.7 µs each. It is reported on its own because it
 * carries the attribution, and dividing it back out of a table is not something
 * a reader should have to do.
 */
export function publishOnlyRates(perScale, kind) {
	return armAt(perScale, cellName(kind, PUBLISH_ONLY_ARM)).map(
		(summary) => summary.perNodeUs.attachMs,
	);
}

/**
 * What registering the tags costs, per node, at each scale: the `upgraded` cell
 * of an arm minus its `inert` cell. Both are measured in the same window and
 * differ only in whether `customElements.define` ran, so the difference is the
 * platform running one reaction per node — irreducible for anyone whose host
 * elements are custom elements, and therefore part of the floor rather than
 * part of what #148 W2 can attack.
 */
export function reactionCost(perScale, arm) {
	const inert = commandRates(perScale, cellName('inert', arm));
	return commandRates(perScale, cellName('upgraded', arm)).map(
		(upgraded, index) => upgraded - inert[index],
	);
}

function decidePair(perScale, drifts, trends, pair) {
	const incrementalDrift = drifts[pair.incremental] ?? null;
	const bulkDrift = drifts[pair.bulk] ?? null;
	const bulkTrend = trends[pair.bulk] ?? null;
	const evaluable = incrementalDrift !== null && bulkDrift !== null && bulkTrend !== null;
	const incrementalFlat = evaluable && incrementalDrift <= FLAT_DRIFT;
	// A rise, not merely a spread. `drift` is max over min, so a rate that falls
	// with the tree scores exactly like one that grows, and reading it alone
	// would confirm the prediction from data that refutes it.
	const bulkRising = evaluable && bulkDrift > FLAT_DRIFT && bulkTrend > FLAT_DRIFT;
	const gaps = evaluable ? shapeGaps(perScale, pair) : [];
	return {
		pair,
		evaluable,
		incrementalFlat,
		bulkRising,
		gaps,
		// The prediction in one number per scale. A split needs the bulk shape
		// to cost materially more than the incremental one somewhere; charging
		// the same for both is the refutation, whatever either drift does.
		gapOpens: evaluable && gaps.some((gap) => gap > 1 + FLAT_DRIFT),
		// Confirmed only by the full split. Both flat, or both rising, refutes
		// it — and a refutation is the more valuable outcome, since it hands
		// publication's residue back to web-core with a named owner.
		predictionConfirmed: evaluable && incrementalFlat && bulkRising,
	};
}

/**
 * Decide #148 W2's registered prediction: incremental flat per node, bulk
 * rising. The deciding pair is the interleaved one, because it measures in the
 * command stream's own shape and so transfers without a deviation; the
 * localizing pair is reported beside it as corroboration and is never allowed
 * to overturn it.
 *
 * Decided on `commandRates` — the calls the stream makes, no browser frame —
 * because the rate the prediction has to explain was measured as host self time
 * inside PAPI calls and contains no frame either. `publishRates`, the reading
 * registered before the run, is carried through as `registered` so both can be
 * printed and compared rather than one silently replacing the other.
 *
 * Refuses to decide when a drift cannot be computed, because reporting a
 * missing drift as a failed flatness test would publish "refuted" for a run
 * that tested nothing.
 */
export function verdictFor(perScale, arms, pairs = pairsFor('upgraded')) {
	const rates = Object.fromEntries(arms.map((arm) => [arm, commandRates(perScale, arm)]));
	const frames = Object.fromEntries(arms.map((arm) => [arm, frameRates(perScale, arm)]));
	const registered = Object.fromEntries(arms.map((arm) => [arm, publishRates(perScale, arm)]));
	const drifts = Object.fromEntries(arms.map((arm) => [arm, drift(rates[arm])]));
	const trends = Object.fromEntries(arms.map((arm) => [arm, trend(rates[arm])]));
	const deciding = decidePair(perScale, drifts, trends, pairs.deciding);
	const localizing = decidePair(perScale, drifts, trends, pairs.localizing);
	return {
		flatDriftGate: FLAT_DRIFT,
		rates,
		frames,
		registered,
		registeredDrifts: Object.fromEntries(arms.map((arm) => [arm, drift(registered[arm])])),
		drifts,
		trends,
		deciding,
		localizing,
		// The two pairs agreeing is worth reporting and is not what decides:
		// the localizing pair carries a deviation the deciding one does not.
		// `null` when either pair could not be decided at all, because two
		// undecided pairs are not an agreement about anything.
		pairsAgree:
			deciding.evaluable && localizing.evaluable
				? deciding.predictionConfirmed === localizing.predictionConfirmed
				: null,
		evaluable: deciding.evaluable,
		incrementalFlat: deciding.incrementalFlat,
		bulkRising: deciding.bulkRising,
		predictionConfirmed: deciding.predictionConfirmed,
	};
}
