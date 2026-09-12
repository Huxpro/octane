import fs from 'node:fs';
import path from 'node:path';

function replaceOnce(source, search, replacement, file) {
	const first = source.indexOf(search);
	if (first === -1) throw new Error(`issue #278 instrument anchor missing in ${file}.`);
	if (source.indexOf(search, first + search.length) !== -1) {
		throw new Error(`issue #278 instrument anchor is ambiguous in ${file}.`);
	}
	return source.slice(0, first) + replacement + source.slice(first + search.length);
}

/**
 * Add attribution-only counters to the codec source for one benchmark build.
 *
 * The authored runtime is restored in `finally` by the caller. The instrument
 * therefore cannot leak into a shipping bundle, and every anchor fails closed
 * when the implementation changes instead of timing a stale approximation.
 */
export function instrumentIssue278NativeSources(repositoryRoot, { codec = true } = {}) {
	const file = path.join(repositoryRoot, 'packages/lynx/src/core/transport-codec.ts');
	const source = fs.readFileSync(file, 'utf8');
	const mainThreadFile = path.join(
		repositoryRoot,
		'packages/lynx/src/main-thread-implementation.ts',
	);
	const mainThreadSource = fs.readFileSync(mainThreadFile, 'utf8');
	const mainThreadEntryFile = path.join(
		repositoryRoot,
		'packages/rspeedy-plugin-octane/src/main-thread-entry.production.js',
	);
	const mainThreadEntrySource = fs.readFileSync(mainThreadEntryFile, 'utf8');
	let instrumented = source;

	try {
		instrumented = replaceOnce(
			instrumented,
			"import { LYNX_DEVELOPMENT } from './environment.js';\n",
			`import { LYNX_DEVELOPMENT } from './environment.js';

declare const __BENCH_ISSUE278_COUNTS__: boolean;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			'function prepare(value: unknown, path: string, state: PrepareState, depth = 0): unknown {\n',
			`function prepare(value: unknown, path: string, state: PrepareState, depth = 0): unknown {
	if (__BENCH_ISSUE278_COUNTS__) issue278CodecProfile().prepareVisits++;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			'function restore(value: unknown, depth = 0): unknown {\n',
			`function restore(value: unknown, depth = 0): unknown {
	if (__BENCH_ISSUE278_COUNTS__) issue278CodecProfile().restoreVisits++;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			'const ALIAS_REPORT_THRESHOLD = 32;\n',
			`const ALIAS_REPORT_THRESHOLD = 32;

interface Issue278CodecProfile {
	encodeCalls: number;
	encodePrepareMs: number;
	encodeStringifyMs: number;
	encodedBytes: number;
	encodeFlags0: number;
	encodeFlags1: number;
	decodeCalls: number;
	decodeParseMs: number;
	decodeRestoreMs: number;
	decodeFlags0: number;
	decodeFlags1: number;
	prepareVisits: number;
	restoreVisits: number;
	aliases: number;
	localizeCalls: number;
	localizeMs: number;
	commandOps: Record<string, number>;
}

type Issue278CodecGlobals = typeof globalThis & {
	__ISSUE278_CODEC_PROFILE__?: Issue278CodecProfile;
	__OCTANE_LYNX_PROF?: Record<string, unknown>;
	__ISSUE278_COMMIT_TIMELINE__?: Record<string, number>;
	__ISSUE278_COMMIT_SNAPSHOT__?: unknown;
};

function issue278CodecProfile(): Issue278CodecProfile {
	const target = globalThis as Issue278CodecGlobals;
	return (target.__ISSUE278_CODEC_PROFILE__ ??= {
		encodeCalls: 0,
		encodePrepareMs: 0,
		encodeStringifyMs: 0,
		encodedBytes: 0,
		encodeFlags0: 0,
		encodeFlags1: 0,
		decodeCalls: 0,
		decodeParseMs: 0,
		decodeRestoreMs: 0,
		decodeFlags0: 0,
		decodeFlags1: 0,
		prepareVisits: 0,
		restoreVisits: 0,
		aliases: 0,
		localizeCalls: 0,
		localizeMs: 0,
		commandOps: {},
	});
}

function issue278RecordCommandOps(value: LynxValue, profile: Issue278CodecProfile): void {
	const message = value as { type?: unknown; batch?: { commands?: readonly unknown[] } };
	if (message.type !== 'commit' || !Array.isArray(message.batch?.commands)) return;
	for (const raw of message.batch.commands) {
		const op = (raw as { op?: unknown }).op;
		const name = typeof op === 'string' ? op : '<missing-op>';
		profile.commandOps[name] = (profile.commandOps[name] ?? 0) + 1;
	}
}

function issue278ResetProfileRecord(raw: Record<string, unknown> | undefined): void {
	if (raw === undefined) return;
	for (const name of Object.keys(raw)) {
		if (typeof raw[name] === 'number') raw[name] = 0;
		else if (raw[name] !== null && typeof raw[name] === 'object') raw[name] = {};
	}
}

function issue278BeginCommit(profile: Issue278CodecProfile): void {
	const target = globalThis as Issue278CodecGlobals;
	issue278ResetProfileRecord(profile as unknown as Record<string, unknown>);
	issue278ResetProfileRecord(target.__OCTANE_LYNX_PROF);
	target.__ISSUE278_COMMIT_TIMELINE__ = { receivedAtMs: Date.now() };
	delete target.__ISSUE278_COMMIT_SNAPSHOT__;
}

function issue278MarkDecoded(commit: boolean): void {
	if (!commit) return;
	const timeline = (globalThis as Issue278CodecGlobals).__ISSUE278_COMMIT_TIMELINE__;
	if (timeline !== undefined) timeline.decodedAtMs = Date.now();
}
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			`	const state: PrepareState = {
		escaped: false,
		seen: LYNX_DEVELOPMENT ? new Map<object, number>() : null,
		aliases: 0,
	};
	const payload = prepare(value, '$', state);
`,
			`	const state: PrepareState = {
		escaped: false,
		seen:
			__BENCH_ISSUE278_COUNTS__ || LYNX_DEVELOPMENT
				? new Map<object, number>()
				: null,
		aliases: 0,
	};
	const profile = issue278CodecProfile();
	const startedPrepare = performance.now();
	const payload = prepare(value, '$', state);
	profile.encodePrepareMs += performance.now() - startedPrepare;
	profile.encodeCalls++;
	profile.aliases += state.aliases;
	if (state.escaped) profile.encodeFlags1++;
	else profile.encodeFlags0++;
	issue278RecordCommandOps(value, profile);
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			'\treturn JSON.stringify([state.escaped ? 1 : 0, payload]);\n',
			`	const startedStringify = performance.now();
	const encoded = JSON.stringify([state.escaped ? 1 : 0, payload]);
	profile.encodeStringifyMs += performance.now() - startedStringify;
	profile.encodedBytes += encoded.length;
	return encoded;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			`	let envelope: unknown;
	try {
		envelope = JSON.parse(text) as unknown;
	} catch (error) {
`,
			`	const profile = issue278CodecProfile();
	const issue278Commit = text.includes('"type":"commit"');
	if (issue278Commit) issue278BeginCommit(profile);
	const startedParse = performance.now();
	let envelope: unknown;
	try {
		envelope = JSON.parse(text) as unknown;
		profile.decodeParseMs += performance.now() - startedParse;
	} catch (error) {
		profile.decodeParseMs += performance.now() - startedParse;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			'\treturn flags === 0 ? envelope[1] : restore(envelope[1]);\n',
			`	profile.decodeCalls++;
	if (flags === 0) {
		profile.decodeFlags0++;
		issue278MarkDecoded(issue278Commit);
		return envelope[1];
	}
	profile.decodeFlags1++;
	const startedRestore = performance.now();
	const restored = restore(envelope[1]);
	profile.decodeRestoreMs += performance.now() - startedRestore;
	issue278MarkDecoded(issue278Commit);
	return restored;
`,
			file,
		);
		instrumented = replaceOnce(
			instrumented,
			`export function localizeLynxHostValue(value: LynxValue): LynxStructuredValue {
	return decodeLynxTransportValue(encodeLynxTransportValue(value));
}
`,
			`export function localizeLynxHostValue(value: LynxValue): LynxStructuredValue {
	const profile = issue278CodecProfile();
	const started = performance.now();
	try {
		return decodeLynxTransportValue(encodeLynxTransportValue(value));
	} finally {
		profile.localizeCalls++;
		profile.localizeMs += performance.now() - started;
	}
}
`,
			file,
		);
		let mainThreadInstrumented = mainThreadSource;
		if (codec) {
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				"type LynxCommitMessage = Extract<LynxBackgroundOutboundMessage, { type: 'commit' }>;",
				`type LynxCommitMessage = Extract<LynxBackgroundOutboundMessage, { type: 'commit' }>;

function issue278CopyProfile(
	raw: Record<string, unknown> | undefined,
): Record<string, number | Record<string, number>> | null {
	if (raw === undefined) return null;
	const copy: Record<string, number | Record<string, number>> = {};
	for (const name of Object.keys(raw)) {
		const value = raw[name];
		if (typeof value === 'number') copy[name] = value;
		else if (value !== null && typeof value === 'object') {
			const nested: Record<string, number> = {};
			for (const key of Object.keys(value)) {
				const count = (value as Record<string, unknown>)[key];
				if (typeof count === 'number') nested[key] = count;
			}
			copy[name] = nested;
		}
	}
	return copy;
}

function issue278CaptureCommitSnapshot(): void {
	const target = globalThis as typeof globalThis & {
		__OCTANE_LYNX_PROF?: Record<string, unknown>;
		__ISSUE278_CODEC_PROFILE__?: Record<string, unknown>;
		__ISSUE278_COMMIT_TIMELINE__?: Record<string, number>;
		__ISSUE278_COMMIT_SNAPSHOT__?: unknown;
	};
	target.__ISSUE278_COMMIT_SNAPSHOT__ = {
		atMs: Date.now(),
		profile: issue278CopyProfile(target.__OCTANE_LYNX_PROF),
		codecProfile: issue278CopyProfile(target.__ISSUE278_CODEC_PROFILE__),
		timeline:
			target.__ISSUE278_COMMIT_TIMELINE__ === undefined
				? null
				: { ...target.__ISSUE278_COMMIT_TIMELINE__ },
	};
}

function issue278MarkCommitTimeline(name: string): void {
	const target = globalThis as typeof globalThis & {
		__ISSUE278_COMMIT_TIMELINE__?: Record<string, number>;
	};
	const timeline = target.__ISSUE278_COMMIT_TIMELINE__;
	if (timeline !== undefined) timeline[name] = Date.now();
}
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\t\tmessage = validateBackgroundOutbound(data, residentRunProgram);
\t\t\tif (LYNX_PROFILE) lynxWireProfile().validateMs += performance.now() - startedValidate;
`,
				`\t\t\tmessage = validateBackgroundOutbound(data, residentRunProgram);
\t\t\tif (LYNX_PROFILE) lynxWireProfile().validateMs += performance.now() - startedValidate;
\t\t\tif (message.type === 'commit') issue278MarkCommitTimeline('validatedAtMs');
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\tif (provisional) active = record;
\t\tif (LYNX_PROFILE) {
`,
				`\t\tissue278MarkCommitTimeline('preparedAtMs');
\t\tif (provisional) active = record;
\t\tif (LYNX_PROFILE) {
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\tlet applyFailed = false;
\t\tlet applyError: unknown;
\t\tconst startedApply = LYNX_PROFILE ? performance.now() : 0;
`,
				`\t\tlet applyFailed = false;
\t\tlet applyError: unknown;
\t\tissue278MarkCommitTimeline('applyStartedAtMs');
\t\tconst startedApply = LYNX_PROFILE ? performance.now() : 0;
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\tif (LYNX_PROFILE) lynxWireProfile().applyMs += performance.now() - startedApply;
\t\tif (!prepared.mutationStarted) {
`,
				`\t\tif (LYNX_PROFILE) lynxWireProfile().applyMs += performance.now() - startedApply;
\t\tissue278MarkCommitTimeline('appliedAtMs');
\t\tif (!prepared.mutationStarted) {
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\tconst startedAck = LYNX_PROFILE ? performance.now() : 0;
`,
				`\t\tissue278MarkCommitTimeline('ackStartedAtMs');
\t\tconst startedAck = LYNX_PROFILE ? performance.now() : 0;
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\t\tdispatch(acknowledgement);
\t\t\tif (LYNX_PROFILE) lynxWireProfile().ackMs += performance.now() - startedAck;
`,
				`\t\t\tdispatch(acknowledgement);
\t\t\tif (LYNX_PROFILE) lynxWireProfile().ackMs += performance.now() - startedAck;
\t\t\tissue278MarkCommitTimeline('ackDispatchedAtMs');
`,
				mainThreadFile,
			);
			mainThreadInstrumented = replaceOnce(
				mainThreadInstrumented,
				`\t\t\t\tdispatch({ ...identity, type: 'complete' });
				if (awaitingAdoption === null) drainNativeEvents();
`,
				`\t\t\t\tdispatch({ ...identity, type: 'complete' });
				issue278MarkCommitTimeline('completedAtMs');
				issue278CaptureCommitSnapshot();
				if (awaitingAdoption === null) drainNativeEvents();
`,
				mainThreadFile,
			);
		}
		let mainThreadEntryInstrumented = replaceOnce(
			mainThreadEntrySource,
			"import { installLynxProductApplicationMainThread } from '@octanejs/lynx/main-thread-product-application';",
			"import { installLynxMainThread } from '@octanejs/lynx/main-thread';",
			mainThreadEntryFile,
		);
		mainThreadEntryInstrumented = replaceOnce(
			mainThreadEntryInstrumented,
			'installLynxProductApplicationMainThread({\n\tfirstScreen: true,\n',
			`installLynxMainThread({
	firstScreen: true,
	validation: __BENCH_ISSUE278_VALIDATION__,
`,
			mainThreadEntryFile,
		);
		if (codec) fs.writeFileSync(file, instrumented);
		if (codec) fs.writeFileSync(mainThreadFile, mainThreadInstrumented);
		fs.writeFileSync(mainThreadEntryFile, mainThreadEntryInstrumented);
	} catch (error) {
		fs.writeFileSync(file, source);
		fs.writeFileSync(mainThreadFile, mainThreadSource);
		fs.writeFileSync(mainThreadEntryFile, mainThreadEntrySource);
		throw error;
	}

	return () => {
		fs.writeFileSync(file, source);
		fs.writeFileSync(mainThreadFile, mainThreadSource);
		fs.writeFileSync(mainThreadEntryFile, mainThreadEntrySource);
	};
}
