// T0 floor for Huxpro/octane#197. This bundle owns no framework runtime on
// either thread: it creates the fixed fixture tree with Element PAPI, handles
// touchstart on MTS, mutates the response directly, and records the first
// changed VSYNC from Lynx's platform RAF timestamp.

/* global __AddEvent, __AddInlineStyle, __AppendElement, __CreatePage,
   __CreateRawText, __CreateScrollView, __CreateText, __CreateView,
   __FlushElementTree, __GetAttributeByName, __GetComputedStyleByKey,
   __GetElementUniqueID, __InvokeUIMethod, __QuerySelector, __RemoveElement,
   __SetAttribute, __SetClasses, __SetCSSId, __SetID, lynx */

(function () {
	'use strict';

	var SHAPE = '__SHAPE__';
	var LOAD = '__LOAD__';
	var TARGET_ID = 'target-8';
	var IDLE_COLOR = 'rgb(255, 255, 255)';
	var ACTIVE_COLOR = 'rgb(255, 213, 79)';
	var EVEN_COLOR = 'rgb(227, 242, 253)';
	var ODD_COLOR = 'rgb(187, 222, 251)';

	var page = null;
	var pageId = 0;
	var targetRow = null;
	var interactionPanel = null;
	var counter = null;
	var counterText = null;
	var loadScroll = null;
	var worklets = Object.create(null);

	globalThis.runWorklet = function (descriptor, args) {
		var implementation = descriptor && worklets[descriptor._wkltId];
		if (!implementation) throw new Error('issue197 T0: unknown worklet');
		return implementation(args && args[0]);
	};

	function listener(id) {
		// Element PAPI only dispatches activated worklet descriptors. Octane's
		// registry normally supplies this positive main-local activation token;
		// T0 has no framework registry, so its two page-lifetime handlers own two
		// fixed tokens and the local runWorklet table validates the worklet id.
		return { type: 'worklet', value: { _wkltId: id, _owlt: id === 'issue197:t0:observe' ? 1 : 2 } };
	}

	function appendText(parent, className, id, value) {
		var text = __CreateText(pageId);
		if (className) __SetClasses(text, className);
		if (id) __SetID(text, id);
		__AppendElement(text, __CreateRawText(value));
		__AppendElement(parent, text);
		return text;
	}

	function createTree() {
		page = __CreatePage('0', 0);
		__SetCSSId([page], 0);
		pageId = __GetElementUniqueID(page);

		var pageView = __CreateView(pageId);
		__SetClasses(pageView, 'page');

		var header = __CreateView(pageId);
		__SetClasses(header, 'header');
		appendText(header, 'title', null, 'Touch to first changed frame');

		counter = __CreateView(pageId);
		__SetID(counter, 'remote-counter');
		__SetClasses(counter, 'remote-counter');
		__SetAttribute(counter, 'data-count', '0');
		counterText = appendText(counter, 'remote-counter-value', 'remote-counter-value', '0');
		__AppendElement(header, counter);
		__AppendElement(pageView, header);

		interactionPanel = __CreateView(pageId);
		__SetClasses(interactionPanel, 'interaction-panel');
		for (var index = 1; index <= 16; index++) {
			var row = __CreateView(pageId);
			__SetID(row, 'target-' + index);
			__SetClasses(row, 'target-row');
			appendText(row, 'target-label', null, 'Interaction row ' + index);
			__AppendElement(interactionPanel, row);
			if (index === 8) targetRow = row;
		}
		__AppendElement(pageView, interactionPanel);

		loadScroll = __CreateScrollView(pageId);
		__SetClasses(loadScroll, 'load-scroll');
		__SetAttribute(loadScroll, 'scroll-orientation', 'vertical');
		__SetAttribute(loadScroll, 'scroll-bar-enable', false);
		var loadContent = __CreateView(pageId);
		__SetClasses(loadContent, 'load-content');
		for (var loadIndex = 1; loadIndex <= 200; loadIndex++) {
			var loadRow = __CreateView(pageId);
			__SetClasses(loadRow, loadIndex % 2 === 0 ? 'load-row load-row-alt' : 'load-row');
			appendText(loadRow, 'load-label', null, 'Scroll load row ' + loadIndex);
			__AppendElement(loadContent, loadRow);
		}
		__AppendElement(loadScroll, loadContent);
		__AppendElement(pageView, loadScroll);
		__AppendElement(page, pageView);

		__AddEvent(pageView, 'capture-bind', 'touchstart', listener('issue197:t0:observe'));
		__AddEvent(targetRow, 'bindEvent', 'touchstart', listener('issue197:t0:respond'));
	}

	function responseChanged(before) {
		if (SHAPE === 'local-toggle') {
			return __GetComputedStyleByKey(targetRow, 'background-color') !== before;
		}
		if (SHAPE === 'cross-component') {
			return __GetComputedStyleByKey(counter, 'background-color') !== before;
		}
		return __QuerySelector(interactionPanel, '#target-8', {}) === null;
	}

	worklets['issue197:t0:observe'] = function (event) {
		var before = '';
		if (SHAPE === 'local-toggle') {
			before = __GetComputedStyleByKey(targetRow, 'background-color');
		} else if (SHAPE === 'cross-component') {
			before = __GetComputedStyleByKey(counter, 'background-color');
		}
		var inputPlatformTimestamp = event.timestamp;
		var changedFrameOrdinal = 0;
		var poll = function (changedVsyncPlatformTimestamp) {
			changedFrameOrdinal += 1;
			if (responseChanged(before)) {
				throw new Error(
					'ISSUE197_SAMPLE ' +
						JSON.stringify({
							shape: SHAPE,
							topology: 'T0',
							load: LOAD,
							inputPlatformTimestamp: inputPlatformTimestamp,
							changedVsyncPlatformTimestamp: changedVsyncPlatformTimestamp,
							changedFrameOrdinal: changedFrameOrdinal,
							inputClock: 'unix-epoch-ms',
							changedVsyncClock: 'android-uptime-ms',
							clock: 'lynx-event-epoch-ms-to-raf-uptime-ms-with-android-platform-calibration',
							observer: 'mts-capture-touchstart-raf-predicate',
						}),
				);
			}
			if (changedFrameOrdinal >= 120) {
				throw new Error('ISSUE197_OBSERVER_FAILURE T0 predicate unchanged after 120 VSYNCs');
			}
			requestAnimationFrame(poll);
		};
		requestAnimationFrame(poll);
	};

	worklets['issue197:t0:respond'] = function () {
		if (SHAPE === 'local-toggle') {
			var active = __GetAttributeByName(targetRow, 'data-active') === '1';
			__SetAttribute(targetRow, 'data-active', active ? '0' : '1');
			__AddInlineStyle(targetRow, 'background-color', active ? IDLE_COLOR : ACTIVE_COLOR);
		} else if (SHAPE === 'cross-component') {
			var current = Number(__GetAttributeByName(counter, 'data-count')) || 0;
			var next = current + 1;
			__SetAttribute(counter, 'data-count', String(next));
			__SetAttribute(counterText, 'text', String(next));
			__AddInlineStyle(counter, 'background-color', next % 2 === 0 ? EVEN_COLOR : ODD_COLOR);
		} else {
			__RemoveElement(interactionPanel, targetRow);
		}
		__FlushElementTree();
	};

	globalThis.processData = function (data) {
		return data != null ? data : {};
	};
	globalThis.renderPage = function () {
		createTree();
		__FlushElementTree(page);
		if (LOAD === 'sustained-scroll') {
			__InvokeUIMethod(loadScroll, 'autoScroll', { rate: 120, start: true }, function () {});
			__FlushElementTree();
		}
	};
	globalThis.updatePage = function () {};
	globalThis.updateGlobalProps = function () {};
})();
