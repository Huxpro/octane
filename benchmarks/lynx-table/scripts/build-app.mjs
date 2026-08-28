// Build the table app's Lynx bundles with the repo's own Rspeedy toolchain.
//
// The app sources are staged into packages/rspeedy-plugin-octane/examples so
// `@octanejs/lynx`, `octane`, and the @lynx-js build plugins all resolve
// through that package's installed dependencies, then `rspeedy build` emits
// `main.lynx.bundle` + `main.web.bundle` into benchmarks/lynx-table/app/dist.
//
//   node scripts/build-app.mjs
//   OCTANE_LYNX_PROFILE=1 node scripts/build-app.mjs   # wire-counter build
//   BENCH_AUTOROWS=1000 node scripts/build-app.mjs     # pre-populated table
//   BENCH_CORE=block node scripts/build-app.mjs        # issue-#103 Block core
//   BENCH_CORE=block BENCH_BLOCK_MODE=derived node scripts/build-app.mjs
//                                                     # …driven by the compiled app
//   BENCH_MTS_PROGRAM=1 node scripts/build-app.mjs    # issue-#163 main-thread programs
//   BENCH_DEVICE_MESSAGECHANNEL_FALLBACK=1 node scripts/build-app.mjs
//                                                     # SDK 4.0 device has no MessageChannel
//   BENCH_DISABLE_DEVTOOL=1 node scripts/build-app.mjs # device preflight bundle
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { instrumentLynxStageSources } from '../stages/instrument-source.mjs';
import { instrumentIssue194NativeSources } from '../stages/issue194-native-instrument.mjs';
import { instrumentLepusQ2Sources } from '../stages/lepus-cost/instrument-q2-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');

const STAGE_NAME = 'lynx-table-bench';

/** The Block core's drive modes, as app/lynx.config.mjs spells them. */
const BLOCK_MODES = new Set(['scoped', 'reconcile', 'derived']);

/**
 * @param {{silent?: boolean, core?: 'universal'|'block', blockMode?: 'scoped'|'reconcile'|'derived', mtsProgram?: boolean}} [options]
 * @returns {string} the staged dist directory
 */
/**
 * The dist tag, validated rather than interpolated.
 *
 * It becomes a directory name and it is spelled identically here and in
 * `app/lynx.config.mjs`, so an unconstrained value would either escape the
 * bench directory or make the two spellings disagree and leave the build
 * copying from a path nothing wrote.
 */
export function tagFrom(value) {
	if (value === undefined || value === '') return '';
	if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
		throw new TypeError(
			`BENCH_DIST_TAG must be lowercase alphanumeric with dashes, received ${JSON.stringify(value)}.`,
		);
	}
	return `-${value}`;
}

export function buildTableApp({
	silent = false,
	core = 'universal',
	blockMode = 'scoped',
	mtsProgram = false,
} = {}) {
	const pluginDir = path.join(repo, 'packages/rspeedy-plugin-octane');
	const src = path.join(root, 'app');
	const stage = path.join(pluginDir, 'examples', STAGE_NAME);
	fs.rmSync(stage, { recursive: true, force: true });
	fs.mkdirSync(path.join(stage, 'src'), { recursive: true });
	for (const file of ['lynx.config.mjs', 'tsconfig.json']) {
		fs.copyFileSync(path.join(src, file), path.join(stage, file));
	}
	for (const file of fs.readdirSync(path.join(src, 'src'))) {
		fs.copyFileSync(path.join(src, 'src', file), path.join(stage, 'src', file));
	}
	if (process.env.BENCH_DISABLE_DEVTOOL === '1') {
		const appFile = path.join(stage, 'src', 'App.lynx.tsrx');
		const source = fs.readFileSync(appFile, 'utf8');
		const anchor = "import type { RowData } from './data.js';";
		if (source.indexOf(anchor) === -1 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
			throw new Error('DevTool preflight anchor is missing or ambiguous.');
		}
		fs.writeFileSync(
			appFile,
			source
				.replace(
					anchor,
					`${anchor}\n\nfunction disableDevTool(): void {\n\t'background only';\n\tNativeModules.LynxDevToolSetModule.switchLynxDebug(false);\n\tconsole.log('__OCTANE_DEVTOOL_DISABLED__=true');\n}`,
				)
				.replace('export function App() @{', 'export function App() @{\n\tdisableDevTool();'),
		);
	}
	if (process.env.BENCH_DEVICE_MESSAGECHANNEL_FALLBACK === '1') {
		const appFile = path.join(stage, 'src', 'App.lynx.tsrx');
		const source = fs.readFileSync(appFile, 'utf8');
		const anchor = 'const _stormChannel = new MessageChannel();';
		if (source.indexOf(anchor) === -1 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
			throw new Error('device MessageChannel fallback anchor is missing or ambiguous.');
		}
		fs.writeFileSync(
			appFile,
			source.replace(
				anchor,
				`const _stormChannel =
	typeof MessageChannel === 'undefined'
		? ({ port1: { onmessage: null }, port2: { postMessage() {} } } as unknown as MessageChannel)
		: new MessageChannel();`,
			),
		);
	}

	const autoRows = Number(process.env.BENCH_AUTOROWS ?? '0') || 0;
	const profile = process.env.OCTANE_LYNX_PROFILE === '1';
	const q2Profile = process.env.LEPUS_Q2_PROFILE === '1';
	if (q2Profile && !profile) throw new Error('LEPUS_Q2_PROFILE requires OCTANE_LYNX_PROFILE=1.');
	const restore = q2Profile
		? instrumentLepusQ2Sources(repo)
		: profile
			? instrumentLynxStageSources(repo)
			: () => {};
	const issue194Native = process.env.BENCH_ISSUE194_NATIVE === '1';
	const issue194DirectOnly = process.env.BENCH_ISSUE194_DIRECT_ONLY === '1';
	const appendOrder = process.env.BENCH_MTS_APPEND_ORDER ?? 'parent-first';
	let restoreIssue194 = () => {};
	try {
		if (issue194Native) {
			restoreIssue194 = instrumentIssue194NativeSources(repo, stage, {
				appendOrder,
				directOnly: issue194DirectOnly,
			});
		}
	} catch (error) {
		restore();
		fs.rmSync(stage, { recursive: true, force: true });
		throw error;
	}
	// Issue-#103 B0: the background core is a build-time choice, so a second
	// core is a second build of the same sources rather than a second app. The
	// suffix has to be spelled the same here and in app/lynx.config.mjs, which
	// derives its own dist path from the same two variables.
	const coreSuffix =
		core === 'block' ? (blockMode === 'scoped' ? '-block' : `-block-${blockMode}`) : '';
	// Issue-#163 C1d/C4b: the main-thread program backend is the other build-time
	// switch, and it is orthogonal to the core — it moves the main-thread chunk
	// and leaves the background one byte-identical. A second suffix rather than a
	// second core, for the same reason: one bundle, one setting of each switch.
	const programSuffix = mtsProgram ? '-mtsprogram' : '';
	// Issue-#163 C8: a tag that changes nothing about what is built and only
	// where it lands, so one configuration can be built twice from two revisions
	// of the compiler and both bundles exist in one measurement window. That is
	// the only way an A/B of emitted output is a within-window comparison rather
	// than two runs compared across hosts and hours, which this harness does not
	// certify. It is deliberately not a build switch: nothing reads it but the
	// path, so a tagged bundle is byte-identical to the untagged one built from
	// the same source.
	const distTag = tagFrom(process.env.BENCH_DIST_TAG);
	const label =
		(core === 'block' ? `octane table app (${core}/${blockMode})` : 'octane table app') +
		(mtsProgram ? ' +mts-program' : '');
	if (!silent) console.log(`[lynx-table] building ${label} (production)…`);
	try {
		execFileSync('npx', ['rspeedy', 'build', '--root', `examples/${STAGE_NAME}`], {
			cwd: pluginDir,
			stdio: silent ? 'pipe' : 'inherit',
			env: {
				...process.env,
				NODE_ENV: 'production',
				BENCH_CORE: core,
				BENCH_BLOCK_MODE: blockMode,
				BENCH_MTS_PROGRAM: mtsProgram ? '1' : '0',
				// The staged config lives under the Rspeedy plugin, so it cannot reach
				// the backend by a path relative to itself. This is where it came from.
				BENCH_REPO_ROOT: repo,
			},
		});
	} finally {
		restoreIssue194();
		restore();
	}

	const suffix =
		coreSuffix +
		programSuffix +
		distTag +
		(autoRows > 0 ? `-rows${autoRows}` : '') +
		(profile ? '-profile' : '');
	const from = path.join(stage, `dist${suffix}`);
	const outputSuffix =
		suffix +
		(issue194Native ? `-issue194-${appendOrder}${issue194DirectOnly ? '-direct-only' : ''}` : '');
	const to = path.join(src, `dist${outputSuffix}`);
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, { recursive: true });
	fs.rmSync(stage, { recursive: true, force: true });
	if (!silent) console.log(`[lynx-table] staged bundles → app/dist${outputSuffix}`);
	return to;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	buildTableApp({
		core: process.env.BENCH_CORE === 'block' ? 'block' : 'universal',
		blockMode: BLOCK_MODES.has(process.env.BENCH_BLOCK_MODE)
			? /** @type {'scoped'|'reconcile'|'derived'} */ (process.env.BENCH_BLOCK_MODE)
			: 'scoped',
		mtsProgram: process.env.BENCH_MTS_PROGRAM === '1',
	});
}
