import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
	issue291M0ProbeReceipt,
	patchIssue291M0App,
	patchIssue291M0Index,
} from './issue291-m0-native-probe.mjs';

const commits = [
	'e82160fc0e663f52848e2181d83c6203d633bc86',
	'184631809c8eb61f5bbf15fa23b2470c1d38eea6',
];

function show(commit, file) {
	return execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' });
}

test('M0 Native memory probe patches both frozen Octane producers without runtime instrumentation', () => {
	for (const [index, commit] of commits.entries()) {
		const originalApp = show(commit, 'benchmarks/lynx-table/app/src/App.lynx.tsrx');
		const originalIndex = show(commit, 'benchmarks/lynx-table/app/src/index.ts');
		const app = patchIssue291M0App(originalApp);
		const patchedIndex = patchIssue291M0Index(originalIndex);
		assert.equal(app.match(/protocol: 'lynx-native-bench-v2'/g)?.length, 1);
		assert.equal(app.match(/issue291NativeTap\('create', run\)/g)?.length, 1);
		assert.equal(app.match(/issue291NativeTap\('clear', clear\)/g)?.length, 1);
		assert.equal(app.match(/__LYNX_BENCH_SNAPSHOT__ = \(\) =>/g)?.length, 1);
		assert.match(app, /lynx\.setTimeout\(cb, 0\)/);
		assert.match(patchedIndex, /__ISSUE291_FLUSH__ = \(\) => root\.flushTransport\(\)/);
		assert.doesNotMatch(app, /BENCH_ISSUE194_NATIVE|__ISSUE194_MAIN_COMMIT__/);
		const originalReceipt = issue291M0ProbeReceipt(originalApp, originalIndex);
		assert.equal(originalReceipt.capabilities.nativeStartupReceipt, index === 1);
		assert.equal(originalReceipt.capabilities.semanticSnapshot, index === 1);
		const receipt = issue291M0ProbeReceipt(app, patchedIndex);
		assert.equal(receipt.sha256.length, 64);
		assert.equal(receipt.files.length, 2);
		assert.equal(receipt.capabilities.semanticSnapshot, true);
		assert.equal(receipt.capabilities.nativeSafeMacrotask, true);
	}
});
