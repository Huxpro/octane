// L0 direct-emission prototype — main-thread (lepus) program for the
// lynx-table fixture (issue #58).
//
// This file is what a `target: 'lynx'` compiler backend would emit for
// `app/src/App.lynx.tsrx`'s main-thread graph, written by hand for the one
// fixture: straight-line Element PAPI create functions per template, a slot
// table of node references per row instance, and a typed slot-delta applier —
// no plan objects, no prop-bag diffing, no per-command validation. It is a
// measurement fixture, not a shipping renderer; the honesty rules in
// ../README.md apply (same workload, same driver, same CSS as every cell).
//
// Templates (compile-time-known structure):
//   T_CHROME  page > view.page > text.title + view.toolbar > 12× btn + view.rows
//   T_ROW     view.row > text.col-id > raw, text.col-label > raw, text.col-remove > raw
//
// Delta opcodes (background → main, flat array, slot-addressed):
//   [OP_RUN_ROWS, count, id0, label0, id1, label1, ...]  append rows
//   [OP_CLEAR]                                           drop all rows
//   [OP_SET_LABEL, index, label]                         label slot write
//   [OP_SELECT, prevIndex|-1, nextIndex|-1]              class slot write
//   [OP_REMOVE, index]
//   [OP_SWAP, i, j]                                      keyed move (final DOM order)
// One message may carry several ops back-to-back; the applier flushes once.

/* global __CreatePage, __CreateView, __CreateText, __CreateRawText, __AppendElement,
   __InsertElementBefore, __RemoveElement, __SetClasses, __SetAttribute, __AddEvent,
   __GetElementUniqueID, __SetCSSId, __FlushElementTree */

(function () {
	'use strict';

	// __AUTO_ROWS__ is replaced by build.mjs (mount-create FCP ladder variant).
	var AUTO_ROWS = __AUTO_ROWS__;

	var OP_RUN_ROWS = 1;
	var OP_CLEAR = 2;
	var OP_SET_LABEL = 3;
	var OP_SELECT = 4;
	var OP_REMOVE = 5;
	var OP_SWAP = 6;

	var page = null;
	var pageId = 0;
	var rowsParent = null;

	// Slot table: one dense record per live row instance.
	// slots per row: [rowView, labelRaw] — the only slots any delta can address.
	// (col-id raw text is write-once; the danger class writes __SetClasses on
	// rowView; label updates rewrite labelRaw's text attribute.)
	var rowViews = [];
	var labelRaws = [];
	var selectedIndex = -1;

	var BTN_LABELS = [
		'Create 1,000 rows',
		'Create 3,000 rows',
		'Create 5,000 rows',
		'Create 10,000 rows',
		'Create 20,000 rows',
		'Create 30,000 rows',
		'Append 1,000 rows',
		'Update every 10th row',
		'Swap Rows',
		'Clear',
		'Update storm',
		'Select storm',
	];

	// -- T_ROW create function (the compiler-emitted straight-line body) -------
	// Event tokens are compile-time-stable strings; row identity rides in the
	// token (`s:` select, `r:` remove) so instances never re-register events.
	function createRow(id, label, selected) {
		var row = __CreateView(pageId);
		__SetClasses(row, selected ? 'row danger' : 'row');
		var colId = __CreateText(pageId);
		__SetClasses(colId, 'col-id');
		__AppendElement(colId, __CreateRawText(String(id)));
		__AppendElement(row, colId);
		var colLabel = __CreateText(pageId);
		__SetClasses(colLabel, 'col-label');
		__AddEvent(colLabel, 'bindEvent', 'tap', 's:' + id);
		var labelRaw = __CreateRawText(label);
		__AppendElement(colLabel, labelRaw);
		__AppendElement(row, colLabel);
		var colRemove = __CreateText(pageId);
		__SetClasses(colRemove, 'col-remove');
		__AddEvent(colRemove, 'bindEvent', 'tap', 'r:' + id);
		__AppendElement(colRemove, __CreateRawText('x'));
		__AppendElement(row, colRemove);
		__AppendElement(rowsParent, row);
		rowViews.push(row);
		labelRaws.push(labelRaw);
	}

	// -- T_CHROME create function ---------------------------------------------
	function createChrome() {
		page = __CreatePage('0', 0);
		__SetCSSId([page], 0);
		pageId = __GetElementUniqueID(page);
		var pageView = __CreateView(pageId);
		__SetClasses(pageView, 'page');
		var title = __CreateText(pageId);
		__SetClasses(title, 'title');
		__AppendElement(title, __CreateRawText('Octane UI Benchmark on Lynx · ready'));
		__AppendElement(pageView, title);
		var toolbar = __CreateView(pageId);
		__SetClasses(toolbar, 'toolbar');
		for (var i = 0; i < BTN_LABELS.length; i++) {
			var btn = __CreateView(pageId);
			__SetClasses(btn, 'btn');
			__AddEvent(btn, 'bindEvent', 'tap', 'b:' + i);
			var btnText = __CreateText(pageId);
			__SetClasses(btnText, 'btn-text');
			__AppendElement(btnText, __CreateRawText(BTN_LABELS[i]));
			__AppendElement(btn, btnText);
			__AppendElement(toolbar, btn);
		}
		__AppendElement(pageView, toolbar);
		rowsParent = __CreateView(pageId);
		__SetClasses(rowsParent, 'rows');
		__AppendElement(pageView, rowsParent);
		__AppendElement(page, pageView);
	}

	// -- deterministic mount ladder (mirrors app/src/data.ts buildDataSeeded) --
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

	function mountSeededRows(count) {
		for (var i = 0; i < count; i++) {
			createRow(
				i + 1,
				ADJECTIVES[i % 25] + ' ' + COLOURS[(i * 7) % 11] + ' ' + NOUNS[(i * 13) % 13],
				false,
			);
		}
	}

	// -- floor counters --------------------------------------------------------
	//
	// The architecture floor's answer to `reconcileChildren` visits (issue #103
	// U0). `rowVisits` is how many row regions a patch touches; `writes` is how
	// many PAPI slot writes it performs. Both are deterministic for a given
	// operation, which is what makes them comparable with the octane cell's
	// blueprint count rather than with a wall clock.
	//
	// Unconditional rather than build-flagged: a patch performs O(change)
	// increments, so `select` pays two integer adds against tens of
	// milliseconds. The measured cell and the counted cell are the same bundle.
	var floorCounters = { rowVisits: 0, writes: 0 };
	globalThis.__BENCH_DIRECT_MAIN__ = floorCounters;

	// -- slot-delta applier: table dispatch into pre-bound PAPI writes ---------
	function applyDelta(ops) {
		var i = 0;
		var n = ops.length;
		while (i < n) {
			var op = ops[i++];
			if (op === OP_RUN_ROWS) {
				var count = ops[i++];
				floorCounters.rowVisits += count;
				floorCounters.writes += count * 2;
				for (var k = 0; k < count; k++) {
					createRow(ops[i], ops[i + 1], false);
					i += 2;
				}
			} else if (op === OP_CLEAR) {
				floorCounters.rowVisits += rowViews.length;
				for (var c = rowViews.length - 1; c >= 0; c--) __RemoveElement(rowsParent, rowViews[c]);
				rowViews.length = 0;
				labelRaws.length = 0;
				selectedIndex = -1;
			} else if (op === OP_SET_LABEL) {
				var index = ops[i++];
				floorCounters.rowVisits += 1;
				floorCounters.writes += 1;
				__SetAttribute(labelRaws[index], 'text', ops[i++]);
			} else if (op === OP_SELECT) {
				var prev = ops[i++];
				var next = ops[i++];
				var touched = (prev === -1 ? 0 : 1) + (next === -1 ? 0 : 1);
				floorCounters.rowVisits += touched;
				floorCounters.writes += touched;
				if (prev !== -1) __SetClasses(rowViews[prev], 'row');
				if (next !== -1) __SetClasses(rowViews[next], 'row danger');
				selectedIndex = next;
			} else if (op === OP_REMOVE) {
				var at = ops[i++];
				floorCounters.rowVisits += 1;
				__RemoveElement(rowsParent, rowViews[at]);
				rowViews.splice(at, 1);
				labelRaws.splice(at, 1);
				if (selectedIndex === at) selectedIndex = -1;
				else if (selectedIndex > at) selectedIndex -= 1;
			} else if (op === OP_SWAP) {
				var a = ops[i++];
				var b = ops[i++];
				floorCounters.rowVisits += 2;
				var rowA = rowViews[a];
				var rowB = rowViews[b];
				var afterB = b + 1 < rowViews.length ? rowViews[b + 1] : null;
				__InsertElementBefore(rowsParent, rowB, rowA);
				if (afterB) __InsertElementBefore(rowsParent, rowA, afterB);
				else __AppendElement(rowsParent, rowA);
				rowViews[a] = rowB;
				rowViews[b] = rowA;
				var labelA = labelRaws[a];
				labelRaws[a] = labelRaws[b];
				labelRaws[b] = labelA;
				if (selectedIndex === a) selectedIndex = b;
				else if (selectedIndex === b) selectedIndex = a;
			} else {
				throw new Error('octane-direct: unknown delta op ' + op);
			}
		}
		__FlushElementTree(page);
	}

	// -- engine entry points ---------------------------------------------------
	globalThis.processData = function (data) {
		return data != null ? data : {};
	};
	globalThis.renderPage = function () {
		createChrome();
		if (AUTO_ROWS > 0) mountSeededRows(AUTO_ROWS);
		__FlushElementTree(page);
	};
	globalThis.updatePage = function () {};
	globalThis.updateGlobalProps = function () {};
	// Background → main: the typed slot-delta channel (callLepusMethod target).
	globalThis.octaneDirectPatch = function (message) {
		applyDelta(message.data);
	};
})();
