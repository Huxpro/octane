// Issue-#163 C1d: the backend reaches the compiler through a real bundler.
//
// C1c proved the compiler emits a compiled create function when it is handed a
// backend. What that could not prove is that a backend ever arrives: it travels
// from a build's configuration, through the plugin's option normalization, into
// a layer specialization, out of the loader's layer selection, and into the
// compiler instance the loader constructs. Every one of those steps has its own
// allowlist, and a key missing from any of them is silent — the build succeeds
// and ships the interpreted encoding.
//
// So these are builds. Two entries, one per Rspack layer, through the real
// plugin, and the assertions read the emitted chunks.
//
// The renderer is the real Lynx descriptor with its module paths redirected at
// fixture stubs. Keeping the descriptor real is the point: `target`, `text`,
// `capabilities` and `validation` are what decide whether a template is
// eligible at all, and a hand-written descriptor would let this pass while a
// Lynx build declines every template it has.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import rspack from '@rspack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as Backend from '../../lynx/src/compiler/index.js';
import { lynxBackgroundRenderer, lynxMainThreadRenderer } from '../../lynx/src/config.runtime.js';
import { OctaneRspackPlugin } from '../src/index.js';

/** The renderer members a compiled universal module imports, as inert stubs. */
const RENDERER_STUB = `export const defineUniversalComponent = (_renderer, component) => component;
export const universalPlan = (_renderer, plan) => plan;
export const universalValue = (plan) => plan;
export const universalKey = (_key, value) => value;
export const universalList = (items) => items;
export const universalContext = () => ({});
export const universalPortal = (value) => value;
export const universalSuspense = (value) => value;
export const universalErrorBoundary = (value) => value;
export const firstScreenEvent = Symbol('firstScreenEvent');
export const lazy = (value) => value;
export default {};
`;

const CARD = `export function Card(props: { tone: string; label: string; onPick: () => void }) @{
	<view class={props.tone}>
		<text class="label" bindtap={props.onPick}>{props.label as string}</text>
	</view>
}
`;

let root: string;

function write(relativePath: string, content: string) {
	const file = join(root, relativePath);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function fixtureRenderer(descriptor: Record<string, unknown>) {
	return {
		...descriptor,
		module: '/src/renderer.js',
		threadFunctionsModule: '/src/worklets.js',
		intrinsics: '/src/intrinsics.js',
	};
}

async function runRspack(config: Record<string, unknown>) {
	const compiler = rspack(config as never) as never as {
		run: (callback: (error: Error | null, stats: unknown) => void) => void;
		close: (callback: (error: Error | null) => void) => void;
	};
	await new Promise<void>((resolve, reject) => {
		compiler.run((error, stats) => {
			compiler.close((closeError) => {
				if (error ?? closeError) {
					reject(error ?? closeError);
					return;
				}
				const errors = (stats as { compilation?: { errors?: unknown[] } })?.compilation?.errors;
				if (errors !== undefined && errors.length > 0) {
					reject(
						new Error(
							errors
								.map((entry) => (entry as { message?: string }).message ?? String(entry))
								.join('\n'),
						),
					);
					return;
				}
				resolve();
			});
		});
	});
}

/**
 * One application build: two entries, one per layer, through the real plugin.
 *
 * `mainThreadProgramBackend` is the only thing that varies between the arms,
 * and it is placed exactly where a Lynx application places it — on the
 * main-thread layer — unless a case deliberately puts it elsewhere.
 */
async function build(
	name: string,
	options: { mainThread?: unknown; topLevel?: unknown } = {},
): Promise<{ main: string; background: string }> {
	const output = join(root, `dist-${name}`);
	await runRspack({
		context: root,
		mode: 'development',
		target: 'web',
		experiments: { layers: true },
		entry: {
			background: { import: './src/background.js', layer: 'octane:background' },
			main: { import: './src/main.js', layer: 'octane:main-thread' },
		},
		optimization: { minimize: false },
		output: { path: output, filename: '[name].js' },
		plugins: [
			new OctaneRspackPlugin({
				renderers: {
					registry: { lynx: fixtureRenderer(lynxBackgroundRenderer) },
					default: 'lynx',
				},
				universalRuntime: { runtime: 'lynx', thread: 'background' },
				...(options.topLevel === undefined ? null : { mainThreadProgramBackend: options.topLevel }),
				layerSpecializations: {
					'octane:main-thread': {
						renderers: {
							registry: { lynx: fixtureRenderer(lynxMainThreadRenderer) },
							default: 'lynx',
						},
						universalRuntime: { runtime: 'lynx', thread: 'main-thread' },
						...(options.mainThread === undefined
							? null
							: { mainThreadProgramBackend: options.mainThread }),
					},
				},
			}),
		],
	});
	return {
		main: readFileSync(join(output, 'main.js'), 'utf8'),
		background: readFileSync(join(output, 'background.js'), 'utf8'),
	};
}

describe('a main-thread program backend, through a real Rspack build', () => {
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'octane-main-thread-program-'));
		write('package.json', `${JSON.stringify({ name: 'fixture', private: true })}\n`);
		write(
			'node_modules/octane/package.json',
			`${JSON.stringify({
				name: 'octane',
				exports: { '.': './client.cjs', './profiling': './profiling.cjs' },
			})}\n`,
		);
		const runtime = 'module.exports = new Proxy({}, { get: () => (...args) => args[0] });\n';
		write('node_modules/octane/client.cjs', runtime);
		write('node_modules/octane/profiling.cjs', runtime);
		write('src/renderer.js', RENDERER_STUB);
		write('src/intrinsics.js', RENDERER_STUB);
		write('src/worklets.js', RENDERER_STUB);
		write('src/Card.tsrx', CARD);
		write('src/background.js', `export { Card } from './Card.tsrx';\n`);
		write('src/main.js', `export { Card } from './Card.tsrx';\n`);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it('compiles the main-thread chunk to create functions and leaves the background chunk alone', async () => {
		const withBackend = await build('with', { mainThread: Backend });
		const without = await build('without');

		// What the main-thread chunk now carries: a program whose create function
		// drives the host element API directly. Asserting the calls rather than
		// the encoding's key is what makes this about painting rather than shape.
		expect(withBackend.main).toContain('"kind": "program"');
		expect(withBackend.main).toContain('papi.setClasses');
		expect(withBackend.main).toContain('papi.setEvent');
		expect(withBackend.main).toContain('intrinsics.view');
		expect(without.main).not.toContain('"kind": "program"');
		expect(without.main).not.toContain('papi.setClasses');

		// The background chunk is what the option must not reach. It is compared
		// byte-for-byte rather than probed, because a background chunk that merely
		// still works is not the claim — #163's is that it does not move at all.
		expect(withBackend.background).toBe(without.background);
	}, 60_000);

	it('emits nothing for a background layer that is handed a backend anyway', async () => {
		// The compiler emits a program only for a main-thread universal runtime,
		// which is what keeps byte-identity from depending on who passed what. A
		// top-level backend is inherited by every layer that does not override it,
		// so this hands the background layer one and expects it to change nothing.
		const inherited = await build('inherited', { topLevel: Backend });
		const without = await build('control');

		expect(inherited.background).toBe(without.background);
		expect(inherited.main).toContain('"kind": "program"');
	}, 60_000);

	it('salts the build cache with the backend that emitted it, not with its presence', async () => {
		// Two backends that both exist are not the same backend. A cache keyed on
		// presence would hand a build compiled create functions an older emitter
		// wrote, so the signature travels into the salt and a different one is a
		// different build.
		expect(Backend.signature).toMatch(/\S/);
		await expect(build('unsigned', { mainThread: { ...Backend, signature: '' } })).rejects.toThrow(
			/signature/,
		);
		await expect(build('incomplete', { mainThread: { signature: 'x' } })).rejects.toThrow(
			/deriveLynxMainThreadProgram/,
		);
	}, 60_000);
});
