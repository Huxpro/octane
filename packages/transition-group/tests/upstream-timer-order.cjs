function drainZeroDelayTimers(run, flush) {
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const queued = new Map();

	globalThis.setTimeout = (callback, delay, ...args) => {
		if (delay !== 0) return originalSetTimeout(callback, delay, ...args);

		const token = {};
		queued.set(token, () => callback(...args));
		return token;
	};
	globalThis.clearTimeout = (token) => {
		if (queued.delete(token)) return;
		return originalClearTimeout(token);
	};

	try {
		const result = run();
		for (const [token, callback] of queued) {
			queued.delete(token);
			flush(callback);
		}
		return result;
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
}

function transitionRerenderMode(testName) {
	if (testName === 'Transition should mount/unmount immediately if not have enter/exit timeout') {
		return 'drain-zero';
	}
	if (testName === 'Transition appearing timeout should use appear timeout if appear is set') {
		return 'flush-sync';
	}
	return null;
}

module.exports = { drainZeroDelayTimers, transitionRerenderMode };
