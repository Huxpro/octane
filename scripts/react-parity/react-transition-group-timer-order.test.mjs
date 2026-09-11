import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
	drainZeroDelayTimers,
	transitionRerenderMode,
} = require('../../packages/transition-group/tests/upstream-timer-order.cjs');

test('selects only the upstream timer comparisons that need synchronous rerendering', () => {
	assert.equal(
		transitionRerenderMode(
			'Transition should mount/unmount immediately if not have enter/exit timeout',
		),
		'drain-zero',
	);
	assert.equal(
		transitionRerenderMode(
			'Transition appearing timeout should use appear timeout if appear is set',
		),
		'flush-both',
	);
	assert.equal(transitionRerenderMode('Transition entering should fire callbacks'), null);
});

test('drains a transition zero-delay completion before an earlier guard timer', () => {
	const events = [];
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const guard = setTimeout(() => events.push('guard'), 0);

	drainZeroDelayTimers(
		() => {
			setTimeout(() => events.push('completion'), 0);
		},
		(callback) => callback(),
	);

	clearTimeout(guard);
	assert.deepEqual(events, ['completion']);
	assert.equal(globalThis.setTimeout, originalSetTimeout);
	assert.equal(globalThis.clearTimeout, originalClearTimeout);
});
