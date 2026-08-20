// L0 direct-emission prototype — background-thread program for the
// lynx-table fixture (issue #58).
//
// Owns the row state and mirrors app/src/App.lynx.tsrx operation-for-operation
// (create N / append / update every 10th / select / remove / swap / clear /
// update storm ×50 / select storm ×30, one MessageChannel macrotask per storm
// tick). Instead of a reconciler diff over a props bag, every state change
// emits the typed slot-delta ops that prototype/lepus-root.js applies with
// pre-bound PAPI writes. This models the Lynx-specialized background core's
// output format, not its hook/reconciler internals.

(function () {
	'use strict';

	var OP_RUN_ROWS = 1;
	var OP_CLEAR = 2;
	var OP_SET_LABEL = 3;
	var OP_SELECT = 4;
	var OP_REMOVE = 5;
	var OP_SWAP = 6;

	var AUTO_ROWS = __AUTO_ROWS__;

	var STORM_UPDATE_TICKS = 50;
	var STORM_SELECT_TICKS = 30;

	// -- state (mirrors the app's useState contents) ---------------------------
	var ids = [];
	var labels = [];
	var selectedId = -1;
	var nextId = 1;

	var ADJECTIVES = [
		'pretty',
		'large',
		'big',
		'small',
		'tall',
		'short',
		'long',
		'handsome',
		'plain',
		'quaint',
		'clean',
		'elegant',
		'easy',
		'angry',
		'crazy',
		'helpful',
		'mushy',
		'odd',
		'unsightly',
		'adorable',
		'important',
		'inexpensive',
		'cheap',
		'expensive',
		'fancy',
	];
	var COLOURS = [
		'red',
		'yellow',
		'blue',
		'green',
		'pink',
		'brown',
		'purple',
		'brown',
		'white',
		'black',
		'orange',
	];
	var NOUNS = [
		'table',
		'chair',
		'house',
		'bbq',
		'desk',
		'car',
		'pony',
		'cookie',
		'sandwich',
		'burger',
		'pizza',
		'mouse',
		'keyboard',
	];

	function randomIndex(max) {
		return Math.round(Math.random() * 1000) % max;
	}

	function seedInitialRows(count) {
		for (var i = 0; i < count; i++) {
			ids.push(nextId++);
			labels.push(ADJECTIVES[i % 25] + ' ' + COLOURS[(i * 7) % 11] + ' ' + NOUNS[(i * 13) % 13]);
		}
	}

	// -- floor counters --------------------------------------------------------
	//
	// The background half of the #103 U0 floor. `rowScans` counts row entries
	// this program examines to service an update. It is reported separately from
	// the main thread's region visits because it measures a different thing: the
	// state lookup, not the tree walk.
	//
	// It is also the one place this stub is honestly worse than the core it
	// models. `selectById` finds a row by scanning a plain id array; a Block core
	// holds the row's block directly and would visit one. The scan is counted
	// rather than optimized away so the floor is reported as measured, and it
	// costs microseconds against tens of milliseconds either way.
	//
	// `blockLookups` is the same accounting without that artifact: the number of
	// rows a keyed core would touch, because `ForSlot.items` is a `Map<key,
	// Block>` and the lookup is O(1). It is the count that answers "what does the
	// architecture visit", where `rowScans` answers "what did this stub visit".
	// Both are reported; neither is inferred from the other.
	var floorCounters = { rowScans: 0, blockLookups: 0 };
	globalThis.__BENCH_DIRECT_BG__ = floorCounters;

	// -- wire ------------------------------------------------------------------
	function sendDelta(ops) {
		var app = typeof lynx !== 'undefined' && lynx.getNativeApp ? lynx.getNativeApp() : null;
		if (app && app.callLepusMethod) {
			app.callLepusMethod('octaneDirectPatch', { data: ops }, function () {});
		}
	}

	function buildRowsDelta(count) {
		var ops = [OP_RUN_ROWS, count];
		for (var i = 0; i < count; i++) {
			var id = nextId++;
			var label =
				ADJECTIVES[randomIndex(25)] + ' ' + COLOURS[randomIndex(11)] + ' ' + NOUNS[randomIndex(13)];
			ids.push(id);
			labels.push(label);
			ops.push(id, label);
		}
		return ops;
	}

	// -- operations ------------------------------------------------------------
	function clearOps() {
		ids.length = 0;
		labels.length = 0;
		selectedId = -1;
		return [OP_CLEAR];
	}

	function createRows(count) {
		var ops = clearOps();
		return ops.concat(buildRowsDelta(count));
	}

	function appendRows(count) {
		return buildRowsDelta(count);
	}

	function updateEveryTenth() {
		var ops = [];
		for (var i = 0; i < ids.length; i += 10) {
			floorCounters.rowScans += 1;
			floorCounters.blockLookups += 1;
			labels[i] = labels[i] + ' !!!';
			ops.push(OP_SET_LABEL, i, labels[i]);
		}
		return ops;
	}

	function selectById(id) {
		var prev = selectedId === -1 ? -1 : ids.indexOf(selectedId);
		var next = id === -1 ? -1 : ids.indexOf(id);
		floorCounters.rowScans += (prev === -1 ? 0 : prev + 1) + (next === -1 ? 0 : next + 1);
		floorCounters.blockLookups += (prev === -1 ? 0 : 1) + (next === -1 ? 0 : 1);
		selectedId = id;
		return [OP_SELECT, prev, next];
	}

	function removeById(id) {
		var index = ids.indexOf(id);
		if (index === -1) return [];
		floorCounters.rowScans += index + 1;
		floorCounters.blockLookups += 1;
		ids.splice(index, 1);
		labels.splice(index, 1);
		if (selectedId === id) selectedId = -1;
		return [OP_REMOVE, index];
	}

	function swapRows() {
		if (ids.length <= 998) return [];
		floorCounters.blockLookups += 2;
		var idA = ids[1];
		ids[1] = ids[998];
		ids[998] = idA;
		var labelA = labels[1];
		labels[1] = labels[998];
		labels[998] = labelA;
		return [OP_SWAP, 1, 998];
	}

	// -- storms: one tick per MessageChannel macrotask (mirrors the app) -------
	var stormChannel = new MessageChannel();
	var stormPending = null;
	stormChannel.port1.onmessage = function () {
		var cb = stormPending;
		stormPending = null;
		if (cb) cb();
	};
	function nextMacrotask(cb) {
		stormPending = cb;
		stormChannel.port2.postMessage(0);
	}
	function runStorm(ticks, step) {
		var t = 0;
		var tick = function () {
			t += 1;
			step(t);
			if (t < ticks) nextMacrotask(tick);
		};
		nextMacrotask(tick);
	}

	function stormUpdate() {
		runStorm(STORM_UPDATE_TICKS, function (t) {
			var ops = [];
			for (var i = 0; i < ids.length; i += 10) {
				floorCounters.rowScans += 1;
				floorCounters.blockLookups += 1;
				labels[i] = 'bench ' + t;
				ops.push(OP_SET_LABEL, i, labels[i]);
			}
			sendDelta(ops);
		});
	}

	function stormSelect() {
		runStorm(STORM_SELECT_TICKS, function (t) {
			var id = t < STORM_SELECT_TICKS ? ids[(t * 97) % ids.length] : ids[0];
			sendDelta(selectById(id));
		});
	}

	// -- event routing ---------------------------------------------------------
	var BUTTON_ACTIONS = [
		function () {
			sendDelta(createRows(1000));
		},
		function () {
			sendDelta(createRows(3000));
		},
		function () {
			sendDelta(createRows(5000));
		},
		function () {
			sendDelta(createRows(10000));
		},
		function () {
			sendDelta(createRows(20000));
		},
		function () {
			sendDelta(createRows(30000));
		},
		function () {
			sendDelta(appendRows(1000));
		},
		function () {
			sendDelta(updateEveryTenth());
		},
		function () {
			sendDelta(swapRows());
		},
		function () {
			sendDelta(clearOps());
		},
		stormUpdate,
		stormSelect,
	];

	function handleEvent(handlerName) {
		if (typeof handlerName !== 'string') return;
		var kind = handlerName.charAt(0);
		var argument = handlerName.slice(2);
		if (kind === 'b') {
			var action = BUTTON_ACTIONS[Number(argument)];
			if (action) action();
		} else if (kind === 's') {
			sendDelta(selectById(Number(argument)));
		} else if (kind === 'r') {
			sendDelta(removeById(Number(argument)));
		}
	}

	seedInitialRows(AUTO_ROWS);

	// web-core delivers string-identified events to the background app through
	// lynxCoreInject.tt (same registration point the vendored reference cells
	// use). publicComponentEvent carries (componentId, handlerName, data).
	if (typeof lynxCoreInject !== 'undefined' && lynxCoreInject.tt) {
		var tt = lynxCoreInject.tt;
		tt.publishEvent = function (handlerName) {
			handleEvent(handlerName);
		};
		tt.publicComponentEvent = function (componentId, handlerName) {
			handleEvent(handlerName);
		};
	}
})();
