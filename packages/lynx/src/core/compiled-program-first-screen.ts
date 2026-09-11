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
}

function fail(message: string): never {
	throw new TypeError(DEVELOPMENT ? `Octane Lynx compact first screen ${message}.` : CODE);
}

function sameValues(
	input: LynxCompiledProgramMount<LynxElementRef>,
	expected: readonly unknown[],
): boolean {
	const offset = input.valueOffset ?? 0;
	if (expected.length !== input.plan.values.length * input.count) return false;
	for (let index = 0; index < expected.length; index++) {
		if (!Object.is(input.values[offset + index], expected[index])) return false;
	}
	return true;
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
	const pageId = papi.getUniqueId(page);
	const append =
		papi.append ?? ((parent: Node, child: Node): void => papi.insertBefore(parent, child, null));
	const bound = new WeakMap<UniversalProgramPlan, ReturnType<UniversalProgramPlan['bind']>>();
	const painted: PaintedRun<Node>[] = [];
	const pageRoots: Node[] = [];
	const announced = new Set<string>();
	for (const event of result.envelope.events) announced.add(`${event.id}\u0000${event.type}`);
	let nextListener = FIRST_LISTENER;
	let attachedAny = false;

	const paintNodes = (nodes: readonly CompiledFirstScreenResultNode[], parent: Node): void => {
		for (const node of nodes) {
			if (node.kind === 'range') {
				paintNodes(node.children, parent);
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

			painted.push({
				firstId: ids[0]!,
				firstListenerId,
				nodes: created,
				stride: plan.nodes + plan.ranges.length,
				parent,
				plan,
				selectedValues,
				count: 1,
			});

			let end = node.children.length;
			for (let range = plan.ranges.length - 1; range >= 0; range--) {
				const start = end - spans[range]!;
				if (start < 0) fail('program range spans exceed its children');
				const rangeParent = created[plan.ranges[range]!.node];
				if (rangeParent === undefined) fail(`cannot resolve range ${range} parent`);
				paintNodes(node.children.slice(start, end), rangeParent);
				end = start;
			}
			if (end !== 0) fail('program has children outside its declared ranges');
			append(parent, created[0]);
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

	let nextProof = 0;
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
		const start = nextProof;
		let count = 0;
		let listener: number | null = null;
		const nodes: (Node | undefined)[] = [];
		const expectedValues: unknown[] = [];
		while (count < input.count) {
			const proof = painted[nextProof++];
			if (
				proof === undefined ||
				proof.plan !== input.plan ||
				!papi.isEqual(proof.parent, input.parent) ||
				proof.count !== 1
			) {
				fail(`background run ${input.firstHandle} disagrees with painted program ${start}`);
			}
			if (count === 0) listener = proof.firstListenerId;
			nodes.push(...proof.nodes);
			expectedValues.push(...proof.selectedValues);
			count++;
		}
		if (input.before !== null || !sameValues(input, expectedValues)) {
			fail(`background run ${input.firstHandle} disagrees with painted values or order`);
		}
		const first = painted[start]!;
		const stride = input.count > 1 ? painted[start + 1]!.firstId - first.firstId : first.stride;
		const seed = Object.freeze({
			firstId: first.firstId,
			firstListenerId: listener,
			nodes: Object.freeze(nodes),
			stride,
		});
		assigned.set(input.firstHandle, seed);
		return seed;
	};

	return {
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
			if (finished || disposed) return;
			disposed = true;
			for (let index = pageRoots.length - 1; index >= 0; index--) {
				papi.remove(page, pageRoots[index]!);
			}
			pageRoots.length = 0;
			painted.length = 0;
			assigned.clear();
		},
	};
}
