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
import {
	createObjectContainer,
	createObjectDriver,
	createUniversalRoot,
	defineUniversalComponent,
	flushUniversalSync,
	startTransition,
	universalPlan,
	universalValue,
	useReducer,
	useId,
	useState,
	useTransition,
} from '../src/universal.js';

describe('universal kernel boundary', () => {
	it('imports nothing — dependencies enter as type parameters only', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'packages/octane/src/universal-kernel.ts'),
			'utf8',
		);
		expect(source).not.toMatch(/^\s*import[\s{]/m);
		expect(source).not.toMatch(/\brequire\s*\(/);
	});

	it('keeps the extracted helpers behaviorally intact standalone', async () => {
		const kernel = await import('../src/universal-kernel.js');
		// This pins the helpers' own contracts only. The guarantee that the
		// core still renders through these cells rests on the universal-*
		// behavioral suites (universal-scheduling, universal-event-scope,
		// universal-retained-suspense, universal-activity), which exercise the
		// same code paths end-to-end.
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

	it('routes captured state and reducer updates through their mounted universal owner', async () => {
		const container = createObjectContainer();
		const root = createUniversalRoot(container, createObjectDriver());
		const plan = universalPlan('object', {
			kind: 'host',
			type: 'node',
			bindings: [
				['state', 0],
				['reduced', 1],
			],
		});
		let setState!: (value: number) => void;
		let dispatch!: (value: number) => void;
		const Component = defineUniversalComponent('object', () => {
			const [state, updateState] = useState(1, 'state');
			const [reduced, updateReduced] = useReducer(
				(value: number, action: number) => value + action,
				2,
				'reducer',
			);
			setState = updateState;
			dispatch = updateReduced;
			return universalValue(plan, [state, reduced]);
		});

		root.render(Component, undefined);
		flushUniversalSync(() => {
			setState(3);
			dispatch(4);
		});

		expect(container.children[0].props).toMatchObject({ state: 3, reduced: 6 });
		expect(container.commits).toHaveLength(2);

		root.unmount();
		const commitsAfterUnmount = container.commits.length;
		setState(9);
		dispatch(9);
		await Promise.resolve();
		expect(container.commits).toHaveLength(commitsAfterUnmount);
	});

	it('publishes one transition pending lifecycle before the staged owner update', async () => {
		const container = createObjectContainer();
		const root = createUniversalRoot(container, createObjectDriver());
		const pendingPlan = universalPlan('object', {
			kind: 'host',
			type: 'pending',
			bindings: [['value', 0]],
		});
		const countPlan = universalPlan('object', {
			kind: 'host',
			type: 'count',
			bindings: [['value', 0]],
		});
		const renders: string[] = [];
		let begin!: () => void;
		const Component = defineUniversalComponent('object', () => {
			const [count, setCount] = useState(0, 'count');
			const [pending] = useTransition('transition');
			begin = () => startTransition(() => setCount(1));
			renders.push(`${pending}:${count}`);
			return [universalValue(pendingPlan, [pending]), universalValue(countPlan, [count])];
		});

		root.render(Component, undefined);
		begin();
		for (let index = 0; index < 6; index++) await Promise.resolve();

		expect(renders).toContain('true:0');
		expect(renders.at(-1)).toBe('false:1');
		expect(container.children.map((child) => child.props.value)).toEqual([false, 1]);
		root.unmount();
	});

	it('allocates distinct opaque ids through the injected root service', () => {
		const container = createObjectContainer();
		const root = createUniversalRoot(container, createObjectDriver());
		const plan = universalPlan('object', {
			kind: 'host',
			type: 'ids',
			bindings: [
				['first', 0],
				['second', 1],
			],
		});
		const Component = defineUniversalComponent('object', () =>
			universalValue(plan, [useId('first'), useId('second')]),
		);

		root.render(Component, undefined);
		const { first, second } = container.children[0].props;
		expect(first).toMatch(/^:octane-u[0-9a-z]+:$/);
		expect(second).toMatch(/^:octane-u[0-9a-z]+:$/);
		expect(second).not.toBe(first);
		root.unmount();
	});
});
