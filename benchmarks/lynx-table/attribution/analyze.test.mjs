import assert from 'node:assert/strict';
import test from 'node:test';

import { linearSlope, median } from './analyze.mjs';

test('median preserves the observed middle of odd and even samples', () => {
	assert.equal(median([9, 1, 5]), 5);
	assert.equal(median([9, 1, 5, 3]), 4);
});

test('linearSlope reports bytes per row rather than endpoint bytes', () => {
	assert.equal(
		linearSlope([
			{ x: 1000, y: 2000 },
			{ x: 10000, y: 20000 },
			{ x: 30000, y: 60000 },
		]),
		2,
	);
});
