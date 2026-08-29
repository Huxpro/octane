import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stageDirectory = path.dirname(fileURLToPath(import.meta.url));
const resultsDirectory = path.resolve(stageDirectory, '../results');

const inputNames = {
	dispatch: 'lepus-cost-m1-dispatch-property-aries10-2026-08-26.json',
	allocation: 'lepus-cost-m1-allocation-string-branch-aries10-2026-08-26.json',
	v8: 'lepus-cost-m1-v8-context-2026-08-26.json',
	prediction: 'lepus-cost-m2-prediction-2026-08-26.json',
	actual: 'lepus-cost-m2-actual-q2-aries10-2026-08-26.json',
	invalidObserver: 'lepus-cost-m2-invalid-observer-timeout-10000-aries10-2026-08-26.json',
	invalidCrossing: 'lepus-cost-m2-invalid-crossing-timeout-30000-aries10-2026-08-26.json',
};

const outputNames = {
	json: 'lepus-cost-model-aries10-lepus2.3.0-2026-08-26.json',
	markdown: 'lepus-cost-model-aries10-lepus2.3.0-2026-08-26.md',
};

function sha256(text) {
	return createHash('sha256').update(text).digest('hex');
}

function byCase(record) {
	return new Map(record.analysis.rows.map((row) => [row.case, row]));
}

function round(value, digits = 2) {
	return value == null ? null : Number(value.toFixed(digits));
}

function markdownNumber(value, digits = 2) {
	return value == null ? '—' : value.toFixed(digits);
}

export function buildCostModel(records, inputHashes = {}) {
	const dispatchRows = byCase(records.dispatch);
	const allocationRows = byCase(records.allocation);
	const v8Rows = new Map(
		records.v8.phases.flatMap((phase) => phase.analysis.rows.map((row) => [row.case, row])),
	);
	const resolutionLimited = new Set([
		'property_method_vs_local_binding',
		'host_papi_vs_lepus_call',
		'closure_read_vs_local',
		'property_load_2_shapes_vs_1',
		'property_load_8_shapes_vs_1',
	]);
	const primitiveRows = [...dispatchRows.values(), ...allocationRows.values()].map((row) => ({
		case: row.case,
		group: row.group,
		lepusDeltaNsPerOp: row.fit.nsPerOp,
		v8ContextDeltaNsPerOp: v8Rows.get(row.case)?.fit.nsPerOp ?? null,
		fitRmseMs: row.fit.rmseMs,
		fitMaxAbsResidualMs: row.fit.maxAbsResidualMs,
		status: resolutionLimited.has(row.case) ? 'resolution-limited' : 'measured',
	}));

	const actual1000 = records.actual.analysis.scales.find((scale) => scale.rows === 1000);
	const predictionByRows = new Map(
		records.prediction.q2.emittedProgram.map((entry) => [entry.rows, entry]),
	);
	const templatePredictionByRows = new Map(
		records.prediction.q2.interpretedTemplateLowerBound.map((entry) => [entry.rows, entry]),
	);
	const actualProgramMs = actual1000.arms.program.medianMs;
	const predictedProgramMs = predictionByRows.get(1000).predictedMs;
	const relativeAbsoluteError = Math.abs(predictedProgramMs - actualProgramMs) / actualProgramMs;
	const q2Scales = [1000, 10000, 30000].map((rows) => ({
		rows,
		predictedProgramMs: predictionByRows.get(rows).predictedMs,
		predictedTemplateLowerBoundMs: templatePredictionByRows.get(rows).predictedLowerBoundMs,
		actualProgramMedianMs: rows === 1000 ? actualProgramMs : null,
		actualTemplateMedianMs: rows === 1000 ? actual1000.arms.template.medianMs : null,
		programRelativeAbsoluteError: rows === 1000 ? relativeAbsoluteError : null,
		predictedOrdering: 'program-faster',
		actualOrdering: rows === 1000 ? actual1000.ordering : null,
		status: rows === 1000 ? 'measured' : 'invalid-timeout',
	}));

	const m2Pass =
		relativeAbsoluteError <= 0.25 && q2Scales.every((scale) => scale.status === 'measured');
	const m3 = [
		{
			guide: 'absolute emitted-program model',
			evidenceStatus: 'refuted',
			finding: `The 1k prediction missed the protocol-valid surrogate median by ${round(relativeAbsoluteError * 100)}%.`,
		},
		{
			guide: 'whole-tree unrolling',
			evidenceStatus: 'refuted',
			finding:
				'The frozen inventory assumed 20 whole-cell crossings per row; the emitted row-shaped program exposed 15.121 surrogate crossings per row and 5,041 program nodes at 1k.',
		},
		{
			guide: 'row-shape function plus tight loop',
			evidenceStatus: 'calculated',
			finding:
				'The current emitted implementation is already row-shaped, but the failed absolute backtest prevents a performance claim.',
		},
		{
			guide: 'slot dispatch',
			evidenceStatus: 'calculated',
			finding:
				'Table lookup beat if/else by 8.90, 133.43, and 599.34 ns/op at 4, 16, and 64 slots; switch crossed from +15.83/+5.63 to -12.63 ns/op. These are M1 deltas, not an end-to-end compiler win.',
		},
		{
			guide: 'string construction and crossing',
			evidenceStatus: 'calculated',
			finding:
				'Template literals cost +94.33 ns/op versus concat, while crossing a string cost +989.46 ns/op; prefer passing through existing strings when semantics permit.',
		},
		{
			guide: 'property hoisting',
			evidenceStatus: 'calculated',
			finding:
				'Generic property load measured +31.03 ns/op, but method-vs-local was only +0.14 ns/op and resolution-limited, so there is no evidence to pay code-size cost for blanket hoisting.',
		},
		{
			guide: 'C8 append ordering',
			evidenceStatus: 'calculated',
			finding:
				'Both variants have the same M1 primitive multiset, predicting 0 ms script delta. Any observed difference is assigned to flush/layout, outside this script model; no C8 device window was completed.',
		},
	];
	if (!m2Pass && m3.some((row) => row.evidenceStatus === 'validated')) {
		throw new Error('M3 cannot contain validated rows while the M2 gate is closed.');
	}

	return {
		schema: 'octane.lepus-cost.model.v1',
		issue: 'https://github.com/Huxpro/octane/issues/196',
		protocol: 'https://github.com/Huxpro/octane/issues/194',
		generatedAt: '2026-08-26',
		device: records.actual.device,
		engine: records.actual.engine,
		inputs: Object.fromEntries(
			Object.entries(inputNames).map(([key, file]) => [
				key,
				{
					file: `benchmarks/lynx-table/stages/results/${file}`,
					sha256: inputHashes[key] ?? null,
				},
			]),
		),
		m1: {
			method:
				'AB/BA paired deltas, n=5 at four iteration counts, linear slope over all paired deltas',
			primitiveRows,
			v8Scope: records.v8.scope,
		},
		m2: {
			predictionFrozenAt: records.prediction.frozenAt,
			predictionWasFrozenBeforeActual: true,
			q2Scales,
			actualBoundary: records.actual.measurementBoundary,
			inventoryAttribution: {
				frozenHostCrossingsPerRow: 20,
				observedSurrogateCrossingsPerRow: 15.121,
				observedProgramNodesAt1000Rows: 5041,
			},
			c8: {
				predictedScriptDeltaMs: records.prediction.c8.predictedScriptDeltaMs,
				actualScriptDeltaMs: null,
				status: 'calculated-only',
			},
			gate: {
				targetRelativeAbsoluteError: 0.25,
				pass: m2Pass,
				reasons: [
					`1k program relative absolute error is ${round(relativeAbsoluteError * 100)}%.`,
					'10k observer-instrumented attempt is invalid and timed out.',
					'30k crossing-surrogate attempt is invalid and timed out.',
					'C8 has no completed device backtest window.',
				],
			},
		},
		m3: {
			gateOpen: m2Pass,
			rows: m3,
		},
	};
}

export function renderReport(model) {
	const m1Rows = model.m1.primitiveRows
		.map(
			(row) =>
				`| \`${row.case}\` | ${row.group} | ${markdownNumber(row.lepusDeltaNsPerOp)} | ${markdownNumber(row.v8ContextDeltaNsPerOp)} | ${markdownNumber(row.fitRmseMs)} | ${row.status} |`,
		)
		.join('\n');
	const q2Rows = model.m2.q2Scales
		.map(
			(scale) =>
				`| ${scale.rows.toLocaleString('en-US')} | ${markdownNumber(scale.predictedProgramMs, 3)} | ${markdownNumber(scale.actualProgramMedianMs, 0)} | ${scale.programRelativeAbsoluteError == null ? '—' : `${(scale.programRelativeAbsoluteError * 100).toFixed(2)}%`} | ${markdownNumber(scale.predictedTemplateLowerBoundMs, 3)} | ${markdownNumber(scale.actualTemplateMedianMs, 0)} | ${scale.actualOrdering ?? '—'} | ${scale.status} |`,
		)
		.join('\n');
	const m3Rows = model.m3.rows
		.map((row) => `| ${row.guide} | ${row.evidenceStatus} | ${row.finding} |`)
		.join('\n');

	return `# LepusNG cost model — Aries 10 / LepusNG 2.3.0

Issue: [#196](https://github.com/Huxpro/octane/issues/196). Protocol: [#194](https://github.com/Huxpro/octane/issues/194).

## Result

M1 produced a device primitive table, but M2 closed the validation gate. The frozen Q2 1k emitted-program prediction was ${model.m2.q2Scales[0].predictedProgramMs.toFixed(3)} ms; the protocol-valid device median was ${model.m2.q2Scales[0].actualProgramMedianMs} ms (${(model.m2.q2Scales[0].programRelativeAbsoluteError * 100).toFixed(2)}% relative absolute error, target ≤25%). Ordering was correct: program was faster than the interpreted template (${model.m2.q2Scales[0].actualTemplateMedianMs} ms).

The 10k observer-instrumented attempt and 30k crossing-surrogate attempt timed out and are checked in as invalid records. C8 remains calculated-only. Consequently the M2 gate is **closed** and no M3 row is marked validated.

## Setup and protocol

- Device: ${model.device.model}, Android ${model.device.android}, ${model.device.abi}.
- Engine stamp: ${model.engine.name} ${model.engine.lepusVersion}; app-bundle engine ${model.engine.appBundleEngineVersion}; Lynx SDK ${model.engine.lynxSdkVersion}.
- DevTool disabled, n=5, AB/BA order, pre/post load + thermal + battery captured, medians and full samples stored per window.
- Device windows are separate records; no totals are formed across windows. Invalid and overlapping attempts are not spendable.
- V8 ${model.m1.v8Scope.decisionUse}: ${model.m1.v8Scope.reason}

## M1 primitive deltas

Positive values mean candidate minus control. V8 is context only and is not substituted for device values.

| Case | Group | LepusNG ns/op | V8 context ns/op | fit RMSE ms | Status |
| --- | --- | ---: | ---: | ---: | --- |
${m1Rows}

## M2 frozen prediction and backtest

| Rows | Predicted program ms | Actual program median ms | Program error | Predicted template floor ms | Actual template median ms | Actual order | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${q2Rows}

The valid 1k program boundary executes the real emitted program against an M1-matched crossing surrogate: numeric factory/append calls use \`getUniqueId\`, string calls use \`setAttribute\` on one detached sentinel, and no per-call clock is read. The template boundary ends after outer \`renderPlanNode\` and before paint. Both arms log then throw a sentinel, excluding paint/flush.

Parse/eval remains unobservable with DevTool disabled because native evaluates bytecode before an in-bundle clock can start; launch wall mixes native load/layout and is not reported as script self time. The frozen inventory also attributed 20 whole-cell host crossings per row, while the emitted row-shaped program exposed 15.121 surrogate crossings per row and 5,041 program nodes at 1k. The 94.83% miss therefore refutes the absolute model rather than being patched after observation.

C8 has equal M1 primitive multisets and a frozen predicted script delta of 0 ms. With no completed device window, this is structural consistency only; flush/layout effects remain outside the model.

## M3 compiler guide

| Guide | Evidence | Finding |
| --- | --- | --- |
${m3Rows}

## Records

${Object.values(model.inputs)
	.map((input) => `- \`${input.file}\` (SHA-256 \`${input.sha256}\`)`)
	.join('\n')}
`;
}

async function main() {
	const entries = await Promise.all(
		Object.entries(inputNames).map(async ([key, name]) => {
			const text = await readFile(path.join(resultsDirectory, name), 'utf8');
			return [key, JSON.parse(text), sha256(text)];
		}),
	);
	const records = Object.fromEntries(entries.map(([key, record]) => [key, record]));
	const hashes = Object.fromEntries(entries.map(([key, , hash]) => [key, hash]));
	const model = buildCostModel(records, hashes);
	await writeFile(
		path.join(resultsDirectory, outputNames.json),
		`${JSON.stringify(model, null, 2)}\n`,
	);
	await writeFile(path.join(resultsDirectory, outputNames.markdown), renderReport(model));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
