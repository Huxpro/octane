import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

const here = path.dirname(fileURLToPath(import.meta.url));

const load = process.env.BENCH_LOAD ?? 'idle';
const profile = process.env.BENCH_PROFILE === '1';

if (!['idle', 'sustained-scroll'].includes(load)) {
	throw new Error(`BENCH_LOAD must be idle or sustained-scroll (received ${JSON.stringify(load)})`);
}

export default defineConfig({
	mode: 'production',
	performance: { profile },
	environments: { lynx: {} },
	output: {
		cleanDistPath: true,
		distPath: { root: path.join(here, `dist/${profile ? 'L2-' : ''}T1-${load}`) },
		filename: { bundle: '[name].lynx.bundle' },
		filenameHash: false,
	},
	source: {
		tsconfigPath: 'tsconfig.build.json',
		entry: {
			'local-toggle': path.join(here, '../fixtures/local-toggle/react/index.tsx'),
			'cross-component': path.join(here, '../fixtures/cross-component/react/index.tsx'),
			'structural-delete': path.join(here, '../fixtures/structural-delete/react/index.tsx'),
		},
		define: {
			__BENCH_LOAD__: JSON.stringify(load),
			__BENCH_PROFILE__: JSON.stringify(profile),
		},
	},
	plugins: [pluginReactLynx()],
});
