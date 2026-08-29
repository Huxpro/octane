import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const workload = readOptionalArg('--workload');
const tapXArg = readOptionalArg('--tap-x');
const tapYArg = readOptionalArg('--tap-y');
const tapX = tapXArg === null ? null : Number(tapXArg);
const tapY = tapYArg === null ? null : Number(tapYArg);
const question = readArg('--question');
const scale = Number(readArg('--scale'));
const samples = Number(readArg('--samples'));
const timeoutMs = Number(readArg('--timeout-ms'));
const nativeCrashOutcome = args.includes('--native-crash-outcome');
const capacityOutcome = args.includes('--capacity-outcome');
const engineOnly = args.includes('--engine-only');
const mode = args.includes('--direct-result')
	? 'direct-result'
	: args.includes('--first-screen-ready')
		? 'first-screen-ready'
		: 'commit';
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
if (!Number.isSafeInteger(scale) || scale < 1) throw new Error('scale must be positive.');
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be positive.');
if (cells.length !== 2) throw new Error('this AB/BA runner requires exactly two cells.');
if (workload !== null && workload !== 'create' && workload !== 'clear') {
	throw new Error('--workload must be create or clear.');
}
if (
	workload !== null &&
	(!Number.isSafeInteger(tapX) || tapX < 0 || !Number.isSafeInteger(tapY) || tapY < 0)
) {
	throw new Error('--workload requires non-negative integer --tap-x and --tap-y.');
}

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
			if (value !== null) firstScreen.push(value);
		}
		if (line.includes('__ISSUE194_DIRECT_RESULT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_DIRECT_RESULT__');
			if (value !== null) direct.push(value);
		}
		if (line.includes('__ISSUE194_NATIVE_RESULT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_NATIVE_RESULT__');
			if (value !== null) native.push(value);
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
	adb('shell', 'am', 'force-stop', 'com.lynx.explorer');
	adb('logcat', '-c');
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
		disableLog = adb('logcat', '-d', '-v', 'epoch');
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
	// The process-scoped lifecycle is now disabled. Clearing only logcat makes
	// every enabled line in the next snapshot unambiguously part of the measured
	// bundle instead of Explorer's cold-start prelude.
	adb('logcat', '-c');
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
	let mainBeforeTap = 0;
	let nativeBeforeTap = 0;
	while (Date.now() < deadline) {
		await delay(2000);
		log = adb('logcat', '-d', '-v', 'epoch');
		parsed = parseLog(log);
		if ((nativeCrashOutcome || capacityOutcome) && parsed.nativeCrashMs !== null) {
			// ART prints the class Summary after the first overflow line. Give the
			// crashing process time to finish that dump before taking the terminal
			// snapshot; stopping at the first JNI line lost precisely this evidence
			// in device round 1 (#194 / #222).
			await delay(3000);
			log = adb('logcat', '-d', '-v', 'epoch');
			parsed = parseLog(log);
			completed = true;
			break;
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
			mainBeforeTap = parsed.main.length;
			nativeBeforeTap = parsed.native.length;
			tapAtMs = Date.now();
			adb('shell', 'input', 'tap', String(tapX), String(tapY));
			tapped = true;
			continue;
		}
		const interactionMain = tapped ? parsed.main.slice(mainBeforeTap) : [];
		const interactionNative = tapped ? parsed.native.slice(nativeBeforeTap) : [];
		const matchingNative = interactionNative.some(
			(entry) => entry.workload === workload && entry.scale === scale,
		);
		if (
			(engineOnly
				? parsed.firstScreenMs !== null
				: workload !== null
					? interactionMain.length > 0 && matchingNative
					: mode === 'direct-result'
						? parsed.direct.length > 0
						: mode === 'first-screen-ready'
							? parsed.firstScreen.length > 0
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
	const attribution =
		workload !== null
			? (parsed.main.slice(mainBeforeTap).at(-1) ?? null)
			: mode === 'direct-result'
				? (parsed.direct.at(-1) ?? null)
				: mode === 'first-screen-ready'
					? (parsed.firstScreen.at(-1) ?? null)
					: (parsed.main.at(-1) ?? null);
	const backgroundSettle =
		workload === null
			? (parsed.native.find((entry) => entry.scale === scale) ?? null)
			: (parsed.native
					.slice(nativeBeforeTap)
					.find((entry) => entry.workload === workload && entry.scale === scale) ?? null);
	const state = backgroundSettle?.postState ?? null;
	const validPopulatedState = (candidate) =>
		candidate?.rowCount === scale &&
		candidate.firstId === 1 &&
		candidate.secondId === 2 &&
		candidate.thirdId === 3 &&
		(scale < 999 || candidate.row998Id === 999);
	const validBackgroundState =
		workload === 'clear'
			? validPopulatedState(backgroundSettle?.preState) && state?.rowCount === 0
			: validPopulatedState(state);
	const calls = attribution?.calls;
	const validFirstScreenShape =
		calls?.__CreateView?.count === scale + 15 &&
		calls?.__CreateText?.count === scale * 3 + 13 &&
		calls?.__CreateRawText?.count === scale * 3 + 13 &&
		calls?.__AddEvent?.count === scale * 2 + 12 &&
		calls?.__AppendElement?.count === scale * 7 + 41;
	const validState =
		engineOnly || (mode === 'commit' ? validBackgroundState : validFirstScreenShape);
	const errors = parsed.lines.filter((line) =>
		/FATAL EXCEPTION|app::onAppJSError|main-thread\.js exception|loadCard failed|__ISSUE194_NATIVE_ERROR__|JNI ERROR|Abort message:|Fatal signal \d+|Process com\.lynx\.explorer .* has died/.test(
			line,
		),
	);
	const completedAndValid =
		(engineOnly || attribution !== null) &&
		validState &&
		parsed.loadStartMs !== null &&
		(engineOnly || parsed.renderPageMs !== null) &&
		parsed.firstScreenMs !== null &&
		parsed.loadEndMs !== null &&
		errors.length === 0 &&
		parsed.devtoolEnabledEvidence.length === 0;
	const accepted =
		parsed.devtoolEnabledEvidence.length === 0 &&
		(capacityOutcome
			? completedAndValid ||
				(parsed.loadStartMs !== null && (parsed.nativeCrashMs !== null || timedOut))
			: nativeCrashOutcome
				? parsed.loadStartMs !== null &&
					parsed.nativeCrashMs !== null &&
					parsed.nativeCrashEvidence.length > 0
				: completedAndValid);
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
		stateEvidence: state,
		preStateEvidence: backgroundSettle?.preState ?? null,
		firstScreenShapeEvidence: mode === 'commit' ? null : calls,
		backgroundSettle,
		adbInput:
			workload === null
				? null
				: { workload, x: tapX, y: tapY, issuedAtMs: tapAtMs, issued: tapped },
		attribution,
		errors,
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
		thermalGate: 'battery <=35.0C and Android thermal status 0 before every accepted attempt',
		ordering: 'AB/BA (A,B,B,A repeating)',
		completionMode: mode,
		workload,
		adbInput:
			workload === null
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
		cells.map((cell) => [cell.label, { url: cell.url, bundle: bundleIdentity(cell) }]),
	),
	samples: [],
	invalidAttempts: [],
};

if (checkpoint !== null && fs.existsSync(checkpoint)) {
	const resumed = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
	if (
		resumed.protocol !== report.protocol ||
		resumed.question !== report.question ||
		resumed.scale !== report.scale ||
		resumed.targetAcceptedSamplesPerCell !== report.targetAcceptedSamplesPerCell ||
		JSON.stringify(resumed.controls) !== JSON.stringify(report.controls) ||
		JSON.stringify(resumed.disableDevToolBundle) !== JSON.stringify(report.disableDevToolBundle) ||
		JSON.stringify(resumed.cells) !== JSON.stringify(report.cells)
	) {
		throw new Error(`checkpoint does not match this window: ${checkpoint}`);
	}
	report = resumed;
	console.log(
		`[issue194] resumed ${report.samples.length}/${samples * 2} samples from ${checkpoint}`,
	);
}

function saveCheckpoint() {
	if (checkpoint === null) return;
	fs.writeFileSync(checkpoint, `${JSON.stringify(report, null, 2)}\n`);
}

for (const [ordinal, cellIndex] of sequenceFor(samples).entries()) {
	if (report.samples.some((sample) => sample.ordinal === ordinal + 1)) continue;
	const cell = cells[cellIndex];
	let accepted = false;
	for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
		console.log(`[issue194] ${ordinal + 1}/${samples * 2} ${cell.label} attempt ${attempt}`);
		const sample = await measure(cell, ordinal + 1);
		if (sample.accepted) {
			report.samples.push(sample);
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
			console.log(`[issue194] rejected ${cell.label}: ${JSON.stringify(sample.errors)}`);
		}
	}
	if (!accepted)
		throw new Error(`two invalid attempts for ${cell.label} at ordinal ${ordinal + 1}.`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temporaryOutput = `${output}.tmp`;
fs.writeFileSync(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
fs.renameSync(temporaryOutput, output);
if (checkpoint !== null) fs.rmSync(checkpoint, { force: true });
console.log(`[issue194] wrote ${output}`);
