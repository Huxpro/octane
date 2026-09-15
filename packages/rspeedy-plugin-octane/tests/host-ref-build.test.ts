import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createRspeedy } from '@lynx-js/rspeedy';
import { describe, expect, it } from 'vitest';

import { pluginOctane } from '../src/index.js';

const APPLICATION_FIXTURE = resolve(import.meta.dirname, '_fixtures/application');

class RetainedModuleProbe {
	constructor(private readonly retained: string[]) {}

	apply(compiler: any): void {
		compiler.hooks.compilation.tap(this.constructor.name, (compilation: any) => {
			compilation.hooks.processAssets.tap(
				{
					name: this.constructor.name,
					stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
				},
				() => {
					const seen = new Set<unknown>();
					const visit = (module: {
						identifier?: () => string;
						modules?: Iterable<unknown>;
						rootModule?: unknown;
					}) => {
						if (seen.has(module)) return;
						seen.add(module);
						const identifier = module.identifier?.();
						if (typeof identifier === 'string') this.retained.push(identifier);
						for (const child of module.modules ?? []) visit(child as typeof module);
						if (module.rootModule != null) visit(module.rootModule as typeof module);
					};
					for (const module of compilation.modules as Iterable<Parameters<typeof visit>[0]>) {
						if (
							compilation.chunkGraph.getModuleChunksIterable(module)[Symbol.iterator]().next().done
						) {
							continue;
						}
						visit(module);
					}
				},
			);
		});
	}
}

function retainedModuleProbe(retained: string[]) {
	return {
		name: 'octane:lynx-host-ref-retained-modules',
		setup(api: any) {
			api.modifyBundlerChain((chain: any) => {
				chain.plugin('octane:lynx-host-ref-retained-modules').use(RetainedModuleProbe, [retained]);
			});
		},
	};
}

describe('@octanejs/rspeedy-plugin compact host-ref build', () => {
	it('retains the compact NodesRef provider only when the selected application has a ref site', async () => {
		const temporaryRoot = mkdtempSync(join(tmpdir(), 'octane-rspeedy-host-ref-'));
		const retained: string[] = [];
		const rspeedy = await createRspeedy({
			cwd: APPLICATION_FIXTURE,
			loadEnv: false,
			environment: ['lynx'],
			rspeedyConfig: {
				mode: 'production',
				environments: { lynx: {} },
				dev: { hmr: false, liveReload: false },
				output: {
					cleanDistPath: true,
					distPath: { root: join(temporaryRoot, 'dist') },
					filenameHash: false,
					sourceMap: false,
				},
				source: { entry: { main: './src/block-ref.ts' } },
				splitChunks: false,
				plugins: [pluginOctane({ dev: false, hmr: false }), retainedModuleProbe(retained)],
			},
		});
		let result: Awaited<ReturnType<typeof rspeedy.build>> | undefined;
		try {
			result = await rspeedy.build();
			const normalized = retained.map((identifier) =>
				identifier
					.split('!')
					.at(-1)!
					.replace(/\|octane:(?:background|main-thread).*$/, '')
					.split('?', 1)[0]
					.replaceAll(String.fromCharCode(92), '/'),
			);
			for (const module of [
				'core/client-driver.compiled-program.ts',
				'core/compact-host-ref-feature.ts',
				'core/compact-host-refs.ts',
				'core/nodes-ref.ts',
			]) {
				expect(
					normalized.some((identifier) => identifier.endsWith(`/packages/lynx/src/${module}`)),
					`${module}\n${normalized.join('\n')}`,
				).toBe(true);
			}
		} finally {
			await result?.close();
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	}, 120_000);
});
