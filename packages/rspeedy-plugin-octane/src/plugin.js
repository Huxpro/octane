import { resolve } from 'node:path';

import {
	lynxRspeedyBackgroundRenderers,
	lynxRspeedyMainThreadRenderers,
} from '@octanejs/lynx/config';
import { OctaneRspackPlugin } from '@octanejs/rspack-plugin';

import {
	applyLynxApplication,
	applyLynxBackgroundCore,
	exposeLynxTemplatePlugin,
} from './application.js';
import { configureLynxCSS } from './css.js';
import {
	applyLynxEntryLayer,
	LYNX_MAIN_THREAD_LAYER,
	LYNX_MAIN_THREAD_RUNTIME,
	resolveLynxLayer,
} from './layers.js';
import { assertLynxToolchain } from './toolchain.js';

const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const MAIN_THREAD_FACADE_PLUGIN = `${PLUGIN_NAME}:main-thread-facade`;
const LYNX_PACKAGE_ROOT = /^@octanejs\/lynx$/;
/**
 * What the main-thread layer compiles differently from the background one.
 *
 * `mainThreadProgramBackend` is issue #163's addition and is the caller's to
 * supply, not this plugin's to import. The backend is TypeScript that reaches
 * into the renderer's run-time lowering (see `@octanejs/lynx/compiler`), and
 * this module is plain JavaScript loaded by the bundler's Node process, which
 * cannot import it. A build whose config loader handles TypeScript — Rspeedy's
 * own `lynx.config.ts`, or a test — imports it there and passes it in.
 */
function applicationLayerSpecializations(mainThreadProgramBackend) {
	return Object.freeze({
		[LYNX_MAIN_THREAD_LAYER]: Object.freeze({
			renderers: lynxRspeedyMainThreadRenderers,
			runtime: '@octanejs/lynx/main-renderer',
			universalRuntime: LYNX_MAIN_THREAD_RUNTIME,
			...(mainThreadProgramBackend === undefined ? null : { mainThreadProgramBackend }),
		}),
	});
}

class LynxMainThreadFacadePlugin {
	apply(compiler) {
		const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
		if (typeof NormalModuleReplacementPlugin !== 'function') {
			throw new TypeError(
				`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
			);
		}
		new NormalModuleReplacementPlugin(LYNX_PACKAGE_ROOT, (resource) => {
			if (resource.contextInfo?.issuerLayer === LYNX_MAIN_THREAD_LAYER) {
				resource.request = '@octanejs/lynx/first-screen';
			}
		}).apply(compiler);
	}
}

function normalizeStringArray(value, name) {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new TypeError(`${PLUGIN_NAME}: \`${name}\` must be an array of strings.`);
	}
	return Object.freeze([...new Set(value)]);
}

function normalizeOptions(value) {
	const options = value ?? {};
	if (options === null || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError(`${PLUGIN_NAME}: options must be an object.`);
	}
	const allowed = new Set([
		'core',
		'dev',
		'environments',
		'exclude',
		'hmr',
		'mainThreadProgramBackend',
		'parallel',
		'programAddressing',
		'profile',
		'requireDirective',
		'thread',
	]);
	for (const key of Object.keys(options)) {
		if (!allowed.has(key)) throw new TypeError(`${PLUGIN_NAME}: unknown option \`${key}\`.`);
	}
	if (options.core !== undefined && options.core !== 'universal' && options.core !== 'block') {
		throw new TypeError(`${PLUGIN_NAME}: \`core\` must be 'universal' or 'block'.`);
	}
	for (const key of ['dev', 'hmr', 'profile', 'programAddressing', 'requireDirective']) {
		if (options[key] !== undefined && typeof options[key] !== 'boolean') {
			throw new TypeError(`${PLUGIN_NAME}: \`${key}\` must be a boolean.`);
		}
	}
	const application = options.thread === undefined;
	const thread = options.thread ?? 'background';
	const layer = resolveLynxLayer(thread);
	// Issue #246 §6.3. An address is positional, so it is only sound when one
	// configuration sees both compiles of a module and can fail the build when
	// they disagree about its plan order. An isolated `thread` graph is one
	// compile: there is nothing to cross-check against, and a chunk built that
	// way holds no programs for an address to resolve to. So the refusal is
	// here, at the configuration, rather than as a mount that finds nothing.
	if (!application && options.programAddressing === true) {
		throw new TypeError(
			`${PLUGIN_NAME}: \`programAddressing\` requires the two-layer application build. ` +
				`An isolated \`thread: '${thread}'\` graph compiles one thread, so nothing can ` +
				"check that the two agree about a module's plan order, and its chunk holds no " +
				'compiled programs for an address to name.',
		);
	}
	// On by default for an application build that compiles main-thread programs:
	// there is a program to address, and both layers of that one build emit the
	// digest that proves they agree. `false` keeps descriptor mounts, which is
	// what an A/B measurement and the byte-identity pins need.
	const programAddressing =
		application &&
		options.mainThreadProgramBackend !== undefined &&
		options.programAddressing !== false;
	return Object.freeze({
		...layer,
		application,
		core: options.core ?? 'universal',
		thread,
		renderers:
			thread === 'main-thread' ? lynxRspeedyMainThreadRenderers : lynxRspeedyBackgroundRenderers,
		...(application
			? { layerSpecializations: applicationLayerSpecializations(options.mainThreadProgramBackend) }
			: null),
		...(programAddressing
			? {
					programAddressing: true,
					// Both layers, not just the main thread's. The background decides
					// whether a plan gets an address by running the same derivation as
					// the oracle, which is what makes the two compiles agree by
					// construction rather than by two rules kept in step — so it needs
					// the backend even though it emits no program of its own. Safe for
					// the same reason it always was: the universal compiler emits a
					// program only for a main-thread universal runtime.
					mainThreadProgramBackend: options.mainThreadProgramBackend,
				}
			: null),
		// An isolated `thread: 'main-thread'` graph has no layer to specialize, so
		// the backend is the top-level compiler input there. Both forms reach the
		// same compile; only the application build has two threads to tell apart.
		...(!application && thread === 'main-thread' && options.mainThreadProgramBackend !== undefined
			? { mainThreadProgramBackend: options.mainThreadProgramBackend }
			: null),
		...(options.dev === undefined ? null : { dev: options.dev }),
		...(options.hmr === undefined ? null : { hmr: options.hmr }),
		...(options.profile === undefined ? null : { profile: options.profile }),
		...(options.requireDirective === undefined
			? null
			: { requireDirective: options.requireDirective }),
		// Forwarded verbatim rather than validated here, so `@octanejs/rspack-plugin`
		// stays the one place that decides what the option may be and says so when
		// it is something else.
		...(options.parallel === undefined ? null : { parallel: options.parallel }),
		...(options.environments === undefined
			? null
			: { environments: normalizeStringArray(options.environments, 'environments') }),
		...(options.exclude === undefined
			? null
			: { exclude: normalizeStringArray(options.exclude, 'exclude') }),
	});
}

/**
 * Build an Octane Lynx application, or compile one isolated thread graph when
 * `thread` is selected explicitly for diagnostics and source-level testing.
 *
 * @returns {import('@rsbuild/core').RsbuildPlugin}
 */
export function pluginOctane(value) {
	const options = normalizeOptions(value);
	return {
		name: PLUGIN_NAME,
		enforce: 'pre',
		setup(api) {
			const root = resolve(api.context.rootPath);
			assertLynxToolchain(root);
			const appliesToEnvironment = (environment) =>
				(options.environments === undefined || options.environments.includes(environment.name)) &&
				(!options.application || /^(?:lynx|web)(?:-|$)/.test(environment.name));
			if (options.application) {
				exposeLynxTemplatePlugin(api);
				configureLynxCSS(api, options.environments);
				api.modifyEnvironmentConfig?.((config, { name, mergeEnvironmentConfig }) => {
					if (!appliesToEnvironment({ name })) return;
					return mergeEnvironmentConfig(config, {
						...(config.splitChunks === undefined ? { splitChunks: false } : null),
						tools: { rspack: { output: { iife: false } } },
					});
				});
			}
			api.modifyBundlerChain((chain, { environment }) => {
				if (!appliesToEnvironment(environment)) return;
				const extensionAlias = chain.resolve.extensionAlias;
				const configuredAliases = extensionAlias.has('.js') ? extensionAlias.get('.js') : ['.js'];
				const aliases = Array.isArray(configuredAliases) ? configuredAliases : [configuredAliases];
				if (!aliases.includes('.ts')) extensionAlias.set('.js', ['.ts', ...aliases]);
				chain.plugin(`${PLUGIN_NAME}:compiler`).use(OctaneRspackPlugin, [
					{
						environment: 'client',
						renderers: options.renderers,
						runtime: '@octanejs/lynx/renderer',
						universalRuntime: options.universalRuntime,
						...(options.layerSpecializations === undefined
							? null
							: { layerSpecializations: options.layerSpecializations }),
						...(options.mainThreadProgramBackend === undefined
							? null
							: { mainThreadProgramBackend: options.mainThreadProgramBackend }),
						...(options.programAddressing === undefined
							? null
							: { programAddressing: options.programAddressing }),
						...(options.dev === undefined ? null : { dev: options.dev }),
						...(options.hmr === undefined ? null : { hmr: options.hmr }),
						...(options.profile === undefined ? null : { profile: options.profile }),
						...(options.exclude === undefined ? null : { exclude: [...options.exclude] }),
						...(options.requireDirective === undefined
							? null
							: { requireDirective: options.requireDirective }),
						...(options.parallel === undefined ? null : { parallel: options.parallel }),
					},
				]);
				if (options.application) {
					chain.plugin(MAIN_THREAD_FACADE_PLUGIN).use(LynxMainThreadFacadePlugin, []);
				}
			});
			api.modifyBundlerChain({
				order: 'post',
				handler(chain, context) {
					const { environment } = context;
					if (!appliesToEnvironment(environment)) return;
					applyLynxBackgroundCore(chain, options.core);
					if (options.application) {
						const rspeedyConfig =
							api.useExposed?.(Symbol.for('rspeedy.api'))?.config ?? api.getRsbuildConfig?.() ?? {};
						applyLynxApplication(chain, context, rspeedyConfig, options);
					} else {
						applyLynxEntryLayer(chain, options.layer);
					}
				},
			});
		},
	};
}

export const octane = pluginOctane;
