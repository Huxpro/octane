/**
 * Issues #163 and #373 — deriving a shared host program from a plan at build time.
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
 * ## Every renderable hole is a range site, and that is what makes this decidable
 *
 * At run time `universalTemplateProgramWithoutRanges` has to *ask* which holes
 * hold a keyed range, because a renderable hole is one plan node whatever it
 * holds: a `@for` and a `{row.label as string}` arrive as the same shape and
 * only the value tells them apart. That is why the C0 spike had to evaluate the
 * module it was deriving from.
 *
 * A build has no values, and the compiler's answer is that it does not need
 * them, because it never claims a *hole* is content. `compile-universal.js`
 * lowers every dynamic child that stays a child — a directive, a component, a
 * bare `{expr}` — to `kind: 'slot'`, and never to `kind: 'text'`. That is
 * deliberate and is asserted in `octane/tests/lynx-target-templates.test.ts`:
 * conflating a hole the writer sets in place with one whose members are
 * instantiated leaves the dispatch from operation to slot undecidable (see #61's
 * closure analysis). So the question the runtime has to ask its caller has one
 * answer here, and nothing is evaluated to reach it.
 *
 * What *did* change is which children stay children. `{expr as string}` is the
 * form `docs/differences-from-react.md` requires for dynamic text, so the author
 * has asserted the shape the compiler could not infer; as the lone child of a
 * host that accepts `text`, it folds onto that host as a `text` binding and the
 * carrier is never built (#242 Cause B / #246 B2). The hole is gone rather than
 * reclassified, so the predicate below is still only ever asked about ranges, and
 * a lying cast lands in a prop all three appliers render as empty rather than in
 * a slot the writer would set in place.
 *
 * Content the compiler holds neither as a value nor as a proved-scalar binding is
 * still a range site at build time — a bare `{expr}` under a `<text>`, or any
 * hole under a host with no `text` prop — so for those the compiled create
 * function paints the static structure and the bound scalar props, and the text a
 * row actually shows arrives through the range protocol.
 */

import type {
	UniversalHostPlan,
	UniversalPlanNode,
	UniversalHostTemplateProgram,
	UniversalHostTemplateCapability,
	UniversalHostPropCodecContext,
	UniversalTemplateHostPlacement,
} from 'octane/universal/native';
import {
	compileUniversalHostProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	universalTemplateProgramWithoutRanges,
	type UniversalHostEncoder,
} from 'octane/universal/template-program';
import type { UniversalHostCapabilities } from 'octane/universal/native';

import { createLynxClientDriver, type LynxClientContainer } from '../core/client-driver.js';
import { LYNX_TRANSPORT_RENDERER } from '../core/protocol.js';
import {
	emitLynxMainThreadProgram,
	LynxMainThreadEmitRefusal,
} from './emit-main-thread-program.js';
import { LYNX_PROGRAM_IR_VERSION, type LynxProgramIR } from './ir.js';

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
 * Compiler-authored `main-thread:` props are the one encoding exception: keep
 * their transport descriptors in resident slots so the compact product can
 * validate and activate them after crossing threads. Ordinary props and event
 * priorities still come from the renderer's own driver.
 */
function buildTimeLoweringDriver(): ReturnType<typeof createLynxClientDriver> {
	const driver = createLynxClientDriver();
	const props = driver.props!;
	return {
		...driver,
		templates: COMPILED_TEMPLATE_HOSTS,
		props: Object.freeze({
			encode(context: UniversalHostPropCodecContext<LynxClientContainer>) {
				if (context.name.startsWith('main-thread:')) {
					return { kind: 'value' as const, value: context.value as never };
				}
				return props.encode(context);
			},
		}),
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
 * and for nothing else — a content hole is a `kind: 'text'` node carrying a
 * `slot`, and is never a candidate — so the question is only whether a
 * `kind: 'slot'` node can hold something a range cannot. From a plan the
 * compiler produced it cannot, because that is the only kind it builds for a
 * dynamic child; see the header for why a cast does not change that.
 *
 * At run time the same predicate has to look at values, because a value is the
 * only thing that can tell a one-string hole from a keyed list. That is the
 * evaluation this slice exists to avoid, and it can be avoided only by giving up
 * the same thing the compiler gave up: knowing that a particular hole is text.
 *
 * For the shapes this is *not* asked about — a hand-written program's `#text`
 * bound on `value` — the direction of the remaining error is the safe one.
 * Answering `true` for a hole that turns out to hold content makes
 * `universalTemplateProgramWithoutRanges` insist it be its parent's last child
 * and decline the plan otherwise, so this can only *decline* programs a
 * value-aware caller would have described, never describe one it would not.
 * A declined plan is a first screen on the command path, which is what #163's
 * C3 is for.
 */
const COMPILED_TEMPLATE_HOSTS: UniversalHostTemplateCapability = Object.freeze({
	placement(type: string): UniversalTemplateHostPlacement {
		return type === 'list-item' ? 'root' : 'any';
	},
	defer(parentType: string, _program: UniversalHostTemplateProgram): boolean {
		return parentType === 'list';
	},
});

const EVERY_SLOT_HOLE_IS_A_RANGE = (): boolean => true;

interface HostRefReduction {
	readonly plan: UniversalHostPlan;
	readonly refs: readonly { readonly node: number; readonly slot: number }[];
}

/**
 * Remove authored host refs from the physical wire while retaining their stable
 * resident-node and plan-slot addresses. The rewrite is copy-on-write: parser-
 * adopted plan objects remain untouched, including under deep-freeze tests.
 */
function universalHostPlanWithoutRefs(plan: UniversalHostPlan): HostRefReduction | null {
	let nextNode = 0;
	const refs: { readonly node: number; readonly slot: number }[] = [];
	const visit = (node: UniversalPlanNode): UniversalPlanNode | null => {
		if (node.kind === 'slot') return node;
		if (node.kind === 'text') {
			nextNode++;
			return node;
		}
		if (node.kind !== 'host') return node;
		const residentNode = nextNode++;
		let changed = false;
		let props = node.props;
		if (props !== undefined && Object.prototype.hasOwnProperty.call(props, 'ref')) {
			if (props.ref !== null && props.ref !== undefined) return null;
			const { ref: _ref, ...rest } = props;
			props = rest;
			changed = true;
		}
		let bindings = node.bindings;
		if (bindings !== undefined) {
			let refSlot: number | null = null;
			const retained = [];
			for (const binding of bindings) {
				if (binding[0] !== 'ref') {
					retained.push(binding);
					continue;
				}
				if (refSlot !== null || !Number.isSafeInteger(binding[1]) || binding[1] < 0) return null;
				refSlot = binding[1];
			}
			if (refSlot !== null) {
				refs.push(Object.freeze({ node: residentNode, slot: refSlot }));
				bindings = retained.length === 0 ? undefined : retained;
				changed = true;
			}
		}
		let children = node.children;
		if (children !== undefined) {
			let rewritten: UniversalPlanNode[] | null = null;
			for (let index = 0; index < children.length; index++) {
				const child = visit(children[index]!);
				if (child === null) return null;
				if (rewritten !== null) rewritten.push(child);
				else if (child !== children[index]) {
					rewritten = children.slice(0, index) as UniversalPlanNode[];
					rewritten.push(child);
				}
			}
			if (rewritten !== null) {
				children = rewritten;
				changed = true;
			}
		}
		return changed ? { ...node, props, bindings, children } : node;
	};
	const reduced = visit(plan);
	if (reduced === null || reduced.kind !== 'host') return null;
	return { plan: reduced, refs: Object.freeze(refs) };
}

/**
 * Lower one plan into the shared compiler program IR, or `null` when this
 * renderer cannot describe it as a program. The background compile consumes
 * the result as its eligibility/address oracle; the main-thread compile also
 * emits its resident create function.
 *
 * `null` rather than a throw, because "not describable as a program" is the
 * ordinary answer for most plans — anything holding a component, a conditional,
 * a spread of props — and a caller's job is to leave those on the command path.
 * The emission's own refusals are the other kind: a program that *is*
 * describable but carries something the compiled create function would paint
 * differently, which is a build error naming what it was.
 */
function residentNodeIndexes(
	wire: UniversalHostTemplateProgram,
	values: readonly { readonly node: number }[],
	events: readonly { readonly node: number }[],
	ranges: readonly { readonly node: number; readonly before?: number | null }[],
	refs: readonly { readonly node: number }[],
): readonly number[] {
	const retained = new Set<number>([0]);
	for (const value of values) retained.add(value.node);
	for (const event of events) retained.add(event.node);
	for (const range of ranges) {
		retained.add(range.node);
		if (range.before !== undefined && range.before !== null) retained.add(range.before);
	}
	for (const ref of refs) retained.add(ref.node);
	for (let index = 0; index < wire.nodes.length; index++) {
		if (wire.nodes[index]!.type === 'list') retained.add(index);
	}
	return Object.freeze([...retained].sort((left, right) => left - right));
}

export function deriveLynxProgramIR(plan: UniversalHostPlan): LynxProgramIR | null {
	const encoder = buildTimeEncoder();
	const refReduction = universalHostPlanWithoutRefs(plan);
	if (refReduction === null) return null;
	const compiled = compileUniversalHostProgram(encoder, refReduction.plan);
	if (compiled === null) return null;
	const reduced = universalTemplateProgramWithoutRanges(compiled, EVERY_SLOT_HOLE_IS_A_RANGE);
	if (reduced === null) return null;
	const prepared = prepareUniversalTemplateProgram(encoder, reduced.compiled);
	if (prepared === null) return null;
	if (prepared.wire.nodes[0]?.type === 'list-item' && reduced.ranges.length !== 0) return null;
	const derived = Object.freeze({
		version: LYNX_PROGRAM_IR_VERSION,
		wire: prepared.wire,
		resident: residentNodeIndexes(
			prepared.wire,
			prepared.values,
			prepared.events,
			reduced.ranges,
			refReduction.refs,
		),
		values: prepared.values,
		events: prepared.events,
		ranges: reduced.ranges,
		...(refReduction.refs.length === 0 ? null : { refs: refReduction.refs }),
		// The emitter paints a range value only under a text host. Such a range's
		// runtime value can add a #text node to the background descriptor, so its
		// fixed wire cannot be addressed. Every other range stays an open structural
		// hole whose members are mounted separately under the same host node.
		addressable: reduced.ranges.every((range) => prepared.wire.nodes[range.node]!.type !== 'text'),
	});
	// The runtime lowering is deliberately broader than the compiled-create
	// backend: it can describe hosts and props that only the command path knows
	// how to write. A backend configured as the normal build default must decline
	// those plans here, before either thread assigns a positional address. Probe
	// with the emitter itself so eligibility cannot drift from what is emitted.
	// Only its explicit refusal is a conservative fallback; malformed backend
	// state and ordinary programming errors still fail the build.
	try {
		emitLynxMainThreadProgram(derived.wire, {
			name: 'octaneEligibilityProbe',
			residentNodes: derived.resident,
			ranges: derived.ranges,
			slotUpdates: true,
			structuralRuns: true,
		});
	} catch (error) {
		if (error instanceof LynxMainThreadEmitRefusal) return null;
		throw error;
	}
	return derived;
}
