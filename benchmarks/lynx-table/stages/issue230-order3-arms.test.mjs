// A build recipe fails quietly in a way arithmetic does not: it still prints a
// patch, and the patch still looks plausible, long after the code it describes
// has moved. These are the checks that make the four recorded digests
// reproducible rather than merely asserted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
	ARM_RECIPES,
	HUNKS,
	ORDER3_ARMS_COMMIT,
	applyArm,
	applyHunk,
	armFiles,
	armPatch,
	auditArm,
	unifiedDiff,
} from './issue230-order3-arms.mjs';
import { ARMS } from './issue230-order3-split.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RECORD = path.join(here, 'results/issue230-order3-split-10000.json');

/**
 * The recorded commit's bytes, or null when this checkout cannot reach it — a
 * shallow clone should skip the check, never fail it and never quietly pass.
 */
function recordedCommitReader() {
	const root = path.resolve(here, '../../..');
	const probe = spawnSync('git', ['-C', root, 'cat-file', '-e', `${ORDER3_ARMS_COMMIT}^{commit}`]);
	if (probe.status !== 0) return null;
	return (file) => {
		const out = spawnSync('git', ['-C', root, 'show', `${ORDER3_ARMS_COMMIT}:${file}`], {
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		});
		assert.equal(out.status, 0, `cannot read ${file} at ${ORDER3_ARMS_COMMIT}`);
		return out.stdout;
	};
}

describe('issue #230 Order 3 arm recipes', () => {
	it('describes every arm the record carries a digest for', () => {
		const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
		assert.deepEqual(Object.keys(ARM_RECIPES), Object.keys(record.bundles));
		assert.deepEqual(Object.keys(ARM_RECIPES), ARMS);
	});

	it('is where the record says each patched bundle came from', () => {
		const record = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
		for (const [id, bundle] of Object.entries(record.bundles)) {
			if (ARM_RECIPES[id].hunks.length === 0) {
				// The control is the tree as committed. A recipe here would
				// contradict the record's byte-identity claim.
				assert.equal(bundle.patchFile, null);
				continue;
			}
			assert.equal(
				bundle.patchFile,
				`benchmarks/lynx-table/stages/issue230-order3-arms.mjs::${id}`,
			);
		}
	});

	it('still describes the tree the bundles were built from', (t) => {
		const read = recordedCommitReader();
		if (read === null) {
			t.skip(`${ORDER3_ARMS_COMMIT} is not in this checkout`);
			return;
		}
		for (const id of Object.keys(ARM_RECIPES)) {
			for (const row of auditArm(id, read)) {
				assert.equal(row.from, 1, `${id}/${row.hunk} matches ${row.from} sites in ${row.file}`);
				assert.equal(row.to, 0, `${id}/${row.hunk} is already applied in ${row.file}`);
			}
		}
	});

	it('produces a tree that carries the edit and no longer carries the original', (t) => {
		const read = recordedCommitReader();
		if (read === null) {
			t.skip(`${ORDER3_ARMS_COMMIT} is not in this checkout`);
			return;
		}
		const patched = applyArm('o3tear', read);
		for (const name of ARM_RECIPES.o3tear.hunks) {
			const hunk = HUNKS[name];
			const text = patched.get(hunk.file);
			assert.ok(text.includes(hunk.to), `${name} did not land in ${hunk.file}`);
			assert.ok(!text.includes(hunk.from), `${name} left the original in ${hunk.file}`);
		}
	});

	it('refuses a hunk that matches anything but exactly one site', () => {
		const hunk = { file: 'x.ts', from: 'alpha', to: 'beta' };
		assert.throws(() => applyHunk('nothing here', hunk), /matched 0 times/);
		assert.throws(() => applyHunk('alpha and alpha', hunk), /matched 2 times/);
		assert.equal(applyHunk('one alpha only', hunk), 'one beta only');
	});

	it('names an unknown arm rather than silently patching nothing', () => {
		assert.throws(() => applyArm('o3nope', () => ''), /no arm named o3nope/);
		assert.throws(() => armFiles('o3nope'), /no arm named o3nope/);
	});

	it('leaves the control arm alone', () => {
		assert.deepEqual(ARM_RECIPES.o3ctl.hunks, []);
		assert.deepEqual(armFiles('o3ctl'), []);
		assert.equal(
			armPatch('o3ctl', () => 'unused'),
			'',
		);
	});

	it('crosses one enabler with the two consequences it admits', () => {
		// The split only reads as a split if each arm differs from the whole
		// chain by exactly the one candidate it suppresses.
		assert.deepEqual(ARM_RECIPES.o3cmp.hunks, ['ENABLER', 'GUARD']);
		assert.deepEqual(ARM_RECIPES.o3tear.hunks, ['ENABLER', 'GUARD', 'OFF_INCREMENTAL']);
		assert.deepEqual(ARM_RECIPES.o3gen.hunks, ['ENABLER', 'GUARD', 'OFF_TEARDOWN']);
		assert.notEqual(HUNKS.OFF_INCREMENTAL.from, HUNKS.OFF_TEARDOWN.from);
	});

	it('emits a unified diff git can read', () => {
		const before = 'a\nb\nc\nd\ne\nf\ng\n';
		const after = 'a\nb\nc\nD\ne\nf\ng\n';
		const patch = unifiedDiff('some/file.ts', before, after, { context: 2 });
		const lines = patch.split('\n');
		assert.equal(lines[0], 'diff --git a/some/file.ts b/some/file.ts');
		assert.equal(lines[1], '--- a/some/file.ts');
		assert.equal(lines[2], '+++ b/some/file.ts');
		assert.equal(lines[3], '@@ -2,5 +2,5 @@');
		assert.deepEqual(lines.slice(4, 9), [' b', ' c', '-d', '+D', ' e']);
		// Counts in the header must equal the lines that follow, or git refuses.
		const [, oldCount, newCount] = lines[3].match(/@@ -\d+,(\d+) \+\d+,(\d+) @@/);
		const body = lines.slice(4).filter((l) => l !== '');
		assert.equal(
			body.filter((l) => l.startsWith(' ') || l.startsWith('-')).length,
			Number(oldCount),
		);
		assert.equal(
			body.filter((l) => l.startsWith(' ') || l.startsWith('+')).length,
			Number(newCount),
		);
	});

	it('does not invent a context line past the end of the file', () => {
		// The change is inside `context` of the end, which is where a trailing
		// newline turns into a phantom final line if it is not split off first.
		const patch = unifiedDiff('f.ts', 'a\nb\n', 'a\nB\n', { context: 3 });
		const body = patch.split('\n').slice(4);
		assert.deepEqual(body, [' a', '-b', '+B', '']);
		assert.equal(patch.split('\n')[3], '@@ -1,2 +1,2 @@');
	});

	it('refuses a text with no trailing newline rather than emitting a patch git misreads', () => {
		assert.throws(() => unifiedDiff('f.ts', 'a\nb', 'a\nB\n'), /does not end with a newline/);
	});

	it('emits nothing for a text it does not change', () => {
		assert.equal(unifiedDiff('f.ts', 'same\n', 'same\n'), '');
	});

	it('emits one file section per file the arm touches', (t) => {
		const read = recordedCommitReader();
		if (read === null) {
			t.skip(`${ORDER3_ARMS_COMMIT} is not in this checkout`);
			return;
		}
		for (const id of ['o3cmp', 'o3tear', 'o3gen']) {
			const patch = armPatch(id, read);
			const sections = patch.split('\n').filter((l) => l.startsWith('diff --git '));
			assert.equal(sections.length, armFiles(id).length, `${id} section count`);
			for (const file of armFiles(id)) {
				assert.ok(patch.includes(`diff --git a/${file} b/${file}`), `${id} misses ${file}`);
			}
		}
	});
});
