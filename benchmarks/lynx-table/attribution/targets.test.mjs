import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGitTargets, selectTargetIds } from './targets.mjs';

test('parses explicit labels and arbitrary git revisions without fixed stack heads', () => {
	assert.deepEqual(parseGitTargets('parent=HEAD^,candidate=refs/pull/123/head'), [
		{ id: 'parent', revision: 'HEAD^' },
		{ id: 'candidate', revision: 'refs/pull/123/head' },
	]);
	assert.deepEqual(parseGitTargets(), [{ id: 'workspace', revision: 'HEAD' }]);
});

test('rejects malformed or duplicate target labels', () => {
	assert.throws(() => parseGitTargets('HEAD'), /expected id=revision/);
	assert.throws(() => parseGitTargets('candidate=HEAD,candidate=HEAD^'), /duplicate target id/);
	assert.throws(() => parseGitTargets('../candidate=HEAD'), /invalid target id/);
});

test('selects manifest targets in requested order', () => {
	const targets = [{ id: 'parent' }, { id: 'candidate' }, { id: 'react' }];
	assert.deepEqual(selectTargetIds(targets, 'candidate,parent'), [targets[1], targets[0]]);
	assert.throws(() => selectTargetIds(targets, 'missing'), /unknown attribution target/);
	assert.throws(() => selectTargetIds(targets, 'parent,parent'), /contains duplicates/);
});
