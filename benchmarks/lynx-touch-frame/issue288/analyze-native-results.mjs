import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsRoot = path.resolve(here, '../results');
const files = {
	touch: path.join(resultsRoot, 'issue288-native-context-tap-frame-aries10-sparse-formal.json'),
	cpu: path.join(resultsRoot, 'issue288-native-context-cpu-aries10-sparse-formal.json'),
	memory: path.join(resultsRoot, 'issue288-native-context-memory-aries10-sparse-formal.json'),
	trace: Object.fromEntries(
		['baseline', 'candidate'].map((arm) => [
			arm,
			{
				trace: path.join(
					resultsRoot,
					'issue288-native-traces-final',
					`${arm}-eb054e91c-paired-rows1000.pftrace`,
				),
				markers: path.join(
					resultsRoot,
					'issue288-native-traces-final',
					`${arm}-eb054e91c-paired-rows1000-markers.json`,
				),
				longSlices: path.join(
					resultsRoot,
					'issue288-native-traces-final',
					`${arm}-eb054e91c-paired-rows1000-long-slices.json`,
				),
			},
		]),
	),
};

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function receipt(file) {
	const bytes = fs.readFileSync(file);
	return {
		path: path.relative(path.resolve(here, '../../..'), file).split(path.sep).join('/'),
		bytes: bytes.length,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
	};
}

function round(value, digits = 3) {
	return Number(value.toFixed(digits));
}

function nearestRank(values, probability) {
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)];
}

function stats(values) {
	return {
		n: values.length,
		min: round(Math.min(...values)),
		p50: round(nearestRank(values, 0.5)),
		p95: round(nearestRank(values, 0.95)),
		max: round(Math.max(...values)),
		mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
		raw: values.map((value) => round(value)),
	};
}

function reduction(baseline, candidate) {
	return round((1 - candidate / baseline) * 100);
}

function armStats(rows, select) {
	return Object.fromEntries(
		['baseline', 'candidate'].map((arm) => [
			arm,
			stats(rows.filter((row) => row.arm === arm).map(select)),
		]),
	);
}

function pairedGroups(rows, select) {
	return [...new Set(rows.map((row) => row.pair))].map((pair) => {
		const inPair = rows.filter((row) => row.pair === pair);
		const mean = (arm) => {
			const values = inPair.filter((row) => row.arm === arm).map(select);
			return values.reduce((sum, value) => sum + value, 0) / values.length;
		};
		const baseline = mean('baseline');
		const candidate = mean('candidate');
		return {
			pair,
			baseline: round(baseline),
			candidate: round(candidate),
			candidateOverBaseline: round(candidate / baseline, 6),
			reductionPercent: reduction(baseline, candidate),
		};
	});
}

function comparison(byArm) {
	return {
		p50ReductionPercent: reduction(byArm.baseline.p50, byArm.candidate.p50),
		p95ReductionPercent: reduction(byArm.baseline.p95, byArm.candidate.p95),
		meanReductionPercent: reduction(byArm.baseline.mean, byArm.candidate.mean),
	};
}

function analyzeTouch(input) {
	const latency = armStats(input.samples, (sample) => sample.latencyMs);
	const frames = armStats(input.samples, (sample) => sample.changedFrameOrdinal);
	return {
		source: receipt(files.touch),
		meta: input.meta,
		latencyMs: {
			byArm: latency,
			comparison: comparison(latency),
			pairedGroups: pairedGroups(input.samples, (sample) => sample.latencyMs),
		},
		changedFrameCount: {
			byArm: frames,
			comparison: comparison(frames),
		},
	};
}

function analyzeCpu(input) {
	const lynxJs = armStats(input.windows, (window) => window.byComm.Lynx_JS.cpuMsPerInteraction);
	const process = armStats(
		input.windows,
		(window) => window.tasks.reduce((sum, task) => sum + task.cpuMs, 0) / window.iterations,
	);
	const main = armStats(
		input.windows,
		(window) => window.byComm['m.lynx.explorer'].cpuMsPerInteraction,
	);
	const render = armStats(
		input.windows,
		(window) => window.byComm.RenderThread.cpuMsPerInteraction,
	);
	return {
		source: receipt(files.cpu),
		meta: input.meta,
		lynxJsCpuMsPerInteraction: {
			byArm: lynxJs,
			comparison: comparison(lynxJs),
			pairedGroups: pairedGroups(
				input.windows,
				(window) => window.byComm.Lynx_JS.cpuMsPerInteraction,
			),
		},
		processCpuMsPerInteraction: { byArm: process, comparison: comparison(process) },
		mainThreadCpuMsPerInteraction: { byArm: main, comparison: comparison(main) },
		renderThreadCpuMsPerInteraction: { byArm: render, comparison: comparison(render) },
	};
}

function memoryMetric(input, phase, select) {
	const byArm = armStats(input.windows, (window) => select(window[phase]));
	return {
		byArm,
		comparison: comparison(byArm),
		pairedGroups: pairedGroups(input.windows, (window) => select(window[phase])),
	};
}

function analyzeMemory(input) {
	const metrics = {
		pssKb: (sample) => sample.smapsRollupKb.Pss,
		rssKb: (sample) => sample.smapsRollupKb.Rss,
		privateKb: (sample) => sample.smapsRollupKb.Private_Clean + sample.smapsRollupKb.Private_Dirty,
		nativeHeapAllocKb: (sample) => sample.dumpsysKb.nativeHeapAlloc,
		dalvikHeapAllocKb: (sample) => sample.dumpsysKb.dalvikHeapAlloc,
	};
	return {
		source: receipt(files.memory),
		meta: input.meta,
		settled: Object.fromEntries(
			Object.entries(metrics).map(([name, select]) => [
				name,
				memoryMetric(input, 'settled', select),
			]),
		),
		postInteraction: Object.fromEntries(
			Object.entries(metrics).map(([name, select]) => [
				name,
				memoryMetric(input, 'postInteraction', select),
			]),
		),
	};
}

function analyzeTraceArm(arm) {
	const markerFile = files.trace[arm].markers;
	const longSliceFile = files.trace[arm].longSlices;
	const markerResult = readJson(markerFile);
	const longSliceResult = readJson(longSliceFile);
	if (!markerResult.success || !markerResult.parseSucceeded || !longSliceResult.success) {
		throw new Error(`Trace query failed for ${arm}.`);
	}
	const marker = (suffix) =>
		markerResult.rows.find((row) => row.name === `Issue288::${arm}::${suffix}`);
	const input = marker('mts-input');
	const handler = marker('bts-handler');
	const changed = marker('changed-vsync');
	const fire = markerResult.rows.find(
		(row) =>
			row.name === 'TouchEventHandler::FireEvent' &&
			row.ts_ms >= input.ts_ms &&
			row.ts_ms <= handler.ts_ms,
	);
	const longest = (name) =>
		longSliceResult.rows
			.filter((row) => row.name === name)
			.toSorted((left, right) => right.dur_ms - left.dur_ms)[0];
	return {
		trace: receipt(files.trace[arm].trace),
		queries: {
			markers: receipt(markerFile),
			longSlices: receipt(longSliceFile),
		},
		markers: { input, fire, handler, changed },
		segmentsMs: {
			inputToHandler: round(handler.ts_ms - input.ts_ms),
			handlerToChangedFrame: round(changed.ts_ms - handler.ts_ms),
			inputToChangedFrame: round(changed.ts_ms - input.ts_ms),
		},
		ownerSlices: {
			messageLoopFlush: longest('MessageLoop::FlushTasks'),
			asyncJsTask: longest('JsTaskAdapter::SetTimeout'),
			mainEventDispatch: longest('EventTarget::DispatchEvent'),
			lepusEventClosure: longest('LepusClosureEventListener::Invoke'),
			fiberFlush: longest('FiberFlushElementTree'),
		},
	};
}

function main() {
	const [outputFile] = process.argv.slice(2);
	if (outputFile === undefined) {
		process.stderr.write('usage: node analyze-native-results.mjs <output.json>\n');
		process.exitCode = 1;
		return;
	}
	if (fs.existsSync(outputFile)) throw new Error(`Refusing to overwrite ${outputFile}.`);
	const trace = {
		baseline: analyzeTraceArm('baseline'),
		candidate: analyzeTraceArm('candidate'),
	};
	trace.comparison = {
		inputToHandlerDeltaMs: round(
			trace.candidate.segmentsMs.inputToHandler - trace.baseline.segmentsMs.inputToHandler,
		),
		handlerToChangedFrameReductionPercent: reduction(
			trace.baseline.segmentsMs.handlerToChangedFrame,
			trace.candidate.segmentsMs.handlerToChangedFrame,
		),
		inputToChangedFrameReductionPercent: reduction(
			trace.baseline.segmentsMs.inputToChangedFrame,
			trace.candidate.segmentsMs.inputToChangedFrame,
		),
		asyncJsTaskReductionPercent: reduction(
			trace.baseline.ownerSlices.asyncJsTask.dur_ms,
			trace.candidate.ownerSlices.asyncJsTask.dur_ms,
		),
	};
	const output = {
		protocol: 'octane-issue288-native-context-analysis-v1',
		generatedAt: new Date().toISOString(),
		quantiles: 'nearest-rank over accepted samples; no retries or DNF removed',
		touch: analyzeTouch(readJson(files.touch)),
		cpu: analyzeCpu(readJson(files.cpu)),
		memory: analyzeMemory(readJson(files.memory)),
		trace,
	};
	fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
}

main();
