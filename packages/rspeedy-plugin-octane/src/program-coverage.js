import { getOctaneRspackBuildInfo } from '@octanejs/rspack-plugin';

export const LYNX_PROGRAM_COVERAGE_ASSET_INFO = 'octane:lynx-program-coverage';
export const LYNX_PROGRAM_COVERAGE_VERSION = 1;
export const LYNX_BLOCK_SEMANTIC_REQUIREMENTS_ASSET_INFO =
	'octane:lynx-block-semantic-requirements';
export const LYNX_BLOCK_SEMANTIC_REQUIREMENTS_VERSION = 1;
export const LYNX_BLOCK_FEATURE_REQUIREMENTS_ASSET_INFO = 'octane:lynx-block-feature-requirements';
export const LYNX_BLOCK_FEATURE_REQUIREMENTS_VERSION = 1;
const MAIN_THREAD_ASSET = /main-thread(?:\.[A-Fa-f0-9]+)?\.js$/;

function dependencyRequest(dependency) {
	return typeof dependency?.request === 'string' ? dependency.request : null;
}

function activeConnection(connection) {
	return (
		typeof connection?.getActiveState !== 'function' ||
		connection.getActiveState(undefined) !== false
	);
}

function collectReachableModules(compilation, entryName, authoredRequests) {
	const entry = compilation.entries.get(entryName);
	if (entry === undefined) return { modules: new Set(), missing: [...authoredRequests] };
	const pending = [];
	const found = new Set();
	for (const dependency of entry.dependencies) {
		const request = dependencyRequest(dependency);
		if (request === null || !authoredRequests.has(request)) continue;
		const module = compilation.moduleGraph.getConnection(dependency)?.module;
		if (module === null || module === undefined) continue;
		found.add(request);
		pending.push(module);
	}
	const modules = new Set();
	while (pending.length !== 0) {
		const module = pending.pop();
		if (modules.has(module)) continue;
		modules.add(module);
		for (const connection of compilation.moduleGraph.getOutgoingConnections(module)) {
			if (!activeConnection(connection) || connection.module == null) continue;
			pending.push(connection.module);
		}
	}
	return {
		modules,
		missing: [...authoredRequests].filter((request) => !found.has(request)),
	};
}

function collectApplicationEntryModules(compilation, options) {
	const authoredRequests = new Set(options.authoredRequests);
	return {
		background: collectReachableModules(compilation, options.backgroundEntry, authoredRequests),
		main: collectReachableModules(compilation, options.mainThreadEntry, authoredRequests),
	};
}

function layerCoverage(modules, thread) {
	const observations = new Map();
	const unavailable = [];
	for (const module of modules) {
		const info = getOctaneRspackBuildInfo(module);
		if (info === null) {
			const raw = module?.buildInfo?.octane;
			if (raw !== undefined) {
				unavailable.push(
					Object.freeze({
						module:
							raw !== null && typeof raw === 'object' && typeof raw.canonicalId === 'string'
								? raw.canonicalId
								: null,
						invalidMetadata: true,
					}),
				);
			}
			continue;
		}
		if (info.transformKind !== 'compile' || info.universalRuntime?.runtime !== 'lynx') continue;
		if (info.universalRuntime.thread !== thread) {
			unavailable.push(
				Object.freeze({ module: info.canonicalId, observedThread: info.universalRuntime.thread }),
			);
			continue;
		}
		if (info.mainThreadProgramCoverage === undefined) {
			unavailable.push(Object.freeze({ module: info.canonicalId }));
			continue;
		}
		let moduleObservations = observations.get(info.canonicalId);
		if (moduleObservations === undefined) {
			moduleObservations = new Map();
			observations.set(info.canonicalId, moduleObservations);
		}
		const value = Object.freeze({
			total: info.mainThreadProgramCoverage.total,
			addressed: info.mainThreadProgramCoverage.addressed,
		});
		moduleObservations.set(`${value.total}:${value.addressed}`, value);
	}
	const coverage = new Map();
	const conflicts = [];
	for (const id of [...observations.keys()].sort()) {
		const values = [...observations.get(id).values()].sort(
			(left, right) => left.total - right.total || left.addressed - right.addressed,
		);
		coverage.set(id, values[0]);
		if (values.length > 1) {
			conflicts.push(Object.freeze({ module: id, observations: Object.freeze(values) }));
		}
	}
	unavailable.sort((left, right) => String(left.module).localeCompare(String(right.module)));
	return { coverage, conflicts, unavailable };
}

function reason(code, details = {}) {
	return Object.freeze({ code, ...details });
}

function cloneSourceSite(site) {
	return Object.freeze({ name: site.name, line: site.line, column: site.column });
}

function cloneSemanticRequirements(requirements) {
	return Object.freeze({
		version: LYNX_BLOCK_SEMANTIC_REQUIREMENTS_VERSION,
		runtimeUses: Object.freeze(requirements.runtimeUses.map(cloneSourceSite)),
		runtimeExports: Object.freeze(requirements.runtimeExports.map(cloneSourceSite)),
		opaqueRuntimeAccesses: Object.freeze(requirements.opaqueRuntimeAccesses.map(cloneSourceSite)),
		components: Object.freeze(
			requirements.components.map((component) =>
				Object.freeze({
					name: component.name,
					exportKind: component.exportKind,
					line: component.line,
					column: component.column,
					hooks: Object.freeze(component.hooks.map(cloneSourceSite)),
				}),
			),
		),
	});
}

function cloneFeatureRequirements(requirements) {
	return Object.freeze({
		version: LYNX_BLOCK_FEATURE_REQUIREMENTS_VERSION,
		threadFunctions: Object.freeze(
			requirements.threadFunctions.map((site) =>
				Object.freeze({
					kind: site.kind,
					id: site.id,
					line: site.line,
					column: site.column,
					captures: Object.freeze([...site.captures]),
				}),
			),
		),
		mainThreadProps: Object.freeze(requirements.mainThreadProps.map(cloneSourceSite)),
		keyedRanges: Object.freeze(
			requirements.keyedRanges.map((range) =>
				Object.freeze({
					line: range.line,
					column: range.column,
					empty: range.empty,
					nested: range.nested,
					lastChild: range.lastChild,
					row: Object.freeze({
						kind: range.row.kind,
						name: range.row.name,
						...(range.row.kind === 'local-component'
							? { hooks: Object.freeze(range.row.hooks.map(cloneSourceSite)) }
							: null),
					}),
				}),
			),
		),
	});
}

function layerSemanticRequirements(modules, thread) {
	const observations = new Map();
	const unavailable = [];
	for (const module of modules) {
		const info = getOctaneRspackBuildInfo(module);
		if (info === null) {
			const raw = module?.buildInfo?.octane;
			if (raw !== undefined) {
				unavailable.push(
					Object.freeze({
						module:
							raw !== null && typeof raw === 'object' && typeof raw.canonicalId === 'string'
								? raw.canonicalId
								: null,
						invalidMetadata: true,
					}),
				);
			}
			continue;
		}
		if (info.transformKind !== 'compile' || info.universalRuntime?.runtime !== 'lynx') continue;
		if (info.universalRuntime.thread !== thread) {
			unavailable.push(
				Object.freeze({ module: info.canonicalId, observedThread: info.universalRuntime.thread }),
			);
			continue;
		}
		if (info.lynxBlockSemanticRequirements === undefined) {
			unavailable.push(Object.freeze({ module: info.canonicalId }));
			continue;
		}
		let moduleObservations = observations.get(info.canonicalId);
		if (moduleObservations === undefined) {
			moduleObservations = new Map();
			observations.set(info.canonicalId, moduleObservations);
		}
		const value = cloneSemanticRequirements(info.lynxBlockSemanticRequirements);
		moduleObservations.set(JSON.stringify(value), value);
	}
	const requirements = new Map();
	const conflicts = [];
	for (const id of [...observations.keys()].sort()) {
		const values = [...observations.get(id).entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([, value]) => value);
		requirements.set(id, values[0]);
		if (values.length > 1) {
			conflicts.push(Object.freeze({ module: id, observations: Object.freeze(values) }));
		}
	}
	unavailable.sort((left, right) => {
		const leftModule = String(left.module);
		const rightModule = String(right.module);
		return leftModule < rightModule ? -1 : leftModule > rightModule ? 1 : 0;
	});
	return { requirements, conflicts, unavailable };
}

function layerFeatureRequirements(modules, thread) {
	const observations = new Map();
	const unavailable = [];
	for (const module of modules) {
		const info = getOctaneRspackBuildInfo(module);
		if (info === null) {
			const raw = module?.buildInfo?.octane;
			if (raw !== undefined) {
				unavailable.push(
					Object.freeze({
						module:
							raw !== null && typeof raw === 'object' && typeof raw.canonicalId === 'string'
								? raw.canonicalId
								: null,
						invalidMetadata: true,
					}),
				);
			}
			continue;
		}
		if (info.transformKind !== 'compile' || info.universalRuntime?.runtime !== 'lynx') continue;
		if (info.universalRuntime.thread !== thread) {
			unavailable.push(
				Object.freeze({ module: info.canonicalId, observedThread: info.universalRuntime.thread }),
			);
			continue;
		}
		if (info.lynxBlockFeatureRequirements === undefined) {
			unavailable.push(Object.freeze({ module: info.canonicalId }));
			continue;
		}
		let moduleObservations = observations.get(info.canonicalId);
		if (moduleObservations === undefined) {
			moduleObservations = new Map();
			observations.set(info.canonicalId, moduleObservations);
		}
		const value = cloneFeatureRequirements(info.lynxBlockFeatureRequirements);
		moduleObservations.set(JSON.stringify(value), value);
	}
	const requirements = new Map();
	const conflicts = [];
	for (const id of [...observations.keys()].sort()) {
		const values = [...observations.get(id).entries()]
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([, value]) => value);
		requirements.set(id, values[0]);
		if (values.length > 1) {
			conflicts.push(Object.freeze({ module: id, observations: Object.freeze(values) }));
		}
	}
	unavailable.sort((left, right) => String(left.module).localeCompare(String(right.module)));
	return { requirements, conflicts, unavailable };
}

function summarizeSemanticRequirements(modules, thread) {
	const runtimeUses = new Set();
	const runtimeExports = new Set();
	const opaqueRuntimeAccesses = new Set();
	const hooks = new Set();
	for (const module of modules) {
		const requirements = module[thread];
		for (const site of requirements.runtimeUses) runtimeUses.add(site.name);
		for (const site of requirements.runtimeExports) runtimeExports.add(site.name);
		for (const site of requirements.opaqueRuntimeAccesses) opaqueRuntimeAccesses.add(site.name);
		for (const component of requirements.components) {
			for (const hook of component.hooks) hooks.add(hook.name);
		}
	}
	return Object.freeze({
		runtimeUses: Object.freeze([...runtimeUses].sort()),
		runtimeExports: Object.freeze([...runtimeExports].sort()),
		opaqueRuntimeAccesses: Object.freeze([...opaqueRuntimeAccesses].sort()),
		hooks: Object.freeze([...hooks].sort()),
	});
}

/**
 * Pair validated module-local Block requirements across one application entry.
 *
 * `paired` proves only that both active Lynx graphs supplied valid facts for
 * every observed universal module. It is not Block eligibility: the support
 * matrix and independent lifecycle/ref/worklet proofs consume this report in a
 * later selector.
 */
function collectLynxBlockSemanticRequirementsFromEntryModules(entryModules) {
	const { background, main } = entryModules;
	const reasons = [];
	for (const request of background.missing) {
		reasons.push(reason('missing-background-entry-import', { request }));
	}
	for (const request of main.missing) {
		reasons.push(reason('missing-main-thread-entry-import', { request }));
	}
	const backgroundLayer = layerSemanticRequirements(background.modules, 'background');
	const mainLayer = layerSemanticRequirements(main.modules, 'main-thread');
	for (const conflict of backgroundLayer.conflicts) {
		reasons.push(reason('background-semantic-requirements-conflict', conflict));
	}
	for (const conflict of mainLayer.conflicts) {
		reasons.push(reason('main-thread-semantic-requirements-conflict', conflict));
	}
	for (const unavailable of backgroundLayer.unavailable) {
		reasons.push(reason('background-semantic-requirements-unavailable', unavailable));
	}
	for (const unavailable of mainLayer.unavailable) {
		reasons.push(reason('main-thread-semantic-requirements-unavailable', unavailable));
	}
	const backgroundRequirements = backgroundLayer.requirements;
	const mainRequirements = mainLayer.requirements;
	const ids = [...new Set([...backgroundRequirements.keys(), ...mainRequirements.keys()])].sort();
	const modules = [];
	for (const id of ids) {
		const backgroundModule = backgroundRequirements.get(id);
		const mainModule = mainRequirements.get(id);
		if (backgroundModule === undefined) {
			reasons.push(reason('missing-background-semantic-requirements', { module: id }));
			continue;
		}
		if (mainModule === undefined) {
			reasons.push(reason('missing-main-thread-semantic-requirements', { module: id }));
			continue;
		}
		modules.push(
			Object.freeze({ module: id, background: backgroundModule, mainThread: mainModule }),
		);
	}
	if (modules.length === 0) reasons.push(reason('no-paired-semantic-modules'));
	const frozenModules = Object.freeze(modules);
	return Object.freeze({
		version: LYNX_BLOCK_SEMANTIC_REQUIREMENTS_VERSION,
		paired: reasons.length === 0,
		requirements: Object.freeze({
			background: summarizeSemanticRequirements(frozenModules, 'background'),
			mainThread: summarizeSemanticRequirements(frozenModules, 'mainThread'),
		}),
		modules: frozenModules,
		reasons: Object.freeze(reasons),
	});
}

export function collectLynxBlockSemanticRequirements(compilation, options) {
	return collectLynxBlockSemanticRequirementsFromEntryModules(
		collectApplicationEntryModules(compilation, options),
	);
}

function collectLynxBlockFeatureRequirementsFromEntryModules(entryModules) {
	const { background, main } = entryModules;
	const reasons = [];
	for (const request of background.missing) {
		reasons.push(reason('missing-background-entry-import', { request }));
	}
	for (const request of main.missing) {
		reasons.push(reason('missing-main-thread-entry-import', { request }));
	}
	const backgroundLayer = layerFeatureRequirements(background.modules, 'background');
	const mainLayer = layerFeatureRequirements(main.modules, 'main-thread');
	for (const conflict of backgroundLayer.conflicts) {
		reasons.push(reason('background-feature-requirements-conflict', conflict));
	}
	for (const conflict of mainLayer.conflicts) {
		reasons.push(reason('main-thread-feature-requirements-conflict', conflict));
	}
	for (const unavailable of backgroundLayer.unavailable) {
		reasons.push(reason('background-feature-requirements-unavailable', unavailable));
	}
	for (const unavailable of mainLayer.unavailable) {
		reasons.push(reason('main-thread-feature-requirements-unavailable', unavailable));
	}
	const backgroundRequirements = backgroundLayer.requirements;
	const mainRequirements = mainLayer.requirements;
	const ids = [...new Set([...backgroundRequirements.keys(), ...mainRequirements.keys()])].sort();
	const modules = [];
	for (const id of ids) {
		const backgroundModule = backgroundRequirements.get(id);
		const mainModule = mainRequirements.get(id);
		if (backgroundModule === undefined) {
			reasons.push(reason('missing-background-feature-requirements', { module: id }));
			continue;
		}
		if (mainModule === undefined) {
			reasons.push(reason('missing-main-thread-feature-requirements', { module: id }));
			continue;
		}
		modules.push(
			Object.freeze({ module: id, background: backgroundModule, mainThread: mainModule }),
		);
	}
	if (modules.length === 0) reasons.push(reason('no-paired-feature-modules'));
	return Object.freeze({
		version: LYNX_BLOCK_FEATURE_REQUIREMENTS_VERSION,
		paired: reasons.length === 0,
		modules: Object.freeze(modules),
		reasons: Object.freeze(reasons),
	});
}

export function collectLynxBlockFeatureRequirements(compilation, options) {
	return collectLynxBlockFeatureRequirementsFromEntryModules(
		collectApplicationEntryModules(compilation, options),
	);
}

/**
 * Collect exact paired-layer resident-program coverage for one application entry.
 *
 * `complete` proves only that every discovered universal plan has a matching
 * resident address in both thread graphs. It is deliberately not a compact-
 * application capability claim: lifecycle data, worklets, refs, and Block-core
 * semantic coverage are independent gates that a selector must add beside it.
 */
function collectLynxProgramCoverageFromEntryModules(options, entryModules) {
	if (!options.enabled) {
		return Object.freeze({
			version: LYNX_PROGRAM_COVERAGE_VERSION,
			complete: false,
			pairedPlans: 0,
			pairedAddressed: 0,
			modules: Object.freeze([]),
			reasons: Object.freeze([reason('program-addressing-disabled')]),
		});
	}
	const { background, main } = entryModules;
	const reasons = [];
	for (const request of background.missing) {
		reasons.push(reason('missing-background-entry-import', { request }));
	}
	for (const request of main.missing) {
		reasons.push(reason('missing-main-thread-entry-import', { request }));
	}
	const backgroundLayer = layerCoverage(background.modules, 'background');
	const mainLayer = layerCoverage(main.modules, 'main-thread');
	for (const conflict of backgroundLayer.conflicts) {
		reasons.push(reason('background-coverage-conflict', conflict));
	}
	for (const conflict of mainLayer.conflicts) {
		reasons.push(reason('main-thread-coverage-conflict', conflict));
	}
	for (const unavailable of backgroundLayer.unavailable) {
		reasons.push(reason('background-coverage-unavailable', unavailable));
	}
	for (const unavailable of mainLayer.unavailable) {
		reasons.push(reason('main-thread-coverage-unavailable', unavailable));
	}
	const backgroundCoverage = backgroundLayer.coverage;
	const mainCoverage = mainLayer.coverage;
	const ids = [...new Set([...backgroundCoverage.keys(), ...mainCoverage.keys()])].sort();
	const modules = [];
	let pairedPlans = 0;
	let pairedAddressed = 0;
	for (const id of ids) {
		const backgroundModule = backgroundCoverage.get(id);
		const mainModule = mainCoverage.get(id);
		if (backgroundModule === undefined) {
			reasons.push(reason('missing-background-coverage', { module: id, ...mainModule }));
			continue;
		}
		if (mainModule === undefined) {
			reasons.push(reason('missing-main-thread-coverage', { module: id, ...backgroundModule }));
			continue;
		}
		if (
			backgroundModule.total !== mainModule.total ||
			backgroundModule.addressed !== mainModule.addressed
		) {
			reasons.push(
				reason('thread-coverage-mismatch', {
					module: id,
					background: backgroundModule,
					mainThread: mainModule,
				}),
			);
			continue;
		}
		const record = Object.freeze({
			module: id,
			total: backgroundModule.total,
			addressed: backgroundModule.addressed,
		});
		modules.push(record);
		pairedPlans += record.total;
		pairedAddressed += record.addressed;
		if (record.addressed !== record.total) {
			reasons.push(
				reason('partial-program-coverage', {
					module: id,
					total: record.total,
					addressed: record.addressed,
				}),
			);
		}
	}
	if (pairedPlans === 0) reasons.push(reason('no-paired-programs'));
	return Object.freeze({
		version: LYNX_PROGRAM_COVERAGE_VERSION,
		complete: reasons.length === 0,
		pairedPlans,
		pairedAddressed,
		modules: Object.freeze(modules),
		reasons: Object.freeze(reasons),
	});
}

export function collectLynxProgramCoverage(compilation, options) {
	if (!options.enabled) {
		return collectLynxProgramCoverageFromEntryModules(options);
	}
	return collectLynxProgramCoverageFromEntryModules(
		options,
		collectApplicationEntryModules(compilation, options),
	);
}

/** Attach versioned per-entry coverage evidence without changing emitted JavaScript. */
export class LynxProgramCoveragePlugin {
	constructor(entries, enabled) {
		this.entries = entries;
		this.enabled = enabled;
	}

	apply(compiler) {
		compiler.hooks.thisCompilation.tap(this.constructor.name, (compilation) => {
			const programReports = new Map();
			const semanticReports = new Map();
			const featureReports = new Map();
			compilation.hooks.finishModules.tap(this.constructor.name, () => {
				for (const entry of this.entries) {
					const entryModules = collectApplicationEntryModules(compilation, entry);
					programReports.set(
						entry.mainThreadEntry,
						collectLynxProgramCoverageFromEntryModules(
							{
								...entry,
								enabled: this.enabled,
							},
							entryModules,
						),
					);
					semanticReports.set(
						entry.mainThreadEntry,
						collectLynxBlockSemanticRequirementsFromEntryModules(entryModules),
					);
					featureReports.set(
						entry.mainThreadEntry,
						collectLynxBlockFeatureRequirementsFromEntryModules(entryModules),
					);
				}
			});
			compilation.hooks.processAssets.tap(
				{
					name: this.constructor.name,
					stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
				},
				() => {
					for (const [entryName, report] of programReports) {
						const entrypoint = compilation.entrypoints.get(entryName);
						for (const chunk of entrypoint?.chunks ?? []) {
							for (const filename of chunk.files ?? []) {
								if (!MAIN_THREAD_ASSET.test(filename)) continue;
								const asset = compilation.getAsset(filename);
								if (asset === undefined) continue;
								compilation.updateAsset(filename, asset.source, {
									...asset.info,
									[LYNX_PROGRAM_COVERAGE_ASSET_INFO]: report,
									[LYNX_BLOCK_SEMANTIC_REQUIREMENTS_ASSET_INFO]: semanticReports.get(entryName),
									[LYNX_BLOCK_FEATURE_REQUIREMENTS_ASSET_INFO]: featureReports.get(entryName),
								});
							}
						}
					}
				},
			);
		});
	}
}
