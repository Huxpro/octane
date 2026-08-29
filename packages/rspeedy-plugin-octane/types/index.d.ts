import type { RsbuildPlugin } from '@rsbuild/core';
import type { OctaneMainThreadProgramBackend } from '@octanejs/rspack-plugin';

export type OctaneLynxThread = 'background' | 'main-thread';

/**
 * Which background core the emitted bundle carries. One bundle carries exactly
 * one core; there is no per-root runtime choice.
 */
export type OctaneLynxBackgroundCore = 'universal' | 'block';

export interface OctaneLynxUniversalRuntime {
	readonly runtime: 'lynx';
	readonly thread: OctaneLynxThread;
}

export interface OctaneRspeedyPluginOptions {
	/**
	 * Select one isolated compiler graph for diagnostics and source tests.
	 * Omit this option to build the dual-thread application graph: a synchronous
	 * main-thread first screen followed by background runtime adoption.
	 */
	thread?: OctaneLynxThread;
	/**
	 * Select the background core (issue #103). `universal` — the default — keeps
	 * today's shared universal core driving background commits. `block` selects
	 * the Lynx-specialized Block core. The main-thread first-screen path is the
	 * same either way; only the background driver changes.
	 */
	core?: OctaneLynxBackgroundCore;
	/**
	 * @experimental Issue #163. Compile the main-thread chunk's eligible
	 * templates into create functions instead of the descriptions an interpreter
	 * walks at run time.
	 *
	 * Pass `@octanejs/lynx/compiler` here. It is the caller's to import rather
	 * than this plugin's, because the backend is TypeScript reaching into the
	 * renderer's own run-time lowering and this plugin is JavaScript loaded by
	 * the bundler's Node process. A TypeScript-aware config loader — Rspeedy's
	 * `lynx.config.ts`, or a test — can import it; plain Node cannot.
	 */
	mainThreadProgramBackend?: OctaneMainThreadProgramBackend;
	/** Restrict the plugin to named Rspeedy environments. */
	environments?: string[];
	/** Override component HMR for the selected graph. */
	hmr?: boolean;
	/** Override development diagnostics for the selected graph. */
	dev?: boolean;
	/** Enable Octane component profiling. */
	profile?: boolean;
	/** Exclude path fragments from Octane ownership. */
	exclude?: string[];
	/**
	 * Require project `.tsx`/`.ts`/`.js` modules to opt in with a leading
	 * `@jsxImportSource octane` pragma comment; `.tsrx` stays Octane's by
	 * extension and needs no marker.
	 */
	requireDirective?: boolean;
	/**
	 * Compile Octane modules in Rspack worker threads. Forwarded to
	 * `@octanejs/rspack-plugin`, which enables it by default with at most four
	 * workers; set `false` to keep compilation on the main thread, or provide
	 * `maxWorkers` for a different shared worker-pool limit.
	 *
	 * A worker receives its loader options by structured clone, so a build whose
	 * options carry a function — `mainThreadProgramBackend` is the one that does
	 * — compiles on the main thread whatever this says. Set it explicitly when
	 * two builds must be compared byte for byte: the worker pool is free to
	 * reach the minifier with a different module order, and that alone moves the
	 * short names in the output.
	 */
	parallel?: boolean | { maxWorkers?: number };
}

export const LYNX_BACKGROUND_LAYER: 'octane:background';
export const LYNX_MAIN_THREAD_LAYER: 'octane:main-thread';
export const LYNX_TARGET_SDK_VERSION: '3.9';
export const LYNX_BACKGROUND_RUNTIME: Readonly<{
	runtime: 'lynx';
	thread: 'background';
}>;
export const LYNX_MAIN_THREAD_RUNTIME: Readonly<{
	runtime: 'lynx';
	thread: 'main-thread';
}>;

export interface LynxToolchainPackage {
	readonly path: string;
	readonly version: string;
}

export type LynxToolchainLaneName = 'minimum' | 'current';

export interface LynxToolchainLane {
	readonly description: string;
	readonly lynxSdk: '3.9.0';
	readonly targetSdk: '3.9';
	readonly packages: Readonly<
		Record<
			| '@emnapi/core'
			| '@emnapi/runtime'
			| '@lynx-js/cache-events-webpack-plugin'
			| '@lynx-js/chunk-loading-webpack-plugin'
			| '@lynx-js/css-extract-webpack-plugin'
			| '@lynx-js/debug-metadata'
			| '@lynx-js/debug-metadata-rsbuild-plugin'
			| '@lynx-js/rspeedy'
			| '@lynx-js/runtime-wrapper-webpack-plugin'
			| '@lynx-js/tasm'
			| '@lynx-js/template-webpack-plugin'
			| '@lynx-js/testing-environment'
			| '@lynx-js/types'
			| '@lynx-js/web-core'
			| '@lynx-js/web-rsbuild-server-middleware'
			| '@lynx-js/webpack-dev-transport'
			| '@lynx-js/webpack-runtime-globals'
			| '@lynx-js/websocket'
			| '@napi-rs/wasm-runtime'
			| '@rsbuild/core'
			| '@rsbuild/plugin-css-minimizer'
			| '@rsdoctor/rspack-plugin'
			| '@rspack/core'
			| 'typescript'
			| 'webpack',
			string
		>
	>;
}

export const LYNX_TOOLCHAIN_LANES: Readonly<Record<LynxToolchainLaneName, LynxToolchainLane>>;

export function assertLynxToolchain(
	root: string,
	lane?: LynxToolchainLaneName,
): Readonly<
	Record<
		| '@lynx-js/cache-events-webpack-plugin'
		| '@lynx-js/chunk-loading-webpack-plugin'
		| '@lynx-js/css-extract-webpack-plugin'
		| '@lynx-js/debug-metadata'
		| '@lynx-js/debug-metadata-rsbuild-plugin'
		| '@lynx-js/rspeedy'
		| '@lynx-js/runtime-wrapper-webpack-plugin'
		| '@lynx-js/tasm'
		| '@lynx-js/template-webpack-plugin'
		| '@lynx-js/types'
		| '@lynx-js/web-core'
		| '@lynx-js/web-rsbuild-server-middleware'
		| '@lynx-js/webpack-dev-transport'
		| '@lynx-js/webpack-runtime-globals'
		| '@lynx-js/websocket'
		| '@rsbuild/core'
		| '@rsbuild/plugin-css-minimizer'
		| '@rsdoctor/rspack-plugin'
		| '@rspack/core',
		LynxToolchainPackage
	>
>;

export function pluginOctane(options?: OctaneRspeedyPluginOptions): RsbuildPlugin;
export const octane: typeof pluginOctane;
