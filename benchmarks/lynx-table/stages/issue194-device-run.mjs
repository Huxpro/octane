import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	issue194CollectionState,
	issue194CompleteGroupSampleLimit,
	issue194DeviceCompletionMode,
	issue194DeviceResumeMismatch,
	issue194LifecycleSequence,
	issue194LogWindow,
	issue194MutationCensus,
	issue194NativePostState,
	issue194NativeTransitionChecks,
	issue194NativeWorkloads,
	issue194RejectionReasons,
	normalizeIssue194NativeReceipt,
	parseIssue194SequenceStep,
	parseIssue194AndroidProcessMemory,
	summarizeIssue194LifecycleCensus,
	validateIssue194ProcessMemoryControls,
} from './issue194-device-protocol.mjs';

const args = process.argv.slice(2);
const readArg = (name) => {
	const index = args.indexOf(name);
	if (index === -1 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
	return args[index + 1];
};
const readOptionalArg = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? null : (args[index + 1] ?? null);
};
const serial = readArg('--serial');
const disableUrl = readArg('--disable-url');
const disableFile = path.resolve(readArg('--disable-file'));
const output = path.resolve(readArg('--out'));
const checkpointArg = readOptionalArg('--checkpoint');
const checkpoint = checkpointArg === null ? null : path.resolve(checkpointArg);
const maxNewSamplesArg = readOptionalArg('--max-new-samples');
const maxNewSamples = maxNewSamplesArg === null ? null : Number(maxNewSamplesArg);
const workload = readOptionalArg('--workload');
const tapXArg = readOptionalArg('--tap-x');
const tapYArg = readOptionalArg('--tap-y');
const tapX = tapXArg === null ? null : Number(tapXArg);
const tapY = tapYArg === null ? null : Number(tapYArg);
const clearTapXArg = readOptionalArg('--clear-tap-x');
const clearTapYArg = readOptionalArg('--clear-tap-y');
const clearTapX = clearTapXArg === null ? null : Number(clearTapXArg);
const clearTapY = clearTapYArg === null ? null : Number(clearTapYArg);
const createClearRecreate = args.includes('--create-clear-recreate');
const sequenceCyclesArg = readOptionalArg('--sequence-cycles');
const sequenceCycles = sequenceCyclesArg === null ? 1 : Number(sequenceCyclesArg);
const sequenceSteps = [];
for (let index = 0; index < args.length; index++) {
	if (args[index] === '--sequence-step') {
		sequenceSteps.push(parseIssue194SequenceStep(args[index + 1]));
	}
}
const question = readArg('--question');
const scale = Number(readArg('--scale'));
const samples = Number(readArg('--samples'));
const timeoutMs = Number(readArg('--timeout-ms'));
const nativeCrashOutcome = args.includes('--native-crash-outcome');
const capacityOutcome = args.includes('--capacity-outcome');
const engineOnly = args.includes('--engine-only');
const processMemory = args.includes('--process-memory');
const settleMsArg = readOptionalArg('--settle-ms');
const settleMs = settleMsArg === null ? 4000 : Number(settleMsArg);
const mode = issue194DeviceCompletionMode(args);
const cells = [];
for (let index = 0; index < args.length; index++) {
	if (args[index] !== '--cell') continue;
	const value = args[index + 1] ?? '';
	const split = value.indexOf('=');
	if (split < 1) throw new Error(`invalid --cell ${JSON.stringify(value)}`);
	cells.push({ label: value.slice(0, split), url: value.slice(split + 1) });
}
for (let index = 0; index < args.length; index++) {
	if (args[index] !== '--cell-file') continue;
	const value = args[index + 1] ?? '';
	const split = value.indexOf('=');
	if (split < 1) throw new Error(`invalid --cell-file ${JSON.stringify(value)}`);
	const label = value.slice(0, split);
	const cell = cells.find((candidate) => candidate.label === label);
	if (cell === undefined) throw new Error(`--cell-file has no matching --cell: ${label}`);
	cell.file = path.resolve(value.slice(split + 1));
}
for (let index = 0; index < args.length; index++) {
	if (args[index] !== '--cell-commit') continue;
	const value = args[index + 1] ?? '';
	const split = value.indexOf('=');
	if (split < 1) throw new Error(`invalid --cell-commit ${JSON.stringify(value)}`);
	const label = value.slice(0, split);
	const sourceCommit = value.slice(split + 1);
	const cell = cells.find((candidate) => candidate.label === label);
	if (cell === undefined) throw new Error(`--cell-commit has no matching --cell: ${label}`);
	if (cell.sourceCommit !== undefined) throw new Error(`duplicate --cell-commit: ${label}`);
	if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
		throw new Error(`--cell-commit requires a full lowercase Git SHA: ${label}`);
	}
	cell.sourceCommit = sourceCommit;
}
if (!Number.isSafeInteger(scale) || scale < 1) throw new Error('scale must be positive.');
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be positive.');
if (cells.length < 1 || cells.length > 2) {
	throw new Error('this runner requires one cell or an AB/BA pair.');
}
if (
	maxNewSamples !== null &&
	(!Number.isSafeInteger(maxNewSamples) || maxNewSamples < 1 || maxNewSamples % cells.length !== 0)
) {
	throw new Error('--max-new-samples must be a positive integer preserving complete cell groups.');
}
if (maxNewSamples !== null && checkpoint === null) {
	throw new Error('--max-new-samples requires --checkpoint.');
}
if (workload !== null && !issue194NativeWorkloads.includes(workload)) {
	throw new Error(`--workload must be one of ${issue194NativeWorkloads.join(', ')}.`);
}
if (
	workload !== null &&
	(!Number.isSafeInteger(tapX) || tapX < 0 || !Number.isSafeInteger(tapY) || tapY < 0)
) {
	throw new Error('--workload requires non-negative integer --tap-x and --tap-y.');
}
if (
	createClearRecreate &&
	(!Number.isSafeInteger(clearTapX) ||
		clearTapX < 0 ||
		!Number.isSafeInteger(clearTapY) ||
		clearTapY < 0 ||
		workload !== 'create')
) {
	throw new Error(
		'--create-clear-recreate requires --workload create and non-negative clear tap coordinates.',
	);
}
if (!Number.isSafeInteger(sequenceCycles) || sequenceCycles < 1) {
	throw new Error('--sequence-cycles must be a positive integer.');
}
if (sequenceCyclesArg !== null && !createClearRecreate) {
	throw new Error('--sequence-cycles requires --create-clear-recreate.');
}
if (
	sequenceSteps.length > 0 &&
	(workload !== null || createClearRecreate || sequenceCyclesArg !== null || processMemory)
) {
	throw new Error(
		'--sequence-step is exclusive with --workload, --create-clear-recreate, --sequence-cycles, and --process-memory.',
	);
}
if (new Set(sequenceSteps.map((step) => step.phase)).size !== sequenceSteps.length) {
	throw new Error('--sequence-step phases must be unique within one measured sequence.');
}
validateIssue194ProcessMemoryControls({
	processMemory,
	mode,
	createClearRecreate,
	settleMs,
});
if (processMemory && cells.some((cell) => cell.sourceCommit === undefined)) {
	throw new Error('--process-memory requires one --cell-commit=<full-sha> for every cell.');
}
const configuredInteractionSequence = createClearRecreate
	? issue194LifecycleSequence(sequenceCycles, { x: tapX, y: tapY }, { x: clearTapX, y: clearTapY })
	: sequenceSteps.length > 0
		? sequenceSteps
		: null;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app');
const run = (command, commandArgs, { allowFailure = false } = {}) => {
	const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (!allowFailure && result.status !== 0) {
		throw new Error(
			`${command} ${commandArgs.join(' ')} failed:\n${result.stderr || result.stdout}`,
		);
	}
	return result.stdout ?? '';
};
const adb = (...commandArgs) => run('adb', ['-s', serial, ...commandArgs]);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveExplorerPid() {
	const pid = Number(adb('shell', 'pidof', 'com.lynx.explorer').trim());
	if (!Number.isSafeInteger(pid) || pid < 1) {
		throw new Error('could not resolve the Explorer process ID.');
	}
	return pid;
}

function readProcessMemory(pid) {
	return {
		capturedAt: new Date().toISOString(),
		...parseIssue194AndroidProcessMemory(
			adb('shell', 'cat', `/proc/${pid}/smaps_rollup`),
			adb('shell', 'cat', `/proc/${pid}/status`),
			adb('shell', 'dumpsys', 'meminfo', String(pid)),
		),
	};
}

function jsonAfterMarker(line, marker) {
	const start = line.indexOf(marker);
	if (start === -1) return null;
	const text = line.slice(start + marker.length);
	const objectStart = text.indexOf('{');
	if (objectStart === -1) return null;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = objectStart; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') quoted = false;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) return JSON.parse(text.slice(objectStart, index + 1));
	}
	return null;
}

const epoch = (line) => {
	const match = line.match(/^\s*(\d+\.\d+)/);
	return match === null ? null : Number(match[1]) * 1000;
};
const elapsed = (start, end) => (start === null || end === null ? null : end - start);

function parseLog(log) {
	const lines = log.split('\n');
	const main = [];
	const firstScreen = [];
	const direct = [];
	const native = [];
	let loadStartMs = null;
	let renderPageMs = null;
	let firstScreenMs = null;
	let loadEndMs = null;
	let engine = null;
	let nativeCrashMs = null;
	const nativeCrashEvidence = [];
	const devtoolDisabledEvidence = [];
	const devtoolEnabledEvidence = [];
	for (const line of lines) {
		if (/DevTool disabled\. Transitioning to ATTACHED\.|disable lynx debug/i.test(line)) {
			devtoolDisabledEvidence.push(line.trim());
		}
		if (/DevTool enabled\. Transitioning to ENABLED\.|\benable lynx debug/i.test(line)) {
			devtoolEnabledEvidence.push(line.trim());
		}
		if (
			/JNI ERROR|Abort message:|Fatal signal \d+|Process com\.lynx\.explorer .* has died/.test(line)
		) {
			nativeCrashMs ??= epoch(line);
			nativeCrashEvidence.push(line.trim());
		}
		if (line.includes('__ISSUE194_MAIN_COMMIT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_MAIN_COMMIT__');
			if (value !== null) main.push(value);
		}
		if (line.includes('__ISSUE194_FIRST_SCREEN__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_FIRST_SCREEN__');
			if (value !== null) firstScreen.push({ ...value, observedAtMs: epoch(line) });
		}
		if (line.includes('__ISSUE194_DIRECT_RESULT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_DIRECT_RESULT__');
			if (value !== null) direct.push(value);
		}
		if (line.includes('__ISSUE194_NATIVE_RESULT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_NATIVE_RESULT__');
			if (value !== null) native.push(value);
		}
		if (line.includes('__NATIVE_BENCH_RESULT__')) {
			const value = jsonAfterMarker(line, '__NATIVE_BENCH_RESULT__');
			if (value !== null) {
				native.push(normalizeIssue194NativeReceipt(value, native.length + 1));
			}
		}
		if (line.includes('start TemplateAssembler::LoadTemplate')) loadStartMs ??= epoch(line);
		if (line.includes('LepusClosureEventListener::Invoke name: __RenderPage')) {
			renderPageMs ??= epoch(line);
		}
		if (line.includes('LynxTemplateRender: onFirstScreen')) firstScreenMs ??= epoch(line);
		if (line.includes('end TemplateAssembler::LoadTemplate')) loadEndMs ??= epoch(line);
		const version = line.match(/App Bundle's engine version: ([^,]+), lynx sdk version:([^,]+)/);
		if (version !== null)
			engine = { appBundleEngine: version[1].trim(), lynxSdk: version[2].trim() };
	}
	const artDumpStart = lines.findIndex((line) =>
		/JNI ERROR.*global reference table|global reference table dump/i.test(line),
	);
	let artDumpEnd = -1;
	if (artDumpStart !== -1) {
		for (let index = artDumpStart + 1; index < lines.length; index++) {
			if (/Runtime aborting|Fatal signal \d+|beginning of crash/.test(lines[index])) {
				artDumpEnd = index;
				break;
			}
		}
	}
	const artReferenceTableDump =
		artDumpStart === -1
			? []
			: lines
					.slice(artDumpStart, artDumpEnd === -1 ? artDumpStart + 512 : artDumpEnd)
					.map((line) => line.trim())
					.filter(Boolean);
	const artReferenceTableSummary = artReferenceTableDump.filter((line) =>
		/Summary:|\b\d+\s+of\s+(?:class\s+)?(?:\[L)?[A-Za-z_$][\w.$]*(?:;)?(?:\s|$)/.test(line),
	);
	return {
		lines,
		main,
		firstScreen,
		direct,
		native,
		loadStartMs,
		renderPageMs,
		firstScreenMs,
		loadEndMs,
		engine,
		nativeCrashMs,
		nativeCrashEvidence,
		artReferenceTableDump,
		artReferenceTableSummary,
		devtoolDisabledEvidence,
		devtoolEnabledEvidence,
	};
}

function thermalSnapshot() {
	const battery = adb('shell', 'dumpsys', 'battery');
	const thermal = adb('shell', 'dumpsys', 'thermalservice');
	const loadavg = adb('shell', 'cat', '/proc/loadavg').trim();
	const temperature = battery.match(/temperature:\s*(\d+)/)?.[1];
	const status =
		thermal.match(/Thermal Status:\s*(\d+)/i)?.[1] ?? thermal.match(/mStatus=(\d+)/)?.[1];
	return {
		batteryTemperatureTenthsC: temperature === undefined ? null : Number(temperature),
		thermalStatus: status === undefined ? null : Number(status),
		loadavg,
	};
}

async function coolBeforeSample() {
	for (let attempt = 0; attempt < 15; attempt++) {
		const snapshot = thermalSnapshot();
		if (
			snapshot.batteryTemperatureTenthsC !== null &&
			snapshot.batteryTemperatureTenthsC <= 350 &&
			snapshot.thermalStatus === 0
		) {
			return snapshot;
		}
		console.log(`[issue194] cooling: ${JSON.stringify(snapshot)}`);
		await delay(20000);
	}
	throw new Error('device did not return to the <=35C / thermal-status-0 gate.');
}

async function ensureInteractive() {
	const stayAwake = Number(
		adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in').trim(),
	);
	if (!Number.isSafeInteger(stayAwake) || stayAwake === 0) {
		throw new Error('device stay-on-while-plugged gate is not enabled.');
	}
	adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
	run('adb', ['-s', serial, 'shell', 'wm', 'dismiss-keyguard'], { allowFailure: true });
	await delay(250);
	const power = adb('shell', 'dumpsys', 'power');
	if (!/mWakefulness=Awake/.test(power) || !/Display Power: state=ON/.test(power)) {
		throw new Error('device did not reach the interactive display-on gate.');
	}
}

function bundleIdentity(cell) {
	const pathname = new URL(cell.url).pathname.replace(/^\//, '');
	const file = cell.file ?? path.resolve(appRoot, pathname);
	if (cell.file === undefined && !file.startsWith(`${appRoot}${path.sep}`)) {
		throw new Error(`bundle escaped app root: ${cell.url}`);
	}
	const bytes = fs.readFileSync(file);
	return {
		path: cell.file === undefined ? path.relative(appRoot, file) : file,
		bytes: bytes.length,
		sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
	};
}

function sequenceFor(count) {
	if (cells.length === 1) return Array.from({ length: count }, () => 0);
	const sequence = [];
	const pattern = [0, 1, 1, 0];
	const accepted = [0, 0];
	for (let index = 0; accepted[0] < count || accepted[1] < count; index++) {
		const candidate = pattern[index % pattern.length];
		if (accepted[candidate] >= count) continue;
		accepted[candidate]++;
		sequence.push(candidate);
	}
	return sequence;
}

async function measure(cell, ordinal) {
	const before = await coolBeforeSample();
	await ensureInteractive();
	adb('shell', 'am', 'force-stop', 'com.lynx.explorer');
	adb('logcat', '-c');
	const preflightMarker = `__ISSUE194_LOG_START__preflight-${ordinal}-${Date.now()}`;
	adb('shell', 'log', '-t', 'octane-issue194', preflightMarker);
	let preflightWindow = issue194LogWindow(adb('logcat', '-d', '-v', 'epoch'), preflightMarker);
	if (preflightWindow.markerEpochMs === null) {
		throw new Error('could not establish the DevTool preflight log boundary.');
	}
	adb(
		'shell',
		'am',
		'start',
		'-n',
		'com.lynx.explorer/.LynxViewShellActivity',
		'--es',
		'lynx_initial_url',
		disableUrl,
	);
	const disableDeadline = Date.now() + 30000;
	let disableLog = '';
	let disableParsed = null;
	while (Date.now() < disableDeadline) {
		await delay(250);
		const fullLog = adb('logcat', '-d', '-v', 'epoch');
		preflightWindow = issue194LogWindow(fullLog, preflightMarker, preflightWindow.markerEpochMs);
		disableLog = preflightWindow.log;
		disableParsed = parseLog(disableLog);
		const disabledIndex = disableLog.lastIndexOf('DevTool disabled. Transitioning to ATTACHED.');
		const acknowledgementIndex = disableLog.lastIndexOf('__OCTANE_DEVTOOL_DISABLED__=true');
		if (disabledIndex !== -1 && acknowledgementIndex > disabledIndex) break;
	}
	if (disableParsed === null) disableParsed = parseLog(disableLog);
	const disabledIndex = disableLog.lastIndexOf('DevTool disabled. Transitioning to ATTACHED.');
	const acknowledgementIndex = disableLog.lastIndexOf('__OCTANE_DEVTOOL_DISABLED__=true');
	if (disabledIndex === -1 || acknowledgementIndex < disabledIndex) {
		throw new Error('DevTool preflight did not acknowledge a disabled lifecycle.');
	}
	if (/DevTool enabled\. Transitioning to ENABLED\./.test(disableLog.slice(disabledIndex))) {
		throw new Error('DevTool preflight re-enabled after the disable transition.');
	}
	// Clearing is best effort: some Sandbox shells leave readable buffers intact.
	// The epoch boundary below, rather than this command, owns attribution.
	adb('logcat', '-c');
	const measurementMarker = `__ISSUE194_LOG_START__measurement-${ordinal}-${Date.now()}`;
	adb('shell', 'log', '-t', 'octane-issue194', measurementMarker);
	let measurementWindow = issue194LogWindow(adb('logcat', '-d', '-v', 'epoch'), measurementMarker);
	if (measurementWindow.markerEpochMs === null) {
		throw new Error('could not establish the measurement log boundary.');
	}
	adb(
		'shell',
		'am',
		'start',
		'-W',
		'-a',
		'android.intent.action.VIEW',
		'-d',
		`lynx://open?url=${encodeURIComponent(cell.url)}`,
		'com.lynx.explorer',
	);
	const deadline = Date.now() + timeoutMs;
	let parsed;
	let log = '';
	let completed = false;
	let tapped = false;
	let tapAtMs = null;
	const observedLifecycle = {
		loadStartMs: null,
		renderPageMs: null,
		firstScreenMs: null,
		loadEndMs: null,
		engine: null,
	};
	const observedDevtoolEnabledEvidence = [];
	const observedErrors = [];
	let initialCensus = null;
	let processMemoryPid = null;
	let processMemoryBaseline = null;
	const observeParsed = (snapshot) => {
		for (const key of ['loadStartMs', 'renderPageMs', 'firstScreenMs', 'loadEndMs']) {
			observedLifecycle[key] ??= snapshot[key];
		}
		observedLifecycle.engine ??= snapshot.engine;
		initialCensus ??= snapshot.main.find((entry) => entry.version === 1)?.census ?? null;
		observedDevtoolEnabledEvidence.push(...snapshot.devtoolEnabledEvidence);
		observedErrors.push(
			...snapshot.lines.filter((line) =>
				/FATAL EXCEPTION|app::onAppJSError|main-thread\.js exception|loadCard failed|__ISSUE194_NATIVE_ERROR__|JNI ERROR|Abort message:|Fatal signal \d+|Process com\.lynx\.explorer .* has died/.test(
					line,
				),
			),
		);
	};
	const interactionSequence = configuredInteractionSequence;
	const sequenceEvidence = [];
	let activeSequenceStep = null;
	while (Date.now() < deadline) {
		await delay(processMemory ? 100 : 2000);
		const fullLog = adb('logcat', '-d', '-v', 'epoch');
		measurementWindow = issue194LogWindow(
			fullLog,
			measurementMarker,
			measurementWindow.markerEpochMs,
		);
		// A multi-megabyte ART dump can evict the marker. Its captured epoch keeps
		// the remaining crash evidence without importing older log buffers.
		log = measurementWindow.log;
		parsed = parseLog(log);
		observeParsed(parsed);
		if ((nativeCrashOutcome || capacityOutcome) && parsed.nativeCrashMs !== null) {
			// ART prints the class Summary after the first overflow line. Give the
			// crashing process time to finish that dump before taking the terminal
			// snapshot; stopping at the first JNI line lost precisely this evidence
			// in device round 1 (#194 / #222).
			await delay(3000);
			const fullLog = adb('logcat', '-d', '-v', 'epoch');
			measurementWindow = issue194LogWindow(
				fullLog,
				measurementMarker,
				measurementWindow.markerEpochMs,
			);
			log = measurementWindow.log;
			parsed = parseLog(log);
			observeParsed(parsed);
			completed = true;
			break;
		}
		if (!nativeCrashOutcome && !capacityOutcome && observedErrors.length !== 0) {
			// A correctness/memory cell can never accept a window containing one of
			// the fatal markers collected above. Stop at that exact evidence boundary
			// instead of waiting out the full sample deadline after the app died.
			completed = true;
			break;
		}
		if (interactionSequence !== null) {
			if (
				activeSequenceStep === null &&
				sequenceEvidence.length < interactionSequence.length &&
				(sequenceEvidence.length > 0 ||
					(parsed.firstScreenMs !== null &&
						parsed.loadEndMs !== null &&
						(mode === 'native-only' || parsed.main.some((entry) => entry.version === 1))))
			) {
				const spec = interactionSequence[sequenceEvidence.length];
				if (processMemory && processMemoryBaseline === null) {
					processMemoryPid = resolveExplorerPid();
					await delay(settleMs);
					processMemoryBaseline = readProcessMemory(processMemoryPid);
				}
				activeSequenceStep = {
					...spec,
					interactionOrdinal: sequenceEvidence.length + 1,
					mainVersionBefore: Math.max(0, ...parsed.main.map((entry) => entry.version ?? 0)),
					issuedAtMs: Date.now(),
				};
				adb('shell', 'input', 'tap', String(spec.x), String(spec.y));
				console.log(
					`[issue194] sequence step ${activeSequenceStep.interactionOrdinal}: issued ${spec.workload} tap`,
				);
				continue;
			}
			if (activeSequenceStep !== null) {
				// The device log ring can evict earlier records, and storms commit
				// once per tick. Pair by the Native interaction ordinal, then retain
				// the latest commit version produced after this tap.
				const main =
					parsed.main
						.filter((entry) => entry.version > activeSequenceStep.mainVersionBefore)
						.at(-1) ?? null;
				const native =
					parsed.native.find(
						(entry) =>
							entry.interactionOrdinal === activeSequenceStep.interactionOrdinal &&
							entry.workload === activeSequenceStep.workload &&
							entry.scale === scale,
					) ?? null;
				if (native !== null && (mode === 'native-only' || main !== null)) {
					const postReceipt = processMemory ? readProcessMemory(processMemoryPid) : null;
					if (processMemory) await delay(settleMs);
					const settled = processMemory ? readProcessMemory(processMemoryPid) : null;
					sequenceEvidence.push({
						step: activeSequenceStep.interactionOrdinal,
						cycle: activeSequenceStep.cycle,
						phase: activeSequenceStep.phase,
						workload: activeSequenceStep.workload,
						adbInput: {
							x: activeSequenceStep.x,
							y: activeSequenceStep.y,
							issuedAtMs: activeSequenceStep.issuedAtMs,
						},
						attribution: main,
						backgroundSettle: native,
						transitionChecks: issue194NativeTransitionChecks(native, scale),
						processMemory:
							postReceipt === null
								? null
								: {
										postReceipt,
										settled,
									},
					});
					console.log(
						`[issue194] sequence step ${activeSequenceStep.interactionOrdinal}: accepted ${activeSequenceStep.workload}`,
					);
					activeSequenceStep = null;
					if (sequenceEvidence.length === interactionSequence.length) {
						completed = true;
						break;
					}
				}
			}
			continue;
		}
		if (
			workload !== null &&
			!tapped &&
			parsed.firstScreenMs !== null &&
			parsed.loadEndMs !== null &&
			(workload !== 'clear' ||
				(parsed.main.length > 0 &&
					parsed.native.some(
						(entry) => entry.workload === 'startup-create' && entry.scale === scale,
					)))
		) {
			tapAtMs = Date.now();
			adb('shell', 'input', 'tap', String(tapX), String(tapY));
			tapped = true;
			continue;
		}
		// Array offsets are not stable across logcat snapshots (the ring can
		// evict the large pre-tap records), so the interaction is identified by
		// its own fields, exactly as the create-clear-recreate path does:
		// version 1 is first-tree adoption, so the tap's main record is
		// version >= 2, and the native record names its workload and scale.
		const interactionMain = tapped ? parsed.main.filter((entry) => entry.version >= 2) : [];
		const matchingNative =
			tapped && parsed.native.some((entry) => entry.workload === workload && entry.scale === scale);
		if (
			(engineOnly
				? parsed.firstScreenMs !== null
				: workload !== null
					? matchingNative && (mode === 'native-only' || interactionMain.length > 0)
					: mode === 'direct-result'
						? parsed.direct.length > 0
						: mode === 'first-screen-ready'
							? parsed.firstScreen.length > 0
							: mode === 'native-only'
								? parsed.native.length > 0
								: parsed.main.length > 0 && parsed.native.length > 0) &&
			parsed.loadStartMs !== null &&
			(engineOnly || parsed.renderPageMs !== null) &&
			parsed.firstScreenMs !== null &&
			parsed.loadEndMs !== null
		) {
			completed = true;
			break;
		}
	}
	const timedOut = !completed && Date.now() >= deadline;
	adb('shell', 'am', 'force-stop', 'com.lynx.explorer');
	const after = thermalSnapshot();
	parsed ??= parseLog(log);
	for (const key of ['loadStartMs', 'renderPageMs', 'firstScreenMs', 'loadEndMs']) {
		parsed[key] ??= observedLifecycle[key];
	}
	parsed.engine ??= observedLifecycle.engine;
	parsed.devtoolEnabledEvidence = [
		...new Set([...observedDevtoolEnabledEvidence, ...parsed.devtoolEnabledEvidence]),
	];
	const attribution =
		interactionSequence !== null
			? (sequenceEvidence.at(-1)?.attribution ?? null)
			: workload !== null
				? (parsed.main.filter((entry) => entry.version >= 2).at(-1) ?? null)
				: mode === 'direct-result'
					? (parsed.direct.at(-1) ?? null)
					: mode === 'first-screen-ready'
						? (parsed.firstScreen.at(-1) ?? null)
						: (parsed.main.at(-1) ?? null);
	const backgroundSettle =
		interactionSequence !== null
			? (sequenceEvidence.at(-1)?.backgroundSettle ?? null)
			: workload === null
				? (parsed.native.find((entry) => entry.scale === scale) ?? null)
				: (parsed.native.find((entry) => entry.workload === workload && entry.scale === scale) ??
					null);
	const validBackgroundState =
		workload !== null &&
		backgroundSettle !== null &&
		issue194RejectionReasons(issue194NativeTransitionChecks(backgroundSettle, scale)).length === 0;
	const validSequenceState =
		interactionSequence !== null &&
		sequenceEvidence.length === interactionSequence.length &&
		sequenceEvidence.every((entry, index) => {
			const expected = interactionSequence[index];
			return (
				entry.cycle === expected.cycle &&
				entry.phase === expected.phase &&
				entry.workload === expected.workload &&
				issue194RejectionReasons(entry.transitionChecks).length === 0
			);
		});
	const validSequenceWire = sequenceEvidence.every((entry) => {
		const wire = entry.attribution?.wireToBts;
		return (
			wire?.boundary === 'native-context-proxy-main-to-background-encoded-payloads' &&
			Number.isSafeInteger(wire.wireToBtsBytes) &&
			wire.wireToBtsBytes > 0 &&
			Number.isSafeInteger(wire.wireToBtsMsgs) &&
			wire.wireToBtsMsgs >= 2 &&
			wire.ackMessages === 1 &&
			Array.isArray(wire.messages) &&
			wire.messages.length === wire.wireToBtsMsgs &&
			wire.messages.filter((message) => message.type === 'ack').length === 1 &&
			wire.messages.filter((message) => message.type === 'complete').length === 1
		);
	});
	const lifecycleCensus = summarizeIssue194LifecycleCensus(sequenceEvidence, initialCensus);
	const validLifecycleCensus =
		sequenceCyclesArg === null || mode === 'native-only' || lifecycleCensus.valid;
	const mutationCensus =
		sequenceSteps.length === 0 ? null : issue194MutationCensus(sequenceEvidence);
	const validMutationCensus =
		mutationCensus === null || mode === 'native-only' || mutationCensus.valid;
	const calls = attribution?.calls;
	const rawTextCount = calls?.__CreateRawText?.count ?? 0;
	const firstScreenLayout =
		rawTextCount === scale * 3 + 13 && calls?.__AppendElement?.count === scale * 7 + 41
			? 'expanded-raw-text'
			: rawTextCount === 0 && calls?.__AppendElement?.count === scale * 4 + 28
				? 'resident-scalar-text'
				: null;
	const validFirstScreenShape =
		calls?.__CreateView?.count === scale + 15 &&
		calls?.__CreateText?.count === scale * 3 + 13 &&
		calls?.__AddEvent?.count === scale * 2 + 12 &&
		firstScreenLayout !== null;
	const validState =
		engineOnly ||
		(interactionSequence !== null
			? validSequenceState &&
				(mode === 'native-only' ||
					(validSequenceWire && validLifecycleCensus && validMutationCensus))
			: mode === 'commit' || mode === 'native-only'
				? validBackgroundState
				: validFirstScreenShape);
	const errors = [...new Set(observedErrors)];
	const completionChecks = {
		attribution: engineOnly || mode === 'native-only' || attribution !== null,
		state: validState,
		loadStart: parsed.loadStartMs !== null,
		renderPage: engineOnly || parsed.renderPageMs !== null,
		firstScreen: parsed.firstScreenMs !== null,
		loadEnd: parsed.loadEndMs !== null,
		noErrors: errors.length === 0,
		devtoolStayedDisabled: parsed.devtoolEnabledEvidence.length === 0,
	};
	const completedAndValid = issue194RejectionReasons(completionChecks).length === 0;
	const capacityTerminalOutcome =
		parsed.loadStartMs !== null && (parsed.nativeCrashMs !== null || timedOut);
	const nativeCrashChecks = {
		devtoolStayedDisabled: parsed.devtoolEnabledEvidence.length === 0,
		loadStart: parsed.loadStartMs !== null,
		nativeCrash: parsed.nativeCrashMs !== null,
		nativeCrashEvidence: parsed.nativeCrashEvidence.length > 0,
	};
	const accepted =
		parsed.devtoolEnabledEvidence.length === 0 &&
		(capacityOutcome
			? completedAndValid || capacityTerminalOutcome
			: nativeCrashOutcome
				? issue194RejectionReasons(nativeCrashChecks).length === 0
				: completedAndValid);
	const rejectionReasons = accepted
		? []
		: capacityOutcome
			? capacityTerminalOutcome
				? issue194RejectionReasons({
						devtoolStayedDisabled: parsed.devtoolEnabledEvidence.length === 0,
					})
				: [...issue194RejectionReasons(completionChecks), 'capacityTerminalOutcome']
			: issue194RejectionReasons(nativeCrashOutcome ? nativeCrashChecks : completionChecks);
	return {
		ordinal,
		cell: cell.label,
		accepted,
		outcome: parsed.nativeCrashMs !== null ? 'native-crash' : timedOut ? 'timeout' : 'completed',
		timeoutMs,
		nativeCrash: {
			atMs: parsed.nativeCrashMs,
			loadToCrashMs:
				parsed.loadStartMs === null || parsed.nativeCrashMs === null
					? null
					: parsed.nativeCrashMs - parsed.loadStartMs,
			evidence: parsed.nativeCrashEvidence,
			artReferenceTableDump: parsed.artReferenceTableDump,
			artReferenceTableSummary: parsed.artReferenceTableSummary,
		},
		thermalBefore: before,
		thermalAfter: after,
		devtool: {
			preflightDisabledEvidence: disableParsed.devtoolDisabledEvidence,
			preflightAcknowledgement: disableLog
				.split('\n')
				.find((line) => line.includes('__OCTANE_DEVTOOL_DISABLED__=true'))
				?.trim(),
			disabledEvidence: parsed.devtoolDisabledEvidence,
			enabledEvidence: parsed.devtoolEnabledEvidence,
			stayedDisabled: parsed.devtoolEnabledEvidence.length === 0,
		},
		engine: parsed.engine,
		boundaries: {
			loadStartMs: parsed.loadStartMs,
			renderPageMs: parsed.renderPageMs,
			firstScreenMs: parsed.firstScreenMs,
			loadEndMs: parsed.loadEndMs,
			loadToRenderPageMs: elapsed(parsed.loadStartMs, parsed.renderPageMs),
			renderPageToFirstScreenMs: elapsed(parsed.renderPageMs, parsed.firstScreenMs),
			loadToFirstScreenMs: elapsed(parsed.loadStartMs, parsed.firstScreenMs),
			loadTemplateMs: elapsed(parsed.loadStartMs, parsed.loadEndMs),
		},
		stateEvidence: issue194NativePostState(backgroundSettle),
		preStateEvidence: backgroundSettle?.preState ?? null,
		firstScreenShapeEvidence: mode === 'commit' || mode === 'native-only' ? null : calls,
		firstScreenLayout: mode === 'commit' || mode === 'native-only' ? null : firstScreenLayout,
		backgroundSettle,
		sequenceEvidence:
			interactionSequence !== null
				? sequenceEvidence.map(({ processMemory: _processMemory, ...entry }) => entry)
				: null,
		lifecycleCensus: createClearRecreate
			? {
					required: sequenceCyclesArg !== null && mode !== 'native-only',
					...lifecycleCensus,
				}
			: null,
		mutationCensus:
			mutationCensus === null
				? null
				: {
						required: mode !== 'native-only',
						...mutationCensus,
					},
		processMemory: processMemory
			? {
					measurement:
						'Android smaps_rollup, /proc status, and dumpsys meminfo sampled after first-screen settling, then immediately after each Native ACK + second-frame receipt and after the explicit settle delay; postReceipt is an operational high-water checkpoint, not an instantaneous peak',
					settleMs,
					pid: processMemoryPid,
					baseline: processMemoryBaseline,
					steps: sequenceEvidence.map((entry) => ({
						step: entry.step,
						cycle: entry.cycle,
						phase: entry.phase,
						workload: entry.workload,
						...entry.processMemory,
					})),
				}
			: null,
		adbInput:
			interactionSequence !== null
				? sequenceEvidence.map((entry) => ({
						cycle: entry.cycle,
						phase: entry.phase,
						workload: entry.workload,
						...entry.adbInput,
					}))
				: workload === null
					? null
					: { workload, x: tapX, y: tapY, issuedAtMs: tapAtMs, issued: tapped },
		attribution,
		errors,
		rejectionReasons: [...new Set(rejectionReasons)],
	};
}

let report = {
	protocol: 'octane-issue194-device-v1',
	question,
	createdAt: new Date().toISOString(),
	octaneCommit: run('git', ['rev-parse', 'HEAD']).trim(),
	serial,
	device: {
		model: adb('shell', 'getprop', 'ro.product.model').trim(),
		product: adb('shell', 'getprop', 'ro.product.name').trim(),
		android: adb('shell', 'getprop', 'ro.build.version.release').trim(),
		fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint').trim(),
		abi: adb('shell', 'getprop', 'ro.product.cpu.abi').trim(),
		explorer:
			adb('shell', 'dumpsys', 'package', 'com.lynx.explorer').match(/versionName=([^\s]+)/)?.[1] ??
			null,
	},
	controls: {
		devtool:
			'disabled by a background-only LynxDevToolSetModule.switchLynxDebug(false) preflight before each sample; no CDP/DevTool connection used',
		coldLaunchPerSample: true,
		display:
			'ADB wake + dismiss-keyguard before every sample; stay-on-while-plugged gate required for multi-commit input sequences',
		thermalGate: 'battery <=35.0C and Android thermal status 0 before every accepted attempt',
		ordering:
			cells.length === 1 ? 'single-cell repeated cold launches' : 'AB/BA (A,B,B,A repeating)',
		completionMode: mode,
		processMemory: processMemory
			? {
					settleMs,
					sources: ['smaps_rollup', '/proc/status', 'dumpsys meminfo'],
					postReceiptIsInstantaneousPeak: false,
				}
			: null,
		workload,
		interactionSequence:
			configuredInteractionSequence !== null
				? {
						...(createClearRecreate ? { cycles: sequenceCycles } : null),
						steps: configuredInteractionSequence.map(({ cycle, phase, workload }) => ({
							...(cycle === undefined ? null : { cycle }),
							phase,
							workload,
						})),
					}
				: null,
		wireBoundary:
			configuredInteractionSequence !== null
				? 'native ContextProxy encoded payloads; not the Web RPC-envelope aggregate'
				: null,
		lifecycleCensusRequired:
			createClearRecreate && sequenceCyclesArg !== null && mode !== 'native-only',
		mutationCensusRequired: sequenceSteps.length > 0 && mode !== 'native-only',
		adbInput:
			configuredInteractionSequence !== null
				? configuredInteractionSequence.map(({ cycle, phase, workload, x, y }) => ({
						...(cycle === undefined ? null : { cycle }),
						phase,
						workload,
						command: `adb -s <serial> shell input tap ${x} ${y}`,
					}))
				: workload === null
					? null
					: {
							command: `adb -s <serial> shell input tap ${tapX} ${tapY}`,
							x: tapX,
							y: tapY,
						},
		engineOnly,
		expectedOutcome: capacityOutcome
			? `terminal outcome at ${timeoutMs} ms: completed, native-crash, or timeout`
			: nativeCrashOutcome
				? 'native-crash'
				: 'completed',
	},
	scale,
	targetAcceptedSamplesPerCell: samples,
	disableDevToolBundle: {
		url: disableUrl,
		bundle: bundleIdentity({ label: 'disable-devtool', url: disableUrl, file: disableFile }),
	},
	cells: Object.fromEntries(
		cells.map((cell) => [
			cell.label,
			{
				url: cell.url,
				sourceCommit: cell.sourceCommit ?? null,
				bundle: bundleIdentity(cell),
			},
		]),
	),
	samples: [],
	invalidAttempts: [],
};

if (checkpoint !== null && fs.existsSync(checkpoint)) {
	const resumed = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
	const mismatch = issue194DeviceResumeMismatch(resumed, report);
	if (mismatch !== null) {
		throw new Error(`checkpoint does not match this window on ${mismatch}: ${checkpoint}`);
	}
	report = resumed;
	console.log(
		`[issue194] resumed ${report.samples.length}/${samples * cells.length} samples from ${checkpoint}`,
	);
}

const boundedMaxNewSamples = issue194CompleteGroupSampleLimit({
	acceptedSamples: report.samples.length,
	targetSamples: samples * cells.length,
	maxNewSamples,
	cellGroupSize: cells.length,
});

function saveCheckpoint() {
	if (checkpoint === null) return;
	fs.writeFileSync(checkpoint, `${JSON.stringify(report, null, 2)}\n`);
}

let newlyAcceptedSamples = 0;
collection: for (const [ordinal, cellIndex] of sequenceFor(samples).entries()) {
	if (report.samples.some((sample) => sample.ordinal === ordinal + 1)) continue;
	const cell = cells[cellIndex];
	let accepted = false;
	for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
		console.log(
			`[issue194] ${ordinal + 1}/${samples * cells.length} ${cell.label} attempt ${attempt}`,
		);
		const sample = await measure(cell, ordinal + 1);
		if (sample.accepted) {
			report.samples.push(sample);
			newlyAcceptedSamples++;
			saveCheckpoint();
			accepted = true;
			console.log(
				nativeCrashOutcome || capacityOutcome
					? `[issue194] accepted ${cell.label}: ${sample.outcome}${
							sample.outcome === 'native-crash'
								? ` after ${sample.nativeCrash.loadToCrashMs} ms`
								: sample.outcome === 'timeout'
									? ` at ${sample.timeoutMs} ms cutoff`
									: ` after ${sample.boundaries.loadToFirstScreenMs} ms`
						}`
					: `[issue194] accepted ${cell.label}: ${sample.boundaries.loadToFirstScreenMs} ms`,
			);
		} else {
			report.invalidAttempts.push(sample);
			saveCheckpoint();
			console.log(`[issue194] rejected ${cell.label}: ${JSON.stringify(sample.rejectionReasons)}`);
		}
	}
	if (!accepted)
		throw new Error(`two invalid attempts for ${cell.label} at ordinal ${ordinal + 1}.`);
	if (
		issue194CollectionState({
			acceptedSamples: report.samples.length,
			targetSamples: samples * cells.length,
			newlyAcceptedSamples,
			maxNewSamples: boundedMaxNewSamples,
		}) === 'paused'
	) {
		break collection;
	}
}

const collectionState = issue194CollectionState({
	acceptedSamples: report.samples.length,
	targetSamples: samples * cells.length,
	newlyAcceptedSamples,
	maxNewSamples: boundedMaxNewSamples,
});
if (collectionState === 'complete') {
	fs.mkdirSync(path.dirname(output), { recursive: true });
	const temporaryOutput = `${output}.tmp`;
	fs.writeFileSync(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
	fs.renameSync(temporaryOutput, output);
	if (checkpoint !== null) fs.rmSync(checkpoint, { force: true });
	console.log(`[issue194] wrote ${output}`);
} else if (collectionState === 'paused') {
	console.log(
		`[issue194] paused after ${newlyAcceptedSamples} new samples; checkpoint retains ${report.samples.length}/${samples * cells.length}`,
	);
} else {
	throw new Error('issue #194 collection stopped before its target without a pause boundary.');
}
