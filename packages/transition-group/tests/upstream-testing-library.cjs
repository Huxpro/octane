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
		const rerenderMode = transitionRerenderMode(expect.getState().currentTestName);
		let result;
		if (rerenderMode === 'flush-both') {
			// The byte-exact upstream suite predates concurrent roots and assumes
			// render() returns after componentDidMount has armed the 5 ms appear
			// deadline. Preserve that observation boundary: otherwise the test can
			// arm its later 15 ms guard before React's concurrent mount has even
			// installed the timer whose ordering it intends to compare.
			ReactDOM.flushSync(() => {
				result = testingLibrary.render(element, options);
			});
		} else result = testingLibrary.render(element, options);
		if (rerenderMode === null) return result;
		// These byte-exact upstream tests compare transition and guard timers but
		// attach their callback with a rerender. Publish that callback before the
		// event loop can cross either deadline on a loaded runner. The no-timeout
		// case additionally drains its captured 0 ms completion before its 10 ms
		// guard; the appear case synchronously publishes both the mount that arms
		// 5 ms and the rerender that attaches its observer before the 15 ms guard.
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
