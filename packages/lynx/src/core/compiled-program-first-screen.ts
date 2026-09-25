declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { UniversalProgramPlan } from 'octane/universal/native';

import type { LynxFirstScreenRenderResult } from '../main-renderer-product.js';
import { encodePrevalidatedLynxNativeEventToken } from './native-events.js';
import type { LynxElementPAPI, LynxElementRef } from './papi.js';
import type {
	LynxCompiledProgramAdoptionSeed,
	LynxCompiledProgramAdoptionSource,
	LynxCompiledProgramMount,
} from './compiled-program-store.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL497';
const FIRST_ROOT = 1;
const FIRST_LISTENER = 1;

interface PaintedRun<Node extends LynxElementRef> extends LynxCompiledProgramAdoptionSeed<Node> {
	readonly parent: Node;
	readonly plan: UniversalProgramPlan;
	readonly selectedValues: readonly unknown[];
	readonly count: number;
	owner: number | null;
}

interface CompiledFirstScreenResultNode {
	readonly kind: 'program' | 'range';
	readonly children: readonly CompiledFirstScreenResultNode[];
	readonly plan?: UniversalProgramPlan;
	readonly values?: readonly unknown[];
	readonly selectedValues?: readonly unknown[];
	readonly ids?: readonly number[];
	readonly spans?: readonly number[];
	readonly texts?: readonly (string | undefined)[];
	readonly visibility?: 'visible' | 'hidden';
}

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx compact first screen ${message}.` : CODE);
}

function containsNativeList(nodes: readonly CompiledFirstScreenResultNode[]): boolean {
	for (const node of nodes) {
		if (node.plan?.wire?.nodes.some((host) => host.type === 'list' || host.type === 'list-item')) {
			return true;
		}
		if (containsNativeList(node.children)) return true;
	}
	return false;
}

function deferredNativeListFirstScreen<
	Node extends LynxElementRef,
>(): LynxCompiledProgramAdoptionSource<Node> {
	return Object.freeze({
		firstListener: FIRST_LISTENER,
		firstScreen: 'deferred-native-list' as const,
		resolveSeed() {
			return undefined;
		},
		verify() {},
		finish() {},
		dispose() {},
	});
}

/**
 * Paint the proved program-only first screen and offer its physical outputs to
 * the first compact background frame.
 *
 * This intentionally accepts no described host node. The application selector
 * reaches this entry only when every rendered component has a resident address;
 * seeing a host here means the build proof and the main render disagreed, so the
 * safe outcome is to fail before any later root is attached rather than mix two
 * ownership models.
 */
export function paintLynxCompiledProgramFirstScreen<Node extends LynxElementRef>(
	result: LynxFirstScreenRenderResult,
	papi: LynxElementPAPI<Node>,
	page: Node,
): LynxCompiledProgramAdoptionSource<Node> {
	if (containsNativeList(result.nodes as readonly CompiledFirstScreenResultNode[])) {
		return deferredNativeListFirstScreen();
	}
	const pageId = papi.getUniqueId(page);
	const bound = new WeakMap<UniversalProgramPlan, ReturnType<UniversalProgramPlan['bind']>>();
	const painted: PaintedRun<Node>[] = [];
	// Main paint is depth-first, while the compact producer coalesces sibling
	// programs before visiting their nested ranges. Preserve each local sibling
	// order without requiring those programs to be adjacent in the painted walk.
	const proofsByPlanAndParent = new Map<UniversalProgramPlan, Map<number, PaintedRun<Node>[]>>();
	const pageRoots: Node[] = [];
	const announced = new Set<string>();
	for (const event of result.envelope.events) announced.add(`${event.id}\u0000${event.type}`);
	let nextListener = FIRST_LISTENER;
	let attachedAny = false;

	const paintNodes = (
		nodes: readonly CompiledFirstScreenResultNode[],
		parent: Node,
		before: Node | null = null,
	): void => {
		for (const node of nodes) {
			if (node.kind === 'range') {
				paintNodes(node.children, parent, before);
				continue;
			}
			if (node.kind !== 'program') fail('received an unaddressed host node');
			const plan = node.plan;
			const ids = node.ids;
			const selectedValues =
				node.selectedValues ??
				(node.plan === undefined || node.values === undefined
					? undefined
					: node.plan.values.map((slot) => node.values![slot]));
			const spans = node.spans;
			const texts = node.texts;
			if (
				plan === undefined ||
				ids === undefined ||
				selectedValues === undefined ||
				spans === undefined ||
				texts === undefined
			) {
				fail('received an incomplete program node');
			}
			if (
				plan.nodes < 1 ||
				ids.length !== plan.nodes ||
				spans.length !== plan.ranges.length ||
				texts.length !== plan.ranges.length
			) {
				fail('received a program node whose physical arity disagrees with its plan');
			}

			const firstListenerId = plan.events.length === 0 ? null : nextListener;
			const tokens: (string | undefined)[] = new Array(plan.events.length);
			for (let site = 0; site < plan.events.length; site++) {
				const event = plan.events[site]!;
				const hostId = ids[event.node];
				if (hostId === undefined) fail(`cannot resolve event site ${site}`);
				if (announced.has(`${hostId}\u0000${event.type}`)) {
					tokens[site] = encodePrevalidatedLynxNativeEventToken(
						FIRST_ROOT,
						hostId,
						1,
						nextListener + site,
						event.priority,
					);
				}
			}
			nextListener += plan.events.length;

			let create = bound.get(plan);
			if (create === undefined) {
				create = plan.bind(papi);
				bound.set(plan, create);
			}
			const created = create(pageId, ...selectedValues, ...tokens, ...texts) as readonly (
				Node | undefined
			)[];
			if (created.length !== plan.nodes + plan.ranges.length || created[0] === undefined) {
				fail('program create returned the wrong physical output arity');
			}
			for (let range = 0; range < plan.ranges.length; range++) {
				const output = created[plan.nodes + range];
				if ((texts[range] === undefined) !== (output === undefined)) {
					fail(`program create disagreed about range ${range}`);
				}
			}
			if (node.visibility === 'hidden') papi.setAttribute(created[0], 'hidden', true);

			const proof: PaintedRun<Node> = {
				firstId: ids[0]!,
				firstListenerId,
				nodes: created,
				stride: plan.nodes + plan.ranges.length,
				parent,
				plan,
				selectedValues,
				count: 1,
				owner: null,
			};
			painted.push(proof);
			let proofsByParent = proofsByPlanAndParent.get(plan);
			if (proofsByParent === undefined) {
				proofsByParent = new Map();
				proofsByPlanAndParent.set(plan, proofsByParent);
			}
			const parentId = papi.getUniqueId(parent);
			const siblingProofs = proofsByParent.get(parentId);
			if (siblingProofs === undefined) proofsByParent.set(parentId, [proof]);
			else siblingProofs.push(proof);

			let start = 0;
			for (let range = 0; range < plan.ranges.length; range++) {
				const end = start + spans[range]!;
				if (end > node.children.length) fail('program range spans exceed its children');
				const site = plan.ranges[range]!;
				const rangeParent = created[site.node];
				if (rangeParent === undefined) fail(`cannot resolve range ${range} parent`);
				const rangeBefore = site.before == null ? null : created[site.before];
				if (rangeBefore === undefined) fail(`cannot resolve range ${range} anchor`);
				paintNodes(node.children.slice(start, end), rangeParent, rangeBefore);
				start = end;
			}
			if (start !== node.children.length) fail('program has children outside its declared ranges');
			papi.insertBefore(parent, created[0], before);
			attachedAny = true;
			if (papi.isEqual(parent, page)) pageRoots.push(created[0]);
		}
	};

	try {
		paintNodes(result.nodes as readonly CompiledFirstScreenResultNode[], page);
	} catch (error) {
		for (let index = pageRoots.length - 1; index >= 0; index--) {
			try {
				papi.remove(page, pageRoots[index]!);
			} catch {}
		}
		throw error;
	}
	if (!attachedAny || painted.length !== result.programs) {
		fail('did not account for every rendered program');
	}

	let adoptedProofs = 0;
	let finished = false;
	let disposed = false;
	const assigned = new Map<number, LynxCompiledProgramAdoptionSeed<Node>>();
	const resolveSeed = (
		input: LynxCompiledProgramMount<Node>,
	): LynxCompiledProgramAdoptionSeed<Node> | undefined => {
		if (finished) return undefined;
		if (disposed) fail('ownership was already disposed');
		const prior = assigned.get(input.firstHandle);
		if (prior !== undefined) return prior;
		if (input.before !== null) {
			fail(`background run ${input.firstHandle} disagrees with painted order`);
		}
		const matches: PaintedRun<Node>[] = [];
		const nodes: (Node | undefined)[] = [];
		const expectedValues: unknown[] = [];
		const candidates = proofsByPlanAndParent.get(input.plan)?.get(papi.getUniqueId(input.parent));
		for (const proof of candidates ?? []) {
			if (proof.owner !== null || !papi.isEqual(proof.parent, input.parent) || proof.count !== 1) {
				continue;
			}
			matches.push(proof);
			if (matches.length === input.count) break;
		}
		if (matches.length !== input.count) {
			fail(`background run ${input.firstHandle} has no matching painted program run`);
		}
		const first = matches[0]!;
		const listener = first.firstListenerId;
		const stride = input.count > 1 ? matches[1]!.firstId - first.firstId : first.stride;
		if (input.plan.events.length !== 0) {
			if (listener === null) fail(`background run ${input.firstHandle} lost its event listener`);
			for (let index = 1; index < matches.length; index++) {
				const proof = matches[index]!;
				if (
					proof.firstId !== first.firstId + index * stride ||
					proof.firstListenerId !== listener + index * input.plan.events.length
				) {
					fail(
						`background run ${input.firstHandle} has non-uniform painted host or listener identities`,
					);
				}
			}
		}
		for (const proof of matches) {
			proof.owner = input.firstHandle;
			nodes.push(...proof.nodes);
			expectedValues.push(...proof.selectedValues);
		}
		adoptedProofs += matches.length;
		const seed = Object.freeze({
			firstId: first.firstId,
			firstListenerId: listener,
			nodes: Object.freeze(nodes),
			stride,
			paintedValues: Object.freeze(expectedValues),
		});
		assigned.set(input.firstHandle, seed);
		return seed;
	};

	return {
		firstScreen: 'painted',
		firstListener: FIRST_LISTENER,
		resolveSeed,
		verify() {
			if (disposed) fail('ownership was already disposed');
			if (!finished && adoptedProofs !== painted.length) {
				fail('background frame did not adopt every program');
			}
		},
		finish() {
			if (finished) return;
			finished = true;
			pageRoots.length = 0;
			painted.length = 0;
			adoptedProofs = 0;
			proofsByPlanAndParent.clear();
			assigned.clear();
		},
		dispose() {
			if (finished || disposed) return;
			disposed = true;
			for (let index = pageRoots.length - 1; index >= 0; index--) {
				papi.remove(page, pageRoots[index]!);
			}
			pageRoots.length = 0;
			painted.length = 0;
			adoptedProofs = 0;
			proofsByPlanAndParent.clear();
			assigned.clear();
		},
	};
}
