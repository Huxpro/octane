import fs from 'node:fs';
import path from 'node:path';

import { instrumentLynxStageSources } from '../instrument-source.mjs';

function replaceOnce(source, search, replacement, file) {
	const index = source.indexOf(search);
	if (index === -1) throw new Error(`Q2 instrument anchor missing in ${file}.`);
	if (source.indexOf(search, index + search.length) !== -1) {
		throw new Error(`Q2 instrument anchor is ambiguous in ${file}.`);
	}
	return source.slice(0, index) + replacement + source.slice(index + search.length);
}

export function instrumentLepusQ2Sources(repositoryRoot) {
	const expectedRows = Number(process.env.BENCH_AUTOROWS ?? '0');
	const arm = process.env.BENCH_MTS_PROGRAM === '1' ? 'program' : 'template';
	if (!Number.isSafeInteger(expectedRows) || expectedRows < 1) {
		throw new Error('Q2 instrumentation requires a positive BENCH_AUTOROWS.');
	}
	const restoreStage = instrumentLynxStageSources(repositoryRoot);
	const originals = new Map();
	const update = (relative, transform) => {
		const file = path.join(repositoryRoot, relative);
		const source = fs.readFileSync(file, 'utf8');
		originals.set(file, source);
		fs.writeFileSync(file, transform(source, relative));
	};

	try {
		update('packages/rspeedy-plugin-octane/src/main-thread-entry.js', (source, file) =>
			replaceOnce(
				source,
				'// Lynx invokes this framework hook before dispatching its public render/update\n',
				`// LepusNG 2.3 has Date.now() but no Web Performance API. The Q2
// instrument uses this monotonic-enough 1 ms clock consistently in both arms.
if (typeof globalThis.performance === 'undefined') {
\tglobalThis.performance = { now: Date.now, timeOrigin: 0 };
}
// Lynx invokes this framework hook before dispatching its public render/update
`,
				file,
			),
		);

		update('packages/lynx/src/core/profiling.ts', (source, file) => {
			const next = replaceOnce(
				source,
				'\tpapiCreateMs?: number;\n',
				`\tpapiCreateMs?: number;
\tq2PapiCalls?: number;
\tq2PapiHostMs?: number;
\tq2PapiCounts?: Record<string, number>;
\tq2ProgramCreateInclusiveMs?: number;
\tq2ProgramCreateSelfMs?: number;
\tq2ProgramNodes?: number;
`,
				file,
			);
			return replaceOnce(
				next,
				`}\n\n/**
 * Count one outbound message; commits also add commands and wire bytes.
`,
				`}\n\nexport const LEPUS_Q2_EXPECTED_PROGRAM_NODES = ${expectedRows * 5 + 41};
let lepusQ2Emitted = false;

export function emitLepusQ2Sample(boundary: 'template' | 'program'): void {
\tconst globals = globalThis as {
\t\t__lepus_version__?: unknown;
\t};
\tif (${JSON.stringify(arm)} !== boundary || lepusQ2Emitted) return;
\tlepusQ2Emitted = true;
\tlet lepusVersion = 'unavailable';
\ttry {
\t\tconst version = globals.__lepus_version__;
\t\tlepusVersion = String(typeof version === 'function' ? version() : version);
\t} catch (error) {
\t\tlepusVersion = 'error:' + String(error);
\t}
\tconsole.info(
\t\t'__OCTANE_LEPUS_Q2__' +
\t\t\tJSON.stringify({ type: 'sample', boundary, lepusVersion, profile: lynxWireProfile() }),
\t);
\tthrow new Error('__OCTANE_LEPUS_Q2_STOP__');
}

/**
 * Count one outbound message; commits also add commands and wire bytes.
`,
				file,
			);
		});

		update('packages/lynx/src/core/host-driver.ts', (source, file) => {
			let next = replaceOnce(
				source,
				"import { LYNX_RENDERER_ID } from './renderer-id.js';\n",
				`import { LYNX_RENDERER_ID } from './renderer-id.js';
import {
\temitLepusQ2Sample,
\tLEPUS_Q2_EXPECTED_PROGRAM_NODES,
\tlynxWireProfile,
} from './profiling.js';
`,
				file,
			);
			next = replaceOnce(
				next,
				`\tconst boundPrograms = new Map<UniversalProgramPlan, (...args: unknown[]) => readonly unknown[]>();
`,
				`\tconst q2Sentinel = papi.createElement('view', container.pageComponentUniqueId);
\tconst q2Primitive = (kind: string): void => {
\t\tconst profile = lynxWireProfile();
\t\tprofile.q2PapiCalls = (profile.q2PapiCalls ?? 0) + 1;
\t\tconst counts = (profile.q2PapiCounts ??= {});
\t\tcounts[kind] = (counts[kind] ?? 0) + 1;
\t};
\tconst q2NumericCrossing = (kind: string): void => {
\t\tq2Primitive(kind);
\t\tpapi.getUniqueId(q2Sentinel);
\t};
\tconst q2StringCrossing = (kind: string, value: string): void => {
\t\tq2Primitive(kind);
\t\tpapi.setAttribute(q2Sentinel, 'data-octane-q2', value);
\t};
\tconst q2ProgramPapi: LynxElementPAPI<Node> = Object.freeze({
\t\t...papi,
\t\tintrinsics: Object.freeze({
\t\t\tview() {
\t\t\t\tq2NumericCrossing('factory-number');
\t\t\t\treturn q2Sentinel;
\t\t\t},
\t\t\ttext() {
\t\t\t\tq2NumericCrossing('factory-number');
\t\t\t\treturn q2Sentinel;
\t\t\t},
\t\t\trawText(value: string) {
\t\t\t\tq2StringCrossing('factory-string', value);
\t\t\t\treturn q2Sentinel;
\t\t\t},
\t\t}),
\t\tappend() {
\t\t\tq2NumericCrossing('append');
\t\t},
\t\tsetClasses(_node: Node, value: string) {
\t\t\tq2StringCrossing('set-classes', value);
\t\t},
\t\tsetEvent(_node: Node, _kind: string, name: string) {
\t\t\tq2StringCrossing('set-event', name);
\t\t},
\t\tsetId(_node: Node, value: string | null) {
\t\t\tq2StringCrossing('set-id', value ?? '');
\t\t},
\t});
\tconst boundPrograms = new Map<UniversalProgramPlan, (...args: unknown[]) => readonly unknown[]>();
`,
				file,
			);
			next = replaceOnce(
				next,
				'bound = plan.bind(papi);',
				'bound = plan.bind(q2ProgramPapi);',
				file,
			);
			next = replaceOnce(
				next,
				`\t\tconst created = bound(...args);
`,
				`\t\tconst q2Profile = lynxWireProfile();
\t\tconst q2Started = performance.now();
\t\tconst created = bound(...args);
\t\tconst q2Elapsed = performance.now() - q2Started;
\t\tq2Profile.q2ProgramCreateInclusiveMs =
\t\t\t(q2Profile.q2ProgramCreateInclusiveMs ?? 0) + q2Elapsed;
\t\tq2Profile.q2ProgramCreateSelfMs =
\t\t\t(q2Profile.q2ProgramCreateSelfMs ?? 0) + q2Elapsed;
\t\tq2Profile.q2ProgramNodes = (q2Profile.q2ProgramNodes ?? 0) + plan.nodes;
\t\tif (q2Profile.q2ProgramNodes >= LEPUS_Q2_EXPECTED_PROGRAM_NODES) {
\t\t\temitLepusQ2Sample('program');
\t\t}
`,
				file,
			);
			return next;
		});

		update('packages/lynx/src/main-renderer.ts', (source, file) => {
			let next = replaceOnce(
				source,
				"import { lynxWireProfile } from './core/profiling.js';\n",
				"import { emitLepusQ2Sample, lynxWireProfile } from './core/profiling.js';\n",
				file,
			);
			next = replaceOnce(
				next,
				`\t\t\t\tprofile.firstScreenPlanMs =
\t\t\t\t\t(profile.firstScreenPlanMs ?? 0) + performance.now() - startedPlan;
`,
				`\t\t\t\tprofile.firstScreenPlanMs =
\t\t\t\t\t(profile.firstScreenPlanMs ?? 0) + performance.now() - startedPlan;
\t\t\t\temitLepusQ2Sample('template');
`,
				file,
			);
			return next;
		});
	} catch (error) {
		for (const [file, source] of originals) fs.writeFileSync(file, source);
		restoreStage();
		throw error;
	}

	return () => {
		for (const [file, source] of originals) fs.writeFileSync(file, source);
		restoreStage();
	};
}
