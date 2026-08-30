// The gate judges a device it cannot be run against here, so what is testable
// is the judgement itself — and that is the half that decides whether a device
// round's verdict means anything.
//
// Every test below breaks exactly one thing in a record that otherwise passes,
// so a step going red names the observation it was reading. The two that matter
// most are the ones with no device counterpart: a missing observation must fail
// rather than pass, and an absence nobody provoked must not count as evidence.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DEVICE_GATE_PROTOCOL,
	DEVICE_GATE_STEPS,
	evaluateDeviceGate,
} from './issue234-gate-oracles.mjs';

const OPTIONS = { scale: 1000, cycles: 3 };

/** A window in which every step passed, as the runner would have collected it. */
function passingRecord() {
	return {
		firstScreen: { rowCount: 1000, firstRowClass: 'row' },
		adoption: { firstTreeAction: 'adopt', firstTreeSettled: 1 },
		nativeTap: {
			target: { index: 500, id: 501 },
			dispatchedTo: 501,
			tapped: { index: 500, class: 'row danger' },
			neighbours: [
				{ index: 499, class: 'row' },
				{ index: 501, class: 'row' },
			],
		},
		slotUpdate: {
			marker: ' !!!',
			updated: [
				{ index: 0, label: 'quiet green keyboard !!!' },
				{ index: 10, label: 'clean tall mouse !!!' },
			],
			untouched: [
				{ index: 1, label: 'plain white table' },
				{ index: 11, label: 'odd silver chair' },
			],
		},
		clearCycles: [
			{ cycle: 1, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
			{ cycle: 2, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
			{ cycle: 3, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
		],
		dispose: {
			provokedAfterDispose: 3,
			acksAfterDispose: 0,
			observationsAfterDispose: 0,
			orphanEvidence: [],
		},
	};
}

/** Apply one mutation to an otherwise-passing record. */
function withBroken(mutate) {
	const record = passingRecord();
	mutate(record);
	return record;
}

/** The verdict for one step id. */
function stepOf(result, id) {
	const step = result.steps.find((entry) => entry.id === id);
	assert.ok(step !== undefined, `no verdict for ${id}`);
	return step;
}

describe('issue #234 device gate: the table', () => {
	it('names six steps, each with an id, a title, what it reads, and why', () => {
		assert.equal(DEVICE_GATE_STEPS.length, 6);
		assert.deepEqual(
			DEVICE_GATE_STEPS.map((step) => step.id),
			['first-screen', 'adoption', 'native-tap', 'slot-update', 'clear-retention', 'dispose'],
		);
		for (const step of DEVICE_GATE_STEPS) {
			assert.equal(typeof step.title, 'string', `${step.id} title`);
			assert.ok(step.title.length > 0, `${step.id} title`);
			assert.ok(step.reads.length > 0, `${step.id} reads`);
			assert.ok(step.why.length > 0, `${step.id} why`);
			assert.equal(typeof step.oracle, 'function', `${step.id} oracle`);
		}
	});

	it('refuses a window too small to judge', () => {
		assert.throws(() => evaluateDeviceGate(passingRecord(), { scale: 0, cycles: 3 }), /scale/u);
		// One clear cannot show a trend, so a one-cycle retention oracle would
		// report "flat" for a container that leaks on every single clear.
		assert.throws(() => evaluateDeviceGate(passingRecord(), { scale: 1000, cycles: 1 }), /cycles/u);
	});
});

describe('issue #234 device gate: a clean window', () => {
	it('passes every step and carries what each one read', () => {
		const result = evaluateDeviceGate(passingRecord(), OPTIONS);
		assert.equal(result.protocol, DEVICE_GATE_PROTOCOL);
		assert.equal(result.pass, true);
		assert.equal(result.steps.length, 6);
		for (const step of result.steps) {
			assert.equal(step.pass, true, `${step.id} should pass`);
			assert.equal(step.skipped, false);
			assert.equal(step.reason, null);
			// A passing record that says nothing about what it read cannot be
			// re-read later against a changed expectation.
			assert.notEqual(step.expected, null, `${step.id} expected`);
			assert.notEqual(step.actual, null, `${step.id} actual`);
		}
	});
});

describe('issue #234 device gate: a missing observation is a failure', () => {
	// The rule the whole gate rests on. Each of these is a device that answered
	// nothing for one read; none of them may come back green.
	const holes = [
		['first-screen', (record) => delete record.firstScreen.rowCount],
		['first-screen', (record) => delete record.firstScreen.firstRowClass],
		['first-screen', (record) => delete record.firstScreen],
		['adoption', (record) => delete record.adoption.firstTreeAction],
		['adoption', (record) => delete record.adoption.firstTreeSettled],
		['native-tap', (record) => delete record.nativeTap.dispatchedTo],
		['native-tap', (record) => delete record.nativeTap.tapped],
		['native-tap', (record) => (record.nativeTap.neighbours = [])],
		['slot-update', (record) => delete record.slotUpdate.marker],
		['slot-update', (record) => (record.slotUpdate.updated = [])],
		['slot-update', (record) => (record.slotUpdate.untouched = [])],
		['clear-retention', (record) => (record.clearCycles = [])],
		['clear-retention', (record) => delete record.clearCycles[1].liveElementsAfterClear],
		['dispose', (record) => delete record.dispose.acksAfterDispose],
		['dispose', (record) => delete record.dispose.orphanEvidence],
	];
	for (const [id, mutate] of holes) {
		it(`fails ${id} when the device reported nothing for one of its reads`, () => {
			const result = evaluateDeviceGate(withBroken(mutate), OPTIONS);
			assert.equal(result.pass, false);
			const step = stepOf(result, id);
			assert.equal(step.pass, false);
			assert.equal(step.actual, null);
			assert.match(step.reason, /no |not a list/u);
		});
	}

	it('fails every step when the runner collected nothing at all', () => {
		for (const record of [undefined, null, {}]) {
			const result = evaluateDeviceGate(record, OPTIONS);
			assert.equal(result.pass, false);
			assert.equal(stepOf(result, 'first-screen').pass, false);
		}
	});
});

describe('issue #234 device gate: step 1, the painted first screen', () => {
	it('fails when the tree holds a different number of rows than the window asked for', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.firstScreen.rowCount = 999)),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'first-screen').pass, false);
		assert.match(stepOf(result, 'first-screen').reason, /999 rows, not 1000/u);
	});

	it('fails when the painted row is not the row shape the harness contract names', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.firstScreen.firstRowClass = 'col-id')),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'first-screen').pass, false);
	});
});

describe('issue #234 device gate: step 2, adoption over the real ContextProxy', () => {
	it('fails a repair, and says that is what happened', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.adoption.firstTreeAction = 'repair')),
			OPTIONS,
		);
		const step = stepOf(result, 'adoption');
		assert.equal(step.pass, false);
		assert.match(step.reason, /repaired the first tree/u);
	});

	it('fails a run that carried no first tree at all', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.adoption.firstTreeAction = 'none')),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'adoption').pass, false);
	});

	it('fails a first-tree lifecycle that had not ended when the gate read it', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.adoption.firstTreeSettled = 0)),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'adoption').pass, false);
	});
});

describe('issue #234 device gate: step 3, the native tap', () => {
	it('fails a tap that reached the neighbour’s handler', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.nativeTap.dispatchedTo = 502)),
			OPTIONS,
		);
		const step = stepOf(result, 'native-tap');
		assert.equal(step.pass, false);
		assert.match(step.reason, /row 502, not row 501/u);
	});

	it('fails a handler that ran without the tapped row changing', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.nativeTap.tapped.class = 'row')),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'native-tap').pass, false);
	});

	it('fails a change that also landed on a neighbour', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.nativeTap.neighbours[0].class = 'row danger')),
			OPTIONS,
		);
		const step = stepOf(result, 'native-tap');
		assert.equal(step.pass, false);
		assert.match(step.reason, /1 neighbouring row/u);
	});
});

describe('issue #234 device gate: step 4, the slot update', () => {
	it('fails a named row the update never reached', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.slotUpdate.updated[1].label = 'clean tall mouse')),
			OPTIONS,
		);
		const step = stepOf(result, 'slot-update');
		assert.equal(step.pass, false);
		assert.match(step.reason, /1 named row\(s\) did not receive/u);
	});

	it('fails an update that spilled onto a row it did not name', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.slotUpdate.untouched[0].label = 'plain white table !!!')),
			OPTIONS,
		);
		const step = stepOf(result, 'slot-update');
		assert.equal(step.pass, false);
		assert.match(step.reason, /1 row\(s\) it did not name/u);
	});
});

describe('issue #234 device gate: step 5, clear and retention', () => {
	it('fails a clear that left rows painted', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.clearCycles[2].rowCountAfterClear = 4)),
			OPTIONS,
		);
		const step = stepOf(result, 'clear-retention');
		assert.equal(step.pass, false);
		assert.match(step.reason, /cycle 3 left 4 rows/u);
	});

	it('fails a residual that grows across cycles, and prints the drift', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => {
				record.clearCycles[1].liveElementsAfterClear = 42;
				record.clearCycles[2].liveElementsAfterClear = 43;
			}),
			OPTIONS,
		);
		const step = stepOf(result, 'clear-retention');
		assert.equal(step.pass, false);
		assert.match(step.reason, /41 → 42 → 43/u);
	});

	it('fails a window that ran fewer cycles than it claimed', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => record.clearCycles.pop()),
			OPTIONS,
		);
		const step = stepOf(result, 'clear-retention');
		assert.equal(step.pass, false);
		assert.match(step.reason, /2 of 3 cycles/u);
	});
});

describe('issue #234 device gate: step 6, dispose', () => {
	it('fails a disposed root that still acknowledged a commit', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.dispose.acksAfterDispose = 1)),
			OPTIONS,
		);
		const step = stepOf(result, 'dispose');
		assert.equal(step.pass, false);
		assert.match(step.reason, /still answered/u);
	});

	it('fails a disposed root whose probe still reported state', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.dispose.observationsAfterDispose = 2)),
			OPTIONS,
		);
		assert.equal(stepOf(result, 'dispose').pass, false);
	});

	it('fails on an orphan listener line in the log', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.dispose.orphanEvidence = ['stale listener for host 12'])),
			OPTIONS,
		);
		const step = stepOf(result, 'dispose');
		assert.equal(step.pass, false);
		assert.match(step.reason, /1 orphan listener line/u);
	});

	it('fails a silence nothing was given the chance to break', () => {
		// The step that is easiest to pass by accident: a run that tapped nothing
		// after the dispose observes zero acks and zero observations, and would
		// read as a clean teardown while proving only that nobody looked.
		const result = evaluateDeviceGate(
			withBroken((record) => (record.dispose.provokedAfterDispose = 0)),
			OPTIONS,
		);
		const step = stepOf(result, 'dispose');
		assert.equal(step.pass, false);
		assert.match(step.reason, /nothing was tapped/u);
	});
});

describe('issue #234 device gate: ordering', () => {
	it('stops at the first failure and marks the rest not run', () => {
		// Step 3 taps a row step 1 is what proves exists. Reporting six verdicts
		// from a tree that already went wrong at step 1 would be five guesses next
		// to one finding.
		const result = evaluateDeviceGate(
			withBroken((record) => (record.firstScreen.rowCount = 0)),
			OPTIONS,
		);
		assert.equal(result.pass, false);
		assert.equal(stepOf(result, 'first-screen').skipped, false);
		for (const id of ['adoption', 'native-tap', 'slot-update', 'clear-retention', 'dispose']) {
			const step = stepOf(result, id);
			assert.equal(step.skipped, true, `${id} should be skipped`);
			assert.equal(step.pass, false, `${id} must not read as a pass`);
			assert.match(step.reason, /an earlier step failed/u);
		}
	});

	it('a later failure leaves the earlier passes standing', () => {
		const result = evaluateDeviceGate(
			withBroken((record) => (record.dispose.acksAfterDispose = 3)),
			OPTIONS,
		);
		assert.equal(result.pass, false);
		for (const id of ['first-screen', 'adoption', 'native-tap', 'slot-update', 'clear-retention']) {
			assert.equal(stepOf(result, id).pass, true, `${id} should still pass`);
		}
	});
});
