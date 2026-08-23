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
			distPath: { root: 'dist' + coreSuffix + autoSuffix + (profile ? '-profile' : '') },
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
		plugins: [pluginOctane({ core, dev: development, hmr: command === 'dev' })],
	};
});
