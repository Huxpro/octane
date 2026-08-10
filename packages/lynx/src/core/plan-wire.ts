/**
 * Plan-aware commit wire: one `instantiate` instruction per plan instance.
 *
 * A creation burst dominated by keyed list items ships, per item, one create
 * and one insert per physical node plus one event announcement per listener —
 * all derivable from the item's compiled `UniversalPlan` and its slot values.
 * Both Lynx bundles compile the same `.tsrx`, so the same plan exists on both
 * threads as a module constant. This module gives those structurally identical
 * plans a shared content-derived identity, folds an eligible instance's
 * commands into one `instantiate(planId, …)` wire command on the background
 * thread, and expands it back into the identical per-node commands on the main
 * thread before the untouched Element PAPI apply path runs.
 *
 * Fail-safe by construction: the background folds only plan IDs the main
 * thread has announced from its registry, and any instance the static or
 * per-value checks cannot prove reproducible keeps its per-node commands. A
 * plan the main thread never registered (HMR skew, lazy chunks, hash
 * collision) is simply never announced, so the wire degrades to per-node
 * commands rather than failing.
 *
 * Both threads import this one module, so the expansion rules and the
 * background eligibility rules cannot drift apart. Everything here is
 * PrimJS-safe: no scheduler, no DOM, no async.
 */
import type {
	UniversalEventPriority,
	UniversalHostBatch,
	UniversalHostCommand,
	UniversalHostParent,
	UniversalPlan,
	UniversalPlanInstance,
	UniversalPlanNode,
} from 'octane/universal/native';
import { parseLynxNativeEventProp } from './native-events.js';

/** One staged listener of an instantiated subtree, keyed by its host ID. */
export interface LynxInstantiateEventEntry {
	readonly id: number;
	readonly type: string;
	readonly listener: number;
	readonly priority: UniversalEventPriority;
}

/**
 * The plan-aware wire command. `ids` lists every physical host of the
 * instance in the pre-order the plan walk produces them — `ids[0]` is the
 * single root host, inserted at `parent`/`before`. `values` is the instance's
 * slot-value array with every slot that does not cross the wire (event
 * handlers, unused slots) scrubbed to null.
 */
export interface LynxInstantiateCommand {
	readonly op: 'instantiate';
	readonly plan: string;
	readonly parent: UniversalHostParent;
	readonly before: number | null;
	readonly ids: readonly number[];
	readonly values: readonly unknown[];
	readonly events: readonly LynxInstantiateEventEntry[];
}

export type LynxWireHostCommand = UniversalHostCommand | LynxInstantiateCommand;

/** A commit batch as carried on the Lynx wire; a superset of the host batch. */
export interface LynxWireHostBatch {
	readonly renderer: string;
	readonly version: number;
	readonly commands: readonly LynxWireHostCommand[];
}

/* ------------------------------------------------------------------------- *
 * Content-derived plan identity
 * ------------------------------------------------------------------------- */

/**
 * Serialize the JSON-shaped subset of a plan-prop value with sorted object
 * keys, so structurally equal literals from either bundle canonicalize to the
 * same bytes. Returns null for anything JSON cannot carry (functions, symbols,
 * bigint, cycles are impossible in frozen compiler literals).
 */
function canonicalValue(value: unknown, out: string[]): boolean {
	if (value === null) {
		out.push('null');
		return true;
	}
	switch (typeof value) {
		case 'string':
			out.push(JSON.stringify(value));
			return true;
		case 'number':
			return Number.isFinite(value) ? (out.push(String(value)), true) : false;
		case 'boolean':
			out.push(value ? 'true' : 'false');
			return true;
		case 'object':
			break;
		default:
			return false;
	}
	if (Array.isArray(value)) {
		out.push('[');
		for (const entry of value) {
			if (!canonicalValue(entry, out)) return false;
			out.push(',');
		}
		out.push(']');
		return true;
	}
	const record = value as Record<string, unknown>;
	out.push('{');
	for (const key of Object.keys(record).sort()) {
		out.push(JSON.stringify(key), ':');
		if (!canonicalValue(record[key], out)) return false;
		out.push(',');
	}
	out.push('}');
	return true;
}

function canonicalNode(node: UniversalPlanNode, out: string[]): boolean {
	switch (node.kind) {
		case 'host': {
			// Absent and empty props/bindings/children canonicalize identically:
			// each bundle's plan facade normalizes those differently (one stamps
			// `props: {}`, another omits the key) without changing what the plan
			// materializes.
			out.push('h(', JSON.stringify(node.type));
			if (node.props !== undefined && Object.keys(node.props).length !== 0) {
				out.push(';p');
				if (!canonicalValue(node.props, out)) return false;
			}
			if (node.bindings !== undefined && node.bindings.length !== 0) {
				out.push(';b');
				for (const [name, slot] of node.bindings) {
					out.push(JSON.stringify(name), '=', String(slot), ',');
				}
			}
			if (node.propsSlot !== undefined) out.push(';ps', String(node.propsSlot));
			for (const child of node.children ?? []) {
				out.push(';');
				if (!canonicalNode(child, out)) return false;
			}
			out.push(')');
			return true;
		}
		case 'text':
			// An absent static value materializes as the empty string; canonicalize
			// the two spellings identically, mirroring the expansion walk.
			out.push('t(');
			if (node.slot === undefined) out.push(JSON.stringify(node.value ?? ''));
			else out.push(';s', String(node.slot));
			out.push(')');
			return true;
		case 'slot':
			out.push('s(', String(node.slot), ')');
			return true;
		case 'range': {
			out.push('r(');
			for (const child of node.children) {
				if (!canonicalNode(child, out)) return false;
				out.push(';');
			}
			out.push(')');
			return true;
		}
		case 'if': {
			out.push('i(', String(node.conditionSlot), ';');
			if (!canonicalNode(node.then, out)) return false;
			if (node.else !== undefined) {
				out.push(';e;');
				if (!canonicalNode(node.else, out)) return false;
			}
			out.push(')');
			return true;
		}
		case 'switch': {
			out.push('w(', String(node.valueSlot));
			for (const [caseValue, child] of node.cases) {
				out.push(';c');
				if (!canonicalValue(caseValue, out)) return false;
				out.push(':');
				if (!canonicalNode(child, out)) return false;
			}
			if (node.default !== undefined) {
				out.push(';d:');
				if (!canonicalNode(node.default, out)) return false;
			}
			out.push(')');
			return true;
		}
		// A component reference is a function identity; it has no stable
		// cross-bundle serialization, so the containing plan is unhashable.
		case 'component':
			return false;
	}
	/* v8 ignore next 2 -- the switch above is exhaustive over plan kinds. */
	return false;
}

function fnv1a(text: string, seed: number): number {
	let hash = seed >>> 0;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

const PLAN_WIRE_IDS = new WeakMap<UniversalPlan, string | null>();

/**
 * Content-derived wire identity of a plan, identical for structurally equal
 * plans across bundles and realms. Null when the plan has no stable
 * serialization (component references, non-JSON props).
 */
export function lynxPlanWireId(plan: UniversalPlan): string | null {
	const cached = PLAN_WIRE_IDS.get(plan);
	if (cached !== undefined) return cached;
	const out: string[] = [];
	const id = canonicalNode(plan.root, out) ? hashCanonicalPlan(out.join('')) : null;
	PLAN_WIRE_IDS.set(plan, id);
	return id;
}

function hashCanonicalPlan(canonical: string): string {
	const high = fnv1a(canonical, 0x811c9dc5);
	const low = fnv1a(canonical, 0xdeadbeef);
	return `${high.toString(36)}${low.toString(36)}-${canonical.length.toString(36)}`;
}

function canonicalLynxPlan(plan: UniversalPlan): string | null {
	const out: string[] = [];
	return canonicalNode(plan.root, out) ? out.join('') : null;
}

/* ------------------------------------------------------------------------- *
 * Static wire eligibility
 * ------------------------------------------------------------------------- */

interface LynxPlanWireShape {
	/** Slots whose raw value crosses the wire (prop bindings, text, slot nodes). */
	readonly valueSlots: ReadonlySet<number>;
	/** Slots consumed by native event bindings; scrubbed and carried as listeners. */
	readonly eventSlots: ReadonlySet<number>;
}

const PLAN_WIRE_SHAPES = new WeakMap<UniversalPlan, LynxPlanWireShape | null>();

function collectShape(
	node: UniversalPlanNode,
	valueSlots: Set<number>,
	eventSlots: Set<number>,
): boolean {
	switch (node.kind) {
		case 'host': {
			// `propsSlot` merges an arbitrary props program (spreads, key, ref,
			// children); reproducing it main-side would duplicate the whole
			// normalization pipeline, so such plans stay per-node.
			if (node.propsSlot !== undefined) return false;
			for (const [name, slot] of node.bindings ?? []) {
				// key and ref never cross the wire, and a children binding makes the
				// subtree structurally dynamic. main-thread:* values are worklet
				// descriptors bound by the background worklet pipeline.
				if (name === 'key' || name === 'ref' || name === 'children') return false;
				if (name.startsWith('main-thread:')) return false;
				if (parseLynxNativeEventProp(name) !== null) eventSlots.add(slot);
				else valueSlots.add(slot);
			}
			for (const child of node.children ?? []) {
				if (!collectShape(child, valueSlots, eventSlots)) return false;
			}
			return true;
		}
		case 'text':
			if (node.slot !== undefined) valueSlots.add(node.slot);
			return true;
		case 'slot':
			valueSlots.add(node.slot);
			return true;
		case 'range':
			for (const child of node.children) {
				if (!collectShape(child, valueSlots, eventSlots)) return false;
			}
			return true;
		// Conditional structure and nested components stay per-node for now; the
		// per-instance value checks could support if/switch, but no measured
		// workload needs them yet.
		default:
			return false;
	}
}

function lynxPlanWireShape(plan: UniversalPlan): LynxPlanWireShape | null {
	const cached = PLAN_WIRE_SHAPES.get(plan);
	if (cached !== undefined) return cached;
	const valueSlots = new Set<number>();
	const eventSlots = new Set<number>();
	let shape: LynxPlanWireShape | null = null;
	if (collectShape(plan.root, valueSlots, eventSlots)) {
		// A slot consumed as both an event handler and a crossing value cannot be
		// both scrubbed and preserved.
		let aliased = false;
		for (const slot of eventSlots) {
			if (valueSlots.has(slot)) {
				aliased = true;
				break;
			}
		}
		if (!aliased) shape = Object.freeze({ valueSlots, eventSlots });
	}
	PLAN_WIRE_SHAPES.set(plan, shape);
	return shape;
}

/** Values the Lynx wire can carry without a walk; mirrors the protocol leaf set. */
function isWireLeaf(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'bigint' ||
		typeof value === 'boolean'
	);
}

function prepareLynxPlanInstance(
	plan: UniversalPlan,
	values: readonly unknown[],
	isAnnounced: (planId: string) => boolean,
): { readonly planId: string; readonly wireValues: readonly unknown[] } | null {
	const planId = lynxPlanWireId(plan);
	if (planId === null || !isAnnounced(planId)) return null;
	const shape = lynxPlanWireShape(plan);
	if (shape === null) return null;
	const wireValues: unknown[] = [];
	for (let slot = 0; slot < values.length; slot++) {
		if (!shape.valueSlots.has(slot)) {
			wireValues.push(null);
			continue;
		}
		const value = values[slot];
		if (!isWireLeaf(value)) return null;
		wireValues.push(value);
	}
	return { planId, wireValues };
}

/** Prove before core staging that this exact instance can use the Lynx plan wire. */
export function canCompactLynxPlanInstance(
	plan: UniversalPlan,
	values: readonly unknown[],
	isAnnounced: (planId: string) => boolean,
): boolean {
	return prepareLynxPlanInstance(plan, values, isAnnounced) !== null;
}

/* ------------------------------------------------------------------------- *
 * Main-thread plan registry
 * ------------------------------------------------------------------------- */

const REGISTERED_PLANS = new Map<string, { plan: UniversalPlan; canonical: string }>();
// A hash collision between distinct plans would materialize the wrong
// structure; evict both parties so they fall back to per-node commands.
const POISONED_PLAN_IDS = new Set<string>();
const REGISTRY_LISTENERS = new Set<(planId: string) => void>();

/**
 * Register one compiled plan in this realm's registry. Idempotent for the
 * same content; plans that can never be instantiated over the wire register
 * nothing. Returns the registered wire ID, or null.
 */
export function registerLynxPlan(plan: UniversalPlan): string | null {
	if (lynxPlanWireShape(plan) === null) return null;
	const id = lynxPlanWireId(plan);
	if (id === null || POISONED_PLAN_IDS.has(id)) return null;
	const existing = REGISTERED_PLANS.get(id);
	if (existing !== undefined) {
		if (existing.plan === plan) return id;
		const canonical = canonicalLynxPlan(plan);
		if (canonical === existing.canonical) return id;
		REGISTERED_PLANS.delete(id);
		POISONED_PLAN_IDS.add(id);
		return null;
	}
	const canonical = canonicalLynxPlan(plan);
	/* v8 ignore next -- wire ID existence implies a canonical form. */
	if (canonical === null) return null;
	REGISTERED_PLANS.set(id, { plan, canonical });
	for (const listener of [...REGISTRY_LISTENERS]) listener(id);
	return id;
}

export function resolveLynxPlan(planId: string): UniversalPlan | undefined {
	return REGISTERED_PLANS.get(planId)?.plan;
}

/** Remove one plan from this realm's registry. Intended for registry-skew tests. */
export function unregisterLynxPlan(planId: string): boolean {
	return REGISTERED_PLANS.delete(planId);
}

export function lynxPlanRegistrySnapshot(): readonly string[] {
	return [...REGISTERED_PLANS.keys()];
}

/** Observe additions, so late registrations (lazy chunks) can be re-announced. */
export function onLynxPlanRegistered(listener: (planId: string) => void): () => void {
	REGISTRY_LISTENERS.add(listener);
	return () => {
		REGISTRY_LISTENERS.delete(listener);
	};
}

/* ------------------------------------------------------------------------- *
 * Background fold
 * ------------------------------------------------------------------------- */

interface FoldCandidate {
	readonly instance: UniversalPlanInstance;
	readonly planId: string;
	readonly wireValues: readonly unknown[];
	readonly ids: ReadonlySet<number>;
	createCount: number;
	eventCount: number;
	rootInsertCount: number;
	rootParent: UniversalHostParent;
	rootBefore: number | null;
	disqualified: boolean;
}

/**
 * Re-encode every provable plan instance of a staged batch as one
 * `instantiate` command. The result never carries `planInstances` — that
 * provenance holds live handler closures and must not cross the wire. An
 * instance failing any check keeps its per-node commands verbatim.
 */
export function foldLynxPlanInstances(
	batch: UniversalHostBatch,
	isAnnounced: (planId: string) => boolean,
): LynxWireHostBatch {
	const instances = batch.planInstances;
	if (instances === undefined) return batch;
	const strip: LynxWireHostBatch = Object.freeze({
		renderer: batch.renderer,
		version: batch.version,
		commands: batch.commands,
	});
	const compactInstances = instances.filter((instance) => instance.compact === true);
	if (compactInstances.length !== 0) {
		if (compactInstances.length !== instances.length) {
			throw new Error('Octane Lynx received mixed compact and expanded plan provenance.');
		}
		const byRoot = new Map<
			number,
			{
				readonly instance: UniversalPlanInstance;
				readonly planId: string;
				readonly wireValues: readonly unknown[];
			}
		>();
		for (const instance of compactInstances) {
			const prepared = prepareLynxPlanInstance(instance.plan, instance.values, isAnnounced);
			if (prepared === null || instance.ids.length === 0) {
				throw new Error('Octane Lynx compact plan provenance lost its wire eligibility.');
			}
			if (byRoot.has(instance.rootId)) {
				throw new Error(`Octane Lynx compact plan duplicated root ${instance.rootId}.`);
			}
			byRoot.set(instance.rootId, { instance, ...prepared });
		}
		const commands: LynxWireHostCommand[] = [];
		for (const command of batch.commands) {
			const candidate = command.op === 'insert' ? byRoot.get(command.id) : undefined;
			if (candidate === undefined) {
				commands.push(command);
				continue;
			}
			if (command.op !== 'insert') {
				throw new Error('Octane Lynx compact plan provenance matched a non-insert command.');
			}
			commands.push(
				Object.freeze({
					op: 'instantiate',
					plan: candidate.planId,
					parent: command.parent,
					before: command.before,
					ids: candidate.instance.ids,
					values: Object.freeze(candidate.wireValues),
					events: candidate.instance.events,
				}),
			);
			byRoot.delete(command.id);
		}
		if (byRoot.size !== 0) {
			throw new Error('Octane Lynx compact plan provenance is missing its root placement.');
		}
		return Object.freeze({
			renderer: batch.renderer,
			version: batch.version,
			commands: Object.freeze(commands),
		});
	}
	const byId = new Map<number, FoldCandidate>();
	const candidates: FoldCandidate[] = [];
	for (const instance of instances) {
		const prepared = prepareLynxPlanInstance(instance.plan, instance.values, isAnnounced);
		if (prepared === null) continue;
		const { planId, wireValues } = prepared;
		// Outer instances stamp before the inner ones they contain; an accepted
		// outer instance always disqualifies here on a non-leaf slot value (the
		// nesting can only enter through one), never silently double-covers.
		let usable = true;
		for (const id of instance.ids) {
			if (byId.has(id)) {
				usable = false;
				break;
			}
		}
		if (!usable) continue;
		if (!usable || instance.ids.length === 0) continue;
		const candidate: FoldCandidate = {
			instance,
			planId,
			wireValues,
			ids: new Set(instance.ids),
			createCount: 0,
			eventCount: 0,
			rootInsertCount: 0,
			rootParent: null,
			rootBefore: null,
			disqualified: false,
		};
		candidates.push(candidate);
		for (const id of instance.ids) byId.set(id, candidate);
	}
	if (candidates.length === 0) return strip;

	// Pass 1: prove each candidate's wire footprint is exactly the commands the
	// plan walk regenerates — its creates, its listeners, its internal inserts,
	// and one external root insert. Anything else touching the subtree
	// (an update, a move, a foreign child) keeps the instance per-node.
	for (const command of batch.commands) {
		const candidate = 'id' in command ? byId.get(command.id) : undefined;
		const parentCandidate =
			(command.op === 'insert' || command.op === 'move' || command.op === 'remove') &&
			typeof command.parent === 'number'
				? byId.get(command.parent)
				: undefined;
		if (candidate === undefined && parentCandidate === undefined) continue;
		if (
			candidate === undefined ||
			(parentCandidate !== undefined && parentCandidate !== candidate)
		) {
			if (candidate !== undefined) candidate.disqualified = true;
			if (parentCandidate !== undefined) parentCandidate.disqualified = true;
			continue;
		}
		switch (command.op) {
			case 'create':
				candidate.createCount++;
				break;
			case 'event':
				if (command.listener === null) candidate.disqualified = true;
				else candidate.eventCount++;
				break;
			case 'insert':
				if (command.id === candidate.instance.rootId) {
					candidate.rootInsertCount++;
					candidate.rootParent = command.parent;
					candidate.rootBefore = command.before;
				} else if (parentCandidate !== candidate) {
					candidate.disqualified = true;
				}
				break;
			default:
				candidate.disqualified = true;
		}
	}
	let anyQualified = false;
	for (const candidate of candidates) {
		if (
			candidate.disqualified ||
			candidate.createCount !== candidate.instance.ids.length ||
			candidate.eventCount !== candidate.instance.events.length ||
			candidate.rootInsertCount !== 1
		) {
			candidate.disqualified = true;
			continue;
		}
		anyQualified = true;
	}
	if (!anyQualified) return strip;

	// Pass 2: rebuild the command stream. The instantiate command takes the
	// root insert's position, preserving sibling ordering.
	const commands: LynxWireHostCommand[] = [];
	for (const command of batch.commands) {
		const candidate = 'id' in command ? byId.get(command.id) : undefined;
		if (candidate === undefined || candidate.disqualified) {
			commands.push(command);
			continue;
		}
		if (command.op === 'insert' && command.id === candidate.instance.rootId) {
			commands.push(
				Object.freeze({
					op: 'instantiate',
					plan: candidate.planId,
					parent: candidate.rootParent,
					before: candidate.rootBefore,
					ids: candidate.instance.ids,
					values: Object.freeze(candidate.wireValues),
					events: Object.freeze(
						candidate.instance.events.map((event) =>
							Object.freeze({
								id: event.id,
								type: event.type,
								listener: event.listener,
								priority: event.priority,
							}),
						),
					),
				}),
			);
		}
		// Covered creates, events, and internal inserts are regenerated by the
		// main-thread expansion.
	}
	return Object.freeze({
		renderer: batch.renderer,
		version: batch.version,
		commands: Object.freeze(commands),
	});
}

/* ------------------------------------------------------------------------- *
 * Main-thread expansion
 * ------------------------------------------------------------------------- */

function expansionError(planId: string, message: string): Error {
	return new Error(`Octane Lynx instantiate(${planId}) ${message}`);
}

/**
 * Visit only the host identity/topology encoded by an instantiate command.
 * Background handle publication needs no props or per-node command objects,
 * so this keeps acknowledgement bookkeeping linear and allocation-light.
 */
export function visitLynxInstantiateTopology(
	command: LynxInstantiateCommand,
	plan: UniversalPlan,
	create: (id: number, type: string) => void,
	insert: (id: number, parent: UniversalHostParent) => void,
): void {
	if (lynxPlanWireShape(plan) === null) {
		throw expansionError(command.plan, 'received an ineligible plan.');
	}
	let next = 0;
	const takeId = (): number => {
		if (next >= command.ids.length) {
			throw expansionError(command.plan, 'ran out of host IDs.');
		}
		return command.ids[next++];
	};
	const textHost = (value: unknown): number[] => {
		if (value === null || value === undefined || value === true || value === false) return [];
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
			const id = takeId();
			create(id, '#text');
			return [id];
		}
		throw expansionError(command.plan, 'received a non-primitive text slot value.');
	};
	const walk = (node: UniversalPlanNode): number[] => {
		switch (node.kind) {
			case 'text':
				return textHost(node.slot === undefined ? (node.value ?? '') : command.values[node.slot]);
			case 'slot':
				return textHost(command.values[node.slot]);
			case 'range': {
				const roots: number[] = [];
				for (const child of node.children) roots.push(...walk(child));
				return roots;
			}
			case 'host': {
				const id = takeId();
				create(id, node.type);
				const children: number[] = [];
				for (const child of node.children ?? []) children.push(...walk(child));
				for (const child of children) insert(child, id);
				return [id];
			}
			default:
				throw expansionError(command.plan, `cannot expand a ${node.kind} plan node.`);
		}
	};
	const roots = walk(plan.root);
	if (roots.length !== 1 || next !== command.ids.length || roots[0] !== command.ids[0]) {
		throw expansionError(command.plan, 'produced a different subtree than the background staged.');
	}
	insert(command.ids[0]!, command.parent);
}

/**
 * Expand one instantiate command back into the exact per-node commands the
 * background folded away: creates in plan pre-order consuming `ids`, event
 * announcements, bottom-up internal inserts, then the root insert.
 */
export function expandLynxInstantiateCommand(
	command: LynxInstantiateCommand,
	plan: UniversalPlan,
): UniversalHostCommand[] {
	const shape = lynxPlanWireShape(plan);
	if (shape === null) throw expansionError(command.plan, 'received an ineligible plan.');
	const { ids, values } = command;
	let next = 0;
	const takeId = (): number => {
		if (next >= ids.length) throw expansionError(command.plan, 'ran out of host IDs.');
		return ids[next++];
	};
	const creates: UniversalHostCommand[] = [];
	const inserts: UniversalHostCommand[] = [];
	const textHost = (value: unknown): number[] => {
		// Mirrors the background's primitive-child materialization: nullish and
		// boolean render nothing; string, number, and bigint coerce to one text
		// host.
		if (value === null || value === undefined || value === true || value === false) return [];
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
			const id = takeId();
			creates.push({
				op: 'create',
				id,
				type: '#text',
				props: Object.freeze({ value: String(value) }),
			});
			return [id];
		}
		throw expansionError(command.plan, 'received a non-primitive text slot value.');
	};
	const walk = (node: UniversalPlanNode): number[] => {
		switch (node.kind) {
			case 'text':
				return textHost(node.slot === undefined ? (node.value ?? '') : values[node.slot]);
			case 'slot':
				return textHost(values[node.slot]);
			case 'range': {
				const produced: number[] = [];
				for (const child of node.children) produced.push(...walk(child));
				return produced;
			}
			case 'host': {
				const props: Record<string, unknown> = { ...node.props };
				for (const binding of node.bindings ?? []) {
					// Event bindings are carried by the listener entries.
					if (parseLynxNativeEventProp(binding[0]) !== null) continue;
					props[binding[0]] = values[binding[1]];
				}
				const id = takeId();
				creates.push({ op: 'create', id, type: node.type, props: Object.freeze(props) });
				const childIds: number[] = [];
				for (const child of node.children ?? []) childIds.push(...walk(child));
				for (const childId of childIds) {
					inserts.push({ op: 'insert', parent: id, id: childId, before: null });
				}
				return [id];
			}
			default:
				throw expansionError(command.plan, `cannot expand a ${node.kind} plan node.`);
		}
	};
	const roots = walk(plan.root);
	if (roots.length !== 1 || next !== ids.length || roots[0] !== ids[0]) {
		throw expansionError(command.plan, 'produced a different subtree than the background staged.');
	}
	const idSet = new Set(ids);
	const events: UniversalHostCommand[] = [];
	for (const entry of command.events) {
		if (!idSet.has(entry.id)) {
			throw expansionError(command.plan, 'announced a listener for a foreign host.');
		}
		events.push({
			op: 'event',
			id: entry.id,
			type: entry.type,
			listener: Object.freeze({ id: entry.listener, priority: entry.priority }),
		});
	}
	return [
		...creates,
		...events,
		...inserts,
		{ op: 'insert', parent: command.parent, id: ids[0], before: command.before },
	];
}

/**
 * Expand every instantiate command of a wire batch into per-node commands. A
 * batch without instantiate commands passes through untouched. An unknown
 * plan ID throws — the background only folds announced plans, so this is the
 * commit-rejection path for genuine registry corruption, not a fallback.
 */
export function expandLynxWireBatch(
	batch: LynxWireHostBatch,
	resolvePlan: (planId: string) => UniversalPlan | undefined = resolveLynxPlan,
): UniversalHostBatch {
	let hasInstantiate = false;
	for (const command of batch.commands) {
		if (command.op === 'instantiate') {
			hasInstantiate = true;
			break;
		}
	}
	if (!hasInstantiate) return batch as UniversalHostBatch;
	const commands: UniversalHostCommand[] = [];
	for (const command of batch.commands) {
		if (command.op !== 'instantiate') {
			commands.push(command);
			continue;
		}
		const plan = resolvePlan(command.plan);
		if (plan === undefined) {
			throw expansionError(command.plan, 'references a plan this thread never registered.');
		}
		commands.push(...expandLynxInstantiateCommand(command, plan));
	}
	return Object.freeze({
		renderer: batch.renderer,
		version: batch.version,
		commands: Object.freeze(commands),
	});
}
