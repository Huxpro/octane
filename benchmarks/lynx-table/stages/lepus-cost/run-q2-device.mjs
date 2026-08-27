import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { analyzeQ2Samples, parseQ2Messages } from './q2-device-analysis.mjs';

const serial = process.env.LYNX_DEVICE_SERIAL;
const bundleDirectory = path.resolve(process.env.LEPUS_BUNDLE_DIR ?? '');
const outputFile = path.resolve(process.env.LEPUS_RESULT_FILE ?? '');
const port = Number(process.env.LEPUS_DEVICE_PORT ?? 18765);
const repetitions = Number(process.env.LEPUS_Q2_REPETITIONS ?? 5);
const scales = (process.env.LEPUS_Q2_SCALES ?? '1000,10000,30000').split(',').map(Number);
if (!serial) throw new Error('LYNX_DEVICE_SERIAL is required.');
if (!process.env.LEPUS_BUNDLE_DIR) throw new Error('LEPUS_BUNDLE_DIR is required.');
if (!process.env.LEPUS_RESULT_FILE) throw new Error('LEPUS_RESULT_FILE is required.');
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new Error('bad repetitions.');
if (scales.some((rows) => !Number.isSafeInteger(rows) || rows < 1)) throw new Error('bad scales.');

const disableName = 'disable-devtool.lynx.bundle';
const bundleNames = scales.flatMap((rows) => [
	`q2-template-${rows}.lynx.bundle`,
	`q2-program-${rows}.lynx.bundle`,
]);
for (const name of [disableName, ...bundleNames]) {
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
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
			['AC powered', 'USB powered', 'status', 'level', 'scale', 'temperature'].map((key) => [
				key,
				battery.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1] ?? null,
			]),
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
async function waitForSlice(start, predicate, label, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const slice = log.text.slice(start);
		if (predicate(slice)) return slice;
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${label}.`);
}
function launch(name, waitForActivity = true) {
	const target = encodeURIComponent(`http://127.0.0.1:${port}/${name}`);
	return shell(
		'am',
		'start',
		...(waitForActivity ? ['-W'] : []),
		'-a',
		'android.intent.action.VIEW',
		'-d',
		`lynx://open?url=${target}`,
		'com.lynx.explorer',
	);
}

const allowed = new Set([disableName, ...bundleNames]);
const server = http.createServer((request, response) => {
	const name = path.basename(new URL(request.url, 'http://localhost').pathname);
	if (!allowed.has(name)) {
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
let pending = '';
function retainLogChunk(chunk) {
	const lines = (pending + chunk).split(/\r?\n/);
	pending = lines.pop() ?? '';
	for (const line of lines) {
		if (
			/__OCTANE_LEPUS_Q2__|DevToolLifecycle|disable lynx debug|enable lynx debug|OCTANE_DEVTOOL|App Bundle's engine version|bytecode_generate_generate_version/.test(
				line,
			)
		) {
			log.text += line + '\n';
		}
	}
}
function startLogcat() {
	const child = spawn(
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
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', retainLogChunk);
	child.stderr.on('data', retainLogChunk);
	return child;
}

const startedAt = new Date().toISOString();
const samples = [];
let before;
let after;
let logcat;
try {
	adb('reverse', `tcp:${port}`, `tcp:${port}`);
	before = stateSnapshot();
	logcat = startLogcat();
	await sleep(250);
	for (const rows of scales) {
		for (let repetition = 0; repetition < repetitions; repetition += 1) {
			const order = repetition % 2 === 0 ? ['template', 'program'] : ['program', 'template'];
			for (const arm of order) {
				shell('am', 'force-stop', 'com.lynx.explorer');
				const disableStart = log.text.length;
				const disableLaunch = launch(disableName);
				await waitForSlice(
					disableStart,
					(text) => text.includes('__OCTANE_DEVTOOL_DISABLED__=true'),
					'DevTool disable acknowledgement',
					30000,
				);
				const benchmarkStart = log.text.length;
				const bundle = `q2-${arm}-${rows}.lynx.bundle`;
				const launchStartedAt = new Date().toISOString();
				const launchOutput = launch(bundle, false);
				const slice = await waitForSlice(
					benchmarkStart,
					(text) => parseQ2Messages(text).length === 1,
					`${bundle} Q2 marker`,
					600000,
				);
				const [message] = parseQ2Messages(slice);
				if (message.type !== 'sample') throw new Error(`${bundle} emitted a non-sample marker.`);
				if (message.boundary !== arm) {
					throw new Error(`${bundle} emitted the ${String(message.boundary)} boundary.`);
				}
				if (/DevTool enabled\. Transitioning to ENABLED\./.test(slice)) {
					throw new Error(`${bundle} re-enabled DevTool inside its sample.`);
				}
				const scriptSelfMs =
					arm === 'program'
						? message.profile.q2ProgramCreateSelfMs
						: message.profile.firstScreenPlanMs;
				if (typeof scriptSelfMs !== 'number' || !Number.isFinite(scriptSelfMs)) {
					throw new Error(`${bundle} carried no finite ${arm} script self time.`);
				}
				samples.push({
					rows,
					repetition,
					order: order.join(''),
					arm,
					bundle,
					launchStartedAt,
					launchEndedAt: new Date().toISOString(),
					scriptSelfMs,
					parseEvalMs: null,
					lepusVersion: message.lepusVersion,
					profile: message.profile,
					launch: { disable: disableLaunch, benchmark: launchOutput },
				});
			}
		}
	}
	after = stateSnapshot();
} finally {
	logcat?.kill('SIGINT');
	await sleep(250);
	retainLogChunk('\n');
	server.close();
}

const analysis = analyzeQ2Samples(samples, repetitions);
const lepusVersions = [...new Set(samples.map((sample) => sample.lepusVersion))];
if (lepusVersions.length !== 1)
	throw new Error(`mixed Lepus versions: ${lepusVersions.join(', ')}`);
const record = {
	schema: 'octane.lepus-cost.m2-q2-window.v1',
	issue: 'https://github.com/Huxpro/octane/issues/196',
	protocol: 'https://github.com/Huxpro/octane/issues/194',
	phase: repetitions >= 5 ? 'M2-Q2-actual' : 'M2-Q2-pilot',
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
		name: 'LepusNG',
		lepusVersion: lepusVersions[0],
		appBundleEngineVersion: '3.9',
		lynxSdkVersion: '4.0',
	},
	bundles: Object.fromEntries(
		[disableName, ...bundleNames].map((name) => [name, sha256(path.join(bundleDirectory, name))]),
	),
	measurementBoundary: {
		program:
			'cumulative emitted program execution against the M1-matched crossing surrogate: numeric factory/append calls use getUniqueId, string calls use setAttribute on one detached sentinel, and no per-call clock is read; emitted after the final expected program node',
		template:
			'first-screen renderPlanNode interpretation, emitted immediately after the outer plan returns and before Element PAPI paint',
		probeTermination:
			'Both arms throw __OCTANE_LEPUS_Q2_STOP__ after logging so native console output flushes and no paint/flush tail enters the window.',
		parseEval: null,
		parseEvalReason:
			'DevTool is disabled and native evaluates the bytecode before in-bundle JavaScript can establish a clock boundary. Launch wall includes native load/layout and is not reported as script self time.',
	},
	protocolChecks: {
		devToolDisabledBeforeEverySample: true,
		devToolStayedDisabled: true,
		repetitions,
		abBa: true,
		callsBeforeIdentity: {
			fullMultisetStableWithinEachArm: true,
			sameAuthoredFixtureAndRowCount: true,
			crossArmDeviceCountsComparable: false,
			reason:
				'Template self-time ends before paint; program executes the M1-matched crossing surrogate. The checked C163 static records establish the shared authored fixture, while this window requires exact per-arm surrogate-count stability.',
		},
		preWindow: before,
		postWindow: after,
	},
	fullSamples: samples,
	analysis,
	logEvidence: log.text
		.split(/\r?\n/)
		.filter((line) =>
			/DevToolLifecycle|disable lynx debug|OCTANE_DEVTOOL|App Bundle's engine version|bytecode_generate_generate_version/.test(
				line,
			),
		),
};
fs.writeFileSync(outputFile, `${JSON.stringify(record, null, 2)}\n`);
console.log(outputFile);
