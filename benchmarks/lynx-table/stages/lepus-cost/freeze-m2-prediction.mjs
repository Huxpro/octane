import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
	buildPrimitiveModel,
	predictEmittedProgram,
	predictTemplateLowerBound,
} from './m2-model.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const resultsDirectory = path.join(repositoryRoot, 'benchmarks/lynx-table/stages/results');
const dispatchPath = path.join(
	resultsDirectory,
	'lepus-cost-m1-dispatch-property-aries10-2026-08-26.json',
);
const allocationPath = path.join(
	resultsDirectory,
	'lepus-cost-m1-allocation-string-branch-aries10-2026-08-26.json',
);
const outputPath = path.join(resultsDirectory, 'lepus-cost-m2-prediction-2026-08-26.json');

function readInput(file) {
	const source = fs.readFileSync(file);
	return {
		record: JSON.parse(source),
		sha256: crypto.createHash('sha256').update(source).digest('hex'),
	};
}

if (fs.existsSync(outputPath)) {
	throw new Error(`refusing to replace frozen M2 prediction ${outputPath}`);
}
const downstreamActual = fs
	.readdirSync(resultsDirectory)
	.find((name) => name.startsWith('lepus-cost-m2-actual-'));
if (downstreamActual !== undefined) {
	throw new Error(`refusing to freeze prediction after actual record ${downstreamActual} exists`);
}

const dispatch = readInput(dispatchPath);
const allocation = readInput(allocationPath);
const model = buildPrimitiveModel(dispatch.record, allocation.record);
const scales = [1000, 10000, 30000];
const record = {
	schema: 'octane.lepus-cost.m2-prediction.v1',
	issue: 'https://github.com/Huxpro/octane/issues/196',
	protocol: 'https://github.com/Huxpro/octane/issues/194',
	phase: 'M2-frozen-prediction',
	frozenAt: new Date().toISOString(),
	actualFieldsPresent: false,
	inputs: {
		dispatchProperty: {
			file: path.relative(repositoryRoot, dispatchPath),
			sha256: dispatch.sha256,
			engine: dispatch.record.engine,
		},
		allocationStringBranch: {
			file: path.relative(repositoryRoot, allocationPath),
			sha256: allocation.sha256,
			engine: allocation.record.engine,
		},
	},
	model,
	q2: {
		emittedProgram: scales.map((rows) => predictEmittedProgram(model, rows)),
		interpretedTemplateLowerBound: scales.map((rows) => predictTemplateLowerBound(model, rows)),
		absoluteTargetScope:
			'Emitted create execution only. Parse/eval and operation-specific native PAPI work are unpriced M1 primitives and therefore intentionally predict zero; misses expose that model boundary.',
	},
	c8: {
		predictedScriptDeltaMs: 0,
		orderingPrediction: 'tie',
		reason:
			'Parent-first and child-first variants have the same emitted primitive multiset. M1 has no layout dirty-state primitive; any observed delta belongs to flush, not script.',
	},
};

fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(outputPath);
