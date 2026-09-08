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
const iterations = Number(process.env.ISSUE288_MEMORY_ITERATIONS ?? '25');
const interactionGapMs = Number(process.env.ISSUE288_MEMORY_GAP_MS ?? '150');
const tapX = Number(process.env.ISSUE288_TAP_X ?? '640');
const tapY = Number(process.env.ISSUE288_TAP_Y ?? '400');
const runNonce = new Date().toISOString().replaceAll(/[:.]/g, '-');
const disableBundleFile = path.join(
	repositoryRoot,
	'benchmarks/lynx-table/app/dist-issue288-native-disable/main.lynx.bundle',
);
const disableBundleUrl = `${baseUrl}/../../lynx-table/app/dist-issue288-native-disable/main.lynx.bundle`;

function fail(message) {
	throw new Error(`issue #288 native memory runner: ${message}`);
}

function run(command, args, { allowFailure = false } = {}) {
	const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
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

function sha256(bytes) {
	return crypto.createHash('sha256').update(bytes).digest('hex');
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

function logcat() {
	return adb('logcat', '-d', '-v', 'raw').stdout;
}

function markLogBoundary(key) {
	const marker = `ISSUE288_MEMORY_BOUNDARY_${key}`;
	adb('shell', 'log', '-t', 'ISSUE288_MEMORY_BOUNDARY', marker);
	return marker;
}

function logsAfter(marker) {
	const text = logcat();
	const index = text.lastIndexOf(marker);
	return index === -1 ? '' : text.slice(index + marker.length);
}

function waitForLogAfter(marker, pattern, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let current = '';
	do {
		current = logsAfter(marker);
		if (pattern.test(current)) return current;
		sleep(100);
	} while (Date.now() < deadline);
	return current;
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

function disableDevToolInFreshProcess(cacheKey) {
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

function parseKeyValues(text) {
	return Object.fromEntries(
		text
			.trim()
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Za-z_]+):\s+(\d+) kB$/))
			.filter((match) => match !== null)
			.map((match) => [match[1], Number(match[2])]),
	);
}

function readMemory(pid) {
	const smaps = parseKeyValues(adb('shell', 'cat', `/proc/${pid}/smaps_rollup`).stdout);
	const status = parseKeyValues(adb('shell', 'cat', `/proc/${pid}/status`).stdout);
	const meminfo = adb('shell', 'dumpsys', 'meminfo', String(pid)).stdout;
	const native = meminfo.match(
		/^\s*Native Heap\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m,
	);
	const dalvik = meminfo.match(
		/^\s*Dalvik Heap\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m,
	);
	const total = meminfo.match(/^\s*TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
	if (
		![smaps.Rss, smaps.Pss, smaps.Private_Clean, smaps.Private_Dirty, status.VmRSS].every(
			Number.isFinite,
		) ||
		native === null ||
		dalvik === null ||
		total === null
	) {
		fail('could not parse process memory accounting');
	}
	return {
		capturedAt: new Date().toISOString(),
		smapsRollupKb: smaps,
		statusKb: status,
		dumpsysKb: {
			totalPss: Number(total[1]),
			totalPrivateDirty: Number(total[2]),
			totalPrivateClean: Number(total[3]),
			totalSwapDirty: Number(total[4]),
			nativePss: Number(native[1]),
			nativePrivateDirty: Number(native[2]),
			nativePrivateClean: Number(native[3]),
			nativeHeapSize: Number(native[5]),
			nativeHeapAlloc: Number(native[6]),
			nativeHeapFree: Number(native[7]),
			dalvikPss: Number(dalvik[1]),
			dalvikPrivateDirty: Number(dalvik[2]),
			dalvikPrivateClean: Number(dalvik[3]),
			dalvikHeapSize: Number(dalvik[5]),
			dalvikHeapAlloc: Number(dalvik[6]),
			dalvikHeapFree: Number(dalvik[7]),
		},
	};
}

function schedule(mode) {
	if (mode === 'pilot')
		return [
			{ arm: 'baseline', pair: 0, position: 0 },
			{ arm: 'candidate', pair: 0, position: 1 },
		];
	const windows = [];
	for (let pair = 0; pair < 4; pair += 1) {
		const order =
			pair % 2 === 0
				? ['baseline', 'candidate', 'candidate', 'baseline']
				: ['candidate', 'baseline', 'baseline', 'candidate'];
		for (let position = 0; position < order.length; position += 1) {
			windows.push({ arm: order[position], pair, position });
		}
	}
	return windows;
}

function measureWindow(step, sequence) {
	const file = bundleFile(step.arm);
	const bundleSha256 = sha256(fs.readFileSync(file));
	const cacheKey = `${bundleSha256.slice(0, 16)}-${runNonce}-${sequence}`;
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
		`${baseUrl}/dist/${step.arm}-rows${rows}-shipping/main.lynx.bundle?issue288-memory=${cacheKey}`,
	);
	const launchLog = waitForLogAfter(targetBoundary, /onFirstScreen/, 30_000);
	if (!/onFirstScreen/.test(launchLog)) fail('onFirstScreen timeout');
	if (/devtoolEnabled:true|attachToDebugBridge|DebugRouter: plug session/.test(launchLog)) {
		fail('target LynxView enabled or attached DevTool after the off preflight');
	}
	sleep(settleMs);
	const pid = Number(adb('shell', 'pidof', 'com.lynx.explorer').stdout.trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) fail('could not resolve Explorer PID');
	const settled = readMemory(pid);
	const interactionBoundary = markLogBoundary(`${cacheKey}_interactions`);
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		adb('shell', 'input', 'tap', String(tapX), String(tapY));
		sleep(interactionGapMs);
	}
	sleep(settleMs);
	const interactionLog = logsAfter(interactionBoundary);
	const observedTouches = [...interactionLog.matchAll(/SendFileByAgent: type: PageTouchEvent/g)]
		.length;
	if (observedTouches !== iterations) {
		fail(`observed ${observedTouches}/${iterations} native PageTouchEvent records`);
	}
	const postInteraction = readMemory(pid);
	return {
		sequence,
		...step,
		cacheKey,
		bundleSha256,
		pid,
		iterations,
		interactionGapMs,
		observedTouches,
		settled,
		postInteraction,
	};
}

function main() {
	const [mode, outputFile] = process.argv.slice(2);
	if (!['pilot', 'formal'].includes(mode) || outputFile === undefined || serial === undefined) {
		process.stderr.write(
			'usage: ISSUE288_SERIAL=<serial> node memory-runner.mjs <pilot|formal> <output.json>\n',
		);
		process.exitCode = 1;
		return;
	}
	if (
		![rows, depth, settleMs, iterations, interactionGapMs, tapX, tapY].every(Number.isFinite) ||
		!Number.isSafeInteger(rows) ||
		rows < 2 ||
		!Number.isSafeInteger(depth) ||
		depth < 0 ||
		!Number.isSafeInteger(iterations) ||
		iterations < 1
	) {
		fail('numeric settings are invalid');
	}
	if (fs.existsSync(outputFile)) fail(`refusing to overwrite ${outputFile}`);
	if (!fs.existsSync(disableBundleFile)) fail(`missing disable bundle ${disableBundleFile}`);
	const reverse = adb('reverse', '--list').stdout;
	if (!reverse.includes(`tcp:${basePort} tcp:${basePort}`)) {
		fail(`ADB reverse tcp:${basePort} is missing`);
	}
	const steps = schedule(mode);
	const meta = {
		protocol: 'octane-issue288-native-context-memory-v1',
		issue: 'Huxpro/octane#288',
		mode,
		windowId: `aries10-memory-${mode}-${runNonce}`,
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
		bundles: Object.fromEntries(
			['baseline', 'candidate'].map((arm) => [arm, fileReceipt(bundleFile(arm))]),
		),
		disableBundle: fileReceipt(disableBundleFile),
		rows,
		depth,
		acceptedWindowsPerArm: mode === 'formal' ? 8 : 1,
		order: mode === 'formal' ? 'four alternating ABBA/BAAB pairs' : 'baseline,candidate',
		measurement:
			'Android process smaps_rollup, /proc status, and dumpsys meminfo around real native touch windows',
		lynxGlobalMemoryApi:
			'Unavailable on Explorer SDK 0.0.1: Memory.getAllMemoryUsage returned method not implemented',
		devTool: 'off',
		cdpConnections: 0,
		freshProcessPerWindow: true,
		settleMs,
		iterationsPerWindow: iterations,
		interactionGapMs,
		adbInput: { x: tapX, y: tapY },
		device: {
			serial,
			model: adb('shell', 'getprop', 'ro.product.model').stdout.trim(),
			android: adb('shell', 'getprop', 'ro.build.version.release').stdout.trim(),
			fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint').stdout.trim(),
		},
		thermalStart: awaitThermalGate(),
	};
	const windows = [];
	for (let sequence = 0; sequence < steps.length; sequence += 1) {
		if (sequence !== 0 && sequence % 4 === 0) awaitThermalGate();
		const window = measureWindow(steps[sequence], sequence);
		windows.push(window);
		process.stdout.write(
			`${JSON.stringify({ event: 'window', completed: windows.length, total: steps.length, arm: window.arm })}\n`,
		);
	}
	meta.thermalEnd = readThermal();
	fs.writeFileSync(outputFile, `${JSON.stringify({ meta, windows }, null, 2)}\n`, { flag: 'wx' });
}

main();
