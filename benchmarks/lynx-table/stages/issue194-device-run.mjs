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
const clearTapXArg = readOptionalArg('--clear-tap-x');
const clearTapYArg = readOptionalArg('--clear-tap-y');
const clearTapX = clearTapXArg === null ? null : Number(clearTapXArg);
const clearTapY = clearTapYArg === null ? null : Number(clearTapYArg);
const createClearRecreate = args.includes('--create-clear-recreate');
const question = readArg('--question');
const scale = Number(readArg('--scale'));
const samples = Number(readArg('--samples'));
const timeoutMs = Number(readArg('--timeout-ms'));
const nativeCrashOutcome = args.includes('--native-crash-outcome');
const capacityOutcome = args.includes('--capacity-outcome');
const engineOnly = args.includes('--engine-only');
const mode = args.includes('--m15-result')
	? 'm15-result'
	: args.includes('--direct-result')
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
if (cells.length < 1 || cells.length > 2) {
	throw new Error('this runner requires one cell or an AB/BA pair.');
}
if (workload !== null && workload !== 'create' && workload !== 'clear') {
	throw new Error('--workload must be create or clear.');
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

function splitCommitSegments(backgroundRender, attribution, backgroundSettle) {
	const renderStartMs = backgroundRender?.renderStartMs;
	const encodeDoneMs = backgroundRender?.encodeDoneMs;
	const mtsReceiveMs = attribution?.timing?.mtsReceiveMs;
	const flushReturnMs = attribution?.timing?.flushReturnMs;
	const secondFrameMs = backgroundSettle?.endMs;
	if (
		![renderStartMs, encodeDoneMs, mtsReceiveMs, flushReturnMs, secondFrameMs].every(
			Number.isSafeInteger,
		) ||
		backgroundSettle?.startMs !== renderStartMs ||
		encodeDoneMs < renderStartMs ||
		mtsReceiveMs < encodeDoneMs ||
		flushReturnMs < mtsReceiveMs ||
		secondFrameMs < flushReturnMs
	) {
		return null;
	}
	const btsRenderMs = encodeDoneMs - renderStartMs;
	const wireMs = mtsReceiveMs - encodeDoneMs;
	const mtsApplyMs = flushReturnMs - mtsReceiveMs;
	const residueToSecondFrameMs = secondFrameMs - flushReturnMs;
	return {
		boundary: 'tap-to-second-frame-partition-v1',
		totalMs: secondFrameMs - renderStartMs,
		btsRenderMs,
		wireMs,
		mtsApplyMs,
		residueToSecondFrameMs,
		identityMs: btsRenderMs + wireMs + mtsApplyMs + residueToSecondFrameMs,
	};
}

function parseLog(log) {
	const lines = log.split('\n');
	const main = [];
	const firstScreen = [];
	const direct = [];
	const native = [];
	const bts = [];
	const m15 = [];
	const m15Rows = [];
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
		if (line.includes('__ISSUE194_BTS_COMMIT__')) {
			const value = jsonAfterMarker(line, '__ISSUE194_BTS_COMMIT__');
			if (value !== null) bts.push(value);
		}
		if (line.includes('__ISSUE196_M15_RESULT__')) {
			const value = jsonAfterMarker(line, '__ISSUE196_M15_RESULT__');
			if (value !== null) m15.push(value);
		}
		if (line.includes('__ISSUE196_M15_ROW__')) {
			const value = jsonAfterMarker(line, '__ISSUE196_M15_ROW__');
			if (value !== null) m15Rows.push(value);
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
		bts,
		m15,
		m15Rows,
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
		const markerIndex = fullLog.lastIndexOf(preflightMarker);
		disableLog = markerIndex === -1 ? '' : fullLog.slice(markerIndex);
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
	const measurementMarker = `__ISSUE194_LOG_START__measurement-${ordinal}-${Date.now()}`;
	adb('shell', 'log', '-t', 'octane-issue194', measurementMarker);
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
	const observeParsed = (snapshot) => {
		for (const key of ['loadStartMs', 'renderPageMs', 'firstScreenMs', 'loadEndMs']) {
			observedLifecycle[key] ??= snapshot[key];
		}
		observedLifecycle.engine ??= snapshot.engine;
		observedDevtoolEnabledEvidence.push(...snapshot.devtoolEnabledEvidence);
		observedErrors.push(
			...snapshot.lines.filter((line) =>
				/FATAL EXCEPTION|app::onAppJSError|main-thread\.js exception|loadCard failed|__ISSUE194_NATIVE_ERROR__|JNI ERROR|Abort message:|Fatal signal \d+|Process com\.lynx\.explorer .* has died/.test(
					line,
				),
			),
		);
	};
	const interactionSequence = createClearRecreate
		? [
				{ workload: 'create', x: tapX, y: tapY },
				{ workload: 'clear', x: clearTapX, y: clearTapY },
				{ workload: 'create', x: tapX, y: tapY },
			]
		: null;
	const sequenceEvidence = [];
	let activeSequenceStep = null;
	while (Date.now() < deadline) {
		await delay(2000);
		const fullLog = adb('logcat', '-d', '-v', 'epoch');
		const markerIndex = fullLog.lastIndexOf(measurementMarker);
		// The buffer was cleared at window start, so everything in it postdates
		// the marker. A multi-megabyte ART dump can evict the marker line itself;
		// falling back to the empty string here would discard exactly that
		// evidence and reject an otherwise valid crash sample.
		log = markerIndex === -1 ? fullLog : fullLog.slice(markerIndex);
		parsed = parseLog(log);
		observeParsed(parsed);
		if ((nativeCrashOutcome || capacityOutcome) && parsed.nativeCrashMs !== null) {
			// ART prints the class Summary after the first overflow line. Give the
			// crashing process time to finish that dump before taking the terminal
			// snapshot; stopping at the first JNI line lost precisely this evidence
			// in device round 1 (#194 / #222).
			await delay(3000);
			const fullLog = adb('logcat', '-d', '-v', 'epoch');
			const markerIndex = fullLog.lastIndexOf(measurementMarker);
			log = markerIndex === -1 ? fullLog : fullLog.slice(markerIndex);
			parsed = parseLog(log);
			observeParsed(parsed);
			completed = true;
			break;
		}
		if (interactionSequence !== null) {
			if (
				activeSequenceStep === null &&
				sequenceEvidence.length < interactionSequence.length &&
				(sequenceEvidence.length > 0 ||
					(parsed.firstScreenMs !== null && parsed.loadEndMs !== null))
			) {
				const spec = interactionSequence[sequenceEvidence.length];
				activeSequenceStep = {
					...spec,
					interactionOrdinal: sequenceEvidence.length + 1,
					mainBefore: parsed.main.length,
					nativeBefore: parsed.native.length,
					issuedAtMs: Date.now(),
				};
				adb('shell', 'input', 'tap', String(spec.x), String(spec.y));
				console.log(
					`[issue194] sequence step ${activeSequenceStep.interactionOrdinal}: issued ${spec.workload} tap`,
				);
				continue;
			}
			if (activeSequenceStep !== null) {
				// The device log ring can evict the very large create record while
				// later commits are still running, so array offsets are not stable
				// across snapshots. Version 1 is first-tree adoption; the three
				// serialized interaction commits are therefore versions 2/3/4.
				const main =
					parsed.main.find(
						(entry) => entry.version === activeSequenceStep.interactionOrdinal + 1,
					) ?? null;
				const native =
					parsed.native.find(
						(entry) =>
							entry.interactionOrdinal === activeSequenceStep.interactionOrdinal &&
							entry.workload === activeSequenceStep.workload &&
							entry.scale === scale,
					) ?? null;
				const backgroundRender =
					parsed.bts.find(
						(entry) => entry.root === main?.root && entry.version === main?.version,
					) ?? null;
				const segments = splitCommitSegments(backgroundRender, main, native);
				if (main !== null && native !== null && backgroundRender !== null && segments !== null) {
					sequenceEvidence.push({
						step: activeSequenceStep.interactionOrdinal,
						workload: activeSequenceStep.workload,
						adbInput: {
							x: activeSequenceStep.x,
							y: activeSequenceStep.y,
							issuedAtMs: activeSequenceStep.issuedAtMs,
						},
						attribution: main,
						backgroundRender,
						backgroundSettle: native,
						segments,
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
					? interactionMain.length > 0 && matchingNative
					: mode === 'm15-result'
						? parsed.m15.length > 0
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
	for (const key of ['loadStartMs', 'renderPageMs', 'firstScreenMs', 'loadEndMs']) {
		parsed[key] ??= observedLifecycle[key];
	}
	parsed.engine ??= observedLifecycle.engine;
	parsed.devtoolEnabledEvidence = [
		...new Set([...observedDevtoolEnabledEvidence, ...parsed.devtoolEnabledEvidence]),
	];
	const attribution = createClearRecreate
		? (sequenceEvidence.at(-1)?.attribution ?? null)
		: workload !== null
			? (parsed.main.filter((entry) => entry.version >= 2).at(-1) ?? null)
			: mode === 'm15-result'
				? parsed.m15.length === 0
					? null
					: { ...parsed.m15.at(-1), rows: parsed.m15Rows }
				: mode === 'direct-result'
					? (parsed.direct.at(-1) ?? null)
					: mode === 'first-screen-ready'
						? (parsed.firstScreen.at(-1) ?? null)
						: (parsed.main.at(-1) ?? null);
	const backgroundSettle = createClearRecreate
		? (sequenceEvidence.at(-1)?.backgroundSettle ?? null)
		: workload === null
			? (parsed.native.find((entry) => entry.scale === scale) ?? null)
			: (parsed.native.find((entry) => entry.workload === workload && entry.scale === scale) ??
				null);
	const backgroundRender = createClearRecreate
		? (sequenceEvidence.at(-1)?.backgroundRender ?? null)
		: workload === null || attribution === null
			? null
			: (parsed.bts.find(
					(entry) => entry.root === attribution.root && entry.version === attribution.version,
				) ?? null);
	const segments = createClearRecreate
		? (sequenceEvidence.at(-1)?.segments ?? null)
		: workload === null
			? null
			: splitCommitSegments(backgroundRender, attribution, backgroundSettle);
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
	const [sequenceCreate, sequenceClear, sequenceRecreate] = sequenceEvidence;
	const validSequenceState =
		sequenceEvidence.length === 3 &&
		sequenceCreate.workload === 'create' &&
		sequenceCreate.backgroundSettle?.preState?.rowCount === 0 &&
		sequenceCreate.backgroundSettle?.postState?.rowCount === scale &&
		sequenceClear.workload === 'clear' &&
		sequenceClear.backgroundSettle?.preState?.rowCount === scale &&
		sequenceClear.backgroundSettle?.postState?.rowCount === 0 &&
		sequenceRecreate.workload === 'create' &&
		sequenceRecreate.backgroundSettle?.preState?.rowCount === 0 &&
		sequenceRecreate.backgroundSettle?.postState?.rowCount === scale;
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
			wire.messages.length === wire.wireToBtsMsgs
		);
	});
	const validSequenceSegments = sequenceEvidence.every((entry) => {
		const segments = entry.segments;
		return (
			segments?.boundary === 'tap-to-second-frame-partition-v1' &&
			segments.totalMs === entry.backgroundSettle?.latencyMs &&
			segments.identityMs === segments.totalMs &&
			entry.backgroundRender?.btsRenderMs === segments.btsRenderMs &&
			entry.attribution?.timing?.mtsApplyMs === segments.mtsApplyMs
		);
	});
	const calls = attribution?.calls;
	const validFirstScreenShape =
		calls?.__CreateView?.count === scale + 15 &&
		calls?.__CreateText?.count === scale * 3 + 13 &&
		calls?.__CreateRawText?.count === scale * 3 + 13 &&
		calls?.__AddEvent?.count === scale * 2 + 12 &&
		calls?.__AppendElement?.count === scale * 7 + 41;
	const validM15 =
		attribution?.protocol === 'octane-issue196-m15-lepus-v1' &&
		attribution.reps === 5 &&
		Array.isArray(attribution.series) &&
		attribution.series.length === 5 &&
		Array.isArray(attribution.rows) &&
		attribution.rows.length === 12 &&
		new Set(attribution.rows.map((row) => row.name)).size === 12 &&
		attribution.rows.every(
			(row) =>
				Object.keys(row.samples ?? {}).length === attribution.series.length &&
				Object.values(row.samples ?? {}).every(
					(values) => Array.isArray(values) && values.length === attribution.reps,
				),
		);
	const validState =
		engineOnly ||
		(mode === 'm15-result'
			? validM15
			: createClearRecreate
				? validSequenceState && validSequenceWire && validSequenceSegments
				: mode === 'commit'
					? validBackgroundState && (workload === null || segments !== null)
					: validFirstScreenShape);
	const errors = [...new Set(observedErrors)];
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
		firstScreenShapeEvidence: mode === 'commit' || mode === 'm15-result' ? null : calls,
		m15Evidence: mode === 'm15-result' ? attribution : null,
		backgroundSettle,
		backgroundRender,
		segments,
		sequenceEvidence: createClearRecreate ? sequenceEvidence : null,
		adbInput: createClearRecreate
			? sequenceEvidence.map((entry) => ({ workload: entry.workload, ...entry.adbInput }))
			: workload === null
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
		display:
			'ADB wake + dismiss-keyguard before every sample; stay-on-while-plugged gate required for multi-commit input sequences',
		thermalGate: 'battery <=35.0C and Android thermal status 0 before every accepted attempt',
		ordering:
			cells.length === 1 ? 'single-cell repeated cold launches' : 'AB/BA (A,B,B,A repeating)',
		completionMode: mode,
		workload,
		interactionSequence: createClearRecreate ? ['create', 'clear', 'create'] : null,
		wireBoundary: createClearRecreate
			? 'native ContextProxy encoded payloads; not the Web RPC-envelope aggregate'
			: null,
		segmentBoundary: createClearRecreate
			? 'BTS render = tap handler/render start -> commit encode done; wire = encode done -> MTS after decode; MTS apply = after decode -> Element PAPI flush return; residue = flush return -> second native frame'
			: null,
		adbInput: createClearRecreate
			? [
					{ workload: 'create', command: `adb -s <serial> shell input tap ${tapX} ${tapY}` },
					{
						workload: 'clear',
						command: `adb -s <serial> shell input tap ${clearTapX} ${clearTapY}`,
					},
					{ workload: 'create', command: `adb -s <serial> shell input tap ${tapX} ${tapY}` },
				]
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
		`[issue194] resumed ${report.samples.length}/${samples * cells.length} samples from ${checkpoint}`,
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
		console.log(
			`[issue194] ${ordinal + 1}/${samples * cells.length} ${cell.label} attempt ${attempt}`,
		);
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

if (createClearRecreate) {
	const summarizeStep = (step, workload) => {
		const entries = report.samples.map((sample) => sample.sequenceEvidence[step].segments);
		const summarizeMetric = (name) => {
			const values = entries.map((entry) => entry[name]);
			const sorted = [...values].sort((first, second) => first - second);
			const middle = sorted.length >> 1;
			return {
				values,
				median:
					sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
				min: sorted[0],
				max: sorted.at(-1),
			};
		};
		return {
			workload,
			n: entries.length,
			totalMs: summarizeMetric('totalMs'),
			btsRenderMs: summarizeMetric('btsRenderMs'),
			wireMs: summarizeMetric('wireMs'),
			mtsApplyMs: summarizeMetric('mtsApplyMs'),
			residueToSecondFrameMs: summarizeMetric('residueToSecondFrameMs'),
		};
	};
	report.segmentSummary = {
		boundary: 'tap-to-second-frame-partition-v1',
		create: summarizeStep(0, 'create'),
		clear: summarizeStep(1, 'clear'),
		recreate: summarizeStep(2, 'create'),
	};
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const temporaryOutput = `${output}.tmp`;
fs.writeFileSync(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
fs.renameSync(temporaryOutput, output);
if (checkpoint !== null) fs.rmSync(checkpoint, { force: true });
console.log(`[issue194] wrote ${output}`);
