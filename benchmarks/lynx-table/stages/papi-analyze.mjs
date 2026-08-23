// Analysis for the host-side Element PAPI boundary probe (web/driver-client.mjs
// PAPI_INSTRUMENT_JS). Every function here is pure: the runner collects raw
// snapshots, this module decides what they mean, and the unit tests pin the
// decisions without a browser.
//
// The probe observes the Web Core boundary, not a framework, so the same
// grouping and the same attribution identity apply to Octane, ReactLynx, and
// the Vue cells. Nothing here may special-case a cell.

import { requireMinimumRepetitions, summarizeSamples } from './analyze.mjs';

export { interleavedABSchedule, requireMinimumRepetitions, summarizeSamples } from './analyze.mjs';

/**
 * Element PAPI call kinds grouped by what the host does for them. The groups
 * are the attribution vocabulary: a framework's startup or create cost is a
 * count in each group times what that group costs the host.
 */
export const PAPI_GROUPS = Object.freeze({
	papi_create: Object.freeze([
		'__CreatePage',
		'__CreateView',
		'__CreateText',
		'__CreateRawText',
		'__CreateImage',
		'__CreateFrame',
		'__CreateScrollView',
		'__CreateList',
		'__CreateElement',
		'__CreateComponent',
		'__CreateWrapperElement',
	]),
	papi_props: Object.freeze([
		'__SetAttribute',
		'__SetClasses',
		'__AddClass',
		'__SetID',
		'__SetInlineStyles',
		'__AddInlineStyle',
		'__SetCSSId',
		'__SetConfig',
		'__AddConfig',
		'__SetDataset',
		'__AddDataset',
		'__UpdateComponentID',
		'__UpdateComponentInfo',
		'__MarkTemplateElement',
		'__MarkPartElement',
	]),
	papi_events: Object.freeze(['__AddEvent', '__SetEvents', '__UpdateListCallbacks']),
	papi_topology: Object.freeze([
		'__AppendElement',
		'__InsertElementBefore',
		'__RemoveElement',
		'__ReplaceElement',
		'__ReplaceElements',
		'__SwapElement',
	]),
	papi_flush: Object.freeze(['__FlushElementTree']),
});

const GROUP_OF_KIND = new Map();
for (const [group, kinds] of Object.entries(PAPI_GROUPS)) {
	for (const kind of kinds) GROUP_OF_KIND.set(kind, group);
}

/**
 * Group for one PAPI name. Read-only inspection calls (`__Get*`, `__Query*`,
 * `__ElementIsEqual`, tree walks) are `papi_read`; anything the host exposes
 * that this list has not classified is `papi_other`, so a web-core version
 * that adds an entry point shows up as its own segment instead of silently
 * joining an existing one.
 */
export function papiGroup(kind) {
	if (typeof kind !== 'string' || kind.length === 0) {
		throw new TypeError('PAPI kind must be a non-empty string.');
	}
	const known = GROUP_OF_KIND.get(kind);
	if (known !== undefined) return known;
	if (/^__(Get|Query|First|Last|Next|ElementIsEqual)/.test(kind)) return 'papi_read';
	return 'papi_other';
}

export const PAPI_GROUP_NAMES = Object.freeze([
	'papi_create',
	'papi_props',
	'papi_events',
	'papi_topology',
	'papi_read',
	'papi_other',
	'papi_flush',
]);

function finite(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${label} must be a finite number.`);
	}
	return value;
}

function nonNegative(value, label) {
	if (finite(value, label) < 0) throw new TypeError(`${label} must not be negative.`);
	return value;
}

/**
 * Validate one raw probe snapshot and fold it into per-group counts and
 * exclusive host time. A snapshot that never attached is an error, never a
 * zero: a silent zero would read as "this framework issued no host calls".
 */
export function summarizePapiSnapshot(snapshot, label = 'PAPI snapshot') {
	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		throw new TypeError(`${label} must be an object.`);
	}
	if (snapshot.attached !== true) {
		throw new Error(`${label} did not attach to the Element PAPI boundary.`);
	}
	if (snapshot.kinds === null || typeof snapshot.kinds !== 'object') {
		throw new TypeError(`${label} must carry a kinds record.`);
	}
	const groups = {};
	for (const name of PAPI_GROUP_NAMES) groups[name] = { calls: 0, selfMs: 0 };
	const kinds = {};
	let calls = 0;
	let selfMs = 0;
	for (const kind of Object.keys(snapshot.kinds)) {
		const bucket = snapshot.kinds[kind];
		if (bucket === null || typeof bucket !== 'object') {
			throw new TypeError(`${label}.kinds.${kind} must be an object.`);
		}
		const entry = {
			calls: nonNegative(bucket.calls, `${label}.kinds.${kind}.calls`),
			selfMs: nonNegative(bucket.selfMs, `${label}.kinds.${kind}.selfMs`),
			group: papiGroup(kind),
		};
		if (entry.calls === 0 && entry.selfMs === 0) continue;
		kinds[kind] = entry;
		groups[entry.group].calls += entry.calls;
		groups[entry.group].selfMs += entry.selfMs;
		calls += entry.calls;
		selfMs += entry.selfMs;
	}
	const timers = snapshot.timers !== false;
	const flushCount = nonNegative(snapshot.flushCount ?? 0, `${label}.flushCount`);
	const detailLimit = nonNegative(snapshot.flushDetailLimit ?? 0, `${label}.flushDetailLimit`);
	const flushes = Array.isArray(snapshot.flushes) ? snapshot.flushes : [];
	return {
		timers,
		calls,
		selfMs,
		firstCallEpoch: snapshot.firstCallEpoch ?? null,
		lastCallEpoch: snapshot.lastCallEpoch ?? null,
		flushCount,
		flushSelfMs: nonNegative(snapshot.flushSelfMs ?? 0, `${label}.flushSelfMs`),
		// A truncated cadence trace must never read as a complete one.
		flushesTruncated: flushCount > flushes.length,
		flushDetailLimit: detailLimit,
		flushes: flushes.map((flush, index) => ({
			index: nonNegative(flush.index ?? index, `${label}.flushes[${index}].index`),
			startEpoch: finite(flush.startEpoch, `${label}.flushes[${index}].startEpoch`),
			endEpoch: finite(flush.endEpoch, `${label}.flushes[${index}].endEpoch`),
			selfMs: nonNegative(flush.selfMs, `${label}.flushes[${index}].selfMs`),
			callsBefore: nonNegative(flush.callsBefore, `${label}.flushes[${index}].callsBefore`),
		})),
		groups,
		kinds,
	};
}

/**
 * The attribution identity for one measured interval:
 *
 *   wall = start_delay + Σ group host self time + off_boundary
 *
 * `start_delay` is the observed gap from the interval's start boundary to the
 * first host call, every group term is directly observed and exclusive, and
 * `off_boundary` is the named exclusive remainder — framework script plus the
 * browser's own style, layout, paint, and observer-frame delay, which the host
 * exposes no boundary for. It is a remainder, never a guess, and the analyzer
 * refuses a sample whose observed parts exceed its wall clock.
 */
export function analyzeBoundarySample({ wallMs, startEpoch, papi }, label = 'sample') {
	const totalMs = nonNegative(wallMs, `${label} wallMs`);
	const summary = summarizePapiSnapshot(papi, `${label} PAPI snapshot`);
	const start = finite(startEpoch, `${label} startEpoch`);
	if (summary.calls === 0) throw new Error(`${label} observed no Element PAPI calls.`);
	if (!summary.timers) {
		// A counts build reports zero host time because it never read the clock,
		// which must never be mistaken for host work that cost nothing.
		throw new Error(`${label} came from a counts-only probe; it carries no host timing.`);
	}
	const firstCall = finite(summary.firstCallEpoch, `${label} firstCallEpoch`);
	const startDelayMs = Math.max(0, firstCall - start);
	const stages = { start_delay: startDelayMs };
	for (const name of PAPI_GROUP_NAMES) {
		if (summary.groups[name].calls === 0) continue;
		stages[name] = summary.groups[name].selfMs;
	}
	const observed = Object.values(stages).reduce((sum, value) => sum + value, 0);
	if (observed - totalMs > 0.5) {
		throw new Error(`${label} directly observed stages exceed the wall clock.`);
	}
	return {
		totalMs,
		stages: { ...stages, off_boundary: Math.max(0, totalMs - observed) },
		counts: {
			calls: summary.calls,
			flushCount: summary.flushCount,
			byGroup: Object.fromEntries(
				PAPI_GROUP_NAMES.filter((name) => summary.groups[name].calls > 0).map((name) => [
					name,
					summary.groups[name].calls,
				]),
			),
			byKind: Object.fromEntries(
				Object.keys(summary.kinds).map((kind) => [kind, summary.kinds[kind].calls]),
			),
		},
		flushes: summary.flushes,
		flushesTruncated: summary.flushesTruncated,
	};
}

/**
 * The counts build's view of a window: wall clock, start delay, host call
 * counts, and flush cadence — everything the probe can observe without a
 * per-call clock read, so the wall clock it reports stays representative.
 */
export function analyzeCountsSample({ wallMs, startEpoch, papi }, label = 'sample') {
	const totalMs = nonNegative(wallMs, `${label} wallMs`);
	const summary = summarizePapiSnapshot(papi, `${label} PAPI snapshot`);
	if (summary.calls === 0) throw new Error(`${label} observed no Element PAPI calls.`);
	const start = finite(startEpoch, `${label} startEpoch`);
	const firstCall = finite(summary.firstCallEpoch, `${label} firstCallEpoch`);
	return {
		totalMs,
		startDelayMs: Math.max(0, firstCall - start),
		counts: {
			calls: summary.calls,
			flushCount: summary.flushCount,
			byGroup: Object.fromEntries(
				PAPI_GROUP_NAMES.filter((name) => summary.groups[name].calls > 0).map((name) => [
					name,
					summary.groups[name].calls,
				]),
			),
			byKind: Object.fromEntries(
				Object.keys(summary.kinds).map((kind) => [kind, summary.kinds[kind].calls]),
			),
		},
		flushes: summary.flushes,
		flushesTruncated: summary.flushesTruncated,
	};
}

/**
 * A balanced order over more than two variants in one host window: repetition
 * `i` starts at variant `i % variants.length`, so no variant sits at a fixed
 * position in the sequence and any drift over the window is shared out evenly.
 */
export function rotatedSchedule(repetitions, variants) {
	const count = requireMinimumRepetitions(repetitions);
	if (!Array.isArray(variants) || variants.length === 0) {
		throw new TypeError('a rotated schedule needs at least one variant.');
	}
	return Array.from({ length: count }, (_, index) =>
		variants.map((_unused, position) => variants[(index + position) % variants.length]),
	);
}

/** Median/min/max/spread over a numeric sample, reusing the stage protocol. */
function statOf(values, label) {
	return summarizeSamples(
		values.map((value) => ({ totalMs: nonNegative(value, label), stages: { raw: value } })),
	).total;
}

/**
 * Fold repeated boundary samples for one cell into medians: wall clock, the
 * stage attribution, per-op counts, and the derived per-row and per-call rates
 * that make two cells comparable at different op counts.
 */
export function summarizeCell(samples, { rows = null } = {}) {
	requireMinimumRepetitions(samples.length);
	// A group absent from one repetition is a zero for that repetition, not a
	// missing stage: summarizing over the union keeps every sample comparable.
	const stageNames = new Set();
	for (const sample of samples) {
		for (const name of Object.keys(sample.stages)) stageNames.add(name);
	}
	const ordered = ['start_delay', ...PAPI_GROUP_NAMES, 'off_boundary'].filter((name) =>
		stageNames.has(name),
	);
	const attribution = summarizeSamples(
		samples.map((sample) => ({
			totalMs: sample.totalMs,
			stages: Object.fromEntries(ordered.map((name) => [name, sample.stages[name] ?? 0])),
		})),
	);
	const counts = {};
	const countNames = new Set();
	for (const sample of samples) {
		for (const name of Object.keys(sample.counts.byGroup)) countNames.add(name);
	}
	for (const name of countNames) {
		counts[name] = statOf(
			samples.map((sample) => sample.counts.byGroup[name] ?? 0),
			`${name} count`,
		);
	}
	const kindNames = new Set();
	for (const sample of samples) {
		for (const name of Object.keys(sample.counts.byKind)) kindNames.add(name);
	}
	const kinds = {};
	for (const name of kindNames) {
		kinds[name] = statOf(
			samples.map((sample) => sample.counts.byKind[name] ?? 0),
			`${name} count`,
		);
	}
	const calls = statOf(
		samples.map((sample) => sample.counts.calls),
		'calls',
	);
	const flushCount = statOf(
		samples.map((sample) => sample.counts.flushCount),
		'flushCount',
	);
	// Host self time excluding flush: the per-op rate that a cell's op count is
	// multiplied by. Flush is a separate owner with its own cadence.
	const opSelfMs = PAPI_GROUP_NAMES.filter((name) => name !== 'papi_flush').reduce(
		(sum, name) => sum + (attribution.stages[name]?.median ?? 0),
		0,
	);
	return {
		...attribution,
		counts: { calls, flushCount, byGroup: counts, byKind: kinds },
		rates: {
			opSelfMs,
			msPerOp: calls.median === 0 ? null : opSelfMs / calls.median,
			opsPerRow: rows === null || rows === 0 ? null : calls.median / rows,
			flushSelfMs: attribution.stages.papi_flush?.median ?? 0,
			msPerFlush:
				flushCount.median === 0
					? null
					: (attribution.stages.papi_flush?.median ?? 0) / flushCount.median,
		},
		rows,
	};
}

/**
 * Fold repeated counts-build samples into medians. This is the certified view:
 * its wall clock carries no per-call clock reads, and its call counts are the
 * control on the timed build — the same workload must produce the same counts
 * whatever the probe cost.
 */
export function summarizeCounts(samples, { rows = null } = {}) {
	requireMinimumRepetitions(samples.length);
	const kindNames = new Set();
	for (const sample of samples) {
		for (const name of Object.keys(sample.counts.byKind)) kindNames.add(name);
	}
	const byKind = {};
	for (const name of kindNames) {
		byKind[name] = statOf(
			samples.map((sample) => sample.counts.byKind[name] ?? 0),
			`${name} count`,
		);
	}
	const calls = statOf(
		samples.map((sample) => sample.counts.calls),
		'calls',
	);
	return {
		total: statOf(
			samples.map((sample) => sample.totalMs),
			'wall',
		),
		startDelay: statOf(
			samples.map((sample) => sample.startDelayMs),
			'start delay',
		),
		counts: {
			calls,
			flushCount: statOf(
				samples.map((sample) => sample.counts.flushCount),
				'flushCount',
			),
			byKind,
		},
		opsPerRow: rows === null || rows === 0 ? null : calls.median / rows,
		rows,
	};
}

/**
 * Call counts must not depend on whether the probe read the clock. A mismatch
 * means the timed build perturbed what the framework did, not just how long it
 * took, and the timed build's shares would then describe a different workload.
 */
export function countsAgree(timed, counted) {
	const names = new Set([
		...Object.keys(timed.counts.byKind),
		...Object.keys(counted.counts.byKind),
	]);
	const mismatches = [];
	for (const name of names) {
		const left = timed.counts.byKind[name]?.median ?? 0;
		const right = counted.counts.byKind[name]?.median ?? 0;
		if (left !== right) mismatches.push({ kind: name, timed: left, counts: right });
	}
	return {
		agree: mismatches.length === 0,
		mismatches,
		timedCalls: timed.counts.calls.median,
		countsCalls: counted.counts.calls.median,
	};
}

const DELTA_GATE = 0.1;

/**
 * Split the subject-minus-reference wall-clock delta into directly observed
 * owners. The count/rate split is exact: for the host-op term,
 *
 *   Δ(op host time) = (Δcalls × reference ms/op) + (subject calls × Δ ms/op)
 *
 * so "the subject issues more host calls" (publication op count) and "the
 * subject's calls are more expensive each" (per-element stream shape) are two
 * separate owners rather than one lump. Flush cadence and start delay are
 * observed directly, and `off_boundary` carries framework script plus the
 * browser's own paint work, which no host boundary separates.
 */
export function attributeDelta({ subject, reference, gate = DELTA_GATE }) {
	const deltaMs = subject.total.median - reference.total.median;
	const referenceMsPerOp = reference.rates.msPerOp ?? 0;
	const deltaCalls = subject.counts.calls.median - reference.counts.calls.median;
	const opCountMs = deltaCalls * referenceMsPerOp;
	const opRateMs = subject.rates.opSelfMs - reference.rates.opSelfMs - opCountMs;
	const flushMs = subject.rates.flushSelfMs - reference.rates.flushSelfMs;
	const startDelayMs =
		(subject.stages.start_delay?.median ?? 0) - (reference.stages.start_delay?.median ?? 0);
	const offBoundaryMs =
		(subject.stages.off_boundary?.median ?? 0) - (reference.stages.off_boundary?.median ?? 0);
	const owners = [
		{
			id: 'publication_op_count',
			hypothesis: 'Publication op count',
			deltaMs: opCountMs,
			evidence: `${subject.counts.calls.median} vs ${reference.counts.calls.median} host calls at ${referenceMsPerOp.toFixed(4)} ms/op (reference rate)`,
		},
		{
			id: 'flush_cadence',
			hypothesis: 'Flush cadence',
			deltaMs: flushMs,
			evidence: `${subject.counts.flushCount.median} vs ${reference.counts.flushCount.median} __FlushElementTree calls`,
		},
		{
			id: 'first_paint_scheduling',
			hypothesis: 'First-paint scheduling',
			deltaMs: startDelayMs,
			evidence: `${(subject.stages.start_delay?.median ?? 0).toFixed(1)} vs ${(reference.stages.start_delay?.median ?? 0).toFixed(1)} ms to the first host call`,
		},
		{
			id: 'per_element_stream_shape',
			hypothesis: 'Per-element creation stream shape',
			deltaMs: opRateMs,
			evidence: `${(subject.rates.msPerOp ?? 0).toFixed(4)} vs ${referenceMsPerOp.toFixed(4)} ms of host time per call`,
		},
		{
			id: 'off_boundary',
			hypothesis: 'Framework script and browser paint outside the host boundary',
			deltaMs: offBoundaryMs,
			evidence: `${(subject.stages.off_boundary?.median ?? 0).toFixed(1)} vs ${(reference.stages.off_boundary?.median ?? 0).toFixed(1)} ms off the host boundary`,
		},
	].map((owner) => {
		// A candidate owner is authorized only by a positive, directly observed
		// contribution of at least the gate share of the delta. A negative
		// contribution means the subject is already cheaper there.
		const share = deltaMs <= 0 ? null : owner.deltaMs / deltaMs;
		return { ...owner, share, verdict: share !== null && share >= gate ? 'GO' : 'NO-GO' };
	});
	const attributedMs = owners.reduce((sum, owner) => sum + owner.deltaMs, 0);
	const unattributedMs = deltaMs - attributedMs;
	return {
		deltaMs,
		gate,
		owners,
		attributedMs,
		unattributedMs,
		unattributedShare: deltaMs === 0 ? 0 : Math.abs(unattributedMs / deltaMs),
	};
}

/**
 * Per-row op and flush counts across scales. Linear publication means constant
 * ops per row; the verdict names the observed spread rather than asserting
 * linearity, so a nonlinearity is reported instead of being smoothed away.
 */
export function scalingVerdict(byRows, { tolerance = 0.05 } = {}) {
	const scales = Object.keys(byRows)
		.map(Number)
		.sort((left, right) => left - right);
	if (scales.length < 2) throw new Error('scaling needs at least two scales.');
	const points = scales.map((rows) => ({
		rows,
		opsPerRow: byRows[rows].counts.calls.median / rows,
		flushCount: byRows[rows].counts.flushCount.median,
	}));
	const values = points.map((point) => point.opsPerRow);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const drift = min === 0 ? Infinity : max / min - 1;
	const flushes = points.map((point) => point.flushCount);
	return {
		points,
		opsPerRowDrift: drift,
		linear: drift <= tolerance,
		flushConstant: Math.min(...flushes) === Math.max(...flushes),
		tolerance,
	};
}

/** Same-window probe/control overhead, gated at the declared ceiling. */
export function overheadVerdict(probeMs, controlMs, { ceiling = 1.05 } = {}) {
	const probe = statOf(probeMs, 'probe wall');
	const control = statOf(controlMs, 'control wall');
	const ratio = control.median === 0 ? null : probe.median / control.median;
	return {
		probe,
		control,
		ratio,
		ceiling,
		withinCeiling: ratio !== null && ratio <= ceiling,
	};
}
