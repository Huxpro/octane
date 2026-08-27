import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildPrimitiveModel,
	emittedProgramInventory,
	predictEmittedProgram,
	predictTemplateLowerBound,
} from './m2-model.mjs';

function record(rows) {
	return {
		analysis: {
			rows: Object.entries(rows).map(([caseName, nsPerOp]) => ({
				case: caseName,
				fit: { nsPerOp },
			})),
		},
	};
}

test('builds an M1-only model and scales the static emitted inventory', () => {
	const dispatch = record({
		call_0_args: 100,
		call_3_args: 160,
		call_8_args: 260,
		host_papi_vs_lepus_call: 10,
		property_method_vs_local_binding: 2,
		array_index_store_vs_local: 5,
		empty_loop: 20,
		property_load_vs_local: 30,
	});
	const allocation = record({
		string_host_crossing_vs_stays: 570,
		array_literal_vs_scalar: 300,
	});
	const model = buildPrimitiveModel(dispatch, allocation);
	assert.ok(Math.abs(model.callFit.zeroArgumentNs - 100) < 1e-9);
	assert.ok(Math.abs(model.callFit.perArgumentNs - 20) < 1e-9);
	assert.ok(Math.abs(model.stringArgumentNs - 200) < 1e-9);
	assert.deepEqual(emittedProgramInventory(10).hostCallsByArgumentCount, {
		1: 70,
		2: 110,
		4: 20,
	});
	const small = predictEmittedProgram(model, 10);
	const large = predictEmittedProgram(model, 20);
	assert.ok(large.predictedMs > small.predictedMs * 1.9);
	assert.ok(predictTemplateLowerBound(model, 10).predictedLowerBoundMs > small.predictedMs);
});

test('rejects an incomplete primitive table', () => {
	assert.throws(() => buildPrimitiveModel(record({}), record({})), /call_0_args/);
});
