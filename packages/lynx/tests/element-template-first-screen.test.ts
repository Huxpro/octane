import type { UniversalProgramPlan } from 'octane/universal/native';
import { describe, expect, it, vi } from 'vitest';

import {
	LYNX_ELEMENT_TEMPLATE_FIRST_SCREEN_NATIVE_COST_LIMIT,
	paintLynxElementTemplateFirstScreen,
} from '../src/core/element-template-first-screen.js';
import type {
	LynxElementTemplateAttributeValue,
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from '../src/core/element-template-papi.js';
import { decodeLynxNativeEventToken } from '../src/core/native-events.js';

type FakeHandle = LynxElementTemplateHandle & {
	readonly uid: number;
	readonly attributes: LynxElementTemplateAttributeValue[];
	readonly children: Map<number, FakeHandle[]>;
};

function handle(
	uid: number,
	attributes: readonly LynxElementTemplateAttributeValue[] = [],
): FakeHandle {
	return { uid, attributes: [...attributes], children: new Map() } as unknown as FakeHandle;
}

function host() {
	const page = handle(0);
	const created: FakeHandle[] = [];
	const removed: number[] = [];
	const papi: LynxElementTemplatePAPI<FakeHandle> = {
		createPage: () => page,
		create: (_key, attributes, childSlots, uid) => {
			const parent = handle(uid, attributes);
			for (let slot = 0; slot < (childSlots?.length ?? 0); slot++) {
				const children = childSlots?.[slot];
				if (children !== null && children !== undefined) {
					parent.children.set(slot, [...children]);
				}
			}
			created.push(parent);
			return parent;
		},
		setAttribute(target, slot, value) {
			target.attributes[slot] = value;
		},
		insert(parent, slot, child, before) {
			const children = parent.children.get(slot) ?? [];
			if (!parent.children.has(slot)) parent.children.set(slot, children);
			const index = before === null ? children.length : children.indexOf(before);
			if (index < 0) throw new Error('missing before');
			children.splice(index, 0, child);
		},
		remove(parent, slot, child) {
			const children = parent.children.get(slot) ?? [];
			const index = children.indexOf(child);
			if (index < 0) throw new Error('missing child');
			children.splice(index, 1);
			removed.push(child.uid);
		},
		serialize: () => ({}),
		flush() {},
	};
	return { created, page, papi, removed };
}

const bind = (() => ({})) as unknown as UniversalProgramPlan['bind'];
const SHELL: UniversalProgramPlan = {
	kind: 'program',
	slots: [null, 'r'],
	nodes: 1,
	values: [],
	events: [],
	ranges: [{ slot: 1, node: 0, before: null, id: 1, paintsText: false }],
	elementTemplate: { templateId: 'shell', attributeSlots: 1, childSlots: 1, visibilitySlot: 0 },
	bind,
};
const ROW: UniversalProgramPlan = {
	kind: 'program',
	slots: ['p:id', 'e:bindtap'],
	nodes: 1,
	values: [0],
	events: [{ slot: 1, node: 0, type: 'bindtap', priority: 'discrete' }],
	ranges: [],
	elementTemplate: { templateId: 'row', attributeSlots: 3, childSlots: 0, visibilitySlot: 2 },
	bind,
};

const STRUCTURAL_SHELL: UniversalProgramPlan = {
	...SHELL,
	elementTemplate: { templateId: 'shell', attributeSlots: 0, childSlots: 1 },
};
const STRUCTURAL_ROW: UniversalProgramPlan = {
	...ROW,
	elementTemplate: { templateId: 'row', attributeSlots: 2, childSlots: 0 },
};

function result(structural = false) {
	const shell = structural ? STRUCTURAL_SHELL : SHELL;
	const row = structural ? STRUCTURAL_ROW : ROW;
	return {
		nodes: [
			{
				kind: 'program' as const,
				id: 1,
				plan: shell,
				selectedValues: [],
				ids: [1],
				spans: [2],
				children: [
					{
						kind: 'program' as const,
						id: 2,
						plan: row,
						selectedValues: ['a'],
						ids: [2],
						spans: [],
						children: [],
					},
					{
						kind: 'program' as const,
						id: 3,
						plan: row,
						selectedValues: ['b'],
						ids: [3],
						spans: [],
						children: [],
					},
				],
			},
		],
		envelope: {
			renderer: 'lynx' as const,
			version: 1 as const,
			events: [
				{ id: 2, type: 'bindtap', listener: { id: 1, priority: 'discrete' as const } },
				{ id: 3, type: 'bindtap', listener: { id: 2, priority: 'discrete' as const } },
			],
		},
		hostCount: 3,
		programs: 3,
		logicalCount: 3,
		get batch(): never {
			throw new Error('unused');
		},
	};
}

describe('Element Template first-screen ownership', () => {
	it('omits the permanent visibility slot after structural graph proof', () => {
		const { created, page, papi } = host();
		const source = paintLynxElementTemplateFirstScreen(result(true), papi, page);

		expect(created.map((value) => value.attributes.length)).toEqual([2, 2, 0]);
		source.dispose();
	});

	it('defers an unsafe synchronous tree intact to the first background frame', () => {
		const { created, page, papi } = host();
		const oversized = {
			...ROW,
			nodes: LYNX_ELEMENT_TEMPLATE_FIRST_SCREEN_NATIVE_COST_LIMIT + 1,
		} satisfies UniversalProgramPlan;
		const base = result();
		const source = paintLynxElementTemplateFirstScreen(
			{
				nodes: [
					{
						kind: 'program' as const,
						id: 1,
						plan: oversized,
						children: [],
					},
				],
				envelope: base.envelope,
				hostCount: 0,
				programs: 1,
				logicalCount: 1,
				get batch(): never {
					throw new Error('unused');
				},
			},
			papi,
			page,
		);

		expect(created).toEqual([]);
		expect(
			source.resolveSeed({
				before: null,
				count: 1,
				firstHandle: 2,
				parent: { kind: 'page', owner: 1, slot: 0 },
				plan: oversized,
				values: ['row'],
			}),
		).toBeUndefined();
		expect(() => source.verify()).not.toThrow();
		source.finish();
	});

	it('paints deterministic compact handles and proves a nested batched adoption', () => {
		const { page, papi } = host();
		const source = paintLynxElementTemplateFirstScreen(result(), papi, page);
		const shell = page.children.get(0)![0]!;
		const rows = shell.children.get(0)!;
		expect([shell.uid, ...rows.map((row) => row.uid)]).toEqual([-1, -2, -3]);
		expect(decodeLynxNativeEventToken(rows[0]!.attributes[1] as string)).toMatchObject({
			root: 1,
			id: 3,
			listener: 1,
		});
		expect(() =>
			source.resolveSeed({
				before: null,
				count: 1,
				firstHandle: 2,
				parent: { kind: 'page', owner: 1, slot: 0 },
				plan: ROW,
				values: ['wrong'],
			}),
		).toThrow(/disagrees with painted program 0/);

		expect(
			source.resolveSeed({
				before: null,
				count: 1,
				firstHandle: 2,
				parent: { kind: 'page', owner: 1, slot: 0 },
				plan: SHELL,
				values: [],
			}),
		).toMatchObject({ natives: [shell], firstListenerId: null });
		expect(
			source.resolveSeed({
				before: null,
				count: 2,
				firstHandle: 3,
				parent: { kind: 'range', owner: 2, slot: 1, childSlot: 0 },
				plan: ROW,
				values: ['a', 'b'],
			}),
		).toMatchObject({ natives: rows, firstListenerId: 1, paintedValues: ['a', 'b'] });
		expect(() => source.verify()).not.toThrow();
		source.finish();
	});

	it('retains disposal ownership until the first frame finishes', () => {
		const { page, papi, removed } = host();
		const source = paintLynxElementTemplateFirstScreen(result(), papi, page);
		source.dispose();
		expect(page.children.get(0)).toEqual([]);
		expect(removed).toEqual([-1]);
	});

	it('releases successfully-created child roots when a parent creation fails', () => {
		const { page, papi, removed } = host();
		const create = papi.create;
		const reserveResident = vi.fn();
		const releaseResident = vi.fn();
		papi.create = (...args) => {
			if (args[3] === -1) throw new Error('parent create failed');
			return create(...args);
		};

		expect(() =>
			paintLynxElementTemplateFirstScreen(result(), papi, page, {
				run: (_cost, operation) => operation(),
				reserveResident,
				releaseResident,
				flush() {},
			}),
		).toThrow(/parent create failed/);
		expect(page.children.get(0)).toEqual([]);
		expect(removed).toEqual([-3, -2]);
		expect(reserveResident).toHaveBeenCalledTimes(3);
		expect(releaseResident.mock.calls).toEqual([
			[1, 1],
			[1, 1],
			[1, 1],
		]);
	});

	it('keeps failed disposal roots available for a cleanup retry', () => {
		const { page, papi } = host();
		const source = paintLynxElementTemplateFirstScreen(result(), papi, page);
		const remove = papi.remove;
		let failOnce = true;
		papi.remove = (...args) => {
			if (failOnce) {
				failOnce = false;
				throw new Error('remove failed');
			}
			return remove(...args);
		};

		expect(() => source.dispose()).toThrow(/first-screen disposal failed/);
		expect(page.children.get(0)).toHaveLength(1);
		expect(() => source.dispose()).not.toThrow();
		expect(page.children.get(0)).toEqual([]);
	});
});
