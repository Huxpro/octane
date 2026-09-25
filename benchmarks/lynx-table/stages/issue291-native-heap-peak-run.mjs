import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { writeEvidenceJson } from '../scripts/evidence.mjs';

const TRACE_PROTOCOL = 'octane-issue291-native-heap-peak-trace-v1';
const TARGET_PROCESS = 'com.lynx.explorer';
const SAMPLING_INTERVAL_BYTES = 4096;
const SHMEM_SIZE_BYTES = 256 * 1024 * 1024;
const TRACE_BUFFER_KB = 256 * 1024;
const DEFAULT_DURATION_MS = 50 * 60 * 1000;

function sha256(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex');
}

function androidMajor(release) {
	const match = String(release).match(/^\d+/);
	return match === null ? null : Number(match[0]);
}

function argValue(args, name) {
	const index = args.indexOf(name);
	return index === -1 ? null : (args[index + 1] ?? null);
}

function readSampleCount(file) {
	if (file === null || !fs.existsSync(file)) return 0;
	const report = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!Array.isArray(report.samples)) throw new Error(`${file} has no samples array.`);
	return report.samples.length;
}

/** Build the exact Android 11+ profile configuration used by the peak-only lane. */
export function issue291NativeHeapPeakConfig(durationMs = DEFAULT_DURATION_MS) {
	if (!Number.isSafeInteger(durationMs) || durationMs < 1000) {
		throw new Error('heap-peak trace duration must be an integer of at least 1000 ms.');
	}
	return [
		`buffers { size_kb: ${TRACE_BUFFER_KB} fill_policy: RING_BUFFER }`,
		`duration_ms: ${durationMs}`,
		'write_into_file: true',
		'file_write_period_ms: 2500',
		'flush_period_ms: 2500',
		'data_sources {',
		'  config {',
		'    name: "android.heapprofd"',
		'    target_buffer: 0',
		'    heapprofd_config {',
		`      process_cmdline: "${TARGET_PROCESS}"`,
		`      sampling_interval_bytes: ${SAMPLING_INTERVAL_BYTES}`,
		`      shmem_size_bytes: ${SHMEM_SIZE_BYTES}`,
		'      block_client: false',
		'      dump_at_max: true',
		'    }',
		'  }',
		'}',
		'',
	].join('\n');
}

/** Fail before touching a measurement when the device cannot provide dump_at_max semantics. */
export function validateIssue291NativeHeapPeakCapability(androidRelease, perfettoQuery) {
	if (androidMajor(androidRelease) < 11) {
		throw new Error(
			`heapprofd dump_at_max requires Android 11 or newer; connected device reports ${androidRelease}.`,
		);
	}
	if (!String(perfettoQuery).includes('name: "android.heapprofd"')) {
		throw new Error('connected device does not advertise the android.heapprofd data source.');
	}
}

function run(command, args, { input, allowFailure = false, stdio } = {}) {
	const result = spawnSync(command, args, {
		encoding: stdio === undefined ? 'utf8' : undefined,
		input,
		stdio,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (!allowFailure && result.status !== 0) {
		throw new Error(
			`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || ''}`,
		);
	}
	return result;
}

function runRunner(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { stdio: 'inherit' });
		const onSigint = () => child.kill('SIGINT');
		const onSigterm = () => child.kill('SIGTERM');
		const removeListeners = () => {
			process.off('SIGINT', onSigint);
			process.off('SIGTERM', onSigterm);
		};
		process.once('SIGINT', onSigint);
		process.once('SIGTERM', onSigterm);
		child.once('error', (error) => {
			removeListeners();
			reject(error);
		});
		child.once('exit', (status, signal) => {
			removeListeners();
			resolve({ status, signal });
		});
	});
}

async function main() {
	const separator = process.argv.indexOf('--', 2);
	if (separator === -1) {
		throw new Error('place the issue194-device-run arguments after --.');
	}
	const wrapperArgs = process.argv.slice(2, separator);
	const runnerArgs = process.argv.slice(separator + 1);
	const { values } = parseArgs({
		args: wrapperArgs,
		options: {
			serial: { type: 'string' },
			'trace-out': { type: 'string' },
			'receipt-out': { type: 'string' },
			'duration-ms': { type: 'string' },
		},
		strict: true,
	});
	for (const name of ['serial', 'trace-out', 'receipt-out']) {
		if (values[name] === undefined) throw new Error(`missing --${name}.`);
	}
	if (runnerArgs.includes('--serial')) {
		throw new Error('the wrapper supplies the runner --serial; do not repeat it after --.');
	}
	for (const required of ['--process-memory', '--create-clear-recreate']) {
		if (!runnerArgs.includes(required)) {
			throw new Error(`heap-peak collection requires runner ${required}.`);
		}
	}
	const runnerCheckpointArg = argValue(runnerArgs, '--checkpoint');
	const runnerOutputArg = argValue(runnerArgs, '--out');
	if (runnerOutputArg === null) throw new Error('the wrapped runner requires --out.');
	const runnerCheckpoint = runnerCheckpointArg === null ? null : path.resolve(runnerCheckpointArg);
	const runnerOutput = path.resolve(runnerOutputArg);
	const beforeSamples = readSampleCount(runnerCheckpoint);
	const traceOut = path.resolve(values['trace-out']);
	const receiptOut = path.resolve(values['receipt-out']);
	for (const file of [traceOut, receiptOut]) {
		if (fs.existsSync(file)) throw new Error(`refusing to overwrite ${file}.`);
	}
	const durationMs =
		values['duration-ms'] === undefined ? DEFAULT_DURATION_MS : Number(values['duration-ms']);
	const config = issue291NativeHeapPeakConfig(durationMs);
	const serial = values.serial;
	const adb = (args, options) => run('adb', ['-s', serial, ...args], options).stdout ?? '';
	const initialTraced = adb(['shell', 'getprop', 'init.svc.traced']).trim();
	const initialProbes = adb(['shell', 'getprop', 'init.svc.traced_probes']).trim();
	let traceStarted = false;
	let traceStopped = false;
	let deviceTraceRemoved = false;
	let runnerResult = null;
	const session = `octane291-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
	const deviceTrace = `/data/local/tmp/${session}.pftrace`;
	try {
		if (initialTraced !== 'running') adb(['shell', 'start', 'traced']);
		if (initialProbes !== 'running') adb(['shell', 'start', 'traced_probes']);
		const androidRelease = adb(['shell', 'getprop', 'ro.build.version.release']).trim();
		const query = adb(['shell', 'perfetto', '--query']);
		validateIssue291NativeHeapPeakCapability(androidRelease, query);
		adb(['shell', 'perfetto', '--txt', '-c', '-', '-o', deviceTrace, `--detach=${session}`], {
			input: config,
		});
		traceStarted = true;
		const detached = run('adb', ['-s', serial, 'shell', 'perfetto', `--is_detached=${session}`], {
			allowFailure: true,
		});
		if (detached.status !== 0) throw new Error('Perfetto heap-peak session did not detach.');
		runnerResult = await runRunner([
			path.join(path.dirname(fileURLToPath(import.meta.url)), 'issue194-device-run.mjs'),
			'--serial',
			serial,
			...runnerArgs,
		]);
	} finally {
		if (traceStarted && !traceStopped) {
			const stop = run(
				'adb',
				['-s', serial, 'shell', 'perfetto', `--attach=${session}`, '--stop'],
				{ allowFailure: true },
			);
			traceStopped = stop.status === 0;
		}
		if (traceStopped) {
			const pull = run('adb', ['-s', serial, 'pull', deviceTrace, traceOut], {
				allowFailure: true,
			});
			if (pull.status === 0) {
				run('adb', ['-s', serial, 'shell', 'rm', deviceTrace], { allowFailure: true });
				deviceTraceRemoved = true;
			}
		}
		if (initialProbes !== 'running') {
			run('adb', ['-s', serial, 'shell', 'stop', 'traced_probes'], { allowFailure: true });
		}
		if (initialTraced !== 'running') {
			run('adb', ['-s', serial, 'shell', 'stop', 'traced'], { allowFailure: true });
		}
	}
	if (!traceStopped || !fs.existsSync(traceOut) || fs.statSync(traceOut).size < 1) {
		throw new Error('Perfetto heap-peak trace did not stop and pull cleanly.');
	}
	if (runnerResult?.status !== 0) {
		throw new Error(
			`wrapped Native runner exited ${runnerResult?.status ?? `on ${runnerResult?.signal ?? 'unknown signal'}`}.`,
		);
	}
	const reportFile =
		runnerCheckpoint !== null && fs.existsSync(runnerCheckpoint)
			? runnerCheckpoint
			: fs.existsSync(runnerOutput)
				? runnerOutput
				: null;
	if (reportFile === null)
		throw new Error('wrapped Native runner produced no report or checkpoint.');
	const afterSamples = readSampleCount(reportFile);
	if (afterSamples <= beforeSamples)
		throw new Error('wrapped Native runner accepted no new samples.');
	const traceBytes = fs.readFileSync(traceOut);
	const reportBytes = fs.readFileSync(reportFile);
	const receipt = {
		protocol: TRACE_PROTOCOL,
		createdAt: new Date().toISOString(),
		octaneCommit: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
		serial,
		sampleRange: { firstOrdinal: beforeSamples + 1, lastOrdinal: afterSamples },
		measurement: {
			targetProcess: TARGET_PROCESS,
			mode: 'dump_at_max',
			fromStartup: true,
			samplingIntervalBytes: SAMPLING_INTERVAL_BYTES,
			configSha256: sha256(Buffer.from(config)),
			durationMs,
		},
		trace: {
			path: path.relative(process.cwd(), traceOut),
			bytes: traceBytes.length,
			sha256: sha256(traceBytes),
			deviceTemporaryPathRemoved: deviceTraceRemoved,
		},
		sourceSnapshot: {
			path: path.relative(process.cwd(), reportFile),
			bytes: reportBytes.length,
			sha256: sha256(reportBytes),
		},
	};
	await writeEvidenceJson(receiptOut, receipt);
	console.log(
		`[issue291-heap-peak] samples ${receipt.sampleRange.firstOrdinal}-${receipt.sampleRange.lastOrdinal} -> ${receipt.trace.sha256}`,
	);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
