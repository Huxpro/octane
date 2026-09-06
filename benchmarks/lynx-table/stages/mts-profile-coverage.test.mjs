import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMtsProfileCoverage } from './mts-profile-coverage.mjs';

const stat = (median) => ({ median });

test('accepts a named profile below the unmatched ceiling', () => {
	assert.doesNotThrow(() =>
		assertMtsProfileCoverage(
			{
				buckets: { 'applier walk': stat(20) },
				namedMs: stat(70),
				unmatchedMs: stat(30),
				totalMs: stat(100),
				unmatchedShare: stat(0.3),
			},
			0.4,
		),
	);
});

test('rejects a missing critical bucket and excessive unmatched self time', () => {
	assert.throws(
		() =>
			assertMtsProfileCoverage(
				{
					buckets: {},
					namedMs: stat(70),
					unmatchedMs: stat(30),
					totalMs: stat(100),
					unmatchedShare: stat(0.3),
				},
				0.4,
			),
		/applier walk/,
	);
	assert.throws(
		() =>
			assertMtsProfileCoverage(
				{
					buckets: { 'applier walk': stat(20) },
					namedMs: stat(55),
					unmatchedMs: stat(45),
					totalMs: stat(100),
					unmatchedShare: stat(0.45),
				},
				0.4,
			),
			/45\.0%.*40\.0%/,
	);
});
