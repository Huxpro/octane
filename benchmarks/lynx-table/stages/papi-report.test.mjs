// The report is a pure renderer of frozen evidence, so what is worth pinning is
// not its wording but the two ways the first-screen split can go wrong without
// saying so: apportioning `off_boundary` from a build whose wall clock does not
// match the shipping one, and a profile cell whose probe read nothing at all.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { profileTransfer } from './papi-report.mjs';

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
