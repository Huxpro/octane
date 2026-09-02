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
	options: { mainThread?: unknown; topLevel?: unknown; addressing?: boolean } = {},
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
				...(options.addressing === undefined ? null : { programAddressing: options.addressing }),
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

	// Issue-#246 E1 — the addressing, through the same real build.
	//
	// A positional address is only safe if both compiles of a module agree about
	// which plans are programs and in what order, and the whole of §6.1's A+B
	// split is that the agreement is established *here*, at build time, so the
	// runtime can do one map lookup and trust it. These are the two halves of
	// that: what an agreeing build emits, and what a disagreeing one does.
	it('names each program in both chunks, with one digest the build can compare', async () => {
		const addressed = await build('addressed', {
			addressing: true,
			topLevel: Backend,
			mainThread: Backend,
		});
		// The wire address is positional — `(module id, plan index)` — and the id
		// is package-relative with posix separators and no leading `./` (§6.2), so
		// it is the same string in a monorepo build and in a consumer's build of
		// the same file.
		expect(addressed.background).toContain('"module": "src/Card.tsrx"');
		expect(addressed.main).toContain('"module": "src/Card.tsrx"');
		expect(addressed.background).toContain('"index": 0');
		// The digest is what the *build* compares, and both chunks carry the same
		// one because both ran the same derivation over the same plan root.
		const digest = /"digest": "([0-9a-f]{16})"/.exec(addressed.background);
		expect(digest).not.toBeNull();
		expect(addressed.main).toContain(`"digest": "${digest![1]}"`);
		// Only the main-thread chunk carries the descriptor a later command-path
		// mount walks. Carrying it in the background chunk would be the descriptor
		// E1 exists to stop sending, shipped twice.
		expect(addressed.main).toContain('"wire"');
		expect(addressed.background).not.toContain('"wire"');
	}, 60_000);

	it("fails the build when the two layers disagree about a module's programs", async () => {
		// The failure §3 calls the worst shape in this codebase: a mount that binds
		// to the wrong program and paints a plausible wrong tree. It cannot reach
		// runtime, because a positional address is only issued by a build that saw
		// both compiles say the same thing about the same module.
		//
		// The disagreement is manufactured the only way that matters — one layer
		// derives a different program from the same plan — because that is what a
		// version skew between the two halves of a backend would actually look
		// like.
		//
		// The skew is one static scalar prop on the root, chosen so the drifted
		// program still compiles: `id` is a prop the emitter paints on a `view`,
		// so the build reaches the cross-check with two emittable programs and
		// refuses the *disagreement*. A perturbation the emitter itself declines —
		// reordering the nodes, say — would fail this build for the wrong reason
		// and would leave the drift gate untested.
		const drifting = {
			...Backend,
			deriveLynxMainThreadProgram: (plan: never) => {
				const derived = Backend.deriveLynxMainThreadProgram(plan);
				if (derived === null) return null;
				const [root, ...rest] = derived.wire.nodes;
				return {
					...derived,
					wire: {
						...derived.wire,
						nodes: [{ ...root, props: { ...root.props, id: 'skewed' } }, ...rest],
					},
				};
			},
		};
		await expect(
			build('drifted', { addressing: true, topLevel: Backend, mainThread: drifting }),
		).rejects.toThrow(/disagree about .*src\/Card\.tsrx/);
	}, 60_000);
});
