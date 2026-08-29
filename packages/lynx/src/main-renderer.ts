/**
 * PrimJS-safe, one-shot renderer ABI for Lynx's synchronous first screen.
 *
 * This intentionally mirrors only the compiler-facing descriptor surface from
 * `octane/universal/native`. It does not import the universal scheduler,
 * reconciler, effects, refs, event handlers, or background transport.
 */
import type {
	LinkedStateOptions,
	LinkedStatePrevious,
	UniversalComponent,
	UniversalContext,
	UniversalEventListenerDescriptor,
	UniversalEventPriority,
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalHostTemplateProgramEvent,
	UniversalHostTemplateProgramNode,
	UniversalHostTemplateProgramValue,
	UniversalKey,
	UniversalPlan,
	UniversalPlanNode,
	UniversalProgramPlan,
	UniversalPropEntry,
	UniversalRenderable,
	UniversalRenderContext,
	UniversalTemplateEnv,
} from 'octane/universal/native';
import { LynxFirstScreenRefusalError, LYNX_FIRST_SCREEN_REFUSED } from './core/first-screen.js';
import { hasOwnSymbolFields } from './core/own-symbols.js';
import { isLynxNativeResource } from './resource.js';

// Re-exported rather than moved out of this module's surface: the renderer is
// where a caller meets the refusal, and `core/first-screen.ts` is where the
// applier meets the same one.
export { LynxFirstScreenRefusalError, LYNX_FIRST_SCREEN_REFUSED };

const UNIVERSAL_PLAN = Symbol.for('octane.universal.plan');
const UNIVERSAL_VALUE = Symbol.for('octane.universal.value');
const UNIVERSAL_LIST = Symbol.for('octane.universal.list');
const UNIVERSAL_COMPONENT = Symbol.for('octane.universal.component');
const UNIVERSAL_COMPONENT_VALUE = Symbol.for('octane.universal.component-value');
const UNIVERSAL_PROPS = Symbol.for('octane.universal.props');
const UNIVERSAL_CHILDREN = Symbol.for('octane.universal.children');
const UNIVERSAL_IF = Symbol.for('octane.universal.if');
const UNIVERSAL_SWITCH = Symbol.for('octane.universal.switch');
const UNIVERSAL_FOR = Symbol.for('octane.universal.for');
const UNIVERSAL_TRY = Symbol.for('octane.universal.try');
const UNIVERSAL_CONTEXT = Symbol.for('octane.universal.context');
const UNIVERSAL_ACTIVITY = Symbol.for('octane.universal.activity');
const UNIVERSAL_KEYED = Symbol.for('octane.universal.keyed');
const UNIVERSAL_PORTAL = Symbol.for('octane.universal.portal');
const LAZY_COMPONENT = Symbol.for('octane.lazy');
const CONTEXT_TAG = Symbol.for('octane.context');
const FIRST_SCREEN_EVENT = Symbol.for('octane.lynx.first-screen-event');
const NO_CHILDREN = Symbol('octane.lynx.first-screen.no-children');
const NO_KEY = Symbol('octane.lynx.first-screen.no-key');
const FIRST_SCREEN_WARM_DEPTH_CAP = 64;

const FIRST_SCREEN_LAZY_METADATA = Object.freeze({
	id: '<lazy>',
	target: 'universal' as const,
});

export const UNIVERSAL_HMR: unique symbol = Symbol.for('octane.universal.hmr') as never;

interface PlanValue {
	readonly $$kind: symbol;
	readonly plan: UniversalPlan;
	readonly values: readonly unknown[];
	readonly key: UniversalKey | null;
}

interface PropsValue {
	readonly $$kind: symbol;
	readonly props: Readonly<Record<string, unknown>>;
	readonly key: unknown;
	readonly hasKey: boolean;
	readonly hasChildren: boolean;
}

interface ComponentValue {
	readonly $$kind: symbol;
	readonly renderer: string;
	readonly component: UniversalComponent<any>;
	readonly props: PropsValue;
	readonly key: unknown;
	readonly hasKey: boolean;
}

interface FirstScreenOwner {
	readonly parent: FirstScreenOwner | null;
	readonly contexts: Map<UniversalContext<any>, unknown> | null;
	readonly visibility: 'visible' | 'hidden';
}

interface FirstScreenHost {
	kind: 'host';
	key: UniversalKey | null;
	id: number;
	readonly type: string;
	readonly props: Readonly<Record<string, unknown>>;
	readonly events: ReadonlyMap<string, UniversalEventPriority>;
	readonly visibility: 'visible' | 'hidden';
	readonly children: FirstScreenNode[];
}

interface FirstScreenRange {
	kind: 'range';
	key: UniversalKey | null;
	id: number;
	readonly children: FirstScreenNode[];
	readonly componentScope?: true;
	readonly templateProgram?: FirstScreenProgramTemplate;
}

/**
 * A compiled main-thread program, claiming its first screen without describing
 * it (issue #163).
 *
 * The other two kinds are descriptions: a walk builds them, a second walk turns
 * them into paint. A program is the paint — straight-line compiled code that
 * drives the element API — so there is nothing here to walk. What this node
 * holds is the part of a first screen that is *not* painting and still has to
 * agree with the background: the IDs the program's hosts take, the listener
 * bindings its event sites announce, and the keyed ranges it leaves for members
 * this renderer materializes normally.
 *
 * `values` is the component's own value array rather than a copy of the
 * arguments the create function will take. Resolving those is the applier's
 * business (C2d) and copying them here would allocate per instance for a
 * consumer that does not exist yet.
 */
interface FirstScreenProgram {
	kind: 'program';
	key: UniversalKey | null;
	id: number;
	/** IDs the program's hosts took, in program order. Filled by `assignIds`. */
	ids: number[];
	readonly plan: UniversalProgramPlan;
	readonly values: readonly unknown[];
	readonly visibility: 'visible' | 'hidden';
	/**
	 * Every range's members, concatenated in `plan.ranges` order, with `spans`
	 * saying how many belong to each.
	 *
	 * Flat rather than a list per range because a range hole is not a node: the
	 * interpreted arm splices a hole's members straight into its parent and mints
	 * nothing for the hole itself, so a wrapper here would take an ID the other
	 * arm never takes and shift every node after it. Keeping the flat array named
	 * `children` is also what lets the walks that do not care about programs go on
	 * not caring.
	 */
	readonly children: FirstScreenNode[];
	/** How many of `children` belong to each declared range, in order. */
	readonly spans: number[];
	/**
	 * The string this render is handing each declared range to paint, or
	 * `undefined` for a hole it is filling normally — one entry per range, in
	 * `plan.ranges` order.
	 *
	 * A hole holding a string is a `#text` either way; the only question is
	 * which arm makes it. Answering it here rather than in the walk is what lets
	 * the walk skip the node entirely: an entry that is a string has no members
	 * in `children` and a `spans` of zero, and the create function is handed the
	 * string instead. An empty `@for` also has a `spans` of zero, which is why
	 * this array rather than that count is what says who paints.
	 */
	readonly texts: readonly (string | undefined)[];
	/**
	 * The ID each range the program paints took, in `plan.ranges` order, and
	 * nothing at a hole this render fills itself. Filled by `assignIds`.
	 *
	 * A painted hole has no member to carry its ID, and the ID still has to be
	 * minted: the interpreted arm numbers that node where the hole sits, so
	 * skipping it would shift every ID after it and make the two arms disagree
	 * about a subtree neither can describe.
	 */
	rangeIds: (number | undefined)[];
	/**
	 * Where this program's own announcements begin in the envelope's event list,
	 * and how many of them there are. Filled by `collectFirstScreenEvents`.
	 *
	 * A program's sites are announced in one contiguous pass in site order, so
	 * the applier can read a site's listener at a position in that run instead of
	 * searching the whole announcement for the host and then that host's list for
	 * the type — a search whose cost is the page's, paid once per site per row, to
	 * recover an order this walk already had (issue #163 C18).
	 *
	 * The count is carried too, because the run is shorter than the site list
	 * whenever a handler prop came through undefined, and only the count says
	 * where it ends.
	 */
	eventsAt: number;
	eventsCount: number;
}

type FirstScreenNode = FirstScreenHost | FirstScreenRange | FirstScreenProgram;

interface FirstScreenProgramValueSite {
	readonly slot: number;
	readonly text: boolean;
}

interface FirstScreenCompiledProgram {
	readonly wire: UniversalHostTemplateProgram;
	readonly values: readonly FirstScreenProgramValueSite[];
	readonly eventSlots: readonly number[];
}

interface FirstScreenProgramTemplate {
	readonly root: FirstScreenHost;
	readonly program: UniversalHostTemplateProgram;
	readonly values: readonly UniversalHostTemplateProgramValue[];
	firstListenerId: number | null;
	/**
	 * Where this row's bindings start in the first-screen envelope, or `null`
	 * until the event walk has reached it.
	 *
	 * The envelope is the one place listener identity is assigned, so the staged
	 * batch reads its `event` commands back out of it rather than numbering a
	 * second time. A template range is the one run of that array a batch must
	 * *not* replay — the `mount-template-range` command binds those listeners
	 * itself — and this is the run.
	 */
	eventsAt: number | null;
}

interface FirstScreenAttempt {
	owner: FirstScreenOwner;
	nextId: number;
	nextListener: number;
	nextUniversalId: number;
	/**
	 * How many compiled programs this first screen contains.
	 *
	 * The command batch is built lazily and only for a caller that wants one, so
	 * this is counted on the walk that has to visit every node anyway rather than
	 * discovered by a second walk that would cost every program-free first screen
	 * the same as a program-bearing one.
	 */
	programs: number;
}

interface TrackedThenable<T = unknown> extends PromiseLike<T> {
	status?: 'pending' | 'fulfilled' | 'rejected';
	value?: T;
	reason?: unknown;
}

class FirstScreenSuspense {
	constructor(readonly thenable: PromiseLike<unknown>) {}
}

let CURRENT_ATTEMPT: FirstScreenAttempt | null = null;
let NEXT_HOOK_SLOT = 0;
let FIRST_SCREEN_WARM_DEPTH = 0;
const SLOT_STACK: unknown[] = [];
const ACTIVE_FIRST_SCREEN_WARM_PLANS: Array<() => void> = [];
const FIRST_SCREEN_TEMPLATE_PROGRAMS = new WeakMap<
	UniversalPlan,
	FirstScreenCompiledProgram | null
>();

function currentAttempt(): FirstScreenAttempt {
	if (CURRENT_ATTEMPT === null) {
		throw new Error('Lynx first-screen hooks may only run while a component is rendering.');
	}
	return CURRENT_ATTEMPT;
}

function currentOwner(): FirstScreenOwner {
	return currentAttempt().owner;
}

function withOwner<T>(owner: FirstScreenOwner, render: () => T): T {
	const attempt = currentAttempt();
	const previous = attempt.owner;
	attempt.owner = owner;
	try {
		return render();
	} finally {
		attempt.owner = previous;
	}
}

function childOwner(
	parent: FirstScreenOwner,
	contexts: Map<UniversalContext<any>, unknown> | null = null,
	visibility: 'visible' | 'hidden' = parent.visibility,
): FirstScreenOwner {
	return { parent, contexts, visibility };
}

function assertRenderer(renderer: string): void {
	if (renderer !== 'lynx') {
		throw new Error(
			`Lynx first-screen renderer cannot evaluate renderer ${JSON.stringify(renderer)}.`,
		);
	}
}

function freezePlanNode(node: UniversalPlanNode): UniversalPlanNode {
	if (node.kind === 'template') {
		if (typeof node.create !== 'function' || !Array.isArray(node.slots)) {
			throw new TypeError(
				'A universal template plan requires a create function and a slots array.',
			);
		}
		return Object.freeze({
			kind: 'template',
			slots: Object.freeze([...node.slots]),
			create: node.create,
		});
	}
	if (node.kind === 'program') {
		if (typeof node.bind !== 'function' || !Number.isSafeInteger(node.nodes) || node.nodes < 0) {
			throw new TypeError(
				'A compiled main-thread program plan requires a bind function and a node count.',
			);
		}
		// A site naming a node the program does not make would be read against the
		// ID table this renderer fills in, come back `undefined`, and be announced
		// to the background as a listener bound to no host — a tap routed nowhere,
		// with nothing red. Freezing happens once per plan at module scope, so this
		// is the one place the check is free.
		//
		// `(node, type)` naming at most one site is the second half of the same
		// statement, and the half a consumer's addressing rests on: this renderer
		// announces a program's sites in one contiguous pass in site order, and the
		// applier reads each site's listener at a position in that run rather than
		// searching for it. Two sites sharing a node and a type would make one
		// announcement answer to both, so the second listener would be announced to
		// the background and bound to nothing here — the same tap routed nowhere,
		// arrived at from the other direction. The compiler already refuses to emit
		// one — `prepareUniversalTemplateProgram` rejects the whole program — so
		// this is that guarantee restated where the runtime can see it, for the
		// plans that do not come from it.
		const bound = new Set<string>();
		let previousSiteNode = -1;
		for (const site of node.events) {
			if (!Number.isInteger(site.node) || site.node < 0 || site.node >= node.nodes) {
				throw new TypeError(
					`A compiled main-thread program binds an event on node ${site.node}, which is not one of its ${node.nodes} nodes.`,
				);
			}
			// Sites in node order is the third guarantee the compiler already
			// gives — `prepareUniversalTemplateProgram` pushes them in pre-order —
			// restated here for plans that do not come from it. The announcement
			// walk announces sites at their host's merged position and the mount's
			// run cursor claims them in that same ascending order, so a plan whose
			// sites go backwards would leave the earlier site unclaimed and fault
			// the launch after the paint; refused here, it fails the build of the
			// plan instead.
			if (site.node < previousSiteNode) {
				throw new TypeError(
					`A compiled main-thread program declares its event sites out of node order: node ${site.node} after node ${previousSiteNode}.`,
				);
			}
			previousSiteNode = site.node;
			const key = `${site.node}\u0000${site.type}`;
			if (bound.has(key)) {
				throw new TypeError(
					`A compiled main-thread program binds two events of type ${JSON.stringify(site.type)} on node ${site.node}; a node carries at most one listener per type.`,
				);
			}
			bound.add(key);
			// The third thing a site declares, and until now the only one nothing
			// stood behind but a per-instance assert chain (issue #215 D6). A
			// priority outside the three the dispatcher knows encodes into a token
			// the host accepts and the background then cannot decode: the tap
			// reaches nothing, which is the same failure the two checks above
			// refuse, arrived at from a third direction. `emit-main-thread-program`
			// refuses one at build; this is that refusal restated once per plan,
			// for the plans that do not come from it.
			//
			// Read through `unknown` because that is the honest type of the input:
			// this function exists for plans it did not build.
			const priority: unknown = site.priority;
			if (priority !== 'discrete' && priority !== 'continuous' && priority !== 'default') {
				throw new TypeError(
					`A compiled main-thread program binds an event on node ${site.node} at priority ${JSON.stringify(site.priority)}; a site is discrete, continuous, or default.`,
				);
			}
		}
		// The same for a range's declared position: one outside the program's own
		// pre-order never matches, so its members would be numbered after the
		// program instead of where the hole was, and every ID from there on would
		// disagree with the encoding this one has to be interchangeable with.
		const positions = node.nodes + node.ranges.length;
		for (const declared of node.ranges) {
			if (!Number.isInteger(declared.id) || declared.id < 0 || declared.id >= positions) {
				throw new TypeError(
					`A compiled main-thread program declares a keyed range at position ${declared.id}, which is not one of its ${positions} positions.`,
				);
			}
		}
		return Object.freeze({
			kind: 'program',
			slots: Object.freeze([...node.slots]),
			nodes: node.nodes,
			values: Object.freeze([...node.values]),
			events: Object.freeze(node.events.map((event) => Object.freeze({ ...event }))),
			ranges: Object.freeze(node.ranges.map((range) => Object.freeze({ ...range }))),
			bind: node.bind,
		});
	}
	if (node.kind === 'host') {
		return Object.freeze({
			kind: 'host',
			type: node.type,
			...(node.props === undefined ? null : { props: Object.freeze({ ...node.props }) }),
			...(node.bindings === undefined
				? null
				: {
						bindings: Object.freeze(
							node.bindings.map(([name, slot]) => Object.freeze([name, slot] as const)),
						),
					}),
			...(node.propsSlot === undefined ? null : { propsSlot: node.propsSlot }),
			children: Object.freeze((node.children || []).map(freezePlanNode)),
		});
	}
	if (node.kind === 'range') {
		return Object.freeze({
			kind: 'range',
			children: Object.freeze(node.children.map(freezePlanNode)),
		});
	}
	if (node.kind === 'slot') return Object.freeze({ kind: 'slot', slot: node.slot });
	if (node.kind === 'component') {
		return Object.freeze({
			kind: 'component',
			renderer: node.renderer,
			...(node.component === undefined ? null : { component: node.component }),
			...(node.componentSlot === undefined ? null : { componentSlot: node.componentSlot }),
			...(node.propsSlot === undefined ? null : { propsSlot: node.propsSlot }),
			...(node.keySlot === undefined ? null : { keySlot: node.keySlot }),
			children: Object.freeze((node.children || []).map(freezePlanNode)),
		});
	}
	if (node.kind === 'if') {
		return Object.freeze({
			kind: 'if',
			conditionSlot: node.conditionSlot,
			then: freezePlanNode(node.then),
			...(node.else === undefined ? null : { else: freezePlanNode(node.else) }),
		});
	}
	if (node.kind === 'switch') {
		return Object.freeze({
			kind: 'switch',
			valueSlot: node.valueSlot,
			cases: Object.freeze(
				node.cases.map(([value, child]) => Object.freeze([value, freezePlanNode(child)] as const)),
			),
			...(node.default === undefined ? null : { default: freezePlanNode(node.default) }),
		});
	}
	if (node.kind === 'text') {
		return Object.freeze({
			kind: 'text',
			...(node.value === undefined ? null : { value: node.value }),
			...(node.slot === undefined ? null : { slot: node.slot }),
		});
	}
	// `text` used to own this return unguarded, so a kind this renderer could
	// not render became a text node carrying neither a value nor a slot: the
	// first screen painted an empty `#text` where the content belonged, and
	// nothing in the batch said the plan had not been understood.
	//
	// Every branch above narrowed `node` away, so widening it back is what lets
	// the refusal name what it refused. Reading the kind on the throw path keeps
	// it off the freeze walk, which components with children re-enter per render.
	throw new TypeError(
		`Unsupported universal plan node kind ${JSON.stringify((node as UniversalPlanNode).kind)}.`,
	);
}

export function universalPlan(renderer: string, root: UniversalPlanNode): UniversalPlan {
	assertRenderer(renderer);
	return Object.freeze({
		$$kind: UNIVERSAL_PLAN,
		renderer,
		root: freezePlanNode(root),
	}) as unknown as UniversalPlan;
}

export function universalValue(
	plan: UniversalPlan,
	values: readonly unknown[] = [],
	key: UniversalKey | null = null,
): UniversalRenderable {
	if ((plan as { $$kind?: unknown }).$$kind !== UNIVERSAL_PLAN) {
		throw new TypeError('universalValue expected a universal plan.');
	}
	return { $$kind: UNIVERSAL_VALUE, plan, values, key } as unknown as UniversalRenderable;
}

export function universalKey(key: UniversalKey, value: UniversalRenderable): UniversalRenderable {
	if ((value as { $$kind?: unknown }).$$kind === UNIVERSAL_VALUE) {
		return { ...(value as PlanValue), key } as UniversalRenderable;
	}
	return { $$kind: UNIVERSAL_KEYED, key, value } as unknown as UniversalRenderable;
}

export function universalList<T>(
	items: Iterable<T>,
	render: (item: T, index: number) => UniversalRenderable,
	empty?: UniversalRenderable,
): UniversalRenderable {
	const values: UniversalRenderable[] = [];
	let index = 0;
	for (const item of items) values.push(render(item, index++));
	return { $$kind: UNIVERSAL_LIST, values, ...(values.length === 0 ? { empty } : null) } as never;
}

function defineProtoProp(props: Record<PropertyKey, unknown>, value: unknown): void {
	Object.defineProperty(props, '__proto__', {
		configurable: true,
		enumerable: true,
		value,
		writable: true,
	});
}

function assignSpread(
	props: Record<PropertyKey, unknown>,
	value: unknown,
	canonicalizeHostClass: boolean,
): void {
	if (value == null) return;
	const source = Object(value) as Record<PropertyKey, unknown>;
	for (const key of Reflect.ownKeys(source)) {
		if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
		if (key === '__proto__') defineProtoProp(props, source[key]);
		else if (canonicalizeHostClass && key === 'className') props.class = source[key];
		else props[key] = source[key];
	}
}

export function universalProps(
	entries: readonly UniversalPropEntry[],
	children: unknown = NO_CHILDREN,
	canonicalizeHostClass = false,
	compilerOwnedRecord = false,
): PropsValue {
	if (compilerOwnedRecord) {
		return {
			$$kind: UNIVERSAL_PROPS,
			props: Object.freeze(entries as unknown as Record<string, unknown>),
			key: null,
			hasKey: false,
			hasChildren: false,
		};
	}
	const props: Record<string, unknown> = {};
	for (const entry of entries) {
		if (entry[0] === 'spread') {
			assignSpread(props, entry[1], canonicalizeHostClass);
			continue;
		}
		const name = canonicalizeHostClass && entry[1] === 'className' ? 'class' : entry[1];
		if (name === '__proto__') defineProtoProp(props, entry[2]);
		else props[name] = entry[2];
	}
	if (children !== NO_CHILDREN) props.children = children;
	const hasKey = Object.prototype.hasOwnProperty.call(props, 'key');
	const key = hasKey ? props.key : null;
	if (hasKey) delete props.key;
	return {
		$$kind: UNIVERSAL_PROPS,
		props: Object.freeze(props),
		key,
		hasKey,
		hasChildren: Object.prototype.hasOwnProperty.call(props, 'children'),
	};
}

function normalizeProps(value: unknown): PropsValue {
	if ((value as { $$kind?: unknown })?.$$kind === UNIVERSAL_PROPS) return value as PropsValue;
	return universalProps(value == null ? [] : [['spread', value]]);
}

export function universalComponent(
	renderer: string,
	component: UniversalComponent<any>,
	props: PropsValue | Readonly<Record<string, unknown>> | null = null,
	key: unknown = NO_KEY,
): UniversalRenderable {
	assertRenderer(renderer);
	const normalized = normalizeProps(props);
	return {
		$$kind: UNIVERSAL_COMPONENT_VALUE,
		renderer,
		component,
		props: normalized,
		key: key === NO_KEY ? normalized.key : key,
		hasKey: key !== NO_KEY || normalized.hasKey,
	} as never;
}

export function universalChildren(
	renderer: string,
	render: () => UniversalRenderable,
): UniversalRenderable {
	assertRenderer(renderer);
	return { $$kind: UNIVERSAL_CHILDREN, renderer, render } as never;
}

export function universalIf(
	condition: unknown,
	then: () => UniversalRenderable,
	otherwise: (() => UniversalRenderable) | null = null,
): UniversalRenderable {
	return { $$kind: UNIVERSAL_IF, condition: !!condition, then, else: otherwise } as never;
}

export function universalSwitch(
	value: unknown,
	cases: readonly (readonly [unknown, () => UniversalRenderable])[],
	defaultValue: (() => UniversalRenderable) | null = null,
): UniversalRenderable {
	return { $$kind: UNIVERSAL_SWITCH, value, cases, default: defaultValue } as never;
}

export function universalFor<T>(
	items: Iterable<T>,
	key: (item: T, index: number) => UniversalKey,
	render: (item: T, index: number) => UniversalRenderable,
	empty: (() => UniversalRenderable) | null = null,
	ownerless = false,
	compact = false,
	_hostComponent?: UniversalComponent<any> | true,
	_leafPlan?: UniversalPlan,
	_leafSignature?: string,
	componentScope = false,
): UniversalRenderable {
	return {
		$$kind: UNIVERSAL_FOR,
		items,
		key,
		render,
		empty,
		ownerless,
		compact,
		...(componentScope ? { componentScope: true } : null),
	} as never;
}

export function universalTry(
	body: () => UniversalRenderable,
	pending: (() => UniversalRenderable) | null = null,
	catchBody: ((error: unknown, reset: () => void) => UniversalRenderable) | null = null,
): UniversalRenderable {
	return { $$kind: UNIVERSAL_TRY, body, pending, catch: catchBody } as never;
}

export function universalContext<T>(
	context: UniversalContext<T>,
	value: T,
	children: UniversalRenderable | (() => UniversalRenderable),
): UniversalRenderable {
	return { $$kind: UNIVERSAL_CONTEXT, context, value, children } as never;
}

export function universalActivity(
	mode: 'visible' | 'hidden' | string,
	body: () => UniversalRenderable,
): UniversalRenderable {
	if (mode !== 'visible' && mode !== 'hidden') {
		throw new TypeError(`Universal Activity mode must be "visible" or "hidden".`);
	}
	return { $$kind: UNIVERSAL_ACTIVITY, mode, body } as never;
}

export function defineUniversalComponent<P>(
	renderer: string,
	render: (props: P, context: UniversalRenderContext) => UniversalRenderable,
	metadata?: { module?: string },
): UniversalComponent<P> {
	assertRenderer(renderer);
	Object.defineProperty(render, UNIVERSAL_COMPONENT, {
		configurable: false,
		enumerable: false,
		value: Object.freeze({ id: renderer, module: metadata?.module, target: 'universal' }),
	});
	return render as UniversalComponent<P>;
}

/** Compiler sentinel replacing an ordinary background event expression. */
export const firstScreenEvent = FIRST_SCREEN_EVENT;

function componentMetadata(component: UniversalComponent<any>): {
	readonly id?: unknown;
	readonly module?: string;
} {
	const metadata = (component as unknown as Record<PropertyKey, unknown>)[UNIVERSAL_COMPONENT] as
		{ id?: unknown; module?: string } | undefined;
	if (metadata !== undefined) return metadata;
	if ((component as any)?.[LAZY_COMPONENT] === true) return FIRST_SCREEN_LAZY_METADATA;
	throw new LynxFirstScreenRefusalError(
		'Lynx first-screen rendering requires a compiled Lynx component.',
	);
}

export function hmrUniversalComponent<P>(
	renderer: string,
	component: UniversalComponent<P>,
): UniversalComponent<P> {
	assertRenderer(renderer);
	const metadata = (component as unknown as Record<PropertyKey, unknown>)[UNIVERSAL_COMPONENT] as
		{ id?: unknown; module?: string } | undefined;
	if (metadata?.id !== renderer) {
		throw new Error(
			`Universal HMR renderer mismatch: wrapper ${JSON.stringify(renderer)} cannot own ${JSON.stringify(metadata?.id)}.`,
		);
	}
	const state: {
		component: UniversalComponent<P>;
		update(incoming: UniversalComponent<P>): void;
	} = {
		component,
		update(incoming) {
			const incomingState = (incoming as unknown as Record<PropertyKey, unknown>)[UNIVERSAL_HMR] as
				{ component?: UniversalComponent<P> } | undefined;
			const next = incomingState?.component ?? incoming;
			const nextMetadata = (next as unknown as Record<PropertyKey, unknown>)[
				UNIVERSAL_COMPONENT
			] as { id?: unknown } | undefined;
			if (nextMetadata?.id !== renderer) {
				throw new Error(
					`Universal HMR renderer mismatch: wrapper ${JSON.stringify(renderer)} cannot accept ${JSON.stringify(nextMetadata?.id)}.`,
				);
			}
			state.component = next;
			if ((next as any).__warm === undefined) delete (wrapper as any).__warm;
			else (wrapper as any).__warm = (next as any).__warm;
		},
	};
	const wrapper = defineUniversalComponent<P>(
		renderer,
		(props, context) => state.component(props, context),
		{ module: metadata.module },
	);
	Object.defineProperty(wrapper, UNIVERSAL_HMR, { value: state });
	if ((component as any).__warm !== undefined) (wrapper as any).__warm = (component as any).__warm;
	return wrapper;
}

function firstScreenLazyProps(
	component: UniversalComponent<any>,
	props: any,
): Readonly<Record<string, unknown>> {
	const defaults = (component as any).defaultProps;
	if (defaults == null || typeof defaults !== 'object') return props;
	let resolved = props;
	for (const key of Object.keys(defaults)) {
		if (props == null || props[key] === undefined) {
			if (resolved === props) resolved = props == null ? {} : { ...props };
			resolved[key] = defaults[key];
		}
	}
	return resolved;
}

function resolveFirstScreenLazyModule(module: unknown): UniversalComponent<any> {
	let component = module;
	if (module != null) {
		const defaultExport = (module as { readonly default?: unknown }).default;
		if (defaultExport !== undefined) component = defaultExport;
	}
	if (typeof component !== 'function' || (component as any)[LAZY_COMPONENT] === true) {
		throw new Error(
			`Universal lazy expected a component function or module default, got ${
				(component as any)?.[LAZY_COMPONENT] === true ? 'a lazy component' : typeof component
			}.`,
		);
	}
	const resolved = component as UniversalComponent<any>;
	const metadata = componentMetadata(resolved);
	if (metadata.id !== 'lynx') {
		throw new Error(
			`Universal lazy for renderer "lynx" cannot render component ${JSON.stringify(metadata.id)}.`,
		);
	}
	return resolved;
}

/**
 * Main-thread mirror of universal lazy loading. A pending chunk can only commit
 * an authored `@pending` arm because the native first-screen pass is one-shot;
 * the retained background root owns later reveal/error updates after adoption.
 */
/* @__NO_SIDE_EFFECTS__ */
export function lazy<C extends UniversalComponent<any>>(
	load: () => PromiseLike<{ default: C } | C>,
): C {
	let status: 'uninitialized' | 'pending' | 'fulfilled' | 'rejected' = 'uninitialized';
	let result: unknown = null;
	let thenable: TrackedThenable<{ default: C } | C> | null = null;

	const initialize = (): void => {
		if (status !== 'uninitialized') return;
		try {
			const loaded = load();
			thenable = loaded as TrackedThenable<{ default: C } | C>;
			loaded.then(
				(module) => {
					if (status === 'uninitialized' || status === 'pending') {
						result = module;
						status = 'fulfilled';
					}
				},
				(error) => {
					if (status === 'uninitialized' || status === 'pending') {
						result = error;
						status = 'rejected';
					}
				},
			);
		} catch (error) {
			if (status === 'uninitialized') thenable = null;
			throw error;
		}
		if (status === 'uninitialized') status = 'pending';
	};

	const wrapper = ((props: any, context: UniversalRenderContext): UniversalRenderable => {
		if (status === 'uninitialized') initialize();
		let settledStatus = status as 'pending' | 'fulfilled' | 'rejected';
		if (settledStatus === 'fulfilled') {
			const component = resolveFirstScreenLazyModule(result);
			return component(firstScreenLazyProps(component, props), context);
		}
		if (settledStatus === 'rejected') throw result;
		useBatch([thenable!]);
		settledStatus = status as 'pending' | 'fulfilled' | 'rejected';
		if (settledStatus === 'fulfilled') {
			const component = resolveFirstScreenLazyModule(result);
			return component(firstScreenLazyProps(component, props), context);
		}
		if (settledStatus === 'rejected') throw result;
		throw new FirstScreenSuspense(thenable!);
	}) as UniversalComponent<any>;
	Object.defineProperties(wrapper, {
		[LAZY_COMPONENT]: { value: true },
		__warm: { value: initialize },
	});
	return wrapper as C;
}

export function rendererRegion(): never {
	throw new Error('Lynx first-screen rendering does not support cross-renderer regions.');
}

function componentContext(): UniversalRenderContext {
	return {
		renderer: 'lynx',
		readContext: useContext,
		insertionEffect() {},
		layoutEffect() {},
		effect() {},
	};
}

function normalizeKey(value: unknown): UniversalKey | null {
	return typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'symbol' ||
		typeof value === 'bigint'
		? value
		: null;
}

const DISCRETE_EVENTS: ReadonlySet<string> = new Set([
	'blur',
	'change',
	'focus',
	'input',
	'longpress',
	'longtap',
	'tap',
	'touchend',
	'touchstart',
]);
const CONTINUOUS_EVENTS: ReadonlySet<string> = new Set([
	'layoutchange',
	'scroll',
	'touchmove',
	'wheel',
]);
const EVENT_PROP = /^(?:capture-bind|capture-catch|global-bind|bind|catch)([A-Za-z]+)$/;

function eventPriority(name: string): UniversalEventPriority | null {
	const match = EVENT_PROP.exec(name);
	if (match === null) return null;
	const event = match[1];
	return DISCRETE_EVENTS.has(event)
		? 'discrete'
		: CONTINUOUS_EVENTS.has(event)
			? 'continuous'
			: 'default';
}

/**
 * Read only. Every host that binds nothing shares this, so nothing may write
 * to it; the one writer, `TEMPLATE_ENV.e`, only ever holds a map `h` made for
 * that host.
 */
const NO_FIRST_SCREEN_EVENTS: ReadonlyMap<string, UniversalEventPriority> = new Map();

/**
 * The placeholder a program's two ID tables hold until `assignIds` fills them
 * in — the one for its own nodes and the one for the ranges it paints.
 *
 * Shared and empty rather than a fresh `new Array(plan.nodes)`: rendering and
 * numbering are two passes, and allocating the real table in the first one would
 * hand the second an array it has to overwrite anyway. A program that somehow
 * reached a mount unnumbered is refused there for carrying the wrong number of
 * IDs, which is a better failure than a table of zeros.
 */
const EMPTY_PROGRAM_IDS: number[] = [];
function isTemplateProgramValue(value: unknown): value is UniversalHostTemplateProgramValue {
	return (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	);
}

/**
 * The one thing a probe value may be asked to do is arrive at `p`/`e`/`s`
 * unchanged. A create function the `target: 'lynx'` backend emits passes each
 * `values[i]` straight through, so that is enough to recover which slot feeds
 * which binding — but nothing in the ABI *promises* straight-through, and a
 * value that had been concatenated or coerced on the way would arrive as an
 * ordinary string and compile into a program that is confidently wrong for
 * every row after the first. So the probe refuses to be a primitive: any use
 * beyond identity throws, `compiledFirstScreenCreateProgram` catches it, and the
 * row falls back to per-node commands instead of to a silent lie.
 */
class FirstScreenProgramProbe {
	constructor(readonly slot: number) {
		Object.freeze(this);
	}
	[Symbol.toPrimitive](): never {
		throw new TypeError('Octane Lynx first-screen program probe was used as a value.');
	}
	toString(): never {
		throw new TypeError('Octane Lynx first-screen program probe was used as a value.');
	}
	valueOf(): never {
		throw new TypeError('Octane Lynx first-screen program probe was used as a value.');
	}
}

/**
 * Compile a create-function row into the same wire program the descriptive
 * encoding compiles to, by running the create function once against a recording
 * env.
 *
 * Upstream's first-screen row compaction (#765, arriving with issue #227) reads
 * the plan: it walks `{kind:'host'}` nodes and turns them into program nodes.
 * The `target: 'lynx'` backend has no such tree — an eligible host-only template
 * lowers to straight-line `env.h/p/e/t/s/a` calls (#163 L1), which is the whole
 * point of that encoding and the reason it is fast. Reading the plan therefore
 * compacts a row at `target: 'universal'` and declines the identical row at
 * `target: 'lynx'`, which would make the encoding observable in the staged batch
 * — exactly what #63 promised it never is.
 *
 * So the shape is recovered the only way it exists here: by running `create`.
 * The create function is called once per plan, cached against the plan like its
 * descriptive twin, and never with real values — the probes stand in for them,
 * and where each probe lands is the slot table the row's values are drawn
 * through afterwards.
 */
function compiledFirstScreenCreateProgram(
	root: Extract<UniversalPlanNode, { kind: 'template' }>,
): FirstScreenCompiledProgram | null {
	const nodes: Array<{
		type: string;
		parent: number;
		props: Record<string, UniversalHostTemplateProgramValue>;
		bindings: UniversalHostTemplateProgramBinding[];
		named: Set<string>;
	}> = [];
	const events: UniversalHostTemplateProgramEvent[] = [];
	const values: FirstScreenProgramValueSite[] = [];
	const eventSlots: number[] = [];
	let refused = false;
	const refuse = (): null => {
		refused = true;
		return null;
	};
	const forbiddenProp = (name: string): boolean =>
		name === 'key' ||
		name === 'ref' ||
		name === 'children' ||
		name === '__proto__' ||
		name === 'hidden' ||
		name === 'attach' ||
		name === 'onUpdate' ||
		name.startsWith('main-thread:');
	// Indices, not the records: the create function holds whatever `h` returns
	// and hands it back to `p`/`e`/`a`, so the handle has to survive that round
	// trip. A boxed index is the cheapest thing that does and cannot be confused
	// with a probe.
	const handle = (index: number): { index: number } => ({ index });
	const at = (node: unknown): number => {
		const index = (node as { index?: unknown } | null)?.index;
		if (typeof index !== 'number' || index < 0 || index >= nodes.length) {
			refuse();
			return -1;
		}
		return index;
	};
	const env: UniversalTemplateEnv<{ index: number }> = {
		h(type: string) {
			if (type.length === 0 || type === 'list' || type === 'list-item') refuse();
			const index = nodes.length;
			nodes.push({ type, parent: -1, props: {}, bindings: [], named: new Set() });
			return handle(index);
		},
		p(node, name, value) {
			const index = at(node);
			if (index < 0) return;
			const record = nodes[index]!;
			if (forbiddenProp(name) || eventPriority(name) !== null || record.named.has(name)) {
				refuse();
				return;
			}
			record.named.add(name);
			if (value instanceof FirstScreenProgramProbe) {
				const valueIndex = values.length;
				values.push(Object.freeze({ slot: value.slot, text: false }));
				record.bindings.push(Object.freeze({ name, valueIndex }));
				return;
			}
			if (!isTemplateProgramValue(value)) refuse();
			else record.props[name] = value;
		},
		e(node, name, value) {
			const index = at(node);
			if (index < 0) return;
			const priority = eventPriority(name);
			// Node 0 is the range's own root, whose listener IDs the mount derives
			// from the range rather than from the program; the descriptive compiler
			// declines the same site for the same reason.
			if (priority === null || index === 0 || !(value instanceof FirstScreenProgramProbe)) {
				refuse();
				return;
			}
			events.push(Object.freeze({ node: index, type: name, priority }));
			eventSlots.push(value.slot);
		},
		t(node, value) {
			const index = at(node);
			if (index < 0) return;
			if (nodes[index]!.type !== 'text') {
				refuse();
				return;
			}
			nodes.push({
				type: '#text',
				parent: index,
				props: { value: String(value) },
				bindings: [],
				named: new Set(),
			});
		},
		s(node, value) {
			const index = at(node);
			if (index < 0) return;
			// A renderable hole under anything but a `<text>` is a subtree this
			// program cannot describe; the descriptive compiler declines it too.
			if (nodes[index]!.type !== 'text' || !(value instanceof FirstScreenProgramProbe)) {
				refuse();
				return;
			}
			const valueIndex = values.length;
			values.push(Object.freeze({ slot: value.slot, text: true }));
			nodes.push({
				type: '#text',
				parent: index,
				props: {},
				bindings: [Object.freeze({ name: 'value', valueIndex })],
				named: new Set(),
			});
		},
		a(parent, child) {
			const parentIndex = at(parent);
			const childIndex = at(child);
			if (parentIndex < 0 || childIndex < 0) return;
			// Each host is appended exactly once, and always under a parent created
			// before it — the create function builds in document order. Anything else
			// would put a node ahead of its parent in the wire array, which the mount
			// reads strictly forward.
			if (nodes[childIndex]!.parent !== -1 || parentIndex >= childIndex) refuse();
			else nodes[childIndex]!.parent = parentIndex;
		},
	};

	let rootIndex = -1;
	try {
		rootIndex = at(
			root.create(
				env,
				root.slots.map((_, slot) => new FirstScreenProgramProbe(slot)),
			),
		);
	} catch {
		return null;
	}
	// The root is the first host the create function makes, nothing else may be
	// parentless, and a program of one text node is not a row worth compacting.
	if (refused || rootIndex !== 0 || nodes.length === 0 || nodes[0]!.type === '#text') return null;
	for (let index = 1; index < nodes.length; index++) {
		if (nodes[index]!.parent === -1) return null;
	}
	return Object.freeze({
		wire: Object.freeze({
			nodes: Object.freeze(
				nodes.map((node) =>
					Object.freeze({
						type: node.type,
						parent: node.parent,
						props: Object.freeze(node.props),
						...(node.bindings.length === 0 ? null : { bindings: Object.freeze(node.bindings) }),
					}),
				),
			),
			events: Object.freeze(events),
		}),
		values: Object.freeze(values),
		eventSlots: Object.freeze(eventSlots),
	});
}

function compiledFirstScreenProgram(plan: UniversalPlan): FirstScreenCompiledProgram | null {
	const cached = FIRST_SCREEN_TEMPLATE_PROGRAMS.get(plan);
	if (cached !== undefined) return cached;
	if (plan.renderer !== 'lynx') {
		FIRST_SCREEN_TEMPLATE_PROGRAMS.set(plan, null);
		return null;
	}
	if (plan.root.kind === 'template') {
		const derived = compiledFirstScreenCreateProgram(plan.root);
		FIRST_SCREEN_TEMPLATE_PROGRAMS.set(plan, derived);
		return derived;
	}
	if (plan.root.kind !== 'host') {
		FIRST_SCREEN_TEMPLATE_PROGRAMS.set(plan, null);
		return null;
	}
	const nodes: UniversalHostTemplateProgramNode[] = [];
	const events: UniversalHostTemplateProgramEvent[] = [];
	const values: FirstScreenProgramValueSite[] = [];
	const eventSlots: number[] = [];
	const forbiddenProp = (name: string): boolean =>
		name === 'key' ||
		name === 'ref' ||
		name === 'children' ||
		name === '__proto__' ||
		name === 'hidden' ||
		name === 'attach' ||
		name === 'onUpdate' ||
		name.startsWith('main-thread:');
	const visit = (node: UniversalPlanNode, parent: number, parentType: string | null): boolean => {
		if (node.kind === 'slot' || node.kind === 'text') {
			if (parentType !== 'text') return false;
			const slot = node.kind === 'slot' ? node.slot : node.slot;
			if (slot === undefined) {
				nodes.push(
					Object.freeze({
						type: '#text',
						parent,
						props: Object.freeze({ value: String(node.kind === 'text' ? (node.value ?? '') : '') }),
					}),
				);
				return true;
			}
			const valueIndex = values.length;
			values.push(Object.freeze({ slot, text: true }));
			const binding: UniversalHostTemplateProgramBinding = Object.freeze({
				name: 'value',
				valueIndex,
			});
			nodes.push(
				Object.freeze({
					type: '#text',
					parent,
					props: Object.freeze({}),
					bindings: Object.freeze([binding]),
				}),
			);
			return true;
		}
		if (node.kind !== 'host' || node.propsSlot !== undefined) return false;
		if (node.type.length === 0 || node.type === 'list' || node.type === 'list-item') return false;

		const index = nodes.length;
		const bindingNames = new Set<string>();
		for (const [name] of node.bindings ?? []) {
			if (typeof name !== 'string' || bindingNames.has(name) || forbiddenProp(name)) return false;
			bindingNames.add(name);
		}
		const staticSource = node.props ?? {};
		if (hasOwnSymbolFields(staticSource)) return false;
		const staticProps: Record<string, UniversalHostTemplateProgramValue> = {};
		for (const name of Object.keys(staticSource)) {
			if (bindingNames.has(name)) continue;
			const value = staticSource[name];
			if (forbiddenProp(name) || eventPriority(name) !== null || !isTemplateProgramValue(value)) {
				return false;
			}
			if (name === '__proto__') defineProtoProp(staticProps, value);
			else staticProps[name] = value;
		}
		const bindings: UniversalHostTemplateProgramBinding[] = [];
		for (const [name, slot] of node.bindings ?? []) {
			const priority = eventPriority(name);
			if (priority !== null) {
				if (index === 0) return false;
				events.push(Object.freeze({ node: index, type: name, priority }));
				eventSlots.push(slot);
				continue;
			}
			const valueIndex = values.length;
			values.push(Object.freeze({ slot, text: false }));
			bindings.push(Object.freeze({ name, valueIndex }));
		}
		nodes.push(
			Object.freeze({
				type: node.type,
				parent,
				props: Object.freeze(staticProps),
				...(bindings.length === 0 ? null : { bindings: Object.freeze(bindings) }),
			}),
		);
		for (const child of node.children ?? []) {
			if (!visit(child, index, node.type)) return false;
		}
		return true;
	};
	const compiled = visit(plan.root, -1, null)
		? Object.freeze({
				wire: Object.freeze({ nodes: Object.freeze(nodes), events: Object.freeze(events) }),
				values: Object.freeze(values),
				eventSlots: Object.freeze(eventSlots),
			})
		: null;
	FIRST_SCREEN_TEMPLATE_PROGRAMS.set(plan, compiled);
	return compiled;
}

function prepareFirstScreenProgramValues(
	value: PlanValue,
	compiled: FirstScreenCompiledProgram,
): readonly UniversalHostTemplateProgramValue[] | null {
	for (const slot of compiled.eventSlots) {
		const event = value.values[slot];
		if (event !== FIRST_SCREEN_EVENT && typeof event !== 'function') return null;
	}
	const values: UniversalHostTemplateProgramValue[] = new Array(compiled.values.length);
	for (let index = 0; index < compiled.values.length; index++) {
		const site = compiled.values[index];
		const source = value.values[site.slot];
		if (site.text) {
			if (typeof source !== 'string' && typeof source !== 'number' && typeof source !== 'bigint') {
				return null;
			}
			values[index] = String(source);
		} else {
			if (!isTemplateProgramValue(source)) return null;
			values[index] = source;
		}
	}
	return Object.freeze(values);
}

function hostNode(
	type: string,
	rawProps: Readonly<Record<string, unknown>>,
	children: FirstScreenNode[],
): FirstScreenHost {
	// Copy the props we keep rather than spreading and then deleting the four
	// kinds we do not. `delete` on a fresh object drops it out of fast
	// properties for the rest of its life, and these objects live as long as
	// the first screen does: the applier reads them, and so does adoption
	// capture. One pass also folds in the event scan, which used to walk the
	// copy a second time.
	const props: Record<string, unknown> = {};
	let events: Map<string, UniversalEventPriority> | null = null;
	for (const name of Object.keys(rawProps)) {
		if (name === 'key' || name === 'ref' || name === 'children') continue;
		const value = rawProps[name];
		if (isLynxNativeResource(value)) {
			throw new TypeError(
				`Lynx first-screen rendering does not support native resource prop ${JSON.stringify(name)} on <${type}>; native resources are background-only.`,
			);
		}
		const priority = eventPriority(name);
		if (priority !== null) {
			// An event-named prop leaves the props bag whether or not it carries
			// something callable, which is what the spread-and-delete did too.
			if (value === FIRST_SCREEN_EVENT || typeof value === 'function') {
				(events ??= new Map()).set(name, priority);
			}
			continue;
		}
		props[name] = value;
	}
	const key = normalizeKey(rawProps.key);
	return {
		kind: 'host',
		key,
		id: 0,
		type,
		props: Object.freeze(props),
		events: events ?? NO_FIRST_SCREEN_EVENTS,
		visibility: currentOwner().visibility,
		children,
	};
}

/**
 * A raw text record, built without the generic host path.
 *
 * `#text` is the one host type whose props are fully known at the call site: a
 * string `value`, no key, no ref, no children, and no event-named prop. That is
 * the same shape `assertTextProps` enforces on the driver side, and it is why
 * the host driver's `create` already shortcuts raw text rather than planning a
 * patch for it. Going through `hostNode` would walk that one-key literal
 * looking for props it cannot contain and allocate an event map that stays
 * empty. Three of every seven hosts in the benchmark fixture are one of these.
 */
function textNode(value: string): FirstScreenHost {
	return {
		kind: 'host',
		key: null,
		id: 0,
		type: '#text',
		props: Object.freeze({ value }),
		events: NO_FIRST_SCREEN_EVENTS,
		visibility: currentOwner().visibility,
		children: [],
	};
}

function range(
	children: FirstScreenNode[],
	key: UniversalKey | null = null,
	componentScope = false,
	templateProgram?: FirstScreenProgramTemplate,
): FirstScreenRange {
	return {
		kind: 'range',
		key,
		id: 0,
		children,
		...(componentScope ? { componentScope: true } : null),
		...(templateProgram === undefined ? null : { templateProgram }),
	};
}

interface FirstScreenComponentResult {
	readonly value: UniversalRenderable;
	readonly nodes: FirstScreenNode[];
}

function renderComponentResult(
	component: UniversalComponent<any>,
	props: Readonly<Record<string, unknown>>,
): FirstScreenComponentResult {
	const metadata = componentMetadata(component);
	if (metadata !== FIRST_SCREEN_LAZY_METADATA && metadata.id !== 'lynx') {
		throw new LynxFirstScreenRefusalError(
			'Lynx first-screen rendering requires a compiled Lynx component.',
		);
	}
	const owner = childOwner(currentOwner());
	const warmPlanCheckpoint = ACTIVE_FIRST_SCREEN_WARM_PLANS.length;
	try {
		return withOwner(owner, () => {
			const value = component(props, componentContext());
			return { value, nodes: materialize(value, null) };
		});
	} finally {
		ACTIVE_FIRST_SCREEN_WARM_PLANS.length = warmPlanCheckpoint;
	}
}

/**
 * Renderer-owned env executing compiled template create functions
 * (docs/lynx-specialized-target-l0.md §3.2). This first-screen binding builds
 * the same `FirstScreenHost` records `renderPlanNode` produces — the compiler
 * guarantees names reaching `p`/`e` are statically known and pre-classified,
 * so the per-prop `key`/`ref`/event filtering of `hostNode` is not repeated.
 */
const TEMPLATE_ENV = Object.freeze({
	h(type: string): FirstScreenHost {
		return {
			kind: 'host',
			key: null,
			id: 0,
			type,
			props: {} as Record<string, unknown>,
			events: new Map<string, UniversalEventPriority>(),
			visibility: currentOwner().visibility,
			children: [],
		};
	},
	p(node: FirstScreenHost, name: string, value: unknown): void {
		if (isLynxNativeResource(value)) {
			throw new TypeError(
				`Lynx first-screen rendering does not support native resource prop ${JSON.stringify(name)} on <${node.type}>; native resources are background-only.`,
			);
		}
		(node.props as Record<string, unknown>)[name] = value;
	},
	e(node: FirstScreenHost, name: string, value: unknown): void {
		if (isLynxNativeResource(value)) {
			throw new TypeError(
				`Lynx first-screen rendering does not support native resource prop ${JSON.stringify(name)} on <${node.type}>; native resources are background-only.`,
			);
		}
		if (value !== FIRST_SCREEN_EVENT && typeof value !== 'function') return;
		const priority = eventPriority(name);
		if (priority !== null) (node.events as Map<string, UniversalEventPriority>).set(name, priority);
	},
	t(node: FirstScreenHost, value: string): void {
		node.children.push(textNode(String(value)));
	},
	s(node: FirstScreenHost, value: unknown): void {
		node.children.push(...materialize(value, null));
	},
	a(parent: FirstScreenHost, child: FirstScreenHost): void {
		parent.children.push(child);
	},
});

function freezeTemplateHostProps(node: FirstScreenNode): void {
	if (node.kind === 'host' && !Object.isFrozen(node.props)) Object.freeze(node.props);
	for (const child of node.children) freezeTemplateHostProps(child);
}

function renderTemplate(
	node: Extract<UniversalPlanNode, { kind: 'template' }>,
	values: readonly unknown[],
): FirstScreenNode[] {
	const root = node.create(TEMPLATE_ENV, values) as FirstScreenHost;
	freezeTemplateHostProps(root);
	return [root];
}

function renderComponent(
	component: UniversalComponent<any>,
	props: Readonly<Record<string, unknown>>,
): FirstScreenNode[] {
	return renderComponentResult(component, props).nodes;
}

function firstScreenProgramTemplate(
	value: UniversalRenderable,
	nodes: readonly FirstScreenNode[],
): FirstScreenProgramTemplate | undefined {
	const planValue = value as PlanValue;
	if (
		planValue?.$$kind !== UNIVERSAL_VALUE ||
		planValue.key !== null ||
		nodes.length !== 1 ||
		nodes[0].kind !== 'host'
	) {
		return undefined;
	}
	const compiled = compiledFirstScreenProgram(planValue.plan);
	if (compiled === null || compiled.wire.nodes.length === 0) return undefined;
	const values = prepareFirstScreenProgramValues(planValue, compiled);
	return values === null
		? undefined
		: { root: nodes[0], program: compiled.wire, values, firstListenerId: null, eventsAt: null };
}

function renderPlanNode(node: UniversalPlanNode, values: readonly unknown[]): FirstScreenNode[] {
	if (node.kind === 'template') return renderTemplate(node, values);
	if (node.kind === 'slot') return materialize(values[node.slot], null);
	if (node.kind === 'text') {
		return materialize(node.slot === undefined ? (node.value ?? '') : values[node.slot], null);
	}
	if (node.kind === 'range') {
		const children: FirstScreenNode[] = [];
		for (const child of node.children) children.push(...renderPlanNode(child, values));
		return [range(children)];
	}
	if (node.kind === 'component') {
		const component = node.component ?? (values[node.componentSlot!] as UniversalComponent<any>);
		let props =
			node.propsSlot === undefined ? universalProps([]) : normalizeProps(values[node.propsSlot]);
		if ((node.children || []).length !== 0) {
			const childPlan = universalPlan('lynx', { kind: 'range', children: node.children! });
			props = universalProps(
				[['spread', props.props]],
				universalChildren('lynx', () => universalValue(childPlan, values)),
			);
		}
		const rendered = renderComponent(component, props.props);
		return [
			range(rendered, normalizeKey(node.keySlot === undefined ? props.key : values[node.keySlot])),
		];
	}
	if (node.kind === 'if') {
		const selected = values[node.conditionSlot] ? node.then : node.else;
		return selected === undefined ? [] : [range(renderPlanNode(selected, values))];
	}
	if (node.kind === 'switch') {
		let selected = node.default;
		for (const entry of node.cases) {
			if (entry[0] === values[node.valueSlot]) {
				selected = entry[1];
				break;
			}
		}
		return selected === undefined ? [] : [range(renderPlanNode(selected, values))];
	}
	if (node.kind === 'program') {
		// A program paints itself, so there is no description to build. What is
		// built here is only what the program left open: the members of each
		// declared hole, whatever its plan slot turned out to hold. They are
		// ordinary renderables and go through the ordinary walk — that is the point
		// of a hole, and it is what will let a refused row (#163 C3) land in one.
		const attempt = currentAttempt();
		attempt.programs++;
		const children: FirstScreenNode[] = [];
		const spans: number[] = [];
		const texts: (string | undefined)[] = [];
		for (const declared of node.ranges) {
			const value = values[declared.slot];
			// The same test the create function makes, on the same value, spelled
			// the same way — it is the applier's own entry condition for a `#text`,
			// which throws rather than coerces on anything else, so the two arms
			// cannot disagree about a hole holding a string. `paintsText` is the
			// build's half of the answer: it says this program's create function
			// contains that test at all, which it does only where the host can hold
			// raw text. Everything else materializes exactly as it does today,
			// including a number or a bigint, which `materialize` renders as text
			// and no emission compiles.
			if (declared.paintsText === true && typeof value === 'string') {
				texts.push(value);
				spans.push(0);
				continue;
			}
			texts.push(undefined);
			const members = materialize(value, null);
			spans.push(members.length);
			for (const member of members) children.push(member);
		}
		return [
			{
				kind: 'program',
				key: null,
				id: 0,
				ids: EMPTY_PROGRAM_IDS,
				plan: node,
				values,
				visibility: currentOwner().visibility,
				children,
				spans,
				texts,
				rangeIds: EMPTY_PROGRAM_IDS,
				eventsAt: 0,
				eventsCount: 0,
			},
		];
	}
	// The union leaves only a host here, and the branch above is what makes that
	// true rather than a comment claiming it.
	const props: Record<string, unknown> = { ...(node.props || {}) };
	for (const binding of node.bindings || []) props[binding[0]] = values[binding[1]];
	if (node.propsSlot !== undefined)
		Object.assign(props, normalizeProps(values[node.propsSlot]).props);
	const dynamicChildren = props.children;
	const children: FirstScreenNode[] = [];
	if ((node.children || []).length !== 0) {
		for (const child of node.children!) children.push(...renderPlanNode(child, values));
	} else if (dynamicChildren !== undefined) {
		children.push(...materialize(dynamicChildren, null));
	}
	return [hostNode(node.type, props, children)];
}

function renderTry(value: Record<string, unknown>): FirstScreenNode[] {
	const attempt = currentAttempt();
	const universalIdCheckpoint = attempt.nextUniversalId;
	const warmPlanCheckpoint = ACTIVE_FIRST_SCREEN_WARM_PLANS.length;
	const owner = childOwner(currentOwner());
	return withOwner(owner, () => {
		try {
			const body = value.body as () => UniversalRenderable;
			return [range([range(materialize(body(), null))])];
		} catch (error) {
			ACTIVE_FIRST_SCREEN_WARM_PLANS.length = warmPlanCheckpoint;
			// The body is abandoned before pending/catch commits. Match the
			// background transaction by making its speculative useId allocations
			// available to whichever fallback becomes the first tree.
			attempt.nextUniversalId = universalIdCheckpoint;
			if (error instanceof FirstScreenSuspense) {
				const pending = value.pending as (() => UniversalRenderable) | null;
				if (pending === null) throw error;
				return [range([range(materialize(pending(), null))])];
			}
			const catchBody = value.catch as
				((error: unknown, reset: () => void) => UniversalRenderable) | null;
			if (catchBody === null) throw error;
			return [
				range([
					range(
						materialize(
							catchBody(error, () => {}),
							null,
						),
					),
				]),
			];
		} finally {
			ACTIVE_FIRST_SCREEN_WARM_PLANS.length = warmPlanCheckpoint;
		}
	});
}

function renderableKey(value: unknown): UniversalKey | null {
	const record = value as Record<string, unknown>;
	if (record?.$$kind === UNIVERSAL_VALUE) return (record as unknown as PlanValue).key;
	if (record?.$$kind === UNIVERSAL_KEYED) return normalizeKey(record.key);
	if (record?.$$kind === UNIVERSAL_COMPONENT_VALUE) {
		const component = record as unknown as ComponentValue;
		return component.hasKey ? normalizeKey(component.key) : null;
	}
	return null;
}

function materialize(value: unknown, key: UniversalKey | null): FirstScreenNode[] {
	if (value == null || value === false || value === true) return [];
	const record = value as Record<string, unknown>;
	if (record?.$$kind === UNIVERSAL_KEYED) {
		const rendered = materialize(record.value, normalizeKey(record.key));
		if (rendered.length === 1) rendered[0].key = normalizeKey(record.key);
		else return [range(rendered, normalizeKey(record.key))];
		return rendered;
	}
	if (record?.$$kind === UNIVERSAL_LIST) {
		const values = record.values as readonly unknown[];
		if (values.length === 0 && Object.prototype.hasOwnProperty.call(record, 'empty')) {
			return materialize(record.empty, null);
		}
		const output: FirstScreenNode[] = [];
		for (const child of values) output.push(...materialize(child, renderableKey(child)));
		return output;
	}
	if (record?.$$kind === UNIVERSAL_VALUE) {
		const planValue = value as PlanValue;
		assertRenderer(planValue.plan.renderer);
		const rendered = renderPlanNode(planValue.plan.root, planValue.values);
		const resolvedKey = key ?? planValue.key;
		if (resolvedKey !== null && rendered.length === 1) rendered[0].key = resolvedKey;
		else if (resolvedKey !== null) return [range(rendered, resolvedKey)];
		return rendered;
	}
	if (record?.$$kind === UNIVERSAL_COMPONENT_VALUE) {
		const component = value as ComponentValue;
		assertRenderer(component.renderer);
		return [
			range(
				renderComponent(component.component, component.props.props),
				component.hasKey ? normalizeKey(component.key) : key,
			),
		];
	}
	if (record?.$$kind === UNIVERSAL_CHILDREN) {
		assertRenderer(record.renderer as string);
		return materialize((record.render as () => UniversalRenderable)(), key);
	}
	if (record?.$$kind === UNIVERSAL_IF) {
		const body = record.condition ? record.then : record.else;
		return typeof body === 'function' ? [range(materialize(body(), null))] : [];
	}
	if (record?.$$kind === UNIVERSAL_SWITCH) {
		let selected = record.default as (() => UniversalRenderable) | null;
		for (const entry of record.cases as readonly (readonly [
			unknown,
			() => UniversalRenderable,
		])[]) {
			if (entry[0] === record.value) {
				selected = entry[1];
				break;
			}
		}
		return selected === null ? [] : [range(materialize(selected(), null))];
	}
	if (record?.$$kind === UNIVERSAL_FOR) {
		const output: FirstScreenNode[] = [];
		const keys = new Set<UniversalKey>();
		let index = 0;
		for (const item of record.items as Iterable<unknown>) {
			const itemKey = (record.key as (item: unknown, index: number) => UniversalKey)(item, index);
			if (keys.has(itemKey)) throw new Error(`Duplicate universal child key ${String(itemKey)}.`);
			keys.add(itemKey);
			const itemValue = (record.render as (item: unknown, index: number) => UniversalRenderable)(
				item,
				index++,
			);
			const component = itemValue as unknown as ComponentValue;
			const componentScope =
				record.componentScope === true &&
				component?.$$kind === UNIVERSAL_COMPONENT_VALUE &&
				component.renderer === 'lynx' &&
				!component.hasKey;
			let rendered: FirstScreenNode[];
			let templateProgram: FirstScreenProgramTemplate | undefined;
			if (componentScope) {
				const result = renderComponentResult(component.component, component.props.props);
				templateProgram = firstScreenProgramTemplate(result.value, result.nodes);
				rendered = [range(result.nodes)];
			} else {
				rendered = materialize(itemValue, null);
			}
			// `ownerless`/`compact` are compiler hints, not unconditional descriptor
			// semantics. The background Lynx client driver does not advertise the
			// compilerLeafProps capability, so universal-core deliberately falls back
			// to one logical owner range per item. The first-screen program must retain
			// those ranges too or every following host ID diverges during adoption.
			output.push(range(rendered, itemKey, componentScope, templateProgram));
		}
		if (index === 0 && typeof record.empty === 'function') {
			return [range(materialize((record.empty as () => UniversalRenderable)(), null))];
		}
		return output;
	}
	if (record?.$$kind === UNIVERSAL_CONTEXT) {
		const context = record.context as UniversalContext<unknown>;
		const owner = childOwner(currentOwner(), new Map([[context, record.value]]));
		return [
			range(
				withOwner(owner, () => {
					const children = record.children;
					return materialize(
						typeof children === 'function' ? (children as () => UniversalRenderable)() : children,
						null,
					);
				}),
			),
		];
	}
	if (record?.$$kind === UNIVERSAL_TRY) return renderTry(record);
	if (record?.$$kind === UNIVERSAL_ACTIVITY) {
		const visibility =
			currentOwner().visibility === 'hidden' || record.mode === 'hidden' ? 'hidden' : 'visible';
		const owner = childOwner(currentOwner(), null, visibility);
		return [
			range(
				withOwner(owner, () => materialize((record.body as () => UniversalRenderable)(), null)),
			),
		];
	}
	if (record?.$$kind === UNIVERSAL_PORTAL) {
		throw new Error('Lynx first-screen rendering does not support portals.');
	}
	if (Array.isArray(value)) {
		const output: FirstScreenNode[] = [];
		for (const child of value) output.push(...materialize(child, renderableKey(child)));
		return output;
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
		return [textNode(String(value))];
	}
	throw new TypeError(
		`Unsupported Lynx first-screen child ${Object.prototype.toString.call(value)}.`,
	);
}

/**
 * Number a program's block the way the interpreted plan would have numbered it.
 *
 * The program's nodes are the interpreted pre-order minus its ranges, and each
 * range's `id` says where it was dropped from. Walking the two together
 * reproduces the original order, and a range's members are numbered where they
 * belong — between the range and whatever followed it — rather than after the
 * program, which is the only reason the two arms agree about every ID and not
 * just about how many there are.
 */
function assignProgramIds(node: FirstScreenProgram, attempt: FirstScreenAttempt): void {
	const ranges = node.plan.ranges;
	const ids: number[] = new Array(node.plan.nodes);
	const rangeIds: (number | undefined)[] = new Array(ranges.length);
	let host = 0;
	let hole = 0;
	let member = 0;
	const total = node.plan.nodes + ranges.length;
	for (let position = 0; position < total; position++) {
		if (hole < ranges.length && ranges[hole]!.id === position) {
			// A hole the program paints is one `#text` with no children, and it is
			// numbered here for exactly the reason a hole's members are: this is
			// where the interpreted arm puts it. Nothing carries the ID — there is
			// no node on this side to hang it on — so it is kept beside the hole,
			// and the mount reads it back to journal what the program returns.
			if (node.texts[hole] !== undefined) {
				rangeIds[hole] = attempt.nextId++;
				hole++;
				continue;
			}
			// The members are numbered where the hole was, not after the program:
			// that is what the interpreted arm does when it splices them into their
			// parent, and it is the whole reason the two arms agree about the IDs of
			// everything that comes *after* a hole rather than only about how many
			// there are.
			const end = member + node.spans[hole]!;
			for (; member < end; member++) {
				const child = node.children[member]!;
				child.id = attempt.nextId++;
				assignIds(child.children, attempt);
			}
			hole++;
			continue;
		}
		ids[host++] = attempt.nextId++;
	}
	// A range whose position the walk never reached would leave its members
	// unnumbered — every ID zero, which reads as an unpainted node rather than as
	// a program whose range table disagrees with its node count.
	if (hole !== ranges.length || host !== node.plan.nodes) {
		throw new TypeError(
			`A compiled main-thread program declares ${node.plan.nodes} nodes and ` +
				`${ranges.length} ranges, but its range positions do not fit that order.`,
		);
	}
	node.ids = ids;
	node.rangeIds = rangeIds;
}

function assignIds(nodes: readonly FirstScreenNode[], attempt: FirstScreenAttempt): void {
	for (const node of nodes) {
		if (node.kind === 'program') {
			node.id = attempt.nextId;
			assignProgramIds(node, attempt);
			continue;
		}
		node.id = attempt.nextId++;
		assignIds(node.children, attempt);
	}
}

/**
 * The one walk the first screen always pays: count hosts, and give every
 * visible host's authored events their deterministic listener ids. Visibility
 * inherits the way the host driver applies it — a host is visible when it is
 * not itself hidden and no host above it is. Hidden hosts are still created and
 * still receive their props; only what the host may *announce* is gated.
 *
 * The background gates first-screen event emission on that same resolved
 * visibility (`universal-core.ts`, `isVisible &&`), announcing a listener only
 * once the subtree is shown. Assigning one here for a hidden host makes the two
 * sides disagree by exactly that binding, and a first screen whose event
 * bindings do not match the background's is unadoptable: it repaints from
 * scratch on every launch and the taps buffered in between are dropped. A
 * hidden tab, a collapsed drawer, and a pre-rendered off-screen route are all
 * this shape.
 */
function collectFirstScreenEvents(
	nodes: readonly FirstScreenNode[],
	parentVisible: boolean,
	insideComponentScope: boolean,
	insideNativeList: boolean,
	attempt: FirstScreenAttempt,
	events: LynxFirstScreenResultEvent[],
): number {
	let hosts = 0;
	for (const node of nodes) {
		hosts += collectNodeFirstScreenEvents(
			node,
			parentVisible,
			insideComponentScope,
			insideNativeList,
			attempt,
			events,
		);
	}
	return hosts;
}

function collectNodeFirstScreenEvents(
	node: FirstScreenNode,
	parentVisible: boolean,
	insideComponentScope: boolean,
	insideNativeList: boolean,
	attempt: FirstScreenAttempt,
	events: LynxFirstScreenResultEvent[],
): number {
	let hosts = 0;
	if (node.kind === 'program') {
		// The program's own hosts are counted, not walked: it made exactly
		// `plan.nodes` of them and `assignIds` already recorded which ID each
		// took. Its event sites are a table rather than a scan, which is the
		// same trade the emission makes everywhere — the walk happened once at
		// build time.
		//
		// The value at an event site still decides, exactly as it does for an
		// authored host: an event-named prop bound to something that is not
		// callable installs no listener, so a program whose handler prop came
		// through undefined announces nothing for it. Reading the slot is what
		// keeps the two arms announcing the same bindings for the same values.
		hosts += node.plan.nodes;
		const visible = parentVisible && node.visibility !== 'hidden';
		// Announced in the same merged order `assignProgramIds` numbers hosts:
		// strict pre-order with each range's members spliced at the hole's
		// position. The interpreted arm — which the background independently
		// reproduces — mints listener ids in that order, so a program that
		// announced its whole event table before its members would renumber
		// every member handler that pre-order places before a later site, and
		// a tap on one host would resolve to another's handler.
		//
		// The announcement run is recorded over the whole merged block,
		// members included. Every binding in the block carries a host id
		// minted in this same ascending walk, which is what lets the mount's
		// run cursor skip a member's binding by comparing ids instead of
		// searching — the invariant the applier's reader states and leans on.
		node.eventsAt = events.length;
		const ranges = node.plan.ranges;
		let hole = 0;
		let member = 0;
		let host = 0;
		const total = node.plan.nodes + ranges.length;
		for (let position = 0; position < total; position++) {
			if (hole < ranges.length && ranges[hole]!.id === position) {
				// A hole the create function paints is one more host on the
				// page — the same `#text` this walk would have built for the
				// same value — counted at the hole's position so the count
				// agrees with the ID space `assignIds` laid out. It carries no
				// events, so the count is all it contributes.
				if (node.texts[hole] !== undefined) {
					hosts++;
					hole++;
					continue;
				}
				const end = member + node.spans[hole]!;
				for (; member < end; member++) {
					hosts += collectNodeFirstScreenEvents(
						node.children[member]!,
						visible,
						insideComponentScope,
						insideNativeList,
						attempt,
						events,
					);
				}
				hole++;
				continue;
			}
			if (visible) {
				for (const site of node.plan.events) {
					if (site.node !== host) continue;
					const handler = node.values[site.slot];
					if (handler !== FIRST_SCREEN_EVENT && typeof handler !== 'function') continue;
					events.push({
						id: node.ids[site.node]!,
						type: site.type,
						listener: { id: attempt.nextListener++, priority: site.priority },
					});
				}
			}
			host++;
		}
		node.eventsCount = events.length - node.eventsAt;
		return hosts;
	}
	if (node.kind !== 'host') {
		// A `@for` whose members the compiler marked component-scoped collapses
		// into one template program the host driver mounts with a single command
		// (upstream #765). Its hosts are still walked and still announce one
		// binding each — that is the tree the direct applier paints and the tree
		// the background describes, and neither changes — but the *block* of
		// listener identities they take is recorded here, because the
		// `mount-template-range` command names the block rather than its members.
		// Reserving it anywhere else would mean handing one page two answers
		// about listener identity, which is the drift this walk exists to
		// prevent.
		const template = firstScreenTemplateRange(
			node,
			insideComponentScope,
			insideNativeList,
			parentVisible,
		);
		const eventsAt = events.length;
		hosts += collectFirstScreenEvents(
			node.children,
			parentVisible,
			insideComponentScope || (node.kind === 'range' && node.componentScope === true),
			insideNativeList,
			attempt,
			events,
		);
		if (template !== undefined) {
			const bound = events.length - eventsAt;
			// The program's event table and the row's own hosts are two readings
			// of one plan, so a disagreement is a compiler or renderer fault
			// rather than a page the batch could still describe correctly. Said
			// out loud here, where both counts are in hand, rather than left to
			// surface as a row whose taps reach another row's handlers.
			if (bound !== template.program.events.length) {
				throw new Error(
					'Lynx first-screen template program and its rendered row disagree on how many listeners the row binds.',
				);
			}
			template.eventsAt = eventsAt;
			template.firstListenerId = bound === 0 ? null : events[eventsAt]!.listener.id;
		}
		return hosts;
	}
	hosts++;
	const visible = parentVisible && node.visibility !== 'hidden';
	if (visible) {
		for (const [type, priority] of node.events) {
			// The array is frozen once at the end; the bindings themselves are
			// not, because unlike the batch they are never handed across a
			// boundary — and a page with a listener on every row would pay one
			// freeze per binding for a value only the applier next door reads.
			events.push({ id: node.id, type, listener: { id: attempt.nextListener++, priority } });
		}
	}
	hosts += collectFirstScreenEvents(
		node.children,
		visible,
		insideComponentScope,
		insideNativeList || node.type === 'list' || node.type === 'list-item',
		attempt,
		events,
	);
	return hosts;
}

function physicalChildren(
	nodes: readonly FirstScreenNode[],
	output: FirstScreenHost[] = [],
): FirstScreenHost[] {
	for (const node of nodes) {
		if (node.kind === 'host') output.push(node);
		else physicalChildren(node.children, output);
	}
	return output;
}

/**
 * The template program a component-scoped `@for` member collapsed into, or
 * `undefined` for every other range.
 *
 * Asked once, from the two walks that have to agree about it: the always-paid
 * event walk reserves the listener identities the row will bind, and the staged
 * batch emits the one `mount-template-range` command that names them. A range
 * one walk called a template and the other did not would put the page's
 * listener identities out of step by exactly that block, and nothing downstream
 * would say so — the row would simply route its taps to the wrong handlers.
 */
function firstScreenTemplateRange(
	node: FirstScreenNode,
	insideComponentScope: boolean,
	insideNativeList: boolean,
	parentVisible: boolean,
): FirstScreenProgramTemplate | undefined {
	if (node.kind !== 'range' || node.componentScope !== true || insideComponentScope) {
		return undefined;
	}
	const template = node.templateProgram;
	if (template === undefined || node.key === null || insideNativeList) return undefined;
	// Upstream reads the row's own `visibility` here. The hosts above it decide
	// too, because visibility resolves down the tree and a listener announced for
	// a subtree the page keeps hidden is exactly the disagreement
	// `collectFirstScreenEvents` documents. Both facts belong in the one answer.
	return parentVisible && template.root.visibility === 'visible' ? template : undefined;
}

function selectFirstScreenTemplates(nodes: readonly FirstScreenNode[]): {
	readonly ranges: ReadonlyMap<FirstScreenRange, FirstScreenProgramTemplate>;
	readonly roots: ReadonlyMap<FirstScreenHost, FirstScreenProgramTemplate>;
} {
	const ranges = new Map<FirstScreenRange, FirstScreenProgramTemplate>();
	const roots = new Map<FirstScreenHost, FirstScreenProgramTemplate>();
	const visit = (
		children: readonly FirstScreenNode[],
		insideComponentScope: boolean,
		insideNativeList: boolean,
		parentVisible: boolean,
	): void => {
		for (const node of children) {
			if (node.kind === 'range') {
				const template = firstScreenTemplateRange(
					node,
					insideComponentScope,
					insideNativeList,
					parentVisible,
				);
				if (template !== undefined) {
					ranges.set(node, template);
					roots.set(template.root, template);
					continue;
				}
				visit(
					node.children,
					insideComponentScope || node.componentScope === true,
					insideNativeList,
					parentVisible,
				);
				continue;
			}
			const host = node.kind === 'host' ? node : null;
			visit(
				node.children,
				insideComponentScope,
				insideNativeList || host?.type === 'list' || host?.type === 'list-item',
				host === null ? parentVisible : parentVisible && host.visibility !== 'hidden',
			);
		}
	};
	visit(nodes, false, false, true);
	return { ranges, roots };
}

function templateCommand(
	template: FirstScreenProgramTemplate,
	parent: number | null,
): UniversalHostCommand {
	if (template.program.events.length !== 0 && template.firstListenerId === null) {
		throw new Error('Lynx first-screen template program lost its listener identity range.');
	}
	return {
		op: 'mount-template-range',
		parent,
		before: null,
		program: template.program,
		firstId: template.root.id,
		values: template.values,
		firstListenerId: template.firstListenerId,
	};
}

function stagePlacements(
	nodes: readonly FirstScreenNode[],
	commands: UniversalHostCommand[],
	templateRanges: ReadonlyMap<FirstScreenRange, FirstScreenProgramTemplate>,
	templateRoots: ReadonlyMap<FirstScreenHost, FirstScreenProgramTemplate>,
): void {
	for (const node of nodes) {
		if (node.kind === 'range' && templateRanges.has(node)) continue;
		stagePlacements(node.children, commands, templateRanges, templateRoots);
		if (node.kind !== 'host') continue;
		for (const child of physicalChildren(node.children)) {
			const template = templateRoots.get(child);
			commands.push(
				template === undefined
					? { op: 'insert', parent: node.id, id: child.id, before: null }
					: templateCommand(template, node.id),
			);
		}
	}
}

const FIRST_SCREEN_RENDERER = 'lynx';
const FIRST_SCREEN_VERSION = 1;
function stageCreates(
	nodes: readonly FirstScreenNode[],
	commands: UniversalHostCommand[],
	templateRanges: ReadonlyMap<FirstScreenRange, FirstScreenProgramTemplate>,
): void {
	for (const node of nodes) {
		if (node.kind === 'range' && templateRanges.has(node)) continue;
		if (node.kind === 'host') {
			commands.push({ op: 'create', id: node.id, type: node.type, props: node.props });
		}
		stageCreates(node.children, commands, templateRanges);
	}
}

/**
 * The `event` commands, re-projected from the bindings the envelope already
 * carries, minus the run each template range owns — those listeners are bound
 * by the single `mount-template-range` command that replaces the row.
 *
 * Upstream numbers the listeners here instead, walking the tree a second time.
 * That is the one part of its staging this cannot take: the D-train assigns
 * listener identity once, on the walk the first screen always pays, precisely
 * so a page cannot be handed two answers about it. What the walk leaves behind
 * is where each row's run sits, which is all the skip needs.
 *
 * `templateRanges` is filled in document order and each run is contiguous, so
 * the skip is a cursor rather than a membership test — at 30k rows a set of
 * every covered listener would cost more than the commands it filtered.
 */
function stageEvents(
	events: readonly LynxFirstScreenResultEvent[],
	commands: UniversalHostCommand[],
	templateRanges: ReadonlyMap<FirstScreenRange, FirstScreenProgramTemplate>,
): void {
	const push = (binding: LynxFirstScreenResultEvent): void => {
		commands.push({ op: 'event', id: binding.id, type: binding.type, listener: binding.listener });
	};
	let index = 0;
	for (const template of templateRanges.values()) {
		const at = template.eventsAt;
		if (at === null || template.program.events.length === 0) continue;
		for (; index < at; index++) push(events[index]!);
		index = at + template.program.events.length;
	}
	for (; index < events.length; index++) push(events[index]!);
}

function freezeBatch(commands: UniversalHostCommand[]): UniversalHostBatch {
	for (const command of commands) Object.freeze(command);
	return Object.freeze({
		renderer: FIRST_SCREEN_RENDERER,
		version: FIRST_SCREEN_VERSION,
		commands: Object.freeze(commands),
	});
}

/**
 * The wire product: one `create` per host, the placements, the root inserts,
 * and the hidden tail. At 10k fixture rows that is well over a hundred thousand
 * command objects, each frozen — and on a tree the direct applier accepts,
 * nothing reads a single one of them. So it is built the first time
 * `result.batch` is read and not before: the native-list fallback and callers
 * that want the batch as a value still get it, and the path that does not need
 * it stops paying for it.
 *
 * The `event` commands are re-projected from the bindings the envelope already
 * carries rather than assigned a second time here, so the listener ids the two
 * paths see cannot drift apart no matter when — or whether — this runs.
 */
function buildFirstScreenBatch(
	nodes: readonly FirstScreenNode[],
	events: readonly LynxFirstScreenResultEvent[],
): UniversalHostBatch {
	const templates = selectFirstScreenTemplates(nodes);
	const commands: UniversalHostCommand[] = [];
	stageCreates(nodes, commands, templates.ranges);
	stageEvents(events, commands, templates.ranges);
	stagePlacements(nodes, commands, templates.ranges, templates.roots);
	for (const host of physicalChildren(nodes)) {
		const template = templates.roots.get(host);
		commands.push(
			template === undefined
				? { op: 'insert', parent: null, id: host.id, before: null }
				: templateCommand(template, null),
		);
	}
	const hidden: FirstScreenHost[] = [];
	const collectHiddenPostOrder = (children: readonly FirstScreenNode[]): void => {
		for (const child of children) {
			if (child.kind === 'range' && templates.ranges.has(child)) continue;
			collectHiddenPostOrder(child.children);
			if (child.kind === 'host' && child.visibility === 'hidden') hidden.push(child);
		}
	};
	collectHiddenPostOrder(nodes);
	for (const host of hidden) commands.push({ op: 'visibility', id: host.id, state: 'hidden' });
	return freezeBatch(commands);
}

/**
 * Structural node view consumed by the direct first-screen applier.
 *
 * `program` is a compiled main-thread program (issue #163), and it is the one
 * kind carrying no structure: it paints itself, so there is nothing here for a
 * walk to read. What it carries instead is what a mount needs and a walk cannot
 * recover — the plan whose `bind` produces the create, the value array its
 * positional arguments are drawn from, and the IDs its hosts took — with
 * `children` still holding any keyed range's members, which are this renderer's
 * to materialize rather than the program's to paint.
 */
export interface LynxFirstScreenResultNode {
	readonly kind: 'host' | 'range' | 'program';
	readonly id: number;
	readonly type?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly visibility?: 'visible' | 'hidden';
	readonly children: readonly LynxFirstScreenResultNode[];
	readonly plan?: UniversalProgramPlan;
	readonly values?: readonly unknown[];
	readonly ids?: readonly number[];
	readonly spans?: readonly number[];
	/**
	 * The string handed to each declared range for the program to paint, or
	 * `undefined` for a hole this renderer filled itself — one per range, in
	 * `plan.ranges` order.
	 *
	 * The applier passes these straight through as the create function's range
	 * arguments and compares what comes back against them, which is what keeps
	 * the two answers about one hole from drifting apart.
	 */
	readonly texts?: readonly (string | undefined)[];
	/**
	 * The ID each range the program paints took, and nothing at a hole this
	 * renderer filled — one per range, in `plan.ranges` order.
	 *
	 * A painted hole has no node on this side to carry its ID, and the ID is
	 * still minted where the interpreted arm puts that node, so it travels
	 * beside the hole instead.
	 */
	readonly rangeIds?: readonly (number | undefined)[];
}

/** One background listener this pass assigned, addressed to a rendered host. */
export interface LynxFirstScreenResultEvent {
	readonly id: number;
	readonly type: string;
	readonly listener: UniversalEventListenerDescriptor;
}

/**
 * What the direct applier reads in place of the command batch: the envelope
 * fields it validates, and the background listeners this pass assigned. The
 * applier declares the same shape as `LynxFirstScreenDirectEnvelope` rather
 * than importing this one, for the reason the module header gives — this file
 * stays free of the host driver.
 */
export interface LynxFirstScreenResultEnvelope {
	readonly renderer: string;
	readonly version: number;
	readonly events: readonly LynxFirstScreenResultEvent[];
}

export interface LynxFirstScreenRenderResult {
	/**
	 * The batch as a value, built on first read and then cached. It stays the
	 * wire and staged-apply product; it is no longer on the direct path, which
	 * reads `envelope` instead.
	 */
	readonly batch: UniversalHostBatch;
	/**
	 * The rendered record tree, id-assigned, for direct PAPI emission
	 * (issue-58 L3). The batch stays the wire/adoption product; the applier
	 * takes its listener ids from `envelope` below, so their deterministic
	 * assignment stays single-sourced here whether or not a batch is built.
	 */
	readonly nodes: readonly LynxFirstScreenResultNode[];
	/** Envelope for `applyLynxFirstScreenDirect`; costs one walk, not a batch. */
	readonly envelope: LynxFirstScreenResultEnvelope;
	readonly hostCount: number;
	/**
	 * How many compiled main-thread programs this first screen contains.
	 * Non-zero means reading `batch` throws: a caller whose direct apply
	 * declined such a tree must decline the whole first screen to the command
	 * path rather than fall back into the batch getter.
	 */
	readonly programs: number;
	readonly logicalCount: number;
}

/** Evaluate one compiled root and produce the background-compatible initial host batch. */
export function renderLynxFirstScreen<Props>(
	component: UniversalComponent<Props>,
	props: Props,
): LynxFirstScreenRenderResult {
	if (CURRENT_ATTEMPT !== null)
		throw new Error('Lynx first-screen roots cannot render reentrantly.');
	const rootOwner: FirstScreenOwner = { parent: null, contexts: null, visibility: 'visible' };
	const attempt: FirstScreenAttempt = {
		owner: rootOwner,
		nextId: 1,
		// Universal roots reserve one million listener IDs per root. The main and
		// background programs have isolated module globals, so their first roots
		// both begin at the same deterministic listener seed.
		nextListener: 1_000_000,
		nextUniversalId: 1,
		programs: 0,
	};
	CURRENT_ATTEMPT = attempt;
	ACTIVE_FIRST_SCREEN_WARM_PLANS.length = 0;
	FIRST_SCREEN_WARM_DEPTH = 0;
	let nodes: FirstScreenNode[];
	try {
		const metadata = componentMetadata(component);
		if (metadata !== FIRST_SCREEN_LAZY_METADATA && metadata.id !== 'lynx') {
			throw new LynxFirstScreenRefusalError(
				'Lynx first-screen root.render() requires a compiled Lynx component.',
			);
		}
		nodes = materialize(component(props, componentContext()), null);
		assignIds(nodes, attempt);
	} catch (error) {
		if (error instanceof FirstScreenSuspense) {
			throw new Error(
				'Lynx first-screen rendering suspended without an authored @pending boundary; the synchronous first-screen pass cannot wait for lazy chunks or other asynchronous work.',
				{ cause: error.thenable },
			);
		}
		throw error;
	} finally {
		ACTIVE_FIRST_SCREEN_WARM_PLANS.length = 0;
		FIRST_SCREEN_WARM_DEPTH = 0;
		CURRENT_ATTEMPT = null;
	}

	const events: LynxFirstScreenResultEvent[] = [];
	const hostCount = collectFirstScreenEvents(nodes, true, false, false, attempt, events);
	const envelope: LynxFirstScreenResultEnvelope = Object.freeze({
		renderer: FIRST_SCREEN_RENDERER,
		version: FIRST_SCREEN_VERSION,
		events: Object.freeze(events),
	});
	const programs = attempt.programs;
	let batch: UniversalHostBatch | null = null;
	return Object.freeze({
		get batch(): UniversalHostBatch {
			if (programs !== 0) {
				// Not "not yet": a batch is commands, and a compiled main-thread
				// program exists precisely so its first screen is not commands (issue
				// #163). The staged path is the fallback for a tree the direct applier
				// declines, and there is no version of it that carries a program —
				// building one would mean re-describing the subtree the program was
				// compiled to stop describing.
				throw new TypeError(
					'A first screen holding a compiled main-thread program has no command batch; it is painted by the direct applier.',
				);
			}
			return (batch ??= buildFirstScreenBatch(nodes, events));
		},
		nodes,
		envelope,
		hostCount,
		// Non-zero means the batch getter above throws; the caller that cannot
		// direct-apply such a tree must decline it to the command path rather
		// than fall back into the getter and crash with an error naming the
		// wrong problem.
		programs,
		logicalCount: attempt.nextId - 1,
	});
}

export function hookSlots(count: number): number {
	const base = NEXT_HOOK_SLOT;
	NEXT_HOOK_SLOT += count;
	return base;
}

export function withSlot<T>(slot: unknown, fn: (...args: any[]) => T, ...args: any[]): T {
	SLOT_STACK.push(slot);
	try {
		return fn(...args);
	} finally {
		SLOT_STACK.pop();
	}
}

const NOOP_UPDATE = () => {};

export function useState<T>(
	initial: T | (() => T),
	_slot?: unknown,
): [T, (value: T | ((previous: T) => T)) => void, () => T] {
	currentOwner();
	const value = typeof initial === 'function' ? (initial as () => T)() : initial;
	return [value, NOOP_UPDATE, () => value];
}

export const __useStateWithGetter = useState;

export function useLinkedState<Source, Value>(
	source: Source,
	reconcile: (source: Source, previous: LinkedStatePrevious<Source, Value> | undefined) => Value,
	_optionsOrSlot?: LinkedStateOptions<Source, Value> | symbol | string | number,
	_slot?: unknown,
): [Value, (next: Value | ((previous: Value) => Value)) => void] {
	currentOwner();
	return [reconcile(source, undefined), NOOP_UPDATE];
}

export function __useLinkedStateWithGetter<Source, Value>(
	source: Source,
	reconcile: (source: Source, previous: LinkedStatePrevious<Source, Value> | undefined) => Value,
	optionsOrSlot?: LinkedStateOptions<Source, Value> | symbol | string | number,
	slot?: unknown,
): [Value, (next: Value | ((previous: Value) => Value)) => void, () => Value] {
	const [value, setValue] = useLinkedState(source, reconcile, optionsOrSlot, slot);
	return [value, setValue, () => value];
}

export function useReducer<S, A, I = S>(
	_reducer: (state: S, action: A) => S,
	initialArg: I,
	initOrSlot?: ((value: I) => S) | unknown,
	_maybeSlot?: unknown,
): [S, (action: A) => void, () => S] {
	currentOwner();
	const value =
		typeof initOrSlot === 'function'
			? (initOrSlot as (value: I) => S)(initialArg)
			: (initialArg as unknown as S);
	return [value, NOOP_UPDATE, () => value];
}

export const __useReducerWithGetter = useReducer;

export function useInsertionEffect(): void {
	currentOwner();
}
export function useLayoutEffect(): void {
	currentOwner();
}
export function useEffect(): void {
	currentOwner();
}

export function useMemo<T>(
	compute: () => T,
	_deps?: readonly unknown[] | null,
	_slot?: unknown,
): T {
	currentOwner();
	return compute();
}

export function useCallback<T extends (...args: any[]) => any>(
	callback: T,
	_deps?: readonly unknown[] | null,
	_slot?: unknown,
): T {
	currentOwner();
	return callback;
}

export function useRef<T>(initial: T, _slot?: unknown): { current: T } {
	currentOwner();
	return { current: initial };
}

export function useId(_slot?: unknown): string {
	const attempt = currentAttempt();
	const index = attempt.nextUniversalId++;
	const sum = 1 + index;
	const paired = (sum * (sum + 1)) / 2 + index;
	return `:octane-u${paired.toString(36)}:`;
}

export function useSyncExternalStore<T>(
	_subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => T,
): T {
	currentOwner();
	return getSnapshot();
}

export function useDeferredValue<T>(value: T): T {
	currentOwner();
	return value;
}

export function startTransition(_fn: () => void | Promise<unknown>): void {}

export function useTransition(_slot?: unknown): [boolean, typeof startTransition] {
	currentOwner();
	return [false, startTransition];
}

export function useActionState<State, Payload>(
	_action: (previousState: State, payload: Payload) => State | Promise<State>,
	initialState: State,
): [State, (payload: Payload) => void, boolean] {
	currentOwner();
	return [initialState, NOOP_UPDATE, false];
}

export interface FormStatus {
	pending: boolean;
	data: unknown;
	method: string | null;
	action: string | ((formData: unknown) => void | Promise<void>) | null;
}

const FORM_STATUS: FormStatus = Object.freeze({
	pending: false,
	data: null,
	method: null,
	action: null,
});

export function useFormStatus(): FormStatus {
	currentOwner();
	return FORM_STATUS;
}

export function useOptimistic<State, Action = State>(
	passthrough: State,
	_reducer?: (state: State, action: Action) => State,
): [State, (action: Action) => void] {
	currentOwner();
	return [passthrough, NOOP_UPDATE];
}

export function useContext<T>(context: UniversalContext<T>): T {
	for (let owner: FirstScreenOwner | null = currentOwner(); owner !== null; owner = owner.parent) {
		if (owner.contexts?.has(context)) return owner.contexts.get(context) as T;
	}
	return context.defaultValue;
}

function trackThenable<T>(thenable: TrackedThenable<T>): void {
	if (
		thenable.status === 'pending' ||
		thenable.status === 'fulfilled' ||
		thenable.status === 'rejected'
	) {
		return;
	}
	thenable.status = 'pending';
	thenable.then(
		(value) => {
			thenable.status = 'fulfilled';
			thenable.value = value;
		},
		(error) => {
			thenable.status = 'rejected';
			thenable.reason = error;
		},
	);
}

export function use<T>(usable: UniversalContext<T> | PromiseLike<T>): T {
	if ((usable as UniversalContext<T>).$$kind === CONTEXT_TAG)
		return useContext(usable as UniversalContext<T>);
	const thenable = usable as TrackedThenable<T>;
	if (thenable.status === 'fulfilled') return thenable.value as T;
	if (thenable.status === 'rejected') throw thenable.reason;
	trackThenable(thenable);
	throw new FirstScreenSuspense(thenable);
}

function warmFirstScreenPlan(plan: () => void): void {
	if (FIRST_SCREEN_WARM_DEPTH >= FIRST_SCREEN_WARM_DEPTH_CAP) return;
	FIRST_SCREEN_WARM_DEPTH++;
	try {
		plan();
	} catch {
		// Warming is speculative and cannot replace the authored pending arm.
	} finally {
		FIRST_SCREEN_WARM_DEPTH--;
	}
}

export function useBatch(items: any[], warm?: () => void): void {
	if (items.length === 0) {
		if (warm !== undefined) ACTIVE_FIRST_SCREEN_WARM_PLANS.push(warm);
		return;
	}
	let pending: TrackedThenable[] | null = null;
	for (const item of items) {
		if (item == null || typeof item.then !== 'function') continue;
		const thenable = item as TrackedThenable;
		trackThenable(thenable);
		if (thenable.status === 'rejected') break;
		if (thenable.status === 'pending') (pending ??= []).push(thenable);
	}
	if (pending === null) return;
	for (let index = 0; index < ACTIVE_FIRST_SCREEN_WARM_PLANS.length; index++) {
		warmFirstScreenPlan(ACTIVE_FIRST_SCREEN_WARM_PLANS[index]);
	}
	if (warm !== undefined) warmFirstScreenPlan(warm);
	if (pending.length === 1) throw new FirstScreenSuspense(pending[0]);
	throw new FirstScreenSuspense(Promise.all(pending));
}

export function warmMemo(): void {}
export function warmChild(component: any, props: any): void {
	if (FIRST_SCREEN_WARM_DEPTH === 0 || component == null) return;
	const plan = component.__warm;
	if (typeof plan === 'function') warmFirstScreenPlan(() => plan(props));
}

export function useImperativeHandle(): void {
	currentOwner();
}

export function useEffectEvent<T extends (...args: any[]) => any>(_fn: T, _slot?: unknown): T {
	currentOwner();
	return NOOP_UPDATE as T;
}

export function useDebugValue(): void {
	currentOwner();
}

export function requestFormReset(): void {}

export function memo<P>(component: UniversalComponent<P>): UniversalComponent<P> {
	return component;
}

export function createPortal(children: UniversalRenderable, target: unknown): UniversalRenderable {
	return { $$kind: UNIVERSAL_PORTAL, children, target } as never;
}

export const Activity: unique symbol = Symbol.for('octane.Activity') as never;

export interface NativeUniversalContext<T> extends UniversalContext<T> {
	(props: {
		value: T;
		children?: UniversalRenderable | (() => UniversalRenderable);
	}): UniversalRenderable;
	readonly Provider: NativeUniversalContext<T>;
}

export function createContext<T>(defaultValue: T): NativeUniversalContext<T> {
	const context = ((props: {
		value: T;
		children?: UniversalRenderable | (() => UniversalRenderable);
	}) => universalContext(context, props.value, props.children)) as NativeUniversalContext<T>;
	Object.defineProperties(context, {
		$$kind: { value: CONTEXT_TAG, enumerable: true },
		defaultValue: { value: defaultValue, enumerable: true },
		Provider: { value: context, enumerable: true },
		$$version: { value: 0, enumerable: true, writable: true },
	});
	return context;
}
