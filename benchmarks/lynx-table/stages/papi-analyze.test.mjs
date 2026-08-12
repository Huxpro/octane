import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PAPI_GROUP_NAMES,
	analyzeBoundarySample,
	attributeDelta,
	overheadVerdict,
	papiGroup,
	scalingVerdict,
	analyzeCountsSample,
	rotatedSchedule,
	summarizeCell,
	summarizeCounts,
	countsAgree,
	summarizePapiSnapshot,
} from './papi-analyze.mjs';

function snapshot(overrides = {}) {
	return {
		attached: true,
		firstCallEpoch: 1000,
		lastCallEpoch: 1090,
		flushCount: 1,
		flushSelfMs: 4,
		flushDetailLimit: 64,
		flushes: [{ index: 0, startEpoch: 1080, endEpoch: 1084, selfMs: 4, callsBefore: 3 }],
		kinds: {
			__CreateView: { calls: 2, selfMs: 6 },
			__SetAttribute: { calls: 1, selfMs: 2 },
			__FlushElementTree: { calls: 1, selfMs: 4 },
		},
		...overrides,
	};
}

test('groups every host call kind, and names unclassified ones instead of hiding them', () => {
	assert.equal(papiGroup('__CreateRawText'), 'papi_create');
	assert.equal(papiGroup('__SetClasses'), 'papi_props');
	assert.equal(papiGroup('__AddEvent'), 'papi_events');
	assert.equal(papiGroup('__InsertElementBefore'), 'papi_topology');
	assert.equal(papiGroup('__FlushElementTree'), 'papi_flush');
	assert.equal(papiGroup('__GetElementUniqueID'), 'papi_read');
	assert.equal(papiGroup('__SomeFutureWebCoreEntryPoint'), 'papi_other');
	assert.throws(() => papiGroup(''), /non-empty string/);
});

test('refuses a snapshot that never reached the host boundary', () => {
	assert.throws(
		() => summarizePapiSnapshot(snapshot({ attached: false })),
		/did not attach to the Element PAPI boundary/,
	);
	assert.throws(() => summarizePapiSnapshot(null), /must be an object/);
	assert.throws(
		() => summarizePapiSnapshot(snapshot({ kinds: { __CreateView: { calls: -1, selfMs: 0 } } })),
		/must not be negative/,
	);
});

test('folds a snapshot into per-group calls and exclusive host time', () => {
	const summary = summarizePapiSnapshot(snapshot());
	assert.equal(summary.calls, 4);
	assert.equal(summary.selfMs, 12);
	assert.deepEqual(summary.groups.papi_create, { calls: 2, selfMs: 6 });
	assert.deepEqual(summary.groups.papi_props, { calls: 1, selfMs: 2 });
	assert.deepEqual(summary.groups.papi_flush, { calls: 1, selfMs: 4 });
	assert.equal(summary.flushesTruncated, false);
});

test('marks a cadence trace that outran its detail limit', () => {
	const summary = summarizePapiSnapshot(snapshot({ flushCount: 200 }));
	assert.equal(summary.flushCount, 200);
	assert.equal(summary.flushesTruncated, true);
});

test('attributes wall clock to start delay, host groups, and a named remainder', () => {
	const analyzed = analyzeBoundarySample({ wallMs: 100, startEpoch: 990, papi: snapshot() });
	assert.deepEqual(analyzed.stages, {
		start_delay: 10,
		papi_create: 6,
		papi_props: 2,
		papi_flush: 4,
		off_boundary: 78,
	});
	assert.equal(analyzed.counts.calls, 4);
	assert.equal(analyzed.counts.flushCount, 1);
	assert.deepEqual(analyzed.counts.byKind, {
		__CreateView: 2,
		__SetAttribute: 1,
		__FlushElementTree: 1,
	});
});

test('refuses a sample whose observed host time exceeds its wall clock', () => {
	assert.throws(
		() => analyzeBoundarySample({ wallMs: 5, startEpoch: 990, papi: snapshot() }),
		/exceed the wall clock/,
	);
	assert.throws(
		() =>
			analyzeBoundarySample({
				wallMs: 100,
				startEpoch: 990,
				papi: snapshot({ kinds: {}, flushCount: 0, flushSelfMs: 0, flushes: [] }),
			}),
		/observed no Element PAPI calls/,
	);
});

function cell({ wall, create, props, flush, calls, flushCount, startDelay = 5 }) {
	return Array.from({ length: 5 }, () => ({
		totalMs: wall,
		stages: {
			start_delay: startDelay,
			papi_create: create,
			papi_props: props,
			papi_flush: flush,
			off_boundary: wall - startDelay - create - props - flush,
		},
		counts: {
			calls,
			flushCount,
			byGroup: { papi_create: calls - 1, papi_props: 1, papi_flush: flushCount },
			byKind: { __CreateView: calls - 1, __SetAttribute: 1 },
		},
	}));
}

test('summarizes a cell into medians, counts, and comparable per-op rates', () => {
	const summary = summarizeCell(
		cell({ wall: 200, create: 40, props: 10, flush: 8, calls: 100, flushCount: 2 }),
		{ rows: 50 },
	);
	assert.equal(summary.total.median, 200);
	assert.equal(summary.counts.calls.median, 100);
	// Host op time is every group except flush; start delay and flush cadence
	// are separate owners and must not inflate the per-op rate.
	assert.equal(summary.rates.opSelfMs, 50);
	assert.equal(summary.rates.msPerOp, 0.5);
	assert.equal(summary.rates.opsPerRow, 2);
	assert.equal(summary.rates.flushSelfMs, 8);
	assert.equal(summary.rates.msPerFlush, 4);
	for (const name of Object.keys(summary.stages)) {
		assert.ok(['start_delay', 'off_boundary', ...PAPI_GROUP_NAMES].includes(name));
	}
});

test('summarizes cells whose repetitions did not all touch the same host groups', () => {
	const samples = cell({ wall: 200, create: 40, props: 10, flush: 8, calls: 100, flushCount: 2 });
	delete samples[0].stages.papi_props;
	const summary = summarizeCell(samples, { rows: 50 });
	assert.equal(summary.stages.papi_props.min, 0);
	assert.equal(summary.stages.papi_props.median, 10);
});

test('splits the delta into count, rate, flush, scheduling, and off-boundary owners', () => {
	// Reference: 100 calls costing 45 ms of host op time (0.45 ms/op).
	const reference = summarizeCell(
		cell({ wall: 200, create: 40, props: 5, flush: 10, calls: 100, flushCount: 1, startDelay: 5 }),
		{ rows: 50 },
	);
	// Subject: 200 calls at that same rate, twice the flush time, and the same
	// scheduling and off-boundary cost, so the delta is op count plus flush.
	const subject = summarizeCell(
		cell({ wall: 255, create: 85, props: 5, flush: 20, calls: 200, flushCount: 2, startDelay: 5 }),
		{ rows: 50 },
	);
	const attributed = attributeDelta({ subject, reference });
	assert.equal(attributed.deltaMs, 55);
	const owners = Object.fromEntries(attributed.owners.map((owner) => [owner.id, owner]));
	assert.equal(owners.publication_op_count.deltaMs, 45);
	assert.equal(owners.publication_op_count.verdict, 'GO');
	assert.equal(owners.per_element_stream_shape.deltaMs, 0);
	assert.equal(owners.per_element_stream_shape.verdict, 'NO-GO');
	assert.equal(owners.flush_cadence.deltaMs, 10);
	assert.equal(owners.flush_cadence.verdict, 'GO');
	assert.equal(owners.first_paint_scheduling.deltaMs, 0);
	assert.equal(owners.off_boundary.deltaMs, 0);
	// The five owners are an identity over the delta, so nothing is unexplained.
	assert.equal(attributed.unattributedMs, 0);
	assert.equal(attributed.unattributedShare, 0);
});

test('separates a rate owner from a count owner at equal call counts', () => {
	const reference = summarizeCell(
		cell({ wall: 200, create: 40, props: 5, flush: 10, calls: 100, flushCount: 1 }),
		{ rows: 50 },
	);
	const subject = summarizeCell(
		cell({ wall: 250, create: 90, props: 5, flush: 10, calls: 100, flushCount: 1 }),
		{ rows: 50 },
	);
	const owners = Object.fromEntries(
		attributeDelta({ subject, reference }).owners.map((owner) => [owner.id, owner]),
	);
	assert.equal(owners.publication_op_count.deltaMs, 0);
	assert.equal(owners.per_element_stream_shape.deltaMs, 50);
	assert.equal(owners.per_element_stream_shape.verdict, 'GO');
});

test('reports per-row op counts across scales instead of assuming linearity', () => {
	const at = (rows, calls, flushCount) =>
		summarizeCell(cell({ wall: 100, create: 10, props: 5, flush: 5, calls, flushCount }), { rows });
	const linear = scalingVerdict({ 1000: at(1000, 10000, 1), 10000: at(10000, 100000, 1) });
	assert.equal(linear.linear, true);
	assert.equal(linear.flushConstant, true);
	assert.deepEqual(
		linear.points.map((point) => point.opsPerRow),
		[10, 10],
	);
	const superlinear = scalingVerdict({ 1000: at(1000, 10000, 1), 10000: at(10000, 200000, 3) });
	assert.equal(superlinear.linear, false);
	assert.equal(superlinear.flushConstant, false);
	assert.equal(superlinear.opsPerRowDrift, 1);
	assert.throws(() => scalingVerdict({ 1000: at(1000, 10000, 1) }), /at least two scales/);
});

test('gates probe overhead against the declared same-window ceiling', () => {
	const within = overheadVerdict([102, 103, 104, 105, 106], [100, 101, 102, 103, 104]);
	assert.equal(within.ratio, 104 / 102);
	assert.equal(within.withinCeiling, true);
	const beyond = overheadVerdict([130, 131, 132, 133, 134], [100, 101, 102, 103, 104]);
	assert.equal(beyond.withinCeiling, false);
});

test('rotates variant order so no variant sits at a fixed position', () => {
	assert.deepEqual(rotatedSchedule(5, ['control', 'counts', 'timed']), [
		['control', 'counts', 'timed'],
		['counts', 'timed', 'control'],
		['timed', 'control', 'counts'],
		['control', 'counts', 'timed'],
		['counts', 'timed', 'control'],
	]);
	assert.throws(() => rotatedSchedule(5, []), /at least one variant/);
	assert.throws(() => rotatedSchedule(4, ['a', 'b']), /at least 5/);
});

test('refuses to read host timing out of a counts-only probe', () => {
	const counted = snapshot({ timers: false, kinds: { __CreateView: { calls: 7, selfMs: 0 } } });
	assert.throws(
		() => analyzeBoundarySample({ wallMs: 100, startEpoch: 990, papi: counted }),
		/counts-only probe/,
	);
	const analyzed = analyzeCountsSample({ wallMs: 100, startEpoch: 990, papi: counted });
	assert.equal(analyzed.totalMs, 100);
	assert.equal(analyzed.startDelayMs, 10);
	assert.equal(analyzed.counts.calls, 7);
});

test('holds the timed build to the counts build it must reproduce', () => {
	const countsSamples = Array.from({ length: 5 }, () => ({
		totalMs: 100,
		startDelayMs: 5,
		counts: {
			calls: 30,
			flushCount: 1,
			byGroup: {},
			byKind: { __CreateView: 29, __FlushElementTree: 1 },
		},
	}));
	const counted = summarizeCounts(countsSamples, { rows: 10 });
	assert.equal(counted.opsPerRow, 3);
	const timed = summarizeCell(
		cell({ wall: 130, create: 20, props: 0, flush: 5, calls: 30, flushCount: 1 }),
		{ rows: 10 },
	);
	// The fixture's timed byKind is __CreateView/__SetAttribute, so the kinds
	// genuinely differ and the control must say so rather than pass silently.
	const mismatched = countsAgree(timed, counted);
	assert.equal(mismatched.agree, false);
	assert.ok(mismatched.mismatches.some((entry) => entry.kind === '__FlushElementTree'));
	assert.equal(countsAgree(counted, counted).agree, true);
});
