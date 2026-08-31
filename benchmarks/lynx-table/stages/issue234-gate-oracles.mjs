// Issue #234 Part D — the device correctness gate, as a table of oracles.
//
// Every device window so far has measured. None has asserted. A number from a
// device says how long something took; it says nothing about whether the thing
// was correct, and the two questions have been answered by the same runs on the
// assumption that a run which produced a number must have worked. Round 2 came
// closest — `validBackgroundState` checked four row ids — and that check lived
// inside a measurement runner, applied to one workload, as a filter on which
// samples to keep rather than as a result of its own.
//
// This is the result of its own: six steps, each with a pass/fail oracle read
// from device state, producing one record that says pass or fail. It runs
// before the measurement windows of every future device round.
//
// Two rules give the gate its teeth, and both are enforced here rather than
// left to the runner:
//
//   An observation that is missing FAILS its step. A gate that goes green
//   because its oracle could not be read is worse than no gate: it converts
//   "we did not find out" into "it works", which is the exact failure this
//   file exists to end. Every oracle below therefore proves what it read
//   before it judges it.
//
//   The oracles are pure. They take a record and return a verdict, touching no
//   device, no clock, and no file. That is what lets the table be tested here,
//   on every commit, without a lease — so the thing a device lease runs is
//   already known to judge correctly, and the only thing the lease adds is the
//   device.
//
// The observations themselves come from `issue234-gate-instrument.mjs` (the
// build-only app probe) by way of `issue234-device-gate.mjs` (the runner).

export const DEVICE_GATE_PROTOCOL = 'octane-issue234-gate-v1';

/**
 * A step's verdict.
 *
 * `expected` and `actual` are carried on a pass as well as a failure. A record
 * that only says "pass" cannot be re-read later against a changed expectation,
 * and a gate whose passing records say nothing is a gate nobody can audit.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   pass: boolean,
 *   expected: unknown,
 *   actual: unknown,
 *   reason: string | null,
 * }} DeviceGateStepVerdict
 */

/** Read `key` off `source`, or report why it could not be judged. */
function required(source, key) {
	if (source === null || source === undefined || typeof source !== 'object') {
		return { ok: false, reason: `no ${key}: the observation object is missing` };
	}
	const value = source[key];
	if (value === undefined || value === null) {
		return { ok: false, reason: `no ${key}: the device reported nothing for it` };
	}
	return { ok: true, value };
}

function missing(reason) {
	return { pass: false, expected: 'an observation', actual: null, reason };
}

/**
 * The six steps, in the order a lease runs them.
 *
 * Each `oracle` takes the whole observation record plus the window's options
 * and returns `{pass, expected, actual, reason}`. Order matters: a step reads
 * state the previous steps left, which is why the gate stops at the first
 * failure rather than reporting six verdicts derived from a tree that already
 * went wrong at step 1.
 */
export const DEVICE_GATE_STEPS = [
	{
		id: 'first-screen',
		title: 'a first screen paints the rows it was given',
		reads: 'the painted tree, through a nodes-ref sibling index and class read',
		why:
			'The count comes from the tree the platform holds, not from the array the ' +
			'background thinks it rendered. Those two disagreeing is precisely the ' +
			'failure a framework-state assertion cannot see.',
		oracle(record, { scale }) {
			const screen = record.firstScreen;
			const rowCount = required(screen, 'rowCount');
			if (!rowCount.ok) return missing(rowCount.reason);
			const firstRowClass = required(screen, 'firstRowClass');
			if (!firstRowClass.ok) return missing(firstRowClass.reason);
			const classes = String(firstRowClass.value).split(/\s+/u).filter(Boolean);
			const actual = { rowCount: rowCount.value, firstRowClass: firstRowClass.value };
			if (rowCount.value !== scale) {
				return {
					pass: false,
					expected: { rowCount: scale, firstRowClass: 'includes row' },
					actual,
					reason: `the painted tree holds ${rowCount.value} rows, not ${scale}`,
				};
			}
			if (!classes.includes('row')) {
				return {
					pass: false,
					expected: { rowCount: scale, firstRowClass: 'includes row' },
					actual,
					reason: `the first painted row carries ${JSON.stringify(firstRowClass.value)}`,
				};
			}
			return {
				pass: true,
				expected: { rowCount: scale, firstRowClass: 'includes row' },
				actual,
				reason: null,
			};
		},
	},
	{
		id: 'adoption',
		title: 'the background adopts the painted first tree rather than repairing it',
		reads: "the main thread's own first-tree receipt (`firstTreeAction`, `firstTreeSettled`)",
		why:
			'An adoption and a repair both end with a correct page and cost wildly ' +
			'different things, so nothing downstream can tell them apart. This is the ' +
			"codec's (#164) first on-device assertion: the background described the " +
			'same tree the main thread painted, over the real ContextProxy.',
		oracle(record) {
			const action = required(record.adoption, 'firstTreeAction');
			if (!action.ok) return missing(action.reason);
			const settled = required(record.adoption, 'firstTreeSettled');
			if (!settled.ok) return missing(settled.reason);
			const actual = { firstTreeAction: action.value, firstTreeSettled: settled.value };
			const expected = { firstTreeAction: 'adopt', firstTreeSettled: 1 };
			if (action.value !== 'adopt') {
				return {
					pass: false,
					expected,
					actual,
					reason:
						action.value === 'repair'
							? 'the background repaired the first tree over the command path instead of adopting it'
							: `the first-tree comparator decided ${JSON.stringify(action.value)}`,
				};
			}
			if (settled.value !== 1) {
				return {
					pass: false,
					expected,
					actual,
					reason: 'the first-tree lifecycle had not ended when the gate read it',
				};
			}
			return { pass: true, expected, actual, reason: null };
		},
	},
	{
		id: 'native-tap',
		title: 'a real native tap routes to the handler of the row it landed on',
		reads: 'the delegated handler receipt, plus a class read of the tapped row and its neighbours',
		why:
			'The C2-era token numbering contract, asserted where it matters. A tap ' +
			'that reaches the neighbour of the row it hit still produces a correct-' +
			'looking page and a plausible latency number; only comparing the row the ' +
			'platform was told about with the row that changed can catch it.',
		oracle(record) {
			const tap = record.nativeTap;
			const target = required(tap, 'target');
			if (!target.ok) return missing(target.reason);
			const dispatchedTo = required(tap, 'dispatchedTo');
			if (!dispatchedTo.ok) return missing(dispatchedTo.reason);
			const tapped = required(tap, 'tapped');
			if (!tapped.ok) return missing(tapped.reason);
			const neighbours = required(tap, 'neighbours');
			if (!neighbours.ok) return missing(neighbours.reason);
			if (!Array.isArray(neighbours.value) || neighbours.value.length === 0) {
				return missing('no neighbours: a tap with nothing to be confused with proves nothing');
			}
			const targetId = target.value.id;
			const selected = (entry) =>
				String(entry?.class ?? '')
					.split(/\s+/u)
					.includes('danger');
			const actual = {
				target: target.value,
				dispatchedTo: dispatchedTo.value,
				tapped: tapped.value,
				neighbours: neighbours.value,
			};
			const expected = {
				dispatchedTo: targetId,
				tapped: 'includes danger',
				neighbours: 'none includes danger',
			};
			if (dispatchedTo.value !== targetId) {
				return {
					pass: false,
					expected,
					actual,
					reason: `the tap reached the handler for row ${dispatchedTo.value}, not row ${targetId}`,
				};
			}
			if (!selected(tapped.value)) {
				return {
					pass: false,
					expected,
					actual,
					reason: 'the handler ran but the tapped row was not the node that changed',
				};
			}
			const strays = neighbours.value.filter(selected);
			if (strays.length !== 0) {
				return {
					pass: false,
					expected,
					actual,
					reason: `the change also landed on ${strays.length} neighbouring row(s)`,
				};
			}
			return { pass: true, expected, actual, reason: null };
		},
	},
	{
		id: 'slot-update',
		title: 'a slot update lands on the nodes it names and no others',
		reads: 'the painted text of the rows the update named, and of the rows it did not',
		why:
			'An update that writes the right value to the wrong node, or the right ' +
			'node twice, is the failure mode a per-node slot table has; a screenshot ' +
			'of the result looks nearly right, and a duration says nothing at all.',
		oracle(record) {
			const update = record.slotUpdate;
			const marker = required(update, 'marker');
			if (!marker.ok) return missing(marker.reason);
			const updated = required(update, 'updated');
			if (!updated.ok) return missing(updated.reason);
			const untouched = required(update, 'untouched');
			if (!untouched.ok) return missing(untouched.reason);
			if (!Array.isArray(updated.value) || updated.value.length === 0) {
				return missing('no updated rows: an update that named nothing proves nothing');
			}
			if (!Array.isArray(untouched.value) || untouched.value.length === 0) {
				return missing('no untouched rows: without a control, an update to everything passes');
			}
			const carries = (entry) => String(entry?.label ?? '').endsWith(marker.value);
			const actual = { marker: marker.value, updated: updated.value, untouched: untouched.value };
			const expected = {
				updated: `every label ends with ${JSON.stringify(marker.value)}`,
				untouched: 'no label does',
			};
			const missed = updated.value.filter((entry) => !carries(entry));
			if (missed.length !== 0) {
				return {
					pass: false,
					expected,
					actual,
					reason: `${missed.length} named row(s) did not receive the update`,
				};
			}
			const spilled = untouched.value.filter(carries);
			if (spilled.length !== 0) {
				return {
					pass: false,
					expected,
					actual,
					reason: `the update also landed on ${spilled.length} row(s) it did not name`,
				};
			}
			return { pass: true, expected, actual, reason: null };
		},
	},
	{
		id: 'clear-retention',
		title: 'clearing empties the tree, and repeating it retains nothing',
		reads: 'the painted row count and the live element count after each clear',
		why:
			'The device mirror of #230’s `heapMtsAfterClear` drift. One clear that ' +
			'reaches zero proves the clear; only N paint→clear→repaint cycles ' +
			'landing on the same residual prove that nothing is kept. The live count ' +
			'is created-minus-removed at the Element PAPI, so it is a reference read ' +
			'rather than a heap sample: it is exact, and it does not move with GC.',
		oracle(record, { cycles }) {
			const observed = record.clearCycles;
			if (!Array.isArray(observed) || observed.length === 0) {
				return missing('no clear cycles: the gate never saw a teardown');
			}
			const expected = {
				cycles,
				rowCountAfterClear: 0,
				liveElementsAfterClear: 'the same after every cycle',
			};
			if (observed.length !== cycles) {
				return {
					pass: false,
					expected,
					actual: observed,
					reason: `${observed.length} of ${cycles} cycles completed`,
				};
			}
			for (const cycle of observed) {
				const rows = required(cycle, 'rowCountAfterClear');
				if (!rows.ok) return missing(rows.reason);
				const live = required(cycle, 'liveElementsAfterClear');
				if (!live.ok) return missing(live.reason);
				if (rows.value !== 0) {
					return {
						pass: false,
						expected,
						actual: observed,
						reason: `cycle ${cycle.cycle} left ${rows.value} rows painted`,
					};
				}
			}
			const residuals = observed.map((cycle) => cycle.liveElementsAfterClear);
			const distinct = [...new Set(residuals)];
			if (distinct.length !== 1) {
				return {
					pass: false,
					expected,
					actual: observed,
					reason: `the residual element count moved across cycles: ${residuals.join(' → ')}`,
				};
			}
			return { pass: true, expected, actual: observed, reason: null };
		},
	},
	{
		id: 'dispose',
		title: 'disposing the root leaves nothing that still answers',
		reads:
			'transport acks and probe observations produced after the dispose, and the orphan journal',
		why:
			'A listener that outlives its tree is invisible until something taps ' +
			'where its node used to be. The receipt is an absence, so the gate has ' +
			'to create the opportunity for the absence to be violated: it taps the ' +
			'disposed region and asserts that nothing answered.',
		oracle(record) {
			const dispose = record.dispose;
			const provoked = required(dispose, 'provokedAfterDispose');
			if (!provoked.ok) return missing(provoked.reason);
			const acks = required(dispose, 'acksAfterDispose');
			if (!acks.ok) return missing(acks.reason);
			const observations = required(dispose, 'observationsAfterDispose');
			if (!observations.ok) return missing(observations.reason);
			const orphans = required(dispose, 'orphanEvidence');
			if (!orphans.ok) return missing(orphans.reason);
			if (!Array.isArray(orphans.value)) {
				return missing('orphanEvidence is not a list of lines');
			}
			const actual = {
				provokedAfterDispose: provoked.value,
				acksAfterDispose: acks.value,
				observationsAfterDispose: observations.value,
				orphanEvidence: orphans.value,
			};
			const expected = {
				provokedAfterDispose: 'at least one',
				acksAfterDispose: 0,
				observationsAfterDispose: 0,
				orphanEvidence: 'empty',
			};
			// An absence nobody gave a chance to be violated is not evidence.
			if (provoked.value < 1) {
				return {
					pass: false,
					expected,
					actual,
					reason: 'nothing was tapped after the dispose, so the silence proves nothing',
				};
			}
			if (acks.value !== 0 || observations.value !== 0) {
				return {
					pass: false,
					expected,
					actual,
					reason: `the disposed root still answered: ${acks.value} ack(s), ${observations.value} observation(s)`,
				};
			}
			if (orphans.value.length !== 0) {
				return {
					pass: false,
					expected,
					actual,
					reason: `${orphans.value.length} orphan listener line(s) in the log`,
				};
			}
			return { pass: true, expected, actual, reason: null };
		},
	},
];

/**
 * Judge one window's observations against the table above.
 *
 * Stops at the first failing step and marks the rest `skipped`: step 3 taps a
 * row that step 1 is what proves exists, so six verdicts taken from a tree that
 * already went wrong at step 1 would be five guesses next to one finding.
 *
 * @param {Record<string, unknown>} observations what the runner collected
 * @param {{scale: number, cycles: number}} options the window this ran
 */
export function evaluateDeviceGate(observations, { scale, cycles }) {
	if (!Number.isSafeInteger(scale) || scale < 1) {
		throw new Error('device gate scale must be a positive integer.');
	}
	if (!Number.isSafeInteger(cycles) || cycles < 2) {
		// One cycle cannot show a trend, and a retention oracle over one sample
		// would report "flat" for a container that leaks on every clear.
		throw new Error('device gate cycles must be at least 2.');
	}
	const steps = [];
	let failed = false;
	for (const step of DEVICE_GATE_STEPS) {
		if (failed) {
			steps.push({
				id: step.id,
				title: step.title,
				pass: false,
				skipped: true,
				expected: null,
				actual: null,
				reason: 'not run: an earlier step failed',
			});
			continue;
		}
		const verdict = step.oracle(observations ?? {}, { scale, cycles });
		steps.push({
			id: step.id,
			title: step.title,
			pass: verdict.pass,
			skipped: false,
			expected: verdict.expected,
			actual: verdict.actual,
			reason: verdict.reason,
		});
		if (!verdict.pass) failed = true;
	}
	return {
		protocol: DEVICE_GATE_PROTOCOL,
		pass: !failed,
		scale,
		cycles,
		steps,
	};
}
