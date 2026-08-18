// The hook-cell kernel's contract is host-neutrality: owner records, roots,
// hosts, commands, and schedulers may enter only as type parameters, never as
// imports (docs/lynx-specialized-target-l0.md §5). This dependency boundary
// is what lets a Lynx-specialized core share the cells without dragging the
// universal command layer along, so pin it structurally alongside the
// behavioral guard suites (universal-scheduling, universal-event-scope,
// universal-retained-suspense, universal-activity).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('universal kernel boundary', () => {
	it('imports nothing — dependencies enter as type parameters only', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'packages/octane/src/universal-kernel.ts'),
			'utf8',
		);
		expect(source).not.toMatch(/^\s*import[\s{]/m);
		expect(source).not.toMatch(/\brequire\s*\(/);
	});

	it('stays wired into the core: cells created by hooks are kernel shapes', async () => {
		const kernel = await import('../src/universal-kernel.js');
		// The runtime slice of the kernel is small and callable directly; the
		// behavioral coverage lives in the universal-* suites, so assert only
		// that the extracted helpers are the ones the core executes.
		const runs: string[] = [];
		const hook = {
			kind: 'effect' as const,
			owner: null,
			slot: 's',
			phase: 'passive' as const,
			create: () => {
				runs.push('create');
				return () => runs.push('cleanup');
			},
			deps: null,
			cleanup: null,
			mounted: false,
			previous: null,
		};
		kernel.runEffectCreate(hook);
		expect(hook.mounted).toBe(true);
		kernel.runEffectCleanup(hook);
		expect(hook.mounted).toBe(false);
		expect(runs).toEqual(['create', 'cleanup']);
		expect(kernel.depsEqual([1, NaN], [1, NaN])).toBe(true);
		expect(kernel.depsEqual([1], [2])).toBe(false);
		expect(kernel.depsEqual(null, [])).toBe(false);
	});
});
