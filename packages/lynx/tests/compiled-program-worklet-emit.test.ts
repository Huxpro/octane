import { describe, expect, it } from 'vitest';

import type { UniversalHostTemplateProgram } from 'octane/universal/native';

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import type { LynxElementPAPI } from '../src/core/papi.js';
import { createFakePAPI, type FakeNode } from './_fixtures/fake-element-papi.js';

const PROGRAM: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'class', valueIndex: 0 },
				{ name: 'main-thread:bindtap', valueIndex: 1 },
				{ name: 'main-thread:ref', valueIndex: 2 },
			],
		},
	],
	events: [],
};

type CompiledCreate = ((
	pageId: unknown,
	classes: unknown,
	worklet: unknown,
	ref: unknown,
) => FakeNode[]) & {
	run(
		pageId: unknown,
		count: number,
		values: readonly unknown[],
		events: readonly unknown[],
		ranges: readonly unknown[],
		out: (FakeNode | undefined)[],
	): void;
	set(nodes: readonly (FakeNode | undefined)[], slot: number, value: unknown): boolean;
};

function compile(papi: LynxElementPAPI<FakeNode>): CompiledCreate {
	const emission = emitLynxMainThreadProgram(PROGRAM, {
		name: 'WorkletHost',
		slotUpdates: true,
	});
	expect(emission).toMatchObject({ denseRun: true, runDriver: true, slotUpdates: true });
	const host: LynxElementPAPI<FakeNode> = {
		...papi,
		intrinsics: {
			view: (pageId: number) => papi.createElement('view', pageId, ''),
			text: (pageId: number) => papi.createElement('text', pageId, ''),
			rawText: (value: string) => papi.createElement('#text', 0, value),
		},
	};
	const bind = new Function(`return (${emission.source});`)() as (
		papi: LynxElementPAPI<FakeNode>,
	) => CompiledCreate;
	return bind(host);
}

describe('compiled main-thread worklet emission', () => {
	it('writes activated event values while keeping main-thread refs store-owned', () => {
		const papi = createFakePAPI();
		const create = compile(papi);
		const first = Object.freeze({ type: 'worklet' as const, value: { _wkltId: 'tap', _owlt: 1 } });
		const next = Object.freeze({ type: 'worklet' as const, value: { _wkltId: 'tap', _owlt: 2 } });
		const ref = { _wvid: 'row' };
		const nodes = create(1, 'row', first, ref);

		expect(nodes[0]!.classes).toBe('row');
		expect(nodes[0]!.events.get('bindEvent:tap')).toBe(first);
		expect(nodes[0]!.attributes).not.toHaveProperty('main-thread:ref');

		expect(create.set(nodes, 1, next)).toBe(true);
		expect(nodes[0]!.events.get('bindEvent:tap')).toBe(next);
		expect(create.set(nodes, 1, null)).toBe(true);
		expect(nodes[0]!.events.has('bindEvent:tap')).toBe(false);
		expect(create.set(nodes, 2, { _wvid: 'next' })).toBe(true);
	});

	it('keeps direct worklets in the dense run driver', () => {
		const papi = createFakePAPI();
		const create = compile(papi);
		const first = Object.freeze({ type: 'worklet' as const, value: { _wkltId: 'tap', _owlt: 1 } });
		const second = Object.freeze({ type: 'worklet' as const, value: { _wkltId: 'tap', _owlt: 2 } });
		const out: (FakeNode | undefined)[] = [];

		create.run(
			1,
			2,
			['first', first, { _wvid: 'first' }, 'second', second, { _wvid: 'second' }],
			[],
			[],
			out,
		);

		expect(out).toHaveLength(2);
		expect(out[0]!.events.get('bindEvent:tap')).toBe(first);
		expect(out[1]!.events.get('bindEvent:tap')).toBe(second);
	});

	it('refuses a direct and background listener for the same native event', () => {
		expect(() =>
			emitLynxMainThreadProgram(
				{ ...PROGRAM, events: [{ node: 0, type: 'bindtap', priority: 'discrete' }] },
				{ name: 'Collision' },
			),
		).toThrow(/main-thread event.*conflicts with background event/);
	});

	it('continues to refuse unknown main-thread namespaces', () => {
		expect(() =>
			emitLynxMainThreadProgram(
				{
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [{ name: 'main-thread:mystery', valueIndex: 0 }],
						},
					],
					events: [],
				},
				{ name: 'Invalid' },
			),
		).toThrow(/main-thread:mystery.*command path writes/);
	});
});
