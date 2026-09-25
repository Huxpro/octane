declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import { sameLynxUniversalHostPropValue } from './host-props.js';
import { parseLynxMainThreadEventProp, type LynxMainThreadEventBinding } from './native-events.js';
import type { LynxElementEventListener, LynxElementPAPI, LynxElementRef } from './papi.js';
import {
	assertLynxWorkletValue,
	isLynxMainThreadRefDescriptor,
	isLynxMainThreadWorkletDescriptor,
	type LynxActivatedMainThreadWorklet,
	type LynxMainThreadRefDescriptor,
	type LynxMainThreadWorkletDescriptor,
	type LynxMainThreadWorkletRegistry,
} from './worklets.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const ERROR = 'Octane Lynx OL505';

interface EventSite {
	readonly kind: 'event';
	readonly node: number;
	readonly name: string;
	readonly binding: LynxMainThreadEventBinding;
}

interface RefSite {
	readonly kind: 'ref';
	readonly node: number;
	readonly name: 'main-thread:ref';
}

type WorkletSite = EventSite | RefSite;

interface ActiveEvent {
	readonly descriptor: LynxMainThreadWorkletDescriptor;
	readonly active: LynxActivatedMainThreadWorklet;
	readonly listener: LynxElementEventListener;
	readonly binding: LynxMainThreadEventBinding;
}

interface PreparedEvent<Node extends LynxElementRef> {
	node: Node | undefined;
	readonly name: string;
	readonly value: ActiveEvent;
}

const SITES = new WeakMap<UniversalProgramPlan, readonly (WorkletSite | undefined)[] | null>();

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx compact worklet ${message}.` : ERROR);
}

function sitesFor(plan: UniversalProgramPlan): readonly (WorkletSite | undefined)[] | null {
	const cached = SITES.get(plan);
	if (cached !== undefined) return cached;
	const wire = plan.wire;
	if (wire === undefined) fail('requires resident host metadata');
	let sites: (WorkletSite | undefined)[] | null = null;
	for (let node = 0; node < wire.nodes.length; node++) {
		for (const binding of wire.nodes[node]!.bindings ?? []) {
			if (!binding.name.startsWith('main-thread:')) continue;
			if (binding.valueIndex < 0 || binding.valueIndex >= plan.values.length) {
				fail(`received an out-of-range site ${binding.valueIndex}`);
			}
			if ((sites ??= [])[binding.valueIndex] !== undefined) {
				fail(`received a duplicate site ${binding.valueIndex}`);
			}
			if (binding.name === 'main-thread:ref') {
				sites[binding.valueIndex] = Object.freeze({
					kind: 'ref',
					node,
					name: binding.name,
				});
				continue;
			}
			const event = parseLynxMainThreadEventProp(binding.name);
			if (event === null) fail(`received unsupported prop ${JSON.stringify(binding.name)}`);
			sites[binding.valueIndex] = Object.freeze({
				kind: 'event',
				node,
				name: binding.name,
				binding: event,
			});
		}
	}
	const result = sites === null ? null : Object.freeze(sites);
	SITES.set(plan, result);
	return result;
}

function eventDescriptor(value: unknown, name: string): LynxMainThreadWorkletDescriptor | null {
	if (value === null || value === undefined) return null;
	assertLynxWorkletValue(value, name);
	if (!isLynxMainThreadWorkletDescriptor(value) || value._owlt !== undefined) {
		fail(`${JSON.stringify(name)} requires an inactive main-thread worklet descriptor`);
	}
	return value;
}

function refDescriptor(value: unknown): LynxMainThreadRefDescriptor | null {
	if (value === null || value === undefined) return null;
	assertLynxWorkletValue(value, 'main-thread:ref');
	if (!isLynxMainThreadRefDescriptor(value)) fail('main-thread:ref requires a ref descriptor');
	return value;
}

export interface LynxCompiledProgramPreparedWorklets<Node extends LynxElementRef> {
	readonly values: readonly unknown[];
	publish(nodes: readonly (Node | undefined)[], stride: number): void;
	abort(): void;
}

export interface LynxCompiledProgramWorkletStore<Node extends LynxElementRef> {
	hasSites(plan: UniversalProgramPlan): boolean;
	validValue(plan: UniversalProgramPlan, slot: number, value: unknown): boolean;
	prepareMount(
		plan: UniversalProgramPlan,
		count: number,
		values: readonly unknown[],
		active?: boolean,
	): LynxCompiledProgramPreparedWorklets<Node> | null;
	activateInstance(
		plan: UniversalProgramPlan,
		nodes: readonly (Node | undefined)[],
		offset: number,
		values: readonly unknown[],
		valueOffset: number,
	): void;
	deactivateInstance(
		plan: UniversalProgramPlan,
		nodes: readonly (Node | undefined)[],
		offset: number,
	): void;
	set(
		plan: UniversalProgramPlan,
		nodes: readonly (Node | undefined)[],
		offset: number,
		slot: number,
		value: unknown,
	): boolean;
	close(): void;
}

/** Sparse direct-main-thread ownership for the compact resident-program store. */
export function createLynxCompiledProgramWorkletStore<Node extends LynxElementRef>(
	papi: LynxElementPAPI<Node>,
	registry: LynxMainThreadWorkletRegistry,
): LynxCompiledProgramWorkletStore<Node> {
	const events = new Map<Node, Map<string, ActiveEvent>>();
	const refs = new Map<Node, LynxMainThreadRefDescriptor>();
	const refOwners = new Map<string, Node>();

	const eventMap = (node: Node): Map<string, ActiveEvent> => {
		let result = events.get(node);
		if (result === undefined) events.set(node, (result = new Map()));
		return result;
	};
	const releaseEvent = (value: ActiveEvent): void => registry.release(value.active);
	const removeEvent = (node: Node, name: string): void => {
		const owned = events.get(node);
		const current = owned?.get(name);
		if (current === undefined) return;
		papi.setEvent(node, current.binding.type, current.binding.name, undefined);
		owned!.delete(name);
		if (owned!.size === 0) events.delete(node);
		releaseEvent(current);
	};
	const installEvent = (node: Node, site: EventSite, value: unknown): LynxElementEventListener => {
		const next = eventDescriptor(value, site.name);
		const owned = events.get(node);
		const current = owned?.get(site.name);
		if (
			current !== undefined &&
			next !== null &&
			sameLynxUniversalHostPropValue(site.name, current.descriptor, next)
		) {
			return current.listener;
		}
		const active = next === null ? null : registry.activate(next);
		const listener =
			active === null ? undefined : Object.freeze({ type: 'worklet' as const, value: active });
		try {
			papi.setEvent(node, site.binding.type, site.binding.name, listener);
		} catch (error) {
			if (active !== null) registry.release(active);
			try {
				papi.setEvent(node, site.binding.type, site.binding.name, current?.listener);
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					DEVELOPMENT ? 'Worklet event rollback failed.' : ERROR,
				);
			}
			throw error;
		}
		if (current !== undefined) releaseEvent(current);
		if (active === null) {
			owned?.delete(site.name);
			if (owned?.size === 0) events.delete(node);
		} else {
			eventMap(node).set(
				site.name,
				Object.freeze({ descriptor: next!, active, listener, binding: site.binding }),
			);
		}
		return listener;
	};
	const removeRef = (node: Node): void => {
		const current = refs.get(node);
		if (current === undefined) return;
		registry.updateRef(current, null);
		registry.releaseRef(current);
		refs.delete(node);
		if (refOwners.get(current._wvid) === node) refOwners.delete(current._wvid);
	};
	const installRef = (node: Node, value: unknown): void => {
		const next = refDescriptor(value);
		const current = refs.get(node);
		if (current?._wvid === next?._wvid) return;
		if (next !== null) {
			const owner = refOwners.get(next._wvid);
			if (owner !== undefined && owner !== node)
				fail(`ref ${JSON.stringify(next._wvid)} is already mounted`);
			registry.retainRef(next, null);
			try {
				registry.mountRef(next, node);
			} catch (error) {
				registry.releaseRef(next);
				throw error;
			}
		}
		if (current !== undefined) removeRef(node);
		if (next !== null) {
			refs.set(node, next);
			refOwners.set(next._wvid, node);
		}
	};
	const deactivateNode = (node: Node): void => {
		const owned = events.get(node);
		if (owned !== undefined) for (const name of [...owned.keys()]) removeEvent(node, name);
		removeRef(node);
	};
	const requireNode = (
		nodes: readonly (Node | undefined)[],
		offset: number,
		site: WorkletSite,
	): Node => {
		const node = nodes[offset + site.node];
		if (node === undefined) fail(`lost host node ${site.node}`);
		return node;
	};
	const activate = (
		plan: UniversalProgramPlan,
		nodes: readonly (Node | undefined)[],
		offset: number,
		values: readonly unknown[],
		valueOffset: number,
	): void => {
		const sites = sitesFor(plan);
		if (sites === null) return;
		const touched = new Set<Node>();
		try {
			for (let slot = 0; slot < sites.length; slot++) {
				const site = sites[slot];
				if (site === undefined) continue;
				const node = requireNode(nodes, offset, site);
				touched.add(node);
				const value = values[valueOffset + slot];
				if (site.kind === 'event') installEvent(node, site, value);
				else installRef(node, value);
			}
		} catch (error) {
			for (const node of touched) {
				try {
					deactivateNode(node);
				} catch {}
			}
			throw error;
		}
	};

	const result: LynxCompiledProgramWorkletStore<Node> = {
		hasSites(plan) {
			return sitesFor(plan) !== null;
		},
		validValue(plan, slot, value) {
			const site = sitesFor(plan)?.[slot];
			if (site === undefined) return false;
			if (site.kind === 'event') eventDescriptor(value, site.name);
			else refDescriptor(value);
			return true;
		},
		prepareMount(plan, count, values, enabled = true) {
			const sites = sitesFor(plan);
			if (sites === null) return null;
			const physical = [...values];
			const prepared: PreparedEvent<Node>[] = [];
			let published = false;
			let publicationComplete = false;
			let publishedNodes: readonly (Node | undefined)[] | null = null;
			let publishedStride = 0;
			let aborted = false;
			try {
				for (let row = 0; row < count; row++) {
					const valueOffset = row * plan.values.length;
					for (let slot = 0; slot < sites.length; slot++) {
						const site = sites[slot];
						if (site === undefined) continue;
						const value = values[valueOffset + slot];
						if (site.kind === 'ref') {
							refDescriptor(value);
							if (!enabled) physical[valueOffset + slot] = undefined;
							continue;
						}
						const descriptor = eventDescriptor(value, site.name);
						if (!enabled || descriptor === null) {
							physical[valueOffset + slot] = undefined;
							continue;
						}
						const active = registry.activate(descriptor);
						physical[valueOffset + slot] = Object.freeze({
							type: 'worklet' as const,
							value: active,
						});
						prepared.push({
							node: undefined,
							name: site.name,
							value: Object.freeze({
								descriptor,
								active,
								listener: physical[valueOffset + slot] as LynxElementEventListener,
								binding: site.binding,
							}),
						});
					}
				}
			} catch (error) {
				for (const entry of prepared) releaseEvent(entry.value);
				throw error;
			}
			return Object.freeze({
				values: Object.freeze(physical),
				publish(nodes: readonly (Node | undefined)[], stride: number) {
					if (published || aborted) fail('mount worklets were already settled');
					published = true;
					if (!enabled) {
						publicationComplete = true;
						publishedNodes = nodes;
						publishedStride = stride;
						return;
					}
					let eventIndex = 0;
					try {
						for (let row = 0; row < count; row++) {
							const valueOffset = row * plan.values.length;
							for (let slot = 0; slot < sites.length; slot++) {
								const site = sites[slot];
								if (site === undefined) continue;
								const node = requireNode(nodes, row * stride, site);
								const value = values[valueOffset + slot];
								if (site.kind === 'ref') installRef(node, value);
								else if (value !== null && value !== undefined) {
									const entry = prepared[eventIndex++]!;
									entry.node = node;
									eventMap(node).set(entry.name, entry.value);
								}
							}
						}
						publicationComplete = true;
						publishedNodes = nodes;
						publishedStride = stride;
					} catch (error) {
						for (const entry of prepared) {
							if (entry.node === undefined) releaseEvent(entry.value);
							else {
								const owned = events.get(entry.node);
								owned?.delete(entry.name);
								if (owned?.size === 0) events.delete(entry.node);
								releaseEvent(entry.value);
							}
						}
						for (const node of nodes)
							if (node !== undefined) {
								try {
									removeRef(node);
								} catch {}
							}
						throw error;
					}
				},
				abort() {
					if (aborted) return;
					aborted = true;
					if (!published) {
						for (const entry of prepared) releaseEvent(entry.value);
						return;
					}
					if (!publicationComplete || publishedNodes === null) return;
					for (let row = 0; row < count; row++) {
						const visited = new Set<Node>();
						for (const site of sites) {
							if (site === undefined) continue;
							const node = requireNode(publishedNodes, row * publishedStride, site);
							if (visited.has(node)) continue;
							visited.add(node);
							deactivateNode(node);
						}
					}
				},
			});
		},
		activateInstance: activate,
		deactivateInstance(plan, nodes, offset) {
			const sites = sitesFor(plan);
			if (sites === null) return;
			const visited = new Set<Node>();
			for (const site of sites) {
				if (site === undefined) continue;
				const node = requireNode(nodes, offset, site);
				if (visited.has(node)) continue;
				visited.add(node);
				deactivateNode(node);
			}
		},
		set(plan, nodes, offset, slot, value) {
			const site = sitesFor(plan)?.[slot];
			if (site === undefined) return false;
			const node = requireNode(nodes, offset, site);
			if (site.kind === 'event') installEvent(node, site, value);
			else installRef(node, value);
			return true;
		},
		close() {
			const errors: unknown[] = [];
			for (const [node, owned] of [...events]) {
				for (const name of [...owned.keys()]) {
					try {
						removeEvent(node, name);
					} catch (error) {
						errors.push(error);
					}
				}
			}
			for (const node of [...refs.keys()]) {
				try {
					removeRef(node);
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length !== 0) {
				throw new AggregateError(errors, DEVELOPMENT ? 'Compact worklet disposal failed.' : ERROR);
			}
		},
	};
	return Object.freeze(result);
}
