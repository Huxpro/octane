// Issue-#196 M1.5: the bookkeeping primitives the mount ledger is built from.
//
// This file is the *measured* half and holds no harness. It has no imports and
// uses nothing outside the language, so the same bodies can be driven by the
// Node/V8 runner beside it and by a device runner on LepusNG. That split is the
// point: a per-op cost is only spendable on an emission decision if both engines
// ran the same source, and #196 wants every row to carry the "a JIT would have
// hidden this" column next to the device one.
//
// Each body does `count` operations of one kind and returns a number that
// depends on all of them. V8 will delete work whose result nothing reads, and a
// deleted loop measures as free rather than as fast; the returned checksum is
// what stops that, and the runner consumes it.
//
// The shapes are taken from the real ledger rather than invented:
//
//   `mapSetGrowing`     `programNodes.set(id, node)` — one map growing to N.
//   `setAddGrowing`     `ownedNodes.add(node)` — the same for the ownership set.
//   `mapGetHit`         adoption resolving a node per described ID.
//   `setHasHit`         the adoption compare's `ownedNodes.has(programNode)`.
//   `mapPerHostOneEntry` `nativeEventMap(state, node).set(type, tuple)` — one map
//                       allocated per host to hold exactly one entry, which C19
//                       priced at 38.2 ms of 458 on web.
//   `objectLiteral` /   the journal tuple, unfrozen and frozen, because freezing
//   `objectFrozen`      is a separate charge on an interpreter.
//   `assertChain`       the per-site validation the mount runs before writing.
//   `eventPropParse`    `parseLynxNativeEventProp` resolving a plan constant.
//   `arrayPushGrowing`  the run journal C20 replaced the per-node writes with.
//   `arrayIndexWrite`   a preallocated table write, the floor the others are
//                       measured against.
//   `arrayIndexRead`    a preallocated table read compared against a number —
//                       the unit the #215 D1 run search is built from, so the
//                       map rows above have something to be priced against.

/** A stable, cheap value source: no allocation, no host call, no string work. */
function seed(index) {
	// eslint-disable-next-line no-bitwise -- an integer mix, not arithmetic.
	return (index * 2654435761) >>> 0;
}

export const PRIMITIVES = [
	{
		name: 'arrayIndexWrite',
		note: 'preallocated array index write — the floor every other row is read against',
		run(count) {
			const table = new Array(count);
			for (let index = 0; index < count; index++) table[index] = index;
			return table[count - 1];
		},
	},
	{
		name: 'arrayIndexRead',
		note: 'read a preallocated array entry and compare it to a number — the run-search unit',
		run(count) {
			const table = new Array(count);
			for (let index = 0; index < count; index++) table[index] = index;
			let hits = 0;
			for (let index = 0; index < count; index++) {
				const candidate = table[index];
				if (candidate === index) hits++;
				else if (candidate > index) hits--;
			}
			return hits;
		},
		// The write loop above is this row's own setup, so its cost has to come
		// back out: subtract `arrayIndexWrite` at the same count.
		subtract: 'arrayIndexWrite',
	},
	{
		name: 'arrayPushGrowing',
		note: 'push into a growing array — the run journal shape',
		run(count) {
			const table = [];
			for (let index = 0; index < count; index++) table.push(index);
			return table.length;
		},
	},
	{
		name: 'mapSetGrowing',
		note: 'programNodes.set(id, node) — one map growing to count',
		run(count) {
			const map = new Map();
			for (let index = 0; index < count; index++) map.set(index, index);
			return map.size;
		},
	},
	{
		name: 'mapGetHit',
		note: 'adoption resolving a node per described id — every lookup hits',
		run(count) {
			const map = new Map();
			for (let index = 0; index < count; index++) map.set(index, index);
			let total = 0;
			for (let index = 0; index < count; index++) total += map.get(index);
			return total;
		},
		// The build is not the measurement here, so it is subtracted using the
		// `mapSetGrowing` row rather than timed again inside this one.
		subtract: 'mapSetGrowing',
	},
	{
		name: 'setAddGrowing',
		note: 'ownedNodes.add(node) — one set growing to count',
		run(count) {
			const set = new Set();
			for (let index = 0; index < count; index++) set.add(index);
			return set.size;
		},
	},
	{
		name: 'setHasHit',
		note: "the adoption compare's ownedNodes.has(programNode) — every probe hits",
		run(count) {
			const set = new Set();
			for (let index = 0; index < count; index++) set.add(index);
			let total = 0;
			for (let index = 0; index < count; index++) if (set.has(index)) total++;
			return total;
		},
		subtract: 'setAddGrowing',
	},
	{
		name: 'mapPerHostOneEntry',
		note: 'nativeEventMap: one map allocated per host, holding one entry',
		run(count) {
			let total = 0;
			for (let index = 0; index < count; index++) {
				const map = new Map();
				map.set('bindtap', index);
				total += map.size;
			}
			return total;
		},
	},
	{
		name: 'objectLiteral',
		note: 'the journal tuple {source, binding, listener}, unfrozen',
		run(count) {
			let total = 0;
			for (let index = 0; index < count; index++) {
				const tuple = { source: 'background', binding: index, listener: index };
				total += tuple.listener;
			}
			return total;
		},
	},
	{
		name: 'objectFrozen',
		note: 'the same tuple, frozen — freezing is its own charge on an interpreter',
		run(count) {
			let total = 0;
			for (let index = 0; index < count; index++) {
				const tuple = Object.freeze({
					source: 'background',
					binding: index,
					listener: index,
				});
				total += tuple.listener;
			}
			return total;
		},
		subtract: 'objectLiteral',
	},
	{
		name: 'assertChain',
		note: 'the per-site validation the mount runs before it writes anything',
		run(count) {
			let total = 0;
			for (let index = 0; index < count; index++) {
				const value = seed(index);
				if (typeof value !== 'number') throw new TypeError('not a number');
				if (!Number.isSafeInteger(value)) throw new TypeError('not a safe integer');
				if (value < 0) throw new TypeError('negative');
				if (value === undefined) throw new TypeError('absent');
				total += value & 1;
			}
			return total;
		},
	},
	{
		name: 'eventPropParse',
		note: 'parseLynxNativeEventProp resolving a plan constant, once per site per row',
		run(count) {
			const props = ['bindtap', 'catchtap', 'bindlongpress', 'capture-bindtap'];
			let total = 0;
			for (let index = 0; index < count; index++) {
				const prop = props[index & 3];
				let kind = null;
				if (prop.startsWith('capture-bind')) kind = 'capture-bind';
				else if (prop.startsWith('catch')) kind = 'catch';
				else if (prop.startsWith('bind')) kind = 'bind';
				if (kind === null) continue;
				total += prop.length - kind.length;
			}
			return total;
		},
	},
];

/**
 * A scaling series rather than one point, because a single N cannot separate
 * per-op cost from the fixed cost of entering the loop — and on an interpreter
 * the fixed part is not negligible. The runner fits ns/op as the slope and
 * reports the residual, so a row whose cost is not linear in N says so instead
 * of being averaged into a number that means nothing.
 */
export const SERIES = [10_000, 30_000, 100_000, 300_000, 1_000_000];
