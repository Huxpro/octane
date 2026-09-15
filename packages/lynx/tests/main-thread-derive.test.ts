// Issue #373: deriving the shared Lynx program IR from a plan at build time.
//
// `deriveLynxProgramIR` delegates to the same
// `octane/universal/template-program` functions that `block-component.ts`
// calls at run time, through the same renderer driver, on the same plan object
// the compiler already holds. So the test that matters is not "does it lower
// correctly" but the two questions the caller answers rather than the lowering:
//
//   * a build-time driver has no container, so its *negotiated* capabilities
//     all read false. If the lowering ever starts consulting one of those, a
//     build-time derivation silently stops describing programs a run-time one
//     describes — or worse, describes them differently.
//   * a run-time caller has to be *told* which holes are keyed ranges, because
//     a renderable hole is one plan node whatever it holds. A build has no
//     values to look at, and answers from the plan's own node kinds instead.
//
// Both are asserted directly. The end-to-end case then takes a derived program
// the whole way — through the emitter and through the applier it mirrors — so
// that a derivation which type-checks but describes the wrong tree is red.
import { describe, expect, it } from 'vitest';

import {
	universalPlan,
	type UniversalHostCapabilities,
	type UniversalHostPlan,
	type UniversalHostTemplateProgram,
	type UniversalHostTemplateProgramValue,
} from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	universalTemplateProgramWithoutRanges,
} from 'octane/universal/template-program';

import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import { LYNX_TRANSPORT_RENDERER } from '../src/core/protocol.js';
import {
	deriveLynxMainThreadProgram,
	deriveLynxProgramIR,
	emitLynxMainThreadProgram,
	LYNX_PROGRAM_IR_VERSION,
} from '../src/compiler/index.js';

import { createFakePAPI, shape, withoutAllocatorIdentity } from './_fixtures/fake-element-papi.js';

/** A card: a bound class, a static class beside a tap, and two text holes. */
const CARD_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	bindings: [['class', 0]],
	children: [
		{
			kind: 'host',
			type: 'text',
			// A program refuses an event on its root, so the tap sits where a real
			// card's tap sits anyway.
			props: { class: 'card-label' },
			bindings: [['bindtap', 3]],
			children: [{ kind: 'text', slot: 1 }],
		},
		{
			kind: 'host',
			type: 'view',
			bindings: [['class', 2]],
			children: [{ kind: 'host', type: 'text', props: {}, children: [{ kind: 'text', slot: 4 }] }],
		},
	],
}).root as UniversalHostPlan;

/** The same card with a keyed range as its last child. */
const TABLE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'table' },
	children: [
		{
			kind: 'host',
			type: 'text',
			props: { class: 'caption' },
			children: [{ kind: 'text', slot: 0 }],
		},
		// The keyed hole. `kind: 'slot'` is what a directive or component lowers
		// to; the `kind: 'text'` above is what a content hole lowers to, and that
		// is the whole distinction a build reads instead of a value.
		{ kind: 'slot', slot: 1 },
	],
}).root as UniversalHostPlan;

/** A keyed range followed by a retained static sibling in the same host. */
const NON_TAIL_TABLE_PLAN = universalPlan(LYNX_TRANSPORT_RENDERER, {
	kind: 'host',
	type: 'view',
	props: { class: 'table' },
	children: [
		{ kind: 'slot', slot: 0 },
		{
			kind: 'host',
			type: 'text',
			props: { class: 'footer' },
			children: [{ kind: 'text', value: 'tail' }],
		},
	],
}).root as UniversalHostPlan;

/**
 * The lowering as `block-component.ts` asks for it: a live client container,
 * with the one negotiated capability the lowering insists on forced true.
 *
 * This is the arm the build-time derivation has to match. It is built here
 * rather than reached for, because the run-time one is a closure inside a
 * program factory — but it is built the same way, from the same exported
 * driver, so a change to how the renderer classifies props or events moves both
 * or neither.
 */
function throughRuntimeLowering(
	plan: UniversalHostPlan,
	isRange: (slot: number) => boolean,
): unknown {
	const container = createLynxClientContainer();
	const driver = createLynxClientDriver(container);
	const encoder = createUniversalHostEncoder({
		driver: {
			...driver,
			capabilities: Object.create(driver.capabilities ?? null, {
				templateProgramMount: { value: true, enumerable: true },
			}) as UniversalHostCapabilities,
		},
		container,
		renderer: LYNX_TRANSPORT_RENDERER,
		resourceRoot: 1,
		transported: true,
	});
	const compiled = compiledUniversalTemplateProgram(encoder, plan);
	if (compiled === null) return null;
	const reduced = universalTemplateProgramWithoutRanges(compiled, isRange);
	if (reduced === null) return null;
	const prepared = prepareUniversalTemplateProgram(encoder, reduced.compiled);
	if (prepared === null) return null;
	return {
		wire: prepared.wire,
		values: prepared.values,
		events: prepared.events,
		ranges: reduced.ranges,
	};
}

/** The fake host with the intrinsic factories a real PAPI always publishes. */
function createHost(): ReturnType<typeof createFakePAPI> {
	const papi = createFakePAPI();
	return {
		...papi,
		intrinsics: {
			view: (pageId: number) => papi.createElement('view', pageId, ''),
			text: (pageId: number) => papi.createElement('text', pageId, ''),
			rawText: (value: string) => papi.createElement('#text', 0, value),
		},
	};
}

function withoutNodesRefSelector(node: unknown): unknown {
	const value = node as { readonly children: readonly unknown[] };
	return { ...value, selector: '', children: value.children.map(withoutNodesRefSelector) };
}

function paintedTree(node: unknown): unknown {
	return withoutAllocatorIdentity(withoutNodesRefSelector(node));
}

/** One instance of `program`, painted by the dense applier: the reference arm. */
function throughApplier(
	program: UniversalHostTemplateProgram,
	values: readonly UniversalHostTemplateProgramValue[],
): unknown {
	const papi = createHost();
	const container = createLynxHostContainer(papi, { root: 1 });
	const core = createLynxBlockCore();
	core.mount(null, null, compileLynxBlockTemplate(program), values);
	const batch = core.flush();
	if (batch !== null) prepareLynxHostBatch(container, batch).apply();
	return shape(papi.pages[0]!);
}

/** The same instance, painted by the emitted create function. */
function throughEmission(
	program: UniversalHostTemplateProgram,
	name: string,
	args: readonly unknown[],
): unknown {
	const papi = createHost();
	// The container is what opens the page, which is the only thing this arm
	// shares with the applier arm: after that the emitted code drives the PAPI
	// directly, which is the entire claim.
	createLynxHostContainer(papi, { root: 1 });
	const { source } = emitLynxMainThreadProgram(program, { name });
	const bind = new Function(`return (${source});`)() as (
		host: unknown,
	) => (...rest: never[]) => unknown;
	const page = papi.pages[0]!;
	// The emission returns an unattached subtree; its caller performs the single
	// append that puts it in the page.
	const nodes = bind(papi)(...([page.id, ...args] as never[])) as readonly never[];
	papi.insertBefore(page as never, nodes[0]!, null);
	return shape(papi.pages[0]!);
}

describe('deriving the shared Lynx program IR from a plan', () => {
	it('versions and freezes the thread-neutral compiler boundary', () => {
		const ir = deriveLynxProgramIR(CARD_PLAN);
		expect(ir).not.toBeNull();
		expect(LYNX_PROGRAM_IR_VERSION).toBe(1);
		expect(ir!.version).toBe(LYNX_PROGRAM_IR_VERSION);
		expect(Object.isFrozen(ir)).toBe(true);
		const { version, ...derived } = ir!;
		expect(version).toBe(1);
		expect(derived).toEqual(deriveLynxMainThreadProgram(CARD_PLAN));
	});

	it('lowers a plan the way the run-time lowering lowers it', () => {
		const derived = deriveLynxProgramIR(CARD_PLAN);
		expect(derived).not.toBeNull();
		const { version, addressable, resident, ...lowered } = derived!;
		// No range holes in this plan, so both arms are told the same thing and
		// the only variable left is the container the build-time driver lacks.
		expect(version).toBe(1);
		expect(addressable).toBe(true);
		expect(resident).toEqual([0, 1, 2, 3, 5]);
		expect(Object.isFrozen(resident)).toBe(true);
		expect(lowered).toEqual(throughRuntimeLowering(CARD_PLAN, () => false));
	});

	it('extracts host refs into stable resident-node addresses without mutating the plan', () => {
		const plan = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			bindings: [['ref', 0]],
			children: [
				{ kind: 'host', type: 'text', children: [{ kind: 'text', slot: 1 }] },
				{ kind: 'host', type: 'view', bindings: [['ref', 2]] },
			],
		}).root as UniversalHostPlan;
		const originalBindings = plan.bindings;
		const nestedBindings = (plan.children![1] as UniversalHostPlan).bindings;

		const derived = deriveLynxProgramIR(plan);

		expect(derived).not.toBeNull();
		expect(derived!.refs).toEqual([
			{ node: 0, slot: 0 },
			{ node: 3, slot: 2 },
		]);
		expect(Object.isFrozen(derived!.refs)).toBe(true);
		expect(Object.isFrozen(derived!.refs![0])).toBe(true);
		expect(derived!.wire.nodes[0]!.bindings).toBeUndefined();
		expect(derived!.wire.nodes[3]!.bindings).toBeUndefined();
		expect(derived!.values.map((site) => site.slot)).toEqual([1]);
		expect(plan.bindings).toBe(originalBindings);
		expect(plan.bindings).toEqual([['ref', 0]]);
		expect((plan.children![1] as UniversalHostPlan).bindings).toBe(nestedBindings);
		expect((plan.children![1] as UniversalHostPlan).bindings).toEqual([['ref', 2]]);
	});

	it('reads its keyed range holes off the plan rather than off a value', () => {
		const derived = deriveLynxProgramIR(TABLE_PLAN);
		expect(derived).not.toBeNull();
		const { version, addressable, resident, ...lowered } = derived!;
		// Slot 1 is the `kind: 'slot'` hole and slot 0 is the `kind: 'text'` one.
		// A build that could not tell them apart would either mount the range as
		// a stray empty text node or drop the caption.
		expect(version).toBe(1);
		expect(addressable).toBe(true);
		expect(derived!.ranges).toEqual([{ slot: 1, node: 0, before: null }]);
		expect(resident).toEqual([0, 2]);
		expect(derived!.wire.nodes).toHaveLength(3);
		expect(lowered).toEqual(throughRuntimeLowering(TABLE_PLAN, (slot) => slot === 1));
	});

	it('records the next retained sibling for a non-tail keyed range', () => {
		const derived = deriveLynxProgramIR(NON_TAIL_TABLE_PLAN);
		expect(derived).not.toBeNull();
		const { version, addressable, resident, ...lowered } = derived!;
		expect(version).toBe(1);
		expect(addressable).toBe(true);
		expect(derived!.ranges).toEqual([{ slot: 0, node: 0, before: 1 }]);
		expect(resident).toEqual([0, 1]);
		expect(lowered).toEqual(throughRuntimeLowering(NON_TAIL_TABLE_PLAN, (slot) => slot === 0));
	});

	it('paints what the applier paints, through the emission', () => {
		const derived = deriveLynxProgramIR(CARD_PLAN);
		const program = derived!.wire;
		// The plan's slots in wire order: `values` says which plan slot each `v`
		// reads, and `events` the same for each `e`. Reading them rather than
		// assuming positional identity is the contract this pair has.
		const slotValues: readonly unknown[] = ['card active', 'Label', 'card-meta on', null, 'Detail'];
		const args = [
			...derived!.values.map((value) => slotValues[value.slot]),
			...derived!.events.map(() => () => undefined),
		];
		expect(paintedTree(throughEmission(program, 'createCard', args))).toEqual(
			paintedTree(
				throughApplier(
					program,
					derived!.values.map(
						(value) => slotValues[value.slot] as UniversalHostTemplateProgramValue,
					),
				),
			),
		);
	});

	it('declines a plan the renderer cannot describe as a program, rather than throwing', () => {
		// A spread of props is per-instance structure, not a slot: the lowering
		// refuses it, and a build has to leave that plan on the command path.
		const SPREAD = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			propsSlot: 0,
		}).root as UniversalHostPlan;
		expect(deriveLynxProgramIR(SPREAD)).toBeNull();
	});

	it('declines a described program whose props require the command path', () => {
		const COMMAND_ONLY_PROP = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			props: { class: 'root' },
			children: [
				{
					kind: 'host',
					type: 'text',
					props: { class: 'label', 'lynx-test-tag': 'demo-label' },
					children: [{ kind: 'text', value: 'Label' }],
				},
			],
		}).root as UniversalHostPlan;

		// The resident-program lowering can describe this standard Lynx prop, but
		// the compiled create-function backend has no proved scalar writer for it.
		// Default compilation must leave the plan on the command path before either
		// thread gives it a positional address.
		expect(throughRuntimeLowering(COMMAND_ONLY_PROP, () => false)).not.toBeNull();
		expect(deriveLynxProgramIR(COMMAND_ONLY_PROP)).toBeNull();
	});

	it('retains compiler-slot identity for two independently owned ranges under one host', () => {
		const SIBLINGS = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'view',
			children: [
				{ kind: 'slot', slot: 0 },
				{ kind: 'slot', slot: 1 },
			],
		}).root as UniversalHostPlan;
		expect(deriveLynxProgramIR(SIBLINGS)).toMatchObject({
			ranges: [
				{ slot: 0, node: 0, before: null },
				{ slot: 1, node: 0, before: null },
			],
		});
	});
	it('declines a native-list row with a structural range until cells can retain nested ownership', () => {
		const RANGED_LIST_ROW = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'host',
			type: 'list-item',
			props: { 'item-key': 'row-1' },
			children: [{ kind: 'slot', slot: 0 }],
		}).root as UniversalHostPlan;
		expect(deriveLynxProgramIR(RANGED_LIST_ROW)).toBeNull();
	});
	it('declines a range that would be the whole program', () => {
		// Nothing would be left to insert and nothing to hold the rows.
		const BARE = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'slot',
			slot: 0,
		}).root as UniversalHostPlan;
		expect(deriveLynxProgramIR(BARE)).toBeNull();
	});
});
