import { describe, expect, it } from 'vitest';
import { compile } from 'octane/compiler';
import {
	createFactResolver,
	extractModuleFacts,
	findFactCandidates,
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
	it('finds only imported hooks whose result is bound', () => {
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
