// The report is a pure renderer of frozen evidence, so what is worth pinning is
// not its wording but the two ways the first-screen split can go wrong without
// saying so: apportioning `off_boundary` from a build whose wall clock does not
// match the shipping one, and a profile cell whose probe read nothing at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
	firstScreenControl,
	profiledCellIds,
	profileTransfer,
	renderBoundaryReport,
} from './papi-report.mjs';

// Only medians are read here; the analyzer's own suite covers how a stat is
// folded out of its samples.
const stat = (median) => ({ median, min: median, max: median });

function phase({ calls = 0, selfMs = 0, offBoundaryMs = 0 } = {}) {
	return { calls: stat(calls), selfMs: stat(selfMs), offBoundaryMs: stat(offBoundaryMs) };
}

function split(overrides = {}) {
	return {
		phases: {
			render: phase({ offBoundaryMs: 40 }),
			publish: phase({ calls: 7000, selfMs: 120, offBoundaryMs: 30 }),
			capture: phase({ calls: 1000, selfMs: 17, offBoundaryMs: 5 }),
			announce: phase({ calls: 1, selfMs: 1, offBoundaryMs: 2 }),
			...overrides.phases,
		},
		frameworkMs: stat(77),
		residueMs: stat(190),
	};
}

function window({ controlMs, offBoundaryMs, firstScreen = null, timedTotalMs = controlMs + 200 }) {
	return {
		measured: true,
		timed: {
			total: stat(timedTotalMs),
			stages: { off_boundary: stat(offBoundaryMs) },
			firstScreen,
		},
		overhead: { timed: { control: stat(controlMs) } },
	};
}

function scale({
	profileControlMs = 1010,
	firstScreen = split(),
	profiled = true,
	reference = false,
} = {}) {
	const cells = { octane: { fcp: window({ controlMs: 1000, offBoundaryMs: 270 }) } };
	if (profiled) {
		cells['octane-profile'] = {
			fcp: window({ controlMs: profileControlMs, offBoundaryMs: 267, firstScreen }),
		};
	}
	if (reference) {
		// Control wall 700 against a timed total of 800, so the two candidate
		// denominators — 1000 − 700 and 1200 − 800 — are 300 and 400 and cannot be
		// confused for one another by a passing assertion.
		cells['react-first-screen'] = {
			fcp: window({ controlMs: 700, timedTotalMs: 800, offBoundaryMs: 60 }),
		};
	}
	return { rows: 10000, cells };
}

test('reports both builds’ first-screen walls beside the split they license', () => {
	const transfer = profileTransfer(scale());
	assert.equal(transfer.shippingId, 'octane');
	assert.equal(transfer.profiledId, 'octane-profile');
	assert.equal(transfer.shippingMs, 1000);
	assert.equal(transfer.profiledMs, 1010);
	assert.equal(transfer.deltaMs, 10);
	// A spread, never a ratio between the two builds: the profile build carries
	// branches the shipping one folds away, so the two wall clocks are different
	// configurations and only their agreement is reportable.
	assert.ok(Math.abs(transfer.spread - 0.01) < 1e-12);
	assert.equal(transfer.split.frameworkMs.median, 77);
	assert.equal(transfer.split.residueMs.median, 190);
	// The shipping cell's own off-boundary total stays in the report beside the
	// profiled one, so a reader can see the number the split is being read onto.
	assert.equal(transfer.shippingOffBoundaryMs, 270);
	assert.equal(transfer.profiledOffBoundaryMs, 267);
});

test('a run without a profile cell reports no split rather than an empty one', () => {
	assert.equal(profileTransfer(scale({ profiled: false })), null);
});

test('refuses a profile cell that measured a window but read no profile record', () => {
	assert.throws(
		() => profileTransfer(scale({ firstScreen: null })),
		/carried no first-screen split/,
	);
});

// The deltas and the first-screen control are octane-vs-reference by
// construction. The run CLI now requires the octane cell up front, but the
// report module re-renders any frozen JSON handed to it, so it still has to
// degrade to "no control" rather than crash on evidence without that cell.
test('firstScreenControl declines evidence measured without the octane cell', () => {
	assert.equal(firstScreenControl({ cells: {} }), null);
});

test('profileTransfer declines evidence whose cells lack the shipping octane cell', () => {
	const profiled = {
		fcp: window({ controlMs: 1010, offBoundaryMs: 267, firstScreen: split() }),
	};
	assert.equal(profileTransfer({ rows: 10000, cells: { 'octane-profile': profiled } }), null);
});

// A profile cell is paired with its shipping counterpart by name rather than by
// a table, which is what lets one run carry more than one profile build. The
// pairing is load-bearing, not cosmetic: a split is only licensed by the wall
// clock of the build it was measured beside, so reading a program cell's phases
// against plain `octane`'s wall would publish a transfer nobody measured.
test('pairs a profile cell with its own shipping build, not with octane', () => {
	const cells = {
		octane: { fcp: window({ controlMs: 1000, offBoundaryMs: 270 }) },
		'octane-mts-program': { fcp: window({ controlMs: 800, offBoundaryMs: 190 }) },
		'octane-mts-program-profile': {
			fcp: window({ controlMs: 820, offBoundaryMs: 195, firstScreen: split() }),
		},
	};
	const transfer = profileTransfer({ rows: 10000, cells }, 'octane-mts-program-profile');
	assert.equal(transfer.shippingId, 'octane-mts-program');
	assert.equal(transfer.profiledId, 'octane-mts-program-profile');
	assert.equal(transfer.shippingMs, 800);
	assert.equal(transfer.profiledMs, 820);
	assert.equal(transfer.shippingOffBoundaryMs, 190);
	// A shipping id names no profile build, so asking it for a split is declined
	// rather than answered against a truncated neighbour.
	assert.equal(profileTransfer({ rows: 10000, cells }, 'octane-mts-program'), null);
});

test('names every profile build in a run, in the order the run declared them', () => {
	assert.deepEqual(
		profiledCellIds({
			cells: [
				'octane',
				'octane-profile',
				'octane-mts-program',
				'octane-mts-program-profile',
				'octane-direct',
			],
		}),
		['octane-profile', 'octane-mts-program-profile'],
	);
});

// Rendered over the checked-in evidence rather than a fixture: the renderer
// needs a whole scale report, and the two files below are exactly the two cases
// — a cross-framework run with no profile cell, and the first-screen run with
// one. They are the same JSON the report CLI re-renders from.
const frozen = (stem, rows) =>
	JSON.parse(
		fs.readFileSync(path.join(import.meta.dirname, 'results', `${stem}-${rows}.json`), 'utf8'),
	);

test('describes the split only in a report that carries one', () => {
	const marker = 'and on a profile-built Octane cell it splits further';

	const withSplit = renderBoundaryReport([frozen('papi-firstscreen', 10000)]);
	assert.ok(withSplit.includes(marker));
	assert.ok(withSplit.includes('### `octane` first-screen phase split @10000'));

	// The cross-framework run has no profile cell, so a contract paragraph
	// explaining how to read a split would describe a section that is not there.
	const withoutSplit = renderBoundaryReport([frozen('papi', 10000)]);
	assert.ok(!withoutSplit.includes(marker));
	assert.ok(!withoutSplit.includes('first-screen phase split'));
});

// The phase-split run carries two shipping/profile pairs, so it is the case that
// would previously have published one split and dropped the other in silence —
// a report that looks complete while missing the cell it was run for.
test('renders one split per profile build, each named for its own shipping cell', () => {
	const report = renderBoundaryReport([frozen('c163-phase', 10000)]);
	assert.ok(report.includes('### `octane` first-screen phase split @10000'));
	assert.ok(report.includes('### `octane-mts-program` first-screen phase split @10000'));
	assert.ok(report.includes('the profile build of `octane-mts-program`'));
});

// Before a reference carried a pre-populated bundle, no run could produce an
// FCP delta at all and the section could not exist. Now one cell in this run has
// one and another does not, in the same file — which is the pair worth pinning:
// a missing delta has to read as a window nobody measured, never as a gap of
// nought.
test('renders the FCP delta only for a reference that measured the window', () => {
	const report = renderBoundaryReport([frozen('c247-o1', 10000)]);
	assert.ok(report.includes('### Octane − `react-first-screen`, FCP@10000'));
	assert.ok(!report.includes('### Octane − `react`, FCP@10000'));
	// Both cells measured create, so the absence above is the FCP window's own
	// and not this cell being skipped wholesale.
	assert.ok(report.includes('### Octane − `react`, create@10000'));
});

test('a run without the reference cell yields no reference row rather than a wrong one', () => {
	assert.equal(profileTransfer(scale()).reference, null);
});

test('the framework row is measured against the reference’s whole bucket 4', () => {
	const { reference } = profileTransfer(scale({ reference: true }));
	assert.equal(reference.referenceId, 'react-first-screen');
	assert.equal(reference.referenceOffBoundaryMs, 60);
	// The reference has no phase split and cannot be given one, so only its whole
	// remainder may be subtracted: 77 of framework against all 60 of it.
	assert.equal(reference.excessMs, 17);
});

test('the gap share divides by the timed FCP walls, the window its numerator came from', () => {
	const { reference } = profileTransfer(scale({ reference: true }));
	// 1200 − 800, from `fcp.timed.total` — the same denominator `attributeDelta`
	// uses. Reading the control walls instead would give 1000 − 700 = 300 and a
	// share of 5.67%, a timed numerator over an uninstrumented denominator.
	assert.equal(reference.gapMs, 400);
	assert.ok(Math.abs(reference.shareOfGap - 17 / 400) < 1e-12);
	assert.ok(Math.abs(reference.shareOfGap - 17 / 300) > 1e-3);
});

test('the two shares keep separate denominators, because they answer different questions', () => {
	const { reference, profiledOffBoundaryMs } = profileTransfer(scale({ reference: true }));
	// A composition statement about one cell: 77 of framework in its own 267 of
	// off-boundary. It says nothing about the reference, and it is not the gap
	// share — quoting it as one would overstate the finding here by 26 points.
	assert.equal(profiledOffBoundaryMs, 267);
	assert.ok(Math.abs(reference.shareOfOwnBucket - 77 / 267) < 1e-12);
	assert.ok(reference.shareOfOwnBucket > reference.shareOfGap);
});

test('the rendered report names the denominator beside each share', () => {
	const report = renderBoundaryReport([frozen('c247-o2-bucket4', 10000)]);
	assert.ok(
		report.includes(
			'| framework ÷ Octane’s own bucket 4 | `octane-profile` off-boundary, 599.9 ms | 84.2% |'.replace(
				'’',
				"'",
			),
		),
	);
	// 457.1 is the timed FCP walls' difference. The control walls differ by
	// 414.5, so this line also pins which window the denominator comes from.
	assert.ok(
		report.includes(
			'| framework excess ÷ the FCP gap | `octane` FCP wall − `react-first-screen` FCP wall, 457.1 ms | 61.6% |',
		),
	);
	assert.ok(!report.includes('414.5 ms | 68.0%'));
});
