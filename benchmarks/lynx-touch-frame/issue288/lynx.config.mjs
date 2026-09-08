import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, '../../..');
const octaneRoot = path.resolve(process.env.ISSUE288_OCTANE_ROOT ?? repositoryRoot);
const { defineConfig } = await import(
	pathToFileURL(
		path.join(
			octaneRoot,
			'packages/rspeedy-plugin-octane/node_modules/@lynx-js/rspeedy/dist/index.js',
		),
	).href
);
const { pluginOctane } = await import(
	pathToFileURL(path.join(octaneRoot, 'packages/rspeedy-plugin-octane/src/index.js')).href
);
const arm = process.env.ISSUE288_ARM ?? 'candidate';
const rows = Number(process.env.ISSUE288_ROWS ?? '10000');
const depth = Number(process.env.ISSUE288_DEPTH ?? '32');
const profile = process.env.ISSUE288_PROFILE === '1';

if (!/^[a-z0-9][a-z0-9-]*$/.test(arm)) {
	throw new TypeError(`ISSUE288_ARM must be a safe label, received ${JSON.stringify(arm)}.`);
}
if (!Number.isSafeInteger(rows) || rows < 2) {
	throw new TypeError('ISSUE288_ROWS must be an integer >= 2.');
}
if (!Number.isSafeInteger(depth) || depth < 0) {
	throw new TypeError('ISSUE288_DEPTH must be a non-negative integer.');
}

export default defineConfig({
	mode: 'production',
	environments: { lynx: {} },
	output: {
		cleanDistPath: true,
		distPath: { root: `dist/${arm}-rows${rows}-${profile ? 'profile' : 'shipping'}` },
		filename: { bundle: '[name].lynx.bundle' },
		filenameHash: false,
	},
	tools: {
		rspack(config) {
			config.resolve ??= {};
			config.resolve.modules = [
				path.join(octaneRoot, 'packages/rspeedy-plugin-octane/node_modules'),
				'node_modules',
			];
		},
	},
	source: {
		entry: { main: './index.ts' },
		define: {
			__ISSUE288_ARM__: JSON.stringify(arm),
			__ISSUE288_DEPTH__: JSON.stringify(depth),
			__ISSUE288_PROFILE__: JSON.stringify(profile),
			__ISSUE288_ROWS__: JSON.stringify(rows),
			__OCTANE_LYNX_PROFILE__: JSON.stringify(profile),
			__OCTANE_LYNX_TRACE__: JSON.stringify(profile),
			__OCTANE_LYNX_BACKGROUND_CORE__: JSON.stringify('universal'),
		},
	},
	splitChunks: false,
	plugins: [pluginOctane({ core: 'universal', dev: false, hmr: false })],
});
