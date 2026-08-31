import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_TIMEOUT_MS,
	STORM_TIMEOUT_MS,
	buildOperations,
	createButtonLabel,
	derivedPredicate,
	describeTarget,
	mutationOperations,
	operationTimeout,
	scaleTag,
	setupPredicateSpec,
	setupSteps,
} from './operations.mjs';

// The create/replace/append cells were measured before `update10th` and
// `select` existed, and their published attribution is only comparable across
// sessions if the click target and the closing predicate did not move. These
// literals are the pre-change harness behaviour: `replace`/`append` set up with
// one "Create 1,000 rows" click awaited on `rowCount: 1000`, `replace` closes on
// the checksum fallback because it declares no predicate, and `append` closes on
// the doubled row count.
const ESTABLISHED_CELLS = {
	create: {
		scale: 10000,
		target: { kind: 'button', label: 'Create 10,000 rows' },
		predicate: { type: 'rowCount', value: 10000 },
	},
	replace: {
		scale: 1000,
		setup: {
			target: { kind: 'button', label: 'Create 1,000 rows' },
			predicate: { type: 'rowCount', value: 1000 },
		},
		target: { kind: 'button', label: 'Create 1,000 rows' },
	},
	append: {
		scale: 1000,
		setup: {
			target: { kind: 'button', label: 'Create 1,000 rows' },
			predicate: { type: 'rowCount', value: 1000 },
		},
		target: { kind: 'button', label: 'Append 1,000 rows' },
		predicate: { type: 'rowCount', value: 2000 },
	},
};

test('the established cells are unchanged by the added operations', () => {
	const operations = buildOperations(10000);
	for (const [name, expected] of Object.entries(ESTABLISHED_CELLS)) {
		assert.deepEqual(operations[name], expected, `${name} cell drifted`);
	}
});

test('the pure-mutation cells set up their own table at the measured scale', () => {
	const operations = buildOperations(10000);
	// Neither cell may create or destroy rows: whatever they cost is replanning,
	// wire, and host apply over a tree that already exists.
	assert.deepEqual(operations.update10th, {
		scale: 10000,
		setup: {
			target: { kind: 'button', label: 'Create 10,000 rows' },
			predicate: { type: 'rowCount', value: 10000 },
		},
		target: { kind: 'button', label: 'Update every 10th row' },
		derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
	});
	assert.deepEqual(operations.updateStorm, {
		scale: 10000,
		setup: {
			target: { kind: 'button', label: 'Create 10,000 rows' },
			predicate: { type: 'rowCount', value: 10000 },
		},
		target: { kind: 'button', label: 'Update storm' },
		predicate: { type: 'labelAt', index: 0, equals: 'bench 50' },
		timeoutMs: STORM_TIMEOUT_MS,
	});
	assert.deepEqual(operations.select, {
		scale: 10000,
		setup: {
			target: { kind: 'button', label: 'Create 10,000 rows' },
			predicate: { type: 'rowCount', value: 10000 },
		},
		target: { kind: 'cell', rowIndex: 1, class: 'col-label' },
		predicate: { type: 'dangerAt', index: 1 },
	});
});

test('a cell measured at the create scale follows the requested scale', () => {
	for (const rows of [1000, 3000, 30000]) {
		const operations = buildOperations(rows);
		const label = createButtonLabel(rows);
		for (const name of ['create', 'update10th', 'updateStorm', 'select']) {
			assert.equal(operations[name].scale, rows, `${name} scale`);
		}
		assert.equal(operations.update10th.setup.target.label, label);
		assert.deepEqual(operations.select.setup.predicate, { type: 'rowCount', value: rows });
		// The 1k mutation cells stay pinned to 1k whatever the create scale is.
		assert.equal(operations.replace.scale, 1000);
		assert.equal(operations.append.scale, 1000);
	}
});

test('every operation closes on a predicate the shared driver understands', () => {
	const known = new Set(['rowCount', 'labelAt', 'dangerAt', 'checksumNot', 'contentAtLeast']);
	// Both tables, because a cell the default run never measures is exactly the
	// one a driver change can break without anything going red.
	for (const teardown of [false, true]) {
		for (const [name, operation] of Object.entries(buildOperations(10000, { teardown }))) {
			const predicate =
				operation.derive === undefined
					? (operation.predicate ?? { type: 'checksumNot' })
					: derivedPredicate(operation.derive, 'bench 1');
			assert.ok(known.has(predicate.type), `${name} closes on unknown predicate ${predicate.type}`);
			// A setup step has no checksum fallback — the measured interval has not
			// opened yet — so each one has to say for itself when it is finished.
			for (const step of setupSteps(operation)) {
				const stepPredicate =
					step.derive === undefined ? step.predicate : derivedPredicate(step.derive, 'bench 1');
				assert.ok(stepPredicate !== undefined, `${name} setup step declares no predicate`);
				assert.ok(known.has(stepPredicate.type), `${name} setup predicate`);
			}
		}
	}
});

test('every measured cell but create is reported, in table order', () => {
	const operations = buildOperations(10000);
	assert.deepEqual(mutationOperations(operations), [
		'replace',
		'append',
		'update10th',
		'updateStorm',
		'select',
	]);
	// The teardown pair appends rather than interleaves, so a report built with
	// it is the report built without it plus two rows.
	assert.deepEqual(mutationOperations(buildOperations(10000, { teardown: true })), [
		'replace',
		'append',
		'update10th',
		'updateStorm',
		'select',
		'clear',
		'updateThenClear',
	]);
	// Derived, not listed: adding an operation must not be able to measure a cell
	// the report then omits.
	assert.deepEqual(mutationOperations({ create: {}, alpha: {}, beta: {} }), ['alpha', 'beta']);
});

test('only the storm gets the long deadline', () => {
	const operations = buildOperations(10000);
	// Fifty rounds cannot finish inside the per-operation default, and the
	// shared driver would reject the sample as a timeout rather than a result.
	assert.equal(operationTimeout(operations.updateStorm), STORM_TIMEOUT_MS);
	assert.ok(STORM_TIMEOUT_MS > DEFAULT_TIMEOUT_MS);
	for (const name of ['create', 'replace', 'append', 'update10th', 'select']) {
		assert.equal(operationTimeout(operations[name]), DEFAULT_TIMEOUT_MS, `${name} deadline`);
	}
});

test('the derived predicate stamps the observed label', () => {
	assert.deepEqual(derivedPredicate({ type: 'labelSuffix', index: 0, suffix: ' !!!' }, 'bench 7'), {
		type: 'labelAt',
		index: 0,
		equals: 'bench 7 !!!',
	});
	// An empty table would otherwise arm `labelAt(0) === 'null !!!'` and time out
	// 120 seconds later with no explanation.
	assert.throws(
		() => derivedPredicate({ type: 'labelSuffix', index: 0, suffix: ' !!!' }, null),
		/no label/,
	);
	assert.throws(() => derivedPredicate({ type: 'nope', index: 0 }, 'bench 7'), /unknown derived/);
});

test('an unsupported create scale fails before Chromium launches', () => {
	assert.throws(() => buildOperations(7777), /no create button for 7777/);
	assert.throws(() => buildOperations(0), /positive integer/);
	assert.throws(() => buildOperations(1.5), /positive integer/);
});

test('report labels', () => {
	assert.equal(scaleTag(1000), '1k');
	assert.equal(scaleTag(10000), '10k');
	assert.equal(scaleTag(1500), '1500');
	assert.equal(
		describeTarget({ kind: 'button', label: 'Append 1,000 rows' }),
		'Append 1,000 rows button',
	);
	assert.equal(
		describeTarget({ kind: 'cell', rowIndex: 1, class: 'col-label' }),
		'row 1 col-label cell',
	);
});

test('the default table is the one every published campaign measured', () => {
	// The teardown pair is opt-in, and this is what "opt-in" has to mean for a
	// harness whose records are compared across sessions: a run that does not ask
	// for it measures exactly the cells it measured before the pair existed.
	assert.deepEqual(Object.keys(buildOperations(10000)), [
		'create',
		'replace',
		'append',
		'update10th',
		'updateStorm',
		'select',
	]);
	assert.deepEqual(buildOperations(10000), buildOperations(10000, { teardown: false }));
});

test('the teardown pair differs only in the update round between create and clear', () => {
	const rows = 10000;
	const operations = buildOperations(rows, { teardown: true });
	const createStep = {
		target: { kind: 'button', label: 'Create 10,000 rows' },
		predicate: { type: 'rowCount', value: rows },
	};
	const updateStep = {
		target: { kind: 'button', label: 'Update every 10th row' },
		derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
	};
	// Same target, same closing predicate, same budget: the only thing that is
	// not held constant across the pair is the state the clear has to release.
	// That is what makes their difference readable as one claim.
	assert.deepEqual(operations.clear, {
		scale: rows,
		setup: [createStep],
		target: { kind: 'button', label: 'Clear' },
		predicate: { type: 'rowCount', value: 0 },
		timeoutMs: STORM_TIMEOUT_MS,
	});
	assert.deepEqual(operations.updateThenClear, {
		scale: rows,
		setup: [createStep, updateStep],
		target: { kind: 'button', label: 'Clear' },
		predicate: { type: 'rowCount', value: 0 },
		timeoutMs: STORM_TIMEOUT_MS,
	});
	// The update the pair inserts is the one `update10th` measures, not a second
	// definition of it that could drift away from the measured cell.
	const { scale, setup, ...measuredUpdate } = operations.update10th;
	assert.deepEqual(measuredUpdate, updateStep);
});

test('a setup sequence reads the same whether it is one step or several', () => {
	const operations = buildOperations(10000, { teardown: true });
	// The established cells keep the bare-object form their published records
	// were measured with, and the reader takes both shapes rather than the
	// harness rewriting them.
	assert.ok(!Array.isArray(operations.update10th.setup));
	assert.deepEqual(setupSteps(operations.update10th), [operations.update10th.setup]);
	assert.deepEqual(setupSteps(operations.updateThenClear), operations.updateThenClear.setup);
	assert.equal(setupSteps(operations.updateThenClear).length, 2);
	assert.deepEqual(setupSteps(operations.create), []);
});

test('a clear cell gets the storm budget rather than the per-operation default', () => {
	const operations = buildOperations(30000, { teardown: true });
	// A clear at the top of the ladder walks every row it is about to destroy,
	// and the default budget is what the pre-teardown cells were sized for.
	assert.equal(operationTimeout(operations.clear), STORM_TIMEOUT_MS);
	assert.equal(operationTimeout(operations.updateThenClear), STORM_TIMEOUT_MS);
	assert.notEqual(STORM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
});

test('a setup step says how its closing predicate is obtained', () => {
	const operations = buildOperations(10000, { teardown: true });
	const [createStep, updateStep] = setupSteps(operations.updateThenClear);
	// A literal predicate is returned as one; a derived one is handed back for
	// the runner to resolve against the live table, because the suffix it stamps
	// is only knowable from the labels the create click chose.
	assert.deepEqual(setupPredicateSpec(createStep), {
		predicate: { type: 'rowCount', value: 10000 },
	});
	assert.deepEqual(setupPredicateSpec(updateStep), {
		derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
	});
});

test('a setup step that declares two closing conditions is refused by name', () => {
	// Not a precedence question. Whichever this function preferred, the other
	// would be silently ignored and the cell would close on an interval its
	// author did not choose, so both is an error rather than a resolution.
	assert.throws(
		() =>
			setupPredicateSpec({
				target: { kind: 'button', label: 'Update every 10th row' },
				predicate: { type: 'rowCount', value: 10000 },
				derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
			}),
		/Update every 10th row button declares both a predicate and a derivation/,
	);
});

test('a setup step that declares no closing predicate is refused by name', () => {
	// Refused rather than defaulted. The measured interval has not opened yet, so
	// there is no checksum to fall back to, and a silent default would let the
	// next click land on a table still settling — the cell would then measure the
	// tail of its own setup.
	assert.throws(
		() => setupPredicateSpec({ target: { kind: 'button', label: 'Clear' } }),
		/Clear button declares no closing predicate/,
	);
	assert.throws(
		() => setupPredicateSpec({ target: { kind: 'cell', rowIndex: 1, class: 'col-label' } }),
		/row 1 col-label cell declares no closing predicate/,
	);
});
