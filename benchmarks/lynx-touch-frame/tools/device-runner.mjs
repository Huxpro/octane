import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { LOADS, SHAPES, TOPOLOGIES, createFormalSchedule } from '../schedule.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const serial = process.env.ISSUE197_SERIAL;
const baseUrl = process.env.ISSUE197_BASE_URL ?? 'http://127.0.0.1:18797';
const basePort = new URL(baseUrl).port || '80';
const settleMs = Number(process.env.ISSUE197_SETTLE_MS ?? 750);
const runCacheNonce = new Date().toISOString().replaceAll(/[:.]/g, '-');
const sampleMarker = 'ISSUE197_SAMPLE ';
const failureMarker = 'ISSUE197_OBSERVER_FAILURE ';

function fail(message) {
	throw new Error(`issue #197 device runner: ${message}`);
}

function run(command, args, { allowFailure = false } = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
	if (result.error !== undefined) throw result.error;
	if (!allowFailure && result.status !== 0) {
		fail(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr.trim()}`);
	}
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function adb(...args) {
	return run('adb', ['-s', serial, ...args]);
}

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function bundleRelativePath(step) {
	const filename = `${step.shape}.lynx.bundle`;
	if (step.topology === 'T0') return `raw-t0/dist/T0-${step.load}/${filename}`;
	if (step.topology === 'T1') return `react/dist/T1-${step.load}/${filename}`;
	return `octane/dist/${step.topology}-${step.load}/${filename}`;
}

function sha256(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function extractJsonAfterMarker(text, marker) {
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return null;
	const start = text.indexOf('{', markerIndex + marker.length);
	if (start === -1) fail(`marker ${marker.trim()} has no JSON object`);
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const character = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') quoted = true;
		else if (character === '{') depth += 1;
		else if (character === '}' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
	}
	fail(`marker ${marker.trim()} has an unterminated JSON object`);
}

function logcat() {
	return adb('logcat', '-d', '-v', 'raw').stdout;
}

function waitForLog(pattern, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	do {
		const text = logcat();
		if (pattern.test(text)) return text;
		sleep(100);
	} while (Date.now() < deadline);
	return logcat();
}

function platformClockPairs(count = 64) {
	const output = adb(
		'shell',
		'CLASSPATH=/data/local/tmp/issue197-clock.dex',
		'app_process',
		'/system/bin',
		'ClockPair',
		String(count),
	).stdout;
	const pairs = output
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [wallBeforeMs, uptimeMs, wallAfterMs] = line.split(',').map(Number);
			if (![wallBeforeMs, uptimeMs, wallAfterMs].every(Number.isFinite)) {
				fail(`invalid platform clock pair ${JSON.stringify(line)}`);
			}
			return { wallBeforeMs, uptimeMs, wallAfterMs };
		});
	if (pairs.length !== count) fail(`platform clock emitted ${pairs.length}/${count} pairs`);
	return pairs;
}

function chooseClockOffset(pairs) {
	const ranked = pairs
		.map((pair) => ({
			...pair,
			bracketMs: pair.wallAfterMs - pair.wallBeforeMs,
			bootEpochMs: (pair.wallBeforeMs + pair.wallAfterMs) / 2 - pair.uptimeMs,
		}))
		.sort((left, right) => left.bracketMs - right.bracketMs);
	return ranked[0];
}

function readThermal() {
	const battery = adb('shell', 'dumpsys', 'battery').stdout;
	const thermal = adb('shell', 'dumpsys', 'thermalservice').stdout;
	const temperatureDeciC = Number(battery.match(/temperature:\s*(\d+)/)?.[1]);
	const statuses = [...thermal.matchAll(/mStatus=(\d+)/g)].map((match) => Number(match[1]));
	if (!Number.isFinite(temperatureDeciC) || statuses.length === 0) {
		fail('could not read battery temperature and thermal status');
	}
	return { temperatureDeciC, thermalStatus: Math.max(...statuses) };
}

function awaitThermalGate() {
	for (;;) {
		const state = readThermal();
		if (state.temperatureDeciC <= 350 && state.thermalStatus === 0) return state;
		process.stdout.write(
			`${JSON.stringify({ event: 'thermal-pause', ...state, at: new Date().toISOString() })}\n`,
		);
		sleep(15_000);
	}
}

function pilotSchedule() {
	let sequence = 0;
	const steps = [];
	for (const shape of SHAPES) {
		for (const load of LOADS) {
			for (const topology of TOPOLOGIES) {
				steps.push({ sequence: sequence++, shape, load, topology });
			}
		}
	}
	return steps;
}

function verifyDeviceState() {
	const preference = adb(
		'shell',
		'sed',
		'-n',
		'1,80p',
		'/data/user/0/com.lynx.explorer/shared_prefs/lynx_env_config.xml',
	).stdout;
	if (!/name="enable_devtool" value="false"/.test(preference)) {
		fail('Explorer enable_devtool preference is not false');
	}
	const reverse = adb('reverse', '--list').stdout;
	if (!reverse.includes(`tcp:${basePort} tcp:${basePort}`)) {
		fail(`ADB reverse tcp:${basePort} is missing`);
	}
}

function normalizeSampleClock(sample, start, end, meta) {
	const startWallMs = (start.wallBeforeMs + start.wallAfterMs) / 2;
	const endWallMs = (end.wallBeforeMs + end.wallAfterMs) / 2;
	const spanMs = endWallMs - startWallMs;
	const position = spanMs === 0 ? 0 : (sample.inputPlatformTimestamp - startWallMs) / spanMs;
	const clampedPosition = Math.max(0, Math.min(1, position));
	const bootEpochCalibrationMs =
		start.bootEpochMs + (end.bootEpochMs - start.bootEpochMs) * clampedPosition;
	const inputUptimePlatformTimestamp = sample.inputPlatformTimestamp - bootEpochCalibrationMs;
	return {
		...sample,
		inputUptimePlatformTimestamp,
		bootEpochCalibrationMs,
		latencyMs: sample.changedVsyncPlatformTimestamp - inputUptimePlatformTimestamp,
		windowId: meta.windowId,
		deviceModel: meta.deviceModel,
		osVersion: meta.osVersion,
		lynxSdkVersion: meta.lynxSdkVersion,
		lepusVersion:
			sample.topology === 'T1' ? '3.2 (host ReportErrorWithMsg.engine version)' : meta.lepusVersion,
		devTool: meta.devTool,
	};
}

function measureStep(step) {
	const relativeBundlePath = bundleRelativePath(step);
	const absoluteBundlePath = path.join(root, relativeBundlePath);
	if (!fs.existsSync(absoluteBundlePath)) fail(`missing bundle ${relativeBundlePath}`);
	const bundleSha256 = sha256(absoluteBundlePath);
	for (let coldLaunchAttempt = 1; coldLaunchAttempt <= 5; coldLaunchAttempt += 1) {
		const cacheKey = `${bundleSha256.slice(0, 16)}-${runCacheNonce}-${step.sequence}-${coldLaunchAttempt}`;
		adb('logcat', '-c');
		adb('shell', 'am', 'force-stop', 'com.lynx.explorer');
		adb(
			'shell',
			'am',
			'start',
			'-W',
			'-n',
			'com.lynx.explorer/.LynxViewShellActivity',
			'--es',
			'lynx_initial_url',
			`${baseUrl}/${relativeBundlePath}?issue197=${cacheKey}`,
		);
		const launchLog = waitForLog(/onFirstScreen/, 8_000);
		if (!/onFirstScreen/.test(launchLog)) fail('onFirstScreen timeout');
		if (!/devtoolEnabled:false/.test(launchLog)) {
			fail('launched LynxView did not report devtoolEnabled:false');
		}
		sleep(settleMs);
		adb('shell', 'input', 'tap', '640', '885');
		const sampleLog = waitForLog(/ISSUE197_(?:SAMPLE|OBSERVER_FAILURE)/, 3_000);
		const failureIndex = sampleLog.indexOf(failureMarker);
		if (failureIndex !== -1) {
			fail(sampleLog.slice(failureIndex, sampleLog.indexOf('\n', failureIndex)).trim());
		}
		const raw = extractJsonAfterMarker(sampleLog, sampleMarker);
		if (raw === null) continue;
		for (const field of ['topology', 'shape', 'load']) {
			if (raw[field] !== step[field]) {
				fail(`sequence ${step.sequence} expected ${field}=${step[field]}, received ${raw[field]}`);
			}
		}
		return {
			...step,
			...raw,
			bundlePath: relativeBundlePath,
			bundleSha256,
			cacheKey,
			coldLaunchAttempt,
			discardedNoSampleAttempts: coldLaunchAttempt - 1,
		};
	}
	fail(`sample timeout after 5 cold-launch attempts for sequence ${step.sequence}`);
}

function metadata(mode, startCalibration, thermalStart) {
	const prop = (name) => adb('shell', 'getprop', name).stdout.trim();
	return {
		windowId: `aries10-${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
		protocolIssue: 'Huxpro/octane#197',
		protocolBaseline: 'Huxpro/octane#194',
		deviceSerial: serial,
		deviceModel: prop('ro.product.model'),
		deviceProduct: prop('ro.product.name'),
		osVersion: `Android ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})`,
		lynxExplorerVersion: adb('shell', 'dumpsys', 'package', 'com.lynx.explorer').stdout.match(
			/versionName=([^\s]+)/,
		)?.[1],
		lynxSdkVersion: '0.0.1 (host error metadata)',
		lepusVersion: '3.9 (host ReportErrorWithMsg.engine version)',
		devTool: 'off',
		cdpConnections: 0,
		timingClock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
		platformClockCalibration: {
			source: 'android.os.System.currentTimeMillis/SystemClock.uptimeMillis',
			unit: 'ms',
			startPairs: startCalibration.pairs,
			startSelected: startCalibration.selected,
		},
		loadControl: { element: 'scroll-view', autoScrollRatePxPerSecond: 120 },
		thermalStart,
	};
}

function main() {
	const [mode, outputFile] = process.argv.slice(2);
	if (!['pilot', 'formal'].includes(mode) || outputFile === undefined || serial === undefined) {
		process.stderr.write(
			'usage: ISSUE197_SERIAL=<serial> node tools/device-runner.mjs <pilot|formal> <output.json>\n',
		);
		process.exitCode = 1;
		return;
	}
	if (fs.existsSync(outputFile)) fail(`refusing to overwrite ${outputFile}`);
	verifyDeviceState();
	const thermalStart = awaitThermalGate();
	const startPairs = platformClockPairs();
	const startCalibration = { pairs: startPairs, selected: chooseClockOffset(startPairs) };
	const meta = metadata(mode, startCalibration, thermalStart);
	const steps = mode === 'formal' ? createFormalSchedule() : pilotSchedule();
	const partialFile = `${outputFile}.partial.jsonl`;
	fs.writeFileSync(partialFile, `${JSON.stringify({ meta, total: steps.length })}\n`, {
		flag: 'wx',
	});
	const samples = [];
	for (const step of steps) {
		if (step.sequence % 8 === 0 && step.sequence !== 0) awaitThermalGate();
		const sample = measureStep(step);
		samples.push(sample);
		fs.appendFileSync(partialFile, `${JSON.stringify(sample)}\n`);
		process.stdout.write(
			`${JSON.stringify({
				event: 'sample',
				completed: samples.length,
				total: steps.length,
				sequence: step.sequence,
				topology: step.topology,
				shape: step.shape,
				load: step.load,
			})}\n`,
		);
	}
	const endPairs = platformClockPairs();
	meta.platformClockCalibration.endPairs = endPairs;
	meta.platformClockCalibration.endSelected = chooseClockOffset(endPairs);
	meta.platformClockCalibration.driftMs =
		meta.platformClockCalibration.endSelected.bootEpochMs -
		meta.platformClockCalibration.startSelected.bootEpochMs;
	meta.thermalEnd = readThermal();
	const normalizedSamples = samples.map((sample) =>
		normalizeSampleClock(
			sample,
			meta.platformClockCalibration.startSelected,
			meta.platformClockCalibration.endSelected,
			meta,
		),
	);
	fs.writeFileSync(
		outputFile,
		`${JSON.stringify({ meta, samples: normalizedSamples }, null, 2)}\n`,
		{
			flag: 'wx',
		},
	);
}

main();
