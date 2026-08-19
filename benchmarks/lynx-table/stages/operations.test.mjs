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
	for (const [name, operation] of Object.entries(buildOperations(10000))) {
		const predicate =
			operation.derive === undefined
				? (operation.predicate ?? { type: 'checksumNot' })
				: derivedPredicate(operation.derive, 'bench 1');
		assert.ok(known.has(predicate.type), `${name} closes on unknown predicate ${predicate.type}`);
		if (operation.setup !== undefined) {
			assert.ok(known.has(operation.setup.predicate.type), `${name} setup predicate`);
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
	// Derived, not listed: adding an operation must not be able to measure a cell
	// the report then omits.
	assert.deepEqual(
		mutationOperations({ create: {}, alpha: {}, beta: {} }),
		['alpha', 'beta'],
	);
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
	assert.equal(describeTarget({ kind: 'button', label: 'Append 1,000 rows' }), 'Append 1,000 rows button');
	assert.equal(describeTarget({ kind: 'cell', rowIndex: 1, class: 'col-label' }), 'row 1 col-label cell');
});
