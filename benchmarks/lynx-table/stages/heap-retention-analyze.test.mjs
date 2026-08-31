// The retained-heap probe exists to stop a scalar from nominating an owner, so
// what is worth pinning is not its arithmetic but the ways it could hand back a
// name it did not earn: a misread column, a remainder dressed as a bucket, or a
// share table forced to 100%.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	NAMELESS_TYPES,
	aggregateHeapSnapshot,
	bucketName,
	diffAggregates,
	mib,
	readSnapshotMeta,
	shareOf,
	topRetainers,
} from './heap-retention-analyze.mjs';

const TYPES = ['hidden', 'object', 'string', 'code'];
const STRINGS = ['', 'Array', 'LynxProgramRun', 'hello', 'world'];

/** A snapshot in the default field order V8 emits today. */
function snapshot(nodes, fields = ['type', 'name', 'id', 'self_size', 'edge_count']) {
	return {
		snapshot: { meta: { node_fields: fields, node_types: [TYPES] } },
		nodes,
		strings: STRINGS,
	};
}

// type, name, id, self_size, edge_count
const DEFAULT_NODES = [
	1,
	1,
	1,
	100,
	0, // object:Array
	1,
	2,
	2,
	500,
	0, // object:LynxProgramRun
	2,
	3,
	3,
	20,
	0, // string 'hello'
	2,
	4,
	4,
	30,
	0, // string 'world'
];

test('folds a snapshot into named buckets and keeps the totals exact', () => {
	const { buckets, totalBytes, totalNodes } = aggregateHeapSnapshot(snapshot(DEFAULT_NODES));
	assert.equal(totalBytes, 650);
	assert.equal(totalNodes, 4);
	assert.deepEqual(buckets.get('object:Array'), { bytes: 100, count: 1 });
	assert.deepEqual(buckets.get('object:LynxProgramRun'), { bytes: 500, count: 1 });
});

test('a string bucket folds by type, because its name is data and not an owner', () => {
	const { buckets } = aggregateHeapSnapshot(snapshot(DEFAULT_NODES));
	// Two different string contents, one bucket, and the bytes are kept rather
	// than dropped — a nameless type still owns real retention.
	assert.deepEqual(buckets.get('string'), { bytes: 50, count: 2 });
	assert.equal(buckets.has('string:hello'), false);
	for (const type of NAMELESS_TYPES) assert.equal(bucketName(type, 'anything'), type);
});

test('reads its column offsets from the snapshot rather than assuming them', () => {
	// The same four nodes with `self_size` first. A hardcoded offset would read
	// the type column as a size here and report a total of 6.
	const reordered = [
		100,
		1,
		1,
		1,
		0, //
		500,
		1,
		2,
		2,
		0,
		20,
		2,
		3,
		3,
		0,
		30,
		2,
		4,
		4,
		0,
	];
	const fields = ['self_size', 'type', 'name', 'id', 'edge_count'];
	const { totalBytes, buckets } = aggregateHeapSnapshot(snapshot(reordered, fields));
	assert.equal(totalBytes, 650);
	assert.deepEqual(buckets.get('object:LynxProgramRun'), { bytes: 500, count: 1 });
});

test('a snapshot missing a column it needs fails rather than misreading one', () => {
	assert.throws(
		() => readSnapshotMeta(snapshot(DEFAULT_NODES, ['type', 'name', 'id', 'edge_count'])),
		/declares no `self_size`/,
	);
	assert.throws(() => readSnapshotMeta({}), /carries no `snapshot.meta`/);
});

test('a node array that does not divide by the stride is a failure, not a partial read', () => {
	assert.throws(
		() => aggregateHeapSnapshot(snapshot([1, 1, 1, 100])),
		/not a multiple of the node stride/,
	);
});

test('a diff keeps the buckets that shrank, because a teardown running is a result', () => {
	const before = aggregateHeapSnapshot(snapshot(DEFAULT_NODES));
	const after = aggregateHeapSnapshot(
		snapshot([
			1,
			1,
			1,
			900,
			0, // object:Array grew 100 -> 900
			2,
			3,
			3,
			5,
			0, // string shrank 50 -> 5
		]),
	);
	const diff = diffAggregates(after, before);
	const rows = new Map(diff.rows.map((row) => [row.bucket, row]));
	assert.equal(rows.get('object:Array').bytes, 800);
	assert.equal(rows.get('string').bytes, -45);
	// The run that disappeared entirely is reported at its full negative value,
	// not omitted for having no `after` side.
	assert.equal(rows.get('object:LynxProgramRun').bytes, -500);
	assert.equal(diff.totalBytes, 905 - 650);
});

test('the diff is ordered by growth, so the largest retainer reads first', () => {
	const before = aggregateHeapSnapshot(snapshot([1, 1, 1, 10, 0]));
	const after = aggregateHeapSnapshot(
		snapshot([
			1,
			1,
			1,
			20,
			0, // object:Array +10
			1,
			2,
			2,
			700,
			0, // object:LynxProgramRun +700
		]),
	);
	assert.deepEqual(
		diffAggregates(after, before).rows.map((row) => row.bucket),
		['object:LynxProgramRun', 'object:Array'],
	);
});

test('the tail is a remainder and never a bucket that could be blamed', () => {
	const before = aggregateHeapSnapshot(snapshot([]));
	const after = aggregateHeapSnapshot(
		snapshot([
			1,
			2,
			1,
			500,
			0, // object:LynxProgramRun, the largest grower
			1,
			1,
			2,
			300,
			0, // object:Array
			2,
			3,
			3,
			100,
			0, // string
		]),
	);
	const { head, tailBytes, tailBuckets, growthBytes } = topRetainers(
		diffAggregates(after, before),
		1,
	);
	assert.equal(head.length, 1);
	assert.equal(head[0].bucket, 'object:LynxProgramRun');
	// Everything past the head is one anonymous number, and it is not in `head`.
	assert.equal(tailBytes, 400);
	assert.equal(tailBuckets, 2);
	assert.equal(growthBytes, 900);
});

test('shares divide by the gap being attributed, so they do not sum to 100%', () => {
	// Two named owners covering 0.9 MB of a 3.34 MB gap must read as 27%, not as
	// 100% split between them — the unattributed remainder has to stay visible.
	const gap = 3.34 * 1024 * 1024;
	const named = shareOf(0.9 * 1024 * 1024, gap);
	assert.ok(named > 26 && named < 28, `expected roughly 27%, got ${named}`);
	assert.equal(shareOf(100, 0), null);
});

test('reports MiB, the unit the recipe prints', () => {
	assert.equal(mib(1024 * 1024), 1);
	assert.equal(mib(3.34 * 1024 * 1024), 3.34);
});
