// Attribution for the retained-heap probe (`heap-retention.mjs`).
//
// #241's retention oracle is a scalar: `heapMtsAfterClear`, one
// `Runtime.getHeapUsage` reading. A scalar can say a gap exists and can never
// say who owns it — #230's rule that a named remainder nominates nobody applies
// to a heap number exactly as it applies to `off_boundary`. E2 closed on clear
// *cost* and explicitly did not close on retention for that reason: 3.34 MB sat
// unattributed with no mechanism, and subtracting two totals would have
// manufactured an owner rather than found one.
//
// This half turns a V8 heap snapshot into **named buckets**, so the gap gets
// owners. It is separate from the probe because it decides a claim, and a claim
// generator is worth testing without spending a measurement window.

/**
 * Types whose `name` is data rather than an owner.
 *
 * A snapshot names a string node by its contents and a number node by nothing
 * useful. Bucketing those by name would produce tens of thousands of
 * one-element buckets and bury the handful of constructors that actually own
 * the retention. They still carry real bytes, so they are kept — folded into
 * one bucket per type rather than dropped.
 */
export const NAMELESS_TYPES = new Set([
	'string',
	'concatenated string',
	'sliced string',
	'number',
	'hidden',
	'code',
	'synthetic',
]);

/** V8 emits `self_size` in bytes; every total here is bytes for that reason. */
export const BYTES_PER_MIB = 1024 * 1024;

function fail(message) {
	throw new TypeError(`Octane heap-retention analysis: ${message}.`);
}

/**
 * The field offsets a snapshot declares for itself.
 *
 * `node_fields` is not a fixed layout — it has gained fields across V8 versions
 * (`detachedness` is recent). Reading the offsets from the snapshot rather than
 * hardcoding them is what keeps this correct when the browser moves under it,
 * and a missing field is a hard failure rather than a silent misread of the
 * wrong column.
 */
export function readSnapshotMeta(snapshot) {
	const meta = snapshot?.snapshot?.meta;
	if (meta === undefined || meta === null) fail('the snapshot carries no `snapshot.meta`');
	const fields = meta.node_fields;
	if (!Array.isArray(fields)) fail('`meta.node_fields` must be an array');
	const typeIndex = fields.indexOf('type');
	const nameIndex = fields.indexOf('name');
	const sizeIndex = fields.indexOf('self_size');
	if (typeIndex < 0) fail('`meta.node_fields` declares no `type`');
	if (nameIndex < 0) fail('`meta.node_fields` declares no `name`');
	if (sizeIndex < 0) fail('`meta.node_fields` declares no `self_size`');
	const types = meta.node_types?.[0];
	if (!Array.isArray(types)) fail('`meta.node_types[0]` must be the type-name array');
	return { stride: fields.length, typeIndex, nameIndex, sizeIndex, types };
}

/** `type:name`, or bare `type` where the name is data — see `NAMELESS_TYPES`. */
export function bucketName(type, name) {
	return NAMELESS_TYPES.has(type) ? type : `${type}:${name}`;
}

/**
 * Fold a snapshot into `bucket -> { bytes, count }`.
 *
 * Self size, not retained size. Retained size needs a dominator tree over the
 * whole edge graph, and summing self sizes over every node is exact and
 * additive where retained sizes double-count across shared owners. The question
 * here is "which constructors hold the surviving bytes", and self size answers
 * it without a second, heavier traversal whose result would be harder to defend.
 */
export function aggregateHeapSnapshot(snapshot) {
	const { stride, typeIndex, nameIndex, sizeIndex, types } = readSnapshotMeta(snapshot);
	const nodes = snapshot.nodes;
	const strings = snapshot.strings;
	if (!Array.isArray(nodes) && !ArrayBuffer.isView(nodes)) fail('`nodes` must be an array');
	if (!Array.isArray(strings)) fail('`strings` must be an array');
	if (nodes.length % stride !== 0) fail('`nodes` length is not a multiple of the node stride');
	const buckets = new Map();
	let totalBytes = 0;
	let totalNodes = 0;
	for (let offset = 0; offset < nodes.length; offset += stride) {
		const type = types[nodes[offset + typeIndex]];
		if (type === undefined) fail(`node at ${offset} carries an undeclared type`);
		const name = strings[nodes[offset + nameIndex]] ?? '';
		const bytes = nodes[offset + sizeIndex];
		const key = bucketName(type, name);
		const entry = buckets.get(key);
		if (entry === undefined) buckets.set(key, { bytes, count: 1 });
		else {
			entry.bytes += bytes;
			entry.count += 1;
		}
		totalBytes += bytes;
		totalNodes += 1;
	}
	return { buckets, totalBytes, totalNodes };
}

/**
 * Per-bucket movement between two aggregates, largest growth first.
 *
 * Both directions are kept. A bucket that *shrinks* across create-then-clear is
 * as much a result as one that grows — it is the evidence that the teardown it
 * belongs to actually ran — and dropping the negative rows would leave a table
 * that can only ever confirm retention.
 */
export function diffAggregates(after, before) {
	if (after?.buckets === undefined) fail('the `after` aggregate is not an aggregate');
	if (before?.buckets === undefined) fail('the `before` aggregate is not an aggregate');
	const keys = new Set([...after.buckets.keys(), ...before.buckets.keys()]);
	const rows = [];
	for (const key of keys) {
		const post = after.buckets.get(key) ?? { bytes: 0, count: 0 };
		const pre = before.buckets.get(key) ?? { bytes: 0, count: 0 };
		const bytes = post.bytes - pre.bytes;
		if (bytes === 0 && post.count === pre.count) continue;
		rows.push({
			bucket: key,
			bytes,
			count: post.count - pre.count,
			afterBytes: post.bytes,
			beforeBytes: pre.bytes,
		});
	}
	rows.sort((left, right) => right.bytes - left.bytes || left.bucket.localeCompare(right.bucket));
	return {
		rows,
		totalBytes: after.totalBytes - before.totalBytes,
		totalNodes: after.totalNodes - before.totalNodes,
	};
}

/**
 * The `n` largest growers, plus what the rest of the growth sums to.
 *
 * The remainder row is named `(other growth)` and is deliberately not an owner:
 * it is the same shape as `off_boundary`, and the whole point of this file is
 * that such a row may never nominate one.
 */
export function topRetainers(diff, n = 20) {
	if (!Number.isSafeInteger(n) || n <= 0) fail('the retainer count must be a positive integer');
	const growth = diff.rows.filter((row) => row.bytes > 0);
	const head = growth.slice(0, n);
	const tail = growth.slice(n);
	const tailBytes = tail.reduce((sum, row) => sum + row.bytes, 0);
	return {
		head,
		tailBytes,
		tailBuckets: tail.length,
		growthBytes: growth.reduce((sum, row) => sum + row.bytes, 0),
	};
}

/** MiB to two decimals — the unit `heap-after-clear.md` prints, not #241's MB. */
export function mib(bytes) {
	return +(bytes / BYTES_PER_MIB).toFixed(2);
}

/**
 * The share of a named bucket in the gap being attributed.
 *
 * The denominator is passed in rather than derived from the rows, because
 * dividing by the summed rows would force the shares to total 100% and hide
 * exactly the unattributed remainder this probe exists to expose.
 */
export function shareOf(bytes, gapBytes) {
	if (!Number.isFinite(gapBytes) || gapBytes === 0) return null;
	return +((bytes / gapBytes) * 100).toFixed(1);
}
