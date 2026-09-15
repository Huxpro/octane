import { describe, expect, it } from 'vitest';

import {
	LYNX_APPLICATION_SELECTION_ASSET_INFO,
	LYNX_BACKGROUND_CORE_SELECTION_ASSET_INFO,
	LYNX_BLOCK_COMPONENT_FEATURE_SELECTION_ASSET_INFO,
	collectLynxBlockFeatureRequirements,
	collectLynxBlockSemanticRequirements,
	collectLynxProgramCoverage,
	decideLynxBlockComponentFeatures,
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
				| 'component-hole'
				| 'local-component'
				| 'fragment'
				| 'host-ref'
				| 'if'
				| 'inline-render-prop'
				| 'native-list'
				| 'portal'
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
			site('createContext', 1, 2),
			site('memo', 1, 3),
			site('useEffect', 3, 2),
			site('useContext', 2, 3),
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
					site('useContext', 2, 3),
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
		templateFeatures: [
			{ kind: 'component-hole', name: null, line: 5, column: 1 },
			{ kind: 'if', name: null, line: 5, column: 2 },
			{ kind: 'inline-render-prop', name: 'render', line: 5, column: 3 },
			{ kind: 'local-component', name: 'Frame', line: 5, column: 3 },
			{ kind: 'switch', name: null, line: 6, column: 2 },
		],
		keyedRanges: [
			{
				line: 7,
				column: 2,
				empty: true,
				nested: false,
				lastChild: true,
				row: { kind: 'inline-host', name: 'view' },
			},
			{
				line: 8,
				column: 2,
				empty: false,
				nested: false,
				lastChild: false,
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

function blockComponentFeatureDecision(
	feature: 'activity' | 'portal' | 'try' | null = null,
	runtime: 'startTransition' | 'useDeferredValue' | 'useTransition' | null = null,
) {
	const features = featureRequirements({
		templateFeatures: feature === null ? [] : [{ kind: feature, name: null, line: 1, column: 0 }],
	});
	const semantics = semanticRequirements({
		runtimeUses: runtime === null ? [] : [site(runtime)],
	});
	const report = {
		selection: { eligible: true },
		featureRequirements: {
			paired: true,
			modules: [{ background: features, mainThread: features }],
		},
		semanticRequirements: {
			paired: true,
			modules: [{ background: semantics, mainThread: semantics }],
		},
	};
	return decideLynxBlockComponentFeatures(
		{ options: { mode: 'production' }, watchMode: false },
		[{ mainThreadEntry: 'app__octane_main_thread' }],
		new Map([['app__octane_main_thread', report]]),
		{ selected: 'block' },
	);
}

describe('Lynx Block component feature selection', () => {
	it('selects the structural runtime only when optional semantics are absent', () => {
		expect(blockComponentFeatureDecision()).toEqual({
			version: 1,
			selected: 'structural',
			reasons: [],
		});
		for (const feature of ['activity', 'portal', 'try'] as const) {
			expect(blockComponentFeatureDecision(feature)).toMatchObject({
				version: 1,
				selected: 'full',
				reasons: [{ code: 'entry-requires-optional-block-semantics' }],
			});
		}
		for (const runtime of ['startTransition', 'useDeferredValue', 'useTransition'] as const) {
			expect(blockComponentFeatureDecision(null, runtime)).toMatchObject({
				version: 1,
				selected: 'full',
				reasons: [{ code: 'entry-requires-optional-block-semantics' }],
			});
		}
	});
});

describe('Lynx application Block eligibility', () => {
	it('accepts only the proven intersection of complete program, semantic, and feature facts', () => {
		const report = evaluateLynxBlockEligibility(completeProofs());

		expect(report).toEqual({
			version: 1,
			matrix: {
				version: 26,
				runtimeNames: [
					'Activity',
					'createContext',
					'createPortal',
					'memo',
					'startTransition',
					'use',
					'useActionState',
					'useBatch',
					'useCallback',
					'useContext',
					'useDeferredValue',
					'useEffect',
					'useEffectEvent',
					'useId',
					'useImperativeHandle',
					'useInsertionEffect',
					'useLayoutEffect',
					'useLinkedState',
					'useMemo',
					'useReducer',
					'useRef',
					'useState',
					'useSyncExternalStore',
					'useTransition',
				],
				threadFunctions: ['background', 'main-thread'],
				mainThreadProps: true,
				templateFeatures: [
					'activity',
					'component-hole',
					'host-ref',
					'if',
					'inline-render-prop',
					'local-component',
					'native-list',
					'portal',
					'switch',
					'try',
				],
				keyedRanges: {
					empty: true,
					nested: true,
					siblings: true,
					lastChild: true,
					nonTail: true,
					rowKinds: ['inline-host', 'local-component'],
					rowHooks: true,
				},
			},
			eligible: true,
			reasons: [],
		});
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.matrix.keyedRanges)).toBe(true);
		expect(Object.isFrozen(report.reasons)).toBe(true);
	});

	it('admits Activity only after both compiler threads prove the same supported use', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const activity = semanticRequirements({ runtimeUses: [site('Activity', 8, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: activity, mainThread: activity }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('Activity');
	});

	it('admits the retained reducer, memo, insertion, and layout-effect hook set only when paired', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const hooks = semanticRequirements({
			runtimeUses: [
				site('useInsertionEffect', 4, 2),
				site('useLayoutEffect', 5, 2),
				site('useMemo', 6, 2),
				site('useReducer', 7, 2),
			],
		});
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: hooks, mainThread: hooks }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toEqual(
			expect.arrayContaining(['useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useReducer']),
		);
	});

	it('admits paired transition scheduling and deferred-value semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const transitions = semanticRequirements({
			runtimeUses: [
				site('startTransition', 4, 2),
				site('useDeferredValue', 5, 2),
				site('useTransition', 6, 2),
			],
		});
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: transitions, mainThread: transitions }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toEqual(
			expect.arrayContaining(['startTransition', 'useDeferredValue', 'useTransition']),
		);
	});

	it('admits paired useId semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const ids = semanticRequirements({ runtimeUses: [site('useId', 4, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: ids, mainThread: ids }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('useId');
	});

	it('admits paired useLinkedState semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const linked = semanticRequirements({ runtimeUses: [site('useLinkedState', 4, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: linked, mainThread: linked }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('useLinkedState');
	});

	it('admits paired useEffectEvent semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const events = semanticRequirements({ runtimeUses: [site('useEffectEvent', 4, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: events, mainThread: events }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('useEffectEvent');
	});

	it('admits paired useImperativeHandle semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const handles = semanticRequirements({ runtimeUses: [site('useImperativeHandle', 4, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: handles, mainThread: handles }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('useImperativeHandle');
	});

	it('admits paired useActionState semantics', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const actions = semanticRequirements({ runtimeUses: [site('useActionState', 4, 2)] });
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: actions, mainThread: actions }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.runtimeNames).toContain('useActionState');
	});

	it('admits paired nested keyed-range ownership', () => {
		const proofs = completeProofs();
		const featureModule = proofs.featureRequirements.modules[0]!;
		const nested = featureRequirements({
			keyedRanges: [
				{
					line: 8,
					column: 2,
					empty: true,
					nested: true,
					lastChild: false,
					row: { kind: 'inline-host', name: 'view' },
				},
			],
		});
		const report = evaluateLynxBlockEligibility({
			...proofs,
			featureRequirements: {
				...proofs.featureRequirements,
				modules: [{ ...featureModule, background: nested, mainThread: nested }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.keyedRanges.nested).toBe(true);
		expect(report.matrix.keyedRanges.siblings).toBe(true);
	});

	it('admits a paired compiler-proved error and Suspense boundary', () => {
		const proofs = completeProofs();
		const semanticModule = proofs.semanticRequirements.modules[0]!;
		const featureModule = proofs.featureRequirements.modules[0]!;
		const suspense = semanticRequirements({
			runtimeUses: [site('use', 7, 3), site('useBatch', 7, 8)],
		});
		const boundary = featureRequirements({
			templateFeatures: [{ kind: 'try', name: null, line: 8, column: 2 }],
		});
		const report = evaluateLynxBlockEligibility({
			...proofs,
			semanticRequirements: {
				...proofs.semanticRequirements,
				modules: [{ ...semanticModule, background: suspense, mainThread: suspense }],
			},
			featureRequirements: {
				...proofs.featureRequirements,
				modules: [{ ...featureModule, background: boundary, mainThread: boundary }],
			},
		});

		expect(report.eligible).toBe(true);
		expect(report.reasons).toEqual([]);
		expect(report.matrix.templateFeatures).toContain('try');
		expect(report.matrix.runtimeNames).toEqual(expect.arrayContaining(['use', 'useBatch']));
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
							runtimeUses: [site('useOptimistic', 2, 3)],
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
					name: 'useOptimistic',
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
		expect(report).toEqual({ version: 2, eligible: true, reasons: [] });
		expect(Object.isFrozen(report)).toBe(true);
		expect(Object.isFrozen(report.reasons)).toBe(true);
	});

	it('accepts paired thread-function and main-thread-prop sites in the compact application', () => {
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
		).toEqual({ version: 2, eligible: true, reasons: [] });
	});

	it('keeps compiler-proved portals on the general Block application', () => {
		const { proofs, featureRequirements: compactRequirements } = compactFeatureRequirements();
		const featureModule = compactRequirements.modules[0]!;
		const portal = featureRequirements({
			templateFeatures: [{ kind: 'portal', name: null, line: 14, column: 3 }],
		});
		const requirements = {
			...compactRequirements,
			modules: [{ ...featureModule, background: portal, mainThread: portal }],
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
		).toEqual({
			version: 2,
			eligible: false,
			reasons: [
				{
					code: 'compiled-program-unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'background',
					kind: 'portal',
					name: null,
					line: 14,
					column: 3,
				},
				{
					code: 'compiled-program-unsupported-template-feature',
					module: '/src/App.tsrx',
					thread: 'main-thread',
					kind: 'portal',
					name: null,
					line: 14,
					column: 3,
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
		const blockComponent = {
			nameForCondition: () => '/repo/node_modules/@octanejs/lynx/src/core/block-component.ts',
			connections: [] as { module: unknown }[],
		};
		const generalFirstScreen = {
			nameForCondition: () => '/repo/node_modules/@octanejs/lynx/src/first-screen.ts',
		};
		const staleRenderer = {
			nameForCondition: () => '/repo/node_modules/@octanejs/lynx/src/main-renderer.ts',
			connections: [
				{
					dependency: { request: './core/first-screen.js' },
					module: generalFirstScreen,
				},
			],
		};
		graph.modules = new Set([root, blockComponent, staleRenderer]);
		const replacements: Array<{
			test: RegExp;
			callback: (resource: { request: string }) => void;
		}> = [];
		const rebuiltRequests: string[] = [];
		const rebuiltModules: unknown[] = [];
		graph.rebuildModule = (module: unknown, callback: (error: Error | null) => void) => {
			rebuiltModules.push(module);
			if (module === staleRenderer) {
				callback(new Error('relative first-screen consumers are not application selectors'));
				return;
			}
			if (module === mainThread) {
				callback(null);
				return;
			}
			if (module === blockComponent) {
				const resource = { request: './block-component-features.js' };
				for (const replacement of replacements) {
					if (replacement.test.test(resource.request)) replacement.callback(resource);
				}
				rebuiltRequests.push(resource.request);
				blockComponent.connections = [
					{
						module: {
							nameForCondition: () =>
								'/repo/node_modules/@octanejs/lynx/src/core/block-component-features.structural.ts',
						},
					},
				];
				callback(null);
				return;
			}
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
			undefined,
			true,
			{ request: '/repo/structural-element-template.js', signature: 'structural-et/1' },
		).apply(compiler);
		await finishMake(graph);
		processAssets();

		// The proof passes, compiler-program module selection, owner discovery /
		// verification, and dependency-first rebuild ordering all inspect the graph.
		expect(graphVisits).toBe(17);
		expect(rebuiltModules).toEqual([background, mainThread, blockComponent, root]);
		expect(rebuiltRequests).toEqual([
			'./core/background-core-selection.block.js',
			'./core/application-selection.compiled-program.js',
			'./block-component-features.structural.js',
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
				matrix: { version: 26 },
				eligible: true,
				reasons: [],
			},
			[LYNX_APPLICATION_SELECTION_ASSET_INFO]: {
				version: 2,
				selected: 'compiled-program-element-template',
				reasons: [],
			},
			[LYNX_BACKGROUND_CORE_SELECTION_ASSET_INFO]: {
				version: 1,
				mode: 'automatic',
				selected: 'block',
				eligible: true,
				reasons: [],
			},
			[LYNX_BLOCK_COMPONENT_FEATURE_SELECTION_ASSET_INFO]: {
				version: 1,
				selected: 'structural',
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
