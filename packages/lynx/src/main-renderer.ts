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
	UniversalKey,
	UniversalPlan,
	UniversalPlanNode,
	UniversalPropEntry,
	UniversalRenderable,
	UniversalRenderContext,
} from 'octane/universal/native';
import { isLynxNativeResource } from './resource.js';

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
}

type FirstScreenNode = FirstScreenHost | FirstScreenRange;

interface FirstScreenAttempt {
	owner: FirstScreenOwner;
	nextId: number;
	nextListener: number;
	nextUniversalId: number;
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
	// `program` reaches here too, and by type rather than by accident: this
	// renderer is the one that will mount a compiled main-thread program, and
	// until it does, refusing one here is what keeps `renderPlanNode` below from
	// ever seeing a kind it cannot paint. The refusal reads the kind on the
	// throw path so it stays off the freeze walk, which components with children
	// re-enter per render.
	throw new TypeError(`Unsupported universal plan node kind ${JSON.stringify(node.kind)}.`);
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
): PropsValue {
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
): UniversalRenderable {
	return { $$kind: UNIVERSAL_FOR, items, key, render, empty, ownerless, compact } as never;
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
	throw new Error('Lynx first-screen rendering requires a compiled Lynx component.');
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

function range(children: FirstScreenNode[], key: UniversalKey | null = null): FirstScreenRange {
	return { kind: 'range', key, id: 0, children };
}

function renderComponent(
	component: UniversalComponent<any>,
	props: Readonly<Record<string, unknown>>,
): FirstScreenNode[] {
	const metadata = componentMetadata(component);
	if (metadata !== FIRST_SCREEN_LAZY_METADATA && metadata.id !== 'lynx') {
		throw new Error('Lynx first-screen rendering requires a compiled Lynx component.');
	}
	const owner = childOwner(currentOwner());
	const warmPlanCheckpoint = ACTIVE_FIRST_SCREEN_WARM_PLANS.length;
	try {
		return withOwner(owner, () => materialize(component(props, componentContext()), null));
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
	// The one kind the union still leaves here is a compiled main-thread program,
	// which `freezePlanNode` refuses, so this is a host. Checked rather than
	// asserted: an unchecked narrowing on the path that paints the first screen
	// buys one interned-string comparison per host node and pays for it by
	// turning a wrong plan into a wrong tree instead of a named error.
	if (node.kind !== 'host') {
		throw new TypeError(`Unsupported universal plan node kind ${JSON.stringify(node.kind)}.`);
	}
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
			const rendered = materialize(
				(record.render as (item: unknown, index: number) => UniversalRenderable)(item, index++),
				null,
			);
			// `ownerless`/`compact` are compiler hints, not unconditional descriptor
			// semantics. The background Lynx client driver does not advertise the
			// compilerLeafProps capability, so universal-core deliberately falls back
			// to one logical owner range per item. The first-screen program must retain
			// those ranges too or every following host ID diverges during adoption.
			output.push(range(rendered, itemKey));
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

function assignIds(nodes: readonly FirstScreenNode[], attempt: FirstScreenAttempt): void {
	for (const node of nodes) {
		node.id = attempt.nextId++;
		assignIds(node.children, attempt);
	}
}

function visitHosts(
	nodes: readonly FirstScreenNode[],
	visit: (host: FirstScreenHost) => void,
): void {
	for (const node of nodes) {
		if (node.kind === 'host') visit(node);
		visitHosts(node.children, visit);
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
	attempt: FirstScreenAttempt,
	events: LynxFirstScreenResultEvent[],
): number {
	let hosts = 0;
	for (const node of nodes) {
		if (node.kind !== 'host') {
			hosts += collectFirstScreenEvents(node.children, parentVisible, attempt, events);
			continue;
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
		hosts += collectFirstScreenEvents(node.children, visible, attempt, events);
	}
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

function stagePlacements(
	nodes: readonly FirstScreenNode[],
	commands: UniversalHostCommand[],
): void {
	for (const node of nodes) {
		stagePlacements(node.children, commands);
		if (node.kind !== 'host') continue;
		for (const child of physicalChildren(node.children)) {
			commands.push({ op: 'insert', parent: node.id, id: child.id, before: null });
		}
	}
}

const FIRST_SCREEN_RENDERER = 'lynx';
const FIRST_SCREEN_VERSION = 1;

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
	const commands: UniversalHostCommand[] = [];
	visitHosts(nodes, (host) => {
		commands.push({ op: 'create', id: host.id, type: host.type, props: host.props });
	});
	for (const binding of events) {
		commands.push({ op: 'event', id: binding.id, type: binding.type, listener: binding.listener });
	}
	stagePlacements(nodes, commands);
	for (const host of physicalChildren(nodes)) {
		commands.push({ op: 'insert', parent: null, id: host.id, before: null });
	}
	const hidden: FirstScreenHost[] = [];
	const collectHiddenPostOrder = (children: readonly FirstScreenNode[]): void => {
		for (const child of children) {
			collectHiddenPostOrder(child.children);
			if (child.kind === 'host' && child.visibility === 'hidden') hidden.push(child);
		}
	};
	collectHiddenPostOrder(nodes);
	for (const host of hidden) commands.push({ op: 'visibility', id: host.id, state: 'hidden' });
	return freezeBatch(commands);
}

/** Structural node view consumed by the direct first-screen applier. */
export interface LynxFirstScreenResultNode {
	readonly kind: 'host' | 'range';
	readonly id: number;
	readonly type?: string;
	readonly props?: Readonly<Record<string, unknown>>;
	readonly visibility?: 'visible' | 'hidden';
	readonly children: readonly LynxFirstScreenResultNode[];
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
	};
	CURRENT_ATTEMPT = attempt;
	ACTIVE_FIRST_SCREEN_WARM_PLANS.length = 0;
	FIRST_SCREEN_WARM_DEPTH = 0;
	let nodes: FirstScreenNode[];
	try {
		const metadata = componentMetadata(component);
		if (metadata !== FIRST_SCREEN_LAZY_METADATA && metadata.id !== 'lynx') {
			throw new Error('Lynx first-screen root.render() requires a compiled Lynx component.');
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
	const hostCount = collectFirstScreenEvents(nodes, true, attempt, events);
	const envelope: LynxFirstScreenResultEnvelope = Object.freeze({
		renderer: FIRST_SCREEN_RENDERER,
		version: FIRST_SCREEN_VERSION,
		events: Object.freeze(events),
	});
	let batch: UniversalHostBatch | null = null;
	return Object.freeze({
		get batch(): UniversalHostBatch {
			return (batch ??= buildFirstScreenBatch(nodes, events));
		},
		nodes,
		envelope,
		hostCount,
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
