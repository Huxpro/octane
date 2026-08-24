// The report is where the control's verdict reaches a reader, so what is worth
// pinning is that it cannot describe a run it did not measure: claiming a
// confirmation, claiming an agreement between pairs that decided nothing, or
// omitting which half of the prediction failed.
//
// The renderer is exercised against runs built here rather than against the
// checked-in evidence, so these assertions test the renderer and not the host
// that produced one measurement. One test reads the frozen run, and it asserts
// that run's own verdict fields rather than the prose describing them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
	ARM_NAMES,
	ELEMENT_KINDS,
	NODES_PER_ROW,
	cellName,
	cellNames,
	summarizeArm,
} from './dom-attach-analyze.mjs';
import { renderFloorReport } from './dom-attach-report.mjs';

const frozen = (stem) =>
	JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'results', `${stem}.json`), 'utf8'));

const SCALES = [1000, 10000, 30000];

const META = {
	date: '2026-08-24T00:00:00.000Z',
	cpus: 4,
	cpuModel: 'test',
	platform: 'linux',
	release: '0',
	node: 'v22',
	chromium: '141',
	repetitions: 5,
	arms: ARM_NAMES,
	kinds: ELEMENT_KINDS,
	cells: cellNames(),
	scales: SCALES,
	nodesPerRow: NODES_PER_ROW,
	loadStart: [0, 0, 0],
	loadEnd: [0, 0, 0],
	protocol: 'synthetic',
};

// What an `inert` cell runs at, below its `upgraded` twin: the sections that
// subtract one kind from the other are only exercised if the two differ.
const INERT_OFFSET = 1.5;

/**
 * A run at the stated per-node command rates. `live-*` cells carry their rate in
 * the build span, since a live arm's command cost is its whole loop; `split-*`
 * cells carry theirs in the attach span. Every cell also gets a publishing span
 * and a frame so the sections that read those render. Rates state the `upgraded`
 * kind, which is the one that decides.
 */
function runAt(rates, { scales = SCALES } = {}) {
	const at = (cell, index) => {
		const [kind, arm] = cell.split(':');
		const key = arm === 'build' ? 'build' : arm;
		const rate = (rates[key] ?? rates.other ?? [1, 1, 1])[index];
		return kind === 'inert' ? rate - INERT_OFFSET : rate;
	};
	return scales.map((rows, index) => ({
		rows,
		arms: Object.fromEntries(
			META.cells.map((cell) => {
				const live = /:live-/.test(cell);
				const ms = (at(cell, index) * rows * NODES_PER_ROW) / 1000;
				// A live arm's attach span is its single publishing call, so the rate
				// goes to the build span and the publish is a small separate cost.
				const publishMs = live && cell.endsWith('-bulk') ? ms / 4 : 0;
				return [
					cell,
					summarizeArm(
						[
							{
								buildMs: live ? ms : 0,
								attachMs: live ? publishMs : ms,
								frameMs: 1,
								totalMs: ms + publishMs + 1,
							},
						],
						rows,
					),
				];
			}),
		),
	}));
}

// The measured shape: the deciding pair charges the same for both, and the
// localizing pair rises on both arms.
const REFUTING = {
	'live-incremental': [2.4, 2.43, 2.39],
	'live-bulk': [2.47, 2.46, 2.45],
	'split-incremental': [0.6, 0.559, 0.535],
	'split-bulk': [0.586, 0.68, 0.71],
	build: [1, 1, 1],
};

test('reports a refutation and says which clause failed', () => {
	const text = renderFloorReport(META, runAt(REFUTING));
	assert.ok(text.includes('**Prediction refuted (deciding pair).**'));
	assert.ok(text.includes('**Prediction refuted (localizing pair).**'));
	assert.ok(!text.includes('Prediction confirmed'));
	// The refutation is only useful if it says which clause failed.
	assert.ok(text.includes('Bulk does not rise'));
	assert.ok(text.includes('Incremental is not flat'));
	assert.ok(text.includes('Both arms rise together'));
	// And the campaign consequence, which is what #148 reads.
	assert.ok(text.includes("Publication's rise is not the platform's"));
});

test('reports a confirmation only for data that confirms', () => {
	// The same renderer against the shape the prediction predicted, so the
	// refutation above is a reading of the data and not something the report
	// always says.
	const text = renderFloorReport(
		META,
		runAt({
			'live-incremental': [2.4, 2.35, 2.3],
			'live-bulk': [2.4, 2.6, 3.0],
			'split-incremental': [0.6, 0.59, 0.58],
			'split-bulk': [0.6, 0.7, 0.9],
			build: [1, 1, 1],
		}),
	);
	assert.ok(text.includes('**Prediction confirmed (deciding pair).**'));
	assert.ok(!text.includes('Prediction refuted (deciding pair)'));
	assert.ok(text.includes("is the platform's own cost for attaching a large tree in one call"));
});

test('prints the registered reading beside the one that decides', () => {
	// The deciding rate was redefined after the run, so a reader has to be able
	// to see both and check that they agree. A report that showed only the
	// corrected one would be asking to be trusted instead.
	const text = renderFloorReport(META, runAt(REFUTING));
	assert.ok(text.includes('### The reading registered before the run'));
	assert.ok(text.includes('command µs/node | frame µs/node'));
	assert.ok(text.includes('contains no frame at all'));
});

test('prints the publishing call alone, per element kind', () => {
	// The attribution rests on this one span, and a reader who has to divide it
	// back out of the per-scale table is a reader who will read the loop instead.
	const text = renderFloorReport(META, runAt(REFUTING));
	assert.ok(text.includes('### The single publishing call'));
	for (const kind of ELEMENT_KINDS) assert.ok(text.includes(`| \`${kind}\` |`));
	// Rendered from the publishing span — a quarter of the loop rate in this
	// fixture — not from the build loop it excludes.
	assert.ok(text.includes('| `upgraded` | 0.617 | 0.615 | 0.612 |'));
	// And the two kinds are separate readings, not one number printed twice.
	assert.ok(text.includes('| `inert` | 0.243 | 0.24 | 0.238 |'));
});

test('names the element kinds it measured and which one decides', () => {
	// The claim this control got wrong the first time was a registration claim,
	// so the report has to say which kind carried the verdict.
	const text = renderFloorReport(META, runAt(REFUTING));
	assert.ok(text.includes('element kinds: inert, upgraded'));
	assert.ok(text.includes(`\`${cellName('upgraded', 'live-incremental')}\``));
	assert.ok(text.includes('the one the harness page holds'));
});

test('claims no agreement between two pairs that decided nothing', () => {
	const single = runAt(REFUTING).slice(0, 1);
	const text = renderFloorReport({ ...META, scales: [1000] }, single);
	assert.ok(text.includes('**Not evaluable (deciding pair).**'));
	assert.ok(!text.includes('Both pairs land the same way'));
	assert.ok(!text.includes('The pairs disagree'));
	assert.ok(text.includes('this run decided nothing'));
});

test('the checked-in evidence carries the verdict its report describes', () => {
	// The one assertion against live data, and it reads the run's own decided
	// fields rather than the prose: a re-measurement is allowed to change the
	// numbers, and if it ever changes the verdict this must be seen to fail.
	const run = frozen('dom-attach-floor');
	assert.equal(run.verdict.evaluable, true);
	assert.equal(run.verdict.predictionConfirmed, false);
	assert.equal(run.verdict.bulkRising, false);
	assert.equal(run.verdict.deciding.pair.incremental, cellName('upgraded', 'live-incremental'));
	// The kind axis is what makes the evidence readable at all, so a run frozen
	// without it would silently decide over the wrong cells.
	assert.deepEqual(run.meta.kinds, ELEMENT_KINDS);
	assert.deepEqual(run.meta.cells, cellNames());
});
