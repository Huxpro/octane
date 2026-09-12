declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type {
	UniversalComponent,
	UniversalEventListenerDescriptor,
	UniversalKey,
	UniversalProgramAddress,
	UniversalProgramPlan,
	UniversalPropEntry,
	UniversalRenderable,
	UniversalRenderContext,
} from 'octane/universal/native';

import { encodeLynxProgramPropValue } from './core/host-prop-value.js';
import { registerUniversalProgram } from './core/program-registry.js';

const UNIVERSAL_PLAN = Symbol.for('octane.universal.plan');
const UNIVERSAL_VALUE = Symbol.for('octane.universal.value');
const UNIVERSAL_COMPONENT = Symbol.for('octane.universal.component');
const UNIVERSAL_COMPONENT_VALUE = Symbol.for('octane.universal.component-value');
const UNIVERSAL_PROPS = Symbol.for('octane.universal.props');
const UNIVERSAL_FOR = Symbol.for('octane.universal.for');
const FIRST_SCREEN_EVENT = Symbol.for('octane.lynx.first-screen-event');
const NO_CHILDREN = Symbol('octane.lynx.compiled-program.no-children');
const NO_KEY = Symbol('octane.lynx.compiled-program.no-key');
const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL499';

interface PlanValue {
	readonly $$kind: symbol;
	readonly plan: UniversalProgramPlan;
	readonly values: readonly unknown[];
	readonly key: UniversalKey | null;
}

interface PropsValue {
	readonly $$kind: symbol;
	readonly props: Readonly<Record<string, unknown>>;
	readonly key: unknown;
	readonly hasKey: boolean;
}

interface ComponentValue {
	readonly $$kind: symbol;
	readonly renderer: string;
	readonly component: UniversalComponent<any>;
	readonly props: PropsValue;
	readonly key: unknown;
	readonly hasKey: boolean;
}

interface ForValue {
	readonly $$kind: symbol;
	readonly items: Iterable<unknown>;
	readonly key: (item: unknown, index: number) => UniversalKey;
	readonly render: (item: unknown, index: number) => UniversalRenderable;
	readonly empty: (() => UniversalRenderable) | null;
}

interface CompactProgramNode {
	kind: 'program';
	id: number;
	readonly children: CompactNode[];
	readonly plan: UniversalProgramPlan;
	readonly values: readonly unknown[];
	readonly selectedValues: readonly (string | number | boolean | null)[];
	ids: number[];
	readonly spans: number[];
	readonly texts: (string | undefined)[];
	rangeIds: (number | undefined)[];
	eventsAt: number;
	eventsCount: number;
}

interface CompactRangeNode {
	kind: 'range';
	id: number;
	readonly children: CompactNode[];
}

type CompactNode = CompactProgramNode | CompactRangeNode;

export interface LynxFirstScreenResultNode {
	readonly kind: 'program' | 'range';
	readonly id: number;
	readonly children: readonly LynxFirstScreenResultNode[];
	readonly plan?: UniversalProgramPlan;
	readonly values?: readonly unknown[];
	readonly selectedValues?: readonly (string | number | boolean | null)[];
	readonly ids?: readonly number[];
	readonly spans?: readonly number[];
	readonly texts?: readonly (string | undefined)[];
	readonly rangeIds?: readonly (number | undefined)[];
}

export interface LynxFirstScreenResultEvent {
	readonly id: number;
	readonly type: string;
	readonly listener: UniversalEventListenerDescriptor;
}

export interface LynxFirstScreenResultEnvelope {
	readonly renderer: 'lynx';
	readonly version: 1;
	readonly events: readonly LynxFirstScreenResultEvent[];
}

export interface LynxFirstScreenRenderResult {
	readonly batch: never;
	readonly nodes: readonly LynxFirstScreenResultNode[];
	readonly envelope: LynxFirstScreenResultEnvelope;
	readonly hostCount: number;
	readonly programs: number;
	readonly logicalCount: number;
}

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx compiled-program renderer ${message}.` : CODE);
}

function assertRenderer(renderer: string): void {
	if (renderer !== 'lynx') fail(`cannot evaluate renderer ${JSON.stringify(renderer)}`);
}

function normalizeKey(value: unknown): UniversalKey | null {
	return typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'symbol' ||
		typeof value === 'bigint'
		? value
		: null;
}

export function universalPlan(
	renderer: string,
	root: UniversalProgramPlan,
	address?: UniversalProgramAddress,
): UniversalProgramPlan {
	assertRenderer(renderer);
	if (root.kind !== 'program') fail('received a non-program plan after complete addressing proof');
	const plan = Object.freeze({
		...root,
		...(address === undefined ? null : { address: Object.freeze({ ...address }) }),
	}) as UniversalProgramPlan;
	if (address !== undefined) registerUniversalProgram(address.module, address.index, plan);
	return plan;
}

export function universalValue(
	plan: UniversalProgramPlan,
	values: readonly unknown[] = [],
	key: UniversalKey | null = null,
): UniversalRenderable {
	return { $$kind: UNIVERSAL_VALUE, plan, values, key } as unknown as UniversalRenderable;
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
	return { $$kind: UNIVERSAL_PROPS, props: Object.freeze(props), key, hasKey };
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
	} as unknown as UniversalRenderable;
}

export function universalFor<T>(
	items: Iterable<T>,
	key: (item: T, index: number) => UniversalKey,
	render: (item: T, index: number) => UniversalRenderable,
	empty: (() => UniversalRenderable) | null = null,
): UniversalRenderable {
	return { $$kind: UNIVERSAL_FOR, items, key, render, empty } as unknown as UniversalRenderable;
}

export function defineUniversalComponent<P>(
	renderer: string,
	render: (props: P, context: UniversalRenderContext) => UniversalRenderable,
	metadata?: { module?: string },
): UniversalComponent<P> {
	assertRenderer(renderer);
	Object.defineProperty(render, UNIVERSAL_COMPONENT, {
		value: Object.freeze({ id: renderer, module: metadata?.module, target: 'universal' }),
	});
	return render as UniversalComponent<P>;
}

export const firstScreenEvent = FIRST_SCREEN_EVENT;

function componentContext(): UniversalRenderContext {
	return {
		renderer: 'lynx',
		readContext() {
			return fail('received context after capability proof');
		},
		insertionEffect() {},
		layoutEffect() {},
		effect() {},
	};
}

function range(children: CompactNode[]): CompactRangeNode {
	return { kind: 'range', id: 0, children };
}

interface ProgramValueSite {
	readonly type: string;
	readonly name: string;
}

const PROGRAM_VALUE_SITES = new WeakMap<UniversalProgramPlan, readonly ProgramValueSite[]>();

function programValueSites(plan: UniversalProgramPlan): readonly ProgramValueSite[] {
	const cached = PROGRAM_VALUE_SITES.get(plan);
	if (cached !== undefined) return cached;
	const wire = plan.wire;
	if (wire === undefined) fail('received a resident program without its wire descriptor');
	const sites: (ProgramValueSite | undefined)[] = new Array(plan.values.length);
	for (const node of wire.nodes) {
		for (const binding of node.bindings ?? []) {
			if (
				binding.valueIndex < 0 ||
				binding.valueIndex >= sites.length ||
				sites[binding.valueIndex] !== undefined
			) {
				fail('received a resident program with an invalid value binding');
			}
			sites[binding.valueIndex] = Object.freeze({ type: node.type, name: binding.name });
		}
	}
	if (sites.includes(undefined)) {
		fail('received a resident program with an unbound value slot');
	}
	const complete = Object.freeze(sites as ProgramValueSite[]);
	PROGRAM_VALUE_SITES.set(plan, complete);
	return complete;
}

function selectedProgramValues(
	plan: UniversalProgramPlan,
	values: readonly unknown[],
): readonly (string | number | boolean | null)[] {
	const sites = programValueSites(plan);
	const selected: (string | number | boolean | null)[] = new Array(sites.length);
	for (let index = 0; index < sites.length; index++) {
		const site = sites[index]!;
		const value = encodeLynxProgramPropValue(site.type, site.name, values[plan.values[index]!]);
		const type = typeof value;
		if (
			value !== null &&
			type !== 'string' &&
			type !== 'boolean' &&
			(type !== 'number' || !Number.isFinite(value))
		) {
			fail(`cannot encode value slot ${index} for the compact transport`);
		}
		selected[index] = value as string | number | boolean | null;
	}
	return Object.freeze(selected);
}

function program(value: PlanValue): CompactProgramNode {
	const plan = value.plan;
	if (plan.kind !== 'program') fail('received an unaddressed plan at render time');
	const children: CompactNode[] = [];
	const spans: number[] = [];
	const texts: (string | undefined)[] = [];
	for (const site of plan.ranges) {
		const selected = value.values[site.slot];
		if (site.paintsText === true && typeof selected === 'string') {
			texts.push(selected);
			spans.push(0);
			continue;
		}
		texts.push(undefined);
		const members = materialize(selected);
		spans.push(members.length);
		for (const member of members) children.push(member);
	}
	return {
		kind: 'program',
		id: 0,
		children,
		plan,
		values: value.values,
		selectedValues: selectedProgramValues(plan, value.values),
		ids: [],
		spans,
		texts,
		rangeIds: [],
		eventsAt: 0,
		eventsCount: 0,
	};
}

function renderComponent(value: ComponentValue): CompactRangeNode {
	const metadata = (value.component as unknown as Record<PropertyKey, unknown>)[
		UNIVERSAL_COMPONENT
	] as { readonly id?: unknown } | undefined;
	if (metadata?.id !== 'lynx') fail('received an uncompiled child component');
	return range(materialize(value.component(value.props.props, componentContext())));
}

function materialize(value: unknown): CompactNode[] {
	if (value == null || value === false || value === true) return [];
	const record = value as Record<string, unknown>;
	if (record?.$$kind === UNIVERSAL_VALUE) return [program(value as unknown as PlanValue)];
	if (record?.$$kind === UNIVERSAL_COMPONENT_VALUE) {
		return [renderComponent(value as unknown as ComponentValue)];
	}
	if (record?.$$kind === UNIVERSAL_FOR) {
		const loop = value as unknown as ForValue;
		const output: CompactNode[] = [];
		const keys = new Set<UniversalKey>();
		let index = 0;
		for (const item of loop.items) {
			const key = loop.key(item, index);
			if (keys.has(key)) fail(`received duplicate key ${String(key)}`);
			keys.add(key);
			output.push(range(materialize(loop.render(item, index++))));
		}
		if (index === 0 && loop.empty !== null) return [range(materialize(loop.empty()))];
		return output;
	}
	if (Array.isArray(value)) {
		const output: CompactNode[] = [];
		for (const child of value) output.push(...materialize(child));
		return output;
	}
	return fail('received an unaddressed renderable');
}

function assignProgramIds(node: CompactProgramNode, next: { id: number }): void {
	const ranges = node.plan.ranges;
	const ids = new Array<number>(node.plan.nodes);
	const rangeIds = new Array<number | undefined>(ranges.length);
	let host = 0;
	let hole = 0;
	let member = 0;
	for (let position = 0; position < node.plan.nodes + ranges.length; position++) {
		if (hole < ranges.length && ranges[hole]!.id === position) {
			if (node.texts[hole] !== undefined) {
				rangeIds[hole++] = next.id++;
				continue;
			}
			const end = member + node.spans[hole++]!;
			for (; member < end; member++) {
				const child = node.children[member]!;
				child.id = next.id++;
				assignIds(child.children, next);
			}
			continue;
		}
		ids[host++] = next.id++;
	}
	if (hole !== ranges.length || host !== node.plan.nodes)
		fail('received an invalid range position');
	node.ids = ids;
	node.rangeIds = rangeIds;
}

function assignIds(nodes: readonly CompactNode[], next: { id: number }): void {
	for (const node of nodes) {
		if (node.kind === 'program') {
			node.id = next.id;
			assignProgramIds(node, next);
		} else {
			node.id = next.id++;
			assignIds(node.children, next);
		}
	}
}

function collectEvents(
	nodes: readonly CompactNode[],
	next: { listener: number },
	events: LynxFirstScreenResultEvent[],
): number {
	let hosts = 0;
	for (const node of nodes) {
		if (node.kind === 'range') {
			hosts += collectEvents(node.children, next, events);
			continue;
		}
		hosts += node.plan.nodes;
		node.eventsAt = events.length;
		const ranges = node.plan.ranges;
		const sites = node.plan.events;
		let hole = 0;
		let member = 0;
		let host = 0;
		let event = 0;
		for (let position = 0; position < node.plan.nodes + ranges.length; position++) {
			if (hole < ranges.length && ranges[hole]!.id === position) {
				if (node.texts[hole] !== undefined) hosts++;
				else {
					const end = member + node.spans[hole]!;
					for (; member < end; member++) {
						hosts += collectEvents([node.children[member]!], next, events);
					}
				}
				hole++;
				continue;
			}
			while (event < sites.length && sites[event]!.node === host) {
				const site = sites[event++]!;
				const handler = node.values[site.slot];
				const listener = next.listener++;
				if (handler === FIRST_SCREEN_EVENT || typeof handler === 'function') {
					events.push({
						id: node.ids[host]!,
						type: site.type,
						listener: { id: listener, priority: site.priority },
					});
				}
			}
			host++;
		}
		node.eventsCount = events.length - node.eventsAt;
	}
	return hosts;
}

let rendering = false;
let nextHookSlot = 0;
const NOOP_UPDATE = () => {};

export function renderLynxFirstScreen<Props>(
	component: UniversalComponent<Props>,
	props: Props,
): LynxFirstScreenRenderResult {
	if (rendering) fail('cannot render reentrantly');
	const metadata = (component as unknown as Record<PropertyKey, unknown>)[UNIVERSAL_COMPONENT] as
		{ readonly id?: unknown } | undefined;
	if (metadata?.id !== 'lynx') fail('requires a compiled Lynx component');
	rendering = true;
	let nodes: CompactNode[];
	try {
		nodes = materialize(component(props, componentContext()));
	} finally {
		rendering = false;
	}
	const ids = { id: 1 };
	assignIds(nodes, ids);
	const listeners = { listener: 1 };
	const events: LynxFirstScreenResultEvent[] = [];
	const hostCount = collectEvents(nodes, listeners, events);
	return Object.freeze({
		get batch(): never {
			return fail('has no command batch');
		},
		nodes,
		envelope: Object.freeze({ renderer: 'lynx' as const, version: 1 as const, events }),
		hostCount,
		programs: countPrograms(nodes),
		logicalCount: ids.id - 1,
	});
}

function countPrograms(nodes: readonly CompactNode[]): number {
	let count = 0;
	for (const node of nodes) {
		if (node.kind === 'program') count++;
		count += countPrograms(node.children);
	}
	return count;
}

function requireRender(): void {
	if (!rendering) fail('hook ran outside render');
}

export function hookSlots(count: number): number {
	const first = nextHookSlot;
	nextHookSlot += count;
	return first;
}

export function withSlot<T>(_slot: unknown, fn: (...args: any[]) => T, ...args: any[]): T {
	return fn(...args);
}

export function useState<T>(
	initial: T | (() => T),
	_slot?: unknown,
): [T, (value: T | ((previous: T) => T)) => void, () => T] {
	requireRender();
	const value = typeof initial === 'function' ? (initial as () => T)() : initial;
	return [value, NOOP_UPDATE, () => value];
}

export const __useStateWithGetter = useState;

export function useCallback<T extends (...args: any[]) => any>(
	callback: T,
	_deps?: readonly unknown[] | null,
	_slot?: unknown,
): T {
	requireRender();
	return callback;
}

export function useRef<T>(initial: T, _slot?: unknown): { current: T } {
	requireRender();
	return { current: initial };
}

export function useEffect(): void {
	requireRender();
}

export function useSyncExternalStore<T>(
	_subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => T,
): T {
	requireRender();
	return getSnapshot();
}
