/**
 * Issue-#135 item 1b — a compiled component driving the Block core.
 *
 * `block-background.ts` refused every compiled component: the Block core has no
 * hook cells, so a component had no program to be, and the only producer of a
 * `LynxBlockProgram` was a hand-written fixture. A hand-written program is an
 * architecture floor rather than a framework measurement, which is why item 1
 * exists at all.
 *
 * This closes the half of that gap which needs no hook runtime. A compiled
 * component's body is `universalValue(plan, values)` — a plan reference plus a
 * flat slot array — and #136 published the plan → wire-program lowering on
 * `octane/universal/template-program`. So for a component whose setup runs
 * without a hook runtime, calling it hands you both halves of a block program:
 * the plan lowers to the template, and the slot values become the block's
 * values. Nothing here is Block-specific except the last step; the lowering is
 * the same one the universal core uses, asked of the same driver, which is what
 * keeps the two cores from drifting apart on what a component means.
 *
 * ## What this deliberately does not cover, and why the refusals are loud
 *
 * A component that calls a hook reaches `universal-core.ts`'s claim controller,
 * whose current-attempt and owner bindings are module-private: the hooks are
 * physically present in a `core: 'block'` bundle and are not reachable from it.
 * Whether that layer arrives by extracting the hook module or by some other
 * route is an open design decision, so a hooked component is refused here by
 * name rather than half-rendered.
 *
 * A range site — a plan slot holding a keyed `universalFor` — is refused the
 * same way. The shape pass describes such a slot as a `#text` child, and only
 * the value can tell a range from a text hole; `prepareUniversalTemplateProgramValues`
 * already declines that instance, and this turns the decline into a diagnostic
 * that says which seam is missing. Filling it is item 1c.
 *
 * Both refusals name the component, because a bundle that silently rendered
 * nothing would be far worse than one that says which piece it lacks.
 */

import type {
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostTemplateProgramValue,
	UniversalPlan,
	UniversalPlanValue,
	UniversalRenderContext,
} from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	prepareUniversalTemplateProgramValues,
	type CompiledUniversalTemplateProgram,
	type PreparedUniversalTemplateProgram,
	type UniversalHostEncoder,
} from 'octane/universal/template-program';
import type { LynxComponent } from '../intrinsics.js';
import {
	createLynxClientDriver,
	type LynxClientContainer,
	type LynxPublicHandle,
} from './client-driver.js';
import { compileLynxBlockTemplate, type LynxBlock, type LynxBlockTemplate } from './block-core.js';
import type { LynxBlockProgram, LynxBlockProgramContext } from './block-program.js';
import { LYNX_TRANSPORT_RENDERER } from './protocol.js';
import type { LynxBlockListener } from './block-root.js';

/**
 * `universalValue`'s tag, reproduced rather than imported.
 *
 * It is a registered symbol, so `Symbol.for` yields the identical value in any
 * realm and module. Importing it would name `universal-core.ts` — the module
 * this whole core exists to leave out of the bundle — for the sake of a tag.
 *
 * Annotated `symbol` rather than left to infer a `unique symbol`, because the
 * declared type of `$$kind` is the core module's own unique symbol and two
 * unique symbols are distinct to the checker however identical they are at
 * runtime.
 */
const UNIVERSAL_VALUE: symbol = Symbol.for('octane.universal.value');

/** What `universal-core.ts` throws when a hook runs with no render attempt. */
const HOOKS_WITHOUT_ATTEMPT =
	'Universal hooks may only run while a universal component is rendering.';

/** Why an effect is the same refusal as a hook, said once. */
const EFFECTS_UNSUPPORTED =
	'its setup declares an effect, and an effect is a hook cell the Block core does not have yet (issue #135 item 1b).';

/** The two ways out of every refusal below, so they read the same. */
const REMEDY =
	'Attach a block program with withLynxBlockProgram(), or build with core: "universal".';

/**
 * The renderer's own driver, with the one capability the wire owns rather than
 * the core answered here.
 *
 * `prepareUniversalTemplateProgram` refuses a renderer whose main thread has
 * not negotiated `templateProgramMount`, and it is right to: for the universal
 * core that negotiation decides whether to take the template path *instead of*
 * the ordinary one. The Block core has no ordinary one — a template is its
 * representation — and `block-core.ts` already answers the wire's question by
 * itself, emitting the legacy spelling of the same template until the main
 * thread has negotiated the run vocabulary. Consulting the negotiation here
 * would refuse every first mount instead, because the negotiation cannot
 * complete before the first commit that carries it.
 *
 * Everything else is the driver as authored, and deliberately so: the encoder
 * asks it what a prop encodes to and what priority an event dispatches at, so
 * a lowering that asked anything else could disagree with what the component
 * path actually sends (#136's tap priority was exactly that).
 */
function loweringDriver(
	container: LynxClientContainer,
): UniversalHostDriver<LynxClientContainer, LynxPublicHandle> {
	const driver = createLynxClientDriver(container);
	return {
		...driver,
		// Object.create rather than a spread: the negotiated members are live
		// getters, and snapshotting them here would answer a later question with
		// a mount-time value.
		capabilities: Object.create(driver.capabilities ?? null, {
			templateProgramMount: { value: true, enumerable: true },
		}) as UniversalHostCapabilities,
	};
}

function componentName(component: LynxComponent<never>): string {
	const name = (component as { name?: unknown }).name;
	return typeof name === 'string' && name.length !== 0 ? name : '(anonymous)';
}

function refuse(component: LynxComponent<never>, reason: string): never {
	throw new Error(
		`Octane Lynx cannot lower component ${componentName(component)} onto the Block core: ` +
			`${reason} ${REMEDY}`,
	);
}

/**
 * Call the component and read the plan value it returned.
 *
 * The call is bare — no render attempt, no owner. That is the whole scope
 * boundary of this slice: a hook-free setup needs neither, and a hooked one
 * throws out of the claim controller, which is caught here and reported as the
 * missing layer rather than as an internal error naming a module the
 * application never mentioned.
 */
function renderPlanValue(
	component: LynxComponent<never>,
	props: unknown,
	context: UniversalRenderContext,
): { readonly plan: UniversalPlan; readonly values: readonly unknown[] } {
	let rendered: unknown;
	try {
		rendered = (
			component as unknown as (props: unknown, context: UniversalRenderContext) => unknown
		)(props, context);
	} catch (error) {
		if (error instanceof Error && error.message === HOOKS_WITHOUT_ATTEMPT) {
			refuse(
				component,
				'its setup calls a hook, and the Block core has no hook cells (issue #135 item 1b).',
			);
		}
		throw error;
	}
	const value = rendered as UniversalPlanValue | null;
	if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
		refuse(
			component,
			'it did not return a compiled template, so there is nothing to lower. Only a component the Octane compiler lowered to a universal plan can become a block program.',
		);
	}
	return { plan: value.plan, values: value.values };
}

/**
 * Lower a compiled component into a program the Block core can mount.
 *
 * The program keeps the template it mounted and the block it mounted it as, so
 * a re-render is a slot diff against the values that block already holds — the
 * Block model's change-proportional write — rather than a re-mount.
 */
export function lynxBlockProgramForComponent<Props>(
	component: LynxComponent<Props>,
): LynxBlockProgram<Props> {
	const subject = component as unknown as LynxComponent<never>;
	/**
	 * The second argument a compiled component is called with.
	 *
	 * Every member of it needs the render attempt this slice does not stand up —
	 * an effect is a hook cell by another name, and reading a context walks the
	 * owner chain. Passing `undefined` would refuse them too, with a TypeError
	 * naming a property rather than the layer. These refuse by name instead, so
	 * a component that takes an effect is diagnosed the same way as one that
	 * takes a hook, which is what it is.
	 */
	const renderContext: UniversalRenderContext = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		readContext(): never {
			refuse(
				subject,
				'its setup reads a context, which needs the owner chain the Block core does not have yet (issue #135 item 1b).',
			);
		},
		insertionEffect(): never {
			refuse(subject, EFFECTS_UNSUPPORTED);
		},
		layoutEffect(): never {
			refuse(subject, EFFECTS_UNSUPPORTED);
		},
		effect(): never {
			refuse(subject, EFFECTS_UNSUPPORTED);
		},
	});
	let encoder: UniversalHostEncoder | null = null;
	let plan: UniversalPlan | null = null;
	let compiled: CompiledUniversalTemplateProgram | null = null;
	let prepared: PreparedUniversalTemplateProgram | null = null;
	let block: LynxBlock | null = null;

	/**
	 * One encoder for the life of the program.
	 *
	 * It decides what a prop encodes to and what priority an event dispatches
	 * at by asking the renderer's own driver, which is deliberate: the
	 * hand-written fixture declared a tap priority the driver would not (#136),
	 * and a lowering that asks cannot drift from what the component path
	 * dispatches. It is also where `prepareUniversalTemplateProgram` memoizes,
	 * so a per-render encoder would re-derive the wire program every update.
	 */
	const encoderFor = (context: LynxBlockProgramContext): UniversalHostEncoder =>
		(encoder ??= createUniversalHostEncoder({
			driver: loweringDriver(context.container),
			container: context.container,
			renderer: LYNX_TRANSPORT_RENDERER,
			resourceRoot: context.root.transportRoot,
			transported: true,
		}));

	/** The wire values for one render, or a diagnostic naming why there are none. */
	const valuesFor = (
		context: LynxBlockProgramContext,
		slotValues: readonly unknown[],
	): readonly UniversalHostTemplateProgramValue[] => {
		const values = prepareUniversalTemplateProgramValues(
			encoderFor(context),
			compiled!,
			prepared!,
			slotValues,
		);
		if (values === null) {
			refuse(
				subject,
				'one of its holes does not hold a value this template can carry — a keyed range site is the usual reason, and the Block core has no range lowering yet (issue #135 item 1c).',
			);
		}
		return values;
	};

	/** Every event site's handler for this render, in the program's site order. */
	const listenersFor = (slotValues: readonly unknown[]): readonly LynxBlockListener[] =>
		prepared!.events.map((site) => slotValues[site.slot] as LynxBlockListener);

	return {
		mount(context, props) {
			const rendered = renderPlanValue(subject, props, renderContext);
			const root = rendered.plan.root;
			if (root.kind !== 'host') {
				refuse(
					subject,
					`its template is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a block mounts one host subtree.`,
				);
			}
			const program = compiledUniversalTemplateProgram(root);
			if (program === null) {
				refuse(
					subject,
					'its template is not entirely compile-time host structure, so there is no static template to mount.',
				);
			}
			const wire = prepareUniversalTemplateProgram(encoderFor(context), program);
			if (wire === null) {
				refuse(
					subject,
					'this renderer cannot carry one of its static props or event sites in a template program.',
				);
			}
			plan = rendered.plan;
			compiled = program;
			prepared = wire;
			const template: LynxBlockTemplate = compileLynxBlockTemplate(wire.wire);
			block = context.core.mount(null, null, template, valuesFor(context, rendered.values));
			if (wire.events.length !== 0) {
				context.root.bindListeners(block, listenersFor(rendered.values));
			}
		},

		update(context, props) {
			const rendered = renderPlanValue(subject, props, renderContext);
			// A block program mounts one template. A component that returns a
			// different plan on a later render is a different program, and
			// `block-background.ts` already refuses to swap the program it mounted;
			// this is that refusal one level down, where the plan is what changed
			// rather than the component.
			if (rendered.plan !== plan) {
				refuse(
					subject,
					'a later render returned a different compiled template than the one it mounted, and a block holds one template for its lifetime.',
				);
			}
			const values = valuesFor(context, rendered.values);
			// The live values are the core's, not a copy kept here: a shadow of them
			// could only ever drift, and comparing against what the block actually
			// holds is what the core itself compares against.
			const held = block!.values;
			const worklets = block!.template.mainThreadValues;
			for (let index = 0; index < values.length; index++) {
				// The scoped write: only the slots a render moved reach the core, which
				// is what keeps `blockLookups` a count of the change rather than of the
				// template. `Object.is` because that is exactly the comparator the core
				// applies to an ordinary slot, so skipping here decides what
				// `setSlotValue` would have decided.
				//
				// A worklet slot is never skipped. Its value is an object the compiler
				// rebuilds every render, so identity cannot answer for it, and the
				// core's structural comparator is the only one that can — including
				// for the case where the slot holds a malformed descriptor that a
				// later write has to repair.
				if (worklets?.[index] !== true && Object.is(values[index], held[index])) continue;
				context.core.setSlotValue(block!, index, values[index]!);
			}
			// Handlers are fresh closures every render, closing over this render's
			// props, so the binding is replaced rather than kept. The wire is
			// untouched: a listener id belongs to the block, and rebinding moves
			// only which function that id reaches.
			if (prepared!.events.length !== 0) {
				context.root.bindListeners(block!, listenersFor(rendered.values));
			}
		},

		unmount(context) {
			if (block !== null && prepared !== null && prepared.events.length !== 0) {
				context.root.releaseListeners(block);
			}
			block = null;
		},
	};
}
