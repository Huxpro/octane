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
	type LynxMainThreadProgramRange,
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
 * `ROW` with both of its text holes reduced out, and where they were.
 *
 * The two are the same program answered twice.
 * `universalTemplateProgramWithoutRanges` returns `RANGED_ROW` when its caller
 * says both holes hold a keyed range — which is what a *build* says, because a
 * plan lowers a `@for` and a `{row.label as string}` to the same node and only
 * a value tells them apart — and it returns `ROW` when the caller says neither
 * does, which is what a *run* says once it holds two strings. So `ROW` is not a
 * similar program: it is the tree a compiled `RANGED_ROW` has to paint when its
 * range values arrive as strings, and the applier painting `ROW` is therefore
 * the reference arm for exactly that claim.
 *
 * Written out rather than derived because deriving it here would prove the two
 * agree with `universalTemplateProgramWithoutRanges`, which is not what is in
 * question; what is in question is whether the emission paints the same tree.
 */
const RANGED_ROW: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: {}, bindings: [{ name: 'class', valueIndex: 0 }] },
		{ type: 'text', parent: 0, props: { class: 'col-id' } },
		{ type: 'text', parent: 0, props: { class: 'col-label' } },
		{ type: 'text', parent: 0, props: { class: 'col-remove' } },
		{ type: '#text', parent: 3, props: { value: 'x' } },
	],
	events: [
		{ node: 2, type: 'bindtap', priority: 'discrete' },
		{ node: 3, type: 'bindtap', priority: 'discrete' },
	],
};

/** `ROW`'s two text holes, on the hosts they were dropped from. */
const RANGED_ROW_SITES: readonly LynxMainThreadProgramRange[] = [{ node: 1 }, { node: 2 }];

/**
 * A range site with a static sibling ahead of it, inside a host that has a
 * later sibling of its own.
 *
 * The row cannot see *where* a compiled text is appended: every one of its
 * hosts holds the hole and nothing else, so any placement paints the same tree.
 * A hole is its host's last child by construction — the reduction declines a
 * program where a dropped hole is not the last entry naming its parent — and
 * the only way to break that is to append it before the node loop has placed
 * the siblings, which needs a host with one.
 */
const LINE: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'wrap' } },
		{ type: 'text', parent: 0, props: { class: 'line' } },
		{ type: '#text', parent: 1, props: { value: 'lead ' } },
		{ type: '#text', parent: 1, props: {}, bindings: [{ name: 'value', valueIndex: 0 }] },
		{ type: 'view', parent: 0, props: { class: 'after' } },
	],
	events: [],
};

/** `LINE` answered the other way: the trailing hole is a range. */
const RANGED_LINE: UniversalHostTemplateProgram = {
	nodes: [
		{ type: 'view', parent: -1, props: { class: 'wrap' } },
		{ type: 'text', parent: 0, props: { class: 'line' } },
		{ type: '#text', parent: 1, props: { value: 'lead ' } },
		{ type: 'view', parent: 0, props: { class: 'after' } },
	],
	events: [],
};

const RANGED_LINE_SITES: readonly LynxMainThreadProgramRange[] = [{ node: 1 }];

/** A keyed list: the range site an application actually has most of. */
const LIST: UniversalHostTemplateProgram = {
	nodes: [{ type: 'view', parent: -1, props: { class: 'rows' } }],
	events: [],
};

const LIST_SITES: readonly LynxMainThreadProgramRange[] = [{ node: 0 }];

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
		// A bound `class` under a present `className`. The shadow rule outranks
		// the binding rule, so this node paints nothing and the value at slot 4 is
		// passed and discarded — the one case where an emission reaching for
		// "whichever class-ish source exists" would paint a class the applier does
		// not.
		{
			type: 'view',
			parent: 0,
			props: { className: undefined },
			bindings: [{ name: 'class', valueIndex: 4 }],
		},
	],
	events: [],
};

/** The class/id values whose coercion the applier and the emission must share. */
const SCALAR_VALUES: readonly (readonly [string, readonly UniversalHostTemplateProgramValue[]])[] =
	[
		['strings', ['bound', 'id-7', 'aliased-bound', 'binding-wins', 'discarded']],
		['an empty string, which writes no class', ['', 'id-7', '', '', '']],
		['truthy numbers, which stringify', [12, 34, 56, 78, 90]],
		['zero, which is a falsy number and writes no class', [0, 0, 0, 0, 0]],
		['null, which writes neither', [null, null, null, null, null]],
		['false, which writes no class but does write an id', [false, false, false, false, false]],
		[
			'undefined, which is not the same skip as null',
			[undefined, undefined, undefined, undefined, undefined],
		],
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
	ranges?: readonly LynxMainThreadProgramRange[],
): (papi: unknown) => (...args: never[]) => unknown[] {
	const { source } = emitLynxMainThreadProgram(program, { name, ranges });
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
	ranges?: readonly LynxMainThreadProgramRange[],
): unknown {
	const papi = createHost();
	const page = papi.createPage('0', 0);
	const pageId = papi.getUniqueId(page);
	// The emission returns an unattached subtree and leaves the single append to
	// its caller, so every attach in this file is one the test performs. That is
	// the contract `assembles the subtree detached` below pins.
	const chrome = instantiate(PAGE, 'createPage')(papi)(...([pageId] as never[]));
	papi.insertBefore(page, chrome[0] as never, null);
	const create = instantiate(template, name, ranges)(papi);
	items.forEach((item, index) => {
		const nodes = create(...([pageId, ...args(item, index)] as never[]));
		papi.insertBefore(chrome[1] as never, nodes[0] as never, null);
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

/**
 * The same rows through the reduced program, with the two texts passed as range
 * values rather than bound value slots.
 */
const rangedEmitted = (
	list: readonly Row[],
	selected: number | null,
	text: (row: Row) => readonly [unknown, unknown] = (row) => [String(row.id), row.label],
): unknown =>
	throughEmission(
		RANGED_ROW,
		'createRangedRow',
		list,
		(row, index) => [rowValues(row, selected)[0], index * 2 + 1, index * 2 + 2, ...text(row)],
		RANGED_ROW_SITES,
	);

/** The same rows through the reduced program with no range sites declared at all. */
const rangesUndeclared = (list: readonly Row[], selected: number | null): unknown =>
	throughEmission(RANGED_ROW, 'createRangedRow', list, (row, index) => [
		rowValues(row, selected)[0],
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
			...([papi.getUniqueId(page), 'row', '1', 'a', 'tok-a', 'tok-b'] as never[]),
		) as { events: Map<string, unknown> }[];
		expect([...nodes[3]!.events.entries()]).toEqual([['bindEvent:tap', 'tok-a']]);
		expect([...nodes[5]!.events.entries()]).toEqual([['bindEvent:tap', 'tok-b']]);
		expect(nodes[0]!.events.size).toBe(0);
	});

	it('crosses to the host for no event site whose listener the caller did not supply', () => {
		// A site's handler is a plan slot the caller resolves per render, and an
		// authored `onTap?` that is not passed leaves it undefined. Passing that
		// straight through would not misroute a tap — a host reads an undefined
		// listener as *remove this event*, which on a node one statement old is a
		// no-op — it would spend a crossing saying so. So the claim is about the
		// crossing, not about the resulting tree, and the resulting tree is what a
		// fake host that treats `setEvent(…, undefined)` as a delete would let
		// pass either way. The calls are counted instead.
		const host = createHost();
		const calls: unknown[][] = [];
		const papi = {
			...host,
			setEvent(target: never, kind: never, name: never, listener: never) {
				calls.push([target, kind, name, listener]);
				host.setEvent(target, kind, name, listener);
			},
		};
		const page = papi.createPage('0', 0);
		const create = instantiate(ROW, 'createRow')(papi);
		const nodes = create(
			...([papi.getUniqueId(page), 'row', '1', 'a', undefined, 'tok-b'] as never[]),
		) as { events: Map<string, unknown> }[];
		// One site declared two, and only the supplied one reached the host.
		expect(calls).toEqual([[nodes[5], 'bindEvent', 'tap', 'tok-b']]);
		expect(nodes[3]!.events.size).toBe(0);
		expect([...nodes[5]!.events.entries()]).toEqual([['bindEvent:tap', 'tok-b']]);
	});

	it("assembles the subtree detached and never touches the caller's tree", () => {
		// The emitted order is the dense applier's, and this is the part of it
		// that is a contract rather than a detail: every node is appended to its
		// own parent and to nothing else, so the subtree is complete and still
		// detached when the create returns. The caller performs the one append
		// that puts it in the page — which is what lets it put a keyed range's
		// members into a node this program made *before* any of it is live. A
		// host that laid out on every insertion would otherwise pay for the whole
		// subtree, and then again per member, instead of for one node. It is also
		// the only test that drives the emission's `papi.append` branch;
		// everywhere else the fake host has none and the `insertBefore` fallback
		// is what runs.
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
		const nodes = create(...([recording.getUniqueId(page), 'row', '1', 'a', 1, 2] as never[]));
		// One append per node the program did not make itself: the program's
		// shape, not a budget.
		expect(appends.length).toBe(ROW.nodes.length - 1);
		expect(appends.some(([parent]) => parent === page)).toBe(false);
		expect(appends.some(([, child]) => child === nodes[0])).toBe(false);
		// Still detached, which is the claim: nothing above the root was written.
		expect(recording.getParent(nodes[0] as never)).toBe(null);
	});

	it('reports the slot, listener and range arity the caller has to supply', () => {
		expect(emitLynxMainThreadProgram(ROW, { name: 'createRow' })).toMatchObject({
			valueCount: 3,
			eventCount: 2,
			rangeCount: 0,
		});
		expect(emitLynxMainThreadProgram(PAGE, { name: 'createPage' })).toMatchObject({
			valueCount: 0,
			eventCount: 0,
			rangeCount: 0,
		});
		// One parameter per site the caller declared, including the one this
		// program compiles nothing for: the position is the caller's contract, so
		// a site that paints nothing still has to be passed and skipped rather
		// than shifting the site after it.
		expect(
			emitLynxMainThreadProgram(RANGED_ROW, {
				name: 'createRangedRow',
				ranges: [...RANGED_ROW_SITES, { node: 0 }],
			}),
		).toMatchObject({ valueCount: 1, eventCount: 2, rangeCount: 3 });
	});

	it('reports which of those sites it paints a string for', () => {
		// The one thing only this function knows, because it is the one making the
		// decision. A consumer chooses which holes to hand a string; this chooses
		// which holes carry the test that uses it; and the two run in different
		// processes at different times. Re-deriving the second from the host types
		// on the consumer's side would be the same judgement made twice from two
		// sources, so it is reported instead — and reported per site rather than
		// as a count, because the sites are not interchangeable.
		expect(emitLynxMainThreadProgram(ROW, { name: 'createRow' }).paintsText).toEqual([]);
		expect(
			emitLynxMainThreadProgram(RANGED_ROW, {
				name: 'createRangedRow',
				ranges: RANGED_ROW_SITES,
			}).paintsText,
		).toEqual([true, true]);
		// `RANGED_ROW`'s node 0 is the row `view`. A hole there is the ordinary
		// keyed list at every value, so it takes its parameter and paints nothing.
		expect(
			emitLynxMainThreadProgram(RANGED_ROW, {
				name: 'createRangedRow',
				ranges: [{ node: 0 }, ...RANGED_ROW_SITES],
			}).paintsText,
		).toEqual([false, true, true]);
	});

	it('returns one entry per range site after its nodes, saying what it painted', () => {
		// The trailing half of the create function's answer, and the reason it
		// exists: the caller decided which holes to send a string for, this
		// decided which ones it paints, and a disagreement either way is silent
		// without something to compare. A hole neither filled is a text simply
		// missing from the page; one they both filled is a node in the page that
		// no ownership journal knows about.
		const papi = createHost();
		const page = papi.createPage('0', 0);
		const pageId = papi.getUniqueId(page);
		const create = instantiate(RANGED_ROW, 'createRangedRow', RANGED_ROW_SITES)(papi);

		const painted = create(...([pageId, 'row', 1, 2, '7', 'Label'] as never[]));
		// Four nodes, then one entry per site — so a site's answer is at a fixed
		// position rather than at one that depends on what the answer is.
		expect(painted).toHaveLength(RANGED_ROW.nodes.length + RANGED_ROW_SITES.length);
		// Five nodes, so the two sites are at 5 and 6. `RANGED_ROW` carries a
		// literal `#text` of its own at index 4, which is exactly the node an
		// off-by-one here would read instead — and it is defined at every value,
		// so the mistake would look like a pass.
		expect(painted[5]).toBeDefined();
		expect(painted[6]).toBeDefined();
		// The nodes it says it painted are the ones actually under those hosts,
		// not merely two nodes it made: an emission that returned the wrong two
		// would hand the caller ownership of the wrong physical nodes.
		expect(shape(painted[1] as never)).toEqual(
			expect.objectContaining({ children: [expect.objectContaining({ text: '7' })] }),
		);
		expect(shape(painted[2] as never)).toEqual(
			expect.objectContaining({ children: [expect.objectContaining({ text: 'Label' })] }),
		);

		// A site handed something that is not a string is left open, and says so
		// in its own slot rather than by being absent from the array.
		//
		// `undefined` here also means "no other local's value". The emitted body
		// is one `var` scope, so a site whose local shared a prefix with another
		// per-index scratch — `RANGED_ROW`'s class binding folds node 0's into
		// one — would return that scratch's value instead of nothing, and the
		// caller would journal a string as a node it owns.
		const open = create(...([pageId, 'row', 3, 4, undefined, 7] as never[]));
		expect(open).toHaveLength(RANGED_ROW.nodes.length + RANGED_ROW_SITES.length);
		expect(open[5]).toBeUndefined();
		expect(open[6]).toBeUndefined();

		// And a site this emission compiles nothing for is `undefined` at every
		// value, including a string — the position is the caller's, the answer is
		// this function's.
		const withView = instantiate(RANGED_ROW, 'createRangedRow', [{ node: 0 }, ...RANGED_ROW_SITES])(
			papi,
		);
		const mixed = withView(...([pageId, 'row', 5, 6, 'ignored', '7', 'Label'] as never[]));
		expect(mixed).toHaveLength(RANGED_ROW.nodes.length + 3);
		expect(mixed[5]).toBeUndefined();
		expect(mixed[6]).toBeDefined();
		expect(mixed[7]).toBeDefined();
	});

	describe('compiles a range site whose value arrives as a string', () => {
		it('paints the text the applier paints for the same hole', () => {
			// The load-bearing one. `RANGED_ROW` is what a build derives, because a
			// build has no values and answers "every renderable hole is a keyed
			// range"; `ROW` is what a run derives from the same plan once it holds
			// two strings. The emitted program is handed the strings and has to
			// reach the tree the applier reaches from `ROW` — not a similar tree,
			// the same one, because that is the first screen the command path
			// would have painted.
			const list = rows(5);
			expect(paintedTree(rangedEmitted(list, 3))).toEqual(paintedTree(interpreted(list, 3)));
		});

		it('appends the text behind everything its host already holds', () => {
			// A range hole is its host's last child by construction, so the compiled
			// text has to land after the static sibling the node loop placed and
			// after the whole subtree that loop built. `LINE` carries both, and it
			// is the only fixture here that can tell a late append from an early
			// one.
			const interpretedLine = throughApplier(
				LINE,
				['tail'],
				() => 1,
				(item) => [item],
			);
			const emittedLine = throughEmission(
				RANGED_LINE,
				'createLine',
				['tail'],
				(item) => [item],
				RANGED_LINE_SITES,
			);
			expect(paintedTree(emittedLine)).toEqual(paintedTree(interpretedLine));
		});

		describe('leaves the hole a range for a value that is not one', () => {
			// The guard is the applier's own entry condition for the route it is
			// compiling: route 1 throws on a value that is not a string rather than
			// coercing it. So everything else stays exactly where it is today — a
			// hole the renderer fills by key — and the tree the create function
			// paints is the one it painted before any site was declared.
			const cases: readonly (readonly [string, unknown])[] = [
				['nothing, which is what a caller passing no range values gives', undefined],
				['an object, which is the shape a keyed range arrives as', { $$kind: 'for', rows: [] }],
				['a number, which the applier would have refused rather than stringified', 7],
				['null', null],
			];
			for (const [label, value] of cases) {
				it(label, () => {
					const list = rows(3);
					expect(paintedTree(rangedEmitted(list, null, () => [value, value]))).toEqual(
						paintedTree(rangesUndeclared(list, null)),
					);
				});
			}
		});

		it('numbers a site by where the caller listed it, not by whether it compiles', () => {
			// The row's own `view` declared as a range site *ahead* of its two text
			// holes: a keyed list beside compiled text, which is the shape a real
			// template has. The list site compiles nothing, and the thing that has
			// to survive that is the position of everything after it — an emission
			// that only took parameters for the sites it compiled would read both
			// texts one slot early and paint the class into `col-id`.
			const list = rows(4);
			const emittedRow = throughEmission(
				RANGED_ROW,
				'createRangedRow',
				list,
				(row, index) => [
					rowValues(row, null)[0],
					index * 2 + 1,
					index * 2 + 2,
					{ $$kind: 'for', rows: [] },
					String(row.id),
					row.label,
				],
				[{ node: 0 }, ...RANGED_ROW_SITES],
			);
			expect(paintedTree(emittedRow)).toEqual(paintedTree(interpreted(list, null)));
		});

		it('compiles nothing for a site whose host is not a text host', () => {
			// A range under a `view` is the ordinary keyed list and never becomes
			// raw text at any value, so the site keeps its parameter and paints
			// nothing whatever it holds. That is the same stance the node loop
			// takes: it refuses a program that puts raw text under a `view`, and an
			// emission that compiled this site would have written exactly that.
			const withValue = throughEmission(LIST, 'createList', [0], () => ['a string'], LIST_SITES);
			expect(paintedTree(withValue)).toEqual(
				paintedTree(throughEmission(LIST, 'createList', [0], () => [])),
			);
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
				// The route check reads names; the applier also refuses by *value*.
				// A non-scalar under a scalar name would paint (coerced to '') a
				// first screen `prepareTemplateProgram` throws on.
				'a static prop whose value is not a scalar',
				{
					nodes: [
						{
							type: 'view',
							parent: -1,
							props: { class: { active: true } as unknown as string },
						},
					],
					events: [],
				},
				/non-scalar value for "class"/,
			],
			[
				'a bindings array that is present but empty',
				{
					nodes: [{ type: 'view', parent: -1, props: {}, bindings: [] }],
					events: [],
				},
				/empty bindings array/,
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
				'raw text the program spells `raw-text` rather than `#text`',
				{
					nodes: [
						{ type: 'text', parent: -1, props: {} },
						{ type: 'raw-text', parent: 0, props: {} },
					],
					events: [],
				},
				/only emits when the program spells it `#text`/,
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
				'an event site at a priority the dispatcher does not know',
				// Cast, because the refusal is about a program the declared type
				// says cannot exist. An emitter that trusted that type is the bug
				// this case catches, so the case has to be able to express it.
				{
					nodes: [{ type: 'view', parent: -1, props: {} }],
					events: [{ node: 0, type: 'bindtap', priority: 'urgent' }],
				} as unknown as UniversalHostTemplateProgram,
				/declares priority "urgent", which is not discrete, continuous, or default/,
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

		// A range site is the caller's claim about a shape this function never
		// sees, so the three things `universalTemplateProgramWithoutRanges`
		// guarantees about one are re-checked rather than trusted — the same
		// stance the node and event loops take toward the program itself.
		const rangeCases: readonly (readonly [
			string,
			UniversalHostTemplateProgram,
			readonly LynxMainThreadProgramRange[],
			RegExp,
		])[] = [
			[
				'a keyed range naming a node the program does not have',
				RANGED_ROW,
				[{ node: 9 }],
				/does not have/,
			],
			[
				'two keyed ranges on one host, which no reduction produces',
				RANGED_ROW,
				[{ node: 1 }, { node: 1 }],
				/more than one keyed range/,
			],
			[
				'a keyed range on raw text, which holds no children at all',
				RANGED_ROW,
				[{ node: 4 }],
				/cannot hold a keyed range/,
			],
		];
		for (const [label, program, ranges, message] of rangeCases) {
			it(label, () => {
				expect(() => emitLynxMainThreadProgram(program, { name: 'create', ranges })).toThrow(
					message,
				);
				expect(() => emitLynxMainThreadProgram(program, { name: 'create', ranges })).toThrow(
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
		for (const name of [
			'append',
			'papi',
			'view',
			'rawText',
			'parent',
			'n0',
			'v2',
			'e0',
			'r1',
			'c0',
			't0',
		]) {
			expect(() => emitLynxMainThreadProgram(ROW, { name })).toThrow(/binds itself/);
		}
		for (const name of ['function', 'class', 'return', 'this']) {
			expect(() => emitLynxMainThreadProgram(ROW, { name })).toThrow(TypeError);
		}
		// Not reserved words, but a named function expression may not bind either
		// in strict (module) code, which is where the bundler parses the
		// emission — the same SyntaxError three steps downstream.
		for (const name of ['eval', 'arguments']) {
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
