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
 * A stateful page, keyed row, or dynamic branch runs inside its own
 * `createUniversalHookScope`. A setter publishes its cells only after the host
 * accepts the frame. Child scopes live in the retained key map, so moves
 * preserve them and deletion disposes them. Compiler metadata proves which
 * components have no hooks, and those components render directly without
 * allocating a semantic scope.
 *
 * ## A structural region is a hole the template must not describe (item 1c)
 *
 * A renderable hole is one plan node whatever it holds, so `@for`, `@if`, and
 * `@switch` arrive as the same `#text` child as `{row.label}`; only the value
 * tells them apart. Their output is real children of the hole's *parent*,
 * maintained through the keyed range primitive. Structural holes are split out
 * of the program before it is prepared
 * (`universalTemplateProgramWithoutRanges`), each becomes a region site on the
 * host node that held it, and every output lowers through the same plan → wire
 * path as the component itself.
 *
 * Rows and branches are rendered before anything is written. Output the
 * lowering cannot describe therefore refuses with the region as it was, not a
 * half-reconciled list on the wire.
 *
 * ## What this deliberately does not cover, and why the refusals are loud
 *
 * Page and child layout effects run after host acknowledgement; passive effects
 * run on the root's following microtask, before its next render. Insertion
 * effects are refused because this core has no pre-mutation phase. Context
 * values follow providers into retained keyed and branch scopes.
 *
 * Nested and sibling ranges retain compiler-slot ownership recursively. Native
 * lists still refuse ranged rows until physical cell recycling can carry that
 * ownership without confusing logical rows with reused native controls.
 *
 * Every refusal names the component, because a bundle that silently rendered
 * nothing would be far worse than one that says which piece it lacks.
 */

import type {
	UniversalActivityValue,
	UniversalComponentValue,
	UniversalChildrenValue,
	UniversalContext,
	UniversalContextValue,
	UniversalIfValue,
	UniversalForValue,
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostPropCodecContext,
	UniversalHostTemplateProgramValue,
	UniversalPortalCapability,
	UniversalPortalTargetHandle,
	UniversalPortalTargetRegistration,
	UniversalPortalValue,
	UniversalPlan,
	UniversalSwitchValue,
	UniversalTryValue,
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
	defineUniversalComponent,
	UNIVERSAL_HOOK_SCOPE_EFFECTS_REFUSED,
	universalComponent,
	universalSuspensionThenable,
	type UniversalHookScope,
	type UniversalHookScopePrepared,
	useEffect,
	useLayoutEffect,
} from 'octane/universal/native';
import {
	compileUniversalHostProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	prepareUniversalTemplateProgramValuesFromWire,
	universalTemplateProgramWithoutRanges,
	prepareUniversalTemplateProgramValueFromWire,
	UNIVERSAL_TEMPLATE_PROGRAM_VALUE_REFUSED,
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
import {
	isLynxCompilerProgram,
	isLynxCompilerProgramValue,
	type LynxCompilerProgram,
	type LynxCompilerProgramComputation,
	type LynxCompilerProgramScalarComputation,
} from './compiler-program.js';
import type { LynxBlockProgram, LynxBlockProgramContext } from './block-program.js';
import { encodeLynxProgramPropValue } from './host-prop-value.js';
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
const UNIVERSAL_COMPONENT: symbol = Symbol.for('octane.universal.component');
const UNIVERSAL_CHILDREN: symbol = Symbol.for('octane.universal.children');
const UNIVERSAL_CONTEXT: symbol = Symbol.for('octane.universal.context');
const UNIVERSAL_ACTIVITY: symbol = Symbol.for('octane.universal.activity');
const UNIVERSAL_TRY: symbol = Symbol.for('octane.universal.try');
const UNIVERSAL_PORTAL: symbol = Symbol.for('octane.universal.portal');

// Guard the call-site arguments as well as the final message. A production
const UNIVERSAL_IF: symbol = Symbol.for('octane.universal.if');
const UNIVERSAL_SWITCH: symbol = Symbol.for('octane.universal.switch');
// refusal is the compact OL013 contract, so its diagnostic strings must never
// enter the background-thread bundle merely to be discarded by `refuse`.
const IF_THEN_BRANCH = Object.freeze({});
const IF_ELSE_BRANCH = Object.freeze({});
const SWITCH_DEFAULT_BRANCH = Object.freeze({});
const ACTIVITY_BRANCH = Object.freeze({});
const TRY_BODY_BRANCH = Object.freeze({});
const TRY_PENDING_BRANCH = Object.freeze({});
const TRY_CATCH_BRANCH = Object.freeze({});
const TRY_RETRY_SLOT = Object.freeze({});

/**
 * Give each boundary arm the same independent semantic owner the Universal
 * reconciler claims for `try`/`pending`/`catch` materialization. The compiler
 * leaves authored arm callbacks lazy, so invoking one directly after the page
 * setup has returned would put `use()` outside a component attempt. Lowering
 * it through this stable component lets the existing keyed-row scope own those
 * hooks, effects, retries, and aborts without introducing an interpreter.
 */
const TRY_ARM_COMPONENT = defineUniversalComponent(
	LYNX_TRANSPORT_RENDERER,
	({ render }: { readonly render: () => unknown }) => render() as never,
);
const LYNX_BLOCK_COMPONENT_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;

/** What `universal-core.ts` throws when a hook runs with no render attempt. */
const HOOKS_WITHOUT_ATTEMPT =
	'Universal hooks may only run while a universal component is rendering.';

/** Why the one phase the page scope cannot publish is refused, said once. */
const INSERTION_EFFECTS_UNSUPPORTED =
	'its setup declares an insertion effect, whose pre-mutation phase the Block core does not have (issue #290).';
/** Compiler proof that a component needs semantic hook ownership. */
function componentMayNeedHookScope(component: LynxComponent<never>): boolean {
	const metadata = (component as unknown as Record<PropertyKey, unknown>)[UNIVERSAL_COMPONENT] as
		{ hookScope?: unknown } | undefined;
	// Old compiler output and hand-authored components retain the safe path.
	return metadata?.hookScope !== false;
}

/**
 * A transparent component can own no hooks itself while its children or render
 * prop resolves to a hooked descendant. The compiler represents authored JSX
 * children with an own `children` prop, so keep one semantic scope around that
 * chain without charging ordinary leaf rows for it.
 */
function componentPropsMayNeedHookScope(props: unknown): boolean {
	return (
		props !== null &&
		typeof props === 'object' &&
		Object.prototype.hasOwnProperty.call(props, 'children')
	);
}
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
	const props = driver.props;
	return {
		...driver,
		// Object.create rather than a spread: the negotiated members are live
		// getters, and snapshotting them here would answer a later question with
		// a mount-time value.
		capabilities: Object.create(driver.capabilities ?? null, {
			templateProgramMount: { value: true, enumerable: true },
		}) as UniversalHostCapabilities,
		// The ordinary command path may carry serializable renderer values such as
		// a clsx-style class array and normalize them on the main thread. A block
		// program has the narrower resident-program ABI instead: every ordinary
		// binding is a scalar before it reaches `mount-template-run`. Reuse the
		// renderer codec first (so resources and worklets keep their authority),
		// then apply the same canonical scalar mapping as the compact client and
		// compiled main renderer. Without this layer a perfectly ordinary dynamic
		// class made a keyed component row look like an unsupported nested range.
		props:
			props === undefined
				? undefined
				: Object.freeze({
						encode(context: UniversalHostPropCodecContext<LynxClientContainer>) {
							const result = props.encode(context);
							return result.kind === 'value'
								? {
										kind: 'value' as const,
										value: encodeLynxProgramPropValue(
											context.hostType,
											context.name,
											result.value,
										) as never,
									}
								: result;
						},
					}),
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
type SemanticContexts = ReadonlyMap<UniversalContext<any>, unknown> | null;

function sameSemanticContexts(previous: SemanticContexts, next: SemanticContexts): boolean {
	if (previous === next) return true;
	if (previous === null || next === null || previous.size !== next.size) return false;
	for (const [context, value] of previous) {
		if (!next.has(context) || !Object.is(next.get(context), value)) return false;
	}
	return true;
}

function readSemanticContext<T>(contexts: SemanticContexts, context: UniversalContext<T>): T {
	return contexts?.has(context) ? (contexts.get(context) as T) : context.defaultValue;
}

/** Whether a hole's value is a keyed range rather than something a slot carries. */
function isRangeValue(value: unknown): value is UniversalForValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_FOR
	);
}
function isBranchValue(value: unknown): value is UniversalBranchValue {
	if (value === null || typeof value !== 'object') return false;
	const kind = (value as { $$kind?: unknown }).$$kind;
	return kind === UNIVERSAL_IF || kind === UNIVERSAL_SWITCH;
}

function isComponentRegionValue(value: unknown): value is UniversalComponentValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
	);
}

function isActivityValue(value: unknown): value is UniversalActivityValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_ACTIVITY
	);
}

function isTryValue(value: unknown): value is UniversalTryValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_TRY
	);
}

function isPortalValue(value: unknown): value is UniversalPortalValue {
	return (
		value !== null &&
		typeof value === 'object' &&
		(value as { $$kind?: unknown }).$$kind === UNIVERSAL_PORTAL
	);
}

function isDynamicRegionValue(
	value: unknown,
): value is
	| UniversalForValue
	| UniversalBranchValue
	| UniversalComponentValue
	| UniversalActivityValue
	| UniversalTryValue
	| UniversalPortalValue {
	return (
		isRangeValue(value) ||
		isBranchValue(value) ||
		isComponentRegionValue(value) ||
		isActivityValue(value) ||
		isTryValue(value) ||
		isPortalValue(value)
	);
}

function selectedBranch(
	value: UniversalBranchValue,
): readonly [identity: unknown, render: () => unknown] | null {
	if ((value as UniversalIfValue).$$kind === UNIVERSAL_IF) {
		const branch = value as UniversalIfValue;
		const render = branch.condition ? branch.then : branch.else;
		return render === null ? null : [branch.condition ? IF_THEN_BRANCH : IF_ELSE_BRANCH, render];
	}
	const branch = value as UniversalSwitchValue;
	for (let index = 0; index < branch.cases.length; index++) {
		const candidate = branch.cases[index]!;
		if (candidate[0] === branch.value) return [index, candidate[1]];
	}
	return branch.default === null ? null : [SWITCH_DEFAULT_BRANCH, branch.default];
}

/** One rendered template: the plan it named, and the slot values for it. */
interface RenderedPlan {
	readonly contextValues: SemanticContexts;
	readonly visible: boolean;
	/** The component that returned it, which is who a refusal has to name. */
	readonly source: LynxComponent<never>;
	readonly plan: UniversalPlan | LynxCompilerProgram;
	readonly values: readonly unknown[];
	readonly computations: readonly LynxCompilerProgramComputation[];
}

interface RangeTemplateState {
	plan: UniversalPlan | LynxCompilerProgram | null;
	compiled: CompiledUniversalTemplateProgram | null;
	prepared: PreparedUniversalTemplateProgram | null;
	template: LynxBlockTemplate | null;
	ranges: readonly RangeDefinition[] | null;
}

interface RangeDefinition {
	readonly slot: number;
	readonly node: number;
	readonly before?: number | null;
}

interface RangeBranchState {
	readonly key: object;
	readonly template: RangeTemplateState;
	readonly branchIdentity?: unknown;
	readonly component?: LynxComponent<never>;
	readonly hasKey?: boolean;
	readonly authoredKey?: unknown;
}

interface RangeTryState {
	active: boolean;
	hasError: boolean;
	error: unknown;
	thenable: PromiseLike<unknown> | null;
	suspension: unknown;
	/** Settled/reset work that must pierce a retained parent-row bailout. */
	needsRetry: boolean;
	/** Last accepted primary member, retained and hidden during re-suspension. */
	bodyKey: unknown;
	/** Whether the current thenable retained content for a transition attempt. */
	transitionPending: boolean;
}

interface RangePortalState {
	target: unknown;
	registration: UniversalPortalTargetRegistration | null;
	site: LynxBlockForSlot | null;
}

function createRangeTemplateState(): RangeTemplateState {
	return { plan: null, compiled: null, prepared: null, template: null, ranges: null };
}

type UniversalBranchValue = UniversalIfValue | UniversalSwitchValue;
/**
 * One keyed range hole, and everything derived from the rows that filled it.
 *
 * Row and @empty templates are derived independently on first use. A transition
 * between them replaces the internal keyed member, while consecutive renders
 * of either variant keep one homogeneous template and preserve its semantic
 * owner.
 */
interface RangeState {
	/** The plan slot holding the `universalFor`. */
	readonly slot: number;
	/** The host node in the mounted template whose children the range owns. */
	readonly node: number;
	/** The next static child in the parent, or null at the range tail. */
	readonly before: number | null;
	site: LynxBlockForSlot | null;
	readonly rowTemplate: RangeTemplateState;
	readonly emptyTemplate: RangeTemplateState;
	readonly branchTemplates: Map<unknown, RangeBranchState> | null;
	readonly tryState: RangeTryState | null;
	portalState: RangePortalState | null;
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
	hasScopedRows: boolean;
	/**
	 * The key sequence the last applied render left in the range.
	 *
	 * A render whose keys are the same list in the same order moved no block, so
	 * there is nothing for the keyed reconciler to decide: every row is a
	 * survivor of itself. Recording the sequence is what lets the next render
	 * find that out for the price of the key comparisons it already makes.
	 */
	/** Provider values inherited by every row in the last accepted render. */
	contextValues: SemanticContexts;
	keys: readonly unknown[] | null;
	/** Iterable identity and compiler proof adopted by the last applied render. */
	source: Iterable<unknown> | null;
	keyedSelection: NonNullable<UniversalForValue['keyedSelection']> | null;
	componentRows: NonNullable<UniversalForValue['componentRows']> | null;
	/** Nested range instances retained by this range's outer member key. */
	nested: Map<unknown, NestedRangeState> | null;
	/** Visibility inherited by the last accepted render. */
	visible: boolean;
}

interface NestedRangeState {
	/** The shared row/branch template whose range definitions these instantiate. */
	readonly template: RangeTemplateState;
	/** One independent range owner per structural site in that outer member. */
	readonly ranges: readonly RangeState[];
}

function nestedStateNeedsRetry(state: NestedRangeState): boolean {
	for (const range of state.ranges) {
		if (range.tryState?.needsRetry === true || nestedStatesNeedRetry(range.nested)) return true;
	}
	return false;
}

function nestedStatesNeedRetry(states: ReadonlyMap<unknown, NestedRangeState> | null): boolean {
	if (states === null) return false;
	for (const state of states.values()) {
		if (nestedStateNeedsRetry(state)) return true;
	}
	return false;
}

function createRangeState(definition: RangeDefinition, value: unknown): RangeState {
	return {
		slot: definition.slot,
		node: definition.node,
		before: definition.before ?? null,
		site: null,
		rowTemplate: createRangeTemplateState(),
		emptyTemplate: createRangeTemplateState(),
		branchTemplates:
			isBranchValue(value) ||
			isComponentRegionValue(value) ||
			isActivityValue(value) ||
			isTryValue(value) ||
			isPortalValue(value) ||
			value === null ||
			value === undefined ||
			typeof value === 'boolean'
				? new Map()
				: null,
		tryState: isTryValue(value)
			? {
					active: true,
					hasError: false,
					error: undefined,
					thenable: null,
					suspension: null,
					needsRetry: false,
					bodyKey: null,
					transitionPending: false,
				}
			: null,
		portalState: isPortalValue(value) ? { target: null, registration: null, site: null } : null,
		retained: null,
		hasScopedRows: false,
		keys: null,
		source: null,
		keyedSelection: null,
		componentRows: null,
		contextValues: null,
		nested: null,
		visible: true,
	};
}

/**
 * The scheduler owned by one stateful keyed row.
 *
 * The retained key, not the page, is the semantic owner. `current` is replaced
 * only after the host accepts a render, so an aborted parent or row attempt
 * keeps both the committed props and the committed closures available for an
 * exact retry. A move changes neither this object nor its hook cells.
 */
interface ScopedRowState {
	current: RetainedRow | null;
	state: RangeState | null;
	templateState: RangeTemplateState | null;
	key: unknown;
	queued: boolean;
}

/** One row's last render: what produced it, and what it produced. */
interface RetainedRow {
	readonly component: LynxComponent<never>;
	readonly props: unknown;
	readonly scope: UniversalHookScope | null;
	readonly scoped: ScopedRowState | null;
	readonly values: readonly UniversalHostTemplateProgramValue[];
	readonly listeners: readonly (LynxBlockListener | null)[];
	readonly refs: readonly unknown[];
	readonly visible: boolean;
	/** Last committed list order, used to preserve old/new row evaluation order. */
	index: number;
}

const EMPTY_RANGES: readonly RangeState[] = Object.freeze([]);
const EMPTY_RESTORES: readonly (() => void)[] = Object.freeze([]);
const EMPTY_COMPUTATIONS: readonly LynxCompilerProgramComputation[] = Object.freeze([]);
type ProgramSiteIndexes = readonly (readonly number[] | undefined)[];
const EMPTY_SITE_INDEXES: ProgramSiteIndexes = Object.freeze([]);
const EMPTY_INDEXES: readonly number[] = Object.freeze([]);
const EMPTY_PROGRAM_VALUES: readonly UniversalHostTemplateProgramValue[] = Object.freeze([]);
const EMPTY_PROGRAM_ROWS: readonly (readonly UniversalHostTemplateProgramValue[])[] = Object.freeze(
	[],
);
const EMPTY_HANDLER_ROWS: readonly (readonly (LynxBlockListener | null)[])[] = Object.freeze([]);
const EMPTY_REF_VALUES: readonly unknown[] = Object.freeze([]);
const EMPTY_REF_ROWS: readonly (readonly unknown[])[] = Object.freeze([]);
const EMPTY_RANGE_KEY = Object.freeze({});
const EMPTY_RANGE_ITEMS: readonly unknown[] = Object.freeze([EMPTY_RANGE_KEY]);

function indexProgramSites(sites: readonly { readonly slot: number }[]): ProgramSiteIndexes {
	if (sites.length === 0) return EMPTY_SITE_INDEXES;
	const indexed: number[][] = [];
	for (let index = 0; index < sites.length; index++) {
		const slot = sites[index]!.slot;
		(indexed[slot] ??= []).push(index);
	}
	return indexed;
}

/** One range's whole next state, produced before any of it is written. */
interface RangeRender {
	readonly state: RangeState;
	readonly items: readonly unknown[];
	readonly rows: readonly (readonly UniversalHostTemplateProgramValue[])[];
	readonly handlers: readonly (readonly (LynxBlockListener | null)[])[];
	readonly refs: readonly (readonly unknown[])[];
	/** Per-row overrides of `visible`, allocated only when a row differs. */
	readonly visibilities: readonly boolean[] | null;
	/** This render's keys, in order, so the write path needs no second pass. */
	readonly keys: readonly unknown[];
	/** What the next render compares against, adopted only once this one applies. */
	readonly retained: Map<unknown, RetainedRow | null>;
	/**
	 * Keys to remove from a reused retained map after acknowledgement. Non-null
	 * only for the compiler-proven deletion-only shortcut.
	 */
	readonly removedRetainedKeys: readonly unknown[] | null;
	readonly hasScopedRows: boolean;
	/** Whether any block has to be mounted, removed, or moved. */
	readonly structural: boolean;
	readonly contextValues: SemanticContexts;
	readonly visible: boolean;
	/** Indices of the rows this render actually called; the rest were retained. */
	readonly templateState: RangeTemplateState | null;
	/** Per-member templates for the retained-body + pending two-arm state. */
	readonly templateStates?: readonly RangeTemplateState[];
	/** Members whose visibility/resources change even though their body was not called. */
	readonly visibilityChanged?: readonly number[];
	/** Previously committed descendants hidden without re-running their setup. */
	readonly hideNested?: NestedRangeState;
	/** Renderer-owned parent selected by a portal boundary for this range. */
	readonly portalTarget?: UniversalPortalTargetHandle;
	/** Undo renderer resources when a later sibling abandons this completed render. */
	readonly discard?: () => void;
	/** Deliberately keep this boundary's last accepted physical and semantic range. */
	readonly retainCommitted?: boolean;
	readonly rendered: readonly number[];
	readonly source: Iterable<unknown>;
	readonly keyedSelection: NonNullable<UniversalForValue['keyedSelection']> | null;
	readonly componentRows: NonNullable<UniversalForValue['componentRows']> | null;
	/** Non-null when a compiler proof reached only the old/new selected keys. */
	readonly sparse: readonly SparseRangeRow[] | null;
	/** Present only for a retained Activity member. */
	readonly activityVisible?: boolean;
	/** Nested range work for outer members that rendered in this attempt. */
	readonly nested: ReadonlyMap<unknown, NestedRangeRender>;
	/** Complete nested ownership map to publish after acknowledgement. */
	readonly nestedStates: Map<unknown, NestedRangeState> | null;
}

interface NestedRangeRender {
	readonly state: NestedRangeState;
	readonly renders: readonly RangeRender[];
	/** Prior semantic subtree cleared before this replacement is mounted. */
	readonly replaces?: NestedRangeState;
}

interface SparseRangeRow {
	readonly key: unknown;
	readonly retained: RetainedRow;
}

const EMPTY_RANGE_RENDERS: readonly RangeRender[] = Object.freeze([]);
const EMPTY_NESTED_RANGE_RENDERS: ReadonlyMap<unknown, NestedRangeRender> = Object.freeze(
	new Map(),
);

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
	 * A range whose rows are `<Row />` calls a second component per row. Tracking
	 * the component being called lets one shared render context name any refusal.
	 */
	let rendering: LynxComponent<never> = subject;
	let renderingContexts: SemanticContexts = null;
	const withSemanticContexts = <T>(contexts: SemanticContexts, run: () => T): T => {
		const previous = renderingContexts;
		renderingContexts = contexts;
		try {
			return run();
		} finally {
			renderingContexts = previous;
		}
	};
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
		readContext<T>(context: UniversalContext<T>): T {
			return readSemanticContext(renderingContexts, context);
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
	const renderHookScope = <T>(cells: UniversalHookScope, setup: () => T): T =>
		activeTransitionAttempt === null ? cells.render(setup) : cells.renderTransition(setup);
	const publishHookScope = (
		context: LynxBlockProgramContext,
		cells: UniversalHookScope,
		visible: boolean,
	): void => {
		const transitionAttempt = activeTransitionAttempt;
		context.afterCommit(() => {
			const hold = transitionAttempt?.suspended === true;
			cells.commit(visible, hold);
			if (hold) transitionWorkScopes.add(cells);
		});
	};
	/**
	 * The page component's hook cells. Keyed row scopes live on `RetainedRow`
	 * instead: semantic ownership follows the key without creating Universal host
	 * records. Either stays null when compiler metadata proves there are no hooks.
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
	let dirtySlots: Set<unknown> | null = null;
	let liveComputations: readonly LynxCompilerProgramComputation[] = EMPTY_COMPUTATIONS;
	let liveComputationGeneration = 0;
	let renderQueued = false;
	let dirtyGeneration = 0;
	let preparationScheduled = false;
	let preparedDirty: {
		readonly generation: number;
		readonly computationGeneration: number;
		readonly outputs: ReadonlyMap<number, unknown>;
		readonly transaction: UniversalHookScopePrepared;
	} | null = null;
	let preparationError: unknown = null;
	let transitionRenderQueued = false;
	const transitionWorkScopes = new Set<UniversalHookScope>();
	interface BlockTransitionAttempt {
		suspended: boolean;
	}
	let activeTransitionAttempt: BlockTransitionAttempt | null = null;
	const finishBlockTransitions = (): void => {
		for (const cells of transitionWorkScopes) cells.finishTransitions();
		transitionWorkScopes.clear();
	};

	let encoder: UniversalHostEncoder | null = null;
	let portalCapability: UniversalPortalCapability<LynxClientContainer> | null = null;
	const portalHandles = new Map<string | number, UniversalPortalTargetHandle>();
	const portalTargetClaims = new Map<string | number, RangeState>();
	let portalDraftClaims: Map<string | number, RangeState> | null = null;
	let plan: UniversalPlan | LynxCompilerProgram | null = null;
	let compiled: CompiledUniversalTemplateProgram | null = null;
	let prepared: PreparedUniversalTemplateProgram | null = null;
	let block: LynxBlock | null = null;
	let valueIndexesBySlot: ProgramSiteIndexes = EMPTY_SITE_INDEXES;
	let eventIndexesBySlot: ProgramSiteIndexes = EMPTY_SITE_INDEXES;
	// Host refs publish ownership at the ACK boundary and are absent from the
	// template value map. A dirty group touching one must take the full render
	// path so bindRefs sees every accepted descriptor together.
	let refSlots: ReadonlySet<number> | null = null;
	let ranges: readonly RangeState[] = EMPTY_RANGES;

	/** Read a compiled component's return value, or say what it returned instead. */
	const readPlanValue = (
		source: LynxComponent<never>,
		produced: unknown,
		inheritedContexts: SemanticContexts = renderingContexts,
		inheritedVisible = true,
	): RenderedPlan => {
		let output = produced;
		let contextValues = inheritedContexts;
		let visible = inheritedVisible;
		while (output !== null && typeof output === 'object') {
			const kind = (output as { $$kind?: unknown }).$$kind;
			if (kind === UNIVERSAL_ACTIVITY) {
				const activity = output as UniversalActivityValue;
				visible = visible && activity.mode === 'visible';
				output = withSemanticContexts(contextValues, activity.body);
				continue;
			}
			if (kind === UNIVERSAL_CONTEXT) {
				const provider = output as UniversalContextValue;
				const next = new Map(contextValues ?? []);
				next.set(provider.context, provider.value);
				contextValues = next;
				output = withSemanticContexts(contextValues, () => {
					const children = provider.children;
					return typeof children === 'function' ? children() : children;
				});
				continue;
			}
			if (kind === UNIVERSAL_CHILDREN) {
				const children = output as UniversalChildrenValue;
				if (children.renderer !== LYNX_TRANSPORT_RENDERER) {
					refuse(
						source,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a provider returned children owned by a different renderer.',
					);
				}
				output = withSemanticContexts(contextValues, children.render);
				continue;
			}
			if (kind === UNIVERSAL_VALUE) {
				const wrapper = output as UniversalPlanValue;
				if (wrapper.plan.root.kind === 'slot') {
					output = wrapper.values[wrapper.plan.root.slot];
					continue;
				}
			}
			if (kind === UNIVERSAL_COMPONENT_VALUE) {
				const child = output as UniversalComponentValue;
				if (child.renderer !== LYNX_TRANSPORT_RENDERER) {
					refuse(
						source,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a component child belongs to a different renderer.',
					);
				}
				return renderPlanValue(
					child.component as unknown as LynxComponent<never>,
					forwardedProps(child),
					contextValues,
					visible,
				);
			}
			break;
		}
		if (isLynxCompilerProgramValue(output)) {
			return {
				source,
				plan: output.program,
				values: output.values,
				computations: output.computations,
				contextValues,
				visible,
			};
		}
		const value = output as UniversalPlanValue | null;
		if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
			refuse(
				source,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'it did not return a compiled template, so there is nothing to lower. Only a compiler program or a component lowered to a Universal plan can become a block program.',
			);
		}
		return {
			source,
			plan: value.plan,
			values: value.values,
			computations: EMPTY_COMPUTATIONS,
			contextValues,
			visible,
		};
	};

	/**
	 * Call a component and read the plan value it returned.
	 *
	 * Stateful pages and rows reach this inside their own scope. The catch is a
	 * fail-closed guard for a false stateless proof: executing a hook without an
	 * owner must name the contradictory proof rather than escape as an internal
	 * controller error.
	 */
	const renderPlanValue = (
		source: LynxComponent<never>,
		props: unknown,
		contexts: SemanticContexts = renderingContexts,
		visible = true,
	): RenderedPlan => {
		const outer = rendering;
		rendering = source;
		try {
			return withSemanticContexts(contexts, () => {
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
								'its setup calls a hook after its metadata declared hookScope: false. Recompile the component so its ownership proof matches its setup.',
						);
					}
					throw error;
				}
				return readPlanValue(source, produced, contexts, visible);
			});
		} finally {
			rendering = outer;
		}
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
		if (!componentMayNeedHookScope(subject) && !componentPropsMayNeedHookScope(props)) {
			context.afterAbort(() => {
				liveContext = previousContext;
				liveProps = previousProps;
			});
			return renderPlanValue(subject, props);
		}
		const cells = (scope ??= createUniversalHookScope({
			renderer: LYNX_TRANSPORT_RENDERER,
			scheduleRender: queueStateRender,
			scheduleTransitionRender(): void {
				transitionWorkScopes.add(scope!);
				queueTransitionRender();
			},
			scheduleMicrotask(task): void {
				liveContext!.scheduleMicrotask(task);
			},
			readContext(context) {
				return readSemanticContext(renderingContexts, context);
			},
			scheduleLayoutEffectCommit(task): void {
				liveContext!.afterCommit(task);
			},
			schedulePassiveEffectCommit(task): void {
				liveContext!.afterPassiveCommit(task);
			},
		}));
		let rendered: RenderedPlan;
		try {
			rendered = renderHookScope(cells, () => renderPlanValue(subject, props));
		} catch (error) {
			cells.abort();
			liveContext = previousContext;
			liveProps = previousProps;
			// The scope refuses capabilities it does not implement with stable
			// messages; rename insertion effects here to the layer the application
			// can see.
			if (error instanceof Error && error.message === UNIVERSAL_HOOK_SCOPE_EFFECTS_REFUSED) {
				refuse(subject, LYNX_BLOCK_COMPONENT_DEVELOPMENT && INSERTION_EFFECTS_UNSUPPORTED);
			}
			throw error;
		}
		const transitionAttempt = activeTransitionAttempt;
		context.afterAbort(() => {
			cells.abort(transitionAttempt !== null);
			liveContext = previousContext;
			liveProps = previousProps;
		});
		return rendered;
	};

	const snapshotRangeTemplates = (): readonly (() => void)[] => {
		let restores: (() => void)[] | null = null;
		const visited = new Set<RangeState>();
		const snapshotTemplate = (templateState: RangeTemplateState): void => {
			if (templateState.plan !== null) return;
			const snapshot = {
				plan: templateState.plan,
				compiled: templateState.compiled,
				prepared: templateState.prepared,
				template: templateState.template,
				ranges: templateState.ranges,
			};
			(restores ??= []).push(() => Object.assign(templateState, snapshot));
		};
		const snapshotStates = (states: readonly RangeState[]): void => {
			for (const state of states) {
				if (visited.has(state)) continue;
				visited.add(state);
				snapshotTemplate(state.rowTemplate);
				snapshotTemplate(state.emptyTemplate);
				const branches = state.branchTemplates;
				if (branches !== null) {
					const acceptedBranchCount = branches.size;
					(restores ??= []).push(() => {
						let index = 0;
						for (const key of branches.keys()) {
							if (index++ >= acceptedBranchCount) branches.delete(key);
						}
					});
					for (const branch of branches.values()) snapshotTemplate(branch.template);
				}
				for (const nested of state.nested?.values() ?? []) snapshotStates(nested.ranges);
			}
		};
		snapshotStates(ranges);
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
	const scheduleDirtyPreparation = (context: LynxBlockProgramContext): void => {
		if (preparationScheduled) return;
		preparationScheduled = true;
		context.schedulePreparation((backpressured) => {
			preparationScheduled = false;
			// Without a sent frame, the queued render owns the next turn and computes
			// directly; do not allocate a detached draft merely to hand it right back.
			if (!backpressured || !renderQueued || block === null || dirtySlots === null) return;
			const generation = dirtyGeneration;
			try {
				const next = prepareDirtyComputations(generation, [...dirtySlots]);
				preparedDirty?.transaction.abort();
				preparedDirty = next;
				preparationError = null;
			} catch (error) {
				preparedDirty?.transaction.abort();
				preparedDirty = null;
				preparationError = error;
			}
			if (dirtyGeneration !== generation) scheduleDirtyPreparation(context);
		});
	};

	function queueStateRender(slot: unknown): void {
		const context = liveContext;
		if (context === null || block === null) return;
		(dirtySlots ??= new Set()).add(slot);
		dirtyGeneration++;
		if (renderQueued) {
			context.noteRenderMerge();
			scheduleDirtyPreparation(context);
			return;
		}
		renderQueued = true;
		scheduleDirtyPreparation(context);
		void context
			.scheduleRender(() => {
				renderQueued = false;
				const scheduled = dirtySlots;
				dirtySlots = null;
				const generation = dirtyGeneration;
				const candidate = preparedDirty;
				preparedDirty = null;
				const error = preparationError;
				preparationError = null;
				if (block === null) {
					candidate?.transaction.abort();
					return;
				}
				if (error !== null) {
					candidate?.transaction.abort();
					throw error;
				}
				if (
					candidate !== null &&
					candidate.generation === generation &&
					candidate.computationGeneration === liveComputationGeneration
				) {
					context.afterAbort(() => candidate.transaction.abort());
					context.afterCommit(() => candidate.transaction.commit());
					applyDirtyOutputs(context, candidate.outputs);
					return;
				}
				candidate?.transaction.abort();
				if (scheduled === null || !renderDirtyComputations(context, [...scheduled])) {
					renderAgain(context, liveProps as Props);
				}
			})
			.catch((error: unknown) => {
				setTimeout(() => {
					throw error;
				}, 0);
			});
	}

	/** Coalesce every promoted scope lane into one serialized Block transaction. */
	function queueTransitionRender(): void {
		const context = liveContext;
		if (context === null || block === null) return;
		if (transitionRenderQueued) {
			context.noteRenderMerge();
			return;
		}
		transitionRenderQueued = true;
		void context
			.scheduleRender(() => {
				transitionRenderQueued = false;
				if (block !== null) renderAgain(context, liveProps as Props, true);
			})
			.catch((error: unknown) => {
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

	const portalCapabilityFor = (
		context: LynxBlockProgramContext,
	): UniversalPortalCapability<LynxClientContainer> => {
		if (portalCapability !== null) return portalCapability;
		const capability = loweringDriver(context.container).portals;
		if (capability === undefined) {
			return refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'the Lynx host driver does not declare renderer-owned portal targets.',
			);
		}
		portalCapability = capability;
		return capability;
	};

	const preparePortalTarget = (
		context: LynxBlockProgramContext,
		target: unknown,
	): UniversalPortalTargetRegistration =>
		portalCapabilityFor(context).prepareTarget({
			container: context.container,
			renderer: LYNX_TRANSPORT_RENDERER,
			target,
			transported: true,
			createPortalTargetHandle(id) {
				let handle = portalHandles.get(id);
				if (handle === undefined) {
					handle = Object.freeze({
						$$kind: 'octane.universal.portal-target',
						renderer: LYNX_TRANSPORT_RENDERER,
						root: context.root.transportRoot,
						id,
					});
					portalHandles.set(id, handle);
				}
				return handle;
			},
		});

	/** One isolated target-ownership ledger for the active Block render attempt. */
	const draftPortalClaims = (
		context: LynxBlockProgramContext,
	): Map<string | number, RangeState> => {
		if (portalDraftClaims !== null) return portalDraftClaims;
		const draft = new Map(portalTargetClaims);
		portalDraftClaims = draft;
		context.afterAbort(() => {
			if (portalDraftClaims === draft) portalDraftClaims = null;
		});
		context.afterCommit(() => {
			portalTargetClaims.clear();
			for (const [id, owner] of draft) portalTargetClaims.set(id, owner);
			if (portalDraftClaims === draft) portalDraftClaims = null;
		});
		return draft;
	};

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
		const values = prepareUniversalTemplateProgramValuesFromWire(
			encoderFor(context),
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
		templateState: RangeTemplateState,
		produced: unknown,
		// The component and props `renderRange` already derived from `produced`
		// for the memo comparison — threaded through rather than re-derived, so
		// the row is called with exactly what was compared.
		component: LynxComponent<never> | null,
		props: unknown,
		previous: RetainedRow | null,
		previousNested: NestedRangeState | null,
		replaceNested: boolean,
		contexts: SemanticContexts,
		parentVisible = true,
	): {
		readonly scope: UniversalHookScope | null;
		readonly scoped: ScopedRowState | null;
		readonly values: readonly UniversalHostTemplateProgramValue[];
		readonly listeners: readonly (LynxBlockListener | null)[];
		readonly refs: readonly unknown[];
		readonly visible: boolean;
		readonly nested: NestedRangeRender | null;
	} => {
		// Component rows own semantic cells independently of their host blocks.
		// The key map retains the scope; the host acknowledgement publishes its
		// draft, while a refused/retried parent attempt rolls it back.
		let rowScope = previous?.scope ?? null;
		let scoped = previous?.scoped ?? null;
		let rendered: RenderedPlan;
		if (
			component !== null &&
			(componentMayNeedHookScope(component) || componentPropsMayNeedHookScope(props))
		) {
			const created = rowScope === null;
			if (created) {
				let owner: ScopedRowState;
				rowScope = createUniversalHookScope({
					renderer: LYNX_TRANSPORT_RENDERER,
					scheduleRender(): void {
						queueScopedRowStateRender(owner);
					},
					scheduleTransitionRender(): void {
						transitionWorkScopes.add(rowScope!);
						queueTransitionRender();
					},
					scheduleMicrotask(task): void {
						liveContext!.scheduleMicrotask(task);
					},
					readContext(context) {
						return readSemanticContext(renderingContexts, context);
					},
					scheduleLayoutEffectCommit(task): void {
						liveContext!.afterCommit(task);
					},
					schedulePassiveEffectCommit(task): void {
						liveContext!.afterPassiveCommit(task);
					},
				});
				owner = {
					current: null,
					state: null,
					key: undefined,
					templateState: null,
					queued: false,
				};
				scoped = owner;
			}
			const cells = rowScope!;
			const transitionAttempt = activeTransitionAttempt;
			context.afterAbort(() => {
				cells.abort(!created && transitionAttempt !== null);
				if (created) cells.dispose();
			});
			try {
				rendered = renderHookScope(cells, () => renderPlanValue(component, props, contexts));
			} catch (error) {
				// A surrounding Block boundary may accept its fallback, so the root
				// attempt itself will not abort. Drop this arm's draft here; a fresh
				// scope has no committed lifetime to retain, while an existing scope
				// keeps its last accepted cells for Suspense reveal or error retry.
				cells.abort();
				if (created) cells.dispose();
				throw error;
			}
			publishHookScope(context, cells, parentVisible && rendered.visible);
		} else if (component !== null) {
			rendered = renderPlanValue(component, props, contexts);
		} else {
			// The page did return a compiled template — the row's output is what
			// did not — so the diagnostic must say which level failed.
			if (isLynxCompilerProgramValue(produced)) {
				rendered = {
					source: subject,
					plan: produced.program,
					values: produced.values,
					computations: produced.computations,
					contextValues: contexts,
					visible: parentVisible,
				};
			} else {
				const value = produced as UniversalPlanValue | null;
				if (value === null || typeof value !== 'object' || value.$$kind !== UNIVERSAL_VALUE) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a row of one of its keyed ranges is not a compiled template. Only a compiler program, Universal plan, or component returning one can mount on a range site.',
					);
				}
				rendered = {
					source: subject,
					plan: value.plan,
					values: value.values,
					computations: EMPTY_COMPUTATIONS,
					contextValues: contexts,
					visible: parentVisible,
				};
			}
		}
		if (templateState.plan === null) {
			if (isLynxCompilerProgram(rendered.plan)) {
				templateState.plan = rendered.plan;
				templateState.compiled = null;
				templateState.prepared = rendered.plan;
				templateState.ranges = rendered.plan.ranges;
				templateState.template = compileLynxBlockTemplate(
					rendered.plan.wire,
					rendered.plan.address,
					rendered.plan.refs?.map((ref) => ref.node),
				);
			} else {
				const root = rendered.plan.root;
				if (root.kind !== 'host') {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							`a row of one of its keyed ranges is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a range mounts one host subtree per row.`,
					);
				}
				const program = compileUniversalHostProgram(encoderFor(context), root);
				if (program === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a row of one of its keyed ranges is not entirely compile-time host structure, so there is no static template to mount per row.',
					);
				}
				const split = universalTemplateProgramWithoutRanges(program, (slot) =>
					isDynamicRegionValue(rendered.values[slot]),
				);
				if (split === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a nested row has a structural range where no host parent can own it.',
					);
				}
				const wire = prepareUniversalTemplateProgram(encoderFor(context), split.compiled);
				if (wire === null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'this renderer cannot carry a static prop or event site of one of its keyed range rows in a template program.',
					);
				}
				templateState.plan = rendered.plan;
				templateState.compiled = split.compiled;
				templateState.prepared = wire;
				templateState.ranges = split.ranges;
				templateState.template = compileLynxBlockTemplate(wire.wire, rendered.plan.address);
			}
		} else if (rendered.plan !== templateState.plan) {
			refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'two rows of one keyed range returned different compiled templates, and a range mounts one template for every row.',
			);
		}
		const sites = templateState.prepared!.events;
		const values = prepareUniversalTemplateProgramValuesFromWire(
			encoderFor(context),
			templateState.prepared!,
			withHandlerStubs(rendered.source, sites, rendered.values),
		);
		if (values === null) {
			refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'a row of one of its keyed ranges holds a value the row template cannot carry.',
			);
		}
		const definitions = templateState.ranges!;
		const nestedState =
			definitions.length === 0
				? null
				: !replaceNested && previousNested?.template === templateState
					? previousNested
					: {
							template: templateState,
							ranges: definitions.map((definition) =>
								createRangeState(definition, rendered.values[definition.slot]),
							),
						};
		const nested =
			nestedState === null
				? null
				: {
						state: nestedState,
						renders: renderRangeStates(
							context,
							nestedState.ranges,
							rendered.values,
							rendered.contextValues,
							rendered.visible,
						),
						...(replaceNested && previousNested !== null ? { replaces: previousNested } : null),
					};
		return {
			scope: component === null ? null : rowScope,
			scoped: component === null ? null : scoped,
			values,
			listeners: listenersAt(sites, rendered.values),
			refs:
				isLynxCompilerProgram(rendered.plan) && rendered.plan.refs !== undefined
					? rendered.plan.refs.map((ref) => rendered.values[ref.slot])
					: EMPTY_REF_VALUES,
			visible: parentVisible && rendered.visible,
			nested,
		};
	};

	/** Apply one outer member's recursively rendered structural sites. */
	const applyNestedRangeRender = (
		context: LynxBlockProgramContext,
		member: LynxBlock,
		nested: NestedRangeRender,
	): void => {
		if (nested.replaces !== undefined) clearNestedRanges(context, nested.replaces, false);
		for (let index = 0; index < nested.state.ranges.length; index++) {
			const range = nested.state.ranges[index]!;
			if (range.site === null) {
				range.site = context.core.openForSlot(member, range.node, range.slot, range.before);
			}
			applyRange(context, nested.renders[index]!);
		}
	};

	/** Publish the address a row-owned setter may update after host acceptance. */
	const publishScopedRow = (
		context: LynxBlockProgramContext,
		state: RangeState,
		templateState: RangeTemplateState,
		key: unknown,
		row: RetainedRow,
	): void => {
		const owner = row.scoped;
		if (owner === null) return;
		context.afterCommit(() => {
			owner.current = row;
			owner.state = state;
			owner.key = key;
			owner.templateState = templateState;
		});
	};

	/**
	 * Re-run only the semantic scope whose cell changed.
	 *
	 * The row's committed props are already the input `renderRange` would have
	 * rebuilt by scanning the parent iterable. Its retained key addresses the
	 * mounted instance directly, so neither the page setup nor any unrelated row
	 * body participates. Opaque calls inside this row still execute: the scope is
	 * the conservative boundary when the compiler cannot prove a smaller pure
	 * computation.
	 */
	function renderScopedRowAgain(context: LynxBlockProgramContext, owner: ScopedRowState): void {
		const current = owner.current;
		const state = owner.state;
		if (current === null || state === null || state.site === null || owner.templateState === null)
			return;
		const rendered = renderRow(
			context,
			state,
			owner.templateState,
			undefined,
			current.component,
			current.props,
			current,
			state.nested?.get(owner.key) ?? null,
			false,
			state.contextValues,
			current.visible,
		);
		const next: RetainedRow = {
			component: current.component,
			props: current.props,
			scope: rendered.scope,
			scoped: rendered.scoped,
			values: rendered.values,
			listeners: rendered.listeners,
			refs: rendered.refs,
			visible: rendered.visible,
			index: current.index,
		};
		const member = context.core.writeKeyedValues(state.site, owner.key, rendered.values);
		if (member === undefined) {
			refuse(
				current.component,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'its retained keyed scope no longer names a mounted row during a local update.',
			);
		}
		if (owner.templateState.prepared!.events.length !== 0) {
			if (!rendered.visible || rendered.listeners.includes(null)) {
				context.root.releaseListeners(member);
			}
			if (rendered.visible) context.root.bindListeners(member, rendered.listeners);
		}
		if (owner.templateState.template!.refs !== undefined) {
			if (rendered.visible) context.root.bindRefs(member, rendered.refs);
			else context.root.releaseRefs(member);
		}
		if (rendered.nested !== null) {
			applyNestedRangeRender(context, member, rendered.nested);
			context.afterCommit(() => {
				(state.nested ??= new Map()).set(owner.key, rendered.nested!.state);
			});
		}
		publishScopedRow(context, state, owner.templateState, owner.key, next);
	}

	/** Queue one row-owned update without promoting it to the page scope. */
	function queueScopedRowStateRender(owner: ScopedRowState): void {
		if (owner.queued) return;
		const context = liveContext;
		const state = owner.state;
		if (
			context === null ||
			block === null ||
			owner.current === null ||
			state === null ||
			state.site === null
		) {
			return;
		}
		owner.queued = true;
		void context
			.scheduleRender(() => {
				owner.queued = false;
				const scheduledState = owner.state;
				if (
					block === null ||
					owner.current === null ||
					scheduledState === null ||
					scheduledState.site === null
				) {
					return;
				}
				renderScopedRowAgain(context, owner);
			})
			.catch((error: unknown) => {
				setTimeout(() => {
					throw error;
				}, 0);
			});
	}

	const disposeDepartedRowScopes = (
		context: LynxBlockProgramContext,
		previous: ReadonlyMap<unknown, RetainedRow | null> | null,
		next: ReadonlyMap<unknown, RetainedRow | null>,
	): void => {
		if (previous === null) return;
		for (const [key, prior] of previous) {
			if (prior === null || prior.scope === null) continue;
			const survivor = next.get(key);
			if (survivor?.scope === prior.scope) continue;
			const oldScope = prior.scope;
			const oldOwner = prior.scoped;
			context.afterCommit(() => {
				if (oldOwner !== null) {
					oldOwner.current = null;
					oldOwner.state = null;
					oldOwner.templateState = null;
				}
				oldScope.dispose();
			});
		}
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
		contextValues: SemanticContexts,
		parentVisible: boolean,
	): RangeRender => {
		const nextComponentRows = list.componentRows ?? null;
		const previousComponentRows = state.componentRows;
		const nextSelection = list.keyedSelection ?? null;
		const previousSelection = state.keyedSelection;
		const previous = state.retained;
		const previousKeys = state.keys;
		const contextsStable =
			activeTransitionAttempt === null &&
			state.visible === parentVisible &&
			sameSemanticContexts(state.contextValues, contextValues);
		let nestedStates: Map<unknown, NestedRangeState> | null = null;
		let nestedRenders: Map<unknown, NestedRangeRender> | null = null;
		let materializedItems: unknown[] | null = null;
		if (list.empty !== null) {
			materializedItems = Array.from(list.items as Iterable<unknown>);
			if (materializedItems.length === 0) {
				const produced = list.empty();
				const invocation = rowComponentInvocation(produced);
				const component =
					(invocation?.component as unknown as LynxComponent<never> | undefined) ?? null;
				const props = invocation === null ? null : forwardedProps(invocation);
				const prior = previous?.get(EMPTY_RANGE_KEY) ?? null;
				const priorNested = state.nested?.get(EMPTY_RANGE_KEY);
				let values: readonly UniversalHostTemplateProgramValue[];
				let listeners: readonly (LynxBlockListener | null)[];
				let refValues: readonly unknown[];
				let retainedRow: RetainedRow | null;
				let rendered: readonly number[];
				let rowVisible: boolean;
				if (
					component !== null &&
					prior !== null &&
					contextsStable &&
					prior.component === component &&
					(priorNested === undefined || !nestedStateNeedsRetry(priorNested)) &&
					blockShallowEqual(prior.props, props)
				) {
					values = prior.values;
					listeners = prior.listeners;
					refValues = prior.refs;
					retainedRow = prior;
					rendered = EMPTY_INDEXES;
					rowVisible = prior.visible;
					if (priorNested !== undefined) {
						(nestedStates ??= new Map()).set(EMPTY_RANGE_KEY, priorNested);
					}
				} else {
					const previousNested = state.nested?.get(EMPTY_RANGE_KEY) ?? null;
					const replaceNested =
						previousNested !== null &&
						!((component === null && prior === null) || prior?.component === component);
					if (replaceNested) disposeNestedScopes(context, previousNested);
					const row = renderRow(
						context,
						state,
						state.emptyTemplate,
						produced,
						component,
						props,
						prior?.component === component ? prior : null,
						previousNested,
						replaceNested,
						contextValues,
						parentVisible,
					);
					values = row.values;
					listeners = row.listeners;
					refValues = row.refs;
					rendered = [0];
					rowVisible = row.visible;
					if (row.nested !== null) {
						(nestedStates ??= new Map()).set(EMPTY_RANGE_KEY, row.nested.state);
						(nestedRenders ??= new Map()).set(EMPTY_RANGE_KEY, row.nested);
					}
					retainedRow =
						component === null
							? null
							: {
									component,
									props,
									scope: row.scope,
									scoped: row.scoped,
									values,
									listeners,
									refs: row.refs,
									visible: row.visible,
									index: 0,
								};
					if (retainedRow !== null) {
						publishScopedRow(context, state, state.emptyTemplate, EMPTY_RANGE_KEY, retainedRow);
					}
				}
				const retained = new Map<unknown, RetainedRow | null>([[EMPTY_RANGE_KEY, retainedRow]]);
				disposeDepartedRowScopes(context, previous, retained);
				return {
					state,
					templateState: state.emptyTemplate,
					items: EMPTY_RANGE_ITEMS,
					rows: [values],
					handlers: [listeners],
					refs: [refValues],
					visibilities: rowVisible === parentVisible ? null : [rowVisible],
					keys: EMPTY_RANGE_ITEMS,
					retained,
					removedRetainedKeys: null,
					hasScopedRows: retainedRow !== null && retainedRow.scope !== null,
					structural:
						previousKeys === null ||
						previousKeys.length !== 1 ||
						previousKeys[0] !== EMPTY_RANGE_KEY,
					contextValues,
					visible: parentVisible,
					rendered,
					source: list.items,
					keyedSelection: null,
					componentRows: null,
					sparse: null,
					nested: nestedRenders ?? EMPTY_NESTED_RANGE_RENDERS,
					nestedStates,
				};
			}
		}
		// The compiler proved the row descriptor is a function only of the item,
		// index, static props, and this identity tuple. With the same iterable and
		// tuple, neither its keys nor its props can have changed, so even asking
		// the iterable for those answers is redundant. This is stronger than
		// memoizing row bodies after a scan: no Array.from, key call, props object,
		// row array, or retained Map is created. A call, member read, getter-capable
		// expression, or other escape causes the compiler to omit componentRows
		// and lands below on the complete conservative path.
		if (
			contextsStable &&
			nextComponentRows !== null &&
			previousComponentRows !== null &&
			state.source === list.items &&
			previous !== null &&
			previousKeys !== null &&
			!nestedStatesNeedRetry(state.nested) &&
			depsEqual(previousComponentRows, nextComponentRows)
		) {
			return {
				state,
				templateState: state.rowTemplate,
				items: [],
				rows: [],
				handlers: [],
				refs: EMPTY_REF_ROWS,
				visibilities: null,
				keys: previousKeys,
				retained: previous,
				removedRetainedKeys: null,
				hasScopedRows: state.hasScopedRows,
				structural: false,
				rendered: [],
				contextValues,
				visible: parentVisible,
				source: list.items,
				keyedSelection: nextSelection,
				componentRows: nextComponentRows,
				sparse: null,
				nested: EMPTY_NESTED_RANGE_RENDERS,
				nestedStates: state.nested,
			};
		}
		if (
			contextsStable &&
			nextSelection !== null &&
			!state.hasScopedRows &&
			state.nested === null &&
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
					const invocation = rowComponentInvocation(produced);
					const component =
						(invocation?.component as unknown as LynxComponent<never> | undefined) ?? null;
					const props = invocation === null ? null : forwardedProps(invocation);
					if (component === null || component !== prior.component) {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								'a compiler-certified keyed selection later produced a different row component.',
						);
					}
					if (blockShallowEqual(prior.props, props)) continue;
					const row = renderRow(
						context,
						state,
						state.rowTemplate,
						produced,
						component,
						props,
						prior,
						null,
						false,
						contextValues,
					);
					sparse.push({
						key: itemKey,
						retained: {
							component,
							props,
							scope: row.scope,
							scoped: row.scoped,
							values: row.values,
							listeners: row.listeners,
							refs: row.refs,
							visible: row.visible,
							index: prior.index,
						},
					});
					const retainedRow = sparse[sparse.length - 1]!.retained;
					publishScopedRow(context, state, state.rowTemplate, itemKey, retainedRow);
				}
			}
			return {
				state,
				templateState: state.rowTemplate,
				items: [],
				rows: [],
				handlers: [],
				refs: EMPTY_REF_ROWS,
				visibilities: null,
				keys: previousKeys,
				retained: previous,
				hasScopedRows: false,
				removedRetainedKeys: null,
				structural: false,
				rendered: [],
				source: list.items,
				keyedSelection: nextSelection,
				componentRows: nextComponentRows,
				sparse,
				contextValues,
				visible: parentVisible,
				nested: EMPTY_NESTED_RANGE_RENDERS,
				nestedStates: null,
			};
		}

		const items = materializedItems ?? Array.from(list.items as Iterable<unknown>);
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
			contextsStable &&
			!state.hasScopedRows &&
			state.nested === null &&
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
					templateState: state.rowTemplate,
					items,
					rows,
					handlers,
					refs: EMPTY_REF_ROWS,
					visibilities: null,
					keys,
					retained: previous,
					removedRetainedKeys,
					hasScopedRows: false,
					structural: true,
					rendered: [],
					source: list.items,
					keyedSelection: nextSelection,
					componentRows: nextComponentRows,
					contextValues,
					visible: parentVisible,
					sparse: null,
					nested: EMPTY_NESTED_RANGE_RENDERS,
					nestedStates: null,
				};
			}
		}
		const rows: (readonly UniversalHostTemplateProgramValue[])[] = new Array(items.length);
		const handlers: (readonly (LynxBlockListener | null)[])[] = new Array(items.length);
		const refs: (readonly unknown[])[] = new Array(items.length);
		let visibilities: boolean[] | null = null;
		const keys: unknown[] = new Array(items.length);
		const selectionRowsStable =
			nextSelection !== null &&
			contextsStable &&
			previousSelection !== null &&
			previous !== null &&
			depsEqual(previousSelection[1], nextSelection[1]);
		// Every key, so the duplicate check below covers the whole range; a value
		// only where one can be reused, so an inline row body costs no allocation
		// for a memo it can never take.
		const retained = new Map<unknown, RetainedRow | null>();
		const rendered: number[] = [];
		let hasScopedRows = false;
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
			const priorNested = state.nested?.get(itemKey);
			if (
				selectionRowsStable &&
				prior != null &&
				prior.scope === null &&
				(priorNested === undefined || !nestedStateNeedsRetry(priorNested)) &&
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
				refs[index] = prior.refs;
				if (prior.visible !== parentVisible) {
					(visibilities ??= new Array(items.length).fill(parentVisible))[index] = prior.visible;
				}
				retained.set(itemKey, prior);
				if (priorNested !== undefined) {
					(nestedStates ??= new Map()).set(itemKey, priorNested);
				}
				continue;
			}
			// The `@for` body, which builds the row's props but does not call it.
			// Lifted out of `renderRow` for exactly that reason: a row is skippable
			// only if what it would be called with can be compared first.
			const produced = list.render(item, index);
			const invocation = rowComponentInvocation(produced);
			const component =
				(invocation?.component as unknown as LynxComponent<never> | undefined) ?? null;
			const props = invocation === null ? null : forwardedProps(invocation);
			if (component !== null) {
				if (
					prior != null &&
					contextsStable &&
					prior.component === component &&
					prior.scope === null &&
					(priorNested === undefined || !nestedStateNeedsRetry(priorNested)) &&
					blockShallowEqual(prior.props, props)
				) {
					// Same component, same props: the body is a function of its props,
					// so it would produce what it produced last time. Its listeners are
					// reused with its values — they close over props this comparison
					// just found equal, so last render's closures reach the same
					// functions and the same item as fresh ones would.
					rows[index] = prior.values;
					handlers[index] = prior.listeners;
					refs[index] = prior.refs;
					if (prior.visible !== parentVisible) {
						(visibilities ??= new Array(items.length).fill(parentVisible))[index] = prior.visible;
					}
					retained.set(itemKey, prior);
					if (priorNested !== undefined) {
						(nestedStates ??= new Map()).set(itemKey, priorNested);
					}
					continue;
				}
			}
			const previousNested = priorNested ?? null;
			const replaceNested =
				previousNested !== null &&
				!((component === null && prior == null) || prior?.component === component);
			if (replaceNested) disposeNestedScopes(context, previousNested);
			const row = renderRow(
				context,
				state,
				state.rowTemplate,
				produced,
				component,
				props,
				prior?.component === component ? prior : null,
				previousNested,
				replaceNested,
				contextValues,
				parentVisible,
			);
			if (row.scope !== null) hasScopedRows = true;
			rows[index] = row.values;
			handlers[index] = row.listeners;
			refs[index] = row.refs;
			if (row.visible !== parentVisible) {
				(visibilities ??= new Array(items.length).fill(parentVisible))[index] = row.visible;
			}
			if (row.nested !== null) {
				(nestedStates ??= new Map()).set(itemKey, row.nested.state);
				(nestedRenders ??= new Map()).set(itemKey, row.nested);
			}
			rendered.push(index);
			let retainedRow: RetainedRow | null = null;
			if (component !== null) {
				retainedRow = {
					component,
					props,
					scoped: row.scoped,
					scope: row.scope,
					values: row.values,
					listeners: row.listeners,
					refs: row.refs,
					visible: row.visible,
					index,
				};
				publishScopedRow(context, state, state.rowTemplate, itemKey, retainedRow);
			}
			retained.set(itemKey, retainedRow);
		}
		disposeDepartedRowScopes(context, previous, retained);

		return {
			state,
			templateState: state.rowTemplate,
			items,
			rows,
			handlers,
			refs,
			visibilities,
			keys,
			retained,
			hasScopedRows,
			removedRetainedKeys: null,
			structural,
			rendered,
			source: list.items,
			keyedSelection: nextSelection,
			componentRows: nextComponentRows,
			sparse: null,
			contextValues,
			visible: parentVisible,
			nested: nestedRenders ?? EMPTY_NESTED_RANGE_RENDERS,
			nestedStates,
		};
	};
	const renderBranchRange = (
		context: LynxBlockProgramContext,
		state: RangeState,
		branch: UniversalBranchValue | UniversalComponentValue | UniversalActivityValue | null,
		contextValues: SemanticContexts,
		parentVisible: boolean,
		preserveKeys: readonly unknown[] = EMPTY_INDEXES,
	): RangeRender => {
		const branches = state.branchTemplates;
		if (branches === null) {
			refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'a keyed list hole later held a single dynamic region, and a block holds one structural region kind for its lifetime.',
			);
		}
		const previous = state.retained;
		const previousKeys = state.keys;
		let nestedState: NestedRangeState | null = null;
		let nestedRender: NestedRangeRender | null = null;
		const preserve = (retained: Map<unknown, RetainedRow | null>): void => {
			if (previous === null) return;
			for (const key of preserveKeys) {
				if (previous.has(key) && !retained.has(key)) retained.set(key, previous.get(key) ?? null);
			}
		};
		const renderNothing = (): RangeRender => {
			const retained = new Map<unknown, RetainedRow | null>();
			preserve(retained);
			disposeDepartedRowScopes(context, previous, retained);
			return {
				state,
				templateState: null,
				items: EMPTY_INDEXES,
				rows: EMPTY_PROGRAM_ROWS,
				handlers: EMPTY_HANDLER_ROWS,
				refs: EMPTY_REF_ROWS,
				visibilities: null,
				keys: EMPTY_INDEXES,
				retained,
				removedRetainedKeys: null,
				hasScopedRows: false,
				structural: previousKeys !== null && previousKeys.length !== 0,
				contextValues,
				visible: parentVisible,
				rendered: EMPTY_INDEXES,
				source: EMPTY_INDEXES,
				keyedSelection: null,
				componentRows: null,
				sparse: null,
				nested: EMPTY_NESTED_RANGE_RENDERS,
				nestedStates: null,
			};
		};
		const activity = branch !== null && isActivityValue(branch) ? branch : null;
		const componentRegion = branch !== null && isComponentRegionValue(branch) ? branch : null;
		let selected: readonly [identity: unknown, render: () => unknown] | null;
		if (activity !== null) {
			selected = [ACTIVITY_BRANCH, activity.body];
		} else if (componentRegion === null) {
			selected = branch === null ? null : selectedBranch(branch as UniversalBranchValue);
		} else {
			let identity: unknown = componentRegion.hasKey ? null : componentRegion.component;
			if (componentRegion.hasKey) {
				for (const [candidateIdentity, candidate] of branches) {
					if (
						candidate.component === componentRegion.component &&
						candidate.hasKey === true &&
						Object.is(candidate.authoredKey, componentRegion.key)
					) {
						identity = candidateIdentity;
						break;
					}
				}
			}
			if (identity === null) identity = Object.freeze({});
			selected = [identity, () => componentRegion];
		}
		if (selected === null) return renderNothing();
		const produced = withSemanticContexts(contextValues, selected[1]);
		if (produced === null || produced === undefined || typeof produced === 'boolean') {
			return renderNothing();
		}
		const invocation = rowComponentInvocation(produced);
		const component =
			(invocation?.component as unknown as LynxComponent<never> | undefined) ?? null;
		const props = invocation === null ? null : forwardedProps(invocation);
		const branchIdentity = selected[0];
		// A component produced by @if/universalIf must retain the authored component
		// key as well as the selected arm. Keying only by the arm would preserve hook
		// state across `<Row key={next} />`; keying only by the component would merge
		// two different arms. Reuse an identity record only when all three facts
		// agree, and let a replacement receive a fresh range member below.
		if (activity === null && componentRegion === null && invocation !== null) {
			let identity: unknown = null;
			for (const [candidateIdentity, candidate] of branches) {
				if (
					candidate.branchIdentity === branchIdentity &&
					candidate.component === component &&
					candidate.hasKey === invocation.hasKey &&
					(!invocation.hasKey || Object.is(candidate.authoredKey, invocation.key))
				) {
					identity = candidateIdentity;
					break;
				}
			}
			if (identity === null) identity = Object.freeze({});
			selected = [identity, selected[1]];
		}
		let branchState = branches.get(selected[0]);
		if (branchState === undefined) {
			branchState = {
				key: Object.freeze({}),
				template: createRangeTemplateState(),
				...(activity === null && componentRegion === null && invocation !== null
					? { branchIdentity }
					: null),
				...(component === null ? null : { component }),
				...(invocation?.hasKey === true
					? { hasKey: true, authoredKey: invocation.key }
					: invocation === null
						? null
						: { hasKey: false }),
			};
			branches.set(selected[0], branchState);
		}
		const prior = previous?.get(branchState.key) ?? null;
		const priorNested = state.nested?.get(branchState.key);
		const contextsStable =
			activeTransitionAttempt === null &&
			state.visible === parentVisible &&
			sameSemanticContexts(state.contextValues, contextValues);
		let values: readonly UniversalHostTemplateProgramValue[];
		let listeners: readonly (LynxBlockListener | null)[];
		let refValues: readonly unknown[];
		let retainedRow: RetainedRow | null;
		let rendered: readonly number[];
		let rowVisible: boolean;
		const activityVisible = parentVisible && activity?.mode === 'visible';
		if (
			component !== null &&
			prior !== null &&
			contextsStable &&
			prior.component === component &&
			(priorNested === undefined || !nestedStateNeedsRetry(priorNested)) &&
			prior.visible === (activity === null ? parentVisible : activityVisible) &&
			blockShallowEqual(prior.props, props)
		) {
			values = prior.values;
			listeners = prior.listeners;
			refValues = prior.refs;
			retainedRow =
				activity === null || prior.visible === activityVisible
					? prior
					: { ...prior, visible: activityVisible };
			rendered = EMPTY_INDEXES;
			rowVisible = retainedRow.visible;
			nestedState = priorNested ?? null;
			if (activity !== null) {
				context.afterCommit(() => retainedRow?.scope?.commit(activityVisible));
				if (retainedRow !== prior) {
					publishScopedRow(context, state, branchState.template, branchState.key, retainedRow);
				}
			}
		} else {
			const row = renderRow(
				context,
				state,
				branchState.template,
				produced,
				component,
				props,
				prior?.component === component ? prior : null,
				priorNested ?? null,
				false,
				contextValues,
				activity === null ? parentVisible : activityVisible,
			);
			values = row.values;
			listeners = row.listeners;
			refValues = row.refs;
			rendered = [0];
			rowVisible = row.visible;
			nestedState = row.nested?.state ?? null;
			nestedRender = row.nested;
			retainedRow =
				component === null
					? null
					: {
							component,
							props,
							scope: row.scope,
							scoped: row.scoped,
							values,
							listeners,
							refs: row.refs,
							visible: row.visible,
							index: 0,
						};
			if (retainedRow !== null) {
				publishScopedRow(context, state, branchState.template, branchState.key, retainedRow);
			}
		}
		const retained = new Map<unknown, RetainedRow | null>([[branchState.key, retainedRow]]);
		preserve(retained);
		disposeDepartedRowScopes(context, previous, retained);
		return {
			state,
			templateState: branchState.template,
			items: [produced],
			rows: [values],
			handlers: [listeners],
			refs: [refValues],
			visibilities: rowVisible === parentVisible ? null : [rowVisible],
			keys: [branchState.key],
			retained,
			removedRetainedKeys: null,
			hasScopedRows: retainedRow !== null && retainedRow.scope !== null,
			structural:
				previousKeys === null || previousKeys.length !== 1 || previousKeys[0] !== branchState.key,
			contextValues,
			visible: parentVisible,
			rendered,
			source: EMPTY_INDEXES,
			keyedSelection: null,
			componentRows: null,
			sparse: null,
			nested:
				nestedRender === null
					? EMPTY_NESTED_RANGE_RENDERS
					: new Map([[branchState.key, nestedRender]]),
			nestedStates: nestedState === null ? null : new Map([[branchState.key, nestedState]]),
			...(activity === null ? null : { activityVisible }),
		};
	};

	const tryArmValue = (identity: object, render: () => unknown): UniversalSwitchValue => {
		const renderArm = () =>
			universalComponent(LYNX_TRANSPORT_RENDERER, TRY_ARM_COMPONENT, { render });
		return {
			$$kind: UNIVERSAL_SWITCH,
			value: identity,
			// The index selected by `selectedBranch` is the stable arm identity.
			// Unselected callbacks are never called, so sharing `render` here avoids
			// allocating three closures around the authored one.
			cases: [
				[TRY_BODY_BRANCH, renderArm],
				[TRY_PENDING_BRANCH, renderArm],
				[TRY_CATCH_BRANCH, renderArm],
			],
			default: null,
		} as unknown as UniversalSwitchValue;
	};

	const branchTemplateForKey = (state: RangeState, key: unknown): RangeTemplateState => {
		for (const branch of state.branchTemplates!.values()) {
			if (branch.key === key) return branch.template;
		}
		return refuse(
			subject,
			LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
				'a retained boundary arm lost its compiler-owned template identity.',
		);
	};

	/** Render one compiler-proved portal into a renderer-owned parent range. */
	const renderPortalRange = (
		context: LynxBlockProgramContext,
		state: RangeState,
		portal: UniversalPortalValue | null,
		contextValues: SemanticContexts,
		parentVisible: boolean,
	): RangeRender => {
		const hadPortalState = state.portalState !== null;
		if (state.branchTemplates === null) {
			return refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT && 'a non-portal structural region later held a portal.',
			);
		}
		let portalState = state.portalState;
		if (portalState === null) {
			if (state.branchTemplates.size !== 0 || (state.keys !== null && state.keys.length !== 0)) {
				return refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'a structural region changed from an authored branch to a portal.',
				);
			}
		}
		if (portal === null) {
			if (portalState === null) {
				return renderBranchRange(context, state, null, contextValues, parentVisible);
			}
			const rendered = renderBranchRange(context, state, null, contextValues, parentVisible);
			const previous = portalState.registration;
			if (previous !== null) {
				const claims = draftPortalClaims(context);
				const priorClaims = new Map(claims);
				let active = true;
				if (claims.get(previous.handle.id) === state) claims.delete(previous.handle.id);
				context.afterCommit(() => {
					if (!active) return;
					previous.release();
					portalState!.target = null;
					portalState!.registration = null;
				});
				return {
					...rendered,
					discard() {
						if (!active) return;
						active = false;
						claims.clear();
						for (const [id, owner] of priorClaims) claims.set(id, owner);
					},
				};
			}
			return rendered;
		}

		const previous = portalState?.registration ?? null;
		let registration = previous;
		let preparedRegistration = false;
		if (previous === null || !Object.is(portalState!.target, portal.target)) {
			registration = preparePortalTarget(context, portal.target);
			preparedRegistration = true;
		}
		const target = registration!.handle;
		const claims = draftPortalClaims(context);
		const claimant = claims.get(target.id);
		if (claimant !== undefined && claimant !== state) {
			if (preparedRegistration) registration!.release();
			return refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'Block currently supports one active portal boundary per Lynx target.',
			);
		}
		const branch = {
			$$kind: UNIVERSAL_IF,
			condition: true,
			then: () => portal.children,
			else: null,
		} as unknown as UniversalIfValue;
		let rendered: RangeRender;
		try {
			rendered = renderBranchRange(context, state, branch, contextValues, parentVisible);
		} catch (error) {
			if (preparedRegistration) registration!.release();
			throw error;
		}

		if (portalState === null) {
			portalState = { target: null, registration: null, site: null };
			state.portalState = portalState;
		}
		const createdPortalState = !hadPortalState;
		const priorClaims = new Map(claims);
		let active = true;
		if (createdPortalState) {
			context.afterAbort(() => {
				if (active) state.portalState = null;
			});
		}
		if (previous?.handle.id !== target.id) {
			if (previous !== null && claims.get(previous.handle.id) === state) {
				claims.delete(previous.handle.id);
			}
			claims.set(target.id, state);
		}
		let compilerSite: LynxBlockForSlot | null = null;
		let createdSite = false;
		if (portalState.site === null) {
			compilerSite = state.site;
			const site = context.core.openForParent(target);
			portalState.site = site;
			state.site = site;
			createdSite = true;
			context.afterAbort(() => {
				if (!active) return;
				portalState!.site = null;
				state.site = compilerSite;
			});
		}
		if (preparedRegistration) {
			context.afterAbort(() => {
				if (active) registration!.release();
			});
			context.afterCommit(() => {
				if (!active) return;
				previous?.release();
				portalState!.target = portal.target;
				portalState!.registration = registration;
			});
		}
		return {
			...rendered,
			portalTarget: target,
			discard() {
				if (!active) return;
				active = false;
				if (preparedRegistration) registration!.release();
				claims.clear();
				for (const [id, owner] of priorClaims) claims.set(id, owner);
				if (createdSite) {
					portalState!.site = null;
					state.site = compilerSite;
				}
				if (createdPortalState) state.portalState = null;
			},
		};
	};

	/** Render one retained error/Suspense boundary into its compiler range. */
	const renderTryRange = (
		context: LynxBlockProgramContext,
		state: RangeState,
		boundary: UniversalTryValue,
		contextValues: SemanticContexts,
		parentVisible: boolean,
	): RangeRender => {
		const tryState = state.tryState;
		if (tryState === null || state.branchTemplates === null) {
			return refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'a non-boundary structural region later held an error/Suspense boundary.',
			);
		}
		const scheduleRetry = (transition = tryState.transitionPending): void => {
			if (!tryState.active || tryState.needsRetry) return;
			tryState.needsRetry = true;
			if (transition) queueTransitionRender();
			else queueStateRender(TRY_RETRY_SLOT);
		};
		const reset = (): void => {
			if (!tryState.active || !tryState.hasError) return;
			tryState.hasError = false;
			tryState.error = undefined;
			scheduleRetry();
		};
		const renderArm = (
			identity: object,
			render: () => unknown,
			preserveKeys: readonly unknown[] = EMPTY_INDEXES,
		): RangeRender =>
			renderBranchRange(
				context,
				state,
				tryArmValue(identity, render),
				contextValues,
				parentVisible,
				preserveKeys,
			);
		const renderCatch = (error: unknown): RangeRender => {
			if (boundary.catch === null) throw error;
			const caught = renderArm(TRY_CATCH_BRANCH, () => boundary.catch!(error, reset));
			context.afterCommit(() => {
				tryState.hasError = true;
				tryState.error = error;
				tryState.thenable = null;
				tryState.suspension = null;
				tryState.needsRetry = false;
				tryState.bodyKey = null;
				tryState.transitionPending = false;
			});
			return caught;
		};
		const renderPending = (suspension: unknown, thenable: PromiseLike<unknown>): RangeRender => {
			const transitionAttempt = activeTransitionAttempt;
			const transitionPending = transitionAttempt !== null || tryState.transitionPending;
			if (transitionAttempt !== null) transitionAttempt.suspended = true;
			let retainedTransition: RangeRender | null = null;
			if (transitionAttempt !== null && state.retained !== null && state.keys !== null) {
				retainedTransition = {
					state,
					templateState: null,
					items: EMPTY_INDEXES,
					rows: EMPTY_PROGRAM_ROWS,
					handlers: EMPTY_HANDLER_ROWS,
					refs: EMPTY_REF_ROWS,
					visibilities: null,
					keys: state.keys,
					retained: state.retained,
					removedRetainedKeys: null,
					hasScopedRows: state.hasScopedRows,
					structural: false,
					contextValues: state.contextValues,
					visible: state.visible,
					rendered: EMPTY_INDEXES,
					source: state.source ?? EMPTY_INDEXES,
					keyedSelection: state.keyedSelection,
					componentRows: state.componentRows,
					sparse: null,
					nested: EMPTY_NESTED_RANGE_RENDERS,
					nestedStates: state.nested,
					retainCommitted: true,
				};
			}
			if (retainedTransition === null && boundary.pending === null) throw suspension;
			const bodyKey = tryState.bodyKey;
			const retainsBody =
				bodyKey !== null && state.keys !== null && state.keys.some((key) => key === bodyKey);
			const pending =
				retainedTransition ??
				renderArm(TRY_PENDING_BRANCH, boundary.pending!, retainsBody ? [bodyKey] : EMPTY_INDEXES);
			let rendered = pending;
			if (retainedTransition === null && retainsBody) {
				const bodyTemplate = branchTemplateForKey(state, bodyKey);
				const prior = state.retained?.get(bodyKey) ?? null;
				const hidden = prior === null ? null : { ...prior, visible: false };
				const retained = new Map<unknown, RetainedRow | null>([[bodyKey, hidden]]);
				for (const key of pending.keys) retained.set(key, pending.retained.get(key) ?? null);
				if (hidden !== null) {
					publishScopedRow(context, state, bodyTemplate, bodyKey, hidden);
					context.afterCommit(() => hidden.scope?.commit(false));
				}
				const bodyNested = state.nested?.get(bodyKey) ?? null;
				const nestedStates = new Map<unknown, NestedRangeState>();
				if (bodyNested !== null) nestedStates.set(bodyKey, bodyNested);
				for (const [key, nested] of pending.nestedStates ?? []) nestedStates.set(key, nested);
				const pendingVisibility = pending.visibilities?.[0] ?? parentVisible;
				const keys = [bodyKey, ...pending.keys];
				rendered = {
					...pending,
					templateState: pending.templateState ?? bodyTemplate,
					templateStates: [
						bodyTemplate,
						...(pending.templateState === null ? [] : [pending.templateState]),
					],
					items: [null, ...pending.items],
					rows: [EMPTY_PROGRAM_VALUES, ...pending.rows],
					handlers: [EMPTY_LISTENERS, ...pending.handlers],
					refs: [EMPTY_REF_VALUES, ...pending.refs],
					visibilities: [false, ...(pending.keys.length === 0 ? [] : [pendingVisibility])],
					visibilityChanged: [0, ...pending.rendered.map((index) => index + 1)],
					keys,
					retained,
					hasScopedRows: (hidden !== null && hidden.scope !== null) || pending.hasScopedRows,
					structural:
						state.keys === null ||
						state.keys.length !== keys.length ||
						keys.some((key, index) => state.keys![index] !== key),
					rendered: pending.rendered.map((index) => index + 1),
					nestedStates: nestedStates.size === 0 ? null : nestedStates,
					hideNested: bodyNested ?? undefined,
				};
			}
			context.afterCommit(() => {
				tryState.hasError = false;
				tryState.error = undefined;
				tryState.needsRetry = false;
				tryState.suspension = suspension;
				// An urgent render may deliberately show the fallback while a prior
				// transition is held. It changes the shell policy, not ownership of the
				// pending lane; the thenable must still retry and settle that lane.
				tryState.transitionPending = transitionPending;
				if (tryState.thenable === thenable) return;
				tryState.thenable = thenable;
				const settle = () => {
					if (!tryState.active || tryState.thenable !== thenable) return;
					tryState.thenable = null;
					tryState.suspension = null;
					scheduleRetry();
				};
				thenable.then(settle, settle);
			});
			return rendered;
		};

		if (tryState.hasError) return renderCatch(tryState.error);
		if (tryState.thenable !== null) {
			return renderPending(tryState.suspension, tryState.thenable);
		}
		try {
			const body = renderArm(TRY_BODY_BRANCH, boundary.body);
			const bodyKey = body.keys[0] ?? null;
			const bodyWasHidden = bodyKey !== null && state.retained?.get(bodyKey)?.visible === false;
			context.afterCommit(() => {
				tryState.hasError = false;
				tryState.error = undefined;
				tryState.thenable = null;
				tryState.suspension = null;
				tryState.needsRetry = false;
				tryState.bodyKey = bodyKey;
				tryState.transitionPending = false;
			});
			return bodyWasHidden
				? {
						...body,
						visibilities: [parentVisible],
						visibilityChanged: [0],
					}
				: body;
		} catch (error) {
			const thenable = universalSuspensionThenable(error);
			return thenable === null ? renderCatch(error) : renderPending(error, thenable);
		}
	};

	/** Release one portal's renderer-owned target only after its host removal is accepted. */
	const disposeRangePortal = (context: LynxBlockProgramContext, range: RangeState): void => {
		const portalState = range.portalState;
		const registration = portalState?.registration ?? null;
		if (registration === null) return;
		context.afterCommit(() => {
			if (portalTargetClaims.get(registration.handle.id) === range) {
				portalTargetClaims.delete(registration.handle.id);
			}
			registration.release();
			if (range.portalState === portalState) {
				portalState!.target = null;
				portalState!.registration = null;
			}
		});
	};

	/** Dispose semantic owners held below an outer member after its host leaves. */
	const disposeNestedScopes = (context: LynxBlockProgramContext, state: NestedRangeState): void => {
		for (const range of state.ranges) {
			disposeRangePortal(context, range);
			if (range.tryState !== null) {
				context.afterCommit(() => {
					range.tryState!.active = false;
					range.tryState!.thenable = null;
					range.tryState!.suspension = null;
				});
			}
			for (const row of range.retained?.values() ?? []) {
				if (row?.scope === null || row?.scope === undefined) continue;
				const owner = row.scoped;
				const scope = row.scope;
				context.afterCommit(() => {
					if (owner !== null) {
						owner.current = null;
						owner.state = null;
						owner.templateState = null;
					}
					scope.dispose();
				});
			}
			for (const child of range.nested?.values() ?? []) {
				disposeNestedScopes(context, child);
			}
		}
	};

	/** Clear descendants before their owning outer host is removed. */
	const clearNestedRanges = (
		context: LynxBlockProgramContext,
		state: NestedRangeState,
		disposeScopes = true,
	): void => {
		if (disposeScopes) disposeNestedScopes(context, state);
		for (const range of state.ranges) {
			if (range.site === null) continue;
			const children = range.nested;
			context.core.clearForSlot(
				range.site,
				(member) => {
					const child = children?.get(member.key);
					if (child !== undefined) clearNestedRanges(context, child, false);
					context.root.releaseListeners(member);
					context.root.releaseRefs(member);
				},
				children !== null,
			);
		}
	};

	/** Disconnect a committed subtree while Suspense retains its physical identity. */
	const hideNestedRanges = (context: LynxBlockProgramContext, state: NestedRangeState): void => {
		for (const range of state.ranges) {
			const site = range.site;
			if (site === null) continue;
			for (const [key, member] of site.items) {
				context.core.setVisibility(member, false);
				context.root.releaseListeners(member);
				context.root.releaseRefs(member);
				const prior = range.retained?.get(key) ?? null;
				if (prior !== null && prior.visible) {
					const hidden = { ...prior, visible: false };
					context.afterCommit(() => {
						range.retained?.set(key, hidden);
						if (hidden.scoped !== null) hidden.scoped.current = hidden;
						hidden.scope?.commit(false);
					});
				}
				const child = range.nested?.get(key);
				if (child !== undefined) hideNestedRanges(context, child);
			}
			context.afterCommit(() => {
				range.visible = false;
			});
		}
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
		if (render.retainCommitted === true) return;
		const templateState = render.templateState;
		if (render.portalTarget !== undefined && !Object.is(state.site!.parent, render.portalTarget)) {
			context.core.retargetForSlot(state.site!, render.portalTarget);
		}
		if (render.hideNested !== undefined) hideNestedRanges(context, render.hideNested);
		const releaseMember = (member: LynxBlock): void => {
			const nested = state.nested?.get(member.key);
			if (nested !== undefined) clearNestedRanges(context, nested);
			context.root.releaseListeners(member);
			context.root.releaseRefs(member);
		};
		const applyNested = (): void => {
			for (const [key, nested] of render.nested) {
				const member = state.site!.items.get(key);
				if (member === undefined) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a nested range render lost its owning outer member after reconciliation.',
					);
				}
				applyNestedRangeRender(context, member, nested);
			}
		};
		const bindMember = (
			member: LynxBlock,
			memberTemplate: RangeTemplateState,
			handlers: readonly (LynxBlockListener | null)[],
			refs: readonly unknown[],
			visible: boolean,
		): void => {
			if (memberTemplate.prepared!.events.length !== 0) {
				if (!visible || handlers.includes(null)) context.root.releaseListeners(member);
				if (visible) context.root.bindListeners(member, handlers);
			}
			if (memberTemplate.template!.refs !== undefined) {
				if (visible) context.root.bindRefs(member, refs);
				else context.root.releaseRefs(member);
			}
		};
		if (render.sparse !== null) {
			if (templateState === null) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT && 'a sparse keyed update lost its row template.',
				);
			}
			for (const row of render.sparse) {
				const member = context.core.writeKeyedValues(state.site!, row.key, row.retained.values);
				if (member === undefined) continue;
				if (member.visible !== row.retained.visible) {
					context.core.setVisibility(member, row.retained.visible);
				}
				if (templateState.prepared!.events.length !== 0) {
					if (!row.retained.visible || row.retained.listeners.includes(null)) {
						context.root.releaseListeners(member);
					}
					if (row.retained.visible) context.root.bindListeners(member, row.retained.listeners);
				}
				if (templateState.template!.refs !== undefined) {
					if (row.retained.visible) context.root.bindRefs(member, row.retained.refs);
					else context.root.releaseRefs(member);
				}
			}
			context.afterCommit(() => {
				state.source = render.source;
				state.keyedSelection = render.keyedSelection;
				state.componentRows = render.componentRows;
				state.contextValues = render.contextValues;
				state.hasScopedRows = render.hasScopedRows;
				state.nested = render.nestedStates;
				state.visible = render.visible;
				for (const row of render.sparse!) state.retained!.set(row.key, row.retained);
			});
			applyNested();
			return;
		}
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
			state.componentRows = render.componentRows;
			state.contextValues = render.contextValues;
			state.retained = render.retained;
			state.hasScopedRows = render.hasScopedRows;
			state.keys = render.keys;
			state.nested = render.nestedStates;
			state.visible = render.visible;
		});
		if (templateState === null || templateState.template === null) {
			context.core.clearForSlot(state.site!, releaseMember, state.nested !== null);
			return;
		}
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
			const rendered = render.activityVisible === undefined ? render.rendered : ([0] as const);
			const hasVisibilityWork =
				state.visible !== render.visible ||
				render.activityVisible !== undefined ||
				render.visibilityChanged !== undefined ||
				!render.visible ||
				render.visibilities !== null;
			for (const index of rendered) {
				const member = context.core.writeKeyedValues(
					state.site!,
					render.keys[index],
					render.rows[index]!,
				);
				if (member === undefined) continue;
				const visible = render.visibilities?.[index] ?? render.visible;
				if (hasVisibilityWork && member.visible !== visible) {
					context.core.setVisibility(member, visible);
				}
				bindMember(
					member,
					render.templateStates?.[index] ?? templateState,
					render.handlers[index]!,
					render.refs[index]!,
					visible,
				);
			}
			for (const index of render.visibilityChanged ?? EMPTY_INDEXES) {
				if (rendered.includes(index)) continue;
				const member = state.site!.items.get(render.keys[index])!;
				const visible = render.visibilities?.[index] ?? render.visible;
				if (member.visible !== visible) context.core.setVisibility(member, visible);
				bindMember(
					member,
					render.templateStates?.[index] ?? templateState,
					render.handlers[index]!,
					render.refs[index]!,
					visible,
				);
			}
			applyNested();
			return;
		}
		if (render.removedRetainedKeys !== null) {
			context.core.removeKeysForSlot(state.site!, render.removedRetainedKeys, releaseMember);
			return;
		}
		context.core.reconcileForSlot(
			state.site!,
			templateState.template,
			render.items,
			// The keys `renderRange` already derived and duplicate-checked, not
			// the user's key function again: the reconciler must mount under
			// exactly the keys `state.keys` records, or an impure key function
			// could let a later render's same-sequence check pass against keys
			// the range is not actually holding.
			(_item, index) => render.keys[index]!,
			(_item, index) => render.rows[index]!,
			releaseMember,
			// `rendered` is appended during the forward item scan, so it is already
			// the ascending proof the core needs. Survivors absent from it reused
			// their complete descriptor; comparing every live slot again would only
			// rediscover the identity the component layer already established.
			render.rendered,
			state.nested !== null,
		);
		const rendered =
			render.visibilityChanged ??
			(render.activityVisible === undefined ? render.rendered : ([0] as const));
		const hasVisibilityWork =
			state.visible !== render.visible ||
			render.activityVisible !== undefined ||
			render.visibilityChanged !== undefined ||
			!render.visible ||
			render.visibilities !== null;
		for (const index of rendered) {
			const member = state.site!.items.get(render.keys[index])!;
			const visible = render.visibilities?.[index] ?? render.visible;
			if (hasVisibilityWork && member.visible !== visible) {
				context.core.setVisibility(member, visible);
			}
			bindMember(
				member,
				render.templateStates?.[index] ?? templateState,
				render.handlers[index]!,
				render.refs[index]!,
				visible,
			);
		}
		applyNested();
	};

	/** Every range's render for one set of slot values, or the first refusal. */
	const renderRangeStates = (
		context: LynxBlockProgramContext,
		states: readonly RangeState[],
		slotValues: readonly unknown[],
		contextValues: SemanticContexts,
		visible: boolean,
	): readonly RangeRender[] => {
		if (states.length === 0) return EMPTY_RANGE_RENDERS;
		const renderOne = (range: RangeState): RangeRender => {
			const value = slotValues[range.slot];
			if (range.portalState !== null) {
				if (isPortalValue(value)) {
					return renderPortalRange(context, range, value, contextValues, visible);
				}
				if (value === null || value === undefined || typeof value === 'boolean') {
					return renderPortalRange(context, range, null, contextValues, visible);
				}
				return refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'a portal region later held a non-portal structural value.',
				);
			}
			if (isPortalValue(value)) {
				return renderPortalRange(context, range, value, contextValues, visible);
			}
			if (isRangeValue(value)) {
				if (range.branchTemplates !== null) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'a conditional region later held a keyed list, and a block holds one structural region kind for its lifetime.',
					);
				}
				return renderRange(context, range, value, contextValues, visible);
			}
			if (isBranchValue(value)) {
				return renderBranchRange(context, range, value, contextValues, visible);
			}
			if (isComponentRegionValue(value)) {
				return renderBranchRange(context, range, value, contextValues, visible);
			}
			if (isActivityValue(value)) {
				return renderBranchRange(context, range, value, contextValues, visible);
			}
			if (isTryValue(value)) {
				return renderTryRange(context, range, value, contextValues, visible);
			}
			if (
				(value === null || value === undefined || typeof value === 'boolean') &&
				range.branchTemplates !== null
			) {
				return renderBranchRange(context, range, null, contextValues, visible);
			}
			return refuse(
				subject,
				LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
					'a structural hole later held a non-structural value, and a block holds one region kind for its lifetime.',
			);
		};
		const rendered: RangeRender[] = [];
		try {
			for (const range of states) {
				rendered.push(renderOne(range));
			}
		} catch (error) {
			for (let index = rendered.length - 1; index >= 0; index--) rendered[index]!.discard?.();
			throw error;
		}
		return rendered;
	};
	const renderRanges = (
		context: LynxBlockProgramContext,
		slotValues: readonly unknown[],
		contextValues: SemanticContexts,
		visible: boolean,
	): readonly RangeRender[] =>
		renderRangeStates(context, ranges, slotValues, contextValues, visible);

	/** Select compiler-proved scalar outputs for the dirty getter set. */
	const selectDirtyOutputs = (
		sources: readonly (() => unknown)[],
	): Map<number, unknown> | undefined => {
		const dirtySources = new Set(sources);
		const covered = new Set<() => unknown>();
		const selected: LynxCompilerProgramScalarComputation[] = [];
		for (const computation of liveComputations) {
			if (!computation.sources.some((source) => dirtySources.has(source))) continue;
			if (computation.kind === 'structural') return undefined;
			const refs = refSlots;
			if (refs !== null && computation.slots.some((slot) => refs.has(slot))) {
				return undefined;
			}
			selected.push(computation);
			for (const source of computation.sources) {
				if (dirtySources.has(source)) covered.add(source);
			}
		}
		if (sources.some((source) => !covered.has(source))) return undefined;

		const outputs = new Map<number, unknown>();
		for (const computation of selected) {
			const values = computation.run();
			if (!Array.isArray(values) || values.length !== computation.slots.length) {
				refuse(
					subject,
					LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
						'a compiler dirty computation returned a different number of values than slots.',
				);
			}
			for (let index = 0; index < computation.slots.length; index++) {
				const slot = computation.slots[index]!;
				if (outputs.has(slot)) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'two compiler dirty computations wrote the same value slot.',
					);
				}
				outputs.set(slot, values[index]);
			}
		}
		return outputs;
	};

	/** Apply already-computed scalar outputs inside the next host attempt. */
	const applyDirtyOutputs = (
		context: LynxBlockProgramContext,
		outputs: ReadonlyMap<number, unknown>,
	): void => {
		for (const [slot, output] of outputs) {
			for (const valueIndex of valueIndexesBySlot[slot] ?? EMPTY_INDEXES) {
				const binding = prepared!.values[valueIndex]!;
				const value = prepareUniversalTemplateProgramValueFromWire(
					encoderFor(context),
					prepared!,
					binding,
					output,
				);
				if (value === UNIVERSAL_TEMPLATE_PROGRAM_VALUE_REFUSED) {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'one of its dirty scalar values does not fit the compiled template binding.',
					);
				}
				context.core.setSlotValue(block!, valueIndex, value);
			}
			for (const eventIndex of eventIndexesBySlot[slot] ?? EMPTY_INDEXES) {
				if (output !== null && output !== undefined && typeof output !== 'function') {
					refuse(
						subject,
						LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
							'an event dirty computation returned neither a handler nor an empty conditional hole.',
					);
				}
				context.root.setListener(
					block!,
					eventIndex,
					block!.visible && typeof output === 'function' ? (output as LynxBlockListener) : null,
				);
			}
		}
	};

	/** Consume and apply one ordinary dirty transaction. */
	const renderDirtyComputations = (
		context: LynxBlockProgramContext,
		slots: readonly unknown[],
	): boolean => {
		const cells = scope;
		if (cells === null || liveComputations.length === 0 || prepared === null || block === null) {
			return false;
		}
		let outputs: Map<number, unknown> | undefined;
		try {
			const supported = cells.renderDirty(slots, (sources) => {
				outputs = selectDirtyOutputs(sources);
			});
			if (!supported || outputs === undefined) {
				cells.abort();
				return false;
			}
			context.afterAbort(() => cells.abort());
			applyDirtyOutputs(context, outputs);
			context.afterCommit(() => cells.commit());
			return true;
		} catch (error) {
			cells.abort();
			throw error;
		}
	};

	/** Compute a scalar hook draft while an older physical frame awaits ACK. */
	const prepareDirtyComputations = (generation: number, slots: readonly unknown[]) => {
		const cells = scope;
		if (cells === null || liveComputations.length === 0 || prepared === null || block === null) {
			return null;
		}
		let outputs: Map<number, unknown> | undefined;
		const transaction = cells.prepareDirty(slots, (sources) => {
			outputs = selectDirtyOutputs(sources);
		});
		if (transaction === null || outputs === undefined) {
			transaction?.abort();
			return null;
		}
		return { generation, computationGeneration: liveComputationGeneration, outputs, transaction };
	};

	/**
	 * One later render of the page, whether its props changed or one of its
	 * own cells did. Named rather than inlined on the program because a
	 * state-driven render has no caller to reach it through.
	 */
	const renderAgain = (
		context: LynxBlockProgramContext,
		props: Props,
		transition = false,
	): void => {
		const previousTransitionAttempt = activeTransitionAttempt;
		const transitionAttempt: BlockTransitionAttempt | null = transition
			? { suspended: false }
			: null;
		activeTransitionAttempt = transitionAttempt;
		try {
			const restoreRanges = snapshotRangeTemplates();
			context.afterAbort(() => {
				for (const restore of restoreRanges) restore();
			});
			const rendered = renderSubject(context, props);
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
			const rows = renderRanges(context, rendered.values, rendered.contextValues, rendered.visible);
			// The live values are the core's, not a copy kept here: a shadow of them
			// could only ever drift, and comparing against what the block actually
			// holds is what the core itself compares against.
			const held = block!.values;
			const worklets = block!.template.mainThreadValues;
			if (isLynxCompilerProgram(rendered.plan) && rendered.plan.refs !== undefined) {
				if (rendered.visible) {
					context.root.bindRefs(
						block!,
						rendered.plan.refs.map((ref) => rendered.values[ref.slot]),
					);
				} else {
					context.root.releaseRefs(block!);
				}
			}
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
				if (rendered.visible) {
					context.root.bindListeners(block!, listenersFor(rendered.values));
				}
			}
			context.core.setVisibility(block!, rendered.visible);
			for (const row of rows) applyRange(context, row);
			context.afterCommit(() => {
				scope?.commit(rendered.visible, transitionAttempt?.suspended === true);
				liveComputations = rendered.computations;
				liveComputationGeneration++;
			});
			if (transitionAttempt !== null) {
				context.afterCommit(() => {
					if (transitionAttempt.suspended) return;
					finishBlockTransitions();
				});
			}
		} catch (error) {
			scope?.abort();
			// A handled boundary reaches the accepted path above. An error escaping
			// the whole Block has no later reveal that could own its lane, so settle
			// every participating scope instead of leaving useTransition pending.
			if (transitionAttempt !== null) finishBlockTransitions();
			throw error;
		} finally {
			activeTransitionAttempt = previousTransitionAttempt;
		}
	};

	const program: LynxBlockProgram<Props> = {
		mount(context, props) {
			const previous = {
				plan,
				compiled,
				prepared,
				valueIndexesBySlot,
				eventIndexesBySlot,
				refSlots,
				block,
				ranges,
			};
			context.afterAbort(() => {
				plan = previous.plan;
				compiled = previous.compiled;
				prepared = previous.prepared;
				block = previous.block;
				ranges = previous.ranges;
				valueIndexesBySlot = previous.valueIndexesBySlot;
				eventIndexesBySlot = previous.eventIndexesBySlot;
				refSlots = previous.refSlots;
			});
			const rendered = renderSubject(context, props);
			try {
				let wire: PreparedUniversalTemplateProgram;
				let declaredRanges: readonly {
					readonly slot: number;
					readonly node: number;
					readonly before?: number | null;
				}[];
				if (isLynxCompilerProgram(rendered.plan)) {
					wire = rendered.plan;
					declaredRanges = rendered.plan.ranges;
					compiled = null;
				} else {
					const root = rendered.plan.root;
					if (root.kind !== 'host') {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								`its template is rooted at a ${JSON.stringify(root.kind)} node rather than a host element, and a block mounts one host subtree.`,
						);
					}
					const runtimeProgram = compileUniversalHostProgram(encoderFor(context), root);
					if (runtimeProgram === null) {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								'its template is not entirely compile-time host structure, so there is no static template to mount.',
						);
					}
					const split = universalTemplateProgramWithoutRanges(runtimeProgram, (slot) =>
						isDynamicRegionValue(rendered.values[slot]),
					);
					if (split === null) {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								'its dynamic region is the whole program and has no host parent to own it.',
						);
					}
					const preparedProgram = prepareUniversalTemplateProgram(
						encoderFor(context),
						split.compiled,
					);
					if (preparedProgram === null) {
						refuse(
							subject,
							LYNX_BLOCK_COMPONENT_DEVELOPMENT &&
								'this renderer cannot carry one of its static props or event sites in a template program.',
						);
					}
					wire = preparedProgram;
					declaredRanges = split.ranges;
					compiled = split.compiled;
				}
				plan = rendered.plan;
				prepared = wire;
				ranges =
					declaredRanges.length === 0
						? EMPTY_RANGES
						: declaredRanges.map((range) => createRangeState(range, rendered.values[range.slot]));
				valueIndexesBySlot = indexProgramSites(wire.values);
				eventIndexesBySlot = indexProgramSites(wire.events);
				refSlots =
					isLynxCompilerProgram(rendered.plan) && rendered.plan.refs !== undefined
						? new Set(rendered.plan.refs.map((ref) => ref.slot))
						: null;
				const template: LynxBlockTemplate = compileLynxBlockTemplate(
					wire.wire,
					rendered.plan.address,
					isLynxCompilerProgram(rendered.plan)
						? rendered.plan.refs?.map((ref) => ref.node)
						: undefined,
				);
				const values = valuesFor(context, rendered.values);
				const rows = renderRanges(
					context,
					rendered.values,
					rendered.contextValues,
					rendered.visible,
				);
				// Nothing above this line has written to the core, and nothing below it
				// refuses. What can still throw below is a duplicate key, which the core
				// is the authority on and rejects the same way for every caller.
				block = context.core.mount(null, null, template, values);
				if (isLynxCompilerProgram(rendered.plan) && rendered.plan.refs !== undefined) {
					if (rendered.visible) {
						context.root.bindRefs(
							block,
							rendered.plan.refs.map((ref) => rendered.values[ref.slot]),
						);
					}
				}
				if (rendered.visible && wire.events.length !== 0) {
					context.root.bindListeners(block, listenersFor(rendered.values));
				}
				context.core.setVisibility(block, rendered.visible);
				for (let index = 0; index < ranges.length; index++) {
					const range = ranges[index]!;
					// A portal that targets an already-acknowledged handle can have opened
					// its renderer-owned site while the root render was being produced.
					// Keep that sole owner instead of replacing it with an empty compiler
					// site and retaining the first site only through `portalState`.
					if (range.site === null) {
						range.site = context.core.openForSlot(block, range.node, range.slot, range.before);
					}
					applyRange(context, rows[index]!);
				}
				context.afterCommit(() => {
					scope?.commit(rendered.visible);
					liveComputations = rendered.computations;
					liveComputationGeneration++;
				});
			} catch (error) {
				scope?.abort();
				throw error;
			}
		},

		update: renderAgain,

		unmount(context) {
			// Snapshot semantic owners before the physical ranges are cleared.
			const scopedRows: RetainedRow[] = [];
			for (const range of ranges) {
				if (range.retained === null) continue;
				for (const row of range.retained.values()) {
					if (row?.scope !== null && row?.scope !== undefined) scopedRows.push(row);
				}
			}

			for (const range of ranges) {
				disposeRangePortal(context, range);
				if (range.site === null) continue;
				context.core.clearForSlot(
					range.site,
					(member) => {
						const nested = range.nested?.get(member.key);
						if (nested !== undefined) clearNestedRanges(context, nested);
						context.root.releaseListeners(member);
						context.root.releaseRefs(member);
					},
					range.nested !== null,
				);
			}
			if (block !== null && prepared !== null && prepared.events.length !== 0) {
				context.root.releaseListeners(block);
			}
			if (block !== null && block.template.refs !== undefined) context.root.releaseRefs(block);
			if (block !== null) context.core.destroyRoot(block);
			context.afterCommit(() => {
				for (const range of ranges) {
					if (range.tryState === null) continue;
					range.tryState.active = false;
					range.tryState.thenable = null;
					range.tryState.suspension = null;
					range.tryState.transitionPending = false;
				}
				for (const row of scopedRows) {
					if (row.scoped !== null) {
						row.scoped.current = null;
						row.scoped.state = null;
					}
					row.scope!.dispose();
				}
				block = null;
				ranges = EMPTY_RANGES;
				dirtySlots = null;
				valueIndexesBySlot = EMPTY_SITE_INDEXES;
				eventIndexesBySlot = EMPTY_SITE_INDEXES;
				refSlots = null;
				liveComputations = EMPTY_COMPUTATIONS;
				portalTargetClaims.clear();
				portalDraftClaims = null;
				portalHandles.clear();
				portalCapability = null;
				// The cells outlive nothing: a setter captured by a handler this
				// program bound can still be called after release, and a disposed
				// scope answers it by doing nothing rather than scheduling a render
				// against a block that is gone.
				scope?.dispose();
				scope = null;
				transitionWorkScopes.clear();
				liveContext = null;
				liveProps = undefined;
			});
		},
	};
	return program;
}

/** A direct row invocation, or the transparent one-slot boundary HMR emits. */
function rowComponentInvocation(produced: unknown): UniversalComponentValue | null {
	if (
		produced !== null &&
		typeof produced === 'object' &&
		(produced as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
	) {
		return produced as UniversalComponentValue;
	}
	const wrapper = produced as UniversalPlanValue | null;
	if (
		wrapper === null ||
		typeof wrapper !== 'object' ||
		wrapper.$$kind !== UNIVERSAL_VALUE ||
		wrapper.plan.root.kind !== 'slot'
	) {
		return null;
	}
	const nested = wrapper.values[wrapper.plan.root.slot];
	return nested !== null &&
		typeof nested === 'object' &&
		(nested as { $$kind?: unknown }).$$kind === UNIVERSAL_COMPONENT_VALUE
		? (nested as UniversalComponentValue)
		: null;
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
