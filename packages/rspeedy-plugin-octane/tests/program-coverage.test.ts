import { describe, expect, it } from 'vitest';

import {
	collectLynxProgramCoverage,
	LYNX_PROGRAM_COVERAGE_ASSET_INFO,
	LynxProgramCoveragePlugin,
} from '../src/program-coverage.js';

type Thread = 'background' | 'main-thread';

function moduleWithCoverage(id: string, thread: Thread, total: number, addressed: number) {
	return {
		buildInfo: {
			octane: {
				canonicalId: id,
				transformKind: 'compile',
				serverRpc: false,
				universalRuntime: { runtime: 'lynx', thread },
				mainThreadProgramCoverage: { total, addressed },
			},
		},
		connections: [] as { module: unknown; getActiveState?: () => boolean }[],
	};
}

function compilation(
	background: unknown,
	mainThread: unknown,
	backgroundRequest = './src/App.tsrx',
	mainThreadRequest = './src/App.tsrx',
) {
	const dependency = (request: string, module: unknown) => ({ request, module });
	return {
		entries: new Map([
			['app', { dependencies: [dependency(backgroundRequest, background)] }],
			['app__octane_main_thread', { dependencies: [dependency(mainThreadRequest, mainThread)] }],
		]),
		moduleGraph: {
			getConnection: (entryDependency: { module: unknown }) => ({
				module: entryDependency.module,
			}),
			getOutgoingConnections: (module: { connections?: readonly unknown[] }) =>
				module.connections ?? [],
		},
	};
}

const OPTIONS = {
	enabled: true,
	backgroundEntry: 'app',
	mainThreadEntry: 'app__octane_main_thread',
	authoredRequests: ['./src/App.tsrx'],
};

describe('Lynx application resident-program coverage', () => {
	it('reports exact complete coverage across the two authored entry graphs', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const backgroundChild = moduleWithCoverage('/src/Card.tsrx', 'background', 2, 2);
		const mainThreadChild = moduleWithCoverage('/src/Card.tsrx', 'main-thread', 2, 2);
		background.connections.push({ module: backgroundChild });
		mainThread.connections.push({ module: mainThreadChild });

		const report = collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS);
		expect(report).toEqual({
			version: 1,
			complete: true,
			pairedPlans: 3,
			pairedAddressed: 3,
			modules: [
				{ module: '/src/App.tsrx', total: 1, addressed: 1 },
				{ module: '/src/Card.tsrx', total: 2, addressed: 2 },
			],
			reasons: [],
		});
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.modules)).toBe(true);
		expect(Object.isFrozen(report.modules[0])).toBe(true);
		expect(Object.isFrozen(report.reasons)).toBe(true);
	});

	it('retains partial, missing-peer, and thread-mismatch fallback reasons', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 2, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 2, 1);
		const backgroundOnly = moduleWithCoverage('/src/BackgroundOnly.tsrx', 'background', 1, 1);
		const backgroundDrift = moduleWithCoverage('/src/Drift.tsrx', 'background', 2, 2);
		const mainThreadDrift = moduleWithCoverage('/src/Drift.tsrx', 'main-thread', 2, 1);
		background.connections.push({ module: backgroundOnly }, { module: backgroundDrift });
		mainThread.connections.push({ module: mainThreadDrift });

		const report = collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS);
		expect(report).toMatchObject({
			complete: false,
			pairedPlans: 2,
			pairedAddressed: 1,
		});
		expect(report.reasons).toEqual([
			{ code: 'partial-program-coverage', module: '/src/App.tsrx', total: 2, addressed: 1 },
			{
				code: 'missing-main-thread-coverage',
				module: '/src/BackgroundOnly.tsrx',
				total: 1,
				addressed: 1,
			},
			{
				code: 'thread-coverage-mismatch',
				module: '/src/Drift.tsrx',
				background: { total: 2, addressed: 2 },
				mainThread: { total: 2, addressed: 1 },
			},
		]);
	});

	it('fails closed for disabled addressing, missing imports, and a graph with no programs', () => {
		const emptyBackground = moduleWithCoverage('/src/App.tsrx', 'background', 0, 0);
		const emptyMainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 0, 0);
		const graph = compilation(emptyBackground, emptyMainThread, './missing.ts', './missing.ts');

		expect(collectLynxProgramCoverage(graph, { ...OPTIONS, enabled: false })).toMatchObject({
			complete: false,
			reasons: [{ code: 'program-addressing-disabled' }],
		});
		expect(collectLynxProgramCoverage(graph, OPTIONS)).toMatchObject({
			complete: false,
			reasons: [
				{ code: 'missing-background-entry-import', request: './src/App.tsrx' },
				{ code: 'missing-main-thread-entry-import', request: './src/App.tsrx' },
				{ code: 'no-paired-programs' },
			],
		});
		expect(
			collectLynxProgramCoverage(compilation(emptyBackground, emptyMainThread), OPTIONS),
		).toMatchObject({
			complete: false,
			reasons: [{ code: 'no-paired-programs' }],
		});
	});

	it('ignores graph edges that Rspack has proved inactive', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		background.connections.push({
			module: moduleWithCoverage('/src/Dead.tsrx', 'background', 1, 0),
			getActiveState: () => false,
		});
		mainThread.connections.push({
			module: moduleWithCoverage('/src/Dead.tsrx', 'main-thread', 1, 0),
			getActiveState: () => false,
		});

		expect(collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS)).toMatchObject({
			complete: true,
			pairedPlans: 1,
			pairedAddressed: 1,
		});
	});

	it('fails closed when one layer contains conflicting coverage for a canonical module', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const duplicate = moduleWithCoverage('/src/App.tsrx', 'background', 2, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		background.connections.push({ module: duplicate });

		expect(collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS)).toMatchObject({
			complete: false,
			reasons: [
				{
					code: 'background-coverage-conflict',
					module: '/src/App.tsrx',
					observations: [
						{ total: 1, addressed: 1 },
						{ total: 2, addressed: 1 },
					],
				},
			],
		});
	});

	it('fails closed when a reachable universal compile has no addressing proof', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const unaddressed = moduleWithCoverage('/src/Unknown.tsrx', 'background', 1, 1);
		delete (unaddressed.buildInfo.octane as { mainThreadProgramCoverage?: unknown })
			.mainThreadProgramCoverage;
		background.connections.push({ module: unaddressed });

		expect(collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS)).toMatchObject({
			complete: false,
			reasons: [{ code: 'background-coverage-unavailable', module: '/src/Unknown.tsrx' }],
		});
	});

	it('fails closed when Octane metadata itself is malformed', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const malformed = moduleWithCoverage('/src/Broken.tsrx', 'background', 1, 1);
		(malformed.buildInfo.octane.mainThreadProgramCoverage as { addressed: number }).addressed = 2;
		background.connections.push({ module: malformed });

		expect(collectLynxProgramCoverage(compilation(background, mainThread), OPTIONS)).toMatchObject({
			complete: false,
			reasons: [
				{
					code: 'background-coverage-unavailable',
					module: '/src/Broken.tsrx',
					invalidMetadata: true,
				},
			],
		});
	});

	it('attaches the immutable report to the matching main-thread entry asset', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const graph = compilation(background, mainThread) as any;
		const assets = new Map<string, { source: unknown; info: any }>([
			['.rspeedy/app/main-thread.js', { source: {}, info: { existing: true } }],
			['other.js', { source: {}, info: {} }],
		]);
		graph.entrypoints = new Map([
			[
				'app__octane_main_thread',
				{ chunks: [{ files: new Set(['.rspeedy/app/main-thread.js']) }] },
			],
		]);
		let finishModules!: () => void;
		let processAssets!: () => void;
		graph.hooks = {
			finishModules: { tap: (_name: string, callback: () => void) => (finishModules = callback) },
			processAssets: {
				tap: (_options: unknown, callback: () => void) => (processAssets = callback),
			},
		};
		graph.getAsset = (filename: string) => assets.get(filename);
		graph.updateAsset = (filename: string, source: unknown, info: unknown) =>
			assets.set(filename, { source, info });
		const compiler = {
			hooks: {
				thisCompilation: {
					tap: (_name: string, callback: (value: unknown) => void) => callback(graph),
				},
			},
			webpack: { Compilation: { PROCESS_ASSETS_STAGE_REPORT: 1 } },
		};

		new LynxProgramCoveragePlugin(
			[
				{
					backgroundEntry: 'app',
					mainThreadEntry: 'app__octane_main_thread',
					authoredRequests: ['./src/App.tsrx'],
				},
			],
			true,
		).apply(compiler);
		finishModules();
		processAssets();

		expect(assets.get('.rspeedy/app/main-thread.js')?.info).toMatchObject({
			existing: true,
			[LYNX_PROGRAM_COVERAGE_ASSET_INFO]: {
				version: 1,
				complete: true,
				pairedPlans: 1,
				pairedAddressed: 1,
			},
		});
		expect(assets.get('other.js')?.info).toEqual({});
	});
});
