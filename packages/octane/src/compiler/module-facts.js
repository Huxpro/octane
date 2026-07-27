// Cross-module facts: what a compile of ONE module can learn about the modules
// it imports from, without a type checker and without a whole-program pass.
//
// The compiler is single-module by construction, so every question about an
// import is currently answered by assumption. `plainCalleeIsMemoizable` says as
// much in its own comment — an imported binding's "body is across a module
// boundary we cannot read". This module reads it.
//
// ## Why demand-driven, and not a pre-pass
//
// Bundlers transform an importer BEFORE its dependencies: the import graph is
// discovered by transforming, so a passive "pass 1 collects, pass 2 consumes"
// is always exactly one build too late. Instead the importer PULLS — it
// pre-scans its own source for candidate imports, and only those get resolved
// and analysed. A module that imports nothing interesting costs one parse it
// was already paying for.
//
// ## Why source text, and not bundler metadata
//
// The void-component proof next door rides Rollup module-graph `meta` via
// `context.load`, which is exactly why the rspack plugin has no equivalent.
// This works from resolved path + file contents, which both Vite's `resolve`
// and rspack's `getResolve` can produce, so one implementation serves both.
//
// ## Soundness
//
// Every fact here is a property of a single module's own source, provable by
// reading that module alone. That is what makes it safe to cache per file and
// to answer without a closed-world assumption.
//
// Facts that require seeing every CALL SITE of something — "this component's
// `onSelect` prop is always passed a stable value" — are a different class and
// deliberately not modelled yet. They are only sound under a closed world (no
// dynamic rendering, no prop spreads, nothing re-exported to an unseen
// consumer), so they need a whole-graph pass with an explicit escape analysis,
// not this per-module walk. The `FactKind` union is the extension point when
// that lands; nothing here should be read as already supporting it.

import { parseModule } from '@tsrx/core';
import { analyzeBindings, isInvariantLiteral } from './hook-deps.js';

/** Hooks whose result is identity-stable for the component's lifetime. */
const LIFETIME_STABLE_HOOKS = new Set(['useRef']);

/** Hooks whose result is stable exactly when their dependency list is empty. */
const EMPTY_DEPS_STABLE_HOOKS = new Set(['useMemo', 'useCallback']);

/**
 * Result slots that are stable for each Octane hook returning a tuple. Mirrors
 * hook-deps.js's own table; extraction generalises it to user-defined hooks.
 */
const STABLE_TUPLE_SLOTS = new Map([
	['useState', [1, 2]],
	['useReducer', [1, 2]],
	['useTransition', [1]],
	['useActionState', [1]],
	['useOptimistic', [1]],
]);

const MAX_DEPTH = 4;

const HOOK_IMPORT_HINT = /\bimport\b[^;]*\b(?:unstable_)?use[A-Z]/;

/** `import <clause> from '<request>'`, tolerant of newlines inside the clause. */
const IMPORT_STATEMENT = /\bimport\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;

function unwrap(node) {
	while (
		node &&
		(node.type === 'TSAsExpression' ||
			node.type === 'TSTypeAssertion' ||
			node.type === 'TSNonNullExpression' ||
			node.type === 'TSSatisfiesExpression' ||
			node.type === 'ParenthesizedExpression')
	) {
		node = node.expression;
	}
	return node;
}

function isHookName(name) {
	return typeof name === 'string' && /^(?:unstable_)?use[A-Z]/.test(name);
}

function exportedDeclarationName(node) {
	if (node?.type === 'FunctionDeclaration' && node.id) return node.id.name;
	return null;
}

/**
 * The cheap pre-scan an importer runs on its OWN source: which imported names
 * could a cross-module fact say something about?
 *
 * Deliberately a lexical scan and NOT a parse. This runs on every module the
 * bundler transforms, and parsing here would be a SECOND full parse of the
 * whole program — measured at +27% on top of compile, of which ~97% was the
 * parse itself. A candidate list only has to be a superset: precision comes
 * later, from actually reading the dependency.
 *
 * So over-matching is free — an extra dependency gets resolved and analysed
 * once per build, and yields no fact. Under-matching silently loses an
 * optimisation but can never produce a wrong answer, because a missing fact
 * means "assume nothing". Both error directions are safe, which is what makes
 * a lexical scan the right tool.
 *
 * @param {string} source
 * @param {string} id
 * @returns {{ request: string, imported: string }[]}
 */
export function findFactCandidates(source, id) {
	if (!HOOK_IMPORT_HINT.test(source)) return [];
	const found = new Map();
	IMPORT_STATEMENT.lastIndex = 0;
	let statement;
	while ((statement = IMPORT_STATEMENT.exec(source)) !== null) {
		const request = statement[2];
		if (request === 'octane') continue;
		const braces = statement[1].match(/\{([\s\S]*?)\}/);
		if (braces === null) continue;
		for (const entry of braces[1].split(',')) {
			const parts = entry.trim().split(/\s+as\s+/);
			const imported = parts[0]?.trim();
			const local = (parts[1] ?? parts[0])?.trim();
			if (!imported || !isHookName(imported)) {
				// An alias may carry the hook shape when the export does not.
				if (!local || !isHookName(local)) continue;
			}
			found.set(`${request}\0${imported}`, { request, imported });
		}
	}
	return [...found.values()];
}

/**
 * Is this expression identity-stable across renders of the hook that returns
 * it? `analysis` is hook-deps.js's own lattice for the SAME module, so an
 * identifier is judged by exactly the rule a capture would be.
 */
function stabilityOf(expression, analysis, scopeOfNode) {
	const value = unwrap(expression);
	if (!value) return false;
	if (isInvariantLiteral(value)) return true;
	if (value.type !== 'Identifier') return false;
	const scope = scopeOfNode(value);
	if (!scope) return false;
	let binding = null;
	for (let current = scope; current !== null; current = current.parent) {
		const found = current.bindings.get(value.name);
		if (found !== undefined) {
			binding = found;
			break;
		}
	}
	if (binding === null) return false;
	// `dependencyInvariant` already covers refs, state setters, state getters,
	// module-scope immutable identities, and aliases of any of those.
	if (binding.dependencyInvariant) return true;
	return analysis.__extraStable?.has(binding) === true;
}

/**
 * Mark bindings that dependency inference does not (yet) treat as invariant but
 * whose identity is nonetheless fixed: an empty-dependency `useMemo`/
 * `useCallback` result. Local to fact extraction so it cannot silently change
 * what a dependency array in this same module contains.
 */
function markEmptyDepsStable(ast, analysis) {
	const extra = new Set();
	for (const { decl, bindings, kind } of analysis.declarators) {
		if (kind !== 'const' || decl.id.type !== 'Identifier') continue;
		const init = unwrap(decl.init);
		if (init?.type !== 'CallExpression') continue;
		// Resolve the call to the hook it ACTUALLY is, never the name it is
		// spelled with. A local helper named `useMemo` would otherwise be proven
		// stable — a wrong fact, and so a missed dependency — while an Octane
		// import aliased to another name would never be proven at all.
		if (!EMPTY_DEPS_STABLE_HOOKS.has(analysis.trustedHookNames.get(init))) continue;
		const deps = unwrap(init.arguments?.[1]);
		if (deps?.type !== 'ArrayExpression' || (deps.elements?.length ?? 0) !== 0) continue;
		const binding = bindings[0]?.binding;
		if (binding) extra.add(binding);
	}
	analysis.__extraStable = extra;
}

/** Collect the return expressions of a function, not descending into nested ones. */
function returnExpressions(fn) {
	const out = [];
	const visit = (node, root) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, root);
			return;
		}
		if (!root && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')) {
			return;
		}
		if (!root && node.type === 'ArrowFunctionExpression') return;
		if (node.type === 'ReturnStatement') {
			out.push(node.argument ?? null);
			return;
		}
		for (const key in node) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
			if (key === 'parent') continue;
			visit(node[key], false);
		}
	};
	if (fn.body?.type !== 'BlockStatement') {
		out.push(fn.body);
		return out;
	}
	visit(fn.body, true);
	return out;
}

/**
 * Facts about every exported hook in one module's source.
 *
 * Fails closed throughout: an export this cannot prove something about is
 * simply absent from the map, and every consumer must treat absence as "assume
 * nothing", which is the behaviour that predates this module.
 *
 * @param {string} source
 * @param {string} id
 * @returns {Map<string, { kind: 'hook', stableResult: boolean, stableTupleSlots: number[] | null, forwards: { request: string, imported: string } | null }>}
 */
export function extractModuleFacts(source, id) {
	const facts = new Map();
	let ast;
	try {
		ast = parseModule(source, id);
	} catch {
		return facts;
	}

	let analysis;
	try {
		analysis = analyzeBindings(ast);
	} catch {
		return facts;
	}
	markEmptyDepsStable(ast, analysis);
	const scopeOfNode = (node) => analysis.nodeScopes.get(node) ?? null;

	// Resolve a callee to the IMPORT it actually refers to, through the scope
	// walk rather than by spelling. A parameter or local named `useRef` shadows
	// the import at that call site, and inheriting the import's stability there
	// would prove a freshly allocated value stable — a wrong fact, and so a
	// missed dependency in every module that calls this hook.
	const calleeBinding = (callee) => {
		if (callee?.type !== 'Identifier') return null;
		const scope = analysis.nodeScopes.get(callee);
		if (!scope) return null;
		for (let current = scope; current !== null; current = current.parent) {
			const binding = current.bindings.get(callee.name);
			if (binding !== undefined) return binding.imported ? binding : null;
		}
		return null;
	};
	const octaneHookOf = (callee) => calleeBinding(callee)?.octaneImport ?? null;
	const importOriginOf = (callee) => {
		const binding = calleeBinding(callee);
		if (binding === null || binding.octaneImport !== null) return null;
		if (binding.importRequest === null || binding.importedName === null) return null;
		if (!isHookName(binding.importedName) && !isHookName(binding.name)) return null;
		return { request: binding.importRequest, imported: binding.importedName };
	};

	const exportedFunctions = [];
	for (const node of ast.body || []) {
		if (node.type === 'ExportNamedDeclaration' && node.declaration) {
			const name = exportedDeclarationName(node.declaration);
			if (name) exportedFunctions.push([name, node.declaration]);
			else if (node.declaration.type === 'VariableDeclaration') {
				for (const decl of node.declaration.declarations || []) {
					const init = unwrap(decl.init);
					if (
						decl.id?.type === 'Identifier' &&
						(init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')
					) {
						exportedFunctions.push([decl.id.name, init]);
					}
				}
			}
		}
	}

	for (const [name, fn] of exportedFunctions) {
		if (!isHookName(name)) continue;
		const returns = returnExpressions(fn);
		if (returns.length === 0 || returns.some((r) => r === null)) continue;

		// A transparent re-export — `return useDispatch()` — defers to the module
		// that actually defines the behaviour. The caller resolves it recursively.
		if (returns.length === 1) {
			const only = unwrap(returns[0]);
			if (only?.type === 'CallExpression') {
				const callee = unwrap(only.callee);
				const origin = importOriginOf(callee);
				if (origin) {
					facts.set(name, {
						kind: 'hook',
						stableResult: false,
						stableTupleSlots: null,
						forwards: origin,
					});
					continue;
				}
				// A direct octane hook result: `return useRef(null)`.
				const octaneName = octaneHookOf(callee);
				if (octaneName && LIFETIME_STABLE_HOOKS.has(octaneName)) {
					facts.set(name, {
						kind: 'hook',
						stableResult: true,
						stableTupleSlots: null,
						forwards: null,
					});
					continue;
				}
				if (octaneName && STABLE_TUPLE_SLOTS.has(octaneName)) {
					facts.set(name, {
						kind: 'hook',
						stableResult: false,
						stableTupleSlots: STABLE_TUPLE_SLOTS.get(octaneName),
						forwards: null,
					});
					continue;
				}
			}
		}

		// A tuple return gets per-slot facts; every return must agree.
		const tupleReturns = returns.map(unwrap).filter((r) => r?.type === 'ArrayExpression');
		if (tupleReturns.length === returns.length && tupleReturns.length > 0) {
			const width = tupleReturns[0].elements?.length ?? 0;
			if (tupleReturns.every((r) => (r.elements?.length ?? 0) === width)) {
				const slots = [];
				for (let i = 0; i < width; i++) {
					if (tupleReturns.every((r) => stabilityOf(r.elements[i], analysis, scopeOfNode))) {
						slots.push(i);
					}
				}
				facts.set(name, {
					kind: 'hook',
					stableResult: false,
					stableTupleSlots: slots.length > 0 ? slots : null,
					forwards: null,
				});
				continue;
			}
		}

		if (returns.every((r) => stabilityOf(r, analysis, scopeOfNode))) {
			facts.set(name, { kind: 'hook', stableResult: true, stableTupleSlots: null, forwards: null });
		}
	}

	return facts;
}

/**
 * The bundler-agnostic graph walk.
 *
 * `resolve(request, importer)` returns an absolute path or null; `readFile`
 * returns source text or null. Vite supplies these from `this.resolve` plus
 * fs; rspack from `getResolve` plus fs. Neither needs a module graph, so both
 * get identical answers.
 *
 * `onFileUsed` receives every file a fact was read from, so the caller can
 * register it as a watch dependency — without that, an edit to a dependency
 * leaves stale output in the importer.
 *
 * @param {{ resolve: (request: string, importer: string) => Promise<string | null>, readFile: (path: string) => Promise<string | null>, onFileUsed?: (path: string) => void, maxDepth?: number }} io
 */
export function createFactResolver(io) {
	const maxDepth = io.maxDepth ?? MAX_DEPTH;
	// The parse cache belongs to the BUILD, not to one importer. Every module
	// that imports the same hook asks about the same file, so a per-resolver
	// cache re-reads and re-parses each dependency once per importer — measured
	// at +29% on a real build. `createFactCache()` is shared across a build and
	// pruned by the integration when a file changes.
	const cache = io.cache ?? createFactCache();

	async function factsForFile(path) {
		let cached = cache.files.get(path);
		if (cached !== undefined) return cached;
		const source = await io.readFile(path);
		cached = source === null ? new Map() : extractModuleFacts(source, path);
		cache.files.set(path, cached);
		return cached;
	}

	async function resolvePath(request, importer) {
		const key = `${request}\0${importer}`;
		let path = cache.resolved.get(key);
		if (path !== undefined) return path;
		try {
			path = await io.resolve(request, importer);
		} catch {
			path = null;
		}
		cache.resolved.set(key, path);
		return path;
	}

	/**
	 * @param {string} request
	 * @param {string} imported
	 * @param {string} importer
	 */
	async function factFor(request, imported, importer, depth = 0, seen = new Set()) {
		if (depth > maxDepth) return null;
		const path = await resolvePath(request, importer);
		if (path === null || path === undefined) return null;
		const key = `${path}\0${imported}`;
		if (seen.has(key)) return null; // cycle — unprovable, fail closed
		seen.add(key);
		io.onFileUsed?.(path);
		const facts = await factsForFile(path);
		const fact = facts.get(imported);
		if (fact === undefined) return null;
		if (fact.forwards !== null) {
			return factFor(fact.forwards.request, fact.forwards.imported, path, depth + 1, seen);
		}
		return fact;
	}

	return {
		factFor,
		/** Test/diagnostic seam: how many files were parsed for facts. */
		get analysedFileCount() {
			return cache.files.size;
		},
	};
}

/**
 * Resolve a pre-scanned candidate list into a fact lookup. Integrations supply
 * only their own `resolve`/`readFile` and get identical answers.
 *
 * The candidate scan is deliberately NOT done here: it is synchronous, and a
 * module with no candidates — the overwhelmingly common case — must stay on the
 * caller's existing synchronous path rather than being forced through a
 * promise. Callers run `findFactCandidates` first and skip this entirely when
 * it comes back empty.
 *
 * The returned lookup is synchronous because every fact it can answer has
 * already been resolved; that is what lets `compile()` stay synchronous.
 *
 * Cache lifetime belongs to the CALLER. A resolver held across a watch rebuild
 * would serve facts from a dependency's previous contents, so integrations
 * create one per build and rely on `onFileUsed` to invalidate importers.
 *
 * @param {string} source
 * @param {string} id
 * @param {{ resolve: (request: string, importer: string) => Promise<string | null>, readFile: (path: string) => Promise<string | null>, onFileUsed?: (path: string) => void }} io
 * @returns {Promise<((request: string, imported: string) => any) | null>}
 */
export function createFactCache() {
	return { files: new Map(), resolved: new Map() };
}

/**
 * Forget everything derived from a file, so the next lookup re-reads it. The
 * resolution map is cleared wholesale because a new file on disk can change
 * what an unrelated specifier resolves to, and it is cheap to rebuild.
 *
 * @param {ReturnType<typeof createFactCache>} cache
 * @param {string} path
 */
export function invalidateFactCache(cache, path) {
	cache.files.delete(path);
	cache.resolved.clear();
}

export async function resolveHookStability(candidates, id, io) {
	if (candidates.length === 0) return null;
	const resolver = createFactResolver(io);
	const facts = new Map();
	await Promise.all(
		candidates.map(async ({ request, imported }) => {
			const fact = await resolver.factFor(request, imported, id);
			if (fact !== null) facts.set(`${request}\0${imported}`, fact);
		}),
	);
	if (facts.size === 0) return null;
	return (request, imported) => facts.get(`${request}\0${imported}`) ?? null;
}
