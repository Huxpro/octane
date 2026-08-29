import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '../../../packages/rspeedy-plugin-octane/node_modules/@lynx-js/rspeedy/dist/index.js';
import { pluginOctane } from '../../../packages/rspeedy-plugin-octane/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const topology = process.env.BENCH_TOPOLOGY ?? 'T2';
const load = process.env.BENCH_LOAD ?? 'idle';
const profile = process.env.BENCH_PROFILE === '1';

if (!['T2', 'T3'].includes(topology)) {
	throw new Error(`BENCH_TOPOLOGY must be T2 or T3 (received ${JSON.stringify(topology)})`);
}
if (!['idle', 'sustained-scroll'].includes(load)) {
	throw new Error(`BENCH_LOAD must be idle or sustained-scroll (received ${JSON.stringify(load)})`);
}
if (profile && topology !== 'T2') {
	throw new Error('L2 profile bundles are limited to the shipped T2 topology');
}

export default defineConfig({
	mode: 'production',
	environments: { lynx: {} },
	output: {
		cleanDistPath: false,
		distPath: { root: `dist/${profile ? 'L2-' : ''}${topology}-${load}` },
		filename: { bundle: '[name].lynx.bundle' },
		filenameHash: false,
	},
	tools: {
		rspack(config) {
			config.resolve ??= {};
			config.resolve.modules = [
				path.join(repositoryRoot, 'packages/rspeedy-plugin-octane/node_modules'),
				'node_modules',
			];
		},
	},
	source: {
		entry: {
			'local-toggle': '../fixtures/local-toggle/octane/index.ts',
			'cross-component': '../fixtures/cross-component/octane/index.ts',
			'structural-delete': '../fixtures/structural-delete/octane/index.ts',
		},
		define: {
			__BENCH_TOPOLOGY__: JSON.stringify(topology),
			__BENCH_LOAD__: JSON.stringify(load),
			__BENCH_PROFILE__: JSON.stringify(profile),
			__OCTANE_LYNX_TRACE__: JSON.stringify(profile),
		},
	},
	splitChunks: false,
	plugins: [pluginOctane({ dev: false, hmr: false })],
});
