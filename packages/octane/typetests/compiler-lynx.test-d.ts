import {
	compile,
	type CompileOptions,
	type CompileRenderer,
	type CompileRendererTarget,
	type CompileResult,
} from 'octane/compiler';
import { octane, type OctaneVitePluginOptions } from 'octane/compiler/vite';

export const target: CompileRendererTarget = 'lynx';
export const renderer = {
	id: 'lynx',
	module: '@example/lynx-renderer',
	target,
	server: 'unsupported',
	text: 'host',
	capabilities: ['compiler-program-ir'],
} satisfies CompileRenderer;
export const compileOptions = {
	hmr: false,
	renderer,
	rendererRegistry: { lynx: renderer },
} satisfies CompileOptions;
export const compiled: CompileResult = compile('', 'src/Scene.lynx.tsrx', compileOptions);

export const viteOptions = {
	hmr: false,
	renderers: {
		registry: {
			lynx: {
				module: '@example/lynx-renderer',
				target: 'lynx',
				server: 'unsupported',
				text: 'host',
				capabilities: ['compiler-program-ir'],
			},
		},
		rules: [{ include: 'src/**/*.lynx.tsrx', renderer: 'lynx' }],
	},
} satisfies OctaneVitePluginOptions;
octane(viteOptions);
