// The profile is folded by matching string literals in a minified bundle, so
// what is worth pinning is not a bucket's name but the four ways that folding
// can attribute a sample to the wrong function while still looking complete:
// reading past a frame into its neighbour, losing the one function that carries
// no literal of its own, folding the harness's own code in with the
// framework's, and splitting a bucket into sites that no longer add up to it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import {
	bucketOf,
	BUCKETS,
	COMPILED_CREATE_SITE,
	foldProfile,
	probeOf,
	PROBE_WINDOW,
	SITES_BY_BUCKET,
} from './mts-profile-buckets.mjs';

const MTS = 'blob:http://127.0.0.1:8364/mts';
const PAGE = 'http://127.0.0.1:8364/control';

// Both taken from a real minified build. `visit` carries no diagnostic of its
// own in its opening characters — its identity is the frame shape it destructures
// — and `mountProgram`'s first diagnostic is what names it.
const VISIT =
	'r=>{var{node:t,parentRecord:n,parentId:i,physicalParent:l,parentVisible:s,insideList:d}=r;if(null===t){var c=r.listRecord;if(null!==c)return void r9(a,c);';
const MOUNT_PROGRAM =
	'(r,t,n,i)=>{var l,s=function(r){var t;var n=c[r.node];if(void 0===n)throw eZ(`first-screen program binds an event on node ${r.node}, which it did not number.`);';
// The same function entered from its other end: a different probe, the same
// `where`, so a split keyed by source has to fold the two back together.
const MOUNT_PROGRAM_OTHER_END =
	'(r,t)=>{var n=r.plan;if(void 0===n)throw eZ(`first-screen program node carries no plan.`);';
// A different function inside the same bucket, which is what a split has to
// separate from the two above.
const MOUNT_RANGES =
	'(r,t,n)=>{var i=c[r.node];if(void 0===i)throw eZ(`first-screen program appends a keyed range into node ${r.node}, which it did not number.`);';
// Emitted code: no diagnostic, no stable name, nothing but the app's own markup.
const EMITTED = 'create:(e,r)=>{let t=e.h("view");e.p(t,"class","page");';
const APP = '(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e]]))]))';

/** One line, with each snippet laid down at the column a frame will name. */
function line(placements) {
	let text = '';
	for (const [column, snippet] of placements) {
		text = text.padEnd(column, ' ') + snippet;
	}
	return text;
}

const VISIT_AT = 100;
// The real spacing between these two functions in the measured bundle.
const MOUNT_AT = VISIT_AT + 258;
const MOUNT_OTHER_AT = 700;
const MOUNT_RANGES_AT = 950;
const EMITTED_AT = 1200;
const APP_AT = 1600;
const SOURCE = line([
	[VISIT_AT, VISIT],
	[MOUNT_AT, MOUNT_PROGRAM],
	[MOUNT_OTHER_AT, MOUNT_PROGRAM_OTHER_END],
	[MOUNT_RANGES_AT, MOUNT_RANGES],
	[EMITTED_AT, EMITTED],
	[APP_AT, APP],
]);
const sourceAt = (lineNumber, column) =>
	lineNumber === 1 ? SOURCE.slice(column, column + PROBE_WINDOW) : '';

const frame = (url, column) => ({ url, functionName: '', lineNumber: 1, columnNumber: column });

/**
 * `samples`/`timeDeltas` are the profiler's own shape: one node id per sample
 * and the microseconds since the previous one.
 */
function profile() {
	return {
		nodes: [
			{ id: 1, callFrame: frame('', 0), children: [2, 5] },
			{ id: 2, callFrame: frame(MTS, VISIT_AT), hitCount: 4, children: [3] },
			{ id: 3, callFrame: frame(MTS, MOUNT_AT), hitCount: 2, children: [4] },
			{ id: 4, callFrame: frame(MTS, EMITTED_AT), hitCount: 3, children: [] },
			{ id: 5, callFrame: frame(PAGE, 0), hitCount: 9, children: [6] },
			{ id: 6, callFrame: frame(MTS, APP_AT), hitCount: 1, children: [] },
		],
		samples: [2, 3, 4, 5, 6],
		timeDeltas: [400, 200, 300, 900, 100],
	};
}

/**
 * One bucket entered three ways: twice through the same function, once through
 * another that shares its bucket. A split keyed by source has to fold the first
 * two together and keep the third apart, and still sum to the bucket.
 */
function mountProfile() {
	return {
		nodes: [
			{ id: 1, callFrame: frame('', 0), children: [2, 3, 4] },
			{ id: 2, callFrame: frame(MTS, MOUNT_AT), hitCount: 2, children: [] },
			{ id: 3, callFrame: frame(MTS, MOUNT_OTHER_AT), hitCount: 1, children: [] },
			{ id: 4, callFrame: frame(MTS, MOUNT_RANGES_AT), hitCount: 1, children: [] },
		],
		samples: [2, 3, 4],
		timeDeltas: [200, 50, 70],
	};
}

test('a frame is named from its own text, never from the function after it', () => {
	const { buckets } = foldProfile(profile(), MTS, sourceAt);
	// The applier's walk sits 258 characters before the program mount. Read far
	// enough and every one of its samples is credited to a program mount that
	// never ran — which is what a cell carrying no compiled program reporting the
	// run's largest program-mount cost looks like.
	assert.equal(buckets.get('applier walk')?.us, 400);
	assert.equal(buckets.get('program mount')?.us, 200);
});

test('the compiled program is named by its caller, having no literal of its own', () => {
	const { buckets, unmatched } = foldProfile(profile(), MTS, sourceAt);
	assert.equal(buckets.get('compiled program create')?.us, 300);
	// Emitted code is exactly what a probe table cannot reach, so losing it would
	// leave the one number this instrument exists to produce inside a remainder.
	assert.ok(![...unmatched.keys()].some((position) => position.endsWith(`:${EMITTED_AT}`)));
});

test('a frame no probe names is reported rather than folded away', () => {
	const { buckets, unmatched } = foldProfile(profile(), MTS, sourceAt);
	// Application code called from the page realm: not framework, not emitted by
	// a program, and not something the table should silently absorb.
	assert.equal(unmatched.get(`1:${APP_AT}`)?.us, 100);
	assert.ok(
		!buckets.has('compiled program create') || buckets.get('compiled program create').us === 300,
	);
});

test('the harness’s own realm is excluded from the framework total', () => {
	const { buckets, unmatched, samples } = foldProfile(profile(), MTS, sourceAt);
	const counted =
		[...buckets.values()].reduce((sum, cell) => sum + cell.us, 0) +
		[...unmatched.values()].reduce((sum, cell) => sum + cell.us, 0);
	// The page realm's 900 µs is the driver's paint predicate walking the composed
	// tree. Folding it in would report measurement as framework cost.
	assert.equal(counted, 1000);
	assert.equal(samples, 10);
});

test('bucketOf declines text it cannot name rather than guessing', () => {
	assert.equal(bucketOf(EMITTED), null);
	assert.equal(bucketOf(MOUNT_PROGRAM), 'program mount');
});

test('a bucket splits into the functions it folds, and they add back up to it', () => {
	const { buckets, sites } = foldProfile(mountProfile(), MTS, sourceAt);
	// Two entrances to `mountProgram` and one to the helper that appends a
	// program's keyed ranges. The bucket is what the script is; the sites are
	// what it is doing, which is the whole reason to key them separately.
	assert.equal(sites.get('core/host-driver.ts mountProgram')?.us, 250);
	assert.equal(sites.get('core/host-driver.ts mountProgram range members')?.us, 70);
	// The split is an attribution, so it has to account for the bucket exactly.
	// A site total that drifts from its bucket reads as an explanation while
	// quietly holding time back.
	const fromSites = SITES_BY_BUCKET['program mount'].reduce(
		(sum, site) => sum + (sites.get(site)?.us ?? 0),
		0,
	);
	assert.equal(fromSites, buckets.get('program mount').us);
});

test('a site says how many frames its probe actually matched', () => {
	const { sites } = foldProfile(mountProfile(), MTS, sourceAt);
	// Here the two are the minifier's two entrances to `mountProgram`; elsewhere
	// two frames under one site are two functions a probe was wide enough to
	// reach. The count does not tell those apart and is not meant to — what it
	// does is stop a shared total from being read as one function's cost without
	// anyone checking which case it is.
	assert.equal(sites.get('core/host-driver.ts mountProgram').positions.size, 2);
	assert.equal(sites.get('core/host-driver.ts mountProgram range members').positions.size, 1);
});

test('the emitted create is a site as well as a bucket, having no probe to be one', () => {
	const { buckets, sites } = foldProfile(profile(), MTS, sourceAt);
	// It is named by its caller rather than by a literal, so it is the one site
	// the probe table cannot produce — and the one a split would lose first.
	assert.equal(sites.get(COMPILED_CREATE_SITE)?.us, 300);
	assert.equal(buckets.get('compiled program create').us, 300);
});

test('every bucket the fold can produce is listed with its sites', () => {
	// A probe added to the table without a site list would fold into a bucket the
	// split cannot render, and the missing time would look like a small bucket
	// rather than a gap.
	for (const { bucket } of BUCKETS) {
		assert.ok(SITES_BY_BUCKET[bucket]?.length > 0, `${bucket} has no sites`);
	}
	assert.ok(SITES_BY_BUCKET['compiled program create']?.includes(COMPILED_CREATE_SITE));
	for (const [bucket, listed] of Object.entries(SITES_BY_BUCKET)) {
		const fromTable = BUCKETS.filter((entry) => entry.bucket === bucket).map(
			(entry) => entry.where,
		);
		const expected = bucket === 'compiled program create' ? [COMPILED_CREATE_SITE] : fromTable;
		assert.deepEqual([...listed].sort(), [...new Set(expected)].sort());
	}
});

// The three `main-renderer.ts` functions that one `.plan.` probe used to name
// as a single site, copied verbatim from the measured bundle at the frame
// positions the profiler reported for them. `assignIds` and `assignProgramIds`
// begin 67 characters apart, because the minifier inlines the second into the
// first's comma sequence, so both windows below overlap for most of their
// length and only their opening characters can tell them apart.
const ASSIGN_IDS =
	'(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var';
const ASSIGN_PROGRAM_IDS =
	'(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var s=0;var d=r.plan.nodes+n.length;for(var c=0;c<d;c++){if(l<n.length';
const COLLECT_EVENTS =
	'(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibility;if(s)for(var d o';

test('the three functions one probe used to fold are named apart', () => {
	assert.equal(probeOf(ASSIGN_IDS)?.where, 'main-renderer.ts assignIds');
	assert.equal(probeOf(ASSIGN_PROGRAM_IDS)?.where, 'main-renderer.ts assignProgramIds');
	assert.equal(probeOf(COLLECT_EVENTS)?.where, 'main-renderer.ts collectFirstScreenEvents');
});

test('none of the three probes reaches into either of the others', () => {
	// Stronger than naming them correctly, and independent of table order: a
	// probe that also appears in a neighbour's window is one table reordering
	// away from folding the site back together, which is how `.plan.` produced a
	// three-function total that read as one function's cost.
	const windows = [
		['main-renderer.ts assignIds', ASSIGN_IDS],
		['main-renderer.ts assignProgramIds', ASSIGN_PROGRAM_IDS],
		['main-renderer.ts collectFirstScreenEvents', COLLECT_EVENTS],
	];
	for (const [where, ,] of windows) {
		const probe = BUCKETS.find((entry) => entry.where === where)?.probe;
		assert.ok(probe !== undefined, `${where} has no probe`);
		const reached = windows.filter(([, text]) => text.includes(probe)).map(([name]) => name);
		assert.deepEqual(reached, [where], `${probe} reaches ${reached.join(', ')}`);
	}
});

test('a window is only ever matched by the probe table, never by its length', () => {
	// Each window is a real 160-character read, so a probe that only matched
	// because a fixture was trimmed to it would pass the tests above and fail on
	// the bundle.
	for (const text of [ASSIGN_IDS, ASSIGN_PROGRAM_IDS, COLLECT_EVENTS]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The template create and the recursive freeze it returns, 53 characters apart
// in the measured bundle, both taken verbatim at the positions the profiler
// reported. `Object.isFrozen(` is inside both windows; `"template"===` is
// inside only the outer one's.
const TEMPLATE_CREATE =
	'(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch';
const RECURSIVE_FREEZE =
	'(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.children))e(t)}(n=r.create(ea,t)),[n]}if("slot"===r.kin';

test('a function that encloses another is named before the one it encloses', () => {
	// The freeze is nested inside the create, so the create's own window contains
	// the freeze's probe. Named in the wrong order the create's samples land on
	// the freeze and `template create and prop freeze` reads 0.0 in every cell,
	// which reads as a branch nothing took rather than as a probe that lost.
	assert.equal(probeOf(TEMPLATE_CREATE)?.where, 'main-renderer.ts template create and prop freeze');
	assert.equal(probeOf(RECURSIVE_FREEZE)?.where, 'main-renderer.ts recursive prop freeze');
});

test('every probe’s where names a file the repository has', () => {
	// A `where` is the record's only claim about which source a number came from,
	// and it is never checked against the source at match time. Two of them named
	// `core/events.ts` and `core/selectors.ts`, neither of which exists, and the
	// records built on them read exactly like records that were right.
	const root = new URL('../../../packages/lynx/src/', import.meta.url);
	for (const { where } of BUCKETS) {
		const file = where.slice(0, where.indexOf(' '));
		assert.ok(fs.existsSync(new URL(file, root)), `${where} names a file that does not exist`);
	}
});
