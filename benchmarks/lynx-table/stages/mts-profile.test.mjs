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
	const root = new URL('../../../packages/lynx/src/', import.meta.url);
	for (const { where } of BUCKETS) {
		const file = where.slice(0, where.indexOf(' '));
		assert.ok(fs.existsSync(new URL(file, root)), `${where} names a file that does not exist`);
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
