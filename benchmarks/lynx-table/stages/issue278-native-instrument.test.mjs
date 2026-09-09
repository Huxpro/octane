import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { instrumentIssue278NativeSources } from './issue278-native-instrument.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const files = [
	'packages/lynx/src/core/transport-codec.ts',
	'packages/lynx/src/main-thread-implementation.ts',
	'packages/rspeedy-plugin-octane/src/main-thread-entry.production.js',
];

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-issue278-instrument-'));
	for (const relative of files) {
		const target = path.join(root, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(repositoryRoot, relative), target);
	}
	return root;
}

test('issue #278 instrumentation splits the real codec and restores every source byte', () => {
	const root = fixture();
	try {
		const originals = Object.fromEntries(
			files.map((relative) => [relative, fs.readFileSync(path.join(root, relative), 'utf8')]),
		);
		const restore = instrumentIssue278NativeSources(root);
		const codec = fs.readFileSync(path.join(root, files[0]), 'utf8');
		const mainThread = fs.readFileSync(path.join(root, files[1]), 'utf8');
		const entry = fs.readFileSync(path.join(root, files[2]), 'utf8');
		assert.match(codec, /encodePrepareMs/);
		assert.match(codec, /decodeRestoreMs/);
		assert.match(codec, /__BENCH_ISSUE278_COUNTS__/);
		assert.match(codec, /issue278RecordCommandOps/);
		assert.match(codec, /issue278BeginCommit/);
		assert.match(codec, /receivedAtMs: Date\.now\(\)/);
		assert.match(codec, /issue278MarkDecoded/);
		assert.match(mainThread, /issue278CaptureCommitSnapshot/);
		assert.match(mainThread, /issue278MarkCommitTimeline/);
		assert.match(mainThread, /completedAtMs/);
		assert.match(entry, /from '@octanejs\/lynx\/main-thread'/);
		assert.doesNotMatch(entry, /installLynxApplicationMainThread/);
		assert.match(entry, /validation: __BENCH_ISSUE278_VALIDATION__/);
		restore();
		for (const relative of files) {
			assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), originals[relative]);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('issue #278 control build changes validation only and leaves the codec unprofiled', () => {
	const root = fixture();
	try {
		const codecFile = path.join(root, files[0]);
		const original = fs.readFileSync(codecFile, 'utf8');
		const restore = instrumentIssue278NativeSources(root, { codec: false });
		assert.equal(fs.readFileSync(codecFile, 'utf8'), original);
		assert.match(
			fs.readFileSync(path.join(root, files[2]), 'utf8'),
			/validation: __BENCH_ISSUE278_VALIDATION__/,
		);
		restore();
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('issue #278 instrumentation fails closed and restores an already-touched source', () => {
	const root = fixture();
	try {
		const codecFile = path.join(root, files[0]);
		const broken = fs
			.readFileSync(codecFile, 'utf8')
			.replace('const ALIAS_REPORT_THRESHOLD = 32;', 'const ALIAS_REPORT_THRESHOLD = 64;');
		fs.writeFileSync(codecFile, broken);
		assert.throws(() => instrumentIssue278NativeSources(root), /anchor missing/);
		assert.equal(fs.readFileSync(codecFile, 'utf8'), broken);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
