import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCostModel, renderReport } from './build-report.mjs';

const results = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../results');

async function read(name) {
	return JSON.parse(await readFile(path.join(results, name), 'utf8'));
}

test('closes M2 and prevents validated M3 rows after the Q2 miss', async () => {
	const records = {
		dispatch: await read('lepus-cost-m1-dispatch-property-aries10-2026-08-26.json'),
		allocation: await read('lepus-cost-m1-allocation-string-branch-aries10-2026-08-26.json'),
		v8: await read('lepus-cost-m1-v8-context-2026-08-26.json'),
		prediction: await read('lepus-cost-m2-prediction-2026-08-26.json'),
		actual: await read('lepus-cost-m2-actual-q2-aries10-2026-08-26.json'),
		invalidObserver: await read(
			'lepus-cost-m2-invalid-observer-timeout-10000-aries10-2026-08-26.json',
		),
		invalidCrossing: await read(
			'lepus-cost-m2-invalid-crossing-timeout-30000-aries10-2026-08-26.json',
		),
	};
	const model = buildCostModel(records);
	assert.equal(model.m2.gate.pass, false);
	assert.ok(model.m2.q2Scales[0].programRelativeAbsoluteError > 0.9);
	assert.equal(model.m3.gateOpen, false);
	assert.equal(
		model.m3.rows.some((row) => row.evidenceStatus === 'validated'),
		false,
	);
	const report = renderReport(model);
	assert.match(report, /M2 gate is \*\*closed\*\*/);
	assert.doesNotMatch(report, /\[object Object\]/);
});
