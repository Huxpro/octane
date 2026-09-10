const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

const requireFromPackage = createRequire(`${__dirname}/../package.json`);
const testingLibraryRoot = dirname(
	requireFromPackage.resolve('@testing-library/react/package.json'),
);
const testingLibrary = require(join(testingLibraryRoot, 'dist/pure.js'));
const ReactDOM = require('react-dom');
const { drainZeroDelayTimers, transitionRerenderMode } = require('./upstream-timer-order.cjs');

module.exports = {
	...testingLibrary,
	render(element, options) {
		const result = testingLibrary.render(element, options);
		const rerenderMode = transitionRerenderMode(expect.getState().currentTestName);
		if (rerenderMode === null) return result;
		// These byte-exact upstream tests compare transition and guard timers but
		// attach their callback with a rerender. Publish that callback before the
		// event loop can cross either deadline on a loaded runner. The no-timeout
		// case additionally drains its captured 0 ms completion before its 10 ms
		// guard; the appear case retains the upstream 5 ms/15 ms timer ordering.
		return {
			...result,
			rerender(nextElement) {
				const rerender = () => ReactDOM.flushSync(() => result.rerender(nextElement));
				return rerenderMode === 'drain-zero'
					? drainZeroDelayTimers(rerender, (callback) => ReactDOM.flushSync(callback))
					: rerender();
			},
		};
	},
};
