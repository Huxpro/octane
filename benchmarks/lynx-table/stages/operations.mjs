// The measured operation table for the stage-decomposition harness.
//
// `run.mjs` launches Chromium at import time, so the table lives here instead:
// the equivalence test can pin every click target and predicate without paying
// for a browser. Entries are plain data. A target is either a labelled button
// or a row cell; a predicate closes the measured interval on the shared
// composed-tree observer, and `derive` covers the cases whose predicate is only
// knowable from the pre-click table state.

// A storm runs fifty rounds back to back, so it needs far more than the
// per-operation default before the shared driver gives up.
export const STORM_TIMEOUT_MS = 240_000;
export const DEFAULT_TIMEOUT_MS = 120_000;

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

/**
 * The measured table.
 *
 * `teardown` adds the two clear cells. Off by default because every added cell
 * is measured in all three variants at every repetition, and the campaigns that
 * read this table are about what a frame costs to build, not what it costs to
 * release. A flag rather than a second table so the two clear cells are built
 * from the same `createSetup` as everything else and cannot drift from it.
 */
export function buildOperations(rows, { teardown = false } = {}) {
	if (!Number.isSafeInteger(rows) || rows <= 0)
		throw new TypeError('rows must be a positive integer.');
	const createTarget = { kind: 'button', label: createButtonLabel(rows) };
	const createSetup = { target: createTarget, predicate: { type: 'rowCount', value: rows } };
	const updateStep = {
		target: { kind: 'button', label: 'Update every 10th row' },
		derive: { type: 'labelSuffix', index: 0, suffix: ' !!!' },
	};
	const clearCell = (setup) => ({
		scale: rows,
		setup,
		target: { kind: 'button', label: 'Clear' },
		predicate: { type: 'rowCount', value: 0 },
		// A clear at 30k walks every row it is about to destroy, so it gets the
		// storm's budget rather than the per-operation default.
		timeoutMs: STORM_TIMEOUT_MS,
	});
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
			...updateStep,
		},
		// Fifty successive update rounds. Expected to sit at the flush/layout
		// floor, so it bounds what any wire or replanning change could win.
		updateStorm: {
			scale: rows,
			setup: createSetup,
			target: { kind: 'button', label: 'Update storm' },
			predicate: { type: 'labelAt', index: 0, equals: 'bench 50' },
			timeoutMs: STORM_TIMEOUT_MS,
		},
		// Single-row class flip driven by a main-thread event round trip.
		select: {
			scale: rows,
			setup: createSetup,
			target: { kind: 'cell', rowIndex: 1, class: 'col-label' },
			predicate: { type: 'dangerAt', index: 1 },
		},
		// The teardown pair, and it is a pair on purpose. `clear` releases only
		// what a create built; `updateThenClear` releases that plus whatever the
		// update round left behind — patched prop bags, delta-shadow entries, the
		// prepared-static-prop cache. Neither number reads alone: the claim this
		// pair can make is the difference between them, measured in one window at
		// one scale, which is the only form this harness's own protocol admits.
		...(teardown
			? {
					clear: clearCell([createSetup]),
					updateThenClear: clearCell([createSetup, updateStep]),
				}
			: null),
	};
}

// Cells reported after create, in table order. Derived rather than listed, so a
// new operation cannot be measured and then silently left out of the report.
export function mutationOperations(operations) {
	return Object.keys(operations).filter((name) => name !== 'create');
}

/**
 * A cell's setup clicks, in order.
 *
 * The cells measured before the teardown pair existed carry their single setup
 * step as a bare object, and their published attribution is only comparable
 * across sessions if that shape does not move — the equivalence test pins it.
 * So the sequence form is additive: an array where a cell needs more than one
 * click, the original object everywhere else, and one reader that takes both.
 */
export function setupSteps(operation) {
	if (operation.setup === undefined) return [];
	return Array.isArray(operation.setup) ? operation.setup : [operation.setup];
}

/**
 * How a setup step's closing predicate is obtained: a literal, or a derivation
 * that has to read the table first.
 *
 * The decision lives here and the page read lives in the runner, for the same
 * reason the operation table lives here at all — `run.mjs` launches Chromium at
 * import time, and a branch nothing can reach without a browser is a branch
 * nothing tests.
 *
 * A setup step has no checksum fallback. The measured interval has not opened
 * yet, so a step that cannot say when it finished would let the next click land
 * on a table still settling, and the cell would measure the tail of the setup
 * rather than the operation. Declaring one is the step's own job.
 */
export function setupPredicateSpec(step) {
	// Both is refused rather than resolved by precedence. A step that declares
	// two closing conditions has two different measured intervals depending on
	// which one this function happens to prefer, and picking one silently is how
	// a cell ends up measuring the tail of its own setup with nothing to show for
	// it. Neither is refused for the same reason, one step earlier.
	if (step.derive !== undefined && step.predicate !== undefined) {
		throw new Error(
			`setup step ${describeTarget(step.target)} declares both a predicate and a derivation.`,
		);
	}
	if (step.derive !== undefined) return { derive: step.derive };
	if (step.predicate === undefined)
		throw new Error(`setup step ${describeTarget(step.target)} declares no closing predicate.`);
	return { predicate: step.predicate };
}

export function operationTimeout(operation) {
	return operation.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
