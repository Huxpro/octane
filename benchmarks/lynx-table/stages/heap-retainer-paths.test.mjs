// The fold's tables can only name a bucket; this half names what points at one,
// so what is worth pinning is every way it could hand back a *plausible* wrong
// owner: a misread column, an index printed as a string, a shortest chain
// mistaken for the only one, or an unreachable node dressed as a root-held one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	INDEXED_EDGE_TYPES,
	buildRootPaths,
	edgeLabel,
	immediateRetainers,
	nodesInBucket,
	readSnapshotEdgeMeta,
	rootPathFor,
} from './heap-retainer-paths.mjs';

const NODE_TYPES = ['hidden', 'object', 'array', 'string', 'synthetic'];
const EDGE_TYPES = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'];
const STRINGS = ['', 'Window', 'ElementTable', 'Other', 'table', 'elements', 'other'];

// type, name, id, self_size, edge_count
const NODES = [
	4,
	0,
	1,
	0,
	1, // 0 synthetic root
	1,
	1,
	2,
	100,
	2, // 1 object:Window
	1,
	2,
	3,
	50,
	1, // 2 object:ElementTable
	2,
	0,
	4,
	524288,
	0, // 3 array: — the backing store under test
	1,
	3,
	5,
	40,
	1, // 4 object:Other, a second holder of node 3
	2,
	0,
	6,
	64,
	0, // 5 array: reachable from nothing
];

// type, name_or_index, to_node (a byte offset: ordinal * 5)
const EDGES = [
	5,
	1,
	5, // 0: root --shortcut:Window--> 1
	2,
	4,
	10, // 1: Window --.table--> 2
	2,
	6,
	20, // 2: Window --.other--> 4
	3,
	5,
	15, // 3: ElementTable --internal:elements--> 3
	1,
	2,
	15, // 4: Other --[2]--> 3
];

function snapshot({
	nodeFields = ['type', 'name', 'id', 'self_size', 'edge_count'],
	nodes = NODES,
	edges = EDGES,
} = {}) {
	return {
		snapshot: {
			meta: {
				node_fields: nodeFields,
				node_types: [NODE_TYPES],
				edge_fields: ['type', 'name_or_index', 'to_node'],
				edge_types: [EDGE_TYPES],
			},
		},
		nodes,
		edges,
		strings: STRINGS,
	};
}

test('finds the nodes behind a bucket row, largest first', () => {
	const found = nodesInBucket(snapshot(), 'array:');
	assert.deepEqual(found, [
		{ ordinal: 3, bytes: 524288 },
		{ ordinal: 5, bytes: 64 },
	]);
});

test('names every holder of a node, not only the first', () => {
	const retainers = immediateRetainers(snapshot(), [3]);
	assert.deepEqual(retainers.get(3), [
		{ holder: 'object:ElementTable', via: 'internal:elements' },
		{ holder: 'object:Other', via: '[2]' },
	]);
});

test('reads an element edge as an index and a property edge as a name', () => {
	const snap = snapshot();
	const meta = readSnapshotEdgeMeta(snap);
	assert.equal(edgeLabel(snap, meta, 4), '[2]');
	assert.equal(edgeLabel(snap, meta, 1), '.table');
	assert.equal(edgeLabel(snap, meta, 3), 'internal:elements');
	assert.ok(INDEXED_EDGE_TYPES.has('element'));
});

test('walks a chain from the GC root down to the node, root end first', () => {
	const snap = snapshot();
	const paths = buildRootPaths(snap);
	assert.deepEqual(rootPathFor(snap, paths, 3), [
		{ holder: 'synthetic', via: 'shortcut:Window' },
		{ holder: 'object:Window', via: '.table' },
		{ holder: 'object:ElementTable', via: 'internal:elements' },
	]);
});

test('answers null for a node no root reaches, never an empty path', () => {
	const snap = snapshot();
	const paths = buildRootPaths(snap);
	assert.equal(rootPathFor(snap, paths, 5), null);
	// The empty path belongs to the root itself, which is reached and has no hops.
	assert.deepEqual(rootPathFor(snap, paths, 0), []);
});

test('reads the offsets the snapshot declares rather than the order V8 happens to emit', () => {
	// self_size, edge_count, type, name, id — the same graph, columns shuffled.
	const shuffled = [];
	for (let ordinal = 0; ordinal * 5 < NODES.length; ordinal++) {
		const [type, name, id, size, edgeCount] = NODES.slice(ordinal * 5, ordinal * 5 + 5);
		shuffled.push(size, edgeCount, type, name, id);
	}
	const snap = snapshot({
		nodeFields: ['self_size', 'edge_count', 'type', 'name', 'id'],
		nodes: shuffled,
	});
	assert.deepEqual(nodesInBucket(snap, 'array:'), [
		{ ordinal: 3, bytes: 524288 },
		{ ordinal: 5, bytes: 64 },
	]);
	assert.deepEqual(rootPathFor(snap, buildRootPaths(snap), 3).at(-1), {
		holder: 'object:ElementTable',
		via: 'internal:elements',
	});
});

test('refuses a snapshot whose nodes and edges disagree on how many edges exist', () => {
	assert.throws(
		() => buildRootPaths(snapshot({ edges: EDGES.slice(0, 9) })),
		/disagree on how many edges exist/,
	);
});

test('refuses a snapshot that declares no `to_node` column', () => {
	const snap = snapshot();
	snap.snapshot.meta.edge_fields = ['type', 'name_or_index'];
	assert.throws(() => readSnapshotEdgeMeta(snap), /declares no `to_node`/);
});
