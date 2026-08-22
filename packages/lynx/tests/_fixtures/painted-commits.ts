/**
 * What a stream of accepted commits actually painted, in a form two independent
 * cores can be compared on.
 *
 * Every Block-core differential asks the same question — did the specialized
 * core tell the host the same thing the universal core told it — and answers it
 * on the same three artifacts:
 *
 *   physical tree    what the shared applier painted, including event sites.
 *   handle journal   the clone-safe public handle changes main publishes before
 *                    acknowledging, which is what the background adopts.
 *   event journal    every `setEvent` the applier issued, in order.
 *
 * The comparison is only meaningful because the applier, the wire, and the PAPI
 * layer are shared: a forked applier would make byte-equality prove nothing. It
 * lives here rather than in one suite because the derived component program and
 * the hand-written program are compared against the same universal core in the
 * same way, and two copies of a normalizer are two chances to normalize away a
 * difference that matters.
 */

import { createLynxHostContainer, prepareLynxHostBatch } from '../../src/core/host-driver.js';
import type { LynxElementPAPI } from '../../src/core/papi.js';
import type { LynxTransportCommitMessage } from '../../src/core/protocol.js';
import {
	createFakePAPI,
	shape,
	withoutAllocatorIdentity,
	type FakeNode,
} from './fake-element-papi.js';

/**
 * Rename every integer to its rank in first-appearance order.
 *
 * Applied to each column's artifacts independently, so it can only make them
 * equal when one allocator's numbers map onto the other's one-for-one. Two
 * distinct ids collapsing to one rank is impossible: a rank is assigned per
 * distinct value.
 */
export function withoutAllocatorNumbers(text: string): string {
	const ranks = new Map<string, number>();
	return text.replace(/\d+/g, (digits) => {
		if (!ranks.has(digits)) ranks.set(digits, ranks.size);
		return `#${ranks.get(digits)}`;
	});
}

/**
 * Rank each column's integers in its own namespace.
 *
 * A native event token carries a host id and a listener id in different fields,
 * and the two cores draw them from independent counters — the Block core's
 * listener counter starts at 1, so listener 1 and host 1 are different things
 * that happen to be spelled the same. Ranking the whole journal in one
 * namespace conflates them and reports a difference that is not one. Ranking
 * per column keeps each allocator compared only against its counterpart, and
 * the token's shape — how many fields, which are numeric, what the tail says —
 * is still compared literally.
 */
export function withoutAllocatorColumns(rows: readonly (readonly string[])[]): string {
	const ranks: Map<string, number>[] = [];
	return JSON.stringify(
		rows.map((row) =>
			row.map((field, column) => {
				if (!/^\d+$/.test(field)) return field;
				const namespace = (ranks[column] ??= new Map());
				if (!namespace.has(field)) namespace.set(field, namespace.size);
				return `#${namespace.get(field)}`;
			}),
		),
	);
}

export interface EventJournalPAPI {
	readonly papi: LynxElementPAPI<FakeNode> & { readonly pages: FakeNode[]; flushes(): number };
	/** One row per `setEvent`, split into columns so each is ranked separately. */
	readonly journal: string[][];
}

/** The shared fake host, plus an ordered record of what it was told about events. */
export function journallingPAPI(): EventJournalPAPI {
	const papi = createFakePAPI();
	const journal: string[][] = [];
	const seen = new Map<FakeNode, number>();
	const rank = (node: FakeNode): number => {
		if (!seen.has(node)) seen.set(node, seen.size);
		return seen.get(node)!;
	};
	return {
		papi: {
			...papi,
			setEvent(node: FakeNode, kind: string, name: string, listener: unknown) {
				journal.push([
					String(rank(node)),
					kind,
					name,
					...(listener === undefined
						? ['cleared']
						: typeof listener === 'string'
							? listener.split(':')
							: ['worklet']),
				]);
				papi.setEvent(node, kind, name, listener as never);
			},
		},
		journal,
	};
}

/**
 * Sort a commit's teardown deltas by host id, in place.
 *
 * Within one batch the destroyed hosts are independent of each other and of the
 * order they are named in: the commit is indivisible, the host applies it as a
 * unit, and nothing downstream can observe which of two unrelated hosts was
 * destroyed first. The two cores do differ here — the universal core tears a
 * range down from its last member and the Block core from its first — so
 * comparing that order compares an implementation choice neither core has ever
 * promised. Everything else stays exactly where it was: create order, the
 * interleaving of creates and teardowns, and the order of commits.
 */
export function withStableTeardownOrder(deltas: readonly unknown[]): unknown[] {
	const ordered = [...deltas];
	const positions: number[] = [];
	for (let index = 0; index < ordered.length; index++) {
		if ((ordered[index] as { op?: string }).op === 'destroy') positions.push(index);
	}
	if (positions.length < 2) return ordered;
	const teardowns = positions
		.map((index) => ordered[index] as { id: number })
		.sort((left, right) => left.id - right.id);
	for (let slot = 0; slot < positions.length; slot++) {
		ordered[positions[slot]!] = teardowns[slot]!;
	}
	return ordered;
}

/**
 * The same teardown normalization for the event journal: within one commit, the
 * order in which independent event sites are cleared is not a contract, and it
 * follows the same last-member/first-member difference as the handle deltas.
 * Only `cleared` rows move, and only among themselves.
 */
export function stabilizeClearedEvents(journal: string[][], from: number): void {
	const positions: number[] = [];
	for (let index = from; index < journal.length; index++) {
		if (journal[index]![3] === 'cleared') positions.push(index);
	}
	if (positions.length < 2) return;
	const cleared = positions
		.map((index) => journal[index]!)
		.sort((left, right) => Number(left[0]) - Number(right[0]));
	for (let slot = 0; slot < positions.length; slot++) {
		journal[positions[slot]!] = cleared[slot]!;
	}
}

export interface Painted {
	readonly tree: string;
	readonly handles: string;
	readonly events: string;
}

/** Replay every accepted commit through the real applier onto a fake host. */
export function paint(commits: readonly LynxTransportCommitMessage[]): Painted {
	const { papi, journal } = journallingPAPI();
	const container = createLynxHostContainer(papi, { root: 1 });
	const handles: unknown[] = [];
	for (const commit of commits) {
		const prepared = prepareLynxHostBatch(container, commit.batch);
		handles.push(...withStableTeardownOrder(prepared.handleDelta));
		const journalledBefore = journal.length;
		prepared.apply();
		stabilizeClearedEvents(journal, journalledBefore);
	}
	return {
		tree: withoutAllocatorNumbers(JSON.stringify(withoutAllocatorIdentity(shape(papi.pages[0]!)))),
		handles: withoutAllocatorNumbers(JSON.stringify(handles)),
		events: withoutAllocatorColumns(journal),
	};
}
