// The report is a pure renderer of frozen evidence, so what is worth pinning is
// not its wording but the two ways the first-screen split can go wrong without
// saying so: apportioning `off_boundary` from a build whose wall clock does not
// match the shipping one, and a profile cell whose probe read nothing at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { firstScreenControl, profileTransfer, renderBoundaryReport } from './papi-report.mjs';

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

function window({ controlMs, offBoundaryMs, firstScreen = null }) {
	return {
		measured: true,
		timed: { stages: { off_boundary: stat(offBoundaryMs) }, firstScreen },
		overhead: { timed: { control: stat(controlMs) } },
	};
}

function scale({ profileControlMs = 1010, firstScreen = split(), profiled = true } = {}) {
	const cells = { octane: { fcp: window({ controlMs: 1000, offBoundaryMs: 270 }) } };
	if (profiled) {
		cells['octane-profile'] = {
			fcp: window({ controlMs: profileControlMs, offBoundaryMs: 267, firstScreen }),
		};
	}
	return { rows: 10000, cells };
}

test('reports both builds’ first-screen walls beside the split they license', () => {
	const transfer = profileTransfer(scale());
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
	assert.ok(withSplit.includes('### Octane first-screen phase split @10000'));

	// The cross-framework run has no profile cell, so a contract paragraph
	// explaining how to read a split would describe a section that is not there.
	const withoutSplit = renderBoundaryReport([frozen('papi', 10000)]);
	assert.ok(!withoutSplit.includes(marker));
	assert.ok(!withoutSplit.includes('first-screen phase split'));
});
