import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const baselineRoot = path.resolve(
	process.env.ISSUE288_BASELINE_ROOT ?? path.join(repositoryRoot, '../octane-issue288-context'),
);
const serial = process.env.ISSUE288_SERIAL;
const baseUrl =
	process.env.ISSUE288_BASE_URL ?? 'http://127.0.0.1:18828/benchmarks/lynx-touch-frame/issue288';
const basePort = new URL(baseUrl).port || '80';
const rows = Number(process.env.ISSUE288_ROWS ?? '1000');
const depth = Number(process.env.ISSUE288_DEPTH ?? '32');
const settleMs = Number(process.env.ISSUE288_SETTLE_MS ?? '4000');
const tapX = Number(process.env.ISSUE288_TAP_X ?? '640');
const tapY = Number(process.env.ISSUE288_TAP_Y ?? '400');
const runNonce = new Date().toISOString().replaceAll(/[:.]/g, '-');
const sampleMarker = 'ISSUE288_SAMPLE ';
const failureMarker = 'ISSUE288_OBSERVER_FAILURE ';
const disableBundleFile = path.join(
	repositoryRoot,
	'benchmarks/lynx-table/app/dist-issue288-native-disable/main.lynx.bundle',
);
const disableBundleUrl = `${baseUrl}/../../lynx-table/app/dist-issue288-native-disable/main.lynx.bundle`;

function fail(message) {
	throw new Error(`issue #288 native context runner: ${message}`);
}

function run(command, args, { allowFailure = false } = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function fileReceipt(file) {
	const bytes = fs.readFileSync(file);
	return {
		path: path.relative(repositoryRoot, file).split(path.sep).join('/'),
		bytes: bytes.length,
		sha256: sha256(bytes),
	};
}

function bundleFile(arm) {
	return path.join(here, 'dist', `${arm}-rows${rows}-shipping`, 'main.lynx.bundle');
}

function extractJsonAfterMarker(text, marker) {
	const markerIndex = text.indexOf(marker);
	if (markerIndex === -1) return null;
	const start = text.indexOf('{', markerIndex + marker.length);
	if (start === -1) fail(`marker ${marker.trim()} has no JSON object`);
	let depthCount = 0;
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
		else if (character === '{') depthCount += 1;
		else if (character === '}' && --depthCount === 0) {
			return JSON.parse(text.slice(start, index + 1));
		}
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

function markLogBoundary(key) {
	const marker = `ISSUE288_BOUNDARY_${key}`;
	adb('shell', 'log', '-t', 'ISSUE288_BOUNDARY', marker);
	return marker;
}

function waitForLogAfter(marker, pattern, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let current = '';
	do {
		const text = logcat();
		const markerIndex = text.lastIndexOf(marker);
		current = markerIndex === -1 ? '' : text.slice(markerIndex + marker.length);
		if (pattern.test(current)) return current;
		sleep(100);
	} while (Date.now() < deadline);
	return current;
}

function platformClockPairs(count = 64) {
	const output = adb(
		'shell',
		'CLASSPATH=/data/local/tmp/issue288-clock.dex',
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
	return pairs
		.map((pair) => ({
			...pair,
			bracketMs: pair.wallAfterMs - pair.wallBeforeMs,
			bootEpochMs: (pair.wallBeforeMs + pair.wallAfterMs) / 2 - pair.uptimeMs,
		}))
		.sort((left, right) => left.bracketMs - right.bracketMs)[0];
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
		process.stdout.write(`${JSON.stringify({ event: 'thermal-pause', ...state })}\n`);
		sleep(15_000);
	}
}

function verifyDeviceState() {
	const reverse = adb('reverse', '--list').stdout;
	if (!reverse.includes(`tcp:${basePort} tcp:${basePort}`)) {
		fail(`ADB reverse tcp:${basePort} is missing`);
	}
}

function disableDevToolInFreshProcess(cacheKey) {
	if (!fs.existsSync(disableBundleFile)) fail(`missing disable bundle ${disableBundleFile}`);
	adb('shell', 'am', 'force-stop', 'com.lynx.explorer');
	const boundary = markLogBoundary(`${cacheKey}_preflight`);
	adb(
		'shell',
		'am',
		'start',
		'-W',
		'-n',
		'com.lynx.explorer/.LynxViewShellActivity',
		'--es',
		'lynx_initial_url',
		`${disableBundleUrl}?issue288-disable=${cacheKey}`,
	);
	const preflightLog = waitForLogAfter(boundary, /disable lynx debug/, 30_000);
	if (
		!/__OCTANE_DEVTOOL_DISABLED__=true/.test(preflightLog) ||
		!/disable lynx debug/.test(preflightLog)
	) {
		fail('DevTool-off preflight did not acknowledge');
	}
	adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
	sleep(500);
}

function normalizeSampleClock(sample, start, end, windowId) {
	const startWallMs = (start.wallBeforeMs + start.wallAfterMs) / 2;
	const endWallMs = (end.wallBeforeMs + end.wallAfterMs) / 2;
	const spanMs = endWallMs - startWallMs;
	const position = spanMs === 0 ? 0 : (sample.inputPlatformTimestamp - startWallMs) / spanMs;
	const clamped = Math.max(0, Math.min(1, position));
	const bootEpochCalibrationMs =
		start.bootEpochMs + (end.bootEpochMs - start.bootEpochMs) * clamped;
	const inputUptimePlatformTimestamp = sample.inputPlatformTimestamp - bootEpochCalibrationMs;
	return {
		...sample,
		windowId,
		inputUptimePlatformTimestamp,
		bootEpochCalibrationMs,
		latencyMs: sample.changedVsyncPlatformTimestamp - inputUptimePlatformTimestamp,
	};
}

function schedule(mode) {
	if (mode === 'pilot') return ['baseline', 'candidate'];
	const steps = [];
	for (let pair = 0; pair < 8; pair += 1) {
		const order =
			pair % 2 === 0
				? ['baseline', 'candidate', 'candidate', 'baseline']
				: ['candidate', 'baseline', 'baseline', 'candidate'];
		for (let position = 0; position < order.length; position += 1) {
			steps.push({ arm: order[position], pair, position, direction: position < 2 ? 'AB' : 'BA' });
		}
	}
	return steps;
}

function measureStep(step, sequence) {
	const file = bundleFile(step.arm);
	if (!fs.existsSync(file)) fail(`missing bundle ${file}`);
	const bundleSha256 = sha256(fs.readFileSync(file));
	for (let coldLaunchAttempt = 1; coldLaunchAttempt <= 4; coldLaunchAttempt += 1) {
		const cacheKey = `${bundleSha256.slice(0, 16)}-${runNonce}-${sequence}-${coldLaunchAttempt}`;
		disableDevToolInFreshProcess(cacheKey);
		const targetBoundary = markLogBoundary(`${cacheKey}_target`);
		adb(
			'shell',
			'am',
			'start',
			'-W',
			'-n',
			'com.lynx.explorer/.LynxViewShellActivity',
			'--es',
			'lynx_initial_url',
			`${baseUrl}/dist/${step.arm}-rows${rows}-shipping/main.lynx.bundle?issue288=${cacheKey}`,
		);
		const launchLog = waitForLogAfter(
			targetBoundary,
			/onFirstScreen/,
			rows >= 10_000 ? 120_000 : 30_000,
		);
		if (!/onFirstScreen/.test(launchLog)) fail('onFirstScreen timeout');
		if (/devtoolEnabled:true|attachToDebugBridge|DebugRouter: plug session/.test(launchLog)) {
			fail('target LynxView enabled or attached DevTool after the off preflight');
		}
		sleep(settleMs);
		adb('shell', 'input', 'tap', String(tapX), String(tapY));
		const sampleLog = waitForLogAfter(
			targetBoundary,
			/ISSUE288_(?:SAMPLE|OBSERVER_FAILURE)/,
			10_000,
		);
		const failureIndex = sampleLog.indexOf(failureMarker);
		if (failureIndex !== -1) {
			fail(sampleLog.slice(failureIndex, sampleLog.indexOf('\n', failureIndex)).trim());
		}
		const raw = extractJsonAfterMarker(sampleLog, sampleMarker);
		if (raw === null) continue;
		if (
			raw.protocol !== 'octane-issue288-native-context-v1' ||
			raw.arm !== step.arm ||
			raw.rows !== rows ||
			raw.depth !== depth ||
			raw.before === raw.after
		) {
			fail(`invalid sample ${JSON.stringify(raw)}`);
		}
		return {
			sequence,
			...step,
			...raw,
			bundleSha256,
			cacheKey,
			coldLaunchAttempt,
			discardedNoSampleAttempts: coldLaunchAttempt - 1,
		};
	}
	fail(`sample timeout after 4 cold launches for sequence ${sequence}`);
}

function main() {
	const [mode, outputFile] = process.argv.slice(2);
	if (!['pilot', 'formal'].includes(mode) || outputFile === undefined || serial === undefined) {
		process.stderr.write(
			'usage: ISSUE288_SERIAL=<serial> node device-runner.mjs <pilot|formal> <output.json>\n',
		);
		process.exitCode = 1;
		return;
	}
	if (!Number.isSafeInteger(rows) || rows < 2 || !Number.isSafeInteger(depth) || depth < 0) {
		fail('rows/depth are invalid');
	}
	if (![settleMs, tapX, tapY].every(Number.isFinite)) fail('settle/tap settings are invalid');
	if (fs.existsSync(outputFile)) fail(`refusing to overwrite ${outputFile}`);
	verifyDeviceState();
	const thermalStart = awaitThermalGate();
	const startPairs = platformClockPairs();
	const startSelected = chooseClockOffset(startPairs);
	const windowId = `aries10-${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
	const steps = schedule(mode).map((entry) =>
		typeof entry === 'string' ? { arm: entry, pair: 0, position: 0, direction: 'pilot' } : entry,
	);
	const meta = {
		protocol: 'octane-issue288-native-context-window-v1',
		issue: 'Huxpro/octane#288',
		windowId,
		mode,
		revisions: {
			baseline: execFileSync('git', ['rev-parse', 'HEAD'], {
				cwd: baselineRoot,
				encoding: 'utf8',
			}).trim(),
			candidate: execFileSync('git', ['rev-parse', 'HEAD'], {
				cwd: repositoryRoot,
				encoding: 'utf8',
			}).trim(),
		},
		appSources: Object.fromEntries(
			['App.lynx.tsrx', 'index.ts', 'issue288.css', 'lynx.config.mjs'].map((name) => [
				name,
				fileReceipt(path.join(here, name)),
			]),
		),
		bundles: Object.fromEntries(
			['baseline', 'candidate'].map((arm) => [arm, fileReceipt(bundleFile(arm))]),
		),
		disableBundle: fileReceipt(disableBundleFile),
		rows,
		depth,
		targetAcceptedSamplesPerArm: mode === 'formal' ? 16 : 1,
		order: mode === 'formal' ? 'eight alternating ABBA/BAAB pairs' : 'baseline,candidate',
		observer: 'MTS capture touchstart to first RAF observing changed native computed style',
		timingClock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
		devTool: 'off',
		cdpConnections: 0,
		coldLaunchPerSample:
			'fresh Explorer process, DevTool-off preflight bundle, then cold target bundle in the same process',
		settleMs,
		adbInput: { x: tapX, y: tapY },
		device: {
			serial,
			model: adb('shell', 'getprop', 'ro.product.model').stdout.trim(),
			product: adb('shell', 'getprop', 'ro.product.name').stdout.trim(),
			android: adb('shell', 'getprop', 'ro.build.version.release').stdout.trim(),
			api: adb('shell', 'getprop', 'ro.build.version.sdk').stdout.trim(),
			fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint').stdout.trim(),
		},
		thermalStart,
		platformClockCalibration: {
			source: 'ClockPair.java reflection over android.os.SystemClock',
			startPairs,
			startSelected,
		},
	};
	const partialFile = `${outputFile}.partial.jsonl`;
	fs.writeFileSync(partialFile, `${JSON.stringify({ meta, total: steps.length })}\n`, {
		flag: 'wx',
	});
	const samples = [];
	for (let sequence = 0; sequence < steps.length; sequence += 1) {
		if (sequence !== 0 && sequence % 4 === 0) awaitThermalGate();
		const sample = measureStep(steps[sequence], sequence);
		samples.push(sample);
		fs.appendFileSync(partialFile, `${JSON.stringify(sample)}\n`);
		process.stdout.write(
			`${JSON.stringify({ event: 'sample', completed: samples.length, total: steps.length, arm: sample.arm })}\n`,
		);
	}
	const endPairs = platformClockPairs();
	const endSelected = chooseClockOffset(endPairs);
	meta.platformClockCalibration.endPairs = endPairs;
	meta.platformClockCalibration.endSelected = endSelected;
	meta.platformClockCalibration.driftMs = endSelected.bootEpochMs - startSelected.bootEpochMs;
	meta.thermalEnd = readThermal();
	const normalizedSamples = samples.map((sample) =>
		normalizeSampleClock(sample, startSelected, endSelected, windowId),
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
