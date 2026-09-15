import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { writeEvidenceJson } from '../scripts/evidence.mjs';

const INPUT_PROTOCOL = 'octane-issue194-device-v1';
const OUTPUT_PROTOCOL = 'octane-issue291-native-heap-peak-v1';
const TARGET_PROCESS = 'com.lynx.explorer';
const PROFILED_HEAP = 'libc.malloc';
const DEFAULT_SAMPLING_INTERVAL_BYTES = 4096;

function object(value, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	return value;
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`${label} must be a positive integer.`);
	}
	return value;
}

function androidMajor(release) {
	const match = String(release).match(/^\d+/);
	return match === null ? null : Number(match[0]);
}

function sha256(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex');
}

function cellReceipt(input, label) {
	const cell = object(object(input.cells, 'cells')[label], `cell ${label}`);
	const bundle = object(cell.bundle, `cell ${label} bundle`);
	if (
		!/^[0-9a-f]{40}$/.test(cell.sourceCommit) ||
		!/^[0-9a-f]{64}$/.test(bundle.sha256) ||
		!Number.isSafeInteger(bundle.bytes) ||
		bundle.bytes < 1
	) {
		throw new Error(`cell ${label} is missing its source or bundle receipt.`);
	}
	return { sourceCommit: cell.sourceCommit, bundle };
}

/** Parse one explicit ordinal-range-to-trace binding such as 1-4=/tmp/a.pftrace. */
export function parseIssue291HeapPeakTraceSpec(value) {
	const match = String(value).match(/^(\d+)-(\d+)=(.+)$/);
	if (match === null) {
		throw new Error(`invalid --trace ${JSON.stringify(value)}; expected FIRST-LAST=PATH.`);
	}
	const firstOrdinal = Number(match[1]);
	const lastOrdinal = Number(match[2]);
	positiveInteger(firstOrdinal, 'trace first ordinal');
	positiveInteger(lastOrdinal, 'trace last ordinal');
	if (lastOrdinal < firstOrdinal) throw new Error('trace ordinal range must be ascending.');
	return { firstOrdinal, lastOrdinal, file: path.resolve(match[3]) };
}

/** Query dump-at-max bytes and every producer health condition that can invalidate them. */
export function issue291HeapPeakTraceSql() {
	return `
WITH global_health AS (
  SELECT
    COALESCE(MAX(CASE WHEN name = 'heapprofd_buffer_corrupted' THEN value ELSE 0 END), 0) AS buffer_corrupted,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_hit_guardrail' THEN value ELSE 0 END), 0) AS hit_guardrail,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_buffer_overran' THEN value ELSE 0 END), 0) AS buffer_overran,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_client_error' THEN value ELSE 0 END), 0) AS client_errors,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_malformed_packet' THEN value ELSE 0 END), 0) AS malformed_packets,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_missing_packet' THEN value ELSE 0 END), 0) AS missing_packets,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_rejected_concurrent' THEN value ELSE 0 END), 0) AS rejected_concurrent,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_non_finalized_profile' THEN value ELSE 0 END), 0) AS non_finalized_profiles,
    COALESCE(MAX(CASE WHEN name = 'heapprofd_sampling_interval_adjusted' THEN value ELSE 0 END), 0) AS sampling_interval_adjusted_bytes
  FROM stats
  WHERE name GLOB 'heapprofd_*'
), profiles AS (
  SELECT
    hp.id AS profile_id,
    hp.upid,
    p.pid,
    p.name,
    p.start_ts,
    hp.ts,
    hp.ts_end,
    hp.heap_name,
    SUM(a.size) AS peak_native_heap_requested_bytes,
    SUM(a.count) AS peak_native_heap_sample_count,
    MIN(a.size) AS minimum_allocation_size
  FROM heap_profile hp
  JOIN process p USING (upid)
  JOIN heap_profile_allocation a
    ON a.upid = hp.upid AND a.ts = hp.ts_end
  WHERE hp.heap_name IS NULL OR hp.heap_name = '${PROFILED_HEAP}'
  GROUP BY hp.id, hp.upid, p.pid, p.name, p.start_ts, hp.ts, hp.ts_end, hp.heap_name
)
SELECT hex(json_object(
  'profileId', profile_id,
  'upid', upid,
  'pid', pid,
  'processName', name,
  'processStartNs', start_ts,
  'profileStartNs', ts,
  'profileEndNs', ts_end,
  'heapName', COALESCE(heap_name, '${PROFILED_HEAP}'),
  'peakNativeHeapRequestedBytes', peak_native_heap_requested_bytes,
  'peakNativeHeapSampleCount', peak_native_heap_sample_count,
  'minimumAllocationSize', minimum_allocation_size,
  'bufferCorrupted', global_health.buffer_corrupted,
  'hitGuardrail', global_health.hit_guardrail,
  'bufferOverran', global_health.buffer_overran,
  'clientErrors', global_health.client_errors,
  'malformedPackets', global_health.malformed_packets,
  'missingPackets', global_health.missing_packets,
  'rejectedConcurrent', global_health.rejected_concurrent,
  'nonFinalizedProfiles', global_health.non_finalized_profiles,
  'samplingIntervalAdjustedBytes', global_health.sampling_interval_adjusted_bytes
)) AS row_hex
FROM profiles
CROSS JOIN global_health
ORDER BY profiles.start_ts, profiles.ts_end;`;
}

/** Decode the one-column hex JSON CSV emitted by issue291HeapPeakTraceSql. */
export function parseIssue291HeapPeakRows(csv) {
	const lines = String(csv).trim().split(/\r?\n/).filter(Boolean);
	if (lines.shift()?.replaceAll('"', '') !== 'row_hex') {
		throw new Error('trace processor did not return the expected row_hex column.');
	}
	return lines.map((line) => {
		const hex = line.replace(/^"|"$/g, '');
		if (!/^(?:[0-9A-F]{2})+$/.test(hex)) {
			throw new Error('trace processor returned a malformed heap-profile row.');
		}
		return JSON.parse(Buffer.from(hex, 'hex').toString('utf8'));
	});
}

function producerHealth(row) {
	const counts = {
		bufferOverran: row.bufferOverran,
		bufferCorrupted: row.bufferCorrupted,
		rejectedConcurrent: row.rejectedConcurrent,
		hitGuardrail: row.hitGuardrail,
		clientErrors: row.clientErrors,
		malformedPackets: row.malformedPackets,
		missingPackets: row.missingPackets,
		nonFinalizedProfiles: row.nonFinalizedProfiles,
		samplingIntervalAdjustedBytes: row.samplingIntervalAdjustedBytes,
	};
	if (!Object.values(counts).every((value) => Number.isSafeInteger(value) && value === 0)) {
		throw new Error(`heapprofd profile for PID ${row.pid} contains loss or producer errors.`);
	}
	return {
		bufferOverran: false,
		bufferCorrupted: false,
		rejectedConcurrent: false,
		hitGuardrail: false,
		clientErrors: 0,
		malformedPackets: 0,
		missingPackets: 0,
		nonFinalizedProfiles: 0,
		samplingIntervalAdjustedBytes: 0,
	};
}

function validateModeEvidence(mode, expectedProfiles) {
	object(mode, 'trace mode evidence');
	if (
		!Object.values(mode).every((value) => Number.isSafeInteger(value) && value >= 0) ||
		mode.selfMaxFields < expectedProfiles ||
		mode.selfAllocatedFields !== 0 ||
		mode.selfFreedFields !== 0 ||
		mode.fromStartupTrueFields < expectedProfiles ||
		mode.fromStartupFalseFields !== 0
	) {
		throw new Error('trace does not prove startup dump_at_max profile semantics.');
	}
}

/** Bind trace-processor rows to the exact cold processes recorded by the Native window. */
export function collectIssue291NativeHeapPeak(input, batches, inputReceipt, traceProcessor) {
	object(input, 'input');
	if (input.protocol !== INPUT_PROTOCOL) throw new Error('unexpected native device protocol.');
	if (androidMajor(input.device?.android) < 11) {
		throw new Error('heapprofd dump_at_max requires Android 11 or newer.');
	}
	if (!Array.isArray(input.samples) || input.samples.length === 0) {
		throw new Error('heap-peak collection requires accepted Native samples.');
	}
	if (!Array.isArray(batches) || batches.length === 0) {
		throw new Error('heap-peak collection requires at least one trace batch.');
	}
	object(inputReceipt, 'input receipt');
	if (
		!Number.isSafeInteger(inputReceipt.bytes) ||
		inputReceipt.bytes < 1 ||
		!/^[0-9a-f]{64}$/.test(inputReceipt.sha256)
	) {
		throw new Error('heap-peak collection requires the raw Native window byte receipt.');
	}
	object(traceProcessor, 'trace processor receipt');
	if (
		!Number.isSafeInteger(traceProcessor.bytes) ||
		traceProcessor.bytes < 1 ||
		!/^[0-9a-f]{64}$/.test(traceProcessor.sha256) ||
		typeof traceProcessor.version !== 'string' ||
		traceProcessor.version === ''
	) {
		throw new Error('heap-peak collection requires an immutable trace-processor receipt.');
	}
	const samples = input.samples.slice().sort((left, right) => left.ordinal - right.ordinal);
	const byOrdinal = new Map();
	const traces = [];
	for (const batch of batches) {
		positiveInteger(batch.firstOrdinal, 'trace first ordinal');
		positiveInteger(batch.lastOrdinal, 'trace last ordinal');
		if (batch.lastOrdinal < batch.firstOrdinal || !Array.isArray(batch.rows)) {
			throw new Error('heap-peak trace batch has an invalid range or row set.');
		}
		const trace = object(batch.trace, 'trace receipt');
		if (
			!Number.isSafeInteger(trace.bytes) ||
			trace.bytes < 1 ||
			!/^[0-9a-f]{64}$/.test(trace.sha256)
		) {
			throw new Error('heap-peak trace batch is missing its byte receipt.');
		}
		validateModeEvidence(batch.modeEvidence, batch.lastOrdinal - batch.firstOrdinal + 1);
		traces.push(trace);
		for (let ordinal = batch.firstOrdinal; ordinal <= batch.lastOrdinal; ordinal++) {
			if (byOrdinal.has(ordinal)) throw new Error(`heap-peak ordinal ${ordinal} is duplicated.`);
			const sample = samples[ordinal - 1];
			if (sample?.ordinal !== ordinal || sample.accepted !== true) {
				throw new Error(`heap-peak ordinal ${ordinal} has no accepted Native sample.`);
			}
			const pid = positiveInteger(sample.processMemory?.pid, `sample ${ordinal} process PID`);
			const matches = batch.rows.filter((row) => row.pid === pid);
			if (matches.length !== 1) {
				throw new Error(
					`trace needs exactly one dump-at-max profile for sample ${ordinal} PID ${pid}.`,
				);
			}
			const row = matches[0];
			if (
				(row.processName !== null && row.processName !== TARGET_PROCESS) ||
				row.heapName !== PROFILED_HEAP ||
				!Number.isSafeInteger(row.peakNativeHeapRequestedBytes) ||
				row.peakNativeHeapRequestedBytes < 1 ||
				!Number.isSafeInteger(row.peakNativeHeapSampleCount) ||
				row.peakNativeHeapSampleCount < 0 ||
				!Number.isSafeInteger(row.minimumAllocationSize) ||
				row.minimumAllocationSize < 0 ||
				!Number.isSafeInteger(row.upid) ||
				row.upid < 1
			) {
				throw new Error(`sample ${ordinal} is not a valid native dump-at-max profile.`);
			}
			byOrdinal.set(ordinal, {
				ordinal,
				cell: sample.cell,
				pid,
				upid: row.upid,
				processStartNs: row.processStartNs,
				profileStartNs: row.profileStartNs,
				profileEndNs: row.profileEndNs,
				peakNativeHeapRequestedBytes: row.peakNativeHeapRequestedBytes,
				peakNativeHeapSampleCount: row.peakNativeHeapSampleCount,
				producerHealth: producerHealth(row),
				traceSha256: batch.trace.sha256,
			});
		}
	}
	if (byOrdinal.size !== samples.length) {
		throw new Error('heap-peak trace ranges do not cover every accepted Native sample.');
	}
	const cellLabels = [...new Set(samples.map((sample) => sample.cell))];
	return {
		protocol: OUTPUT_PROTOCOL,
		createdAt: new Date().toISOString(),
		traceProcessor,
		device: input.device,
		measurement: {
			source: 'android.heapprofd',
			mode: 'dump_at_max',
			dumpAtMax: true,
			fromStartup: true,
			profiledHeap: PROFILED_HEAP,
			targetProcess: TARGET_PROCESS,
			samplingIntervalBytes: DEFAULT_SAMPLING_INTERVAL_BYTES,
			profilePerturbsTiming: true,
			eligibleForLatencyHeadline: false,
			semantics:
				'maximum sampled live malloc/new bytes requested during each fresh-process profiling window',
		},
		sourceWindow: {
			...inputReceipt,
			protocol: input.protocol,
			question: input.question,
			sampleCount: samples.length,
			cells: Object.fromEntries(cellLabels.map((label) => [label, cellReceipt(input, label)])),
		},
		traces,
		samples: samples.map((sample) => byOrdinal.get(sample.ordinal)),
	};
}

function runTraceProcessor(executable, args) {
	const result = spawnSync(executable, args, {
		encoding: 'utf8',
		maxBuffer: 512 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(`trace processor failed:\n${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

function modeEvidenceFromTrace(executable, trace) {
	return new Promise((resolve, reject) => {
		const result = {
			selfMaxFields: 0,
			selfAllocatedFields: 0,
			selfFreedFields: 0,
			fromStartupTrueFields: 0,
			fromStartupFalseFields: 0,
		};
		const child = spawn(executable, ['convert', 'text', trace], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk) => {
			stderr = `${stderr}${chunk}`.slice(-1024 * 1024);
		});
		const lines = readline.createInterface({ input: child.stdout });
		lines.on('line', (line) => {
			if (/\bself_max:/.test(line)) result.selfMaxFields++;
			if (/\bself_allocated:/.test(line)) result.selfAllocatedFields++;
			if (/\bself_freed:/.test(line)) result.selfFreedFields++;
			if (/\bfrom_startup:\s*true\b/.test(line)) result.fromStartupTrueFields++;
			if (/\bfrom_startup:\s*false\b/.test(line)) result.fromStartupFalseFields++;
		});
		child.once('error', reject);
		child.once('close', (status) => {
			lines.close();
			if (status !== 0) {
				reject(new Error(`trace processor text conversion failed:\n${stderr}`));
			} else {
				resolve(result);
			}
		});
	});
}

async function main() {
	const { values } = parseArgs({
		options: {
			input: { type: 'string' },
			trace: { type: 'string', multiple: true },
			'trace-processor': { type: 'string' },
			out: { type: 'string' },
		},
		strict: true,
	});
	for (const name of ['input', 'trace-processor', 'out']) {
		if (values[name] === undefined) throw new Error(`missing --${name}.`);
	}
	if (!Array.isArray(values.trace) || values.trace.length === 0) {
		throw new Error('missing --trace.');
	}
	const inputFile = path.resolve(values.input);
	const inputBytes = fs.readFileSync(inputFile);
	const traceProcessor = path.resolve(values['trace-processor']);
	const traceProcessorBytes = fs.readFileSync(traceProcessor);
	const traceProcessorVersion = runTraceProcessor(traceProcessor, ['--version']).trim();
	const specs = values.trace.map(parseIssue291HeapPeakTraceSpec);
	const batches = [];
	for (const spec of specs) {
		const bytes = fs.readFileSync(spec.file);
		const csv = runTraceProcessor(traceProcessor, ['query', spec.file, issue291HeapPeakTraceSql()]);
		batches.push({
			...spec,
			rows: parseIssue291HeapPeakRows(csv),
			modeEvidence: await modeEvidenceFromTrace(traceProcessor, spec.file),
			trace: {
				path: path.relative(process.cwd(), spec.file),
				bytes: bytes.length,
				sha256: sha256(bytes),
			},
		});
	}
	const traceProcessorReceipt = {
		path: path.relative(process.cwd(), traceProcessor),
		bytes: traceProcessorBytes.length,
		sha256: sha256(traceProcessorBytes),
		version: traceProcessorVersion,
	};
	const report = collectIssue291NativeHeapPeak(
		JSON.parse(inputBytes),
		batches,
		{
			path: path.relative(process.cwd(), inputFile),
			bytes: inputBytes.length,
			sha256: sha256(inputBytes),
		},
		traceProcessorReceipt,
	);
	await writeEvidenceJson(path.resolve(values.out), report);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
