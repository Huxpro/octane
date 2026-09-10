// Issue-#246 E1 — a background-originated mount that names a resident compiled
// program instead of carrying a descriptor.
//
// The claim the merge gate cares about is parity, and it is deliberately
// stronger than "both paths work": a range mounted by `mount-program-run` must
// produce the tree the same range mounted by `mount-template-run` produces —
// same hosts, same ids, same classes and attributes, same listener sites and
// listener ids, same public-instance handles — because the wire is the only
// thing that changed. The applier resolves the program instead of reading it off
// the command and then runs the identical code, so these tests are what says the
// resolution is the *only* difference.
//
// The second half is the refusal surface. A positional address says nothing
// about what it points at, so every way it can fail to name this realm's program
// has to end in a decline with a diagnostic, never in an approximation.
import type {
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostTemplateProgram,
	UniversalProgramCreate,
} from 'octane/universal/native';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	(globalThis as unknown as Record<string, unknown>).__OCTANE_LYNX_PROFILE__ = true;
});

import { emitLynxMainThreadProgram } from '../src/compiler/emit-main-thread-program.js';
import {
	createLynxHostContainer,
	disposeLynxHostContainer,
	prepareLynxHostBatch,
	resolveLynxHostNativeEvent,
} from '../src/core/host-driver.js';
import {
	registerUniversalProgram,
	residentRunPlan,
	residentRunProgram,
	residentUniversalProgramCount,
	resolveUniversalProgram,
} from '../src/core/program-registry.js';
import { lynxWireProfile } from '../src/core/profiling.js';
import { validateLynxBackgroundOutboundMessage } from '../src/core/protocol.js';
import { createFakePAPI, shape, type FakeNode } from './_fixtures/fake-element-papi.js';

/**
 * A row: a bound class and id on the root, a `<text>` carrying bound content,
 * and a tap on a sibling.
 *
 * Both root bindings are deliberate. With one binding per node a plan slot and
 * the node that reads it share an index, so a resolution that returned the wrong
 * program could still paint a tree that looked right; making them disagree is
 * what turns the parity assertion into an assertion.
 */
const ROW = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: {},
			bindings: [
				{ name: 'class', valueIndex: 0 },
				{ name: 'id', valueIndex: 1 },
			],
		},
		{ type: 'text', parent: 0, props: { class: 'label' } },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
		{ type: 'view', parent: 0, props: { class: 'action' } },
	],
	events: [
		{ node: 0, type: 'bindtap', priority: 'default' as const },
		{ node: 3, type: 'catchtap', priority: 'discrete' as const },
	],
};

/** A second program with the same slot count but a different tree. */
const CELL = {
	nodes: [
		{
			type: 'view',
			parent: -1,
			props: { class: 'cell' },
			bindings: [
				{ name: 'id', valueIndex: 0 },
				{ name: 'class', valueIndex: 1 },
			],
		},
		{ type: '#text', parent: 0, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
	],
	events: [],
};

/** The deferred native-list shape issue #193 executes once per fresh cell. */
const LIST_ROW: UniversalHostTemplateProgram = {
	nodes: [
		{
			type: 'list-item',
			parent: -1,
			props: {
				class: 'row',
				'sticky-top': true,
				'sticky-bottom': false,
				'full-span': true,
				'estimated-main-axis-size-px': 92,
				'reuse-identifier': 'feed-row',
			},
			bindings: [{ name: 'item-key', valueIndex: 0 }],
		},
		{ type: 'text', parent: 0, props: { class: 'label' } },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 1 }] },
	],
	events: [{ node: 1, type: 'bindtap', priority: 'default' }],
};

const STRUCTURAL_SHELL: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'shell' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
};

const VALUES = Object.freeze([
	'first',
	'row-1',
	'One',
	'second',
	'row-2',
	'Two',
	'third',
	'row-3',
	'Three',
]);

const MODULE = 'src/Row.lynx.tsrx';

/**
 * The registry is module scope, which is the design (`program-registry.ts`), so
 * a test that registered under a fixed address would leak into the next one.
 * Every case takes its own module id and this counter is what keeps them apart.
 */
let nextModule = 0;
function freshModule(): string {
	nextModule += 1;
	return `${MODULE}?case=${nextModule}`;
}

/** Register a wire descriptor the way the compiled main-thread chunk does. */
function registerWire(module: string, index: number, wire: unknown): void {
	registerUniversalProgram(module, index, {
		kind: 'program',
		slots: [],
		nodes: 0,
		values: [],
		events: [],
		ranges: [],
		bind: () => () => null,
		wire,
	} as never);
}

function batch(commands: readonly UniversalHostCommand[], version = 1): UniversalHostBatch {
	return { renderer: 'lynx', version, commands };
}

function createHost() {
	const base = createFakePAPI();
	const papi = {
		...base,
		intrinsics: {
			view: (pageId: number) => base.createElement('view', pageId, ''),
			text: (pageId: number) => base.createElement('text', pageId, ''),
			rawText: (value: string) => base.createElement('#text', 0, value),
		},
	};
	const container = createLynxHostContainer(papi, { root: 1 });
	return { container, papi, page: container.page };
}

function createListHost() {
	const base = createFakePAPI({ list: true });
	const papi = {
		...base,
		intrinsics: {
			view: (pageId: number) => base.createElement('view', pageId, ''),
			text: (pageId: number) => base.createElement('text', pageId, ''),
			rawText: (value: string) => base.createElement('#text', 0, value),
		},
	};
	const container = createLynxHostContainer(papi, { root: 1 });
	return { container, papi, page: container.page };
}

function registerExecutableRow(module: string): { binds: () => number; runs: () => number } {
	const { source } = emitLynxMainThreadProgram(ROW, { name: 'createAddressedRow' });
	const emitted = new Function(`return (${source});`)() as (
		papi: unknown,
	) => UniversalProgramCreate;
	let bindCount = 0;
	let runCount = 0;
	registerUniversalProgram(module, 0, {
		kind: 'program',
		slots: [],
		nodes: ROW.nodes.length,
		values: [0, 1, 2],
		events: ROW.events.map((event, slot) => ({ ...event, slot })),
		ranges: [],
		bind(papi) {
			bindCount++;
			const create = emitted(papi);
			const run = create.run!;
			Object.defineProperty(create, 'run', {
				value(...args: Parameters<NonNullable<UniversalProgramCreate['run']>>) {
					runCount++;
					return run(...args);
				},
			});
			return create;
		},
		wire: ROW,
	});
	return { binds: () => bindCount, runs: () => runCount };
}

function registerExecutableListRow(module: string): { binds: () => number; runs: () => number } {
	const { source } = emitLynxMainThreadProgram(LIST_ROW, { name: 'createAddressedListRow' });
	const emitted = new Function(`return (${source});`)() as (
		papi: unknown,
	) => UniversalProgramCreate;
	let bindCount = 0;
	let runCount = 0;
	registerUniversalProgram(module, 0, {
		kind: 'program',
		slots: [],
		nodes: LIST_ROW.nodes.length,
		values: [0, 1],
		events: LIST_ROW.events.map((event, slot) => ({ ...event, slot })),
		ranges: [],
		bind(papi) {
			bindCount++;
			const create = emitted(papi);
			const run = create.run!;
			Object.defineProperty(create, 'run', {
				value(...args: Parameters<NonNullable<UniversalProgramCreate['run']>>) {
					runCount++;
					return run(...args);
				},
			});
			return create;
		},
		wire: LIST_ROW,
	});
	return { binds: () => bindCount, runs: () => runCount };
}

function deferredListRun(
	module: string,
	firstId: number,
	firstListenerId: number,
	labels: readonly string[],
): UniversalHostCommand {
	return {
		op: 'mount-program-run',
		parent: 1,
		before: null,
		address: { module, index: 0 },
		firstId,
		firstListenerId,
		count: labels.length,
		values: Object.freeze(labels.flatMap((label, index) => [`item-${firstId}-${index}`, label])),
		deferred: true,
	} as never;
}

/** The prelude both arms share: a shell to mount into and an anchor to mount before. */
const PRELUDE: readonly UniversalHostCommand[] = [
	{ op: 'create', id: 1, type: 'view', props: { id: 'shell' } },
	{ op: 'insert', parent: null, id: 1, before: null },
	{ op: 'create', id: 2, type: 'view', props: { id: 'anchor' } },
	{ op: 'insert', parent: 1, id: 2, before: null },
] as never;

function mountRun(run: UniversalHostCommand) {
	const { container, page } = createHost();
	const prepared = prepareLynxHostBatch(container, batch([...PRELUDE, run]), {
		compact: true,
		lazyPublicInstances: true,
	});
	const compactHostCount = prepared.compactHostCount;
	const handleDelta = prepared.handleDelta;
	prepared.apply();
	return { container, page, tree: shape(page as FakeNode), compactHostCount, handleDelta };
}

describe('mounting a resident program by address (issue #246 E1)', () => {
	it('paints the tree, the ids and the listeners a descriptor run paints', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);

		const descriptor = mountRun({
			op: 'mount-template-run',
			parent: 1,
			before: 2,
			program: ROW,
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);
		const addressed = mountRun({
			op: 'mount-program-run',
			parent: 1,
			before: 2,
			address: { module, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);

		// The whole tree, ids and event sites included, compared without any
		// normalization: both arms were handed the same `firstId` and
		// `firstListenerId`, so every number one produced the other must produce.
		expect(addressed.tree).toEqual(descriptor.tree);
		// Not vacuous: the arms really did paint the row.
		expect(JSON.stringify(descriptor.tree)).toContain('row-3');
		// The counts the transport uses to size an acknowledgement, and the public
		// instance handles adoption is keyed on, are the same two answers.
		expect(addressed.compactHostCount).toBe(descriptor.compactHostCount);
		expect(addressed.handleDelta).toEqual(descriptor.handleDelta);
	});

	it('executes an eligible appended addressed run through its resident driver', () => {
		const profile = lynxWireProfile();
		profile.programRunDriverRuns = 0;
		profile.programRunDriverRows = 0;
		profile.programRunDriverFallbacks = 0;
		profile.programRunDriverFallback = null;
		const module = freshModule();
		const calls = registerExecutableRow(module);
		const descriptor = mountRun({
			op: 'mount-template-run',
			parent: 1,
			before: null,
			program: ROW,
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);
		const addressed = mountRun({
			op: 'mount-program-run',
			parent: 1,
			before: null,
			address: { module, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);

		expect(calls.binds()).toBe(1);
		expect(calls.runs()).toBe(1);
		expect(profile.programRunDriverRuns).toBe(1);
		expect(profile.programRunDriverRows).toBe(3);
		expect(profile.programRunDriverFallbacks).toBe(0);
		expect(profile.programRunDriverFallback).toBeNull();
		expect(addressed.tree).toEqual(descriptor.tree);
		expect(addressed.compactHostCount).toBe(descriptor.compactHostCount);
		expect(addressed.handleDelta).toEqual(descriptor.handleDelta);
		const rows = addressed.page.children[0]!.children;
		expect(
			resolveLynxHostNativeEvent(
				addressed.container,
				rows[3]!.children[1]!.events.get('catchEvent:tap')!,
			),
		).toEqual({ listener: 705, priority: 'discrete' });

		const fallbackModule = freshModule();
		registerWire(fallbackModule, 0, ROW);
		mountRun({
			op: 'mount-program-run',
			parent: 1,
			before: null,
			address: { module: fallbackModule, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);
		expect(profile.programRunDriverFallbacks).toBe(1);
		expect(profile.programRunDriverFallback).toBe(
			'resident program has no straight-line run driver',
		);
	});

	it('keeps structural resident programs on the descriptor path', () => {
		const module = freshModule();
		const rowModule = freshModule();
		let binds = 0;
		let runs = 0;
		const { source } = emitLynxMainThreadProgram(STRUCTURAL_SHELL, {
			name: 'createAddressedStructuralShell',
			ranges: [{ node: 1 }],
			structuralRuns: true,
		});
		const emitted = new Function(`return (${source});`)() as (
			papi: unknown,
		) => UniversalProgramCreate;
		registerUniversalProgram(module, 0, {
			kind: 'program',
			slots: ['r'],
			nodes: STRUCTURAL_SHELL.nodes.length,
			values: [],
			events: [],
			ranges: [{ slot: 0, node: 1, id: 2, paintsText: false }],
			bind(papi) {
				binds++;
				const create = emitted(papi);
				const run = create.run!;
				Object.defineProperty(create, 'run', {
					value(...args: Parameters<NonNullable<UniversalProgramCreate['run']>>) {
						runs++;
						return run(...args);
					},
				});
				return create;
			},
			wire: STRUCTURAL_SHELL,
		});
		registerWire(rowModule, 0, ROW);

		const { container, page } = createHost();
		const prepared = prepareLynxHostBatch(
			container,
			batch([
				{
					op: 'mount-program-run',
					parent: null,
					before: null,
					address: { module, index: 0 },
					firstId: 10,
					firstListenerId: null,
					count: 1,
					values: [],
				},
				{
					op: 'mount-program-run',
					parent: 11,
					before: null,
					address: { module: rowModule, index: 0 },
					firstId: 20,
					firstListenerId: 700,
					count: 3,
					values: VALUES,
				},
			] as never),
		);
		prepared.apply();

		expect(binds).toBe(0);
		expect(runs).toBe(0);
		expect(JSON.stringify(shape(page as FakeNode))).toContain('row-3');
		expect(page.children[0]!.children[0]!.children).toHaveLength(3);
	});

	it('retains a faulted resident driver prefix for terminal cleanup', () => {
		const module = freshModule();
		registerExecutableRow(module);
		const base = createFakePAPI();
		let installedEvent: FakeNode | null = null;
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
			setEvent(node: FakeNode, kind: string, name: string, listener: unknown) {
				base.setEvent(node, kind, name, listener as never);
				if (listener !== undefined && installedEvent === null) {
					installedEvent = node;
					throw new Error('compiled event fault');
				}
			},
		};
		const container = createLynxHostContainer(papi, { root: 1 });
		const prepared = prepareLynxHostBatch(
			container,
			batch([
				...PRELUDE,
				{
					op: 'mount-program-run',
					parent: 1,
					before: null,
					address: { module, index: 0 },
					firstId: 10,
					firstListenerId: 700,
					count: 3,
					values: VALUES,
				} as never,
			]),
			{ compact: true, lazyPublicInstances: true },
		);

		expect(() => prepared.apply()).toThrow(/compiled event fault/);
		expect(installedEvent).not.toBeNull();
		expect(installedEvent!.events.size).toBe(1);
		expect(disposeLynxHostContainer(container)).toMatchObject({ complete: true, errors: [] });
		expect(installedEvent!.events.size).toBe(0);
		expect(container.page.children).toEqual([]);
	});

	it('binds once and executes the resident program for each fresh native-list cell', () => {
		const profile = lynxWireProfile();
		profile.listProgramCellRuns = 0;
		profile.listProgramCellHosts = 0;
		profile.listProgramCellFallbacks = 0;
		profile.listProgramCellFallback = null;
		const module = freshModule();
		const calls = registerExecutableListRow(module);
		const { container, papi } = createListHost();

		prepareLynxHostBatch(
			container,
			batch([
				{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
				deferredListRun(module, 100, 900, ['Row 0', 'Row 1']),
				{ op: 'insert', parent: null, id: 1, before: null },
			] as never),
		).apply();
		// A second declaration of the same resident plan is another accepted value
		// table, not another binding to this container's Element PAPI.
		prepareLynxHostBatch(
			container,
			batch([deferredListRun(module, 200, 950, ['Row 2'])], 2),
		).apply();

		expect(calls.binds()).toBe(1);
		expect(calls.runs()).toBe(0);
		const list = papi.lists[0]!;
		for (const index of [0, 1, 2]) {
			expect(
				list.componentAtIndex(list.node, papi.getUniqueId(list.node), index, index + 10, false),
			).toBeGreaterThan(0);
		}

		expect(calls.binds()).toBe(1);
		expect(calls.runs()).toBe(3);
		expect(profile.listProgramCellRuns).toBe(3);
		expect(profile.listProgramCellHosts).toBe(3 * LIST_ROW.nodes.length);
		expect(profile.listProgramCellFallbacks).toBe(0);
		expect(profile.listProgramCellFallback).toBeNull();
		expect(list.node.children.map((node) => node.children[0]!.children[0]!.text)).toEqual([
			'Row 0',
			'Row 1',
			'Row 2',
		]);
		expect(list.node.children.map((node) => node.attributes['item-key'])).toEqual([
			'item-100-0',
			'item-100-1',
			'item-200-0',
		]);
		expect(list.node.children.map((node) => node.attributes)).toEqual(
			Array.from({ length: 3 }, (_unused, index) => ({
				'item-key': index === 2 ? 'item-200-0' : `item-100-${index}`,
				'sticky-top': true,
				'sticky-bottom': false,
				'full-span': true,
				'estimated-main-axis-size-px': 92,
				'reuse-identifier': 'feed-row',
			})),
		);
		expect(
			resolveLynxHostNativeEvent(
				container,
				list.node.children[2]!.children[0]!.events.get('bindEvent:tap')!,
			),
		).toEqual({ listener: 950, priority: 'default' });
		expect(disposeLynxHostContainer(container)).toMatchObject({ complete: true, errors: [] });
	});

	it('falls back for an accepted update instead of repainting stale declaration values', () => {
		const profile = lynxWireProfile();
		profile.listProgramCellRuns = 0;
		profile.listProgramCellHosts = 0;
		profile.listProgramCellFallbacks = 0;
		profile.listProgramCellFallback = null;
		const module = freshModule();
		const calls = registerExecutableListRow(module);
		const { container, papi } = createListHost();

		prepareLynxHostBatch(
			container,
			batch([
				{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
				deferredListRun(module, 100, 900, ['Stale']),
				{ op: 'insert', parent: null, id: 1, before: null },
			] as never),
		).apply();
		prepareLynxHostBatch(
			container,
			batch([{ op: 'update', id: 102, props: { value: 'Accepted' } }] as never, 2),
		).apply();

		const list = papi.lists[0]!;
		expect(list.componentAtIndex(list.node, papi.getUniqueId(list.node), 0)).toBeGreaterThan(0);
		expect(list.node.children[0]!.children[0]!.children[0]!.text).toBe('Accepted');
		expect(calls.binds()).toBe(1);
		expect(calls.runs()).toBe(0);
		expect(profile.listProgramCellRuns).toBe(0);
		expect(profile.listProgramCellFallbacks).toBe(1);
		expect(profile.listProgramCellFallback).toBe('materialized record');
		expect(disposeLynxHostContainer(container)).toMatchObject({ complete: true, errors: [] });
	});

	it('retains a faulted compiled list-cell prefix for terminal cleanup', () => {
		const module = freshModule();
		const calls = registerExecutableListRow(module);
		const base = createFakePAPI({ list: true });
		let installedEvent: FakeNode | null = null;
		const papi = {
			...base,
			intrinsics: {
				view: (pageId: number) => base.createElement('view', pageId, ''),
				text: (pageId: number) => base.createElement('text', pageId, ''),
				rawText: (value: string) => base.createElement('#text', 0, value),
			},
			setEvent(node: FakeNode, kind: string, name: string, listener: unknown) {
				base.setEvent(node, kind, name, listener as never);
				if (listener !== undefined && installedEvent === null) {
					installedEvent = node;
					throw new Error('compiled list event fault');
				}
			},
		};
		const container = createLynxHostContainer(papi, { root: 1 });
		prepareLynxHostBatch(
			container,
			batch([
				{ op: 'create', id: 1, type: 'list', props: { id: 'feed' } },
				deferredListRun(module, 100, 900, ['Row 0']),
				{ op: 'insert', parent: null, id: 1, before: null },
			] as never),
		).apply();

		const list = base.lists[0]!;
		expect(list.componentAtIndex(list.node, papi.getUniqueId(list.node), 0)).toBe(-1);
		expect(calls.runs()).toBe(1);
		expect(installedEvent).not.toBeNull();
		expect(installedEvent!.events.size).toBe(1);
		expect(disposeLynxHostContainer(container)).toMatchObject({ complete: true, errors: [] });
		expect(installedEvent!.events.size).toBe(0);
		expect(container.page.children).toEqual([]);
	});

	it('mounts a strided addressed run without claiming the component IDs between instances', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);
		const addressed = mountRun({
			op: 'mount-program-run',
			parent: 1,
			before: 2,
			address: { module, index: 0 },
			firstId: 10,
			stride: 5,
			firstListenerId: 700,
			count: 3,
			values: VALUES,
		} as never);

		expect(addressed.compactHostCount).toBe(14);
		expect(addressed.handleDelta.every((delta) => 'handle' in delta)).toBe(true);
		expect(
			addressed.handleDelta.flatMap((delta) => ('handle' in delta ? [delta.handle.id] : [])),
		).toEqual([1, 2, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22, 23]);
		expect(JSON.stringify(addressed.tree)).toContain('row-3');
		const rows = addressed.page.children[0]!.children;
		expect(
			resolveLynxHostNativeEvent(addressed.container, rows[1]!.events.get('bindEvent:tap')!),
		).toEqual({ listener: 702, priority: 'default' });
		expect(
			resolveLynxHostNativeEvent(
				addressed.container,
				rows[2]!.children[1]!.events.get('catchEvent:tap')!,
			),
		).toEqual({ listener: 705, priority: 'discrete' });
	});

	it('declines an address this realm does not hold rather than approximating it', () => {
		const module = freshModule();
		const { container } = createHost();
		expect(() =>
			prepareLynxHostBatch(
				container,
				batch([
					...PRELUDE,
					{
						op: 'mount-program-run',
						parent: 1,
						before: 2,
						address: { module, index: 4 },
						firstId: 10,
						firstListenerId: 700,
						count: 1,
						values: ['a', 'b', 'c'],
					},
				] as never),
				{ compact: true },
			),
		).toThrowError(/names program .*#4, which this realm does not hold/);
	});

	it('accepts a re-evaluated module registering the same program again', () => {
		// A module evaluated twice — an HMR pass, a chunk loaded under two ids —
		// mints a fresh plan object each time, so object identity can never say
		// "same program". What can is the wire, the surface the address digest is
		// computed over. Structurally equal wire is a no-op that keeps the first
		// registration, so memoization keyed on the resident object survives.
		const module = freshModule();
		registerWire(module, 0, ROW);
		const first = resolveUniversalProgram(module, 0);
		expect(() => registerWire(module, 0, JSON.parse(JSON.stringify(ROW)))).not.toThrow();
		expect(resolveUniversalProgram(module, 0)).toBe(first);
	});

	it('refuses two different plans under one address', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);
		expect(() => registerWire(module, 0, CELL)).toThrowError(
			/Two compiled main-thread programs claim the address/,
		);
		// The first registration stands: a refused second one must not have
		// replaced it, or the refusal would be a wrong tree with a message.
		expect(resolveUniversalProgram(module, 0)!.wire).toBe(ROW);
	});

	it('resolves a descriptor run from its own field and an addressed run from the registry', () => {
		const module = freshModule();
		registerWire(module, 1, CELL);
		expect(residentRunProgram({ op: 'mount-template-run', program: ROW } as never)).toBe(ROW);
		expect(
			residentRunProgram({ op: 'mount-program-run', address: { module, index: 1 } } as never),
		).toBe(CELL);
		expect(
			residentRunPlan({ op: 'mount-program-run', address: { module, index: 1 } } as never),
		).toBe(resolveUniversalProgram(module, 1));
		// A malformed address is a miss, not a throw: the caller owns the decline
		// and owns the diagnostic that names the build.
		expect(residentRunProgram({ op: 'mount-program-run', address: null } as never)).toBeUndefined();
		expect(
			residentRunProgram({ op: 'mount-program-run', address: { module, index: 1.5 } } as never),
		).toBeUndefined();
		expect(residentUniversalProgramCount()).toBeGreaterThan(0);
	});

	it('freezes the resident descriptor through, so both memos survive a mount', () => {
		// Not hygiene. `prepareTemplateProgram` and `assertTemplateProgram` both
		// refuse to memoize a program they cannot prove immutable and re-walk it on
		// every mount, so a resident program that was not frozen through would cost
		// the same per mount as the descriptor E1 stopped sending — which is the
		// entire reason for naming one.
		const module = freshModule();
		const wire = {
			nodes: [{ type: 'view', parent: -1, props: { class: 'a' }, bindings: [] }],
			events: [],
		};
		registerWire(module, 0, wire);
		expect(Object.isFrozen(wire)).toBe(true);
		expect(Object.isFrozen(wire.nodes)).toBe(true);
		expect(Object.isFrozen(wire.nodes[0])).toBe(true);
		expect(Object.isFrozen(wire.nodes[0]!.props)).toBe(true);
		expect(Object.isFrozen(wire.nodes[0]!.bindings)).toBe(true);
	});

	it('validates an addressed run against the resolver it is given', () => {
		const module = freshModule();
		registerWire(module, 0, ROW);
		const run = {
			op: 'mount-program-run',
			parent: 1,
			before: null,
			address: { module, index: 0 },
			firstId: 10,
			firstListenerId: 700,
			count: 1,
			values: ['a', 'b', 'c'],
		};
		const message = {
			protocol: 1,
			renderer: 'lynx',
			root: 1,
			version: 1,
			type: 'commit',
			batch: { renderer: 'lynx', version: 1, commands: [run] },
		};
		// With the resolver the main thread passes, the command validates: the
		// program it names is one this realm holds and its value count matches.
		expect(() =>
			validateLynxBackgroundOutboundMessage(message as never, 'checked', residentRunProgram),
		).not.toThrow();
		// Without one, no realm can say what the address means, so the command is
		// refused rather than waved through on the strength of its shape.
		expect(() => validateLynxBackgroundOutboundMessage(message as never, 'checked')).toThrowError(
			/program/,
		);
		expect(() =>
			validateLynxBackgroundOutboundMessage(
				{
					...message,
					batch: { ...message.batch, commands: [{ ...run, stride: ROW.nodes.length - 1 }] },
				} as never,
				'checked',
				residentRunProgram,
			),
		).toThrowError(/stride.*at least the program host count/);
		expect(() =>
			validateLynxBackgroundOutboundMessage(
				{
					...message,
					batch: { ...message.batch, commands: [{ ...run, stride: undefined }] },
				} as never,
				'checked',
				residentRunProgram,
			),
		).toThrowError(/stride.*positive safe integer/);
		expect(() =>
			validateLynxBackgroundOutboundMessage(
				{
					...message,
					batch: {
						...message.batch,
						commands: [{ ...run, parent: 1, stride: ROW.nodes.length + 1, deferred: true }],
					},
				} as never,
				'checked',
				residentRunProgram,
			),
		).toThrowError(/stride.*omitted.*deferred/);
	});
});
