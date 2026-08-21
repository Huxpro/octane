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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { instrumentLynxStageSources } from '../stages/instrument-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '../..');

const STAGE_NAME = 'lynx-table-bench';

/**
 * @param {{silent?: boolean, core?: 'universal'|'block', blockMode?: 'scoped'|'reconcile'}} [options]
 * @returns {string} the staged dist directory
 */
export function buildTableApp({ silent = false, core = 'universal', blockMode = 'scoped' } = {}) {
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

	const autoRows = Number(process.env.BENCH_AUTOROWS ?? '0') || 0;
	const profile = process.env.OCTANE_LYNX_PROFILE === '1';
	const restore = profile ? instrumentLynxStageSources(repo) : () => {};
	// Issue-#103 B0: the background core is a build-time choice, so a second
	// core is a second build of the same sources rather than a second app. The
	// suffix has to be spelled the same here and in app/lynx.config.mjs, which
	// derives its own dist path from the same two variables.
	const coreSuffix =
		core === 'block' ? (blockMode === 'reconcile' ? '-block-reconcile' : '-block') : '';
	const label = core === 'block' ? `octane table app (${core}/${blockMode})` : 'octane table app';
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
			},
		});
	} finally {
		restore();
	}

	const suffix =
		coreSuffix + (autoRows > 0 ? `-rows${autoRows}` : '') + (profile ? '-profile' : '');
	const from = path.join(stage, `dist${suffix}`);
	const to = path.join(src, `dist${suffix}`);
	fs.rmSync(to, { recursive: true, force: true });
	fs.cpSync(from, to, { recursive: true });
	fs.rmSync(stage, { recursive: true, force: true });
	if (!silent) console.log(`[lynx-table] staged bundles → app/dist${suffix}`);
	return to;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	buildTableApp({
		core: process.env.BENCH_CORE === 'block' ? 'block' : 'universal',
		blockMode: process.env.BENCH_BLOCK_MODE === 'reconcile' ? 'reconcile' : 'scoped',
	});
}
