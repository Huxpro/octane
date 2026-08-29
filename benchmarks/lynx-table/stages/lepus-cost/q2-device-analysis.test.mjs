import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeQ2Samples, parseQ2Messages } from './q2-device-analysis.mjs';

test('parses an Android-quoted Q2 marker', () => {
	const log = 'I lynx: "__OCTANE_LEPUS_Q2__{\\"type\\":\\"sample\\",\\"profile\\":{}}"';
	assert.deepEqual(parseQ2Messages(log), [{ type: 'sample', profile: {} }]);
});

test('requires AB/BA and exact PAPI count identity', () => {
	const samples = [];
	for (let repetition = 0; repetition < 5; repetition += 1) {
		const order = repetition % 2 === 0 ? ['template', 'program'] : ['program', 'template'];
		for (const arm of order) {
			samples.push({
				rows: 1000,
				repetition,
				arm,
				scriptSelfMs: arm === 'program' ? 5 : 8,
				profile: {
					q2PapiCounts: {
						__CreateView: 7,
						__AppendElement: 7,
						...(arm === 'template' ? { __SetAttribute: 4 } : null),
					},
				},
			});
		}
	}
	const report = analyzeQ2Samples(samples, 5);
	assert.equal(report.scales[0].ordering, 'program-faster');
	samples.find(
		(sample) => sample.arm === 'program' && sample.repetition === 2,
	).profile.q2PapiCounts.__CreateView = 8;
	assert.throws(() => analyzeQ2Samples(samples, 5), /unstable callsBefore/);
});
