import type {
	OctaneMainThreadProgramBackend,
	OctaneRspackLoaderOptions,
	OctaneRspackPluginOptions,
} from './index.js';

const loaderOptions: OctaneRspackLoaderOptions = {
	strong: true,
	layerSpecializations: {
		'native:main': {
			renderers: {
				registry: {
					native: {
						module: '@fixture/native-main-renderer',
						capabilities: ['main-thread-render-only'],
						firstScreenEvents: ['bind*', 'catch*'],
					},
				},
				default: 'native',
			},
			universalRuntime: { runtime: 'native', thread: 'main-thread' },
		},
	},
};

const pluginOptions: OctaneRspackPluginOptions = {
	strong: false,
	parallel: { maxWorkers: 2 },
	layerSpecializations: {
		'native:main': {
			runtime: '@fixture/native-main-runtime',
			universalRuntime: { runtime: 'native', thread: 'main-thread' },
		},
	},
};

const serialPluginOptions: OctaneRspackPluginOptions = { parallel: false };

const emitLynxMainThreadProgram = () => ({ source: '', valueCount: 0, eventCount: 0 });
const sharedIRBackend: OctaneMainThreadProgramBackend = {
	signature: 'renderer-program/8',
	deriveLynxProgramIR: () => null,
	emitLynxMainThreadProgram,
};
const legacyBackend: OctaneMainThreadProgramBackend = {
	signature: 'renderer-program/7',
	deriveLynxMainThreadProgram: () => null,
	emitLynxMainThreadProgram,
};
// @ts-expect-error A backend must derive the shared IR or expose the legacy derivation hook.
const missingDerivationBackend: OctaneMainThreadProgramBackend = {
	signature: 'renderer-program/0',
	emitLynxMainThreadProgram,
};

const unsupportedLoaderRuntime: OctaneRspackLoaderOptions = {
	layerSpecializations: {
		'native:main': {
			// @ts-expect-error The standalone loader cannot install an issuer-layer runtime alias.
			runtime: '@fixture/native-main-runtime',
		},
	},
};

const unsupportedLoaderParallel: OctaneRspackLoaderOptions = {
	// @ts-expect-error Worker-pool configuration belongs to the plugin, not the standalone loader.
	parallel: true,
};

void loaderOptions;
void pluginOptions;
void serialPluginOptions;
void sharedIRBackend;
void legacyBackend;
void missingDerivationBackend;
void unsupportedLoaderRuntime;
void unsupportedLoaderParallel;
