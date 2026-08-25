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

// The slack the boundary identity already allows itself when comparing directly
// observed parts against a wall clock two different clock reads produced.
const TOLERANCE_MS = 0.5;

function nonNegative(value, label) {
	if (finite(value, label) < 0) throw new TypeError(`${label} must not be negative.`);
	return value;
}

/** First-screen phases, in the order the framework runs them. */
export const FIRST_SCREEN_PHASES = Object.freeze(['render', 'publish', 'capture', 'announce']);

/**
 * One validator for the `--label` output stem, shared by the run that writes
 * evidence and the report that re-renders it — two copies could drift until a
 * run writes files its own report tool refuses to read.
 */
export function requireOutputStem(value) {
	const stem = value.trim();
	if (!/^[a-z0-9][a-z0-9-]*$/.test(stem)) {
		throw new TypeError('--label must be lowercase alphanumeric with dashes.');
	}
	return stem;
}

/**
 * Validate the framework-side first-screen split a profile build publishes, or
 * return null for a page that carries none.
 *
 * A page without a profile build is the normal case — the shipping octane cell
 * and both vendored reference bundles all report null here — so absence is not
 * an error. What is an error is a half-present split: the two sides only mean
 * something together, because a phase's off-boundary cost is its wall span
 * minus the host time observed inside it.
 */
function summarizeFirstScreenSplit(split, label) {
	if (split === null || split === undefined) return null;
	if (typeof split !== 'object' || Array.isArray(split)) {
		throw new TypeError(`${label} must be an object when present.`);
	}
	if (split.wallMs === null || typeof split.wallMs !== 'object') {
		throw new TypeError(`${label}.wallMs must carry the framework phase spans.`);
	}
	if (split.byPhase === null || typeof split.byPhase !== 'object') {
		throw new TypeError(`${label}.byPhase must carry the observed host time per phase.`);
	}
	if (split.open !== null && split.open !== undefined) {
		// A phase still open when the window was read means the first screen never
		// finished, so its spans describe a run that is still going.
		throw new Error(`${label} was read while its ${split.open} phase was still open.`);
	}
	const wallMs = {};
	const byPhase = {};
	for (const phase of FIRST_SCREEN_PHASES) {
		wallMs[phase] = nonNegative(split.wallMs[phase] ?? 0, `${label}.wallMs.${phase}`);
		const bucket = split.byPhase[phase];
		byPhase[phase] = {
			calls: nonNegative(bucket?.calls ?? 0, `${label}.byPhase.${phase}.calls`),
			selfMs: nonNegative(bucket?.selfMs ?? 0, `${label}.byPhase.${phase}.selfMs`),
		};
	}
	for (const phase of Object.keys(split.byPhase)) {
		if (!FIRST_SCREEN_PHASES.includes(phase)) {
			throw new Error(`${label}.byPhase carries an unknown phase ${phase}.`);
		}
	}
	// Refuse unknown wall spans on the same terms as unknown call buckets. A
	// phase that crosses no host boundary creates no byPhase bucket, so this is
	// the only guard that catches a probe publishing a phase this analyzer does
	// not know — otherwise its span would silently land in the residue and read
	// as the browser's cost.
	for (const phase of Object.keys(split.wallMs)) {
		if (!FIRST_SCREEN_PHASES.includes(phase)) {
			throw new Error(`${label}.wallMs carries an unknown phase ${phase}.`);
		}
	}
	return { timers: split.timers !== false, wallMs, byPhase };
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
		firstScreen: summarizeFirstScreenSplit(snapshot.firstScreen, `${label}.firstScreen`),
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
 * Split `off_boundary` into the framework's own first-screen phases and the
 * residue nothing framework-side claims.
 *
 * `off_boundary` is the exclusive remainder of the boundary identity: everything
 * in the window that is neither a host call nor the pre-boundary start delay. It
 * holds three things at once — the framework's first-screen script, web-core's
 * own JS between host calls, and the browser's style, layout, paint, and the
 * frame the FCP predicate observes. Only the first is the framework's to reduce,
 * and only the last is a platform floor, so leaving them fused is what makes the
 * remainder unattributable.
 *
 * Each phase contributes `wall - selfMs`: the time the framework spent in that
 * phase, less the host time this boundary observed inside it. Subtracting the
 * observed host time is what keeps the split from double-counting work the
 * group terms already carry — publish is mostly host calls, and capture reads a
 * native ID per record.
 *
 * The residue is what is left. It is a remainder like `off_boundary` itself,
 * never a guess, and a split that claims more than `off_boundary` holds is
 * refused rather than clamped: that can only mean the two clocks disagree or the
 * probe is reporting a different window than the one being analyzed, and a
 * quietly clamped residue would hide both.
 */
function splitOffBoundary(split, offBoundaryMs, label) {
	if (split === null) return null;
	const ran = FIRST_SCREEN_PHASES.some(
		(phase) => split.wallMs[phase] > 0 || split.byPhase[phase].calls > 0,
	);
	// A window that contains no first screen has nothing to split. Its
	// `off_boundary` belongs to whatever else ran — an update path, say — and
	// reporting the whole of it as the residue would read as a platform floor.
	if (!ran) return null;
	if (!split.timers) {
		// A counts build fills the phase buckets with calls and a zero selfMs, so
		// subtracting them would credit every phase with its whole wall span.
		throw new Error(`${label} first-screen split came from a counts-only probe.`);
	}
	const phases = {};
	let claimed = 0;
	for (const phase of FIRST_SCREEN_PHASES) {
		const wallMs = split.wallMs[phase];
		const selfMs = split.byPhase[phase].selfMs;
		if (selfMs - wallMs > TOLERANCE_MS) {
			throw new Error(
				`${label} first-screen phase ${phase} observed more host time than it lasted.`,
			);
		}
		const phaseOffBoundaryMs = Math.max(0, wallMs - selfMs);
		phases[phase] = {
			wallMs,
			selfMs,
			calls: split.byPhase[phase].calls,
			offBoundaryMs: phaseOffBoundaryMs,
		};
		claimed += phaseOffBoundaryMs;
	}
	if (claimed - offBoundaryMs > TOLERANCE_MS) {
		throw new Error(`${label} first-screen phases claim more than off_boundary holds.`);
	}
	return {
		offBoundaryMs,
		phases,
		frameworkMs: claimed,
		// web-core's own script plus the browser's frame: the half a speed-of-light
		// control has to be built against rather than optimized.
		residueMs: Math.max(0, offBoundaryMs - claimed),
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
	if (observed - totalMs > TOLERANCE_MS) {
		throw new Error(`${label} directly observed stages exceed the wall clock.`);
	}
	const offBoundaryMs = Math.max(0, totalMs - observed);
	return {
		totalMs,
		stages: { ...stages, off_boundary: offBoundaryMs },
		firstScreen: splitOffBoundary(summary.firstScreen, offBoundaryMs, label),
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
/**
 * Fold every sample's first-screen split into medians, or null for a cell whose
 * pages carried no profile build.
 *
 * A run where only some samples carried the probe is refused rather than
 * summarized over the ones that did: the samples alternate cells within one
 * window by design, so a partial split means the pages disagreed about what they
 * were measuring, and a median over the half that reported would read as if the
 * whole run had.
 */
function summarizeFirstScreenSplits(samples) {
	const present = samples.filter(
		(sample) => sample.firstScreen !== null && sample.firstScreen !== undefined,
	);
	if (present.length === 0) return null;
	if (present.length !== samples.length) {
		throw new Error(
			`only ${present.length} of ${samples.length} samples carried a first-screen split.`,
		);
	}
	const phases = {};
	for (const phase of FIRST_SCREEN_PHASES) {
		phases[phase] = {
			offBoundaryMs: statOf(
				present.map((sample) => sample.firstScreen.phases[phase].offBoundaryMs),
				`${phase} off-boundary`,
			),
			selfMs: statOf(
				present.map((sample) => sample.firstScreen.phases[phase].selfMs),
				`${phase} host self time`,
			),
			calls: statOf(
				present.map((sample) => sample.firstScreen.phases[phase].calls),
				`${phase} calls`,
			),
		};
	}
	return {
		phases,
		frameworkMs: statOf(
			present.map((sample) => sample.firstScreen.frameworkMs),
			'framework first-screen off-boundary',
		),
		residueMs: statOf(
			present.map((sample) => sample.firstScreen.residueMs),
			'off-boundary residue',
		),
	};
}

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
		firstScreen: summarizeFirstScreenSplits(samples),
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
