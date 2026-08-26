import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { defineConfig } from '@lynx-js/rspeedy';
import { pluginOctane } from '@octanejs/rspeedy-plugin';

// BENCH_AUTOROWS=N builds a variant whose table is already populated at mount,
// so create cost is measurable without taps (mount-create ladder).
const autoRows = Number(process.env.BENCH_AUTOROWS ?? '0') || 0;
const autoSuffix = autoRows > 0 ? `-rows${autoRows}` : '';

// OCTANE_LYNX_PROFILE=1 turns on the wire-cost counters in @octanejs/lynx
// (globalThis.__OCTANE_LYNX_PROF on both threads). Off by default so the
// default bundle measures the shipping configuration.
const profile = process.env.OCTANE_LYNX_PROFILE === '1';

/** The Block core's drive modes, spelled once. `scoped` carries no suffix. */
const BLOCK_MODES = new Set(['scoped', 'reconcile', 'derived']);

// BENCH_CORE=block builds the issue-#103 Block background core instead of the
// universal one, and BENCH_BLOCK_MODE picks what drives that core: `scoped` and
// `reconcile` are the hand-written program's two modes (see
// app/src/block-program.ts), and `derived` is the compiled `App` itself, lowered
// onto the core by the framework (issue-#135 item 1b). The main-thread first
// screen is the same program in every case; only the background driver changes.
// BENCH_MTS_PROGRAM=1 hands the compiler issue-#163's main-thread program
// backend, so the main-thread chunk's eligible templates lower to straight-line
// create functions driving the Element PAPI instead of the descriptions an
// interpreter walks per node. The background chunk is untouched by it — that is
// #163's byte-identity promise, and `benchmarks/lynx-bundle-size/core-switch.mjs`
// is where it is asserted rather than assumed.
//
// The backend is TypeScript reaching into the renderer's own run-time lowering,
// which this plain-JavaScript config cannot import unaided: Node strips types by
// itself but will not rewrite an authored `./x.js` specifier to the `./x.ts`
// beside it. `ts-source-resolution.mjs` closes exactly that gap and nothing
// else. Both imports are dynamic and behind the flag, so a default build neither
// registers the hook nor loads a byte of the backend.
//
// BENCH_REPO_ROOT is the repository this config was staged out of: the build
// copies these sources into the Rspeedy plugin's examples directory, so a
// relative path from here would point at the stage rather than the source.
const mtsProgram = process.env.BENCH_MTS_PROGRAM === '1';
const programSuffix = mtsProgram ? '-mtsprogram' : '';
const mainThreadProgramBackend = mtsProgram ? await loadMainThreadProgramBackend() : undefined;

async function loadMainThreadProgramBackend() {
	const repo = process.env.BENCH_REPO_ROOT;
	if (repo === undefined) {
		throw new Error('BENCH_MTS_PROGRAM=1 needs BENCH_REPO_ROOT to locate the compiler backend.');
	}
	const from = (relative) => pathToFileURL(path.join(repo, relative)).href;
	const { registerTypeScriptSourceResolution } = await import(
		from('benchmarks/lynx-bundle-size/ts-source-resolution.mjs')
	);
	registerTypeScriptSourceResolution();
	return await import(from('packages/lynx/src/compiler/index.js'));
}

const core = process.env.BENCH_CORE === 'block' ? 'block' : 'universal';
const blockMode = BLOCK_MODES.has(process.env.BENCH_BLOCK_MODE)
	? process.env.BENCH_BLOCK_MODE
	: 'scoped';
const coreSuffix =
	core === 'block' ? (blockMode === 'scoped' ? '-block' : `-block-${blockMode}`) : '';

export default defineConfig(({ command }) => {
	// BENCH_DEV=1 keeps development diagnostics (transport self-checks, error
	// reporting) in a `rspeedy build` bundle, for debugging the web harness.
	const development = command === 'dev' || process.env.BENCH_DEV === '1';

	return {
		mode: development ? 'development' : 'production',
		environments: {
			lynx: {},
			web: {},
		},
		output: {
			cleanDistPath: true,
			filename: {
				bundle: '[name].[platform].bundle',
			},
			filenameHash: false,
			distPath: {
				root: 'dist' + coreSuffix + programSuffix + autoSuffix + (profile ? '-profile' : ''),
			},
		},
		source: {
			entry: {
				main: './src/index.ts',
			},
			define: {
				__BENCH_AUTOROWS__: JSON.stringify(autoRows),
				__OCTANE_LYNX_PROFILE__: JSON.stringify(profile),
				__BENCH_CORE__: JSON.stringify(core),
				__BENCH_BLOCK_MODE__: JSON.stringify(blockMode),
			},
		},
		splitChunks: false,
		plugins: [
			pluginOctane({
				core,
				dev: development,
				hmr: command === 'dev',
				...(mainThreadProgramBackend === undefined ? null : { mainThreadProgramBackend }),
			}),
		],
	};
});
