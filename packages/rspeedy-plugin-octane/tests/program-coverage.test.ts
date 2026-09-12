import { describe, expect, it } from 'vitest';

import {
	LYNX_APPLICATION_SELECTION_ASSET_INFO,
	LYNX_BACKGROUND_CORE_SELECTION_ASSET_INFO,
	collectLynxBlockFeatureRequirements,
	collectLynxBlockSemanticRequirements,
	collectLynxProgramCoverage,
	evaluateLynxBlockEligibility,
	evaluateLynxCompiledProgramEligibility,
	LYNX_BLOCK_FEATURE_REQUIREMENTS_ASSET_INFO,
	LYNX_BLOCK_SELECTION_ASSET_INFO,
	LYNX_BLOCK_SEMANTIC_REQUIREMENTS_ASSET_INFO,
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
				lynxBlockSemanticRequirements: semanticRequirements(),
				lynxBlockFeatureRequirements: featureRequirements(),
			},
		},
		connections: [] as { module: unknown; getActiveState?: () => boolean }[],
	};
}

function featureRequirements(
	value: Partial<{
		threadFunctions: {
			kind: 'background' | 'main-thread';
			id: string;
			line: number;
			column: number;
			captures: string[];
		}[];
		mainThreadProps: ReturnType<typeof site>[];
		templateFeatures: {
			kind:
				| 'activity'
				| 'component'
				| 'fragment'
				| 'host-ref'
				| 'if'
				| 'native-list'
				| 'program-root-event'
				| 'renderable-hole'
				| 'switch'
				| 'try';
			name: string | null;
			line: number;
			column: number;
		}[];
		keyedRanges: {
			line: number;
			column: number;
			empty: boolean;
			nested: boolean;
			lastChild: boolean;
			row:
				| { kind: 'local-component'; name: string; hooks: ReturnType<typeof site>[] }
				| { kind: 'external-component' | 'inline-host'; name: string }
				| { kind: 'dynamic-component' | 'unknown'; name: null };
		}[];
	}> = {},
) {
	return {
		version: 2,
		threadFunctions: value.threadFunctions ?? [],
		mainThreadProps: value.mainThreadProps ?? [],
		templateFeatures: value.templateFeatures ?? [],
		keyedRanges: value.keyedRanges ?? [],
	};
}

function site(name: string, line = 1, column = 0) {
	return { name, line, column };
}

function semanticRequirements(
	value: Partial<{
		runtimeUses: ReturnType<typeof site>[];
		runtimeExports: ReturnType<typeof site>[];
		opaqueRuntimeAccesses: ReturnType<typeof site>[];
		components: {
			name: string;
			exportKind: 'named' | 'default' | null;
			line: number;
			column: number;
			hooks: ReturnType<typeof site>[];
		}[];
	}> = {},
) {
	return {
		version: 1,
		runtimeUses: value.runtimeUses ?? [],
		runtimeExports: value.runtimeExports ?? [],
		opaqueRuntimeAccesses: value.opaqueRuntimeAccesses ?? [],
		components: value.components ?? [],
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
			getIncomingConnections: () => [],
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

function completeProofs() {
	const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
	const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
	background.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
		runtimeUses: [
			site('useEffect', 3, 2),
			site('useState', 2, 2),
			site('useSyncExternalStore', 4, 2),
		],
		components: [
			{
				name: 'App',
				exportKind: 'default',
				line: 1,
				column: 0,
				hooks: [
					site('useState', 2, 2),
					site('useEffect', 3, 2),
					site('useSyncExternalStore', 4, 2),
				],
			},
		],
	});
	mainThread.buildInfo.octane.lynxBlockSemanticRequirements =
		background.buildInfo.octane.lynxBlockSemanticRequirements;
	background.buildInfo.octane.lynxBlockFeatureRequirements = featureRequirements({
		threadFunctions: [
			{
				kind: 'background',
				id: 'tf_row_read',
				line: 3,
				column: 2,
				captures: [],
			},
			{
				kind: 'main-thread',
				id: 'tf_row_tap',
				line: 4,
				column: 2,
				captures: ['selected'],
			},
		],
		mainThreadProps: [site('main-thread:ref', 6, 4)],
		keyedRanges: [
			{
				line: 7,
				column: 2,
				empty: false,
				nested: false,
				lastChild: true,
				row: { kind: 'inline-host', name: 'view' },
			},
			{
				line: 8,
				column: 2,
				empty: false,
				nested: false,
				lastChild: true,
				row: { kind: 'local-component', name: 'Row', hooks: [] },
			},
		],
	});
	mainThread.buildInfo.octane.lynxBlockFeatureRequirements =
		background.buildInfo.octane.lynxBlockFeatureRequirements;
	const graph = compilation(background, mainThread);
	return {
		programCoverage: collectLynxProgramCoverage(graph, OPTIONS),
		semanticRequirements: collectLynxBlockSemanticRequirements(graph, OPTIONS),
		featureRequirements: collectLynxBlockFeatureRequirements(graph, OPTIONS),
	};
}

describe('Lynx application Block eligibility', () => {
	it('accepts only the proven intersection of complete program, semantic, and feature facts', () => {
		const report = evaluateLynxBlockEligibility(completeProofs());

		expect(report).toEqual({
			version: 1,
			matrix: {
				version: 2,
				runtimeNames: ['useCallback', 'useEffect', 'useRef', 'useState', 'useSyncExternalStore'],
				threadFunctions: ['background', 'main-thread'],
				mainThreadProps: true,
				templateFeatures: [],
				keyedRanges: {
					empty: false,
					nested: false,
					lastChild: true,
					rowKinds: ['inline-host', 'local-component'],
					rowHooks: false,
				},
			},
			eligible: true,
			reasons: [],
		});
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.matrix.keyedRanges)).toBe(true);
		expect(Object.isFrozen(report.reasons)).toBe(true);
	});

	it('fails closed when a proof is incomplete, unpaired, version-skewed, or covers another graph', () => {
		const proofs = completeProofs();
		expect(
			evaluateLynxBlockEligibility({
				...proofs,
				programCoverage: {
					...proofs.programCoverage,
					complete: false,
					reasons: [{ code: 'partial-program-coverage', module: '/src/App.tsrx' }],
				},
				semanticRequirements: {
					...proofs.semanticRequirements,
					paired: false,
					reasons: [{ code: 'missing-main-thread-semantic-requirements' }],
				},
				featureRequirements: {
					...proofs.featureRequirements,
					version: 3,
					modules: [
						{
							...proofs.featureRequirements.modules[0]!,
							module: '/src/Other.tsrx',
						},
					],
				},
			}),
		).toMatchObject({
			eligible: false,
			reasons: [
				{
					code: 'program-coverage-incomplete',
					reasons: [{ code: 'partial-program-coverage', module: '/src/App.tsrx' }],
				},
				{
					code: 'semantic-requirements-unpaired',
					reasons: [{ code: 'missing-main-thread-semantic-requirements' }],
				},
				{ code: 'unsupported-feature-requirements-version', observed: 3, supported: 2 },
			],
		});

		const mismatched = completeProofs();
		expect(
			evaluateLynxBlockEligibility({
				...mismatched,
				featureRequirements: {
					...mismatched.featureRequirements,
					modules: [
						{
							...mismatched.featureRequirements.modules[0]!,
							module: '/src/Other.tsrx',
						},
					],
				},
			}),
		).toMatchObject({
			eligible: false,
			reasons: [
				{
					code: 'proof-module-set-mismatch',
					programCoverage: ['/src/App.tsrx'],
					semanticRequirements: ['/src/App.tsrx'],
					featureRequirements: ['/src/Other.tsrx'],
				},
			],
		});
	});

	it('retains exact unsupported API, opaque access, template, and keyed-range sites', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const featureModule = proofs.featureRequirements.modules[0]!;
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [
					{
						...semanticModule,
						background: semanticRequirements({
							runtimeUses: [site('useContext', 2, 3)],
							runtimeExports: [site('Suspense', 3, 4)],
							opaqueRuntimeAccesses: [site('export-all', 4, 5)],
						}),
					},
				],
			},
			featureRequirements: {
				...proofs.featureRequirements,
				modules: [
					{
						...featureModule,
						background: featureRequirements({
							templateFeatures: [
								{ kind: 'component', name: 'Panel', line: 5, column: 2 },
								{ kind: 'native-list', name: 'list', line: 6, column: 2 },
								{ kind: 'host-ref', name: 'view', line: 7, column: 2 },
								{ kind: 'program-root-event', name: 'bindtap', line: 8, column: 2 },
							],
							keyedRanges: [
								{
									line: 10,
									column: 2,
									empty: true,
									nested: true,
									lastChild: false,
									row: {
										kind: 'local-component',
										name: 'Row',
										hooks: [site('useState', 11, 3)],
									},
								},
								{
									line: 20,
									column: 2,
									empty: false,
									nested: false,
									lastChild: true,
									row: { kind: 'external-component', name: 'ExternalRow' },
								},
							],
						}),
					},
				],
			},
		});

		expect(report).toMatchObject({
			eligible: false,
			reasons: [
				{
					code: 'unsupported-runtime-use',
					module: '/src/App.tsrx',
					thread: 'background',
					name: 'useContext',
					line: 2,
					column: 3,
				},
				{
					code: 'unsupported-runtime-export',
					module: '/src/App.tsrx',
					thread: 'background',
					name: 'Suspense',
					line: 3,
					column: 4,
				},
				{
					code: 'opaque-runtime-access',
					module: '/src/App.tsrx',
					thread: 'background',
					name: 'export-all',
					line: 4,
					column: 5,
				},
				{
					code: 'keyed-range-empty-branch',
					module: '/src/App.tsrx',
					thread: 'background',
					line: 10,
					column: 2,
				},
				{
					code: 'keyed-range-nested',
					module: '/src/App.tsrx',
					thread: 'background',
					line: 10,
					column: 2,
				},
				{
					code: 'keyed-range-not-last-child',
					module: '/src/App.tsrx',
					thread: 'background',
					line: 10,
					column: 2,
				},
				{
					code: 'keyed-range-row-hooks',
					module: '/src/App.tsrx',
					thread: 'background',
					line: 10,
					column: 2,
					row: 'Row',
					hooks: [site('useState', 11, 3)],
				},
				{
					code: 'unsupported-keyed-range-row',
					module: '/src/App.tsrx',
					thread: 'background',
					line: 20,
					column: 2,
					kind: 'external-component',
					row: 'ExternalRow',
				},
				{
					code: 'unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'component',
					name: 'Panel',
					line: 5,
					column: 2,
				},
				{
					code: 'unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'native-list',
					name: 'list',
					line: 6,
					column: 2,
				},
				{
					code: 'unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'host-ref',
					name: 'view',
					line: 7,
					column: 2,
				},
				{
					code: 'unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'program-root-event',
					name: 'bindtap',
					line: 8,
					column: 2,
				},
			],
		});
	});
});

describe('Lynx compiled-program application eligibility', () => {
	function compactFeatureRequirements() {
		const proofs = completeProofs();
		return {
			proofs,
			featureRequirements: {
				...proofs.featureRequirements,
				modules: proofs.featureRequirements.modules.map((module) => ({
					...module,
					background: featureRequirements(),
					mainThread: featureRequirements(),
				})),
			},
		};
	}

	it('accepts an eligible Block graph only when compact-application channels are absent', () => {
		const { proofs, featureRequirements } = compactFeatureRequirements();
		const blockSelection = evaluateLynxBlockEligibility({ ...proofs, featureRequirements });

		expect(blockSelection.eligible).toBe(true);
		const report = evaluateLynxCompiledProgramEligibility({
			blockSelection,
			featureRequirements,
		});
		expect(report).toEqual({ version: 1, eligible: true, reasons: [] });
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.reasons)).toBe(true);
	});

	it('retains exact thread-function and main-thread-prop sites that require the general application', () => {
		const { proofs, featureRequirements: compactRequirements } = compactFeatureRequirements();
		const featureModule = compactRequirements.modules[0]!;
		const requirements = {
			...compactRequirements,
			modules: [
				{
					...featureModule,
					background: featureRequirements({
						threadFunctions: [
							{
								kind: 'background' as const,
								id: 'tf_background_read',
								line: 11,
								column: 3,
								captures: [],
							},
						],
						mainThreadProps: [site('main-thread:background-ref', 12, 4)],
					}),
					mainThread: featureRequirements({
						threadFunctions: [
							{
								kind: 'main-thread' as const,
								id: 'tf_main_tap',
								line: 21,
								column: 5,
								captures: ['selected'],
							},
						],
						mainThreadProps: [site('main-thread:main-ref', 22, 6)],
					}),
				},
			],
		};
		const blockSelection = evaluateLynxBlockEligibility({
			...proofs,
			featureRequirements: requirements,
		});

		expect(blockSelection.eligible).toBe(true);
		expect(
			evaluateLynxCompiledProgramEligibility({
				blockSelection,
				featureRequirements: requirements,
			}),
		).toMatchObject({
			eligible: false,
			reasons: [
				{
					code: 'thread-function-requires-general-application',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'background',
					id: 'tf_background_read',
					line: 11,
					column: 3,
				},
				{
					code: 'main-thread-prop-requires-general-application',
					module: '/src/App.tsrx',
					thread: 'background',
					name: 'main-thread:background-ref',
					line: 12,
					column: 4,
				},
				{
					code: 'thread-function-requires-general-application',
					module: '/src/App.tsrx',
					thread: 'main-thread',
					kind: 'main-thread',
					id: 'tf_main_tap',
					line: 21,
					column: 5,
				},
				{
					code: 'main-thread-prop-requires-general-application',
					module: '/src/App.tsrx',
					thread: 'main-thread',
					name: 'main-thread:main-ref',
					line: 22,
					column: 6,
				},
			],
		});
	});

	it('fails closed for selection or feature proof skew and unpaired facts', () => {
		const { proofs, featureRequirements } = compactFeatureRequirements();
		const blockSelection = evaluateLynxBlockEligibility({ ...proofs, featureRequirements });
		const blockReasons = [{ code: 'program-coverage-incomplete' }];

		expect(
			evaluateLynxCompiledProgramEligibility({
				blockSelection: { ...blockSelection, eligible: false, reasons: blockReasons },
				featureRequirements: { ...featureRequirements, paired: false },
			}),
		).toMatchObject({
			eligible: false,
			reasons: [
				{ code: 'block-selection-ineligible', reasons: blockReasons },
				{ code: 'feature-requirements-unpaired' },
			],
		});
		expect(
			evaluateLynxCompiledProgramEligibility({
				blockSelection: { ...blockSelection, version: 2 },
				featureRequirements: { ...featureRequirements, version: 3 },
			}),
		).toMatchObject({
			eligible: false,
			reasons: [
				{ code: 'unsupported-block-selection-version' },
				{ code: 'unsupported-feature-requirements-version' },
			],
		});
	});
});

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
		expect(
			collectLynxBlockSemanticRequirements(compilation(background, mainThread), OPTIONS).modules,
		).toMatchObject([{ module: '/src/App.tsrx' }]);
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

	it('attaches proofs and rebuilds the eligible production root onto Block', async () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const graph = compilation(background, mainThread) as any;
		let graphVisits = 0;
		const getOutgoingConnections = graph.moduleGraph.getOutgoingConnections;
		graph.moduleGraph.getOutgoingConnections = (module: unknown) => {
			graphVisits++;
			return getOutgoingConnections(module);
		};
		const mainThreadSource = {};
		const assets = new Map<string, { source: unknown; info: any }>([
			['.rspeedy/app/main-thread.js', { source: mainThreadSource, info: { existing: true } }],
			['other.js', { source: {}, info: {} }],
		]);
		graph.entrypoints = new Map([
			[
				'app__octane_main_thread',
				{ chunks: [{ files: new Set(['.rspeedy/app/main-thread.js']) }] },
			],
		]);
		let finishMake!: (compilation: unknown) => Promise<void>;
		let processAssets!: () => void;
		graph.hooks = {
			processAssets: {
				tap: (_options: unknown, callback: () => void) => (processAssets = callback),
			},
		};
		const root = {
			layer: 'octane:background',
			nameForCondition: () => '/repo/node_modules/@octanejs/lynx/src/root.ts',
			connections: [] as { module: unknown }[],
		};
		graph.modules = new Set([root]);
		const replacements: Array<{
			test: RegExp;
			callback: (resource: { request: string }) => void;
		}> = [];
		const rebuiltRequests: string[] = [];
		graph.rebuildModule = (_module: unknown, callback: (error: Error | null) => void) => {
			const connections = [];
			for (const request of [
				'./core/background-core-selection.js',
				'./core/application-selection.js',
			]) {
				const resource = { request };
				for (const replacement of replacements) {
					if (replacement.test.test(resource.request)) replacement.callback(resource);
				}
				rebuiltRequests.push(resource.request);
				connections.push({
					module: {
						nameForCondition: () =>
							resource.request.endsWith('background-core-selection.block.js')
								? '/repo/node_modules/@octanejs/lynx/src/core/background-core-selection.block.ts'
								: '/repo/node_modules/@octanejs/lynx/src/core/application-selection.compiled-program.ts',
					},
				});
			}
			root.connections = connections;
			callback(null);
		};
		graph.getAsset = (filename: string) => assets.get(filename);
		graph.updateAsset = (filename: string, source: unknown, info: unknown) =>
			assets.set(filename, { source, info });
		const compiler = {
			options: { mode: 'production' },
			hooks: {
				finishMake: {
					tapPromise: (_name: string, callback: (compilation: unknown) => Promise<void>) =>
						(finishMake = callback),
				},
				thisCompilation: {
					tap: (_name: string, callback: (value: unknown) => void) => callback(graph),
				},
			},
			webpack: {
				Compilation: { PROCESS_ASSETS_STAGE_REPORT: 1 },
				NormalModuleReplacementPlugin: class {
					constructor(test: RegExp, callback: (resource: { request: string }) => void) {
						replacements.push({ test, callback });
					}
					apply() {}
				},
			},
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
		await finishMake(graph);
		processAssets();

		// Two complete entry traversals, owner discovery/verification, and the
		// dependency-first rebuild ordering pass each inspect the exact root edge.
		expect(graphVisits).toBe(5);
		expect(rebuiltRequests).toEqual([
			'./core/background-core-selection.block.js',
			'./core/application-selection.compiled-program.js',
		]);
		expect(assets.get('.rspeedy/app/main-thread.js')?.info).toMatchObject({
			existing: true,
			[LYNX_PROGRAM_COVERAGE_ASSET_INFO]: {
				version: 1,
				complete: true,
				pairedPlans: 1,
				pairedAddressed: 1,
			},
			[LYNX_BLOCK_SEMANTIC_REQUIREMENTS_ASSET_INFO]: {
				version: 1,
				paired: true,
				requirements: {
					background: {
						runtimeUses: [],
						runtimeExports: [],
						opaqueRuntimeAccesses: [],
						hooks: [],
					},
					mainThread: {
						runtimeUses: [],
						runtimeExports: [],
						opaqueRuntimeAccesses: [],
						hooks: [],
					},
				},
			},
			[LYNX_BLOCK_FEATURE_REQUIREMENTS_ASSET_INFO]: {
				version: 2,
				paired: true,
				modules: [
					{
						module: '/src/App.tsrx',
						background: featureRequirements(),
						mainThread: featureRequirements(),
					},
				],
				reasons: [],
			},
			[LYNX_BLOCK_SELECTION_ASSET_INFO]: {
				version: 1,
				matrix: { version: 2 },
				eligible: true,
				reasons: [],
			},
			[LYNX_APPLICATION_SELECTION_ASSET_INFO]: {
				version: 1,
				selected: 'compiled-program',
				reasons: [],
			},
			[LYNX_BACKGROUND_CORE_SELECTION_ASSET_INFO]: {
				version: 1,
				mode: 'automatic',
				selected: 'block',
				eligible: true,
				reasons: [],
			},
		});
		expect(assets.get('.rspeedy/app/main-thread.js')?.source).toBe(mainThreadSource);
		expect(assets.get('other.js')?.info).toEqual({});
	});
});

describe('Lynx application Block feature requirements', () => {
	it('pairs immutable per-thread topology and thread-function facts without judging support', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const facts = featureRequirements({
			threadFunctions: [
				{
					kind: 'main-thread',
					id: 'tf_panel',
					line: 4,
					column: 12,
					captures: ['boxRef'],
				},
			],
			mainThreadProps: [site('main-thread:ref', 8, 3)],
			templateFeatures: [{ kind: 'component', name: 'Panel', line: 8, column: 7 }],
			keyedRanges: [
				{
					line: 9,
					column: 2,
					empty: true,
					nested: false,
					lastChild: true,
					row: { kind: 'local-component', name: 'Row', hooks: [] },
				},
			],
		});
		background.buildInfo.octane.lynxBlockFeatureRequirements = facts;
		mainThread.buildInfo.octane.lynxBlockFeatureRequirements = facts;

		const report = collectLynxBlockFeatureRequirements(
			compilation(background, mainThread),
			OPTIONS,
		);
		expect(report).toEqual({
			version: 2,
			paired: true,
			modules: [
				{
					module: '/src/App.tsrx',
					background: facts,
					mainThread: facts,
				},
			],
			reasons: [],
		});
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.modules[0]?.background.templateFeatures)).toBe(true);
		expect(Object.isFrozen(report.modules[0]?.background.templateFeatures[0])).toBe(true);
		expect(Object.isFrozen(report.modules[0]?.background.keyedRanges[0]?.row)).toBe(true);
	});

	it('fails closed when one reachable layer has no feature ledger', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		delete (mainThread.buildInfo.octane as { lynxBlockFeatureRequirements?: unknown })
			.lynxBlockFeatureRequirements;

		expect(
			collectLynxBlockFeatureRequirements(compilation(background, mainThread), OPTIONS),
		).toMatchObject({
			paired: false,
			reasons: [
				{ code: 'main-thread-feature-requirements-unavailable', module: '/src/App.tsrx' },
				{ code: 'missing-main-thread-feature-requirements', module: '/src/App.tsrx' },
				{ code: 'no-paired-feature-modules' },
			],
		});
	});

	it('retains missing peers, conflicts, malformed metadata, and empty graphs as reasons', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const backgroundOnly = moduleWithCoverage('/src/background-only.ts', 'background', 0, 0);
		const conflict = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		conflict.buildInfo.octane.lynxBlockFeatureRequirements = featureRequirements({
			mainThreadProps: [site('main-thread:ref', 2, 3)],
		});
		const malformed = moduleWithCoverage('/src/broken.ts', 'main-thread', 0, 0);
		(malformed.buildInfo.octane.lynxBlockFeatureRequirements as { version: number }).version = 3;
		const wrongThread = moduleWithCoverage('/src/wrong-thread.ts', 'background', 0, 0);
		background.connections.push({ module: backgroundOnly }, { module: conflict });
		mainThread.connections.push({ module: malformed }, { module: wrongThread });

		expect(
			collectLynxBlockFeatureRequirements(compilation(background, mainThread), OPTIONS),
		).toMatchObject({
			paired: false,
			reasons: [
				{
					code: 'background-feature-requirements-conflict',
					module: '/src/App.tsrx',
				},
				{
					code: 'main-thread-feature-requirements-unavailable',
					module: '/src/broken.ts',
					invalidMetadata: true,
				},
				{
					code: 'main-thread-feature-requirements-unavailable',
					module: '/src/wrong-thread.ts',
					observedThread: 'background',
				},
				{
					code: 'missing-main-thread-feature-requirements',
					module: '/src/background-only.ts',
				},
			],
		});

		const empty = compilation(background, mainThread, './missing.ts', './missing.ts');
		expect(collectLynxBlockFeatureRequirements(empty, OPTIONS)).toMatchObject({
			paired: false,
			reasons: [
				{ code: 'missing-background-entry-import', request: './src/App.tsrx' },
				{ code: 'missing-main-thread-entry-import', request: './src/App.tsrx' },
				{ code: 'no-paired-feature-modules' },
			],
		});
	});
});

describe('Lynx application Block semantic requirements', () => {
	it('pairs module facts and publishes deterministic per-thread requirement unions', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		background.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
			runtimeUses: [site('useState', 3, 14)],
			components: [
				{
					name: 'App',
					exportKind: 'named',
					line: 2,
					column: 7,
					hooks: [site('useState', 3, 14)],
				},
			],
		});
		mainThread.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
			runtimeUses: [site('Activity', 8, 2), site('useState', 3, 14)],
			components: [
				{
					name: 'App',
					exportKind: 'named',
					line: 2,
					column: 7,
					hooks: [site('useState', 3, 14)],
				},
			],
		});
		const backgroundChild = moduleWithCoverage('/src/runtime.ts', 'background', 0, 0);
		const mainThreadChild = moduleWithCoverage('/src/runtime.ts', 'main-thread', 0, 0);
		backgroundChild.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
			runtimeExports: [site('useMemo', 1, 9)],
			opaqueRuntimeAccesses: [site('dynamic-import', 4, 19)],
		});
		mainThreadChild.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
			runtimeExports: [site('useMemo', 1, 9)],
		});
		background.connections.push({ module: backgroundChild });
		mainThread.connections.push({ module: mainThreadChild });

		const report = collectLynxBlockSemanticRequirements(
			compilation(background, mainThread),
			OPTIONS,
		);
		expect(report).toEqual({
			version: 1,
			paired: true,
			requirements: {
				background: {
					runtimeUses: ['useState'],
					runtimeExports: ['useMemo'],
					opaqueRuntimeAccesses: ['dynamic-import'],
					hooks: ['useState'],
				},
				mainThread: {
					runtimeUses: ['Activity', 'useState'],
					runtimeExports: ['useMemo'],
					opaqueRuntimeAccesses: [],
					hooks: ['useState'],
				},
			},
			modules: [
				{
					module: '/src/App.tsrx',
					background: background.buildInfo.octane.lynxBlockSemanticRequirements,
					mainThread: mainThread.buildInfo.octane.lynxBlockSemanticRequirements,
				},
				{
					module: '/src/runtime.ts',
					background: backgroundChild.buildInfo.octane.lynxBlockSemanticRequirements,
					mainThread: mainThreadChild.buildInfo.octane.lynxBlockSemanticRequirements,
				},
			],
			reasons: [],
		});
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.requirements.background.runtimeUses)).toBe(true);
		expect(Object.isFrozen(report.modules[0]?.background.components[0]?.hooks)).toBe(true);
	});

	it('retains missing peers, conflicts, malformed metadata, and empty graphs as reasons', () => {
		const background = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		const mainThread = moduleWithCoverage('/src/App.tsrx', 'main-thread', 1, 1);
		const backgroundOnly = moduleWithCoverage('/src/background-only.ts', 'background', 0, 0);
		const conflict = moduleWithCoverage('/src/App.tsrx', 'background', 1, 1);
		conflict.buildInfo.octane.lynxBlockSemanticRequirements = semanticRequirements({
			runtimeUses: [site('useContext', 2, 3)],
		});
		const malformed = moduleWithCoverage('/src/broken.ts', 'main-thread', 0, 0);
		(malformed.buildInfo.octane.lynxBlockSemanticRequirements as { version: number }).version = 2;
		const wrongThread = moduleWithCoverage('/src/wrong-thread.ts', 'background', 0, 0);
		background.connections.push({ module: backgroundOnly }, { module: conflict });
		mainThread.connections.push({ module: malformed }, { module: wrongThread });

		expect(
			collectLynxBlockSemanticRequirements(compilation(background, mainThread), OPTIONS),
		).toMatchObject({
			paired: false,
			reasons: [
				{
					code: 'background-semantic-requirements-conflict',
					module: '/src/App.tsrx',
				},
				{
					code: 'main-thread-semantic-requirements-unavailable',
					module: '/src/broken.ts',
					invalidMetadata: true,
				},
				{
					code: 'main-thread-semantic-requirements-unavailable',
					module: '/src/wrong-thread.ts',
					observedThread: 'background',
				},
				{
					code: 'missing-main-thread-semantic-requirements',
					module: '/src/background-only.ts',
				},
			],
		});

		const empty = compilation(background, mainThread, './missing.ts', './missing.ts');
		expect(collectLynxBlockSemanticRequirements(empty, OPTIONS)).toMatchObject({
			paired: false,
			reasons: [
				{ code: 'missing-background-entry-import', request: './src/App.tsrx' },
				{ code: 'missing-main-thread-entry-import', request: './src/App.tsrx' },
				{ code: 'no-paired-semantic-modules' },
			],
		});
	});
});
