import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { analyzeMessages, parseLogMessages } from './analyze.mjs';

const serial = process.env.LYNX_DEVICE_SERIAL;
const bundleDirectory = path.resolve(process.env.LEPUS_BUNDLE_DIR ?? '');
const outputFile = path.resolve(process.env.LEPUS_RESULT_FILE ?? '');
const port = Number(process.env.LEPUS_DEVICE_PORT ?? 18765);
if (!serial) throw new Error('LYNX_DEVICE_SERIAL is required.');
if (!process.env.LEPUS_BUNDLE_DIR) throw new Error('LEPUS_BUNDLE_DIR is required.');
if (!process.env.LEPUS_RESULT_FILE) throw new Error('LEPUS_RESULT_FILE is required.');

const disableName = 'disable-devtool.lynx.bundle';
const benchmarkName = process.env.LEPUS_BENCHMARK_NAME ?? 'm1-dispatch-property.lynx.bundle';
for (const name of [disableName, benchmarkName]) {
	if (!fs.existsSync(path.join(bundleDirectory, name))) throw new Error(`missing ${name}.`);
}

function adb(...args) {
	return execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' });
}

function shell(...args) {
	return adb('shell', ...args).trim();
}

function sha256(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stateSnapshot() {
	const thermal = shell('dumpsys', 'thermalservice');
	const battery = shell('dumpsys', 'battery');
	return {
		capturedAt: new Date().toISOString(),
		loadavg: shell('cat', '/proc/loadavg'),
		thermalStatus: Number(thermal.match(/Thermal Status:\s*(\d+)/)?.[1]),
		temperatures: [
			...thermal.matchAll(
				/Temperature\{mValue=([^,]+), mType=([^,]+), mName=([^,]+), mStatus=([^}]+)\}/g,
			),
		].map(([, value, type, name, status]) => ({
			valueC: Number(value),
			type: Number(type),
			name,
			status: Number(status),
		})),
		battery: Object.fromEntries(
			['AC powered', 'USB powered', 'status', 'level', 'scale', 'temperature'].map((key) => {
				const value = battery.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1] ?? null;
				return [key, value];
			}),
		),
	};
}

function packageVersion() {
	const info = shell('dumpsys', 'package', 'com.lynx.explorer');
	return {
		versionName: info.match(/versionName=([^\s]+)/)?.[1] ?? null,
		versionCode: Number(info.match(/versionCode=(\d+)/)?.[1]),
		lastUpdateTime: info.match(/lastUpdateTime=([^\n]+)/)?.[1]?.trim() ?? null,
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(log, predicate, label, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate(log.text)) return;
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${label}.`);
}

function launch(name) {
	const target = encodeURIComponent(`http://127.0.0.1:${port}/${name}`);
	return shell(
		'am',
		'start',
		'-W',
		'-a',
		'android.intent.action.VIEW',
		'-d',
		`lynx://open?url=${target}`,
		'com.lynx.explorer',
	);
}

const server = http.createServer((request, response) => {
	const name = path.basename(new URL(request.url, 'http://localhost').pathname);
	if (![disableName, benchmarkName].includes(name)) {
		response.writeHead(404).end();
		return;
	}
	response.writeHead(200, { 'content-type': 'application/octet-stream' });
	fs.createReadStream(path.join(bundleDirectory, name)).pipe(response);
});

await new Promise((resolve, reject) => {
	server.once('error', reject);
	server.listen(port, '127.0.0.1', resolve);
});

const log = { text: '' };
let logcat;
let pendingLogLine = '';

function retainLogChunk(chunk) {
	const lines = (pendingLogLine + chunk).split(/\r?\n/);
	pendingLogLine = lines.pop() ?? '';
	for (const line of lines) {
		if (
			/__OCTANE_LEPUS_COST__|DevToolLifecycle|disable lynx debug|enable lynx debug|OCTANE_DEVTOOL|App Bundle's engine version|bytecode_generate_generate_version/.test(
				line,
			)
		) {
			log.text += line + '\n';
		}
	}
}

function startLogcat() {
	const process = spawn(
		'adb',
		[
			'-s',
			serial,
			'logcat',
			'-T',
			'1',
			'-v',
			'epoch',
			'-s',
			'lynx:I',
			'DevToolLifecycle:I',
			'LynxEnv:I',
			'LynxDevtool:I',
			'*:S',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	process.stdout.setEncoding('utf8');
	process.stderr.setEncoding('utf8');
	process.stdout.on('data', retainLogChunk);
	process.stderr.on('data', retainLogChunk);
	return process;
}

const startedAt = new Date().toISOString();
let before;
let after;
let disableLaunch;
let benchmarkLaunch;
try {
	adb('reverse', `tcp:${port}`, `tcp:${port}`);
	before = stateSnapshot();
	shell('am', 'force-stop', 'com.lynx.explorer');
	logcat = startLogcat();
	await sleep(250);
	log.text = '';
	pendingLogLine = '';
	disableLaunch = launch(disableName);
	await waitFor(
		log,
		(text) => text.includes('__OCTANE_DEVTOOL_DISABLED__=true'),
		'DevTool disable acknowledgement',
		30000,
	);
	benchmarkLaunch = launch(benchmarkName);
	await waitFor(
		log,
		(text) =>
			text.includes('__OCTANE_LEPUS_COST__{"type":"done"') ||
			text.includes('__OCTANE_LEPUS_COST__{"type":"fatal"'),
		'benchmark completion',
		120000,
	);
	after = stateSnapshot();
} finally {
	logcat?.kill('SIGINT');
	await sleep(250);
	retainLogChunk('\n');
	server.close();
}

const messages = parseLogMessages(log.text);
const fatal = messages.find((message) => message.type === 'fatal');
if (fatal) throw new Error(`device benchmark failed: ${fatal.message}`);
const analysis = analyzeMessages(messages);
const disabledIndex = log.text.indexOf('DevTool disabled. Transitioning to ATTACHED.');
const acknowledgementIndex = log.text.indexOf('__OCTANE_DEVTOOL_DISABLED__=true');
const firstSampleIndex = log.text.indexOf('__OCTANE_LEPUS_COST__{"type":"sample"');
if (
	disabledIndex === -1 ||
	acknowledgementIndex < disabledIndex ||
	firstSampleIndex < acknowledgementIndex
) {
	throw new Error('DevTool disable evidence is missing or ordered after measurement.');
}
const postDisableLog = log.text.slice(disabledIndex);
if (/DevTool enabled\. Transitioning to ENABLED\./.test(postDisableLog)) {
	throw new Error('DevTool was re-enabled inside the measurement window.');
}

const record = {
	schema: 'octane.lepus-cost.window.v1',
	issue: 'https://github.com/Huxpro/octane/issues/196',
	protocol: 'https://github.com/Huxpro/octane/issues/194',
	phase: analysis.meta.phase,
	window: { startedAt, endedAt: new Date().toISOString() },
	device: {
		serial,
		model: shell('getprop', 'ro.product.model'),
		android: shell('getprop', 'ro.build.version.release'),
		fingerprint: shell('getprop', 'ro.build.fingerprint'),
		abi: shell('getprop', 'ro.product.cpu.abi'),
	},
	host: { package: 'com.lynx.explorer', ...packageVersion() },
	engine: {
		name: analysis.meta.engine,
		lepusVersion: analysis.meta.lepusVersion,
		appBundleEngineVersion: '3.9',
		lynxSdkVersion: '4.0',
	},
	bundles: {
		disableDevToolSha256: sha256(path.join(bundleDirectory, disableName)),
		benchmarkSha256: sha256(path.join(bundleDirectory, benchmarkName)),
	},
	protocolChecks: {
		devToolDisabledBeforeSamples: true,
		devToolStayedDisabled: true,
		repetitions: analysis.meta.repetitions,
		abBa: true,
		callsBeforeIdentity: true,
		preWindow: before,
		postWindow: after,
	},
	launch: { disable: disableLaunch, benchmark: benchmarkLaunch },
	runtime: analysis.meta,
	fullSamples: messages.filter((message) => message.type === 'sample'),
	analysis: {
		sampleCount: analysis.sampleCount,
		checksum: analysis.done.checksum,
		rows: analysis.rows,
	},
	logEvidence: log.text
		.split(/\r?\n/)
		.filter((line) =>
			/DevToolLifecycle|disable lynx debug|OCTANE_DEVTOOL|App Bundle's engine version|bytecode_generate_generate_version/.test(
				line,
			),
		),
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(record, null, 2) + '\n');
console.log(outputFile);
