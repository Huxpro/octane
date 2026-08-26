import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const flingInputs = process.argv.slice(2);
if (flingInputs.length === 0) throw new Error('usage: node analyze.mjs <fling-run.json>...');

const directory = path.dirname(fileURLToPath(import.meta.url));
const resultsDirectory = path.join(directory, 'results');
fs.rmSync(resultsDirectory, { recursive: true, force: true });
fs.mkdirSync(resultsDirectory, { recursive: true });

const stable = (value) => JSON.stringify(value);
const hash = (value) => createHash('sha256').update(stable(value)).digest('hex');
const median = (values) => {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

function derive(record) {
	const { window } = record;
	const single = window.callbacks.componentAtIndex;
	const batch = window.callbacks.componentAtIndexes;
	const enqueue = window.callbacks.enqueueComponent;
	const materializedCells = single.items + batch.items;
	const recycledCells = enqueue.count;
	const materializeMs = single.ms + batch.ms;
	const callbackMs = materializeMs + enqueue.ms;
	const frameworkMs = single.frameworkMs + batch.frameworkMs + enqueue.frameworkMs;
	const elementCrossingMs = single.elementMs + batch.elementMs + enqueue.elementMs;
	const flushTriggerMs = single.layoutMs + batch.layoutMs + enqueue.layoutMs;
	const durationMs = window.endedAtMs - window.startedAtMs;
	const calls = Object.fromEntries(
		Object.entries(window.callsAfter)
			.filter(([, value]) => value.count !== 0)
			.map(([name, value]) => [name, value.count]),
	);
	return {
		materializedCells,
		recycledCells,
		durationMs,
		cellsPerSecond: (materializedCells * 1000) / durationMs,
		materializeMsPerCell: materializeMs / materializedCells,
		materializeFrameworkMsPerCell: (single.frameworkMs + batch.frameworkMs) / materializedCells,
		enqueueMsPerRecycle: recycledCells === 0 ? null : enqueue.ms / recycledCells,
		callbackMs,
		frameworkMs,
		elementCrossingMs,
		flushTriggerMs,
		frameworkShareOfCallback: frameworkMs / callbackMs,
		frameworkShareOfBurst: frameworkMs / durationMs,
		calls,
		callsBeforeHash: hash(window.callsBefore),
	};
}

const common = {
	schema: 'octane.lynx-list.issue195-window.v1',
	issue: 'https://github.com/Huxpro/octane/issues/195',
	protocol: 'https://github.com/Huxpro/octane/issues/194#protocol-all-four',
	probeBranch: 'perf/lynx-list-boundary-probe-195',
	baselineCommit: '7cfe364ec0159ba099f99e17f799cdfe90b547b4',
	bundle: {
		file: 'main.lynx.bundle',
		sha256: 'e36b1c8eddde3dd200e8234ddb221f1bf84a56c21ebbd80ca2cde5b6a394185a',
		sizeBytes: 504772,
	},
	device: {
		manufacturer: 'ByteDance',
		model: 'aries_10',
		android: '10',
		pixelWidth: 1280,
		pixelHeight: 2856,
		pixelRatio: 3.09375,
	},
	host: { package: 'com.lynx.explorer', version: '1.0' },
	engine: {
		name: 'LepusNG',
		runtimeType: 'quickjs',
		engineVersion: '4.0',
		lynxSdkVersion: '4.0',
	},
	fixture: {
		rows: 10000,
		rowHeightPx: 92,
		rowShape: 'one keyed list-item; one root view; two nested views; four text elements',
		itemKey: 'probe-row-${index}',
		reuseIdentifier: 'octane-issue-195-row',
	},
	measurementBoundary: {
		timer: 'Date.now',
		timerResolutionMs: 1,
		frameworkMs:
			'callback wall minus timed non-flush and __FlushElementTree PAPI wall, clamped at zero',
		elementCrossingMs:
			'non-flush public Element PAPI wall; JS-to-native crossing and native element operation are not separately observable',
		flushTriggerMs:
			'__FlushElementTree public PAPI wall; this is the synchronous flush-trigger boundary, not all later native layout work',
	},
	protocolChecks: {
		devToolDisabledBeforeMeasuredWindows: true,
		devToolVerification: 'same-connection getGlobalSwitch(enable_devtool) returned false',
		warmPage: true,
		abBaSchedule: ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'],
		idleBoundaryMs: 350,
		callsBeforeResetAtEveryIdleBoundary: true,
		noTotalsCarriedAcrossWindows: true,
	},
};

const runs = flingInputs.map((file, index) => ({
	block: index + 1,
	mode: 'fling',
	file,
	gestureDurationMs: 100,
	settleMs: 6000,
}));
const all = [];

for (const run of runs) {
	const source = JSON.parse(fs.readFileSync(run.file, 'utf8'));
	for (const sourceRecord of source.records) {
		const derived = derive(sourceRecord);
		const sameWorkClass =
			run.mode === 'fling' &&
			derived.materializedCells === 56 &&
			derived.recycledCells === 56 &&
			stable(derived.calls) ===
				stable({ __GetElementUniqueID: 112, __SetAttribute: 224, __FlushElementTree: 56 });
		const record = {
			...common,
			block: run.block,
			mode: run.mode,
			loadControl: {
				gesture: sourceRecord.direction,
				fromY: sourceRecord.direction === 'A' ? 2300 : 400,
				toY: sourceRecord.direction === 'A' ? 400 : 2300,
				x: 640,
				gestureDurationMs: run.gestureDurationMs,
				settleMs: run.settleMs,
			},
			replication: sourceRecord.replication,
			orderWithinPair: sourceRecord.orderWithinPair,
			direction: sourceRecord.direction,
			thermalBefore: sourceRecord.host.thermalBefore,
			reportableForFlingMedian: sameWorkClass,
			exclusionReason: sameWorkClass
				? null
				: 'full callback/PAPI call multiset differs from the 56-materialize/56-recycle same-work class',
			derived,
			rawWindow: sourceRecord.window,
		};
		const name = `2026-08-26-aries10-fling-b${String(run.block).padStart(2, '0')}-r${String(sourceRecord.replication).padStart(2, '0')}-${sourceRecord.direction.toLowerCase()}.json`;
		fs.writeFileSync(path.join(resultsDirectory, name), `${JSON.stringify(record, null, 2)}\n`);
		all.push(record);
	}
}

const spendable = all.filter((record) => record.reportableForFlingMedian);
const metrics = [
	'cellsPerSecond',
	'materializeMsPerCell',
	'materializeFrameworkMsPerCell',
	'enqueueMsPerRecycle',
	'callbackMs',
	'frameworkMs',
	'elementCrossingMs',
	'flushTriggerMs',
	'frameworkShareOfCallback',
	'frameworkShareOfBurst',
];
const summary = {
	schema: 'octane.lynx-list.issue195-summary.v1',
	...common,
	decisionClass: {
		description:
			'exactly 56 materializations + 56 recycles and the identical 112/224/56 public PAPI call multiset',
		n: spendable.length,
		windowFiles: spendable.map(
			(record) =>
				`2026-08-26-aries10-fling-b${String(record.block).padStart(2, '0')}-r${String(record.replication).padStart(2, '0')}-${record.direction.toLowerCase()}.json`,
		),
		callsBeforeHashes: [...new Set(spendable.map((record) => record.derived.callsBeforeHash))],
		metrics: Object.fromEntries(
			metrics.map((metric) => {
				const fullSamples = spendable.map((record) => record.derived[metric]);
				return [metric, { median: median(fullSamples), fullSamples }];
			}),
		),
	},
	sensitivity: {
		blocks: runs.length,
		allFlingWindowsN: all.length,
		excludedFlingWindowsN: all.filter((record) => !record.reportableForFlingMedian).length,
		directionComparison: 'not spendable: A/B ranges overlap and n<15',
	},
};
fs.writeFileSync(
	path.join(resultsDirectory, '2026-08-26-aries10-summary.json'),
	`${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify({ records: all.length, spendable: spendable.length, resultsDirectory }));
