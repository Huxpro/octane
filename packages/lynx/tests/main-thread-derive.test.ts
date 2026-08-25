// Issue-#163 C1b: deriving a main-thread program from a plan at build time.
//
// `deriveLynxMainThreadProgram` does not implement the lowering — it calls the
// same `octane/universal/template-program` functions that `block-component.ts`
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
	type UniversalHostPlan,
	type UniversalHostTemplateProgram,
	type UniversalHostTemplateProgramValue,
} from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	universalTemplateProgramWithoutRanges,
	type UniversalHostCapabilities,
} from 'octane/universal/template-program';

import { compileLynxBlockTemplate, createLynxBlockCore } from '../src/core/block-core.js';
import { createLynxClientContainer, createLynxClientDriver } from '../src/core/client-driver.js';
import { createLynxHostContainer, prepareLynxHostBatch } from '../src/core/host-driver.js';
import { LYNX_TRANSPORT_RENDERER } from '../src/core/protocol.js';
import { deriveLynxMainThreadProgram, emitLynxMainThreadProgram } from '../src/compiler/index.js';

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

describe('deriving a main-thread program from a plan', () => {
	it('lowers a plan the way the run-time lowering lowers it', () => {
		const derived = deriveLynxMainThreadProgram(CARD_PLAN);
		expect(derived).not.toBeNull();
		// No range holes in this plan, so both arms are told the same thing and
		// the only variable left is the container the build-time driver lacks.
		expect(derived).toEqual(throughRuntimeLowering(CARD_PLAN, () => false));
	});

	it('reads its keyed range holes off the plan rather than off a value', () => {
		const derived = deriveLynxMainThreadProgram(TABLE_PLAN);
		expect(derived).not.toBeNull();
		// Slot 1 is the `kind: 'slot'` hole and slot 0 is the `kind: 'text'` one.
		// A build that could not tell them apart would either mount the range as
		// a stray empty text node or drop the caption.
		expect(derived!.ranges).toEqual([{ slot: 1, node: 0 }]);
		expect(derived!.wire.nodes).toHaveLength(3);
		expect(derived).toEqual(throughRuntimeLowering(TABLE_PLAN, (slot) => slot === 1));
	});

	it('paints what the applier paints, through the emission', () => {
		const derived = deriveLynxMainThreadProgram(CARD_PLAN);
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
		expect(deriveLynxMainThreadProgram(SPREAD)).toBeNull();
	});

	it('declines a range that would be the whole program', () => {
		// Nothing would be left to insert and nothing to hold the rows.
		const BARE = universalPlan(LYNX_TRANSPORT_RENDERER, {
			kind: 'slot',
			slot: 0,
		}).root as UniversalHostPlan;
		expect(deriveLynxMainThreadProgram(BARE)).toBeNull();
	});
});
