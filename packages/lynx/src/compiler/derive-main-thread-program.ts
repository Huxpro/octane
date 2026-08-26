/**
 * Issue-#163 C1 — deriving a host template program from a plan at build time.
 *
 * ## Why this exists
 *
 * `emit-main-thread-program.ts` compiles a `UniversalHostTemplateProgram` into
 * straight-line main-thread source. Nothing produced one at build time: the
 * program was either hand-written (`benchmarks/lynx-table/app/src/block-program.ts`)
 * or lowered from a plan *at run time*, once per mounted program, by
 * `block-component.ts`. Under #163 the program has to exist before the bundle
 * does, because the whole point is that the main-thread chunk carries the
 * compiled create function rather than an interpreter and a description.
 *
 * ## Why it reuses the runtime lowering instead of walking the AST
 *
 * The obvious build-time derivation reads the plan AST in the compiler and
 * rebuilds the wire program from it. That is a second implementation of
 * `prepareUniversalTemplateProgram`, and the two would have to agree about
 * every question that lowering answers: which props are static and which are
 * bindings, what an event prop's dispatch priority is, which names refuse the
 * program outright, how a `#text` hole becomes a bound node. A disagreement
 * would not be a build error — it would be a first screen painted from one
 * derivation and updated against the other.
 *
 * So this calls the same functions on the same plan objects, through the same
 * renderer driver. The compiler already holds `plan.root` as a plain object —
 * it serializes exactly that with `jsonValueToAst` — so there is nothing to
 * reconstruct. What is missing at build time is only the *container*, and
 * `createLynxClientDriver()` already accepts being built without one: its
 * negotiated capabilities then read `false`, which is why the one the lowering
 * insists on is forced here exactly as `block-component.ts` forces it.
 *
 * The consequence worth stating plainly: this cannot drift from the runtime
 * lowering, because it *is* the runtime lowering. What it can get wrong is the
 * two questions the caller answers rather than the lowering — which slots are
 * range sites, and which capabilities a build-time driver should claim — and
 * both are narrow enough to test directly.
 *
 * ## Range sites are syntactic here, and that is the point
 *
 * At run time `universalTemplateProgramWithoutRanges` has to *ask* which holes
 * hold a keyed range, because a renderable hole is one plan node whatever it
 * holds: a `@for` and a `{row.label as string}` arrive as the same shape and
 * only the value tells them apart. That is why the C0 spike had to evaluate the
 * module it was deriving from.
 *
 * In the plan itself they are already different nodes. A directive or component
 * hole lowers to `kind: 'slot'`; a text hole lowers to `kind: 'text'` with a
 * `slot`. `compile-universal.js`'s own `lynxTemplateSlotKinds` reads them
 * exactly that way — `'r'` for the former, `'c'` for the latter — for the same
 * reason #61's closure analysis gives: conflating them leaves the dispatch from
 * operation to slot undecidable. So the question the runtime has to ask its
 * caller is answered here by the plan's own node kinds, with nothing evaluated.
 */

import type { UniversalHostPlan, UniversalHostTemplateProgram } from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	universalTemplateProgramWithoutRanges,
	type PreparedUniversalTemplateProgramEvent,
	type PreparedUniversalTemplateProgramValue,
	type UniversalHostEncoder,
	type UniversalTemplateProgramRange,
} from 'octane/universal/template-program';
import type { UniversalHostCapabilities } from 'octane/universal/native';

import { createLynxClientDriver } from '../core/client-driver.js';
import { LYNX_TRANSPORT_RENDERER } from '../core/protocol.js';

/**
 * A plan lowered to the program the main-thread emission compiles, plus the two
 * maps its caller needs to drive it.
 *
 * `values` and `events` are how a plan slot reaches a wire slot: the emitted
 * create function takes `v0..vN` and `e0..eM` positionally, and these say which
 * plan slot each position reads. `ranges` is where the keyed holes were, which
 * the caller opens rather than paints.
 */
export interface LynxMainThreadDerivation {
	readonly wire: UniversalHostTemplateProgram;
	readonly values: readonly PreparedUniversalTemplateProgramValue[];
	readonly events: readonly PreparedUniversalTemplateProgramEvent[];
	readonly ranges: readonly UniversalTemplateProgramRange[];
}

/**
 * The renderer driver the lowering asks, built without a container.
 *
 * `block-component.ts` builds the same thing from a live container and forces
 * `templateProgramMount` on, because that capability is negotiated with the
 * main thread at mount and the lowering refuses without it. Here there is no
 * main thread to negotiate with, so the same force is the same statement: the
 * program is being derived *for* a host that mounts template programs, which is
 * the only kind of host a main-thread emission is built for.
 *
 * Nothing else is forced. Every other answer — what a prop encodes to, which
 * names are events and at what priority, which props refuse the program — comes
 * from the renderer's own driver, so a build-time derivation and a run-time one
 * classify identically or the driver is wrong for both.
 */
function buildTimeLoweringDriver(): ReturnType<typeof createLynxClientDriver> {
	const driver = createLynxClientDriver();
	return {
		...driver,
		// Object.create rather than a spread, matching `loweringDriver`: the
		// negotiated members are live getters and snapshotting them would answer a
		// later question with a build-time value. Here they would all snapshot to
		// `false`, which is exactly the wrong answer to bake in.
		capabilities: Object.create(driver.capabilities ?? null, {
			templateProgramMount: { value: true, enumerable: true },
		}) as UniversalHostCapabilities,
	};
}

function buildTimeEncoder(): UniversalHostEncoder {
	return createUniversalHostEncoder({
		driver: buildTimeLoweringDriver(),
		// The lowering classifies and encodes props; it never reaches the
		// container. Handing it one that does not exist is more honest than
		// building a fake host to satisfy a parameter nothing reads, and a path
		// that did reach for it would fail loudly here rather than quietly
		// deriving against a stand-in.
		container: undefined as never,
		renderer: LYNX_TRANSPORT_RENDERER,
		// Slot 0 of no root. A resource handle is a run-time object and cannot
		// appear in a plan's static props, so nothing is namespaced against this.
		resourceRoot: 0,
		// Matched to `block-component.ts` rather than chosen here. Deriving under
		// a laxer value contract than the one the program is driven under would
		// let a build describe a program the driver later refuses — a first
		// screen that compiles and then declines is worse than one that never
		// compiled. No fixture in the suite tells the two settings apart, so this
		// is an agreement with the run-time lowering rather than an observed
		// behaviour, and it is written down as one.
		transported: true,
	});
}

/**
 * Every hole this predicate is asked about is a keyed range.
 *
 * `universalTemplateProgramWithoutRanges` consults it for `kind: 'slot'` nodes
 * and for nothing else — a content hole is a `kind: 'text'` node with a `slot`
 * and is never a candidate — so the question reduces to whether a plan's
 * `kind: 'slot'` node can hold something other than a range. In a plan the
 * compiler produced it cannot: a directive or component hole lowers to
 * `kind: 'slot'` and a text hole lowers to `kind: 'text'`, which is exactly the
 * split `compile-universal.js`'s own `lynxTemplateSlotKinds` reads when it
 * calls the first `'r'` and the second `'c'`.
 *
 * At run time the same predicate has to look at values, because by then a hole
 * is one plan node whatever it holds. That is the evaluation this slice exists
 * to avoid, and the reason it can be avoided is that the plan drew the
 * distinction before any value existed.
 *
 * The direction of the remaining error matters and is the safe one. Answering
 * `true` for a hole that turns out to hold content makes
 * `universalTemplateProgramWithoutRanges` insist it be its parent's last child
 * and decline the plan otherwise — so this can only *decline* programs a
 * value-aware caller would have described, never describe one it would not.
 * A declined plan is a first screen on the command path, which is what #163's
 * C3 is for.
 */
const EVERY_SLOT_HOLE_IS_A_RANGE = (): boolean => true;

/**
 * Lower one plan into the program a main-thread emission compiles, or `null`
 * when this renderer cannot describe it as a program.
 *
 * `null` rather than a throw, because "not describable as a program" is the
 * ordinary answer for most plans — anything holding a component, a conditional,
 * a spread of props — and a caller's job is to leave those on the command path.
 * The emission's own refusals are the other kind: a program that *is*
 * describable but carries something the compiled create function would paint
 * differently, which is a build error naming what it was.
 */
export function deriveLynxMainThreadProgram(
	plan: UniversalHostPlan,
): LynxMainThreadDerivation | null {
	const encoder = buildTimeEncoder();
	const compiled = compiledUniversalTemplateProgram(encoder, plan);
	if (compiled === null) return null;
	const reduced = universalTemplateProgramWithoutRanges(compiled, EVERY_SLOT_HOLE_IS_A_RANGE);
	if (reduced === null) return null;
	const prepared = prepareUniversalTemplateProgram(encoder, reduced.compiled);
	if (prepared === null) return null;
	return Object.freeze({
		wire: prepared.wire,
		values: prepared.values,
		events: prepared.events,
		ranges: reduced.ranges,
	});
}
