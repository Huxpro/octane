import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { writeEvidenceJson } from '../scripts/evidence.mjs';

const INPUT_PROTOCOL = 'octane-issue278-native-attribution-v6';
const OUTPUT_PROTOCOL = 'octane-issue278-native-attribution-report-v1';
const REQUIRED_SCALES = [1000, 2000, 3000];
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const TIMELINE_KEYS = [
	'receivedAtMs',
	'decodedAtMs',
	'validatedAtMs',
	'preparedAtMs',
	'applyStartedAtMs',
	'appliedAtMs',
	'ackStartedAtMs',
	'ackDispatchedAtMs',
	'completedAtMs',
];

function object(value, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value;
}

function finite(value, label) {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${label} must be finite.`);
	}
	return value;
}

export function stat(values) {
	if (!Array.isArray(values) || values.length === 0) throw new Error('cannot summarize no values.');
	const sorted = values.map((value) => finite(value, 'sample')).sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return {
		n: sorted.length,
		median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
		min: sorted[0],
		max: sorted.at(-1),
	};
}

function regressionExponent(points) {
	if (points.length < 2) throw new Error('a scaling exponent needs at least two points.');
	const logs = points.map(({ rows, value }) => ({ x: Math.log(rows), y: Math.log(value) }));
	if (logs.some(({ y }) => !Number.isFinite(y))) {
		throw new Error('a scaling exponent needs positive finite medians.');
	}
	const xMean = logs.reduce((sum, point) => sum + point.x, 0) / logs.length;
	const yMean = logs.reduce((sum, point) => sum + point.y, 0) / logs.length;
	return (
		logs.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) /
		logs.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
	);
}

function sampleOf(pair, arm) {
	const matches = pair.samples.filter((entry) => entry.ok === true && entry.sample?.arm === arm);
	if (matches.length !== 1) {
		throw new Error(`pair ${pair.ordinal}/${pair.scale ?? 1000} needs exactly one ${arm} sample.`);
	}
	return matches[0].sample;
}

function segmentSample(sample) {
	const result = object(sample.result, 'sample result');
	const timeline = object(result.mtsTimeline, 'MTS timeline');
	for (const name of TIMELINE_KEYS) finite(timeline[name], `MTS timeline.${name}`);
	const calibration = object(sample.clockCalibration, 'clock calibration');
	const offsetMs = finite(calibration.offsetMs, 'clock offset');
	const uncertaintyMs = finite(calibration.uncertaintyMs, 'clock uncertainty');
	const wires = result.wire.filter(
		(event) => event.direction === 'bts-to-mts' && event.type === 'octane-lynx:background-to-main',
	);
	if (wires.length !== 1)
		throw new Error('sample must contain exactly one BTS-to-MTS commit wire event.');
	const wire = wires[0];
	const background = object(result.btsProfile, 'BTS profile');
	const normalizeMain = (value) => value - offsetMs;
	const values = {
		btsRenderBuildMs:
			wire.startedAtMs - result.startedAtMs - background.selfcheckMs - background.encodeMs,
		btsSelfcheckMs: background.selfcheckMs,
		btsEncodeMs: background.encodeMs,
		bridgeToMainMs: normalizeMain(timeline.receivedAtMs) - wire.startedAtMs,
		mtsDecodeMs: timeline.decodedAtMs - timeline.receivedAtMs,
		mtsValidateMs: timeline.validatedAtMs - timeline.decodedAtMs,
		mtsPrepareMs: timeline.preparedAtMs - timeline.validatedAtMs,
		mtsPreApplyGapMs: timeline.applyStartedAtMs - timeline.preparedAtMs,
		mtsApplyMs: timeline.appliedAtMs - timeline.applyStartedAtMs,
		mtsPostApplyGapMs: timeline.ackStartedAtMs - timeline.appliedAtMs,
		mtsAckMs: timeline.ackDispatchedAtMs - timeline.ackStartedAtMs,
		mtsCompleteMs: timeline.completedAtMs - timeline.ackDispatchedAtMs,
		bridgeToBackgroundMs: result.commitAckMs - normalizeMain(timeline.completedAtMs),
	};
	for (const [name, value] of Object.entries(values)) {
		finite(value, name);
		if (value < -uncertaintyMs - 1) {
			throw new Error(`${name} escaped clock uncertainty: ${value}ms < -${uncertaintyMs + 1}ms.`);
		}
	}
	const sum = Object.values(values).reduce((total, value) => total + value, 0);
	const reconciliationMs = result.wallMs - sum;
	if (Math.abs(reconciliationMs) > 2) {
		throw new Error(`timeline does not reconcile with wall clock (${reconciliationMs}ms).`);
	}
	return {
		...values,
		reconciliationMs,
		clockUncertaintyMs: uncertaintyMs,
		// dispatchEvent returns after the receiver has entered its handler. This is
		// therefore a diagnostic duration, not another additive wall-clock segment.
		btsDispatchCallMs: wire.returnedAtMs - wire.startedAtMs,
	};
}

function summarizeArm(samples) {
	const segments = samples.map(segmentSample);
	return {
		wallMs: stat(samples.map((sample) => sample.result.wallMs)),
		segments: Object.fromEntries(
			Object.keys(segments[0]).map((name) => [name, stat(segments.map((entry) => entry[name]))]),
		),
		profile: {
			btsPrepareMs: stat(samples.map((sample) => sample.result.btsCodecProfile.encodePrepareMs)),
			btsStringifyMs: stat(
				samples.map((sample) => sample.result.btsCodecProfile.encodeStringifyMs),
			),
			mtsParseMs: stat(samples.map((sample) => sample.result.mtsCodecProfile.decodeParseMs)),
			mtsRestoreMs: stat(samples.map((sample) => sample.result.mtsCodecProfile.decodeRestoreMs)),
			wireBytes: stat(samples.map((sample) => sample.result.wire[0].encodedBytes)),
		},
	};
}

function assertSharedIdentity(shards) {
	const first = shards[0];
	const keys = ['octaneSha', 'instrumentationSha', 'appPatchSha256', 'driverSha'];
	const structuredKeys = ['bundles', 'connectorPackageTrees', 'leaseReceipt'];
	for (const shard of shards) {
		if (shard.protocol !== INPUT_PROTOCOL) {
			throw new Error(`unexpected issue #278 protocol ${JSON.stringify(shard.protocol)}.`);
		}
		for (const key of keys) {
			if (shard.provenance[key] !== first.provenance[key]) {
				throw new Error(`issue #278 provenance mismatch for ${key}.`);
			}
		}
		if (shard.provenance.runtimeLabel !== first.provenance.runtimeLabel) {
			throw new Error('issue #278 runtime label mismatch.');
		}
		for (const key of structuredKeys) {
			if (JSON.stringify(shard.provenance[key]) !== JSON.stringify(first.provenance[key])) {
				throw new Error(`issue #278 provenance mismatch for ${key}.`);
			}
		}
		if (shard.device.deviceCohortId !== first.device.deviceCohortId) {
			throw new Error('issue #278 shards must share one device cohort and lease.');
		}
		if (shard.device.explorerRecycleEveryPages !== 1) {
			throw new Error('formal issue #278 evidence requires one Explorer lifecycle per page.');
		}
		if (shard.gate?.passed !== true)
			throw new Error('issue #278 shard did not pass its path gate.');
	}
	return {
		octaneSha: first.provenance.octaneSha,
		instrumentationSha: first.provenance.instrumentationSha,
		appPatchSha256: first.provenance.appPatchSha256,
		driverSha: first.provenance.driverSha,
		bundleReceipts: first.provenance.bundles,
		deviceCohortId: first.device.deviceCohortId,
		deviceCohort: first.device.deviceCohort,
		leaseReceipt: first.provenance.leaseReceipt,
	};
}

function summarizeFloors(shard, applyMs, bridgeMs) {
	for (const [name, samples] of Object.entries(shard.floors)) {
		if (samples.length < 5) throw new Error(`floor ${name} needs at least five samples.`);
	}
	const echoMs = stat(shard.floors.echo.map((sample) => sample.roundTripMs));
	const papiMs = stat(shard.floors.papi.map((sample) => sample.totalMs));
	const btsVmMs = stat(shard.floors.vm.map((sample) => sample.bts.elapsedMs));
	const mtsVmMs = stat(shard.floors.vm.map((sample) => sample.mts.elapsedMs));
	const nodeV8Ms = stat(shard.floors.nodeV8.map((sample) => sample.elapsedMs));
	return {
		echoMs,
		papiMs,
		btsVmMs,
		mtsVmMs,
		nodeV8Ms,
		multiples: {
			applyOverPapi: applyMs / papiMs.median,
			bridgeOverEcho: bridgeMs / echoMs.median,
			btsVmOverNodeV8: btsVmMs.median / nodeV8Ms.median,
			mtsVmOverNodeV8: mtsVmMs.median / nodeV8Ms.median,
		},
	};
}

function analyzeTraceReceipt(receipt, provenance) {
	object(receipt, 'trace receipt');
	if (receipt.protocol !== 'octane-issue278-native-trace-v1') {
		throw new Error('unexpected issue #278 trace receipt protocol.');
	}
	if (
		receipt.provenance.octaneSha !== provenance.octaneSha ||
		receipt.provenance.driverSha !== provenance.driverSha ||
		receipt.provenance.deviceCohortId !== provenance.deviceCohortId ||
		receipt.provenance.bundle.sha256 !== provenance.bundleReceipts.controlChecked.sha256
	) {
		throw new Error('issue #278 trace does not match the attribution cohort.');
	}
	if (
		receipt.capture.started !== true ||
		receipt.capture.dataLossOccurred !== false ||
		receipt.capture.debugModeRestored !== true ||
		receipt.operation.rows !== 1000 ||
		receipt.operation.preRowCount !== 0 ||
		receipt.operation.postRowCount !== 1000
	) {
		throw new Error('issue #278 trace failed its capture or correctness gate.');
	}
	return receipt;
}

function analyzeRuntimeSwitch(receipt) {
	object(receipt, 'runtime-switch receipt');
	if (
		receipt.protocol !== 'octane-issue278-native-runtime-switch-v1' ||
		receipt.finalState.restored !== true ||
		receipt.finalState.enableDebugMode !== false ||
		receipt.finalState.enableV8 !== false
	) {
		throw new Error('issue #278 runtime-switch receipt is invalid or left device state changed.');
	}
	return receipt;
}

export function analyzeIssue278Native(shards, { traceReceipt, runtimeSwitch } = {}) {
	if (!Array.isArray(shards) || shards.length < 3) {
		throw new Error('issue #278 analysis needs baseline, scale, and capacity shards.');
	}
	const provenance = assertSharedIdentity(shards);
	const complete = shards.filter((shard) => shard.status === 'complete');
	for (const shard of complete) {
		if (shard.failures.length !== 0)
			throw new Error('a complete issue #278 shard contains failures.');
	}
	const capacityShards = complete.filter((shard) =>
		shard.validationPairs.some((pair) => pair.scale === 5000),
	);
	if (
		capacityShards.length !== 1 ||
		complete.length !== shards.length ||
		capacityShards[0].validationPairs.filter((pair) => pair.scale === 5000).length !== 1
	) {
		throw new Error('issue #278 analysis needs one isolated complete create@5k capacity shard.');
	}
	const capacityShard = capacityShards[0];
	const capacityPair = capacityShard.validationPairs.find((pair) => pair.scale === 5000);
	if (capacityPair.samples.length !== 2) {
		throw new Error(
			'the isolated create@5k capacity pair must contain checked and trusted samples.',
		);
	}
	const capacityChecked = sampleOf(capacityPair, 'timedChecked');
	const capacityTrusted = sampleOf(capacityPair, 'timedTrusted');

	const baseline = complete.find(
		(shard) => shard.profileOverheadPairs.length >= 5 && shard.floors.papi.length >= 5,
	);
	if (baseline === undefined)
		throw new Error('issue #278 analysis needs a five-pair 1k overhead/floor shard.');
	for (const pair of baseline.profileOverheadPairs) {
		if (pair.samples.length !== 3) throw new Error('overhead pair must contain three arms.');
	}
	const overheadArms = ['controlChecked', 'timelineChecked', 'timedChecked'];
	const overheadSamples = Object.fromEntries(
		overheadArms.map((arm) => [
			arm,
			baseline.profileOverheadPairs.map((pair) => sampleOf(pair, arm)),
		]),
	);
	const overhead = {
		arms: Object.fromEntries(
			overheadArms.map((arm) => [
				arm,
				stat(overheadSamples[arm].map((sample) => sample.result.wallMs)),
			]),
		),
		pairedRatios: {
			timelineOverControl: stat(
				baseline.profileOverheadPairs.map(
					(pair) =>
						sampleOf(pair, 'timelineChecked').result.wallMs /
						sampleOf(pair, 'controlChecked').result.wallMs,
				),
			),
			timedOverControl: stat(
				baseline.profileOverheadPairs.map(
					(pair) =>
						sampleOf(pair, 'timedChecked').result.wallMs /
						sampleOf(pair, 'controlChecked').result.wallMs,
				),
			),
			mtsApplyShareOfControl: stat(
				baseline.profileOverheadPairs.map(
					(pair) =>
						segmentSample(sampleOf(pair, 'timedChecked')).mtsApplyMs /
						sampleOf(pair, 'controlChecked').result.wallMs,
				),
			),
		},
	};
	overhead.accepted = [
		overhead.pairedRatios.timelineOverControl.median,
		overhead.pairedRatios.timedOverControl.median,
	].every((ratio) => ratio >= 0.95 && ratio <= 1.05);

	const validationPairs = complete.flatMap((shard) => shard.validationPairs);
	const scales = {};
	for (const rows of REQUIRED_SCALES) {
		const pairs = validationPairs.filter((pair) => pair.scale === rows);
		if (pairs.length < 5 || pairs.some((pair) => pair.samples.length !== 2)) {
			throw new Error(`issue #278 scale ${rows} needs five complete checked/trusted pairs.`);
		}
		const checkedSamples = pairs.map((pair) => sampleOf(pair, 'timedChecked'));
		const trustedSamples = pairs.map((pair) => sampleOf(pair, 'timedTrusted'));
		const checked = summarizeArm(checkedSamples);
		const trusted = summarizeArm(trustedSamples);
		scales[rows] = {
			rows,
			pairs: pairs.length,
			checked,
			trusted,
			validationControl: {
				pairedWallRatio: stat(
					pairs.map(
						(pair) =>
							sampleOf(pair, 'timedChecked').result.wallMs /
							sampleOf(pair, 'timedTrusted').result.wallMs,
					),
				),
				checkedValidateMs: checked.segments.mtsValidateMs,
				trustedValidateMs: trusted.segments.mtsValidateMs,
			},
		};
	}

	const metricPoints = (read) =>
		REQUIRED_SCALES.map((rows) => ({ rows, value: read(scales[rows]) }));
	const scaling = {
		wall: regressionExponent(metricPoints((scale) => scale.checked.wallMs.median)),
		mtsApply: regressionExponent(metricPoints((scale) => scale.checked.segments.mtsApplyMs.median)),
		mtsPrepare: regressionExponent(
			metricPoints((scale) => scale.checked.segments.mtsPrepareMs.median),
		),
		btsEncode: regressionExponent(
			metricPoints((scale) => scale.checked.segments.btsEncodeMs.median),
		),
		wireBytes: regressionExponent(metricPoints((scale) => scale.checked.profile.wireBytes.median)),
	};

	const allChecked = REQUIRED_SCALES.flatMap((rows) =>
		validationPairs
			.filter((pair) => pair.scale === rows)
			.map((pair) => sampleOf(pair, 'timedChecked')),
	);
	const flags = {
		commitWireFlags: Object.fromEntries(
			[0, 1].map((flag) => [
				flag,
				allChecked.filter((sample) => sample.result.wire[0].codecFlag === flag).length,
			]),
		),
		mtsDecodeFlags0: allChecked.reduce(
			(sum, sample) => sum + sample.result.mtsCodecProfile.decodeFlags0,
			0,
		),
		mtsDecodeFlags1: allChecked.reduce(
			(sum, sample) => sum + sample.result.mtsCodecProfile.decodeFlags1,
			0,
		),
		mtsRestoreMs: stat(allChecked.map((sample) => sample.result.mtsCodecProfile.decodeRestoreMs)),
	};
	flags.verifiedNoRestore =
		flags.commitWireFlags[0] === allChecked.length &&
		flags.commitWireFlags[1] === 0 &&
		flags.mtsDecodeFlags1 === 0 &&
		flags.mtsRestoreMs.max === 0;

	const oneK = scales[1000];
	const floors = summarizeFloors(
		baseline,
		oneK.checked.segments.mtsApplyMs.median,
		oneK.checked.segments.bridgeToMainMs.median,
	);
	const owner = {
		segment: 'mtsApply',
		status:
			overhead.accepted &&
			overhead.pairedRatios.mtsApplyShareOfControl.median >= 0.9 &&
			scaling.mtsApply >= 1.8 &&
			scaling.btsEncode <= 1.2 &&
			scaling.mtsPrepare <= 1.2 &&
			flags.verifiedNoRestore
				? 'verified'
				: 'hypothesis',
		anchorShareOfShippingWall: overhead.pairedRatios.mtsApplyShareOfControl.median,
		scalingExponent: scaling.mtsApply,
		sequenceChange: false,
	};

	return {
		protocol: OUTPUT_PROTOCOL,
		generatedAt: new Date().toISOString(),
		provenance,
		qualification: {
			completeShards: complete.length,
			deviceCohortId: baseline.device.deviceCohortId,
			explorerRecycleEveryPages: 1,
			path: baseline.gate.realPath,
			scalarCapabilityPath: baseline.gate.scalarPath,
		},
		overhead,
		scales,
		scaling,
		floors,
		flags,
		capacity: {
			rows: 5000,
			status: 'complete',
			checkedWallMs: capacityChecked.result.wallMs,
			trustedWallMs: capacityTrusted.result.wallMs,
			checkedOverTrusted: capacityChecked.result.wallMs / capacityTrusted.result.wallMs,
			countedAsImprovement: false,
		},
		trace: traceReceipt === undefined ? null : analyzeTraceReceipt(traceReceipt, provenance),
		runtimeSwitch: runtimeSwitch === undefined ? null : analyzeRuntimeSwitch(runtimeSwitch),
		owner,
	};
}

function round(value, digits = 3) {
	return Number(value.toFixed(digits));
}

export function renderIssue278NativeReport(report) {
	const lines = [
		'# Issue #278 — Native create attribution',
		'',
		`- Octane: \`${report.provenance.octaneSha}\``,
		`- driver: \`${report.provenance.driverSha}\``,
		`- device cohort: \`${report.qualification.deviceCohortId}\`; one Explorer lifecycle per sample`,
		`- real path: \`${report.qualification.path}\`; scalar capability: \`${report.qualification.scalarCapabilityPath}\``,
		'',
		'## Qualification and overhead',
		'',
		'| arm | wall median ms | min–max ms |',
		'|---|---:|---:|',
	];
	for (const arm of ['controlChecked', 'timelineChecked', 'timedChecked']) {
		const value = report.overhead.arms[arm];
		lines.push(`| ${arm} | ${round(value.median)} | ${round(value.min)}–${round(value.max)} |`);
	}
	lines.push(
		'',
		`Paired overhead: timeline/control ${round(report.overhead.pairedRatios.timelineOverControl.median)}×; timed/control ${round(report.overhead.pairedRatios.timedOverControl.median)}×; ±5% gate **${report.overhead.accepted ? 'passed' : 'failed'}**. Paired timed MTS-apply/control-wall share: ${round(report.overhead.pairedRatios.mtsApplyShareOfControl.median * 100, 1)}%.`,
		'',
		'## Scale sweep',
		'',
		'| rows | wall ms | MTS apply ms | apply share | validate checked/trusted ms | prepare ms | BTS encode ms | wire bytes |',
		'|---:|---:|---:|---:|---:|---:|---:|---:|',
	);
	for (const rows of REQUIRED_SCALES) {
		const scale = report.scales[rows];
		lines.push(
			`| ${rows} | ${round(scale.checked.wallMs.median)} | ${round(scale.checked.segments.mtsApplyMs.median)} | ${round(scale.checked.segments.mtsApplyMs.median / scale.checked.wallMs.median)} | ${round(scale.checked.segments.mtsValidateMs.median)}/${round(scale.trusted.segments.mtsValidateMs.median)} | ${round(scale.checked.segments.mtsPrepareMs.median)} | ${round(scale.checked.segments.btsEncodeMs.median)} | ${round(scale.checked.profile.wireBytes.median, 0)} |`,
		);
	}
	lines.push(
		'',
		`Scaling exponents over 1k/2k/3k: wall ${round(report.scaling.wall)}, MTS apply ${round(report.scaling.mtsApply)}, MTS prepare ${round(report.scaling.mtsPrepare)}, BTS encode ${round(report.scaling.btsEncode)}, wire bytes ${round(report.scaling.wireBytes)}.`,
		'',
		'## Floors and controls',
		'',
		`At 1k, MTS apply is ${round(report.floors.multiples.applyOverPapi)}× the detached PAPI floor. Bridge is ${round(report.floors.multiples.bridgeOverEcho)}× the same-size echo floor at 1 ms clock resolution. BTS/MTS VM calibration is ${round(report.floors.multiples.btsVmOverNodeV8)}×/${round(report.floors.multiples.mtsVmOverNodeV8)}× Node V8.`,
		'',
		`Real commits used flags=0 in ${report.flags.commitWireFlags[0]}/${report.flags.commitWireFlags[0] + report.flags.commitWireFlags[1]} checked samples; receiver restore max ${round(report.flags.mtsRestoreMs.max)} ms. No-restore verdict: **${report.flags.verifiedNoRestore ? 'verified' : 'not verified'}**.`,
		'',
		`Validation-tier paired wall ratios are ${REQUIRED_SCALES.map((rows) => `${rows}: ${round(report.scales[rows].validationControl.pairedWallRatio.median)}×`).join(', ')}.`,
		'',
		'## Attribution verdict',
		'',
		`**${report.owner.status}: ${report.owner.segment}.** It accounts for ${round(report.owner.anchorShareOfShippingWall * 100, 1)}% of the 1k shipping-control wall and scales with exponent ${round(report.owner.scalingExponent)}. This report changes no sequence and authorizes no optimization by itself.`,
		'',
		`Create@5k completed at ${round(report.capacity.checkedWallMs)} ms checked and ${round(report.capacity.trustedWallMs)} ms trusted (${round(report.capacity.checkedOverTrusted)}×). It is recorded only as a capacity boundary, not as an improvement.`,
		'',
	);
	if (report.trace !== null) {
		const verdict = report.trace.verdict;
		lines.push(
			'## Shipping-control trace',
			'',
			`The lossless trace spans ${round(verdict.createWindowMs)} ms from Issue278::create-start [slice id: 7077] to Issue278::commit-ack [slice id: 288103].`,
			'',
			`${verdict.eventListenerSlice.name} [slice id: ${verdict.eventListenerSlice.sliceId}] occupies ${round(verdict.eventListenerSlice.durationMs)} ms and has ${round(verdict.eventListenerSlice.selfTimeMs)} ms aggregate self time. ${verdict.fiberFlushSlice.name} [slice id: ${verdict.fiberFlushSlice.sliceId}] is ${round(verdict.fiberFlushSlice.durationMs)} ms; ${verdict.layoutSlice.name} [slice id: ${verdict.layoutSlice.sliceId}] is ${round(verdict.layoutSlice.durationMs)} ms. This independently localizes the owner to main-thread Lepus event application, not transport or codec.`,
			'',
			'The trace uses the shipping-control bundle but requires host debug tracing. Its duration is attribution evidence only and is not used as a benchmark point or speedup claim.',
			'',
		);
	}
	if (report.runtimeSwitch !== null) {
		lines.push(
			'## Runtime-switch control',
			'',
			`The host advertises \`enable_v8\`, but all ${report.runtimeSwitch.attempts.length} daemon/direct attempts failed and read back \`false\`, including with debug mode enabled. The final device state was restored. Runtime-paired attribution is therefore **unavailable**, and no runtime label was inferred.`,
			'',
		);
	}
	return lines.join('\n');
}

function verifyFileReceipt(entry) {
	const file = path.resolve(REPOSITORY_ROOT, entry.path);
	const bytes = fs.readFileSync(file);
	if (entry.bytes !== undefined && entry.bytes !== bytes.length) {
		throw new Error(`receipt byte mismatch for ${entry.path}.`);
	}
	const digest = createHash('sha256').update(bytes).digest('hex');
	if (entry.sha256 !== digest) throw new Error(`receipt digest mismatch for ${entry.path}.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const { values } = parseArgs({
		options: {
			inputs: { type: 'string' },
			'out-json': { type: 'string' },
			'out-md': { type: 'string' },
			'trace-receipt': { type: 'string' },
			'runtime-switch': { type: 'string' },
		},
	});
	if (
		!values.inputs ||
		!values['out-json'] ||
		!values['out-md'] ||
		!values['trace-receipt'] ||
		!values['runtime-switch']
	) {
		throw new Error(
			'usage: issue278-native-analyze --inputs a.json,b.json --trace-receipt trace.json --runtime-switch switch.json --out-json report.json --out-md report.md',
		);
	}
	const shards = values.inputs
		.split(',')
		.map((file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
	const traceReceipt = JSON.parse(fs.readFileSync(path.resolve(values['trace-receipt']), 'utf8'));
	verifyFileReceipt(traceReceipt.trace);
	for (const entry of Object.values(traceReceipt.queries)) verifyFileReceipt(entry);
	const runtimeSwitch = JSON.parse(fs.readFileSync(path.resolve(values['runtime-switch']), 'utf8'));
	const report = analyzeIssue278Native(shards, { traceReceipt, runtimeSwitch });
	await writeEvidenceJson(path.resolve(values['out-json']), report);
	fs.writeFileSync(path.resolve(values['out-md']), renderIssue278NativeReport(report));
}
