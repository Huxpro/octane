import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { instrumentIssue194NativeSources } from './issue194-native-instrument.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const repositoryFiles = [
	'packages/lynx/src/core/papi.ts',
	'packages/lynx/src/core/compiled-program-store.ts',
	'packages/lynx/src/core/element-template-program-store.ts',
	'packages/lynx/src/main-thread-implementation.ts',
	'packages/lynx/src/core/compiled-program-product-receiver.ts',
	'packages/lynx/src/core/profiling.ts',
	'packages/lynx/src/main-renderer.ts',
	'packages/octane/src/profiling.ts',
	'packages/octane/src/universal-core.ts',
	'packages/lynx/src/core/transport.ts',
	'packages/lynx/src/core/protocol.ts',
	'packages/lynx/src/core/host-driver.ts',
];
const stageFiles = ['src/index.ts', 'src/App.lynx.tsrx', 'src/block-program.ts'];

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-issue194-instrument-'));
	const stage = path.join(root, 'stage');
	for (const relative of repositoryFiles) {
		const target = path.join(root, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(repositoryRoot, relative), target);
	}
	for (const relative of stageFiles) {
		const target = path.join(stage, relative);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(repositoryRoot, 'benchmarks/lynx-table/app', relative), target);
	}
	return { root, stage };
}

test('issue #194 instruments the selected compact owner and restores every source byte', () => {
	const { root, stage } = fixture();
	const allFiles = [
		...repositoryFiles.map((relative) => path.join(root, relative)),
		...stageFiles.map((relative) => path.join(stage, relative)),
	];
	try {
		const originals = new Map(allFiles.map((file) => [file, fs.readFileSync(file, 'utf8')]));
		const restore = instrumentIssue194NativeSources(root, stage);

		assert.match(
			fs.readFileSync(
				path.join(root, 'packages/lynx/src/core/compiled-program-product-receiver.ts'),
				'utf8',
			),
			/octane-issue194-compact-main-v1/,
		);
		assert.match(
			fs.readFileSync(
				path.join(root, 'packages/lynx/src/core/compiled-program-product-receiver.ts'),
				'utf8',
			),
			/census: issue194Census/,
		);
		for (const relative of [
			'packages/lynx/src/core/compiled-program-store.ts',
			'packages/lynx/src/core/element-template-program-store.ts',
		]) {
			const source = fs.readFileSync(path.join(root, relative), 'utf8');
			assert.match(source, /__issue194Census/);
			assert.match(source, /retainedHostRefs/);
		}
		assert.match(
			fs.readFileSync(path.join(root, 'packages/lynx/src/main-thread-implementation.ts'), 'utf8'),
			/__ISSUE194_MAIN_COMMIT__/,
		);
		assert.equal(
			fs.readFileSync(path.join(stage, 'src/App.lynx.tsrx'), 'utf8'),
			originals.get(path.join(stage, 'src/App.lynx.tsrx')),
			'the app-owned Native v2 receipt must not be wrapped a second time',
		);
		assert.equal(
			fs.readFileSync(path.join(root, 'packages/lynx/src/core/host-driver.ts'), 'utf8'),
			originals.get(path.join(root, 'packages/lynx/src/core/host-driver.ts')),
			'the current host driver is not the retired first-screen probe owner',
		);

		restore();
		for (const file of allFiles) {
			assert.equal(fs.readFileSync(file, 'utf8'), originals.get(file));
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
