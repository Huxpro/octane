// Issue-#163 C1 — the emitted main-thread program and the interpreted one are
// two implementations of the same program.
//
// The campaign replaces `host-driver.ts`'s dense `mount-template-run` loop with
// straight-line code on the first-screen path, because #157 attributed 10.52 s
// of the 11.5 s native create-1k to exactly that interpretive dispatch. The
// claim a compiler backend has to earn is not that its output is fast — C0
// priced that — but that its output is *the same program*. So the load-bearing
// test here is differential: one program, one fake Element PAPI, both arms, and
// the trees they paint compared.
//
// Two things the arms are *designed* to disagree about are held out of that
// comparison, and each is asserted on its own rather than quietly normalized:
//
//   * The event token. The interpreter derives a listener id from the command's
//     instance range; an emitted program takes its listeners as parameters,
//     because under #163 the background no longer describes the painted tree
//     back to itself. `withoutAllocatorIdentity` keeps the event *site* — which
//     node carries which `kind:name` — and drops the number.
//   * The nodes-ref selector. Today `emitHostNode` stamps
//     `r{root}-h{id}-g{gen}` on every non-raw-text host as it paints, so the
//     background can address a painted node by CSS selector afterwards. That is
//     the handoff #163 inverts: the program's own node array is the addressing
//     map, so the write leaves the paint path entirely.
//
// Everything else — element type, class, id, text, structure, and which node
// owns which event — has to match exactly, because that is the tree the user
// sees and the command path's is the reference.
import { describe, expect, it } from 'vitest';

import type {
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramValue,
} from 'octane/universal/native';

import {
	emitLynxMainThreadProgram,
	LynxMainThreadEmitRefusal,
} from '../src/compiler/emit-main-thread-program.js';
import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import { createFakePAPI, shape, withoutAllocatorIdentity } from './_fixtures/fake-element-papi.js';

// The lynx-table row, which is the program C0 measured: a bound class, two
// bound texts, a static text, and two event sites on different nodes.
const ROW: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		{ type: 'text', parent: 0, props: { class: 'col-id' } },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 1 }] },
		{ type: 'text', parent: 0, props: { class: 'col-label' } },
		{ type: '#text', parent: 3, props: {}, bindings: [{ name: 'value', valueIndex: 2 }] },
		{ type: 'text', parent: 0, props: { class: 'col-remove' } },
		{ type: '#text', parent: 5, props: { value: 'x' } },
	],
	events: [
		{ node: 3, type: 'bindtap', priority: 'discrete' },
		{ node: 5, type: 'bindtap', priority: 'discrete' },
	],
};

const PAGE: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'page' } },
		{ type: 'view', parent: 0, props: { class: 'rows' } },
	],
	events: [],
};

/**
 * Every shape `applyDenseScalarHostProps` distinguishes, in one program.
 *
 * The row above never exercises them: it carries one bound `class` that is
 * always a non-empty string. But the applier's scalar path is a table — `id`
 * static and bound, `className` shadowing `class` by *presence* rather than by
 * value, and a class coerced from a number, a boolean, `null` or `''` — and a
 * backend that folds those at build time has to reproduce every entry. The
 * values below drive both arms across the whole table.
 */
const SCALARS: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'root', id: 'fixed' } },
		// A bound class, which is the only one the row fixture has.
		{ type: 'view', parent: 0, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		// A bound id beside a static class: `setId` runs first, and coerces.
		{
			type: 'view',
			parent: 0,
			props: { class: 'has-id' },
			bindings: [{ name: 'id', valueIndex: 1 }],
		},
		// `className` present as an own prop shadows `class` whatever it holds,
		// so this node paints `aliased` and never `ordinary`.
		{ type: 'view', parent: 0, props: { class: 'ordinary', className: 'aliased' } },
		// ...including when what it holds is `undefined`, which is the case that
		// separates "shadowed by presence" from "shadowed by value": this node
		// paints no class at all.
		{ type: 'view', parent: 0, props: { class: 'ordinary', className: undefined } },
		// A bound `className`, which shadows by the same rule.
		{
			type: 'view',
			parent: 0,
			props: { class: 'ordinary' },
			bindings: [{ name: 'className', valueIndex: 2 }],
		},
		// A static class that is not a string. The emission folds these at build
		// time, so nothing but a fixture that carries one can tell whether it
		// folded them the applier's way: a falsy number writes no class...
		{ type: 'view', parent: 0, props: { class: 0 } },
		// ...a truthy one stringifies, and an `id` stringifies whatever it is.
		{ type: 'view', parent: 0, props: { class: 7, id: false } },
		// `null` is the id the applier declines to write, and it is a different
		// case from `undefined`: both are skipped, but only one of them is what a
		// `String(id)` guarding on `undefined` alone would spell `"null"`.
		{ type: 'view', parent: 0, props: { class: 'no-id', id: null } },
		// A binding beside a static prop of the same name. Nothing forbids a
		// program from carrying both, and the applier resolves it by reading the
		// props first and letting the binding loop overwrite them — so the
		// binding wins, and the emission has to agree about which.
		{
			type: 'view',
			parent: 0,
			props: { class: 'static-loses' },
			bindings: [{ name: 'class', valueIndex: 3 }],
		},
	],
	events: [],
};

/** The class/id values whose coercion the applier and the emission must share. */
const SCALAR_VALUES: readonly (readonly [string, readonly UniversalHostTemplateProgramValue[]])[] =
	[
		['strings', ['bound', 'id-7', 'aliased-bound', 'binding-wins']],
		['an empty string, which writes no class', ['', 'id-7', '', '']],
		['truthy numbers, which stringify', [12, 34, 56, 78]],
		['zero, which is a falsy number and writes no class', [0, 0, 0, 0]],
		['null, which writes neither', [null, null, null, null]],
		['false, which writes no class but does write an id', [false, false, false, false]],
		['undefined, which is not the same skip as null', [undefined, undefined, undefined, undefined]],
	];

type Row = { readonly id: number; readonly label: string };

function rows(count: number): Row[] {
	return Array.from({ length: count }, (_unused, index) => ({
		id: index + 1,
		label: `row ${index + 1}`,
	}));
}

function rowValues(row: Row, selected: number | null): (string | number | boolean | null)[] {
	return [row.id === selected ? 'row danger' : 'row', String(row.id), row.label];
}

/**
 * The fake host with the intrinsic element factories a real one always
 * publishes: `normalizeLynxElementPAPI` freezes them onto every PAPI it builds.
 * The shared fixture leaves them off because `createElement` is where its
 * create-fault injection lives, and the suites that inject a fault have to keep
 * reaching it — so they are added here rather than there, and both arms run
 * against the same host so the only variable is emission versus interpretation.
 */
function createHost(): ReturnType<typeof createFakePAPI> {
	const papi = createFakePAPI();
	return {
		...papi,
		intrinsics: {
			view: (pageId: number) => papi.createElement('view', pageId, ''),
			text: (pageId: number) => papi.createElement('text', pageId, ''),
			// Raw text takes no page id, which is why the interpreter's own factory
			// table calls this one with the text alone.
			rawText: (value: string) => papi.createElement('#text', 0, value),
		},
	};
}

/**
 * A painted shape with the nodes-ref selector held out, and one that counts the
 * selectors instead. See the file header: the selector is the deliberate
 * divergence, so it is dropped from the tree comparison and asserted directly.
 */
function withoutNodesRefSelector(node: unknown): unknown {
	const value = node as { readonly children: readonly unknown[] };
	return { ...value, selector: '', children: value.children.map(withoutNodesRefSelector) };
}

function paintedTree(node: unknown): unknown {
	return withoutAllocatorIdentity(withoutNodesRefSelector(node));
}

function selectorWrites(node: unknown): number {
	const value = node as { readonly selector: string; readonly children: readonly unknown[] };
	return value.children.reduce(
		(total: number, child) => total + selectorWrites(child),
		value.selector === '' ? 0 : 1,
	);
}

/**
 * One instance per item of `template`, painted into the page by the dense
 * `mount-template-run` applier: the reference arm.
 */
function throughApplier<Item>(
	template: UniversalHostTemplateProgram,
	items: readonly Item[],
	key: (item: Item) => number,
	values: (item: Item) => readonly UniversalHostTemplateProgramValue[],
): unknown {
	const papi = createHost();
	const container = createLynxHostContainer(papi, { root: 1 });
	const core = createLynxBlockCore();
	const page = core.mount(null, null, compileLynxBlockTemplate(PAGE), []);
	const slot = core.openForSlot(page, 1);
	core.fillForSlot(slot, compileLynxBlockTemplate(template), items, key, values);
	const batch = core.flush();
	if (batch !== null) prepareLynxHostBatch(container, batch).apply();
	return shape(papi.pages[0]!);
}

/**
 * Instantiate an emitted program.
 *
 * `new Function` here is the test standing in for a bundler: C1 emits this
 * source into the main-thread chunk, where it is ordinary compiled code. What
 * the test needs is only that the source runs, so evaluating it is the honest
 * way to check the emission rather than matching it against a string.
 */
function instantiate(
	program: UniversalHostTemplateProgram,
	name: string,
): (papi: unknown) => (...args: never[]) => unknown[] {
	const { source } = emitLynxMainThreadProgram(program, { name });
	return new Function(`return (${source});`)() as never;
}

/**
 * The same page and the same instances, painted by the emitted programs.
 *
 * `args` supplies the create function's whole tail — the value slots and then
 * the listeners — because that arity is the emission's contract and writing it
 * out per scenario is what checks it.
 */
function throughEmission<Item>(
	template: UniversalHostTemplateProgram,
	name: string,
	items: readonly Item[],
	args: (item: Item, index: number) => readonly unknown[],
): unknown {
	const papi = createHost();
	const page = papi.createPage('0', 0);
	const pageId = papi.getUniqueId(page);
	const chrome = instantiate(PAGE, 'createPage')(papi)(...([pageId, page] as never[]));
	const create = instantiate(template, name)(papi);
	items.forEach((item, index) => {
		create(...([pageId, chrome[1], ...args(item, index)] as never[]));
	});
	return shape(papi.pages[0]!);
}

const interpreted = (list: readonly Row[], selected: number | null): unknown =>
	throughApplier(
		ROW,
		list,
		(row) => row.id,
		(row) => rowValues(row, selected),
	);

const emitted = (list: readonly Row[], selected: number | null): unknown =>
	throughEmission(ROW, 'createRow', list, (row, index) => [
		...rowValues(row, selected),
		// Two listeners per row, numbered as the caller pleases: the emission
		// takes them as parameters rather than deriving them, which is the whole
		// of #163's inverted handoff at this layer.
		index * 2 + 1,
		index * 2 + 2,
	]);

const interpretedScalars = (values: readonly UniversalHostTemplateProgramValue[]): unknown =>
	throughApplier(
		SCALARS,
		[0],
		(index) => index,
		() => values,
	);

const emittedScalars = (values: readonly UniversalHostTemplateProgramValue[]): unknown =>
	throughEmission(SCALARS, 'createScalars', [0], () => values);

describe('Lynx main-thread program emission', () => {
	it('paints what the dense template-run applier paints', () => {
		const list = rows(6);
		expect(paintedTree(emitted(list, null))).toEqual(paintedTree(interpreted(list, null)));
	});

	it('agrees about a bound class the applier coerces rather than writes verbatim', () => {
		// `applyDenseScalarHostProps` writes nothing for an empty class and
		// stringifies only a truthy number. A backend that emitted an
		// unconditional `setClasses` would paint `class=""` on every unselected
		// row, which is a different tree that no row-count assertion would catch.
		const list = rows(4);
		expect(paintedTree(emitted(list, 2))).toEqual(paintedTree(interpreted(list, 2)));
	});

	it('agrees on a one-row list, where nothing sits either side of the instance', () => {
		expect(paintedTree(emitted(rows(1), 1))).toEqual(paintedTree(interpreted(rows(1), 1)));
	});

	it('paints no nodes-ref selector, which is the handoff #163 inverts', () => {
		// The claim, stated where a future emission that started stamping
		// selectors would fail rather than silently pay #157's per-node cost
		// again: today's applier writes one `setRefSelector` per non-raw-text
		// host on the paint path so the background can find that node by CSS
		// selector later. An emitted program's caller already holds the nodes it
		// created, so nothing has to be findable and nothing is written.
		const list = rows(3);
		expect(selectorWrites(interpreted(list, null))).toBeGreaterThan(0);
		expect(selectorWrites(emitted(list, null))).toBe(0);
	});

	describe('writes the scalar props the applier writes, coerced the same way', () => {
		for (const [label, values] of SCALAR_VALUES) {
			it(label, () => {
				expect(paintedTree(emittedScalars(values))).toEqual(
					paintedTree(interpretedScalars(values)),
				);
			});
		}
	});

	it('installs each event site on the node the program names, with the PAPI kind and name', () => {
		const papi = createHost();
		const page = papi.createPage('0', 0);
		const create = instantiate(ROW, 'createRow')(papi);
		const nodes = create(
			...([papi.getUniqueId(page), page, 'row', '1', 'a', 'tok-a', 'tok-b'] as never[]),
		) as { events: Map<string, unknown> }[];
		expect([...nodes[3]!.events.entries()]).toEqual([['bindEvent:tap', 'tok-a']]);
		expect([...nodes[5]!.events.entries()]).toEqual([['bindEvent:tap', 'tok-b']]);
		expect(nodes[0]!.events.size).toBe(0);
	});

	it('assembles the subtree detached and enters the live tree with one append', () => {
		// The emitted order is the dense applier's, and this is the part of it
		// that is a contract rather than a detail: every node is appended to its
		// own parent first, so the caller's tree is touched exactly once, at the
		// end. A host that laid out on every insertion would otherwise pay for
		// the whole subtree instead of for one node — which is the cost #163's
		// single flush exists to avoid. It is also the only test that drives the
		// emission's `papi.append` branch; everywhere else the fake host has none
		// and the `insertBefore` fallback is what runs.
		const papi = createHost();
		const appends: [unknown, unknown][] = [];
		const recording = {
			...papi,
			append(parent: never, child: never) {
				appends.push([parent, child]);
				papi.insertBefore(parent, child, null);
			},
		};
		const page = recording.createPage('0', 0);
		const create = instantiate(ROW, 'createRow')(recording);
		const nodes = create(
			...([recording.getUniqueId(page), page, 'row', '1', 'a', 1, 2] as never[]),
		);
		// One append per node: the program's shape, not a budget.
		expect(appends.length).toBe(ROW.nodes.length);
		expect(appends[appends.length - 1]).toEqual([page, nodes[0]]);
		expect(appends.slice(0, -1).some(([parent]) => parent === page)).toBe(false);
	});

	it('reports the slot and listener arity the caller has to supply', () => {
		expect(emitLynxMainThreadProgram(ROW, { name: 'createRow' })).toMatchObject({
			valueCount: 3,
			eventCount: 2,
		});
		expect(emitLynxMainThreadProgram(PAGE, { name: 'createPage' })).toMatchObject({
			valueCount: 0,
			eventCount: 0,
		});
	});

	describe('refuses what only the command path can write', () => {
		// Each of these is a program the dense applier itself declines, or one it
		// would paint through the general `applyProps` patch. Emitting a second,
		// partial copy of that machinery is the failure this boundary exists to
		// prevent: a prop silently not written paints a different first screen.
		const cases: readonly (readonly [string, UniversalHostTemplateProgram, RegExp])[] = [
			[
				'an inline style',
				{ nodes: [{ type: 'view', parent: -1, props: { style: 'color: red' } }], events: [] },
				/"style"/,
			],
			[
				'a bound attribute that is not class or id',
				{
					nodes: [
						{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'text', valueIndex: 0 }] },
					],
					events: [],
				},
				/"text"/,
			],
			[
				'a prop on a raw text node other than its value',
				{
					nodes: [
						{ type: 'text', parent: -1, props: {} },
						{ type: '#text', parent: 0, props: { value: 'a', class: 'b' } },
					],
					events: [],
				},
				/"class"/,
			],
			[
				'a host type with no intrinsic factory',
				{ nodes: [{ type: 'list', parent: -1, props: {} }], events: [] },
				/host type this backend cannot construct/,
			],
			[
				'an event site naming a node the program does not have',
				{
					nodes: [{ type: 'view', parent: -1, props: {} }],
					events: [{ node: 4, type: 'bindtap', priority: 'discrete' }],
				},
				/does not have/,
			],
			[
				'an event prop the native parser does not recognise',
				{
					nodes: [{ type: 'view', parent: -1, props: {} }],
					events: [{ node: 0, type: 'onTap', priority: 'discrete' }],
				},
				/is not a Lynx event prop/,
			],
			[
				'raw text under a host that is not a text host',
				{
					nodes: [
						{ type: 'view', parent: -1, props: {} },
						{ type: '#text', parent: 0, props: { value: 'a' } },
					],
					events: [],
				},
				/rather than a text host/,
			],
			[
				'a value slot two nodes both claim',
				{
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [{ name: 'class', valueIndex: 0 }],
						},
						{
							type: 'view',
							parent: 0,
							props: {},
							bindings: [{ name: 'class', valueIndex: 0 }],
						},
					],
					events: [],
				},
				/bound by more than one host node/,
			],
			[
				'a value slot the caller would have to pass but no node reads',
				{
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [{ name: 'class', valueIndex: 1 }],
						},
					],
					events: [],
				},
				/declared but never bound/,
			],
			[
				'an event on raw text, which owns no Element surface',
				{
					nodes: [
						{ type: 'text', parent: -1, props: {} },
						{ type: '#text', parent: 0, props: { value: 'a' } },
					],
					events: [{ node: 1, type: 'bindtap', priority: 'discrete' }],
				},
				/cannot own the native event/,
			],
			[
				'the same event declared twice on one node',
				{
					nodes: [{ type: 'view', parent: -1, props: {} }],
					events: [
						{ node: 0, type: 'bindtap', priority: 'discrete' },
						{ node: 0, type: 'bindtap', priority: 'discrete' },
					],
				},
				/repeats the event/,
			],
			[
				'a node that binds one prop name twice',
				{
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: {},
							bindings: [
								{ name: 'class', valueIndex: 0 },
								{ name: 'class', valueIndex: 1 },
							],
						},
					],
					events: [],
				},
				/more than once/,
			],
			[
				'a raw text node with no value to render',
				{
					nodes: [
						{ type: 'text', parent: -1, props: {} },
						{ type: '#text', parent: 0, props: {} },
					],
					events: [],
				},
				/declares no value to render/,
			],
			[
				'a raw text node whose static value is not a string',
				{
					nodes: [
						{ type: 'text', parent: -1, props: {} },
						{ type: '#text', parent: 0, props: { value: 7 } },
					],
					events: [],
				},
				/non-string static value/,
			],
			[
				'a forward parent reference',
				{
					nodes: [
						{ type: 'view', parent: -1, props: {} },
						{ type: 'view', parent: 2, props: {} },
						{ type: 'view', parent: 0, props: {} },
					],
					events: [],
				},
				/is not an earlier node/,
			],
		];
		for (const [label, program, message] of cases) {
			it(label, () => {
				expect(() => emitLynxMainThreadProgram(program, { name: 'create' })).toThrow(message);
				expect(() => emitLynxMainThreadProgram(program, { name: 'create' })).toThrow(
					LynxMainThreadEmitRefusal,
				);
			});
		}
	});

	it('needs a JavaScript identifier for the function it emits', () => {
		expect(() => emitLynxMainThreadProgram(ROW, { name: 'create row' })).toThrow(TypeError);
	});

	it('will not take a name the emitted code already binds', () => {
		// A named function expression binds its own name inside its body, so a
		// create function called `append` calls itself where it means to append
		// and one called `papi` reads the Element PAPI off itself. Both are run
		// time failures in generated code on the least debuggable thread, so both
		// are the caller's mistake reported to the caller. A reserved word is the
		// same mistake spelled as a syntax error the bundler finds later.
		for (const name of ['append', 'papi', 'view', 'rawText', 'parent', 'n0', 'v2', 'e0']) {
			expect(() => emitLynxMainThreadProgram(ROW, { name })).toThrow(/binds itself/);
		}
		for (const name of ['function', 'class', 'return', 'this']) {
			expect(() => emitLynxMainThreadProgram(ROW, { name })).toThrow(TypeError);
		}
	});

	it('emits a create function whose own name does not shadow what it calls', () => {
		// The guard above is a refusal; this is the property the refusal exists
		// for, checked on a name that survives it. `createRow` binds inside the
		// function body too, so if the emission ever moved a hoisted local into
		// that scope the shadow would be silent until a row painted wrongly.
		const papi = createHost();
		const page = papi.createPage('0', 0);
		const nodes = instantiate(ROW, 'createRow')(papi)(
			...([papi.getUniqueId(page), page, 'row', '1', 'a', 1, 2] as never[]),
		);
		expect(nodes).toHaveLength(ROW.nodes.length);
	});

	it('declines a host with no intrinsic element factories rather than painting a partial tree', () => {
		const create = instantiate(PAGE, 'createPage');
		expect(() => create({ intrinsics: undefined })).toThrow(/intrinsic element factories/);
	});
});
