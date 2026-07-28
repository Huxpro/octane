import { describe, expect, it } from 'vitest';
import { compile } from 'octane/compiler';
import {
	createFactCache,
	createFactResolver,
	extractModuleFacts,
	findFactCandidates,
	invalidateFactCache,
} from '../src/compiler/module-facts.js';

// Cross-module facts let a single-module compile answer a question about an
// import by READING it, instead of assuming. The contract has two halves:
//
//   - extraction is a property of one module's own source, so it is cacheable
//     per file and needs no closed-world assumption;
//   - every consumer treats an absent fact as "assume nothing", so an
//     unanalysable dependency reproduces the behaviour that predates facts.
//
// The second half is what makes this safe: the failure mode of the whole
// mechanism is the status quo, never a missed dependency.

const factsOf = (source: string) =>
	Object.fromEntries(
		[...extractModuleFacts(source, 'm.ts')].map(([name, fact]) => [
			name,
			fact.forwards
				? `forwards:${fact.forwards.request}`
				: fact.stableResult
					? 'stable'
					: fact.stableTupleSlots
						? `slots:${fact.stableTupleSlots.join(',')}`
						: 'unproven',
		]),
	);

describe('module facts — extraction', () => {
	it('proves a hook returning a ref result', () => {
		expect(
			factsOf(`
        import { useRef } from 'octane';
        export function useLatest(value) { const r = useRef(value); r.current = value; return r; }
      `),
		).toEqual({ useLatest: 'stable' });
	});

	it('proves a hook returning a state updater', () => {
		expect(
			factsOf(`
        import { useState } from 'octane';
        export function useDispatch() { const [, dispatch] = useState(null); return dispatch; }
      `),
		).toEqual({ useDispatch: 'stable' });
	});

	it('reports per-slot stability for a tuple return', () => {
		expect(
			factsOf(`
        import { useState } from 'octane';
        export function useToggle(initial) {
          const [on, setOn] = useState(initial);
          return [on, setOn];
        }
      `),
		).toEqual({ useToggle: 'slots:1' });
	});

	it('proves an empty-dependency callback result', () => {
		expect(
			factsOf(`
        import { useCallback } from 'octane';
        export function useNoop() { const cb = useCallback(() => {}, []); return cb; }
      `),
		).toEqual({ useNoop: 'stable' });
	});

	it('proves a hook returning a module-scope constant', () => {
		expect(
			factsOf(`
        const NOOP = () => {};
        export function useNoop() { return NOOP; }
      `),
		).toEqual({ useNoop: 'stable' });
	});

	it('proves an arrow-function export', () => {
		expect(
			factsOf(`
        import { useRef } from 'octane';
        export const useBox = () => { const r = useRef(null); return r; };
      `),
		).toEqual({ useBox: 'stable' });
	});

	it('records a transparent re-export for the resolver to follow', () => {
		expect(
			factsOf(`
        import { useDispatch as inner } from '@fake/store';
        export function useDispatch() { return inner(); }
      `),
		).toEqual({ useDispatch: 'forwards:@fake/store' });
	});
});

describe('module facts — what stays unproven', () => {
	// Each of these is a value whose identity really can change, so proving it
	// stable would produce a missed dependency. Absence is the correct answer.

	it('leaves a live-dependency callback unproven', () => {
		expect(
			factsOf(`
        import { useCallback } from 'octane';
        export function useHandler(v) { const cb = useCallback(() => v, [v]); return cb; }
      `),
		).toEqual({});
	});

	it('leaves a freshly allocated object unproven', () => {
		expect(
			factsOf(`
        import { useState } from 'octane';
        export function useThing() { const [a] = useState(0); return { a }; }
      `),
		).toEqual({});
	});

	it('leaves a locally defined hook that merely SPELLS useCallback unproven', () => {
		// Proving this stable would be a wrong fact, and so a missed dependency.
		expect(
			factsOf(`
        function useCallback(fn, deps) { return () => fn(deps); }
        export function useNoop(v) { const cb = useCallback(() => v, []); return cb; }
      `),
		).toEqual({});
	});

	it('proves an Octane hook that was aliased away from its own name', () => {
		expect(
			factsOf(`
        import { useCallback as memo } from 'octane';
        export function useNoop() { const cb = memo(() => {}, []); return cb; }
      `),
		).toEqual({ useNoop: 'stable' });
	});

	it('leaves a shadowed octane hook name unproven', () => {
		// The parameter shadows the import at the call site, so the returned value
		// is whatever the CALLER passed — proving it stable would be a wrong fact.
		expect(
			factsOf(`
        import { useRef } from 'octane';
        export function useThing(useRef) { return useRef(); }
      `),
		).toEqual({});
	});

	it('leaves a shadowed third-party hook name un-forwarded', () => {
		expect(
			factsOf(`
        import { useDispatch } from '@fake/store';
        export function useThing() {
          const useDispatch = () => ({ fresh: true });
          return useDispatch();
        }
      `),
		).toEqual({});
	});

	it('leaves a hook with disagreeing return paths unproven', () => {
		expect(
			factsOf(`
        import { useRef } from 'octane';
        export function useMaybe(flag) { const r = useRef(null); if (flag) return r; return {}; }
      `),
		).toEqual({});
	});

	it('leaves state VALUE slots reactive while proving the updater', () => {
		const facts = extractModuleFacts(
			`
        import { useState } from 'octane';
        export function usePair() { const [a, setA] = useState(0); return [a, setA]; }
      `,
			'm.ts',
		);
		// Slot 0 is the value and must not appear.
		expect(facts.get('usePair')?.stableTupleSlots).toEqual([1]);
	});

	it('returns nothing for a module it cannot parse', () => {
		expect(factsOf('export function useX( {{{')).toEqual({});
	});
});

describe('module facts — candidate pre-scan', () => {
	it('finds imported hook-shaped names and ignores everything else', () => {
		expect(
			findFactCandidates(
				`
        import { useDispatch } from '@fake/store';
        import { useEffect } from 'octane';
        import { unrelated } from './util';
        export function App(props) { const d = useDispatch(); useEffect(() => d(unrelated)); }
      `,
				'a.tsx',
			),
		).toEqual([{ request: '@fake/store', imported: 'useDispatch' }]);
	});

	it('sees through an import alias', () => {
		expect(
			findFactCandidates(
				`
        import { useDispatch as grab } from '@fake/store';
        export function App() { const d = grab(); return d; }
      `,
				'a.tsx',
			),
		).toEqual([{ request: '@fake/store', imported: 'useDispatch' }]);
	});

	it('costs nothing for a module with no candidates', () => {
		expect(findFactCandidates(`export const a = 1;`, 'a.ts')).toEqual([]);
	});

	it('sees a hook behind the unstable_ staging prefix', () => {
		// `isHookName` accepts the prefix, so the cheap gate in front of the scan
		// has to accept it too, or those imports are silently never looked up.
		expect(findFactCandidates(`import { unstable_useThing } from '@fake/store';`, 'a.tsx')).toEqual(
			[{ request: '@fake/store', imported: 'unstable_useThing' }],
		);
	});

	it('reads a clause split across lines', () => {
		expect(
			findFactCandidates(
				`import {\n  useDispatch,\n  useStoreRef as ref,\n} from '@fake/store';`,
				'a.tsx',
			),
		).toEqual([
			{ request: '@fake/store', imported: 'useDispatch' },
			{ request: '@fake/store', imported: 'useStoreRef' },
		]);
	});

	it('does not parse the module', () => {
		// The scan runs on every module the bundler transforms, so it must stay
		// lexical. Syntactically invalid source still yields its imports.
		expect(
			findFactCandidates(`import { useThing } from '@fake/store'; function ( {{{`, 'a.tsx'),
		).toEqual([{ request: '@fake/store', imported: 'useThing' }]);
	});
});

describe('module facts — resolver graph walk', () => {
	const moduleGraph: Record<string, string> = {
		'/store.js': `
      import { useState, useRef } from 'octane';
      export function useDispatch() { const [, d] = useState(null); return d; }
      export function useStoreRef() { const r = useRef(null); return r; }
      export function useSelected(sel) { const [v] = useState(sel); return v; }
    `,
		'/reexport.js': `
      import { useDispatch as inner } from '/store.js';
      export function useDispatch() { return inner(); }
    `,
		'/cycle-a.js': `
      import { useLoop as b } from '/cycle-b.js';
      export function useLoop() { return b(); }
    `,
		'/cycle-b.js': `
      import { useLoop as a } from '/cycle-a.js';
      export function useLoop() { return a(); }
    `,
	};

	const makeResolver = (used: string[] = []) =>
		createFactResolver({
			resolve: async (request) => (request in moduleGraph ? request : null),
			readFile: async (path) => moduleGraph[path] ?? null,
			onFileUsed: (path) => used.push(path),
		});

	it('resolves a fact through the graph', async () => {
		const resolver = makeResolver();
		expect((await resolver.factFor('/store.js', 'useDispatch', '/app.tsx'))?.stableResult).toBe(
			true,
		);
	});

	it('follows a transparent re-export to the defining module', async () => {
		const resolver = makeResolver();
		expect((await resolver.factFor('/reexport.js', 'useDispatch', '/app.tsx'))?.stableResult).toBe(
			true,
		);
	});

	it('reports every file a fact was read from, for watch registration', async () => {
		const used: string[] = [];
		const resolver = makeResolver(used);
		await resolver.factFor('/reexport.js', 'useDispatch', '/app.tsx');
		// Both the re-export and the module it forwards to must invalidate the
		// importer when edited, or a watch rebuild serves stale output.
		expect(used).toContain('/reexport.js');
		expect(used).toContain('/store.js');
	});

	it('terminates on a cycle instead of recursing forever', async () => {
		const resolver = makeResolver();
		expect(await resolver.factFor('/cycle-a.js', 'useLoop', '/app.tsx')).toBeNull();
	});

	it('parses each module once across repeated lookups', async () => {
		const resolver = makeResolver();
		await resolver.factFor('/store.js', 'useDispatch', '/app.tsx');
		await resolver.factFor('/store.js', 'useStoreRef', '/app.tsx');
		await resolver.factFor('/store.js', 'useSelected', '/app.tsx');
		expect(resolver.analysedFileCount).toBe(1);
	});

	it('resolves a forwarded specifier against the module that forwards it', async () => {
		// The importer changes as the walk follows a re-export. Resolving every hop
		// against the ORIGINAL module would read a different file for a relative
		// specifier, and prove stability from the wrong source.
		const importers: string[] = [];
		const resolver = createFactResolver({
			resolve: async (request, importer) => {
				importers.push(importer);
				return request in moduleGraph ? request : null;
			},
			readFile: async (path) => moduleGraph[path] ?? null,
		});
		await resolver.factFor('/reexport.js', 'useDispatch', '/app.tsx');
		expect(importers).toEqual(['/app.tsx', '/reexport.js']);
	});

	it('re-reads a file after its cache entry is invalidated', async () => {
		// The cache is shared across a build so a dependency is parsed once rather
		// than once per importer. That makes pruning it the ONLY thing standing
		// between a changed dependency and a stale fact — a hook that stops being
		// stable would otherwise keep proving stable, and its callers would keep
		// dropping a live capture. Both plugins depend on this contract: Vite from
		// `hotUpdate` and `watchChange`, Rspack by scoping the cache per
		// compilation.
		const files: Record<string, string> = {
			'/hook.js': `
        import { useRef } from 'octane';
        export function useThing() { const r = useRef(null); return r; }
      `,
		};
		const cache = createFactCache();
		const make = () =>
			createFactResolver({
				cache,
				resolve: async (request) => (request in files ? request : null),
				readFile: async (path) => files[path] ?? null,
			});

		expect((await make().factFor('/hook.js', 'useThing', '/app.tsx'))?.stableResult).toBe(true);

		// The same hook now allocates a fresh object on every call.
		files['/hook.js'] = `
      import { useState } from 'octane';
      export function useThing() { const [n] = useState(0); return { n }; }
    `;

		// A fresh resolver over the SAME cache still answers from the old parse.
		expect((await make().factFor('/hook.js', 'useThing', '/app.tsx'))?.stableResult).toBe(true);

		invalidateFactCache(cache, '/hook.js');
		expect(await make().factFor('/hook.js', 'useThing', '/app.tsx')).toBeNull();
	});

	it('does not restore a stale fact after invalidation races an in-flight read', async () => {
		const stableSource = `
      import { useRef } from 'octane';
      export function useThing() { const r = useRef(null); return r; }
    `;
		const reactiveSource = `
      import { useState } from 'octane';
      export function useThing() { const [n] = useState(0); return { n }; }
    `;
		let source = stableSource;
		let releaseRead!: () => void;
		const readReleased = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		let reportReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			reportReadStarted = resolve;
		});
		let reads = 0;
		const cache = createFactCache();
		const make = () =>
			createFactResolver({
				cache,
				resolve: async () => '/hook.js',
				readFile: async () => {
					reads++;
					const captured = source;
					if (reads === 1) {
						reportReadStarted();
						await readReleased;
					}
					return captured;
				},
			});

		const staleLookup = make().factFor('/hook.js', 'useThing', '/app.tsx');
		await readStarted;
		source = reactiveSource;
		invalidateFactCache(cache, '/hook.js');
		releaseRead();

		expect(await staleLookup).toBeNull();
		expect(await make().factFor('/hook.js', 'useThing', '/app.tsx')).toBeNull();
		expect(reads).toBe(2);
	});

	it('does not restore a stale resolution after invalidation races an in-flight resolve', async () => {
		let resolvedPath = '/old-hook.js';
		let releaseResolve!: () => void;
		const resolveReleased = new Promise<void>((resolve) => {
			releaseResolve = resolve;
		});
		let reportResolveStarted!: () => void;
		const resolveStarted = new Promise<void>((resolve) => {
			reportResolveStarted = resolve;
		});
		let resolves = 0;
		const readPaths: string[] = [];
		const cache = createFactCache();
		const make = () =>
			createFactResolver({
				cache,
				resolve: async () => {
					resolves++;
					const captured = resolvedPath;
					if (resolves === 1) {
						reportResolveStarted();
						await resolveReleased;
					}
					return captured;
				},
				readFile: async (path) => {
					readPaths.push(path);
					return path === '/old-hook.js'
						? `import { useRef } from 'octane';
               export function useThing() { return useRef(null); }`
						: `export function useThing() { return {}; }`;
				},
			});

		const staleLookup = make().factFor('./hook.js', 'useThing', '/app.tsx');
		await resolveStarted;
		resolvedPath = '/new-hook.js';
		invalidateFactCache(cache, '/new-hook.js');
		releaseResolve();

		expect(await staleLookup).toBeNull();
		expect(await make().factFor('./hook.js', 'useThing', '/app.tsx')).toBeNull();
		expect(readPaths).toEqual(['/new-hook.js']);
	});

	it('returns null for an unresolvable or unreadable dependency', async () => {
		const resolver = makeResolver();
		expect(await resolver.factFor('/nope.js', 'useThing', '/app.tsx')).toBeNull();
	});
});

describe('module facts — effect on inferred dependencies', () => {
	const source = `
    import { useEffect, useCallback } from 'octane';
    import { useDispatch, useStoreRef, useSelected } from '@fake/store';
    export function App(props) @{
      const dispatch = useDispatch();
      const storeRef = useStoreRef();
      const selected = useSelected(props.sel);
      useEffect(() => { dispatch(props.action); storeRef.current = selected; });
      const onClick = useCallback(() => dispatch(selected));
      <button onClick={onClick}>{selected as string}</button>
    }
  `;

	const depsOf = (code: string) =>
		[...code.matchAll(/\[([^[\]]*)\],\s*(?:\d+|_h\$\d+)\s*\)/g)].map((m) =>
			m[1].replace(/\s+/g, ' ').trim(),
		);

	const stability = {
		'@fake/store useDispatch': { stableResult: true, stableTupleSlots: null },
		'@fake/store useStoreRef': { stableResult: true, stableTupleSlots: null },
	} as Record<string, { stableResult: boolean; stableTupleSlots: number[] | null }>;

	it('keeps every imported hook result reactive when no facts are supplied', () => {
		const code = compile(source, 'App.tsrx', { inlineHookMemo: false }).code;
		expect(depsOf(code)).toEqual([
			'dispatch, props.action, storeRef, selected',
			'dispatch, selected',
		]);
	});

	it('drops the results a fact proves stable, and only those', () => {
		const code = compile(source, 'App.tsrx', {
			inlineHookMemo: false,
			importedHookStability: (request: string, imported: string) =>
				stability[`${request} ${imported}`] ?? null,
		}).code;

		// `selected` is genuinely reactive state and must survive.
		expect(depsOf(code)).toEqual(['props.action, selected', 'selected']);
	});

	it('is a no-op when the fact says the result is not stable', () => {
		const code = compile(source, 'App.tsrx', {
			inlineHookMemo: false,
			importedHookStability: () => ({ stableResult: false, stableTupleSlots: null }),
		}).code;

		expect(depsOf(code)).toEqual([
			'dispatch, props.action, storeRef, selected',
			'dispatch, selected',
		]);
	});

	it('applies tuple-slot facts to a destructured import result', () => {
		const tupleSource = `
      import { useEffect } from 'octane';
      import { useToggle } from '@fake/store';
      export function App(props) @{
        const [on, setOn] = useToggle(false);
        useEffect(() => { props.log(on); setOn(true); });
        <div />
      }
    `;
		const code = compile(tupleSource, 'App.tsrx', {
			inlineHookMemo: false,
			importedHookStability: () => ({ stableResult: false, stableTupleSlots: [1] }),
		}).code;

		// `on` is the value and stays; `setOn` is proven stable and goes.
		expect(depsOf(code)).toEqual(['props.log, on']);
	});
});
