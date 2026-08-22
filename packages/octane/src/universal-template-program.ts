/**
 * Issue-#135 item 1 — the plan → template-program lowering, extracted from the
 * universal root so a second core can perform it.
 *
 * `universal-core.ts` already knows how to turn a compiled plan into a
 * `UniversalHostTemplateProgram`: that is what a collapsed-template mount is,
 * and `mount-template-run` carries the result. But it knew it as a private
 * method on `UniversalRootImpl`, which makes the knowledge unreachable from
 * anywhere that is not the universal root — including the Lynx Block core,
 * whose whole reason to exist is that the universal root is *not* in its
 * bundle. A block bundle that imported the lowering through the root would
 * drag the interpreter back in and cancel the flag.
 *
 * So this is the second extraction slice after `universal-kernel.ts`, and it
 * follows the same rule: no owner, root, record, command, or scheduler
 * dependency. What it does carry is the host encoder, because the lowering is
 * *defined* in terms of it — "which prop is an event", "what does this
 * renderer encode `class` to", "is this static prop stable enough to share" —
 * and a second implementation of those questions is a second source of truth
 * about what a plan means. One encoder, two cores.
 *
 * ## Why the lowering is a runtime pass and not a compiler backend
 *
 * A compiled plan says `{kind: 'slot', slot: n}` for every dynamic child hole,
 * because a hole in the universal encoding is a *renderable* hole — it may hold
 * a string, a component, a keyed range, or nothing. Whether it is text is a
 * property of the value, not of the source: the compiler emits the same node
 * for `{row.label}` as for `{<Row />}`, and the `as string` cast the authoring
 * rules ask for is a type-checking affordance that is erased long before the
 * universal backend runs. A template program, by contrast, must say `#text`
 * with a `value` binding or say nothing at all.
 *
 * That gap is only closable where the values are: at mount. So the lowering
 * runs once per plan (cached), the *values* are re-checked per instance
 * (`prepareUniversalTemplateProgramValues`), and an instance whose hole turned
 * out to hold something that is not a scalar declines the program rather than
 * mis-describing it.
 */

import type {
	UniversalEventDefinition,
	UniversalEventPriority,
	UniversalHostCallbackDefinition,
	UniversalHostCapabilities,
	UniversalHostDriver,
	UniversalHostPlan,
	UniversalHostTemplateProgram,
	UniversalHostTemplateProgramBinding,
	UniversalHostTemplateProgramEvent,
	UniversalHostTemplateProgramNode,
	UniversalHostTemplateProgramValue,
	UniversalHostTemplateShapeNode,
	UniversalPlanNode,
	UniversalResourceHandle,
	UniversalSerializableValue,
	UniversalSlotPlan,
	UniversalTextPlan,
	UniversalTextPolicy,
} from './universal-core.js';

/** The shared empty static-prop record every propless host node points at. */
export const EMPTY_STATIC_HOST_PROPS: Record<string, unknown> = Object.freeze({});

/**
 * Whether a prototype chain is one hop from null in *any* realm.
 *
 * A value can reach this core from a realm whose `Object.prototype` is not this
 * realm's `Object.prototype` (an engine main thread hosted in an iframe realm,
 * an Electron process split, `node:vm`), so an identity test against this
 * realm's prototype misclassifies every structurally plain value that crossed a
 * boundary. Accept a null prototype, or any prototype one hop from null — the
 * shape of every realm's `Object.prototype`; class and built-in instances are
 * still rejected. `value` must already be a non-null, non-array object.
 */
export function hasCrossRealmPlainPrototype(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * Deep-clone a host value into something the wire can carry.
 *
 * Frozen at every level and cycle-checked, because what comes back is handed to
 * a peer that cannot re-validate it cheaply.
 */
export function cloneSerializableValue(
	value: unknown,
	seen: WeakSet<object> = new WeakSet(),
): UniversalSerializableValue {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (typeof value !== 'object') {
		throw new TypeError(`Unsupported serializable host value ${String(value)}.`);
	}
	if ((value as Partial<UniversalResourceHandle>).$$kind === 'octane.universal.resource') {
		throw new TypeError('A resource handle must use the resource encoding branch.');
	}
	if (seen.has(value)) throw new TypeError('Serializable host values cannot contain cycles.');
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return Object.freeze(value.map((entry) => cloneSerializableValue(entry, seen)));
		}
		if (!hasCrossRealmPlainPrototype(value)) {
			throw new TypeError(
				`Serializable host values require plain objects, received ${Object.prototype.toString.call(value)}.`,
			);
		}
		const output: Record<string, UniversalSerializableValue> = {};
		for (const [name, entry] of Object.entries(value)) {
			Object.defineProperty(output, name, {
				configurable: true,
				enumerable: true,
				value: cloneSerializableValue(entry, seen),
				writable: true,
			});
		}
		return Object.freeze(output);
	} finally {
		seen.delete(value);
	}
}

/**
 * A value a template program may carry in a value slot.
 *
 * Scalar-only, because it guards the core's own program derivation, which never
 * produces a renderer-namespaced slot. The namespaced case is admitted by
 * `isUniversalHostTemplateProgramSlotValue` below, which knows the binding name.
 */
export function isUniversalHostTemplateProgramValue(
	value: unknown,
): value is UniversalHostTemplateProgramValue {
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
 * Whether a value may occupy the slot the program bound to `name`.
 *
 * A renderer-namespaced slot is the one place a non-scalar belongs, and the core
 * checks only that the renderer's encoder produced something transportable: the
 * core cannot know what such a value means, and the driver that consumes the
 * program owns validating it. A function is the one shape refused outright — it
 * is what the encoder exists to replace, so one surviving here means the
 * renderer declined to encode and the run must not carry it.
 */
export function isUniversalHostTemplateProgramSlotValue(name: string, value: unknown): boolean {
	if (isUniversalHostTemplateProgramValue(value)) return true;
	return typeof value === 'object' && value !== null && name.includes(':');
}

/**
 * Everything the lowering asks a renderer, and the one implementation of it.
 *
 * These were seven methods on `UniversalRootImpl`, each a thin read of
 * `this.driver` plus a per-root cache. Extracting them as an object rather than
 * as seven free functions keeps the caches — which is the point of
 * `materializeStaticHostProps` and `classifyEvent` — without handing every call
 * site a cache to thread.
 */
export interface UniversalHostEncoder {
	capabilities(): UniversalHostCapabilities;
	textPolicy(): UniversalTextPolicy;
	classifyEvent(name: string): UniversalEventDefinition | null;
	classifyLifecycle(name: string, value: unknown): UniversalHostCallbackDefinition | null;
	classifyLocalCallback(name: string, value: unknown): UniversalHostCallbackDefinition | null;
	encodeHostProp(hostType: string, name: string, value: unknown): unknown;
	/**
	 * The frozen, encoded static props of a plan node, or `null` when the node
	 * has none that can be shared — a props program, any binding, a symbol key,
	 * a filtered or classified name, or a non-scalar literal.
	 */
	materializeStaticHostProps(node: UniversalHostPlan): Record<string, unknown> | null;
	/**
	 * @internal `prepareUniversalTemplateProgram`'s memo, held here rather than
	 * in a module map keyed by encoder: the lowering is consulted once per
	 * mount, so the difference between a property read and a `WeakMap.get` is
	 * paid per mounted template.
	 */
	readonly templatePrograms: WeakMap<
		CompiledUniversalTemplateProgram,
		PreparedUniversalTemplateProgram | null
	>;
}

export interface UniversalHostEncoderOptions<Container = unknown> {
	readonly driver: UniversalHostDriver<Container, any>;
	readonly container: Container;
	/** Renderer id every resource handle and diagnostic is stamped with. */
	readonly renderer: string;
	/** Resource-handle namespace, so a handle from another root is rejected. */
	readonly resourceRoot: number;
	/**
	 * Whether the values leave this realm. A local driver may intentionally
	 * accept renderer-owned objects; once a transport is present every ordinary
	 * prop must satisfy the wire value contract even when the renderer did not
	 * install a custom codec.
	 */
	readonly transported: boolean;
}

export function createUniversalHostEncoder<Container>(
	options: UniversalHostEncoderOptions<Container>,
): UniversalHostEncoder {
	const { driver, container, renderer, resourceRoot, transported } = options;
	let eventDefinitions: Map<string, UniversalEventDefinition | null> | null = null;
	let staticHostProps: WeakMap<UniversalHostPlan, Record<string, unknown> | null> | null = null;

	const encoder: UniversalHostEncoder = {
		templatePrograms: new WeakMap(),

		capabilities() {
			return driver.capabilities ?? {};
		},

		textPolicy() {
			return driver.capabilities?.text ?? 'reject';
		},

		classifyEvent(name) {
			const capability = driver.events;
			if (capability === undefined) return null;
			const definitions = (eventDefinitions ??= new Map());
			const cached = definitions.get(name);
			if (cached !== undefined) return cached;
			const definition = capability.classify(name) ?? null;
			// Bounded, because the key space is whatever an author wrote: a page
			// that spells a thousand distinct prop names must not retain a
			// thousand entries to answer "no" a thousand times.
			if (definitions.size < 128) definitions.set(name, definition);
			return definition;
		},

		classifyLifecycle(name, value) {
			return driver.lifecycles?.classify(name, value) ?? null;
		},

		classifyLocalCallback(name, value) {
			return driver.localCallbacks?.classify(name, value) ?? null;
		},

		encodeHostProp(hostType, name, value) {
			const codec = driver.props;
			if (codec === undefined) return transported ? cloneSerializableValue(value) : value;
			const result = codec.encode({
				container,
				renderer,
				hostType,
				name,
				value,
				createResourceHandle: (id) => {
					if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length === 0) {
						throw new TypeError(
							'A universal resource handle ID must be a non-empty string or number.',
						);
					}
					return Object.freeze({
						$$kind: 'octane.universal.resource' as const,
						renderer,
						root: resourceRoot,
						id,
					});
				},
			});
			if (result === null || typeof result !== 'object') {
				throw new TypeError(
					`Universal prop codec for ${JSON.stringify(name)} returned an invalid result.`,
				);
			}
			if (result.kind === 'unsupported') {
				throw new TypeError(
					result.reason ??
						`Universal renderer ${JSON.stringify(renderer)} does not support host prop ${JSON.stringify(name)}.`,
				);
			}
			if (result.kind === 'value') return cloneSerializableValue(result.value);
			if (result.kind !== 'resource') {
				throw new TypeError(
					`Universal prop codec for ${JSON.stringify(name)} returned unknown encoding ${JSON.stringify((result as { kind: unknown }).kind)}.`,
				);
			}
			const handle = result.handle;
			if (
				handle?.$$kind !== 'octane.universal.resource' ||
				handle.renderer !== renderer ||
				handle.root !== resourceRoot ||
				(typeof handle.id !== 'string' && typeof handle.id !== 'number')
			) {
				throw new Error(
					`Universal resource handle for ${JSON.stringify(name)} does not belong to renderer ${JSON.stringify(renderer)} and this root.`,
				);
			}
			return handle;
		},

		materializeStaticHostProps(node) {
			if (node.propsSlot !== undefined || (node.bindings?.length ?? 0) !== 0) return null;
			const source = node.props ?? EMPTY_STATIC_HOST_PROPS;
			if (source === EMPTY_STATIC_HOST_PROPS) return EMPTY_STATIC_HOST_PROPS;
			if (driver.props !== undefined && driver.capabilities?.stableStaticHostProps !== true) {
				return null;
			}
			const cache = (staticHostProps ??= new WeakMap());
			const cached = cache.get(node);
			if (cached !== undefined) return cached;
			if (Object.getOwnPropertySymbols(source).length !== 0) {
				cache.set(node, null);
				return null;
			}
			const names = Object.keys(source);
			for (const name of names) {
				const value = source[name];
				if (
					name === 'ref' ||
					name === 'key' ||
					name === 'children' ||
					name.startsWith('main-thread:') ||
					(value !== null &&
						(typeof value === 'object' ||
							typeof value === 'function' ||
							typeof value === 'symbol')) ||
					encoder.classifyLifecycle(name, value) !== null ||
					encoder.classifyLocalCallback(name, value) !== null ||
					encoder.classifyEvent(name) !== null
				) {
					cache.set(node, null);
					return null;
				}
			}
			let props = source as Record<string, unknown>;
			for (const name of names) {
				const encoded = encoder.encodeHostProp(node.type, name, source[name]);
				if (!Object.is(encoded, source[name])) {
					if (props === source) props = { ...source };
					props[name] = encoded;
				}
			}
			Object.freeze(props);
			cache.set(node, props);
			return props;
		},
	};
	return encoder;
}

/**
 * The static shape a plan paints: one entry per host node, pre-order, each
 * naming its parent's index. `-1` is the root. This is what both the run
 * encoding and the record expansion index into, so it is derived once per plan
 * and shared.
 */
const UNIVERSAL_HOST_TEMPLATE_SHAPES = new WeakMap<
	UniversalHostPlan,
	readonly UniversalHostTemplateShapeNode[] | null
>();

export function universalHostTemplateShape(
	plan: UniversalHostPlan,
): readonly UniversalHostTemplateShapeNode[] | null {
	const cached = UNIVERSAL_HOST_TEMPLATE_SHAPES.get(plan);
	if (cached !== undefined) return cached;
	const output: UniversalHostTemplateShapeNode[] = [];
	const visit = (node: UniversalPlanNode, parent: number): boolean => {
		if (node.kind === 'range') {
			for (const child of node.children) if (!visit(child, parent)) return false;
			return true;
		}
		if (node.kind === 'text' || node.kind === 'slot') {
			output.push(Object.freeze({ type: '#text', parent }));
			return true;
		}
		if (node.kind !== 'host') return false;
		if (node.type === 'list' || node.type === 'list-item') return false;
		const index = output.length;
		output.push(Object.freeze({ type: node.type, parent }));
		for (const child of node.children ?? []) if (!visit(child, index)) return false;
		return true;
	};
	const shape = visit(plan, -1) && output.length > 1 ? Object.freeze(output) : null;
	UNIVERSAL_HOST_TEMPLATE_SHAPES.set(plan, shape);
	return shape;
}

/** A plan whose every node is compile-time host structure, flattened. */
export interface CompiledUniversalTemplateProgram {
	readonly shape: readonly UniversalHostTemplateShapeNode[];
	readonly plans: readonly (UniversalHostPlan | UniversalTextPlan | UniversalSlotPlan)[];
}

/** Which plan slot feeds wire value `index`, and what it writes. */
export interface PreparedUniversalTemplateProgramValue {
	readonly node: number;
	readonly name: string;
	readonly slot: number;
	readonly text: boolean;
}

/** Which plan slot holds the handler for wire event site `index`. */
export interface PreparedUniversalTemplateProgramEvent {
	readonly node: number;
	readonly prop: string;
	readonly slot: number;
	readonly type: string;
	readonly priority: UniversalEventPriority;
}

export interface PreparedUniversalTemplateProgram {
	readonly wire: UniversalHostTemplateProgram;
	readonly values: readonly PreparedUniversalTemplateProgramValue[];
	readonly events: readonly PreparedUniversalTemplateProgramEvent[];
}

const COMPILED_UNIVERSAL_TEMPLATE_PROGRAMS = new WeakMap<
	UniversalHostPlan,
	CompiledUniversalTemplateProgram | null
>();

/**
 * Flatten a plan into the node list a template program describes, or `null`
 * when some node is not compile-time host structure.
 *
 * `plans.length === shape.length` is the whole refusal: `universalHostTemplateShape`
 * walks every node kind, this walk stops at the first one a program cannot
 * describe, so a mismatch means the shape saw a node this did not.
 */
export function compiledUniversalTemplateProgram(
	plan: UniversalHostPlan,
): CompiledUniversalTemplateProgram | null {
	const cached = COMPILED_UNIVERSAL_TEMPLATE_PROGRAMS.get(plan);
	if (cached !== undefined) return cached;
	const shape = universalHostTemplateShape(plan);
	if (shape === null) {
		COMPILED_UNIVERSAL_TEMPLATE_PROGRAMS.set(plan, null);
		return null;
	}
	const plans: (UniversalHostPlan | UniversalTextPlan | UniversalSlotPlan)[] = [];
	const visit = (node: UniversalPlanNode): boolean => {
		if (node.kind === 'slot' || node.kind === 'text') {
			plans.push(node);
			return true;
		}
		if (node.kind !== 'host' || node.propsSlot !== undefined) return false;
		for (const name of Object.keys(node.props ?? EMPTY_STATIC_HOST_PROPS)) {
			if (
				name === 'ref' ||
				name === 'key' ||
				name === 'children' ||
				name.startsWith('main-thread:')
			) {
				return false;
			}
		}
		for (const [name] of node.bindings ?? []) {
			// A renderer-namespaced prop stays eligible as a *binding*: it names a
			// per-instance slot, which is exactly what a program describes. The static
			// loop above is unchanged, so a static `main-thread:` prop is still
			// refused — a worklet is produced by setup and never written as a literal.
			if (name === 'ref' || name === 'key' || name === 'children') return false;
		}
		plans.push(node);
		for (const child of node.children ?? []) if (!visit(child)) return false;
		return true;
	};
	const program =
		visit(plan) && plans.length === shape.length
			? Object.freeze({ shape, plans: Object.freeze(plans) })
			: null;
	COMPILED_UNIVERSAL_TEMPLATE_PROGRAMS.set(plan, program);
	return program;
}

/**
 * Derive the wire program and its slot maps, or `null` when this renderer
 * cannot describe the plan as a program.
 *
 * Memoized on the encoder rather than on the plan: the same plan lowered for
 * two renderers is two different wire programs, and one cache must not answer
 * for the other.
 */
export function prepareUniversalTemplateProgram(
	encoder: UniversalHostEncoder,
	compiled: CompiledUniversalTemplateProgram,
): PreparedUniversalTemplateProgram | null {
	const capabilities = encoder.capabilities();
	if (
		capabilities.templateProgramMount !== true ||
		capabilities.stableStaticHostProps !== true ||
		encoder.textPolicy() !== 'host'
	) {
		return null;
	}
	const cache = encoder.templatePrograms;
	const cached = cache.get(compiled);
	if (cached !== undefined) return cached;
	const wireNodes: UniversalHostTemplateProgramNode[] = [];
	const wireEvents: UniversalHostTemplateProgramEvent[] = [];
	const values: PreparedUniversalTemplateProgramValue[] = [];
	const events: PreparedUniversalTemplateProgramEvent[] = [];
	const reject = (): null => {
		cache.set(compiled, null);
		return null;
	};
	for (let index = 0; index < compiled.plans.length; index++) {
		const node = compiled.plans[index]!;
		const shape = compiled.shape[index]!;
		if (node.kind === 'slot' || node.kind === 'text') {
			if (node.kind === 'text' && node.slot === undefined) {
				const props = Object.freeze({ value: String(node.value ?? '') });
				wireNodes.push(Object.freeze({ type: shape.type, parent: shape.parent, props }));
			} else {
				const valueIndex = values.length;
				values.push({ node: index, name: 'value', slot: node.slot!, text: true });
				const binding = Object.freeze({ name: 'value', valueIndex });
				wireNodes.push(
					Object.freeze({
						type: shape.type,
						parent: shape.parent,
						props: EMPTY_STATIC_HOST_PROPS,
						bindings: Object.freeze([binding]),
					}),
				);
			}
			continue;
		}
		const source = node.props ?? EMPTY_STATIC_HOST_PROPS;
		const overwritten = new Set<string>();
		for (const [name] of node.bindings ?? []) {
			if (overwritten.has(name)) return reject();
			overwritten.add(name);
		}
		let staticProps: Record<string, unknown>;
		if (overwritten.size === 0) {
			const shared = encoder.materializeStaticHostProps(node);
			if (shared === null) return reject();
			staticProps = shared;
		} else {
			let output: Record<string, unknown> | null = null;
			for (const name of Object.keys(source)) {
				if (overwritten.has(name)) continue;
				const entry = source[name];
				if (
					!isUniversalHostTemplateProgramValue(entry) ||
					encoder.classifyLifecycle(name, entry) !== null ||
					encoder.classifyLocalCallback(name, entry) !== null ||
					encoder.classifyEvent(name) !== null
				) {
					return reject();
				}
				const encoded = encoder.encodeHostProp(node.type, name, entry);
				if (!isUniversalHostTemplateProgramValue(encoded)) return reject();
				(output ??= {})[name] = encoded;
			}
			staticProps = output === null ? EMPTY_STATIC_HOST_PROPS : Object.freeze(output);
		}
		const bindings: UniversalHostTemplateProgramBinding[] = [];
		const types = new Set<string>();
		for (const [name, slot] of node.bindings ?? []) {
			const definition = encoder.classifyEvent(name);
			if (definition !== null) {
				if (index === 0 || types.has(definition.type)) return reject();
				types.add(definition.type);
				const priority = definition.priority ?? 'default';
				wireEvents.push(Object.freeze({ node: index, type: definition.type, priority }));
				events.push({ node: index, prop: name, slot, type: definition.type, priority });
				continue;
			}
			const valueIndex = values.length;
			values.push({ node: index, name, slot, text: false });
			bindings.push(Object.freeze({ name, valueIndex }));
		}
		wireNodes.push(
			Object.freeze({
				type: shape.type,
				parent: shape.parent,
				props: staticProps,
				...(bindings.length === 0 ? null : { bindings: Object.freeze(bindings) }),
			}),
		);
	}
	const prepared = Object.freeze({
		wire: Object.freeze({ nodes: Object.freeze(wireNodes), events: Object.freeze(wireEvents) }),
		values: Object.freeze(values),
		events: Object.freeze(events),
	});
	cache.set(compiled, prepared);
	return prepared;
}

/**
 * The per-instance half: the wire values for one set of plan slot values, or
 * `null` when this instance is not describable by the program after all.
 *
 * This is where the runtime pass earns its existence. A `#text` value slot came
 * from a renderable hole, so it is checked for actually holding a scalar; an
 * event slot is checked for holding a function. An instance that fails either
 * declines the program and renders the ordinary way.
 */
export function prepareUniversalTemplateProgramValues(
	encoder: UniversalHostEncoder,
	compiled: CompiledUniversalTemplateProgram,
	prepared: PreparedUniversalTemplateProgram,
	slotValues: readonly unknown[],
): readonly UniversalHostTemplateProgramValue[] | null {
	for (const site of prepared.events) {
		if (typeof slotValues[site.slot] !== 'function') return null;
	}
	const values: UniversalHostTemplateProgramValue[] = new Array(prepared.values.length);
	for (let index = 0; index < prepared.values.length; index++) {
		const binding = prepared.values[index]!;
		const source = slotValues[binding.slot];
		if (binding.text) {
			if (typeof source !== 'string' && typeof source !== 'number' && typeof source !== 'bigint') {
				return null;
			}
			values[index] = String(source);
			continue;
		}
		// A renderer-namespaced binding is authored as whatever the renderer's
		// encoder understands — for Lynx, the tagged function a worklet compiles to —
		// so the source is checked for what it must not be rather than for being a
		// scalar, and the encoded result is what has to be transportable.
		const namespaced = binding.name.includes(':');
		if (
			(!namespaced && !isUniversalHostTemplateProgramValue(source)) ||
			encoder.classifyLifecycle(binding.name, source) !== null ||
			encoder.classifyLocalCallback(binding.name, source) !== null
		) {
			return null;
		}
		const encoded = encoder.encodeHostProp(
			compiled.shape[binding.node]!.type,
			binding.name,
			source,
		);
		if (!isUniversalHostTemplateProgramSlotValue(binding.name, encoded)) return null;
		values[index] = encoded as UniversalHostTemplateProgramValue;
	}
	return Object.freeze(values);
}
