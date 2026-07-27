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

const HOOK_IMPORT_HINT = /\bimport\b[^;]*\buse[A-Z]/;

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
 * are used in a position where a cross-module fact could change the answer?
 *
 * Only `use*` calls whose result is bound by a `const` qualify today — that is
 * the shape whose stability feeds dependency inference. Returning `[]` here is
 * the common case and costs the caller nothing beyond this parse.
 *
 * @param {string} source
 * @param {string} id
 * @returns {{ request: string, imported: string }[]}
 */
export function findFactCandidates(source, id) {
	// The overwhelming majority of modules import no custom hook at all. A
	// substring gate keeps them off the parse path entirely — this pre-scan is a
	// SECOND parse of every module, so it has to cost nothing when it finds
	// nothing. Over-matching is free (the parse then finds no candidates);
	// under-matching would silently lose facts, so the pattern stays loose.
	if (!HOOK_IMPORT_HINT.test(source)) return [];
	let ast;
	try {
		ast = parseModule(source, id);
	} catch {
		return [];
	}
	// local name -> { request, imported }
	const imports = new Map();
	for (const node of ast.body || []) {
		if (node.type !== 'ImportDeclaration') continue;
		const request = node.source?.value;
		if (typeof request !== 'string' || request === 'octane') continue;
		for (const specifier of node.specifiers || []) {
			const local = specifier.local?.name;
			const imported = specifier.imported?.name ?? 'default';
			// Either spelling may carry the hook shape: `import { useX as x }`
			// aliases away the convention, and the local name is what the call
			// site uses.
			if (local && (isHookName(local) || isHookName(imported))) {
				imports.set(local, { request, imported });
			}
		}
	}
	if (imports.size === 0) return [];

	const found = new Map();
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (node.type === 'VariableDeclarator') {
			const init = unwrap(node.init);
			const callee = init?.type === 'CallExpression' ? unwrap(init.callee) : null;
			if (callee?.type === 'Identifier') {
				const hit = imports.get(callee.name);
				if (hit) found.set(`${hit.request}\0${hit.imported}`, hit);
			}
		}
		for (const key in node) {
			if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
			if (key === 'parent') continue;
			visit(node[key]);
		}
	};
	visit(ast.body);
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
		const callee = unwrap(init.callee);
		if (callee?.type !== 'Identifier' || !EMPTY_DEPS_STABLE_HOOKS.has(callee.name)) continue;
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

	// Which octane hooks are in lexical scope, and under what local name.
	const octaneLocals = new Map();
	const importedHookOrigins = new Map();
	for (const node of ast.body || []) {
		if (node.type !== 'ImportDeclaration') continue;
		const request = node.source?.value;
		for (const specifier of node.specifiers || []) {
			const local = specifier.local?.name;
			const imported = specifier.imported?.name;
			if (!local) continue;
			if (request === 'octane') octaneLocals.set(local, imported);
			else if (typeof request === 'string' && (isHookName(local) || isHookName(imported))) {
				importedHookOrigins.set(local, { request, imported: imported ?? 'default' });
			}
		}
	}

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
				const origin = callee?.type === 'Identifier' ? importedHookOrigins.get(callee.name) : null;
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
				const octaneName = callee?.type === 'Identifier' ? octaneLocals.get(callee.name) : null;
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
	/** @type {Map<string, Map<string, any>>} */
	const byFile = new Map();

	async function factsForFile(path) {
		let cached = byFile.get(path);
		if (cached !== undefined) return cached;
		const source = await io.readFile(path);
		cached = source === null ? new Map() : extractModuleFacts(source, path);
		byFile.set(path, cached);
		return cached;
	}

	/**
	 * @param {string} request
	 * @param {string} imported
	 * @param {string} importer
	 */
	async function factFor(request, imported, importer, depth = 0, seen = new Set()) {
		if (depth > maxDepth) return null;
		let path;
		try {
			path = await io.resolve(request, importer);
		} catch {
			return null;
		}
		if (path === null) return null;
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
			return byFile.size;
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
