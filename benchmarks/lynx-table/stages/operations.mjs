// The measured operation table for the stage-decomposition harness.
//
// `run.mjs` launches Chromium at import time, so the table lives here instead:
// the equivalence test can pin every click target and predicate without paying
// for a browser. Entries are plain data. A target is either a labelled button
// or a row cell; a predicate closes the measured interval on the shared
// composed-tree observer, and `derive` covers the cases whose predicate is only
// knowable from the pre-click table state.

const CREATE_LABELS = new Map([
	[1000, 'Create 1,000 rows'],
	[3000, 'Create 3,000 rows'],
	[5000, 'Create 5,000 rows'],
	[10000, 'Create 10,000 rows'],
	[20000, 'Create 20,000 rows'],
	[30000, 'Create 30,000 rows'],
]);

export function createButtonLabel(rows) {
	const label = CREATE_LABELS.get(rows);
	if (label === undefined) throw new Error(`the shared app has no create button for ${rows} rows.`);
	return label;
}

export function buildOperations(rows) {
	if (!Number.isSafeInteger(rows) || rows <= 0)
		throw new TypeError('rows must be a positive integer.');
	const createTarget = { kind: 'button', label: createButtonLabel(rows) };
	const createSetup = { target: createTarget, predicate: { type: 'rowCount', value: rows } };
	const thousandSetup = {
		target: { kind: 'button', label: 'Create 1,000 rows' },
		predicate: { type: 'rowCount', value: 1000 },
	};
	return {
		create: {
			scale: rows,
			target: createTarget,
			predicate: { type: 'rowCount', value: rows },
		},
		replace: {
			scale: 1000,
			setup: thousandSetup,
			target: { kind: 'button', label: 'Create 1,000 rows' },
		},
		append: {
			scale: 1000,
			setup: thousandSetup,
			target: { kind: 'button', label: 'Append 1,000 rows' },
			predicate: { type: 'rowCount', value: 2000 },
		},
		// Pure prop mutation over an existing tree: no rows are created or
		// removed, so whatever this costs is replanning, wire, and host apply.
		update10th: {
			scale: rows,
			setup: createSetup,
			target: { kind: 'button', label: 'Update every 10th row' },
			derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
		},
		// Single-row class flip driven by a main-thread event round trip.
		select: {
			scale: rows,
			setup: createSetup,
			target: { kind: 'cell', rowIndex: 1, class: 'col-label' },
			predicate: { type: 'dangerAt', index: 1 },
		},
	};
}

// Cells reported after create, in table order. Derived rather than listed, so a
// new operation cannot be measured and then silently left out of the report.
export function mutationOperations(operations) {
	return Object.keys(operations).filter((name) => name !== 'create');
}

export function describeTarget(target) {
	return target.kind === 'button'
		? `${target.label} button`
		: `row ${target.rowIndex} ${target.class} cell`;
}

export function derivedPredicate(derive, before) {
	if (derive.type !== 'labelSuffix') throw new Error(`unknown derived predicate ${derive.type}.`);
	if (typeof before !== 'string')
		throw new Error(`row ${derive.index} has no label to derive a predicate from.`);
	return { type: 'labelAt', index: derive.index, equals: `${before}${derive.suffix}` };
}

export function scaleTag(scale) {
	return scale % 1000 === 0 ? `${scale / 1000}k` : String(scale);
}
