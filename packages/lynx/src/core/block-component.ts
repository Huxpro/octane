declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

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
 * row can afford cells is its own question with its own measurement. Page
 * layout effects run after host acknowledgement and passive effects run on the
 * root's following microtask, before its next render. Insertion effects are
 * refused because this core has no pre-mutation phase, and context reads are
 * refused because a single scope has no owner chain.
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
import {
	createUniversalHookScope,
	UNIVERSAL_HOOK_SCOPE_CONTEXT_REFUSED,
	UNIVERSAL_HOOK_SCOPE_EFFECTS_REFUSED,
	type UniversalHookScope,
	useEffect,
	useLayoutEffect,
} from 'octane/universal/native';
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
import { LYNX_TRANSPORT_RENDERER } from './transport-identity.js';
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

// Guard the call-site arguments as well as the final message. A production
// refusal is the compact OL013 contract, so its diagnostic strings must never
// enter the background-thread bundle merely to be discarded by `refuse`.
const LYNX_BLOCK_COMPONENT_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;

/** What `universal-core.ts` throws when a hook runs with no render attempt. */
const HOOKS_WITHOUT_ATTEMPT =
	'Universal hooks may only run while a universal component is rendering.';

/** Why the one phase the page scope cannot publish is refused, said once. */
const INSERTION_EFFECTS_UNSUPPORTED =
	'its setup declares an insertion effect, whose pre-mutation phase the Block core does not have (issue #290).';

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

function refuse(component: LynxComponent<never>, reason: string | false): never {
	throw new Error(
		LYNX_BLOCK_COMPONENT_DEVELOPMENT
			? `Octane Lynx cannot lower component ${componentName(component)} onto the Block core: ${reason} ${REMEDY}`
			: 'Octane Lynx OL013',
	);
}

/**
 * `universal-core.ts`'s own props comparator, reproduced for the same reason
 * the value tags above are: importing it would name the module this core exists
 * to leave out of the bundle.
 *
 * Reproduced, so it can drift, which is why the parity is a test rather than a
 * comment: `paints what the universal core paints while the row objects never
 * change` runs one ladder through both cores and compares the painted tree at
 * every rung, so a comparator that answered differently here is red rather than
 * merely different.
 */
function blockShallowEqual(previous: unknown, next: unknown): boolean {
	if (Object.is(previous, next)) return true;
	if (
		previous === null ||
		next === null ||
		typeof previous !== 'object' ||
		typeof next !== 'object'
	) {
		return false;
	}
	const previousKeys = Object.keys(previous);
	const nextKeys = Object.keys(next);
	if (previousKeys.length !== nextKeys.length) return false;
	for (const key of previousKeys) {
		if (
			!Object.prototype.hasOwnProperty.call(next, key) ||
			!Object.is((previous as Record<string, unknown>)[key], (next as Record<string, unknown>)[key])
		) {
			return false;
		}
	}
	return true;
}

/** Object.is tuple comparison, matching hook dependency semantics. */
function depsEqual(previous: readonly unknown[], next: readonly unknown[]): boolean {
	if (previous.length !== next.length) return false;
	for (let index = 0; index < previous.length; index++) {
		if (!Object.is(previous[index], next[index])) return false;
	}
	return true;
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
	/**
	 * What the last applied render produced, per key, for the rows it can be
	 * asked about again.
	 *
	 * Only a row authored as `<Row … />` is in here. Such a row is a component
	 * call with a props object, so "would this row render the same thing" is
	 * answerable without calling it — the question the universal core answers
	 * for the same shape with the same comparator when it retains a component
	 * record. An inline `@for` body has no props object between the range and
	 * the row's values, so nothing can stand in for calling it, and those rows
	 * are simply never retained.
	 *
	 * Rebuilt whole on every applied render rather than mutated, so it holds
	 * exactly the live keys and a range that shrinks cannot leak the rows it
	 * dropped.
	 */
	retained: Map<unknown, RetainedRow | null> | null;
	/**
	 * The key sequence the last applied render left in the range.
	 *
	 * A render whose keys are the same list in the same order moved no block, so
	 * there is nothing for the keyed reconciler to decide: every row is a
	 * survivor of itself. Recording the sequence is what lets the next render
	 * find that out for the price of the key comparisons it already makes.
	 */
	keys: readonly unknown[] | null;
	/** Iterable identity and compiler proof adopted by the last applied render. */
	source: Iterable<unknown> | null;
	keyedSelection: NonNullable<UniversalForValue['keyedSelection']> | null;
}

/** One row's last render: what produced it, and what it produced. */
interface RetainedRow {
	readonly component: LynxComponent<never>;
	readonly props: unknown;
	readonly values: readonly UniversalHostTemplateProgramValue[];
	readonly listeners: readonly (LynxBlockListener | null)[];
	/** Last committed list order, used to preserve old/new row evaluation order. */
	index: number;
}

const EMPTY_RANGES: readonly RangeState[] = Object.freeze([]);
const EMPTY_RESTORES: readonly (() => void)[] = Object.freeze([]);

/** One range's whole next state, produced before any of it is written. */
interface RangeRender {
	readonly state: RangeState;
	readonly items: readonly unknown[];
	readonly rows: readonly (readonly UniversalHostTemplateProgramValue[])[];
	readonly handlers: readonly (readonly (LynxBlockListener | null)[])[];
	/** This render's keys, in order, so the write path needs no second pass. */
	readonly keys: readonly unknown[];
	/** What the next render compares against, adopted only once this one applies. */
	readonly retained: Map<unknown, RetainedRow | null>;
	/**
	 * Keys to remove from a reused retained map after acknowledgement. Non-null
	 * only for the compiler-proven deletion-only shortcut.
	 */
	readonly removedRetainedKeys: readonly unknown[] | null;
	/** Whether any block has to be mounted, removed, or moved. */
	readonly structural: boolean;
	/** Indices of the rows this render actually called; the rest were retained. */
	readonly rendered: readonly number[];
	readonly source: Iterable<unknown>;
	readonly keyedSelection: NonNullable<UniversalForValue['keyedSelection']> | null;
	/** Non-null when a compiler proof reached only the old/new selected keys. */
	readonly sparse: readonly SparseRangeRow[] | null;
}

interface SparseRangeRow {
	readonly key: unknown;
	readonly retained: RetainedRow;
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
	 * The page's scope stands up cells and the background core gives layout work
	 * an accepted-host boundary and passive work an explicit microtask phase. It
	 * still has neither insertion effects nor an owner chain. Passing `undefined`
	 * would refuse those capabilities
	 * too, with a TypeError naming a property rather than the layer.
	 */
	const renderContext: UniversalRenderContext = Object.freeze({
		renderer: LYNX_TRANSPORT_RENDERER,
		readContext(): never {
			refuse(
				rendering,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'its setup reads a context, which needs the owner chain the Block core does not have yet (issue #135 item 1b).',
			);
		},
		insertionEffect(): never {
			refuse(rendering, LYNX_BLOCK_COMPONENT_DEVELOPMENT && INSERTION_EFFECTS_UNSUPPORTED);
		},
		layoutEffect(create: () => void | (() => void), deps?: readonly unknown[]): void {
			useLayoutEffect(create, deps);
		},
		effect(create: () => void | (() => void), deps?: readonly unknown[]): void {
			useEffect(create, deps);
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
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
	 * This only drafts. `mount` and `renderAgain` publish the cells after every
	 * plan check, slot write, and range reconcile succeeds, then the background
	 * core runs any layout work after the resulting host commit is acknowledged.
	 * A refusal therefore cannot publish a subscription for a tree the host
	 * never accepted.
	 */
	const renderSubject = (context: LynxBlockProgramContext, props: unknown): RenderedPlan => {
		const previousContext = liveContext;
		const previousProps = liveProps;
		liveContext = context;
		liveProps = props;
		const cells = (scope ??= createUniversalHookScope({
			renderer: LYNX_TRANSPORT_RENDERER,
			scheduleRender: queueStateRender,
			scheduleLayoutEffectCommit(task): void {
				liveContext!.afterCommit(task);
			},
			schedulePassiveEffectCommit(task): void {
				liveContext!.afterPassiveCommit(task);
			},
		}));
		let rendered: RenderedPlan;
		try {
			rendered = cells.render(() => renderPlanValue(subject, props));
		} catch (error) {
			cells.abort();
			liveContext = previousContext;
			liveProps = previousProps;
			// The scope refuses capabilities it does not implement with stable
			// messages; renamed here to the layer the application can see, the
			// same way a row's HOOKS_WITHOUT_ATTEMPT is renamed in
			// renderPlanValue.
			if (error instanceof Error && error.message === UNIVERSAL_HOOK_SCOPE_EFFECTS_REFUSED) {
				refuse(subject, LYNX_BLOCK_COMPONENT_DEVELOPMENT && INSERTION_EFFECTS_UNSUPPORTED);
			}
			if (error instanceof Error && error.message === UNIVERSAL_HOOK_SCOPE_CONTEXT_REFUSED) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'its setup reads a context, which needs the owner chain the Block core does not have yet (issue #135 item 1b).',
				);
			}
			throw error;
		}
		context.afterAbort(() => {
			cells.abort();
			liveContext = previousContext;
			liveProps = previousProps;
		});
		return rendered;
	};

	const snapshotRangeTemplates = (): readonly (() => void)[] => {
		let restores: (() => void)[] | null = null;
		for (const state of ranges) {
			if (state.plan !== null) continue;
			const snapshot = {
				plan: state.plan,
				compiled: state.compiled,
				prepared: state.prepared,
				template: state.template,
			};
			(restores ??= []).push(() => Object.assign(state, snapshot));
		}
		return restores ?? EMPTY_RESTORES;
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
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
		produced: unknown,
		// The component and props `renderRange` already derived from `produced`
		// for the memo comparison — threaded through rather than re-derived, so
		// the row is called with exactly what was compared.
		component: LynxComponent<never> | null,
		props: unknown,
	): {
		readonly values: readonly UniversalHostTemplateProgramValue[];
		readonly listeners: readonly (LynxBlockListener | null)[];
	} => {
		// A row authored as `<Row … />` is a component invocation rather than a
		// template: the plan is inside the component, so it is called for. Its
		// own hooks are the layer item 1b leaves open, and a row that needs one
		// refuses by its own name — which is also what makes the memo in
		// `renderRange` sound rather than merely likely. A row with no hook
		// cells, no context, and no effects is a function of the props it is
		// handed, so props that compare equal produce what they produced.
		let rendered: RenderedPlan;
		if (component !== null) {
			rendered = renderPlanValue(component, props);
		} else {
			// The page did return a compiled template — the row's output is what
			// did not — so the diagnostic must say which level failed.
			const value = produced as UniversalPlanValue | null;
			if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						`a row of one of its keyed ranges is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a range mounts one host subtree per row.`,
				);
			}
			const program = compiledUniversalTemplateProgram(encoderFor(context), root);
			if (program === null) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'a row of one of its keyed ranges is not entirely compile-time host structure, so there is no static template to mount per row.',
				);
			}
			const wire = prepareUniversalTemplateProgram(encoderFor(context), program);
			if (wire === null) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'this renderer cannot carry a static prop or event site of one of its keyed range rows in a template program.',
				);
			}
			state.plan = rendered.plan;
			state.compiled = program;
			state.prepared = wire;
			state.template = compileLynxBlockTemplate(wire.wire, rendered.plan.address);
		} else if (rendered.plan !== state.plan) {
			refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'one of its keyed ranges declares an @empty block, and a range site on the Block core has no empty branch yet.',
			);
		}
		const nextSelection = list.keyedSelection ?? null;
		const previousSelection = state.keyedSelection;
		const previous = state.retained;
		const previousKeys = state.keys;
		if (
			nextSelection !== null &&
			previousSelection !== null &&
			state.source === list.items &&
			previous !== null &&
			previousKeys !== null &&
			depsEqual(previousSelection[1], nextSelection[1])
		) {
			const sparse: SparseRangeRow[] = [];
			if (!Object.is(previousSelection[0], nextSelection[0])) {
				const candidates: { key: unknown; prior: RetainedRow }[] = [];
				for (const itemKey of [previousSelection[0], nextSelection[0]]) {
					const prior = previous.get(itemKey);
					if (prior == null || candidates.some((candidate) => candidate.prior === prior)) continue;
					candidates.push({ key: itemKey, prior });
				}
				candidates.sort((left, right) => left.prior.index - right.prior.index);
				for (const { key: itemKey, prior } of candidates) {
					const item = (prior.props as Record<string, unknown>)[nextSelection[2]];
					const produced = list.render(item, prior.index);
					const component =
						produced !== null &&
						typeof produced === 'object' &&
						(produced as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
							? ((produced as UniversalComponentValue).component as unknown as LynxComponent<never>)
							: null;
					const props =
						component === null ? null : forwardedProps(produced as UniversalComponentValue);
					if (component === null || component !== prior.component) {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								'a compiler-certified keyed selection later produced a different row component.',
						);
					}
					if (blockShallowEqual(prior.props, props)) continue;
					const row = renderRow(context, state, produced, component, props);
					sparse.push({
						key: itemKey,
						retained: {
							component,
							props,
							values: row.values,
							listeners: row.listeners,
							index: prior.index,
						},
					});
				}
			}
			return {
				state,
				items: [],
				rows: [],
				handlers: [],
				keys: previousKeys,
				retained: previous,
				removedRetainedKeys: null,
				structural: false,
				rendered: [],
				source: list.items,
				keyedSelection: nextSelection,
				sparse,
			};
		}

		const items = Array.from(list.items as Iterable<unknown>);
		// A production keyed-selection proof says the row receives its item
		// directly, every other capture is named in `deps`, and the final bit says
		// it cannot observe its index. If those captures and the selection itself
		// are unchanged, a strict subsequence of the committed item identities is
		// therefore a non-empty deletion-only render: every survivor keeps the same key,
		// props, values, and listeners. Match against committed descriptors rather
		// than calling either producer over the entire surviving range again. An
		// empty range deliberately takes the ordinary path below: its fresh empty
		// Map can replace the committed descriptors after acknowledgement instead
		// of allocating every old key and deleting them one by one.
		if (
			nextSelection !== null &&
			previousSelection !== null &&
			previous !== null &&
			previousKeys !== null &&
			previousSelection[3] === true &&
			nextSelection[3] === true &&
			previousSelection[2] === nextSelection[2] &&
			items.length !== 0 &&
			items.length < previousKeys.length &&
			Object.is(previousSelection[0], nextSelection[0]) &&
			depsEqual(previousSelection[1], nextSelection[1])
		) {
			const rows: (readonly UniversalHostTemplateProgramValue[])[] = new Array(items.length);
			const handlers: (readonly (LynxBlockListener | null)[])[] = new Array(items.length);
			const keys: unknown[] = new Array(items.length);
			const removedRetainedKeys: unknown[] = [];
			let previousIndex = 0;
			let reusable = true;
			for (let index = 0; index < items.length; index++) {
				let retainedRow: RetainedRow | null | undefined;
				let itemKey: unknown;
				while (previousIndex < previousKeys.length) {
					itemKey = previousKeys[previousIndex++]!;
					retainedRow = previous.get(itemKey);
					if (
						retainedRow != null &&
						Object.is(
							(retainedRow.props as Record<string, unknown>)[nextSelection[2]],
							items[index],
						)
					) {
						break;
					}
					removedRetainedKeys.push(itemKey);
					retainedRow = undefined;
				}
				if (retainedRow == null) {
					reusable = false;
					break;
				}
				keys[index] = itemKey!;
				rows[index] = retainedRow.values;
				handlers[index] = retainedRow.listeners;
			}
			if (reusable) {
				while (previousIndex < previousKeys.length) {
					removedRetainedKeys.push(previousKeys[previousIndex++]!);
				}
				return {
					state,
					items,
					rows,
					handlers,
					keys,
					retained: previous,
					removedRetainedKeys,
					structural: true,
					rendered: [],
					source: list.items,
					keyedSelection: nextSelection,
					sparse: null,
				};
			}
		}
		const rows: (readonly UniversalHostTemplateProgramValue[])[] = new Array(items.length);
		const handlers: (readonly (LynxBlockListener | null)[])[] = new Array(items.length);
		const keys: unknown[] = new Array(items.length);
		const selectionRowsStable =
			nextSelection !== null &&
			previousSelection !== null &&
			previous !== null &&
			depsEqual(previousSelection[1], nextSelection[1]);
		// Every key, so the duplicate check below covers the whole range; a value
		// only where one can be reused, so an inline row body costs no allocation
		// for a memo it can never take.
		const retained = new Map<unknown, RetainedRow | null>();
		const rendered: number[] = [];
		// A first render, or one whose key list is a different length, has moved
		// something by definition; below, a key that differs at its own position
		// settles it for the rest.
		let structural = previousKeys === null || previousKeys.length !== items.length;
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			const itemKey = list.key(item, index);
			// The core rejects a duplicate key too, but its rejection lands after
			// the page block was mounted — mid-write — so a retried render would
			// mount a second copy of the page. Rejecting here keeps the
			// produce-the-whole-render-then-apply rule: a render that cannot be
			// applied writes nothing. `retained` is the set that answers it, so the
			// check costs the map this render was already building rather than a
			// second pass and a second structure.
			if (retained.has(itemKey)) {
				throw new Error(
					typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
						? `Octane Lynx block core: duplicate key ${String(itemKey)} in a keyed range.`
						: 'Octane Lynx OL014',
				);
			}
			keys[index] = itemKey;
			if (!structural && !Object.is(previousKeys![index], itemKey)) structural = true;
			const prior = previous?.get(itemKey);
			if (
				selectionRowsStable &&
				prior != null &&
				(nextSelection![3] === true || prior.index === index) &&
				Object.is((prior.props as Record<string, unknown>)[nextSelection![2]], item) &&
				Object.is(itemKey, previousSelection![0]) === Object.is(itemKey, nextSelection![0])
			) {
				// The compiler proved every capture except the selected key is a
				// stable direct prop. Same item and either the same index or the
				// compiler's proof that no prop reads it preserve the row-local props
				// too, and the equality above proves its selected boolean did not move.
				// Reuse the descriptor instead of rebuilding it merely to have the
				// shallow comparison reach the same conclusion.
				rows[index] = prior.values;
				handlers[index] = prior.listeners;
				retained.set(itemKey, prior);
				continue;
			}
			// The `@for` body, which builds the row's props but does not call it.
			// Lifted out of `renderRow` for exactly that reason: a row is skippable
			// only if what it would be called with can be compared first.
			const produced = list.render(item, index);
			const component =
				produced !== null &&
				typeof produced === 'object' &&
				(produced as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
					? ((produced as UniversalComponentValue).component as unknown as LynxComponent<never>)
					: null;
			const props = component === null ? null : forwardedProps(produced as UniversalComponentValue);
			if (component !== null) {
				if (
					prior != null &&
					prior.component === component &&
					blockShallowEqual(prior.props, props)
				) {
					// Same component, same props: the body is a function of its props,
					// so it would produce what it produced last time. Its listeners are
					// reused with its values — they close over props this comparison
					// just found equal, so last render's closures reach the same
					// functions and the same item as fresh ones would.
					rows[index] = prior.values;
					handlers[index] = prior.listeners;
					retained.set(itemKey, prior);
					continue;
				}
			}
			const row = renderRow(context, state, produced, component, props);
			rows[index] = row.values;
			handlers[index] = row.listeners;
			rendered.push(index);
			retained.set(
				itemKey,
				component === null
					? null
					: {
							component,
							props,
							values: row.values,
							listeners: row.listeners,
							index,
						},
			);
		}
		return {
			state,
			items,
			rows,
			handlers,
			keys,
			retained,
			removedRetainedKeys: null,
			structural,
			rendered,
			source: list.items,
			keyedSelection: nextSelection,
			sparse: null,
		};
	};

	/**
	 * Bring one range site level with the render above.
	 *
	 * Two paths, chosen by whether this render moved anything. A render whose
	 * key sequence is the one already mounted mounts, removes, and moves
	 * nothing, so there is no reconcile to run: what is left is the rows that
	 * were actually called, each reached by its key. A render that did move
	 * something hands the whole list to the keyed reconciler, which is the only
	 * thing that can decide the survivors. Both leave the range holding what
	 * the render produced and differ only in how much they visit to do it,
	 * which is why deleting the first changes no test — only counts.
	 *
	 * On both paths, only rows this render actually called need their handlers
	 * rebound. A retained row kept the complete descriptor — values and
	 * listeners — after its props compared equal, and a move keeps the block's
	 * listener-id run with its hosts. Rebinding every survivor after a structural
	 * update would therefore replace a closure with the identical retained
	 * closure while walking the whole range. Once the reconciler has installed
	 * the final key map, the changed and newly mounted rows are reached directly
	 * through the same ascending `rendered` proof used for their values.
	 *
	 * On either path, a row that has an empty hole this render is released
	 * before it is rebound, for the reason `update` releases the block's own:
	 * binding skips an empty conditional hole rather than clearing it, so a row
	 * that withdrew a handler would otherwise keep reaching the closure of the
	 * render that last supplied one. Only such a row, because a row whose every
	 * site holds a function has every one of those sites overwritten by the
	 * bind — releasing it first would be two map writes per site to reach the
	 * state it is already in, on every row of every list on every render.
	 */
	const applyRange = (context: LynxBlockProgramContext, render: RangeRender): void => {
		const state = render.state;
		if (render.sparse !== null) {
			for (const row of render.sparse) {
				const member = context.core.writeKeyedValues(state.site!, row.key, row.retained.values);
				if (state.prepared!.events.length === 0 || member === undefined) continue;
				if (row.retained.listeners.includes(null)) context.root.releaseListeners(member);
				context.root.bindListeners(member, row.retained.listeners);
			}
			context.afterCommit(() => {
				state.source = render.source;
				state.keyedSelection = render.keyedSelection;
				for (const row of render.sparse!) state.retained!.set(row.key, row.retained);
			});
			return;
		}
		// A list that has never had a row has no template to reconcile against,
		// and nothing mounted to reconcile.
		if (state.template === null) return;
		context.afterCommit(() => {
			if (render.removedRetainedKeys !== null) {
				for (const key of render.removedRetainedKeys) render.retained.delete(key);
			}
			// Reused descriptors still describe the same row, but a structural
			// update may have changed that row's committed order. Stage that order
			// on the completed render and publish it only after the core commit: an
			// eager write here would corrupt the last accepted selection indices if
			// a later row refused or the transport rejected the frame. Map insertion
			// order is this render's item order, so this replaces one object copy per
			// shifted survivor with one allocation-free post-commit walk.
			if (render.structural) {
				let index = 0;
				for (const row of render.retained.values()) {
					if (row !== null) row.index = index;
					index++;
				}
			}
			state.source = render.source;
			state.keyedSelection = render.keyedSelection;
			state.retained = render.retained;
			state.keys = render.keys;
		});
		if (!render.structural) {
			// The same keys in the same order: every row is a survivor of itself,
			// so there is no mount, no removal, and no move for the reconciler to
			// decide. What is left is the rows this render actually called — the
			// rest produced what they already hold — and each of those is one keyed
			// visit rather than a walk of the list.
			//
			// This is the scoped write the hand-written ceiling program makes by
			// hand, reached from a component instead: `benchmarks/lynx-table/app/
			// src/block-program.ts`'s `select` writes the two rows whose class
			// moved, and so does this, without the page having told it which two.
			const events = state.prepared!.events.length !== 0;
			for (const index of render.rendered) {
				const member = context.core.writeKeyedValues(
					state.site!,
					render.keys[index],
					render.rows[index]!,
				);
				if (!events || member === undefined) continue;
				const handlers = render.handlers[index]!;
				if (handlers.includes(null)) context.root.releaseListeners(member);
				context.root.bindListeners(member, handlers);
			}
			return;
		}
		context.core.reconcileForSlot(
			state.site!,
			state.template,
			render.items,
			// The keys `renderRange` already derived and duplicate-checked, not
			// the user's key function again: the reconciler must mount under
			// exactly the keys `state.keys` records, or an impure key function
			// could let a later render's same-sequence check pass against keys
			// the range is not actually holding.
			(_item, index) => render.keys[index]!,
			(_item, index) => render.rows[index]!,
			(member) => {
				context.root.releaseListeners(member);
			},
			// `rendered` is appended during the forward item scan, so it is already
			// the ascending proof the core needs. Survivors absent from it reused
			// their complete descriptor; comparing every live slot again would only
			// rediscover the identity the component layer already established.
			render.rendered,
		);
		if (state.prepared!.events.length === 0) return;
		for (const index of render.rendered) {
			const member = state.site!.items.get(render.keys[index])!;
			const handlers = render.handlers[index]!;
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
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
		const restoreRanges = snapshotRangeTemplates();
		context.afterAbort(() => {
			for (const restore of restoreRanges) restore();
		});
		const rendered = renderSubject(context, props);
		try {
			// A block program mounts one template. A component that returns a
			// different plan on a later render is a different program, and
			// `block-background.ts` already refuses to swap the program it mounted;
			// this is that refusal one level down, where the plan is what changed
			// rather than the component.
			if (rendered.plan !== plan) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
			context.afterCommit(() => scope!.commit());
		} catch (error) {
			scope?.abort();
			throw error;
		}
	};

	const program: LynxBlockProgram<Props> = {
		mount(context, props) {
			const previous = { plan, compiled, prepared, block, ranges };
			context.afterAbort(() => {
				plan = previous.plan;
				compiled = previous.compiled;
				prepared = previous.prepared;
				block = previous.block;
				ranges = previous.ranges;
			});
			const rendered = renderSubject(context, props);
			try {
				const root = rendered.plan.root;
				if (root.kind !== 'host') {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							`its template is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a block mounts one host subtree.`,
					);
				}
				const program = compiledUniversalTemplateProgram(encoderFor(context), root);
				if (program === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'its template is not entirely compile-time host structure, so there is no static template to mount.',
					);
				}
				const split = universalTemplateProgramWithoutRanges(program, (slot) =>
					isRangeValue(rendered.values[slot]),
				);
				if (split === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'one of its keyed ranges is not the last child of its host element, and a range appends its rows to that element — so anything authored after it would be painted before every row.',
					);
				}
				const wire = prepareUniversalTemplateProgram(encoderFor(context), split.compiled);
				if (wire === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
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
								retained: null,
								keys: null,
								source: null,
								keyedSelection: null,
							}));
				const template: LynxBlockTemplate = compileLynxBlockTemplate(
					wire.wire,
					rendered.plan.address,
				);
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
					const range = ranges[index]!;
					range.site = context.core.openForSlot(block, range.node, range.slot);
					applyRange(context, rows[index]!);
				}
				context.afterCommit(() => scope!.commit());
			} catch (error) {
				scope?.abort();
				throw error;
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
			context.afterCommit(() => {
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
			});
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
