/**
 * Issue-#135 item 1 — a compiled component driving the Block core.
 *
 * `block-background.ts` refused every compiled component: the Block core has no
 * hook cells, so a component had no program to be, and the only producer of a
 * `LynxBlockProgram` was a hand-written fixture. A hand-written program is an
 * architecture floor rather than a framework measurement, which is why item 1
 * exists at all.
 *
 * A compiled component's body is `universalValue(plan, values)` — a plan
 * reference plus a flat slot array — and #136 published the plan → wire-program
 * lowering on `octane/universal/template-program`. So calling the component
 * hands you both halves of a block program: the plan lowers to the template,
 * and the slot values become the block's values. Nothing here is Block-specific
 * except the last step; the lowering is the same one the universal core uses,
 * asked of the same driver, which is what keeps the two cores from drifting
 * apart on what a component means.
 *
 * The page's setup runs inside a `createUniversalHookScope` (item 1b), so a
 * page that holds state is a program like any other, and a setter it hands to a
 * tap repaints it: the scope schedules, this module re-renders and commits. The
 * cells are the universal core's own, not a second implementation of them — a
 * restated update queue is where two cores drift.
 *
 * ## A keyed range is a hole the template must not describe (item 1c)
 *
 * A renderable hole is one plan node whatever it holds, so `@for` arrives as
 * the same `#text` child as `{row.label}` and only the value tells them apart.
 * A keyed range is not a text node with list-shaped content: it is real
 * children of the hole's *parent*, which is exactly what `openForSlot` opens
 * and what `fillForSlot`/`reconcileForSlot` maintain. So the range holes are
 * split out of the program before it is prepared
 * (`universalTemplateProgramWithoutRanges`), each becomes a range site on the
 * host node that held it, and every row lowers through the same plan → wire
 * path as the component itself.
 *
 * Rows are rendered before anything is written. A row the lowering cannot
 * describe therefore refuses with the range as it was, rather than leaving a
 * half-reconciled list on the wire.
 *
 * ## What this deliberately does not cover, and why the refusals are loud
 *
 * A **row** component that calls a hook is still refused by name. Rows render
 * outside the page's scope, and giving each one a scope of its own is giving
 * each one an owner — the per-row cost this core exists to avoid — so whether a
 * row can afford cells is its own question with its own measurement. Effects
 * and context reads are refused at both levels: an effect needs a commit phase
 * this core does not have, and a context read needs the owner chain a single
 * scope deliberately does not build.
 *
 * A range nested inside a range is refused too. Its rows would need range state
 * of their own, carried through every reconcile of the outer list, and that is
 * a second design rather than a wider loop.
 *
 * Every refusal names the component, because a bundle that silently rendered
 * nothing would be far worse than one that says which piece it lacks.
 */

import type {
	UniversalComponentValue,
	UniversalForValue,
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostTemplateProgramValue,
	UniversalPlan,
	UniversalPlanValue,
	UniversalPropsValue,
	UniversalRenderContext,
} from 'octane/universal/native';
// The one value import of the universal core, and the reason it is here: a
// compiled component's setup needs hook cells, and the cells live behind
// module state only `universal-core.ts` can reach. The hook functions the
// application calls are already linked into this bundle by the application
// module itself, so what this adds to the graph is the scope factory and the
// two record constructors it uses — not the reconciler, not a root.
import { createUniversalHookScope, type UniversalHookScope } from 'octane/universal/native';
import {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	prepareUniversalTemplateProgramValues,
	universalTemplateProgramWithoutRanges,
	type CompiledUniversalTemplateProgram,
	type PreparedUniversalTemplateProgram,
	type PreparedUniversalTemplateProgramEvent,
	type UniversalHostEncoder,
} from 'octane/universal/template-program';
import type { LynxComponent } from '../intrinsics.js';
import {
	createLynxClientDriver,
	type LynxClientContainer,
	type LynxPublicHandle,
} from './client-driver.js';
import {
	compileLynxBlockTemplate,
	type LynxBlock,
	type LynxBlockForSlot,
	type LynxBlockTemplate,
} from './block-core.js';
import type { LynxBlockProgram, LynxBlockProgramContext } from './block-program.js';
import { LYNX_TRANSPORT_RENDERER } from './protocol.js';
import type { LynxBlockListener } from './block-root.js';

/**
 * The universal value tags, reproduced rather than imported.
 *
 * They are registered symbols, so `Symbol.for` yields the identical value in
 * any realm and module. Importing them would name `universal-core.ts` — the
 * module this whole core exists to leave out of the bundle — for the sake of
 * three tags.
 *
 * Annotated `symbol` rather than left to infer a `unique symbol`, because the
 * declared type of `$$kind` is the core module's own unique symbol and two
 * unique symbols are distinct to the checker however identical they are at
 * runtime.
 */
const UNIVERSAL_VALUE: symbol = Symbol.for('octane.universal.value');
const UNIVERSAL_FOR: symbol = Symbol.for('octane.universal.for');
const UNIVERSAL_COMPONENT_VALUE: symbol = Symbol.for('octane.universal.component-value');
const UNIVERSAL_PROPS: symbol = Symbol.for('octane.universal.props');

/** What `universal-core.ts` throws when a hook runs with no render attempt. */
const HOOKS_WITHOUT_ATTEMPT =
	'Universal hooks may only run while a universal component is rendering.';

/** Why an effect is the same refusal as a hook, said once. */
const EFFECTS_UNSUPPORTED =
	'its setup declares an effect, and an effect needs a commit phase the Block core does not have yet (issue #135 item 1b).';

/** The two ways out of every refusal below, so they read the same. */
const REMEDY =
	'Attach a block program with withLynxBlockProgram(), or build with core: "universal".';

const EMPTY_LISTENERS: readonly (LynxBlockListener | null)[] = Object.freeze([]);

/**
 * Stands in for an empty conditional-handler hole through the values pass,
 * whose event check exists for the universal core's fall-back-on-decline. It
 * never runs and never reaches the wire: event slots carry no wire value, and
 * `listenersFor` maps the empty hole to an unbound site.
 */
const CONDITIONAL_HANDLER_STUB: () => void = () => undefined;

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

/** Whether a hole's value is a keyed range rather than something a slot carries. */
function isRangeValue(value: unknown): value is UniversalForValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_FOR
	);
}

/** One rendered template: the plan it named, and the slot values for it. */
interface RenderedPlan {
	/** The component that returned it, which is who a refusal has to name. */
	readonly source: LynxComponent<never>;
	readonly plan: UniversalPlan;
	readonly values: readonly unknown[];
}

/**
 * One keyed range hole, and everything derived from the rows that filled it.
 *
 * The row template is derived from the first row that ever exists rather than
 * at mount, because a list that starts empty has no row to derive it from and
 * an application that starts empty is the ordinary case.
 */
interface RangeState {
	/** The plan slot holding the `universalFor`. */
	readonly slot: number;
	/** The host node in the mounted template whose children the range owns. */
	readonly node: number;
	site: LynxBlockForSlot | null;
	plan: UniversalPlan | null;
	compiled: CompiledUniversalTemplateProgram | null;
	prepared: PreparedUniversalTemplateProgram | null;
	template: LynxBlockTemplate | null;
}

const EMPTY_RANGES: readonly RangeState[] = Object.freeze([]);

/** One range's whole next state, produced before any of it is written. */
interface RangeRender {
	readonly state: RangeState;
	readonly items: readonly unknown[];
	readonly key: (item: unknown, index: number) => unknown;
	readonly rows: readonly (readonly UniversalHostTemplateProgramValue[])[];
	readonly handlers: readonly (readonly (LynxBlockListener | null)[])[];
}

const EMPTY_RANGE_RENDERS: readonly RangeRender[] = Object.freeze([]);

/**
 * Lower a compiled component into a program the Block core can mount.
 *
 * The program keeps the template it mounted and the block it mounted it as, so
 * a re-render is a slot diff against the values that block already holds — the
 * Block model's change-proportional write — rather than a re-mount. A keyed
 * range is the same idea one level down: the rows a re-render produced are
 * reconciled against the members already in the range.
 */
export function lynxBlockProgramForComponent<Props>(
	component: LynxComponent<Props>,
): LynxBlockProgram<Props> {
	const subject = component as unknown as LynxComponent<never>;
	/**
	 * Which component the refusals below are about.
	 *
	 * A range whose rows are `<Row />` calls a second component per row, and a
	 * hook in *that* setup is the row's problem, not the page's — the page has
	 * cells now and the row does not. Tracking the
	 * component being called is what lets one shared render context name it.
	 */
	let rendering: LynxComponent<never> = subject;
	/**
	 * The second argument a compiled component is called with.
	 *
	 * The page's scope stands up cells, not a commit phase and not an owner
	 * chain: an effect needs somewhere to run after the host accepts the frame,
	 * and reading a context needs ancestors to search. Passing `undefined` would
	 * refuse them too, with a TypeError naming a property rather than the layer.
	 * These refuse by name instead.
	 */
	const renderContext: UniversalRenderContext = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		readContext(): never {
			refuse(
				rendering,
				'its setup reads a context, which needs the owner chain the Block core does not have yet (issue #135 item 1b).',
			);
		},
		insertionEffect(): never {
			refuse(rendering, EFFECTS_UNSUPPORTED);
		},
		layoutEffect(): never {
			refuse(rendering, EFFECTS_UNSUPPORTED);
		},
		effect(): never {
			refuse(rendering, EFFECTS_UNSUPPORTED);
		},
	});
	/**
	 * The page component's hook cells.
	 *
	 * One scope, for the subject only. A row component still gets none: a
	 * per-row scope is a per-row owner, which is the cost this core exists to
	 * avoid paying, and whether a row can afford one is its own measurement. So
	 * a hooked row keeps refusing by name — see `renderPlanValue`, which now
	 * only ever catches a row.
	 */
	let scope: UniversalHookScope | null = null;
	/**
	 * What a state-driven re-render needs, and the only reason they are kept.
	 *
	 * A render raised by a setter has no new props and no caller: the tap
	 * handler that ran it is long gone by the time the microtask lands. These
	 * are the two halves of `update`'s signature, recorded on the way through.
	 */
	let liveContext: LynxBlockProgramContext | null = null;
	let liveProps: unknown;
	/**
	 * Whether a state-driven re-render is already queued but has not started.
	 *
	 * A handler that writes two cells asks for one render, not two, and so does
	 * a storm that writes a cell every tick while the previous render is still
	 * waiting for its turn. Both fold into the render that has not run yet,
	 * because it will read the cells as they are when it starts — which is why
	 * this is cleared then rather than when the render is queued.
	 *
	 * Within a single handler only the render is saved: a second pass would find
	 * every slot unchanged and commit nothing, so the extra frame was never
	 * going to be sent. What it would have cost is a second setup call, a second
	 * lowering, and a second slot compare — and, for a page with a keyed range,
	 * a second render of every row in it.
	 */
	let renderQueued = false;

	let encoder: UniversalHostEncoder | null = null;
	let plan: UniversalPlan | null = null;
	let compiled: CompiledUniversalTemplateProgram | null = null;
	let prepared: PreparedUniversalTemplateProgram | null = null;
	let block: LynxBlock | null = null;
	let ranges: readonly RangeState[] = EMPTY_RANGES;

	/** Read a compiled component's return value, or say what it returned instead. */
	const readPlanValue = (source: LynxComponent<never>, produced: unknown): RenderedPlan => {
		const value = produced as UniversalPlanValue | null;
		if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
			refuse(
				source,
				'it did not return a compiled template, so there is nothing to lower. Only a component the Octane compiler lowered to a universal plan can become a block program.',
			);
		}
		return { source, plan: value.plan, values: value.values };
	};

	/**
	 * Call a component and read the plan value it returned.
	 *
	 * The page reaches this inside its hook scope, which is why the catch below
	 * now only ever fires for a **row**: rows render after the page's scope has
	 * closed, so a hooked one throws out of the claim controller. Reported as
	 * the missing layer rather than as an internal error naming a module the
	 * application never mentioned.
	 */
	const renderPlanValue = (source: LynxComponent<never>, props: unknown): RenderedPlan => {
		const outer = rendering;
		rendering = source;
		let produced: unknown;
		try {
			produced = (
				source as unknown as (props: unknown, context: UniversalRenderContext) => unknown
			)(props, renderContext);
		} catch (error) {
			if (error instanceof Error && error.message === HOOKS_WITHOUT_ATTEMPT) {
				refuse(
					source,
					'its setup calls a hook, and a row of a keyed range has no hook cells on the Block core (issue #135 item 1b). The page that contains it does.',
				);
			}
			throw error;
		} finally {
			rendering = outer;
		}
		return readPlanValue(source, produced);
	};

	/**
	 * Render the page component with its hook cells installed.
	 *
	 * Committing here rather than after the block is written is deliberate and
	 * narrow: every way out of `mount` and `update` below this point either
	 * succeeds or throws, and a throw from either is terminal for the program —
	 * a `refuse` names a shape the component will still have next render, and a
	 * duplicate key is the core rejecting a list it will still be handed. There
	 * is no later render for uncommitted cells to be right for.
	 */
	const renderSubject = (context: LynxBlockProgramContext, props: unknown): RenderedPlan => {
		liveContext = context;
		liveProps = props;
		const cells = (scope ??= createUniversalHookScope({
			renderer: LYNX_TRANSPORT_RENDERER,
			scheduleRender: queueStateRender,
		}));
		let rendered: RenderedPlan;
		try {
			rendered = cells.render(() => renderPlanValue(subject, props));
		} catch (error) {
			cells.abort();
			throw error;
		}
		cells.commit();
		return rendered;
	};

	/**
	 * Re-render the page because one of its own cells changed.
	 *
	 * `scheduleRender` rather than rendering on the setter's own stack. Three
	 * things come from taking a turn in the core's queue instead:
	 *
	 * - The render runs after the handler returns, so a handler that writes two
	 *   cells produces one frame rather than a torn one.
	 * - It cannot overlap a render a caller started. A commit flushes the core,
	 *   so two in flight means a second batch leaves with the first
	 *   unacknowledged.
	 * - A storm costs renders rather than ticks: `renderQueued` clears when the
	 *   render *starts*, so every write that lands while this one waits for its
	 *   turn folds into it.
	 */
	function queueStateRender(): void {
		if (renderQueued) return;
		const context = liveContext;
		// Unmounted, so there is nothing left to write the new values to.
		if (context === null || block === null) return;
		renderQueued = true;
		void context
			.scheduleRender(() => {
				renderQueued = false;
				// Unmounted while this waited its turn. The core's queue makes
				// that narrow — `unmountAsync` waits for work a program started
				// — but a program that has been torn down must not write, and
				// the check is cheaper than the invariant.
				if (block === null) return;
				renderAgain(context, liveProps as Props);
			})
			.catch((error: unknown) => {
				// Nowhere to return this to: the tap that wrote the cell returned
				// long ago, and the render it asked for is the whole frame.
				// Rethrown from a timer so it reaches the runtime's error
				// reporting instead of dying as a rejection the render queue
				// already marked handled.
				setTimeout(() => {
					throw error;
				}, 0);
			});
	}

	/**
	 * One encoder for the life of the program.
	 *
	 * It decides what a prop encodes to and what priority an event dispatches
	 * at by asking the renderer's own driver, which is deliberate: the
	 * hand-written fixture declared a tap priority the driver would not (#136),
	 * and a lowering that asks cannot drift from what the component path
	 * dispatches. It is also where `prepareUniversalTemplateProgram` memoizes,
	 * so a per-render encoder would re-derive the wire program every update —
	 * including once per keyed range.
	 */
	const encoderFor = (context: LynxBlockProgramContext): UniversalHostEncoder =>
		(encoder ??= createUniversalHostEncoder({
			driver: loweringDriver(context.container),
			container: context.container,
			renderer: LYNX_TRANSPORT_RENDERER,
			resourceRoot: context.root.transportRoot,
			transported: true,
		}));

	/**
	 * Stand in for every empty event hole before the values pass sees it.
	 *
	 * An event hole may legitimately be empty — a conditional handler is a site
	 * the render left unbound, the shape `block-root.ts` documents a `null`
	 * listener entry for. The values pass insists every event slot holds a
	 * function because the universal core falls back to its ordinary path on a
	 * decline; a block has no ordinary path, so the empty hole is stood in for
	 * here and the site stays unbound in `listenersAt`. The stub never reaches
	 * the wire: event slots carry no wire value.
	 *
	 * A row of a range needs this as much as the template around it, which is
	 * why it takes its sites rather than reading the program's.
	 */
	const withHandlerStubs = (
		source: LynxComponent<never>,
		sites: readonly PreparedUniversalTemplateProgramEvent[],
		slotValues: readonly unknown[],
	): readonly unknown[] => {
		let patched = slotValues;
		for (const site of sites) {
			const handler = slotValues[site.slot];
			if (typeof handler === 'function') continue;
			if (handler !== null && handler !== undefined) {
				refuse(
					source,
					`an event site of its template holds a ${typeof handler} rather than a handler function or an empty conditional hole.`,
				);
			}
			if (patched === slotValues) patched = slotValues.slice();
			(patched as unknown[])[site.slot] = CONDITIONAL_HANDLER_STUB;
		}
		return patched;
	};

	/** Every event site's handler for one render, in the program's site order. */
	const listenersAt = (
		sites: readonly PreparedUniversalTemplateProgramEvent[],
		slotValues: readonly unknown[],
	): readonly (LynxBlockListener | null)[] =>
		sites.length === 0
			? EMPTY_LISTENERS
			: sites.map((site) => {
					const handler = slotValues[site.slot];
					return typeof handler === 'function' ? (handler as LynxBlockListener) : null;
				});

	/** The wire values for one render, or a diagnostic naming why there are none. */
	const valuesFor = (
		context: LynxBlockProgramContext,
		slotValues: readonly unknown[],
	): readonly UniversalHostTemplateProgramValue[] => {
		const values = prepareUniversalTemplateProgramValues(
			encoderFor(context),
			compiled!,
			prepared!,
			withHandlerStubs(subject, prepared!.events, slotValues),
		);
		if (values === null) {
			refuse(
				subject,
				'one of its holes does not hold a value this template can carry. A hole that mounted as text and later held a keyed range is the usual reason: a block holds one template for its lifetime.',
			);
		}
		return values;
	};

	/** Every event site's handler for this render, in the program's site order. */
	const listenersFor = (slotValues: readonly unknown[]): readonly (LynxBlockListener | null)[] =>
		listenersAt(prepared!.events, slotValues);

	/**
	 * Render one row and lower it, deriving the row template from the first row
	 * that ever exists.
	 *
	 * Every row of a range is one template: that is what a `mount-template-run`
	 * is, and it is what makes a survivor's update a slot write rather than a
	 * re-mount. A row that named a different plan is refused rather than mounted
	 * into a range that cannot hold it.
	 */
	const renderRow = (
		context: LynxBlockProgramContext,
		state: RangeState,
		list: UniversalForValue,
		item: unknown,
		index: number,
	): {
		readonly values: readonly UniversalHostTemplateProgramValue[];
		readonly listeners: readonly (LynxBlockListener | null)[];
	} => {
		const produced = list.render(item, index);
		// A row authored as `<Row … />` is a component invocation rather than a
		// template: the plan is inside the component, so it is called for. The
		// component boundary itself — its own hooks, its own memo — is the layer
		// item 1b leaves open, and a row that needs one refuses by its own name.
		let rendered: RenderedPlan;
		if (
			produced !== null &&
			typeof produced === 'object' &&
			(produced as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
		) {
			rendered = renderPlanValue(
				(produced as UniversalComponentValue).component as unknown as LynxComponent<never>,
				forwardedProps(produced as UniversalComponentValue),
			);
		} else {
			// The page did return a compiled template — the row's output is what
			// did not — so the diagnostic must say which level failed.
			const value = produced as UniversalPlanValue | null;
			if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
				refuse(
					subject,
					'a row of one of its keyed ranges is not a compiled template. Only a row the Octane compiler lowered to a universal plan, or one authored as a component that returns one, can mount on a range site.',
				);
			}
			rendered = { source: subject, plan: value.plan, values: value.values };
		}
		if (state.plan === null) {
			const root = rendered.plan.root;
			if (root.kind !== 'host') {
				refuse(
					subject,
					`a row of one of its keyed ranges is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a range mounts one host subtree per row.`,
				);
			}
			const program = compiledUniversalTemplateProgram(encoderFor(context), root);
			if (program === null) {
				refuse(
					subject,
					'a row of one of its keyed ranges is not entirely compile-time host structure, so there is no static template to mount per row.',
				);
			}
			const wire = prepareUniversalTemplateProgram(encoderFor(context), program);
			if (wire === null) {
				refuse(
					subject,
					'this renderer cannot carry a static prop or event site of one of its keyed range rows in a template program.',
				);
			}
			state.plan = rendered.plan;
			state.compiled = program;
			state.prepared = wire;
			state.template = compileLynxBlockTemplate(wire.wire);
		} else if (rendered.plan !== state.plan) {
			refuse(
				subject,
				'two rows of one keyed range returned different compiled templates, and a range mounts one template for every row.',
			);
		}
		const sites = state.prepared!.events;
		const values = prepareUniversalTemplateProgramValues(
			encoderFor(context),
			state.compiled!,
			state.prepared!,
			withHandlerStubs(rendered.source, sites, rendered.values),
		);
		if (values === null) {
			refuse(
				subject,
				'a row of one of its keyed ranges holds a value the row template cannot carry — a range nested inside a range is the usual reason, and the Block core has no nested range lowering yet (issue #135 item 1c).',
			);
		}
		return { values, listeners: listenersAt(sites, rendered.values) };
	};

	/**
	 * Render every row of one range, without writing anything.
	 *
	 * Split from the write below on purpose. A row this lowering cannot describe
	 * has to refuse with the range as it was rather than leave a half-reconciled
	 * list on the wire, and the same reasoning runs one level up: a render that
	 * refuses anywhere must not have written the slots it got to first. So a
	 * whole render is produced, and only then applied.
	 */
	const renderRange = (
		context: LynxBlockProgramContext,
		state: RangeState,
		list: UniversalForValue,
	): RangeRender => {
		if (list.empty !== null) {
			refuse(
				subject,
				'one of its keyed ranges declares an @empty block, and a range site on the Block core has no empty branch yet.',
			);
		}
		const items = Array.from(list.items as Iterable<unknown>);
		// The core rejects a duplicate key too, but its rejection lands after the
		// page block was mounted — mid-write — so a retried render would mount a
		// second copy of the page. Rejecting here keeps the produce-the-whole-
		// render-then-apply rule: a render that cannot be applied writes nothing.
		const seen = new Set<unknown>();
		for (let index = 0; index < items.length; index++) {
			const itemKey = list.key(items[index], index);
			if (seen.has(itemKey)) {
				throw new Error(
					`Octane Lynx block core: duplicate key ${String(itemKey)} in a keyed range.`,
				);
			}
			seen.add(itemKey);
		}
		const rows: (readonly UniversalHostTemplateProgramValue[])[] = new Array(items.length);
		const handlers: (readonly (LynxBlockListener | null)[])[] = new Array(items.length);
		for (let index = 0; index < items.length; index++) {
			const row = renderRow(context, state, list, items[index], index);
			rows[index] = row.values;
			handlers[index] = row.listeners;
		}
		return { state, items, key: list.key, rows, handlers };
	};

	/**
	 * Bring one range site level with the render above.
	 *
	 * Handlers are rebound over the range in final order rather than only for
	 * the rows that arrived: a row's handlers close over that row's item and
	 * this render's props, so a survivor that kept its hosts still needs this
	 * render's closures. The linked list is already in item order once the
	 * reconcile returns, so that costs a walk rather than a lookup per row.
	 * A row that has an empty hole this render is released before it is rebound,
	 * for the reason `update` releases the block's own: binding skips an empty
	 * conditional hole rather than clearing it, so a row that withdrew a handler
	 * would otherwise keep reaching the closure of the render that last supplied
	 * one. Only such a row, because a row whose every site holds a function has
	 * every one of those sites overwritten by the bind — releasing it first
	 * would be two map writes per site to reach the state it is already in, on
	 * every row of every list on every render.
	 */
	const applyRange = (context: LynxBlockProgramContext, render: RangeRender): void => {
		const state = render.state;
		// A list that has never had a row has no template to reconcile against,
		// and nothing mounted to reconcile.
		if (state.template === null) return;
		context.core.reconcileForSlot(
			state.site!,
			state.template,
			render.items,
			render.key,
			(_item, index) => render.rows[index]!,
			(member) => {
				context.root.releaseListeners(member);
			},
		);
		if (state.prepared!.events.length === 0) return;
		let index = 0;
		for (let member = state.site!.head; member !== null; member = member.next) {
			const handlers = render.handlers[index++]!;
			if (handlers.includes(null)) context.root.releaseListeners(member);
			context.root.bindListeners(member, handlers);
		}
	};

	/** Every range's render for one set of slot values, or the first refusal. */
	const renderRanges = (
		context: LynxBlockProgramContext,
		slotValues: readonly unknown[],
	): readonly RangeRender[] => {
		if (ranges.length === 0) return EMPTY_RANGE_RENDERS;
		return ranges.map((range) => {
			const list = slotValues[range.slot];
			if (!isRangeValue(list)) {
				refuse(
					subject,
					'a hole that mounted a keyed range later held something else, and a block holds one template for its lifetime.',
				);
			}
			return renderRange(context, range, list);
		});
	};

	/**
	 * One later render of the page, whether its props changed or one of its
	 * own cells did. Named rather than inlined on the program because a
	 * state-driven render has no caller to reach it through.
	 */
	const renderAgain = (context: LynxBlockProgramContext, props: Props): void => {
		const rendered = renderSubject(context, props);
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
		// Every row of every range is rendered before the first slot is
		// written, so a render that refuses anywhere leaves the block exactly as
		// the last one left it rather than partly moved on.
		const rows = renderRanges(context, rendered.values);
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
		// only which function that id reaches. Released first because binding
		// skips an empty conditional hole rather than clearing it — a site
		// whose handler this render withdrew must stop reaching the previous
		// render's closure.
		if (prepared!.events.length !== 0) {
			context.root.releaseListeners(block!);
			context.root.bindListeners(block!, listenersFor(rendered.values));
		}
		for (const row of rows) applyRange(context, row);
	};

	const program: LynxBlockProgram<Props> = {
		mount(context, props) {
			const rendered = renderSubject(context, props);
			const root = rendered.plan.root;
			if (root.kind !== 'host') {
				refuse(
					subject,
					`its template is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a block mounts one host subtree.`,
				);
			}
			const program = compiledUniversalTemplateProgram(encoderFor(context), root);
			if (program === null) {
				refuse(
					subject,
					'its template is not entirely compile-time host structure, so there is no static template to mount.',
				);
			}
			const split = universalTemplateProgramWithoutRanges(program, (slot) =>
				isRangeValue(rendered.values[slot]),
			);
			if (split === null) {
				refuse(
					subject,
					'one of its keyed ranges is not the last child of its host element, and a range appends its rows to that element — so anything authored after it would be painted before every row.',
				);
			}
			const wire = prepareUniversalTemplateProgram(encoderFor(context), split.compiled);
			if (wire === null) {
				refuse(
					subject,
					'this renderer cannot carry one of its static props or event sites in a template program.',
				);
			}
			plan = rendered.plan;
			compiled = split.compiled;
			prepared = wire;
			ranges =
				split.ranges.length === 0
					? EMPTY_RANGES
					: split.ranges.map((range) => ({
							slot: range.slot,
							node: range.node,
							site: null,
							plan: null,
							compiled: null,
							prepared: null,
							template: null,
						}));
			const template: LynxBlockTemplate = compileLynxBlockTemplate(wire.wire);
			const values = valuesFor(context, rendered.values);
			const rows = renderRanges(context, rendered.values);
			// Nothing above this line has written to the core, and nothing below it
			// refuses. What can still throw below is a duplicate key, which the core
			// is the authority on and rejects the same way for every caller.
			block = context.core.mount(null, null, template, values);
			if (wire.events.length !== 0) {
				context.root.bindListeners(block, listenersFor(rendered.values));
			}
			for (let index = 0; index < ranges.length; index++) {
				ranges[index]!.site = context.core.openForSlot(block, ranges[index]!.node);
				applyRange(context, rows[index]!);
			}
		},

		update: renderAgain,

		unmount(context) {
			// Release, do not tear down: the core has no way to destroy a
			// root-mounted block, so a range whose rows were destroyed here would
			// leave the page it hangs from still mounted and half-empty. What the
			// program owns beyond the wire is the listener table, and every member
			// of every range holds a run of it.
			for (const range of ranges) {
				if (range.site === null || range.prepared === null || range.prepared.events.length === 0) {
					continue;
				}
				for (let member = range.site.head; member !== null; member = member.next) {
					context.root.releaseListeners(member);
				}
			}
			if (block !== null && prepared !== null && prepared.events.length !== 0) {
				context.root.releaseListeners(block);
			}
			block = null;
			ranges = EMPTY_RANGES;
			// The cells outlive nothing: a setter captured by a handler this
			// program bound can still be called after release, and a disposed
			// scope answers it by doing nothing rather than scheduling a render
			// against a block that is gone.
			scope?.dispose();
			scope = null;
			liveContext = null;
			liveProps = undefined;
		},
	};
	return program;
}

/**
 * The props a row's component invocation forwards.
 *
 * `universalComponent` normalizes whatever it was handed into a props value, so
 * this is the record inside it; a component called with nothing gets nothing
 * rather than a props wrapper it would read straight through.
 */
function forwardedProps(value: UniversalComponentValue): unknown {
	const props = value.props;
	if (props === null || typeof props !== 'object') return props;
	return (props as UniversalPropsValue).$$kind === UNIVERSAL_PROPS
		? (props as UniversalPropsValue).props
		: props;
}
