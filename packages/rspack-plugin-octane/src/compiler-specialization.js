import { normalizeRendererConfig } from 'octane/compiler/renderers';

import { normalizeMainThreadProgramBackend } from './shared.js';

const MODULE_COMPILER_OPTIONS = Symbol.for('octane.rspack.module-compiler-options');

/** Loader-context slot copied through Rspack's parallel-loader boundary. */
export const COMPILER_OPTIONS_CONTEXT_KEY = Symbol.for('octane.rspack.compiler-options-context');

/** Serializable pitch-data key used to hand the specialization to a worker. */
export const COMPILER_OPTIONS_DATA_KEY = '__octaneCompilerOptions';

/**
 * Select compiler options for one NormalModule's next build.
 *
 * This is intentionally narrower than mutating a configured loader rule. A
 * proof-aware framework plugin can specialize only the modules in the proved
 * graph, rebuild them, and leave every conservative or unrelated graph on the
 * original renderer. The normalized renderer config is structured-cloneable,
 * so the same contract works through Rspack's parallel loader.
 */
export function setOctaneRspackModuleCompilerOptions(module, options) {
	if (module === null || typeof module !== 'object') {
		throw new TypeError('@octanejs/rspack-plugin: compiler specialization requires a module.');
	}
	if (options === null || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('@octanejs/rspack-plugin: module compiler options must be an object.');
	}
	for (const key of Object.keys(options)) {
		if (key !== 'renderers' && key !== 'mainThreadProgramBackend') {
			throw new TypeError(`@octanejs/rspack-plugin: unknown module compiler option \`${key}\`.`);
		}
	}
	if (options.renderers === undefined && options.mainThreadProgramBackend === undefined) {
		throw new TypeError(
			'@octanejs/rspack-plugin: module compiler options require `renderers` or `mainThreadProgramBackend`.',
		);
	}
	module[MODULE_COMPILER_OPTIONS] = Object.freeze({
		...(options.renderers === undefined
			? null
			: { renderers: normalizeRendererConfig(options.renderers) }),
		...(options.mainThreadProgramBackend === undefined
			? null
			: {
					mainThreadProgramBackend: normalizeMainThreadProgramBackend(
						options.mainThreadProgramBackend,
						'mainThreadProgramBackend',
					),
				}),
	});
}

/** Read the main-process specialization selected for this module, if any. */
export function getOctaneRspackModuleCompilerOptions(module) {
	return module?.[MODULE_COMPILER_OPTIONS];
}
