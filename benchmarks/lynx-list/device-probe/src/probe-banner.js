const issue195Target = globalThis;
const issue195NativeNow =
	issue195Target.lynx && issue195Target.lynx.performance && issue195Target.lynx.performance.now;
const issue195Now =
	typeof issue195NativeNow === 'function'
		? () => issue195NativeNow.call(issue195Target.lynx.performance)
		: () => Date.now();
const issue195Probe = {
	papi: {},
	window: null,
	nextOrdinal: 1,
	readyLogged: false,
};
const issue195Context = issue195Target.lynx.getJSContext();
const issue195Report = (message) =>
	issue195Context.dispatchEvent({ type: 'octane-issue-195-probe', data: message });

function issue195CloneCalls() {
	const result = {};
	for (const [name, value] of Object.entries(issue195Probe.papi)) {
		result[name] = { count: value.count, ms: value.ms };
	}
	return result;
}

function issue195ResetCalls() {
	for (const value of Object.values(issue195Probe.papi)) {
		value.count = 0;
		value.ms = 0;
	}
}

function issue195CallbackTotals() {
	return { count: 0, ms: 0, papiCalls: 0, elementMs: 0, layoutMs: 0, frameworkMs: 0, items: 0 };
}

function issue195EnsureWindow(startedAtMs) {
	if (issue195Probe.window === null) {
		issue195Probe.window = {
			ordinal: issue195Probe.nextOrdinal++,
			startedAtMs,
			endedAtMs: startedAtMs,
			callsBefore: issue195CloneCalls(),
			callsAfter: {},
			callbacks: {
				componentAtIndex: issue195CallbackTotals(),
				componentAtIndexes: issue195CallbackTotals(),
				enqueueComponent: issue195CallbackTotals(),
			},
		};
	}
	return issue195Probe.window;
}

function issue195CloseIdleWindow(startedAtMs) {
	const window = issue195Probe.window;
	if (window === null || startedAtMs - window.endedAtMs < 350) return;
	window.callsAfter = issue195CloneCalls();
	issue195Probe.window = null;
	issue195Report('__OCTANE_ISSUE_195_LIST_WINDOW__' + JSON.stringify(window));
	issue195ResetCalls();
}

function issue195CallDelta(before) {
	let calls = 0;
	let elementMs = 0;
	let layoutMs = 0;
	for (const [name, after] of Object.entries(issue195Probe.papi)) {
		const previous = before[name] || { count: 0, ms: 0 };
		calls += after.count - previous.count;
		const elapsed = after.ms - previous.ms;
		if (name === '__FlushElementTree') layoutMs += elapsed;
		else elementMs += elapsed;
	}
	return { calls, elementMs, layoutMs };
}

function issue195TimedCallback(name, callback, args) {
	const startedAtMs = issue195Now();
	if (!issue195Probe.readyLogged) {
		issue195Probe.readyLogged = true;
		issue195Report(
			'__OCTANE_ISSUE_195_LIST_READY__' +
				JSON.stringify({
					protocol: 'octane-issue-195-list-probe-v1',
					rows: 10000,
					rowHeightPx: 92,
					timerSource:
						typeof issue195NativeNow === 'function' ? 'lynx.performance.now' : 'Date.now',
					systemInfo:
						issue195Target.SystemInfo ||
						(issue195Target.lynx && issue195Target.lynx.SystemInfo) ||
						null,
				}),
		);
	}
	issue195CloseIdleWindow(startedAtMs);
	const window = issue195EnsureWindow(startedAtMs);
	const callsBefore = issue195CloneCalls();
	let result;
	try {
		result = callback(...args);
	} finally {
		const endedAtMs = issue195Now();
		const papi = issue195CallDelta(callsBefore);
		const total = window.callbacks[name];
		const indexes = args[2];
		const items = name === 'componentAtIndexes' && Array.isArray(indexes) ? indexes.length : 1;
		total.count += 1;
		total.items += items;
		total.ms += endedAtMs - startedAtMs;
		total.papiCalls += papi.calls;
		total.elementMs += papi.elementMs;
		total.layoutMs += papi.layoutMs;
		total.frameworkMs += Math.max(0, endedAtMs - startedAtMs - papi.elementMs - papi.layoutMs);
		window.endedAtMs = endedAtMs;
	}
	return result;
}

function issue195WrapCallback(name, callback) {
	if (typeof callback !== 'function') return callback;
	return (...args) => issue195TimedCallback(name, callback, args);
}

function issue195WrapPapi(name, value) {
	if (typeof value !== 'function') return value;
	return function (...args) {
		const startedAtMs = issue195Now();
		try {
			return value.apply(this, args);
		} finally {
			const entry = issue195Probe.papi[name] || (issue195Probe.papi[name] = { count: 0, ms: 0 });
			entry.count += 1;
			entry.ms += issue195Now() - startedAtMs;
		}
	};
}

function issue195WrapListFunction(name, value) {
	if (typeof value !== 'function') return value;
	const timed = issue195WrapPapi(name, value);
	return function (...args) {
		const forwarded = args.slice();
		forwarded[1] = issue195WrapCallback('componentAtIndex', args[1]);
		forwarded[2] = issue195WrapCallback('enqueueComponent', args[2]);
		const batchIndex = name === '__CreateList' ? 4 : 3;
		forwarded[batchIndex] = issue195WrapCallback('componentAtIndexes', args[batchIndex]);
		return timed.apply(this, forwarded);
	};
}

function issue195InstrumentPapi(papi) {
	const wrap = (name, owner, method) => issue195WrapPapi(name, method.bind(owner));
	const wrapped = {
		...papi,
		createPage: wrap('__CreatePage', papi, papi.createPage),
		createElement: wrap('__CreateElement', papi, papi.createElement),
		getUniqueId: wrap('__GetElementUniqueID', papi, papi.getUniqueId),
		getParent: wrap('__GetParent', papi, papi.getParent),
		isEqual: wrap('__ElementIsEqual', papi, papi.isEqual),
		isChild: wrap('__GetParent', papi, papi.isChild),
		insertBefore: wrap('__InsertElementBefore', papi, papi.insertBefore),
		remove: wrap('__RemoveElement', papi, papi.remove),
		replace: wrap('__ReplaceElement', papi, papi.replace),
		setClasses: wrap('__SetClasses', papi, papi.setClasses),
		setInlineStyles: wrap('__SetInlineStyles', papi, papi.setInlineStyles),
		setCssId: wrap('__SetCSSId', papi, papi.setCssId),
		setAttribute: wrap('__SetAttribute', papi, papi.setAttribute),
		setRefSelector: wrap('__SetAttribute', papi, papi.setRefSelector),
		setDataset: wrap('__SetDataset', papi, papi.setDataset),
		setEvent: wrap('__AddEvent', papi, papi.setEvent),
		setId: wrap('__SetID', papi, papi.setId),
		flush: wrap('__FlushElementTree', papi, papi.flush),
	};
	if (typeof papi.append === 'function') {
		wrapped.append = wrap('__AppendElement', papi, papi.append);
	}
	if (papi.intrinsics) {
		wrapped.intrinsics = {
			view: wrap('__CreateView', papi.intrinsics, papi.intrinsics.view),
			text: wrap('__CreateText', papi.intrinsics, papi.intrinsics.text),
			rawText: wrap('__CreateRawText', papi.intrinsics, papi.intrinsics.rawText),
		};
	}
	return Object.freeze(wrapped);
}
