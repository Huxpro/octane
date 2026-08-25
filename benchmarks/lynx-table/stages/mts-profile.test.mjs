// The profile is folded by matching string literals in a minified bundle, so
// what is worth pinning is not a bucket's name but the three ways that folding
// can attribute a sample to the wrong function while still looking complete:
// reading past a frame into its neighbour, losing the one function that carries
// no literal of its own, and folding the harness's own code in with the
// framework's.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bucketOf, foldProfile, PROBE_WINDOW } from './mts-profile-buckets.mjs';

const MTS = 'blob:http://127.0.0.1:8364/mts';
const PAGE = 'http://127.0.0.1:8364/control';

// Both taken from a real minified build. `visit` carries no diagnostic of its
// own in its opening characters — its identity is the frame shape it destructures
// — and `mountProgram`'s first diagnostic is what names it.
const VISIT =
	'r=>{var{node:t,parentRecord:n,parentId:i,physicalParent:l,parentVisible:s,insideList:d}=r;if(null===t){var c=r.listRecord;if(null!==c)return void r9(a,c);';
const MOUNT_PROGRAM =
	'(r,t,n,i)=>{var l,s=function(r){var t;var n=c[r.node];if(void 0===n)throw eZ(`first-screen program binds an event on node ${r.node}, which it did not number.`);';
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
const EMITTED_AT = 1200;
const APP_AT = 1600;
const SOURCE = line([
	[VISIT_AT, VISIT],
	[MOUNT_AT, MOUNT_PROGRAM],
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
