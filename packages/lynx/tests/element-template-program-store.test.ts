import type { UniversalProgramPlan } from 'octane/universal/native';
import { describe, expect, it, vi } from 'vitest';

import { applyLynxCompiledProgramFrame } from '../src/core/compiled-program-frame.js';
import { encodeLynxDeltaMessage } from '../src/core/delta-protocol.js';
import {
	createLynxElementTemplateProgramStore,
	type LynxElementTemplateAddress,
} from '../src/core/element-template-program-store.js';
import type {
	LynxElementTemplateAttributeValue,
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from '../src/core/element-template-papi.js';
import {
	decodeLynxNativeEventToken,
	encodePrevalidatedLynxNativeEventToken,
} from '../src/core/native-events.js';

type FakeHandle = LynxElementTemplateHandle & {
	readonly uid: number;
	readonly template: string;
	readonly attributes: LynxElementTemplateAttributeValue[];
	parent: FakeHandle | null;
	parentSlot: number | null;
	readonly children: Map<number, FakeHandle[]>;
};

function fakeHandle(
	uid: number,
	template: string,
	attributes: readonly LynxElementTemplateAttributeValue[] = [],
): FakeHandle {
	return {
		uid,
		template,
		attributes: [...attributes],
		parent: null,
		parentSlot: null,
		children: new Map(),
	} as unknown as FakeHandle;
}

function fakePAPI() {
	const page = fakeHandle(0, 'page');
	const creates: FakeHandle[] = [];
	const flush = vi.fn();
	const papi: LynxElementTemplatePAPI<FakeHandle> = {
		createPage: () => page,
		create(template, attributes, childSlots, uid) {
			const handle = fakeHandle(uid, template, attributes);
			for (let slot = 0; slot < (childSlots?.length ?? 0); slot++) {
				const children = childSlots?.[slot];
				if (children === null || children === undefined) continue;
				handle.children.set(slot, [...children]);
				for (const child of children) {
					child.parent = handle;
					child.parentSlot = slot;
				}
			}
			creates.push(handle);
			return handle;
		},
		setAttribute(handle, slot, value) {
			handle.attributes[slot] = value;
		},
		insert(parent, slot, child, reference) {
			if (child.parent !== null) {
				const previous = child.parent.children.get(child.parentSlot!)!;
				previous.splice(previous.indexOf(child), 1);
			}
			let children = parent.children.get(slot);
			if (children === undefined) parent.children.set(slot, (children = []));
			const index = reference === null ? children.length : children.indexOf(reference);
			if (index < 0) throw new Error('missing reference');
			children.splice(index, 0, child);
			child.parent = parent;
			child.parentSlot = slot;
		},
		remove(parent, slot, child) {
			const children = parent.children.get(slot);
			const index = children?.indexOf(child) ?? -1;
			if (index < 0) throw new Error('detached child');
			children!.splice(index, 1);
			child.parent = null;
			child.parentSlot = null;
		},
		serialize: (handle) => ({ uid: handle.uid }),
		flush,
	};
	return { creates, flush, page, papi };
}

const bind = (() => ({})) as unknown as UniversalProgramPlan['bind'];

const SHELL: UniversalProgramPlan = {
	kind: 'program',
	slots: [null, null, null, null, null, null, null, 'r'],
	nodes: 2,
	values: [],
	events: [],
	ranges: [{ slot: 7, node: 1, before: null, id: 2, paintsText: false }],
	elementTemplate: {
		templateId: '_octane_et_shell',
		attributeSlots: 1,
		childSlots: 1,
		visibilitySlot: 0,
	},
	bind,
};

const ROW: UniversalProgramPlan = {
	kind: 'program',
	slots: ['p:id', 'e:bindtap'],
	nodes: 2,
	values: [0],
	events: [{ slot: 1, node: 1, type: 'bindtap', priority: 'discrete' }],
	ranges: [],
	elementTemplate: {
		templateId: '_octane_et_row',
		attributeSlots: 3,
		childSlots: 0,
		visibilitySlot: 2,
	},
	bind,
};

const STRUCTURAL_SHELL: UniversalProgramPlan = {
	...SHELL,
	elementTemplate: { templateId: '_octane_et_shell', attributeSlots: 0, childSlots: 1 },
};
const STRUCTURAL_ROW: UniversalProgramPlan = {
	...ROW,
	elementTemplate: { templateId: '_octane_et_row', attributeSlots: 2, childSlots: 0 },
};

const addresses = [
	{ id: 1, address: { module: 'tests/App.lynx.tsrx', index: 0 } },
	{ id: 2, address: { module: 'tests/App.lynx.tsrx', index: 1 } },
] as const;

function resolver(module: string, index: number): UniversalProgramPlan | undefined {
	if (module !== 'tests/App.lynx.tsrx') return undefined;
	return index === 0 ? SHELL : index === 1 ? ROW : undefined;
}

function structuralResolver(module: string, index: number): UniversalProgramPlan | undefined {
	if (module !== 'tests/App.lynx.tsrx') return undefined;
	return index === 0 ? STRUCTURAL_SHELL : index === 1 ? STRUCTURAL_ROW : undefined;
}

function firstFrame() {
	return encodeLynxDeltaMessage(
		[
			{
				op: 'run',
				templateId: 1,
				parent: { instance: 1, slot: 0 },
				before: null,
				firstInstance: 2,
				count: 1,
				values: [],
			},
			{
				op: 'run',
				templateId: 2,
				parent: { instance: 2, slot: 7 },
				before: null,
				firstInstance: 3,
				count: 2,
				values: ['row-3', 'row-4'],
			},
		],
		addresses,
	);
}

describe('whole-root Element Template program store', () => {
	it('omits the permanent visibility slot for a structurally proved application graph', () => {
		const { creates, page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		applyLynxCompiledProgramFrame(store, store.page, structuralResolver, firstFrame());

		expect(creates.map((created) => created.attributes.length)).toEqual([0, 2, 2]);
		store.begin();
		expect(() => store.visibility(3, false)).toThrow(/proved not to retain hidden instances/);
		store.rollback();
	});

	it('drains a large mount before it exceeds the native callback-reference limit', () => {
		const { flush, page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		const count = 3_000;
		const largeRow = { ...ROW, nodes: 12 } satisfies UniversalProgramPlan;
		const largeResolver = (module: string, index: number): UniversalProgramPlan | undefined =>
			module !== 'tests/App.lynx.tsrx' ? undefined : index === 0 ? SHELL : largeRow;
		applyLynxCompiledProgramFrame(
			store,
			store.page,
			largeResolver,
			encodeLynxDeltaMessage(
				[
					{
						op: 'run',
						templateId: 1,
						parent: { instance: 1, slot: 0 },
						before: null,
						firstInstance: 2,
						count: 1,
						values: [],
					},
					{
						op: 'run',
						templateId: 2,
						parent: { instance: 2, slot: 7 },
						before: null,
						firstInstance: 3,
						count,
						values: Array.from({ length: count }, (_, index) => `row-${index}`),
					},
				],
				addresses,
			),
		);

		expect(store.size()).toBe(count + 1);
		expect(flush).toHaveBeenCalledWith(undefined, { triggerLayout: true });
	});

	it('rejects an oversized resident tree before exhausting native weak references', () => {
		const { page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		const expensiveRow = { ...ROW, nodes: 8_192 } satisfies UniversalProgramPlan;
		const expensiveResolver = (module: string, index: number): UniversalProgramPlan | undefined =>
			module !== 'tests/App.lynx.tsrx' ? undefined : index === 0 ? SHELL : expensiveRow;
		const frame = encodeLynxDeltaMessage(
			[
				{
					op: 'run',
					templateId: 1,
					parent: { instance: 1, slot: 0 },
					before: null,
					firstInstance: 2,
					count: 1,
					values: [],
				},
				{
					op: 'run',
					templateId: 2,
					parent: { instance: 2, slot: 7 },
					before: null,
					firstInstance: 3,
					count: 5,
					values: ['a', 'b', 'c', 'd', 'e'],
				},
			],
			addresses,
		);

		expect(() =>
			applyLynxCompiledProgramFrame(store, store.page, expensiveResolver, frame),
		).toThrow(/native nodes/);
		expect(store.size()).toBe(0);
		expect(store.isFaulted()).toBe(false);
		expect(page.children.get(0)).toEqual([]);
		expect(() =>
			applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame()),
		).not.toThrow();
	});

	it('applies nested runs, scalar updates, visibility, and moves through template slots', () => {
		const { creates, page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame());

		expect(page.children.get(0)?.map((handle) => handle.uid)).toEqual([2]);
		expect(creates[0]!.children.get(0)?.map((handle) => handle.uid)).toEqual([3, 4]);
		expect(creates.map((handle) => handle.template)).toEqual([
			'_octane_et_shell',
			'_octane_et_row',
			'_octane_et_row',
		]);
		expect(decodeLynxNativeEventToken(creates[1]!.attributes[1] as string)).toEqual({
			root: 73,
			id: 3,
			generation: 1,
			listener: 1,
			priority: 'discrete',
		});

		applyLynxCompiledProgramFrame(
			store,
			store.page,
			resolver,
			encodeLynxDeltaMessage([
				{ op: 'set', instance: 3, slot: 0, value: 'row-3-updated' },
				{ op: 'vis', instance: 3, state: 'hidden' },
				{
					op: 'move',
					instance: 4,
					parent: { instance: 2, slot: 7 },
					before: { instance: 3, slot: 0 },
				},
			]),
		);
		expect(creates[1]!.attributes).toEqual(['row-3-updated', null, true]);
		expect(creates[0]!.children.get(0)?.map((handle) => handle.uid)).toEqual([4, 3]);

		applyLynxCompiledProgramFrame(
			store,
			store.page,
			resolver,
			encodeLynxDeltaMessage([{ op: 'vis', instance: 3, state: 'visible' }]),
		);
		expect(typeof creates[1]!.attributes[1]).toBe('string');
		expect(creates[1]!.attributes[2]).toBe(false);
	});

	it('rolls back native handles, definitions, and listener identity after a rejected frame', () => {
		const { page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		expect(() =>
			applyLynxCompiledProgramFrame(store, store.page, resolver, [...firstFrame(), 99, 0]),
		).toThrow(/opcode 99/);
		expect(page.children.get(0)).toEqual([]);
		expect(store.resolve(1)).toBeUndefined();
		expect(store.size()).toBe(0);

		applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame());
		expect(store.size()).toBe(3);
	});

	it('adopts an already-painted template tree and keeps rejection retryable', () => {
		const { creates, page, papi } = fakePAPI();
		const shell = papi.create('_octane_et_shell', [false], null, 2);
		const row3 = papi.create(
			'_octane_et_row',
			['painted-row-3', encodePrevalidatedLynxNativeEventToken(73, 3, 1, 1, 'discrete'), false],
			null,
			3,
		);
		const row4 = papi.create(
			'_octane_et_row',
			['row-4', encodePrevalidatedLynxNativeEventToken(73, 4, 1, 2, 'discrete'), false],
			null,
			4,
		);
		papi.insert(page, 0, shell, null);
		papi.insert(shell, 0, row3, null);
		papi.insert(shell, 0, row4, null);
		const store = createLynxElementTemplateProgramStore(papi, page, 73, 1, (input) => {
			if (input.firstHandle === 2) {
				return { natives: [shell], firstListenerId: null, paintedValues: [] };
			}
			if (input.firstHandle === 3) {
				return {
					natives: [row3, row4],
					firstListenerId: 1,
					paintedValues: ['painted-row-3', 'row-4'],
				};
			}
			return undefined;
		});

		expect(() =>
			applyLynxCompiledProgramFrame(store, store.page, resolver, [...firstFrame(), 99, 0]),
		).toThrow(/opcode 99/);
		expect(store.size()).toBe(0);
		expect(row3.attributes[0]).toBe('painted-row-3');
		expect(page.children.get(0)).toEqual([shell]);
		expect(shell.children.get(0)).toEqual([row3, row4]);

		applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame());
		expect(store.size()).toBe(3);
		expect(row3.attributes[0]).toBe('row-3');
		expect(creates).toEqual([shell, row3, row4]);
	});

	it('refuses to remove a template whose structural slot still owns children', () => {
		const { page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame());
		expect(() =>
			applyLynxCompiledProgramFrame(
				store,
				store.page,
				resolver,
				encodeLynxDeltaMessage([{ op: 'remove', firstInstance: 2, count: 1 }]),
			),
		).toThrow(/while range 0 owns children/);
		expect(store.size()).toBe(3);
	});

	it('retains failed disposal leaves so cleanup can be retried', () => {
		const { page, papi } = fakePAPI();
		const store = createLynxElementTemplateProgramStore(papi, page, 73);
		applyLynxCompiledProgramFrame(store, store.page, resolver, firstFrame());
		const remove = papi.remove;
		let failOnce = true;
		papi.remove = (...args) => {
			if (failOnce) {
				failOnce = false;
				throw new Error('remove failed');
			}
			return remove(...args);
		};

		expect(() => store.dispose()).toThrow(/disposal failed/);
		expect(store.size()).toBe(2);
		expect(() => store.dispose()).not.toThrow();
		expect(store.size()).toBe(0);
		expect(page.children.get(0)).toEqual([]);
	});
});
