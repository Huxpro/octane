// The report is where the control's verdict reaches a reader, so what is worth
// pinning is that it cannot describe a run it did not measure: claiming a
// confirmation, claiming an agreement between pairs that decided nothing, or
// omitting which half of the prediction failed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { renderFloorReport } from './dom-attach-report.mjs';

const frozen = (stem) =>
	JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'results', `${stem}.json`), 'utf8'));

test('reports the measured refutation and never a confirmation', () => {
	const run = frozen('dom-attach-floor');
	const text = renderFloorReport(run.meta, run.scales);
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

test('prints the registered reading beside the one that decides', () => {
	// The deciding rate was redefined after the run, so a reader has to be able
	// to see both and check that they agree. A report that showed only the
	// corrected one would be asking to be trusted instead.
	const run = frozen('dom-attach-floor');
	const text = renderFloorReport(run.meta, run.scales);
	assert.ok(text.includes('### The reading registered before the run'));
	assert.ok(text.includes('command µs/node | frame µs/node'));
	assert.ok(text.includes('contains no frame at all'));
});

test('claims no agreement between two pairs that decided nothing', () => {
	const run = frozen('dom-attach-floor');
	const single = { ...run, scales: run.scales.slice(0, 1) };
	const text = renderFloorReport(single.meta, single.scales);
	assert.ok(text.includes('**Not evaluable (deciding pair).**'));
	assert.ok(!text.includes('Both pairs land the same way'));
	assert.ok(!text.includes('The pairs disagree'));
	assert.ok(text.includes('this run decided nothing'));
});
