// Retainer paths for the retained-heap probe (`heap-retention.mjs`).
//
// `aggregateHeapSnapshot` answers *which constructors hold the surviving
// bytes*. It stops there deliberately, and says so: self size over every node
// is exact and additive, where a retained size double-counts across shared
// owners. That was the right instrument for the question E2 left open, and it
// is why the `object:WeakRef` row could be closed with a mechanism.
//
// It is not enough for the row it could not close. `array:` survives every
// create-and-clear cycle at roughly its own size, and after #250 it is the
// dominant named grower in the managed heap. A bucket called `array:` nominates
// nobody: `array` is V8's own type for an unnamed backing store, so the name is
// the *shape* of the thing and never its owner.
//
// So this walks the graph the fold does not: from a chosen node outwards to
// whatever points at it, and back to a GC root. A path is evidence in a way a
// bucket name is not — it can be read, disputed, and followed into the source.

import { bucketName, readSnapshotMeta } from './heap-retention-analyze.mjs';

function fail(message) {
	throw new TypeError(`Octane heap-retainer analysis: ${message}.`);
}

/**
 * The node-side offset this file needs on top of `readSnapshotMeta`'s.
 *
 * `edge_count` is what makes the flat edge array navigable: edges are stored
 * contiguously in node order with no per-node index, so a node's edges can only
 * be found by summing every preceding node's count. Read from the snapshot for
 * the same reason the other offsets are — `node_fields` has gained fields
 * across V8 versions, and a hardcoded column silently reads the wrong one.
 */
export function readNodeEdgeMeta(snapshot) {
	const fields = snapshot?.snapshot?.meta?.node_fields;
	if (!Array.isArray(fields)) fail('`meta.node_fields` must be an array');
	const edgeCountIndex = fields.indexOf('edge_count');
	if (edgeCountIndex < 0) fail('`meta.node_fields` declares no `edge_count`');
	return { stride: fields.length, edgeCountIndex };
}

/**
 * The edge-side offsets, plus the edge-type table.
 *
 * `to_node` is a **byte offset into `nodes`**, not an ordinal — V8 stores the
 * destination pre-multiplied by the node stride. Dividing it back out is the
 * one conversion every reader here depends on, so it happens in exactly the two
 * places that walk edges and nowhere else.
 */
export function readSnapshotEdgeMeta(snapshot) {
	const meta = snapshot?.snapshot?.meta;
	if (meta === undefined || meta === null) fail('the snapshot carries no `snapshot.meta`');
	const fields = meta.edge_fields;
	if (!Array.isArray(fields)) fail('`meta.edge_fields` must be an array');
	const typeIndex = fields.indexOf('type');
	const nameIndex = fields.indexOf('name_or_index');
	const toNodeIndex = fields.indexOf('to_node');
	if (typeIndex < 0) fail('`meta.edge_fields` declares no `type`');
	if (nameIndex < 0) fail('`meta.edge_fields` declares no `name_or_index`');
	if (toNodeIndex < 0) fail('`meta.edge_fields` declares no `to_node`');
	const types = meta.edge_types?.[0];
	if (!Array.isArray(types)) fail('`meta.edge_types[0]` must be the edge-type-name array');
	return { stride: fields.length, typeIndex, nameIndex, toNodeIndex, types };
}

/**
 * Edge types whose `name_or_index` is an array index rather than a string id.
 *
 * One column doing two jobs. Reading it the wrong way turns an index into
 * whatever string happens to sit at that offset — a wrong label indistinguishable
 * from a right one, which is the failure this table exists to stop.
 */
export const INDEXED_EDGE_TYPES = new Set(['element', 'hidden']);

/** `.name`, `[7]`, or `type:name` — how one hop reads inside a path. */
export function edgeLabel(snapshot, edgeMeta, edgeIndex) {
	const { stride, typeIndex, nameIndex, types } = edgeMeta;
	const type = types[snapshot.edges[edgeIndex * stride + typeIndex]];
	if (type === undefined) fail(`edge ${edgeIndex} carries an undeclared type`);
	const raw = snapshot.edges[edgeIndex * stride + nameIndex];
	if (INDEXED_EDGE_TYPES.has(type)) return `[${raw}]`;
	const name = snapshot.strings[raw] ?? '';
	if (type === 'property') return `.${name}`;
	return `${type}:${name}`;
}

/** `type:name` for one node — the same key the fold buckets by. */
export function nodeLabel(snapshot, meta, ordinal) {
	const { stride, typeIndex, nameIndex, types } = meta;
	const type = types[snapshot.nodes[ordinal * stride + typeIndex]];
	const name = snapshot.strings[snapshot.nodes[ordinal * stride + nameIndex]] ?? '';
	return bucketName(type, name);
}

/**
 * The nodes behind one row of the fold's table, largest self size first.
 *
 * The bucket is the unit that table already reports, so an Order starting from
 * a row in it can hand this the same string and get the nodes underneath.
 * Sorted by size because those nodes are not equal — the question is who holds
 * the ~500 KB one, and heap order buries it among its small neighbours.
 */
export function nodesInBucket(snapshot, bucket, { limit = 10 } = {}) {
	const meta = readSnapshotMeta(snapshot);
	const { stride, typeIndex, nameIndex, sizeIndex, types } = meta;
	const found = [];
	for (let offset = 0; offset < snapshot.nodes.length; offset += stride) {
		const type = types[snapshot.nodes[offset + typeIndex]];
		if (type === undefined) fail(`node at ${offset} carries an undeclared type`);
		const name = snapshot.strings[snapshot.nodes[offset + nameIndex]] ?? '';
		if (bucketName(type, name) !== bucket) continue;
		found.push({ ordinal: offset / stride, bytes: snapshot.nodes[offset + sizeIndex] });
	}
	found.sort((left, right) => right.bytes - left.bytes || left.ordinal - right.ordinal);
	return found.slice(0, limit);
}

/**
 * Everything that points directly at each of `ordinals`.
 *
 * One sequential pass over the edge table, collecting only edges that land on a
 * target. The alternative is a full reverse index, which costs eight bytes an
 * edge across millions of edges to answer a question asked about ten nodes —
 * and this probe already declines to hold the raw snapshot for that reason.
 *
 * This is the *exact* answer to "who is holding this", which a root path is
 * not: a shortest path from a root names one chain, while a node with three
 * retainers has three, and which of them matters is the reader's call.
 */
export function immediateRetainers(snapshot, ordinals) {
	const { stride: nodeStride, edgeCountIndex } = readNodeEdgeMeta(snapshot);
	const edgeMeta = readSnapshotEdgeMeta(snapshot);
	const meta = readSnapshotMeta(snapshot);
	const wanted = new Map();
	for (const ordinal of ordinals) wanted.set(ordinal, []);

	let edge = 0;
	const nodeCount = snapshot.nodes.length / nodeStride;
	for (let ordinal = 0; ordinal < nodeCount; ordinal++) {
		const outgoing = snapshot.nodes[ordinal * nodeStride + edgeCountIndex];
		for (let index = 0; index < outgoing; index++, edge++) {
			const target = snapshot.edges[edge * edgeMeta.stride + edgeMeta.toNodeIndex] / nodeStride;
			const into = wanted.get(target);
			if (into === undefined) continue;
			into.push({
				holder: nodeLabel(snapshot, meta, ordinal),
				via: edgeLabel(snapshot, edgeMeta, edge),
			});
		}
	}
	return wanted;
}

/**
 * Reach every node from the GC root once, keeping the edge that first found it.
 *
 * Breadth-first, so the first edge to reach a node lies on a shortest chain
 * from a root, and the predecessor table it fills answers every target at once
 * rather than re-walking the graph per question.
 *
 * **What a path from this table is, stated precisely, because it is the claim.**
 * It is *a* shortest chain of references from a GC root to the node. It is not
 * the only chain, and shortest is not the same as responsible. It nominates a
 * retainer to go and read in the source; it does not by itself prove that
 * retainer is why the bytes survive.
 */
export function buildRootPaths(snapshot) {
	const { stride: nodeStride, edgeCountIndex } = readNodeEdgeMeta(snapshot);
	const edgeMeta = readSnapshotEdgeMeta(snapshot);
	const nodes = snapshot.nodes;
	const edges = snapshot.edges;
	if (nodes.length % nodeStride !== 0) fail('`nodes` length is not a multiple of the node stride');
	if (edges.length % edgeMeta.stride !== 0)
		fail('`edges` length is not a multiple of the edge stride');
	const nodeCount = nodes.length / nodeStride;

	// A node's first edge is the sum of every preceding node's count. Computed
	// once rather than re-summed per visit, which is the difference between one
	// pass and a quadratic one.
	const firstEdge = new Int32Array(nodeCount + 1);
	for (let ordinal = 0; ordinal < nodeCount; ordinal++)
		firstEdge[ordinal + 1] = firstEdge[ordinal] + nodes[ordinal * nodeStride + edgeCountIndex];
	if (firstEdge[nodeCount] !== edges.length / edgeMeta.stride)
		fail('the nodes and the edge table disagree on how many edges exist');

	// -1 is "unreached", and that is a result rather than a gap: a node no walk
	// arrives at is retained by nothing this snapshot can see.
	const cameFromNode = new Int32Array(nodeCount).fill(-1);
	const cameFromEdge = new Int32Array(nodeCount).fill(-1);
	const seen = new Uint8Array(nodeCount);

	// Node 0 is V8's synthetic root, seeded as reached-from-nowhere so the walk
	// back below has a terminator that is not also a real retainer.
	const queue = new Int32Array(nodeCount);
	let head = 0;
	let tail = 0;
	queue[tail++] = 0;
	seen[0] = 1;
	while (head < tail) {
		const ordinal = queue[head++];
		const end = firstEdge[ordinal + 1];
		for (let edge = firstEdge[ordinal]; edge < end; edge++) {
			const target = edges[edge * edgeMeta.stride + edgeMeta.toNodeIndex] / nodeStride;
			if (seen[target] === 1) continue;
			seen[target] = 1;
			cameFromNode[target] = ordinal;
			cameFromEdge[target] = edge;
			queue[tail++] = target;
		}
	}
	return { cameFromNode, cameFromEdge, seen, edgeMeta, meta: readSnapshotMeta(snapshot) };
}

/** How many hops a path may carry before it is truncated rather than followed. */
export const MAX_PATH_HOPS = 64;

/**
 * The chain of references from a GC root down to `ordinal`, root end first.
 *
 * Returns `null` for a node the walk never reached. "Unreachable from any root
 * in this snapshot" and "held by the root directly" are opposite findings and
 * must not share a spelling, so the empty path is reserved for the second.
 */
export function rootPathFor(snapshot, paths, ordinal) {
	const { cameFromNode, cameFromEdge, seen, meta, edgeMeta } = paths;
	if (seen[ordinal] !== 1) return null;
	const hops = [];
	let current = ordinal;
	while (current !== 0 && hops.length < MAX_PATH_HOPS) {
		const from = cameFromNode[current];
		if (from < 0) break;
		hops.push({
			holder: nodeLabel(snapshot, meta, from),
			via: edgeLabel(snapshot, edgeMeta, cameFromEdge[current]),
		});
		current = from;
	}
	return hops.reverse();
}
