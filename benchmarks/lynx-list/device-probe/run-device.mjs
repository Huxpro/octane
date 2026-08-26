import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const serial = process.argv[2];
if (!serial) throw new Error('serial is required');
const mode = process.argv[3] ?? 'drag';
if (!['drag', 'fling'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
const outputFile = process.argv[4] ?? `/tmp/issue195-formal-${mode}.json`;
const gestureDurationMs = mode === 'fling' ? 100 : 1000;
const settleMs = mode === 'fling' ? 6000 : 4000;

const schedule = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'];
const marker = '__OCTANE_ISSUE_195_LIST_WINDOW__';

function adb(...args) {
	return execFileSync('adb', ['-s', serial, ...args], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function thermal() {
	const battery = adb('shell', 'dumpsys', 'battery');
	const service = adb('shell', 'dumpsys', 'thermalservice');
	const batteryTemperatureDeciC = Number(/temperature:\s*(\d+)/.exec(battery)?.[1]);
	const thermalStatus = Number(/Thermal Status:\s*(\d+)/.exec(service)?.[1]);
	return {
		batteryTemperatureC: batteryTemperatureDeciC / 10,
		thermalStatus,
	};
}

function gesture(direction) {
	const [fromY, toY] = direction === 'A' ? ['2300', '400'] : ['400', '2300'];
	const startedAt = Date.now();
	adb('shell', 'input', 'swipe', '640', fromY, '640', toY, String(gestureDurationMs));
	return Date.now() - startedAt;
}

function windowsFromLog() {
	const log = adb('logcat', '-d', '-v', 'raw');
	const windows = [];
	for (const line of log.split('\n')) {
		const start = line.indexOf(marker);
		if (start === -1) continue;
		const jsonStart = start + marker.length;
		const jsonEnd = line.lastIndexOf('}');
		if (jsonEnd < jsonStart) continue;
		windows.push(JSON.parse(line.slice(jsonStart, jsonEnd + 1)));
	}
	return windows.sort((a, b) => a.ordinal - b.ordinal);
}

const warmups = [];
for (const direction of ['A', 'B', 'A', 'B']) {
	warmups.push({ direction, thermalBefore: thermal(), inputWallMs: gesture(direction) });
	await wait(settleMs);
}

const preflush = { direction: 'A', thermalBefore: thermal(), inputWallMs: gesture('A') };
await wait(15000);
const beforeWindows = windowsFromLog();
if (beforeWindows.length === 0) throw new Error('no pre-formal window marker was emitted');
const baselineClosedOrdinal = beforeWindows.at(-1).ordinal;
adb('logcat', '-c');

const formalGestures = [];
for (const direction of schedule) {
	const thermalBefore = thermal();
	if (thermalBefore.thermalStatus !== 0 || thermalBefore.batteryTemperatureC > 40) {
		throw new Error(`thermal guard failed: ${JSON.stringify(thermalBefore)}`);
	}
	formalGestures.push({
		direction,
		thermalBefore,
		inputWallMs: gesture(direction),
		hostStartedAt: new Date().toISOString(),
	});
	await wait(settleMs);
}

const sentinel = { direction: 'A', thermalBefore: thermal(), inputWallMs: gesture('A') };
await wait(15000);
const emitted = windowsFromLog().filter((window) => window.ordinal > baselineClosedOrdinal);
if (emitted.length < 11) {
	throw new Error(`expected sentinel + 10 formal windows, got ${emitted.length}`);
}
const sentinelWindow = emitted[0];
const formalWindows = emitted.slice(1, 11);
const records = formalWindows.map((window, index) => ({
	replication: Math.floor(index / 2) + 1,
	orderWithinPair: index % 2,
	direction: schedule[index],
	host: formalGestures[index],
	window,
}));

writeFileSync(
	outputFile,
	JSON.stringify(
		{
			protocol: 'octane-issue-195-list-probe-v1',
			mode,
			gestureDurationMs,
			settleMs,
			serial,
			schedule,
			warmups,
			preflush,
			baselineClosedOrdinal,
			sentinelWindow,
			sentinel,
			records,
			extraWindows: emitted.slice(11),
		},
		undefined,
		2,
	) + '\n',
);

console.log(
	JSON.stringify({
		outputFile,
		baselineClosedOrdinal,
		emittedOrdinals: emitted.map((window) => window.ordinal),
		recordOrdinals: records.map((record) => record.window.ordinal),
		thermals: formalGestures.map((entry) => entry.thermalBefore),
	}),
);
