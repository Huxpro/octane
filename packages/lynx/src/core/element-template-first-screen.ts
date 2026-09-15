declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import type { LynxFirstScreenRenderResult } from '../main-renderer-product.js';
import type {
	LynxElementTemplateAddress,
	LynxElementTemplateAdoptionSeed,
	LynxElementTemplateAdoptionSeedResolver,
} from './element-template-program-store.js';
import type {
	LynxElementTemplateAttributeValue,
	LynxElementTemplateHandle,
	LynxElementTemplatePAPI,
} from './element-template-papi.js';
import {
	createLynxElementTemplateNativeBudget,
	LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT,
	type LynxElementTemplateNativeBudget,
} from './element-template-native-budget.js';
import { LYNX_ELEMENT_TEMPLATE_VISIBILITY } from './element-template-visibility.js';
import { encodePrevalidatedLynxNativeEventToken } from './native-events.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL511';
const FIRST_ROOT = 1;
const FIRST_HANDLE = 2;
const FIRST_LISTENER = 1;
const FIRST_NATIVE_HANDLE = -1;

// renderPage's unified pixel pipeline coalesces nested FlushElementTree calls,
// so they cannot drain Android JNI callbacks during synchronous first-screen
// rendering. A template node can enqueue more than one callback, so reuse the
// device-qualified single-batch bound instead of treating node count as JNI
// reference count. Larger trees defer intact to the first background frame,
// whose store can really drain the queue between chunks.
export const LYNX_ELEMENT_TEMPLATE_FIRST_SCREEN_NATIVE_COST_LIMIT =
	LYNX_ELEMENT_TEMPLATE_PENDING_NATIVE_COST_LIMIT;

interface FirstScreenNode {
	readonly kind: 'program' | 'range';
	readonly children: readonly FirstScreenNode[];
	readonly plan?: UniversalProgramPlan;
	readonly values?: readonly unknown[];
	readonly selectedValues?: readonly unknown[];
	readonly ids?: readonly number[];
	readonly spans?: readonly number[];
}

interface PaintedTemplate<Handle extends LynxElementTemplateHandle> {
	readonly handle: number;
	readonly native: Handle;
	readonly parent: LynxElementTemplateAddress;
	readonly plan: UniversalProgramPlan;
	readonly values: readonly unknown[];
	readonly firstListenerId: number | null;
}

interface PaintedNativeTree<Handle extends LynxElementTemplateHandle> {
	readonly native: Handle;
	readonly residents: number;
	readonly nativeCost: number;
}

export interface LynxElementTemplateFirstScreenSource<Handle extends LynxElementTemplateHandle> {
	readonly firstListener: number;
	readonly resolveSeed: LynxElementTemplateAdoptionSeedResolver<Handle>;
	verify(): void;
	finish(): void;
	dispose(): void;
}

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx Element Template first screen ${message}.` : CODE);
}

function sameAddress(left: LynxElementTemplateAddress, right: LynxElementTemplateAddress): boolean {
	if (left.kind !== right.kind || left.owner !== right.owner) return false;
	if (left.kind === 'page') return true;
	if (left.kind === 'node') return left.node === (right as typeof left).node;
	return (
		left.slot === (right as typeof left).slot && left.childSlot === (right as typeof left).childSlot
	);
}

function firstScreenNativeCost(nodes: readonly FirstScreenNode[]): number {
	let cost = 0;
	for (const node of nodes) {
		if (node.kind === 'program') {
			const nodeCount = node.plan?.nodes;
			if (typeof nodeCount !== 'number' || !Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
				fail('received an invalid program node count');
			}
			cost += nodeCount;
			if (!Number.isSafeInteger(cost)) fail('exceeded the supported native node count');
		} else if (node.kind !== 'range') {
			fail('received an unaddressed host node');
		}
		cost += firstScreenNativeCost(node.children);
		if (!Number.isSafeInteger(cost)) fail('exceeded the supported native node count');
	}
	return cost;
}

function deferLynxElementTemplateFirstScreen<
	Handle extends LynxElementTemplateHandle,
>(): LynxElementTemplateFirstScreenSource<Handle> {
	let finished = false;
	let disposed = false;
	return Object.freeze({
		firstListener: FIRST_LISTENER,
		resolveSeed: () => undefined,
		verify() {
			if (disposed) fail('ownership was already disposed');
		},
		finish() {
			finished = true;
		},
		dispose() {
			if (finished || disposed) return;
			disposed = true;
		},
	});
}

/** Paint a compiler-proved whole-root Template Definition tree before Block adoption. */
export function paintLynxElementTemplateFirstScreen<Handle extends LynxElementTemplateHandle>(
	result: LynxFirstScreenRenderResult,
	papi: LynxElementTemplatePAPI<Handle>,
	page: Handle,
	nativeBudget: LynxElementTemplateNativeBudget = createLynxElementTemplateNativeBudget(papi),
	retainsVisibility = LYNX_ELEMENT_TEMPLATE_VISIBILITY,
): LynxElementTemplateFirstScreenSource<Handle> {
	if (
		firstScreenNativeCost(result.nodes as readonly FirstScreenNode[]) >
		LYNX_ELEMENT_TEMPLATE_FIRST_SCREEN_NATIVE_COST_LIMIT
	) {
		return deferLynxElementTemplateFirstScreen();
	}
	const pageAddress = Object.freeze({ kind: 'page' as const, owner: 1 as const, slot: 0 as const });
	const announced = new Set<string>();
	for (const event of result.envelope.events) announced.add(`${event.id}\u0000${event.type}`);
	const painted: Array<PaintedTemplate<Handle> | undefined> = [];
	// Roots remain here until a successfully-created parent consumes them. That
	// leaves every live native handle reachable for cleanup if validation,
	// creation, or page insertion fails partway through the synchronous paint.
	const ownedRoots: PaintedNativeTree<Handle>[] = [];
	const pageRoots: PaintedNativeTree<Handle>[] = [];
	let nextHandle = FIRST_HANDLE;
	let nextListener = FIRST_LISTENER;
	let nextNativeHandle = FIRST_NATIVE_HANDLE;

	const paintNodes = (
		nodes: readonly FirstScreenNode[],
		parentAddress: LynxElementTemplateAddress,
	): PaintedNativeTree<Handle>[] => {
		const natives: PaintedNativeTree<Handle>[] = [];
		for (const node of nodes) {
			if (node.kind === 'range') {
				natives.push(...paintNodes(node.children, parentAddress));
				continue;
			}
			if (node.kind !== 'program') fail('received an unaddressed host node');
			const plan = node.plan;
			const values =
				node.selectedValues ??
				(node.plan === undefined || node.values === undefined
					? undefined
					: node.plan.values.map((slot) => node.values![slot]));
			const ids = node.ids;
			const spans = node.spans;
			const template = plan?.elementTemplate;
			if (plan === undefined || values === undefined || ids === undefined || spans === undefined) {
				fail('received an incomplete program');
			}
			if (template === undefined) fail('received a program without a Template Definition');
			if (values.length !== plan.values.length) fail('received the wrong value arity');
			if (ids.length !== plan.nodes) fail('received the wrong host-id arity');
			if (spans.length !== plan.ranges.length) fail('received the wrong range-span arity');
			if (template.childSlots !== plan.ranges.length) fail('received the wrong child-slot arity');
			if (template.attributeSlots !== plan.values.length + plan.events.length + 1) {
				fail('received the wrong attribute-slot arity');
			}
			if (template.visibilitySlot !== template.attributeSlots - 1) {
				fail('received the wrong visibility-slot position');
			}
			const handle = nextHandle++;
			const nativeHandle = nextNativeHandle--;
			const paintedIndex = painted.length;
			painted.push(undefined);
			const listener = plan.events.length === 0 ? null : nextListener;
			const attributeSlots = template.attributeSlots - (retainsVisibility ? 0 : 1);
			const attributes = new Array<LynxElementTemplateAttributeValue>(attributeSlots).fill(null);
			for (let slot = 0; slot < values.length; slot++) {
				const value = values[slot];
				if (
					value !== null &&
					typeof value !== 'string' &&
					typeof value !== 'boolean' &&
					(typeof value !== 'number' || !Number.isFinite(value))
				) {
					fail(`received a non-scalar value at slot ${slot}`);
				}
				attributes[slot] = values[slot] as LynxElementTemplateAttributeValue;
			}
			for (let site = 0; site < plan.events.length; site++) {
				const event = plan.events[site]!;
				const hostId = ids[event.node];
				if (hostId === undefined) fail(`cannot resolve event site ${site}`);
				if (announced.has(`${hostId}\u0000${event.type}`)) {
					attributes[plan.values.length + site] = encodePrevalidatedLynxNativeEventToken(
						FIRST_ROOT,
						handle,
						1,
						nextListener + site,
						event.priority,
					);
				}
			}
			nextListener += plan.events.length;
			if (retainsVisibility) attributes[template.visibilitySlot] = false;
			const childSlots: Handle[][] = [];
			const ownedChildren: PaintedNativeTree<Handle>[] = [];
			let residents = 1;
			let nativeCost = plan.nodes;
			let end = node.children.length;
			for (let range = plan.ranges.length - 1; range >= 0; range--) {
				const start = end - spans[range]!;
				if (start < 0) fail('program range spans exceed its children');
				const rangeSite = plan.ranges[range]!;
				const rangeAddress = Object.freeze({
					kind: 'range' as const,
					owner: handle,
					slot: rangeSite.slot,
					childSlot: range,
				});
				const children = paintNodes(node.children.slice(start, end), rangeAddress);
				childSlots[range] = children.map((child) => child.native);
				for (const child of children) {
					ownedChildren.push(child);
					residents += child.residents;
					nativeCost += child.nativeCost;
				}
				end = start;
			}
			if (end !== 0) fail('program has children outside its declared ranges');
			nativeBudget.reserveResident(1, plan.nodes);
			let native: Handle;
			try {
				native = nativeBudget.run(plan.nodes, () =>
					papi.create(template.templateId, attributes, childSlots, nativeHandle),
				);
			} catch (error) {
				nativeBudget.releaseResident(1, plan.nodes);
				throw error;
			}
			painted[paintedIndex] = {
				handle,
				native,
				parent: parentAddress,
				plan,
				values: Object.freeze([...values]),
				firstListenerId: listener,
			};
			for (const child of ownedChildren) {
				const index = ownedRoots.indexOf(child);
				if (index < 0) fail('lost a native child before parent ownership transfer');
				ownedRoots.splice(index, 1);
			}
			const tree = { native, residents, nativeCost };
			ownedRoots.push(tree);
			natives.push(tree);
		}
		return natives;
	};

	try {
		for (const tree of paintNodes(result.nodes as readonly FirstScreenNode[], pageAddress)) {
			nativeBudget.run(1, () => papi.insert(page, 0, tree.native, null));
			pageRoots.push(tree);
		}
	} catch (error) {
		const errors: unknown[] = [error];
		for (let index = ownedRoots.length - 1; index >= 0; index--) {
			try {
				const tree = ownedRoots[index]!;
				if (!pageRoots.includes(tree)) {
					// The PAPI has no standalone destroy call. Temporarily attaching an
					// unconsumed root gives remove() the native ownership edge it needs
					// to release the tree, and is also safe when insert mutated then threw.
					nativeBudget.run(1, () => papi.insert(page, 0, tree.native, null));
				}
				nativeBudget.run(1, () => papi.remove(page, 0, tree.native));
				nativeBudget.releaseResident(tree.residents, tree.nativeCost);
				ownedRoots.splice(index, 1);
			} catch (cleanupError) {
				errors.push(cleanupError);
			}
		}
		pageRoots.length = 0;
		painted.length = 0;
		if (errors.length !== 1) {
			throw new AggregateError(
				errors,
				DEVELOPMENT ? 'Element Template first-screen cleanup failed.' : CODE,
			);
		}
		throw error;
	}
	if (pageRoots.length === 0 || painted.length !== result.programs) {
		for (let index = pageRoots.length - 1; index >= 0; index--) {
			try {
				const tree = pageRoots[index]!;
				nativeBudget.run(1, () => papi.remove(page, 0, tree.native));
				nativeBudget.releaseResident(tree.residents, tree.nativeCost);
			} catch {}
		}
		fail('did not account for every rendered program');
	}
	let nextProof = 0;
	let finished = false;
	let disposed = false;
	const assigned = new Map<number, LynxElementTemplateAdoptionSeed<Handle>>();
	const resolveSeed: LynxElementTemplateAdoptionSeedResolver<Handle> = (input) => {
		if (finished) return undefined;
		if (disposed) fail('ownership was already disposed');
		const prior = assigned.get(input.firstHandle);
		if (prior !== undefined) return prior;
		const start = nextProof;
		const natives: Handle[] = [];
		const values: unknown[] = [];
		let firstListenerId: number | null = null;
		try {
			for (let row = 0; row < input.count; row++) {
				const proof = painted[nextProof++];
				if (
					proof === undefined ||
					proof.handle !== input.firstHandle + row ||
					proof.plan !== input.plan ||
					!sameAddress(proof.parent, input.parent)
				) {
					fail(`background run ${input.firstHandle} disagrees with painted program ${start + row}`);
				}
				if (row === 0) firstListenerId = proof.firstListenerId;
				natives.push(proof.native);
				values.push(...proof.values);
			}
			if (input.before !== null || input.anchor != null) {
				fail(`background run ${input.firstHandle} disagrees with painted order`);
			}
		} catch (error) {
			nextProof = start;
			throw error;
		}
		const seed = Object.freeze({
			natives: Object.freeze(natives),
			firstListenerId,
			paintedValues: Object.freeze(values),
			residentReserved: true as const,
		});
		assigned.set(input.firstHandle, seed);
		return seed;
	};

	return Object.freeze({
		firstListener: FIRST_LISTENER,
		resolveSeed,
		verify() {
			if (disposed) fail('ownership was already disposed');
			if (!finished && nextProof !== painted.length) {
				fail('background frame did not adopt every program');
			}
		},
		finish() {
			if (finished) return;
			finished = true;
			pageRoots.length = 0;
			painted.length = 0;
			assigned.clear();
		},
		dispose() {
			if (finished) return;
			disposed = true;
			const errors: unknown[] = [];
			for (let index = pageRoots.length - 1; index >= 0; index--) {
				try {
					const tree = pageRoots[index]!;
					nativeBudget.run(1, () => papi.remove(page, 0, tree.native));
					nativeBudget.releaseResident(tree.residents, tree.nativeCost);
					pageRoots.splice(index, 1);
				} catch (error) {
					errors.push(error);
				}
			}
			if (pageRoots.length === 0) {
				painted.length = 0;
				assigned.clear();
			}
			if (errors.length !== 0) {
				throw new AggregateError(
					errors,
					DEVELOPMENT ? 'Element Template first-screen disposal failed.' : CODE,
				);
			}
		},
	});
}
