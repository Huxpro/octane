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
// own in its opening characters — its identity is the field it reads first —
// and `mountProgram`'s first diagnostic is what names it.
//
// This window is the current shape, and the previous one is why the fixture
// moved. `visit` used to destructure its frame at the top, so `physicalParent`
// sat 42 characters in and named the bucket; the dense-span fast path now runs
// before that destructuring, which pushed the old probe past the 160-character
// window entirely. Nothing about the walk changed — it was still the largest
// single frame in the run, at 93.5 ms — but the bucket read 0.0 ms and the
// frame was reported as unnamed.
const VISIT =
	'r=>{var n=r.denseSpan;if(null!==n)return void((r,n,i,l)=>{var s=r.plan;var d=r.count;var u=r.programs;var c=r.firstId;var v=r.stride;var p=s.events;var f=p.leng';
// The walk's other half, and the reason its probe has to be the narrower of the
// two: it initialises the very field `visit` is named by, so a probe of
// `denseSpan` alone would name both and the split would report one site holding
// two functions. `physicalParent` is cut off at the window's end here too.
const PUSH_CHILDREN =
	'(e,r,t,n,a,i)=>{for(var o=e.children.length-1;o>=0;o--)$.push({node:e.children[o],papiNode:null,listRecord:null,denseSpan:null,parentRecord:r,parentId:t,physica';
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

test('the walk is named from what `visit` reads first, not from a destructuring behind it', () => {
	// The regression this pins: `physicalParent` is still in `visit`, and still
	// in `pushChildren`, and reachable from neither frame's start — the fast path
	// in one and the pushed object in the other put it past the window. A probe
	// that names a function only in the shape it had when the probe was written
	// empties its bucket on the next edit to the function's opening lines, and
	// the run reports that as a large unnamed frame rather than as an error.
	assert.ok(!VISIT.includes('physicalParent'));
	assert.ok(!PUSH_CHILDREN.includes('physicalParent'));
	assert.equal(bucketOf(VISIT), 'applier walk');
	assert.equal(bucketOf(PUSH_CHILDREN), 'applier walk');
});

test('the walk’s two functions are named apart, not folded into one site', () => {
	// `pushChildren` writes `denseSpan: null` into every frame it pushes, so the
	// probe that names `visit` by that field reaches it too. Ordering the
	// narrower probe first is what keeps a site total readable as one function's.
	assert.equal(probeOf(VISIT)?.where, 'core/host-driver.ts visit');
	assert.equal(probeOf(PUSH_CHILDREN)?.where, 'core/host-driver.ts pushChildren');
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

// The template render and the recursive freeze it returns, 53 characters apart
// in the measured bundle, both taken verbatim at the positions the profiler
// reported. `Object.isFrozen(` is inside both windows; the render's own probe
// is inside only its.
const TEMPLATE_CREATE =
	'(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch';
const RECURSIVE_FREEZE =
	'(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.children))e(t)}(n=r.create(ea,t)),[n]}if("slot"===r.kin';

test('a function that encloses another is named before the one it encloses', () => {
	// The freeze is nested inside the render, so the render's own window contains
	// the freeze's probe. Named in the wrong order the render's samples land on
	// the freeze and the render reads 0.0 in every cell, which reads as a branch
	// nothing took rather than as a probe that lost.
	assert.equal(probeOf(TEMPLATE_CREATE)?.where, 'main-renderer.ts renderTemplate');
	assert.equal(probeOf(RECURSIVE_FREEZE)?.where, 'main-renderer.ts recursive prop freeze');
});

test('every probe’s where names a file the repository has', () => {
	// A `where` is the record's only claim about which source a number came from,
	// and it is never checked against the source at match time. Two of them named
	// `core/events.ts` and `core/selectors.ts`, neither of which exists, and the
	// records built on them read exactly like records that were right.
	//
	// One probe names code this directory injects rather than code the package
	// ships, so `stages/` resolves against the harness. Every other prefix is the
	// package's own source and resolving it there is the point: a `where` under
	// neither root is the failure this test exists for, not a third root.
	const roots = {
		package: new URL('../../../packages/lynx/src/', import.meta.url),
		stages: new URL('./', import.meta.url),
	};
	for (const { where } of BUCKETS) {
		const file = where.slice(0, where.indexOf(' '));
		const root = file.startsWith('stages/') ? roots.stages : roots.package;
		const name = file.startsWith('stages/') ? file.slice('stages/'.length) : file;
		assert.ok(fs.existsSync(new URL(name, root)), `${where} names a file that does not exist`);
	}
});

// --- issue #163 C16 ---------------------------------------------------------
//
// C15 printed the source at every entered site and four labels turned out to
// name functions that are not there. These are the windows at those frames,
// taken verbatim at the positions the profiler reported, plus the neighbours
// each probe has to be separated from.

// `TEMPLATE_ENV`'s three child appenders, declared back to back: each window
// contains the ones after it, and the last runs 39 characters into the key
// reader that follows, which is how one probe used to fold all three.
const APPEND_TEXT =
	'(e,r){e.children.push(er(String(r)))},s(e,r){e.children.push(...eo(r,null))},a(e,r){e.children.push(r)}});function ei(e){return(null==e?void 0:e.$$kind)===d?e.k';
const APPEND_SPREAD =
	'(e,r){e.children.push(...eo(r,null))},a(e,r){e.children.push(r)}});function ei(e){return(null==e?void 0:e.$$kind)===d?e.key:(null==e?void 0:e.$$kind)===O||(null';
const APPEND_CHILD =
	'(e,r){e.children.push(r)}});function ei(e){return(null==e?void 0:e.$$kind)===d?e.key:(null==e?void 0:e.$$kind)===O||(null==e?void 0:e.$$kind)===p&&e.hasKey?K(e.';
// The two functions `node normalization` folded. Not one pass over the tree:
// one normalizes a props argument, the other turns a render result into nodes.
const NORMALIZE_PROPS =
	'(e){return(null==e?void 0:e.$$kind)===v?e:F(null==e?[]:[["spread",e]])}function J(e,r,t=null,n=I){A(e);var a=D(t);return{$$kind:p,renderer:e,component:r,props:a';
const MATERIALIZE =
	'(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===O){var t,n,i,l=eo(e.value,K(e.key));return 1!==l.length?[et(l,K(e.key))]:(l[0].key=K(e.';
// The PAPI facade's own wrappers. `setClasses` declares `setCssId` 161
// characters into the same object literal, so it carried `emitHostNode`'s old
// probe — and in the program cell it was the whole of `host record building`.
const FACADE_SET_CLASSES =
	'(e,r){S(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,z,r)},setDataset(e,r){N(e,r)},setEven';
const FACADE_SET_EVENT =
	'(e,r,t,n){T(e,r,t,n)},setId(e,r){_(e,r)},flush(e,r){R(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropertyDescriptors(t)):(fu';
const EMIT_HOST_NODE =
	'(e,r,t,n,a,i,o,l,s){var d=e.papi;if(void 0!==i.cssScope&&d.setCssId(r,i.cssScope.value.cssId,i.cssScope.value.entryName),"#text"===t){o||Object.is(n.value,a.val';
// Called from a program mount, carrying no literal of their own, so all three
// used to reach the emitted-create fallback and be reported as emitted code.
const PARSE_EVENT_PROP =
	'(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=d.get(e);if(void 0!==t)return t;var n=o.exec(e);if(null';
const ENCODE_CHECKED =
	'(e,r,t,n,a){if(m(e,"identity.root"),m(r,"identity.id"),m(t,"identity.generation"),m(n,"identity.listener"),"discrete"!==a&&"continuous"!==a&&"default"!==a)throw';
const EVENT_SITE_LOOKUP =
	'([e])=>e===r.type);var i=void 0===a?void 0:g(e.root,n,1,a[1].id,a[1].priority);x.push(i),w.push(i)};var u=r.plan;var v=r.ids;var f=r.values;if(void 0===u||void ';
// The thunk `renderComponent` hands to `withOwner`, 67 characters before the
// template env — so its window reaches the `h` factory and it was reported as
// one of the factories in both cells.
const COMPONENT_THUNK =
	'()=>eo(e(r,G()),null))}finally{L.length=i}}var ea=Object.freeze({h:e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:_().visibility,child';
const TEMPLATE_ENV_H =
	'e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:_().visibility,children:[]}),p(e,r,t){if(a(t))throw TypeError(`Lynx first-screen render';
const TEXT_NODE =
	'(e){return{kind:"host",key:null,id:0,type:"#text",props:Object.freeze({value:e}),events:Q,visibility:_().visibility,children:[]}}function et(e,r=null){return{ki';
// The only two frames in the measured run that really are emitted code.
const EMITTED_ROW_CREATE =
	'(r,o,l,s,d,c){var u,p,v=t(r);var f="string"==typeof o?o:"number"==typeof o&&o?String(o):"";""!==f&&e.setClasses(v,f);var h=n(r);e.setClasses(h,"col-id");var y=n';
const EMITTED_PAGE_CREATE =
	'(r,o,l,s,d,c,u,p,v,f,h,y,m,g){var b=t(r);e.setClasses(b,"page");var w=n(r);e.setClasses(w,"title");var O=a("Octane UI Benchmark on Lynx · ready");var $=t(r);e.s';

test('a run of one-line methods declared back to back is named in source order', () => {
	// Each appender's window contains the ones declared after it, so uniqueness
	// cannot separate them and order has to. Listed in any other order an earlier
	// entry claims a later method's samples, and the site that loses reads 0.0.
	assert.equal(probeOf(APPEND_TEXT)?.where, 'main-renderer.ts TEMPLATE_ENV.t');
	assert.equal(probeOf(APPEND_SPREAD)?.where, 'main-renderer.ts TEMPLATE_ENV.s');
	assert.equal(probeOf(APPEND_CHILD)?.where, 'main-renderer.ts TEMPLATE_ENV.a');
	const order = ['t', 's', 'a'].map((name) =>
		BUCKETS.findIndex((entry) => entry.where === `main-renderer.ts TEMPLATE_ENV.${name}`),
	);
	assert.ok(
		order.every((index, at) => index >= 0 && (at === 0 || index > order[at - 1])),
		`TEMPLATE_ENV.t/s/a must be listed in source order, got indices ${order.join(',')}`,
	);
});

test('the appenders are named apart from the key reader they run into', () => {
	// `.$$kind)===` reached all three appenders from 39 characters away and
	// reported them as `node normalization`, which also folded the two functions
	// below. Five frames, one name, none of them that name's.
	for (const text of [APPEND_TEXT, APPEND_SPREAD, APPEND_CHILD]) {
		assert.notEqual(probeOf(text)?.where, 'main-renderer.ts materialize');
		assert.notEqual(probeOf(text)?.where, 'main-renderer.ts normalizeProps');
	}
	assert.equal(probeOf(NORMALIZE_PROPS)?.where, 'main-renderer.ts normalizeProps');
	assert.equal(probeOf(MATERIALIZE)?.where, 'main-renderer.ts materialize');
});

test('a facade wrapper is not the function it forwards to', () => {
	// `setCssId(` named both: the facade declares it inside the same object
	// literal that declares `setClasses`. In the cell whose program removes host
	// record building entirely, this wrapper was the bucket's whole remaining
	// 2.5 ms — a number belonging to another file.
	assert.equal(probeOf(FACADE_SET_CLASSES)?.where, 'core/papi.ts papi facade methods');
	assert.equal(probeOf(FACADE_SET_EVENT)?.where, 'core/papi.ts papi facade methods');
	assert.equal(probeOf(EMIT_HOST_NODE)?.where, 'core/host-driver.ts emitHostNode');
	assert.notEqual(probeOf(FACADE_SET_CLASSES)?.bucket, probeOf(EMIT_HOST_NODE)?.bucket);
});

test('the component thunk is named before the template env it abuts', () => {
	// The thunk is not a factory, and a one-frame site is not the same as a
	// correct one: this was one frame, in both cells, under a factory's name.
	assert.equal(probeOf(COMPONENT_THUNK)?.where, 'main-renderer.ts renderComponent');
	assert.equal(probeOf(TEMPLATE_ENV_H)?.where, 'main-renderer.ts TEMPLATE_ENV.h');
	assert.equal(probeOf(TEXT_NODE)?.where, 'main-renderer.ts textNode');
});

test('the emitted-create fallback reaches only frames that are emitted code', () => {
	// The fallback names a frame by its caller, so anything the table misses that
	// a mount calls is reported as the compiled program's own create. Four
	// framework functions were arriving that way; each now has a probe, and the
	// two windows that really are emitted code are the two the table still misses.
	for (const text of [PARSE_EVENT_PROP, ENCODE_CHECKED, FACADE_SET_EVENT, EVENT_SITE_LOOKUP]) {
		assert.notEqual(probeOf(text), null, `${text.slice(0, 40)}… must not reach the fallback`);
	}
	assert.equal(probeOf(EMITTED_ROW_CREATE), null);
	assert.equal(probeOf(EMITTED_PAGE_CREATE), null);
});

test('every window fixture is a real read, not one trimmed to fit its probe', () => {
	// A fixture shorter than the window could make a probe look separated when
	// the bundle would have let it reach further.
	for (const text of [
		VISIT,
		PUSH_CHILDREN,
		APPEND_TEXT,
		APPEND_SPREAD,
		APPEND_CHILD,
		NORMALIZE_PROPS,
		MATERIALIZE,
		FACADE_SET_CLASSES,
		FACADE_SET_EVENT,
		EMIT_HOST_NODE,
		PARSE_EVENT_PROP,
		ENCODE_CHECKED,
		EVENT_SITE_LOOKUP,
		COMPONENT_THUNK,
		TEMPLATE_ENV_H,
		TEXT_NODE,
		EMITTED_ROW_CREATE,
		EMITTED_PAGE_CREATE,
	]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The three functions `"template"===` folded, and the assert `"identity.root"`
// reached backwards into. Both were found by C16's own measured window rather
// than by C15's, which is the case for keeping the frame count in the record:
// a site that was one frame in one window is two in the next.
const UNIVERSAL_PLAN =
	'(e,r){return A(e),Object.freeze({$$kind:s,renderer:e,root:function e(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw Ty';
const FREEZE_PLAN_NODE =
	'(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a create function and a ';
const NATIVE_EVENT_ASSERT =
	'(e,r){if(!Number.isSafeInteger(e)||e<=0)throw y(`${r} must be a positive safe integer.`)}function g(e,r,t,n,a){if(m(e,"identity.root"),m(r,"identity.id"),m(t,"i';

test('the three functions the template test folded are named apart', () => {
	// A plan constructor, the validator it calls, and the render that executes a
	// compiled create share nothing but testing `kind === 'template'`, and one
	// probe on that test named all three. The constructor encloses the validator,
	// so these two are ordered as well as separated.
	assert.equal(probeOf(UNIVERSAL_PLAN)?.where, 'main-renderer.ts universalPlan');
	assert.equal(probeOf(FREEZE_PLAN_NODE)?.where, 'main-renderer.ts freezePlanNode');
	assert.equal(probeOf(TEMPLATE_CREATE)?.where, 'main-renderer.ts renderTemplate');
});

test('an assert is not the function that calls it', () => {
	// `native-events.ts` declares its own `assertPositiveSafeInteger` 99
	// characters before the encode whose arguments it checks, so a probe on the
	// encode's first argument name reached the assert too. This is C16's own
	// defect: the probe that needed separating is one C16 added.
	assert.equal(
		probeOf(NATIVE_EVENT_ASSERT)?.where,
		'core/native-events.ts assertPositiveSafeInteger',
	);
	assert.equal(
		probeOf(ENCODE_CHECKED)?.where,
		'core/native-events.ts encodeCheckedLynxNativeEventToken',
	);
	// Two asserts with the same shape live in two files; each names its own.
	assert.notEqual(
		probeOf(NATIVE_EVENT_ASSERT)?.where,
		'core/nodes-ref.ts assertPositiveSafeInteger',
	);
	for (const text of [UNIVERSAL_PLAN, FREEZE_PLAN_NODE, NATIVE_EVENT_ASSERT]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The PAPI facade's page wrapper and the element type switch declared 27
// characters after it — the closest neighbouring pair of sampled frames in the
// bundle, and the last one the table was folding under a single name.
const FACADE_CREATE_PAGE =
	'(e,r)=>n(e,r),createElement(e,r,t){switch(e){case"#text":case"raw-text":return s(t);case"view":return i(r);case"scroll-view":return o(r);case"text":return l(r);';
const CREATE_ELEMENT_SWITCH =
	'(e,r,t){switch(e){case"#text":case"raw-text":return s(t);case"view":return i(r);case"scroll-view":return o(r);case"text":return l(r);case"image":return d(r);def';

test('the page factory is not the type switch declared after it', () => {
	// `case"raw-text":` sits 30 characters into the switch's own window and 57
	// into the wrapper's, so both frames carried it and `element factory dispatch`
	// was a shared total. The program cell is the case that shows why a shared
	// total is not merely imprecise: the only frame it ever sampled in that
	// bucket was the wrapper, so the bucket's 0.0 read as a free type switch when
	// the switch had not been entered at all.
	//
	// Uniqueness separates them in one direction only — `,createElement(` cannot
	// be seen from the switch's window, which starts after it, but the switch's
	// probe can be seen from the wrapper's — so order carries the other
	// direction, and both orders are watched here rather than assumed.
	assert.equal(probeOf(FACADE_CREATE_PAGE)?.where, 'core/papi.ts createPage');
	assert.equal(probeOf(CREATE_ELEMENT_SWITCH)?.where, 'core/papi.ts createElement type switch');
	assert.notEqual(probeOf(FACADE_CREATE_PAGE)?.bucket, probeOf(CREATE_ELEMENT_SWITCH)?.bucket);
	for (const text of [FACADE_CREATE_PAGE, CREATE_ELEMENT_SWITCH]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// --- issue #215 D7 ----------------------------------------------------------
//
// A profiled run now opens a second window, from settled paint through the
// first-tree lifecycle, and the functions in it had never been sampled — so
// none of them carried a probe. These are the windows at the frames that run
// reported, taken verbatim, plus the neighbours each new probe has to be
// separated from. Three separations matter and none of them is uniqueness:
// the transport spells the same assert messages the host driver does, the
// comparator names the same command op the preparation that replays into it
// does, and D3's three event accessors read `.plan.events` where two other
// functions read it too.

// D3's on-demand event journal: the host driver's per-node reader, and the two
// `first-screen.ts` accessors that answer the same question from the plan.
const PROGRAM_NODE_EVENTS =
	'(e,r){var t,n,a=e.plan.events;if(0!==a.length){for(var i=0;i<a.length;i++){var o=a[i];if(o.node===r){var l=e.tokens[i];void 0!==l&&(null!=n||(n=ti(e.plan)),(nul';
const RUN_EVENT_COUNT =
	'(e,r){var t=e.plan.events;var n=0;for(var a=0;a<t.length;a++)t[a].node===r&&void 0!==e.tokens[a]&&n++;return n}function p(e,r,t){var n=e.plan.events;for(var a=0';
const RUN_EVENT_TOKEN =
	'(e,r,t){var n=e.plan.events;for(var a=0;a<n.length;a++){var i=n[a];if(i.node===r&&i.type===t)return e.tokens[a]}}class v{get(e){var r=this.runFor(e);return void';
// The renderer's announce pass reads `plan.events` too, in the paint window,
// and is named there already. Its own `plan.events` sits 24 characters past the
// end of this window — the whole margin between the two readers is those 24
// characters, which is why the probe does not rely on them.
// (`materializeProgramEvents`, the fifth reader, is inlined into its caller by
// the minifier and has no frame of its own to name.)
const RENDERER_ANNOUNCE =
	'(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibility;if(o.eventsAt=a.';

test('D3’s three event accessors are one bucket, and the announce pass is not in it', () => {
	// The bucket exists to re-price what D3 moved rather than to account for a
	// window, so it has to hold exactly the functions that pay for the move: the
	// three that answer from the plan when something finally asks. One probe
	// names all three because they are one accounting line.
	for (const text of [PROGRAM_NODE_EVENTS, RUN_EVENT_COUNT, RUN_EVENT_TOKEN]) {
		assert.equal(bucketOf(text), 'deferred event journal');
	}
	assert.equal(bucketOf(RENDERER_ANNOUNCE), 'renderer pre-passes');
	// That last assertion is true today for a reason the probe does not control:
	// the announce pass's own read is out of window reach by 24 characters. The
	// separation the probe *does* control is the semicolon — the three accessors
	// open a statement with `.plan.events`, the announce pass and
	// `materializeProgramEvents` continue `)` and `.length` — so it is pinned
	// here rather than left to a margin that a minifier release could close.
	assert.ok(probeOf(PROGRAM_NODE_EVENTS)?.probe.endsWith(';'));
	for (const text of [PROGRAM_NODE_EVENTS, RUN_EVENT_COUNT, RUN_EVENT_TOKEN, RENDERER_ANNOUNCE]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The transport's own record validator, and the host driver's command loop,
// which throws the same words from a template literal.
const TRANSPORT_RECORD =
	'(e,t){if(null===e||"object"!=typeof e||Array.isArray(e))return tx(tC,"must be an object.",t);if(!r(e))return tx(tC,"must be a plain object.",t);var n,a=Reflect.';
const PREPARE_COMMAND_LOOP =
	'(n){var a=r.commands[n];if(null===a||"object"!=typeof a)throw eK(`command ${n} must be an object.`);if(J&&"mount-template-range"!==a.op&&"mount-template-run"!==';
const TRANSPORT_POSITIVE_INTEGER =
	'(e,r,t,n){(!Number.isSafeInteger(e)||e<=0)&&tx(r,"must be a positive safe integer.",t,n)}function tE(e,r){(!Number.isSafeInteger(e)||e<0)&&tx(r,"must be a non-n';

test('the transport’s asserts are not the host driver’s, which spell the same words', () => {
	// Both files say "must be an object." and "must be a positive safe integer.",
	// and the two live in different windows of the same profile. What separates
	// them is punctuation the minifier does not choose: the transport passes the
	// message as an argument, so it is a double-quoted string followed by a
	// comma; the host driver and `native-events.ts` interpolate it into a
	// template, so it ends at a backtick. A probe without the comma would have
	// folded the preparation into the validation and left the validation looking
	// like the larger of the two.
	assert.equal(bucketOf(TRANSPORT_RECORD), 'inbound validation');
	assert.equal(bucketOf(TRANSPORT_POSITIVE_INTEGER), 'inbound validation');
	assert.equal(bucketOf(PREPARE_COMMAND_LOOP), 'batch preparation');
	assert.equal(bucketOf(NATIVE_EVENT_ASSERT), 'event bookkeeping');
	for (const text of [TRANSPORT_RECORD, PREPARE_COMMAND_LOOP, TRANSPORT_POSITIVE_INTEGER]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The comparator, entered at its format check and again inside its node walk,
// and the preparation loop that replays into an adopted tree.
const COMPARE_FIRST_TREE =
	'(e,r,t,n,a,i,o,l,s){var d=t.snapshot;var c=e[eU];var u=n[eU];if(1!==d.format||d.renderer!==eq)return tr(t,"snapshot.format","the snapshot format or renderer is ';
const COMPARE_NODE_WALK =
	'(e,r)=>e-r)){var E=I.runFor(z);var P=void 0===E?void 0:(0,S.w7)(E,z);if(void 0!==E&&void 0!==P){var L=o(z);if(void 0===L)return tr(t,`snapshot.nodes[${z}]`,"the';
const ADOPTION_REPLAY =
	'e=>"ensure-public-instance"===e.op):eh)(function(r){if(X&&p.has(r.id))return"continue";if("mount-template"===r.op){if(void 0!==r.dense&&void 0!==e$){var t,n=r.d';

test('the comparator is not the preparation that replays into what it adopted', () => {
	// Both name `ensure-public-instance`: the comparator refuses a batch carrying
	// any other operation, and the preparation replays exactly those and nothing
	// else once the verdict is `adopt`. They are the two largest things in this
	// window after the transport, so folding either into the other would move
	// several milliseconds between the two buckets a reader compares first.
	// The comparison operator is what separates them — the comparator writes
	// `!==`, the replay `===` — and no frame in the measured bundle sits close
	// enough to the comparator's spelling to be a fixture for it. So the operator
	// is pinned on the probe itself: dropping it is the edit that would fold the
	// two, and this is what makes that edit red rather than a quiet reattribution.
	assert.equal(bucketOf(COMPARE_FIRST_TREE), 'first-tree comparator');
	assert.equal(bucketOf(COMPARE_NODE_WALK), 'first-tree comparator');
	assert.equal(bucketOf(ADOPTION_REPLAY), 'batch preparation');
	assert.ok(probeOf(ADOPTION_REPLAY)?.probe.endsWith('==='));
	for (const text of [COMPARE_FIRST_TREE, COMPARE_NODE_WALK, ADOPTION_REPLAY]) {
		assert.equal(text.length, PROBE_WINDOW);
	}
});

// The counter `stages/instrument-source.mjs` injects, which exists in no
// shipping build and is not the framework.
const PROFILE_PAPI_CREATE =
	'(e){var r;var t=(0,nu.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nf=new Set;function nh(){throw Error("Octane Lynx received mai';

test('the instrument’s own counter is a bucket, not a share of the framework', () => {
	// A profile cell pays for being profiled, and the payment is inside the same
	// script as everything else it measures. Left unnamed it would be part of
	// `unnamed`, which reads as framework the table failed to name rather than as
	// cost the harness added.
	assert.equal(bucketOf(PROFILE_PAPI_CREATE), 'stage instrument');
	assert.equal(PROFILE_PAPI_CREATE.length, PROBE_WINDOW);
});

/** The buckets that exist because a profiled run keeps sampling past paint. */
const ADOPTION_BUCKETS = new Set([
	'inbound validation',
	'main-thread receive',
	'handle delta',
	'batch preparation',
	'first-tree comparator',
	'adoption apply',
	'deferred event journal',
	'program index',
	'hand-over',
	'stage instrument',
]);

test('the adoption entries are appended, so no paint-window frame can change hands', () => {
	// This is the property the whole group rests on. `probeOf` returns the first
	// entry that matches, so an entry that follows every existing one cannot take
	// a frame an existing one already names — which is what keeps every record
	// built before this slice comparable with every record built after it. It
	// holds only while the group stays contiguous and last, and both are cheap to
	// state and invisible to lose.
	const first = BUCKETS.findIndex((entry) => ADOPTION_BUCKETS.has(entry.bucket));
	assert.notEqual(first, -1);
	for (const [index, entry] of BUCKETS.entries()) {
		assert.equal(
			ADOPTION_BUCKETS.has(entry.bucket),
			index >= first,
			`${entry.bucket} at ${index} is on the wrong side of the adoption group`,
		);
	}
});
