import { defineConfig } from '@lynx-js/rspeedy';
import { pluginOctane } from '../../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const papiSource = path.resolve(configDirectory, '../../../lynx/src/core/papi.ts');
const probeLoader = path.resolve(configDirectory, 'src/issue-195-papi-loader.cjs');
const probeSource = path.resolve(configDirectory, 'src/probe-banner.js');

export default defineConfig({
	mode: 'production',
	environments: { lynx: {} },
	output: {
		cleanDistPath: true,
		filename: { bundle: '[name].[platform].bundle' },
		filenameHash: false,
		distPath: { root: 'dist' },
	},
	source: { entry: { main: './src/index.ts' } },
	splitChunks: false,
	tools: {
		rspack: {
			resolve: {
				alias: {
					'@octanejs/lynx': path.resolve(configDirectory, '../../../lynx/src'),
				},
			},
			module: {
				rules: [
					{
						test: /papi\.ts$/,
						include: [papiSource],
						enforce: 'pre',
						use: [{ loader: probeLoader, options: { probeSource } }],
					},
				],
			},
		},
	},
	plugins: [pluginOctane({ core: 'universal', dev: false, hmr: false })],
});
