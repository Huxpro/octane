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
const iterations = Number(process.env.ISSUE288_CPU_ITERATIONS ?? '25');
const interactionGapMs = Number(process.env.ISSUE288_CPU_GAP_MS ?? '350');
const tapX = Number(process.env.ISSUE288_TAP_X ?? '640');
const tapY = Number(process.env.ISSUE288_TAP_Y ?? '400');
const runNonce = new Date().toISOString().replaceAll(/[:.]/g, '-');
const disableBundleFile = path.join(
	repositoryRoot,
	'benchmarks/lynx-table/app/dist-issue288-native-disable/main.lynx.bundle',
);
const disableBundleUrl = `${baseUrl}/../../lynx-table/app/dist-issue288-native-disable/main.lynx.bundle`;

function fail(message) {
	throw new Error(`issue #288 native CPU runner: ${message}`);
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
	return path.join(here, 'dist', `${arm}-rows${rows}-cpu`, 'main.lynx.bundle');
}

function screenPixel(x = 1000, y = 780) {
	const result = spawnSync('adb', ['-s', serial, 'exec-out', 'screencap'], {
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) throw result.error;
	if (result.status !== 0) fail(`screencap failed (${result.status})`);
	const bytes = result.stdout;
	const width = bytes.readUInt32LE(0);
	const height = bytes.readUInt32LE(4);
	const format = bytes.readUInt32LE(8);
	const headerBytes = bytes.length === 16 + width * height * 4 ? 16 : 12;
	if (
		format !== 1 ||
		bytes.length !== headerBytes + width * height * 4 ||
		x < 0 ||
		x >= width ||
		y < 0 ||
		y >= height
	) {
		fail(`unexpected screencap ${width}x${height} format=${format} bytes=${bytes.length}`);
	}
	const offset = headerBytes + (y * width + x) * 4;
	return {
		x,
		y,
		width,
		height,
		format: 'RGBA_8888',
		rgba: [...bytes.subarray(offset, offset + 4)],
	};
}

function logcat() {
	return adb('logcat', '-d', '-v', 'raw').stdout;
}

function markLogBoundary(key) {
	const marker = `ISSUE288_CPU_BOUNDARY_${key}`;
	adb('shell', 'log', '-t', 'ISSUE288_CPU_BOUNDARY', marker);
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

function taskTicks(pid) {
	const output = adb(
		'shell',
		`for t in /proc/${pid}/task/*; do tid=\${t##*/}; comm=$(cat "$t/comm"); stat=$(cat "$t/stat"); echo "$tid|$comm|$stat"; done`,
	).stdout;
	const tasks = new Map();
	for (const line of output.trim().split(/\r?\n/)) {
		const match = line.match(/^(\d+)\|([^|]+)\|(\d+) \((.*)\) ([A-Z]) (.*)$/);
		if (match === null) continue;
		const fields = match[6].trim().split(/\s+/);
		const userTicks = Number(fields[10]);
		const systemTicks = Number(fields[11]);
		if (!Number.isSafeInteger(userTicks) || !Number.isSafeInteger(systemTicks)) {
			fail(`invalid task stat ${JSON.stringify(line)}`);
		}
		tasks.set(Number(match[1]), {
			tid: Number(match[1]),
			comm: match[2],
			userTicks,
			systemTicks,
			totalTicks: userTicks + systemTicks,
		});
	}
	return tasks;
}

function tickDelta(before, after, ticksPerSecond) {
	const tasks = [];
	for (const [tid, initial] of before) {
		const final = after.get(tid);
		if (final === undefined || final.comm !== initial.comm) continue;
		const totalTicks = final.totalTicks - initial.totalTicks;
		if (totalTicks < 0) fail(`negative tick delta for TID ${tid}`);
		tasks.push({
			tid,
			comm: initial.comm,
			userTicks: final.userTicks - initial.userTicks,
			systemTicks: final.systemTicks - initial.systemTicks,
			totalTicks,
			cpuMs: (totalTicks * 1000) / ticksPerSecond,
		});
	}
	return tasks;
}

function schedule(mode) {
	if (mode === 'pilot') return ['baseline', 'candidate'];
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

function measureWindow(step, sequence, ticksPerSecond) {
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
		`${baseUrl}/dist/${step.arm}-rows${rows}-cpu/main.lynx.bundle?issue288-cpu=${cacheKey}`,
	);
	const launchLog = waitForLogAfter(targetBoundary, /lynx runtime ready/, 60_000);
	if (!/lynx runtime ready/.test(launchLog)) fail('runtime-ready timeout');
	if (/devtoolEnabled:true|attachToDebugBridge|DebugRouter: plug session/.test(launchLog)) {
		fail('target LynxView enabled or attached DevTool after the off preflight');
	}
	sleep(settleMs);
	const pid = Number(adb('shell', 'pidof', 'com.lynx.explorer').stdout.trim());
	if (!Number.isSafeInteger(pid) || pid <= 0) fail('could not resolve Explorer PID');
	const beforePixel = screenPixel();
	const before = taskTicks(pid);
	if (![...before.values()].some((task) => task.comm === 'Lynx_JS')) {
		fail('Lynx_JS task is missing before the measurement');
	}
	const measurementBoundary = markLogBoundary(`${cacheKey}_measurement`);
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		adb('shell', 'input', 'tap', String(tapX), String(tapY));
		sleep(interactionGapMs);
	}
	sleep(500);
	const after = taskTicks(pid);
	const afterPixel = screenPixel();
	const interactionLog = logsAfter(measurementBoundary);
	const observedTouches = [...interactionLog.matchAll(/SendFileByAgent: type: PageTouchEvent/g)]
		.length;
	if (observedTouches !== iterations) {
		fail(`observed ${observedTouches}/${iterations} native PageTouchEvent records`);
	}
	if (
		JSON.stringify(beforePixel.rgba) !== JSON.stringify([227, 242, 253, 255]) ||
		JSON.stringify(afterPixel.rgba) !== JSON.stringify([38, 50, 56, 255])
	) {
		fail(`unexpected visible leaf transition ${JSON.stringify({ beforePixel, afterPixel })}`);
	}
	const tasks = tickDelta(before, after, ticksPerSecond);
	const byComm = Object.fromEntries(
		[...new Set(tasks.map((task) => task.comm))].sort().map((comm) => {
			const matching = tasks.filter((task) => task.comm === comm);
			const totalTicks = matching.reduce((sum, task) => sum + task.totalTicks, 0);
			return [
				comm,
				{
					taskCount: matching.length,
					totalTicks,
					cpuMs: (totalTicks * 1000) / ticksPerSecond,
					cpuMsPerInteraction: (totalTicks * 1000) / ticksPerSecond / iterations,
				},
			];
		}),
	);
	return {
		sequence,
		...step,
		cacheKey,
		bundleSha256,
		pid,
		iterations,
		interactionGapMs,
		observedTouches,
		beforePixel,
		afterPixel,
		tasks,
		byComm,
	};
}

function main() {
	const [mode, outputFile] = process.argv.slice(2);
	if (!['pilot', 'formal'].includes(mode) || outputFile === undefined || serial === undefined) {
		process.stderr.write(
			'usage: ISSUE288_SERIAL=<serial> node cpu-runner.mjs <pilot|formal> <output.json>\n',
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
		iterations < 3 ||
		iterations % 2 !== 1
	) {
		fail('numeric settings are invalid');
	}
	if (fs.existsSync(outputFile)) fail(`refusing to overwrite ${outputFile}`);
	if (!fs.existsSync(disableBundleFile)) fail(`missing disable bundle ${disableBundleFile}`);
	const reverse = adb('reverse', '--list').stdout;
	if (!reverse.includes(`tcp:${basePort} tcp:${basePort}`))
		fail(`ADB reverse tcp:${basePort} is missing`);
	const ticksPerSecond = Number(adb('shell', 'getconf', 'CLK_TCK').stdout.trim());
	if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) {
		fail('could not read CLK_TCK');
	}
	const steps = schedule(mode).map((entry) =>
		typeof entry === 'string' ? { arm: entry, pair: 0, position: 0 } : entry,
	);
	const meta = {
		protocol: 'octane-issue288-native-context-cpu-window-v1',
		issue: 'Huxpro/octane#288',
		mode,
		windowId: `aries10-cpu-${mode}-${runNonce}`,
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
		iterationsPerWindow: iterations,
		acceptedWindowsPerArm: mode === 'formal' ? 8 : 1,
		order: mode === 'formal' ? 'four alternating ABBA/BAAB pairs' : 'baseline,candidate',
		measurement: 'Linux /proc task user+system CPU ticks around real native touch windows',
		ticksPerSecond,
		devTool: 'off',
		cdpConnections: 0,
		settleMs,
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
		const window = measureWindow(steps[sequence], sequence, ticksPerSecond);
		windows.push(window);
		process.stdout.write(
			`${JSON.stringify({ event: 'window', completed: windows.length, total: steps.length, arm: window.arm })}\n`,
		);
	}
	meta.thermalEnd = readThermal();
	fs.writeFileSync(outputFile, `${JSON.stringify({ meta, windows }, null, 2)}\n`, { flag: 'wx' });
}

main();
