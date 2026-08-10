import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { instrumentLynxStageSources } from './instrument-source.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const sourceFiles = [
	'packages/lynx/src/core/profiling.ts',
	'packages/lynx/src/core/papi.ts',
	'packages/lynx/src/core/transport.ts',
	'packages/lynx/src/main-renderer.ts',
	'packages/lynx/src/main-thread.ts',
];

test('instruments an isolated Lynx source copy and restores every byte', () => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-stage-source-'));
	try {
		for (const relative of sourceFiles) {
			const target = path.join(temporary, relative);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(path.join(repositoryRoot, relative), target);
		}
		const before = new Map(
			sourceFiles.map((relative) => [
				relative,
				fs.readFileSync(path.join(temporary, relative), 'utf8'),
			]),
		);
		const restore = instrumentLynxStageSources(temporary);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/core/transport.ts'), 'utf8'),
			/bgReplayMs/,
		);
		const mainThread = fs.readFileSync(
			path.join(temporary, 'packages/lynx/src/main-thread.ts'),
			'utf8',
		);
		assert.match(mainThread, /__OCTANE_LYNX_MT_SLICE_LOAD_START_EPOCH__/);
		if (before.get('packages/lynx/src/main-thread.ts').includes('expandLynxWireBatch')) {
			assert.match(mainThread, /mtExpandMs/);
		} else {
			assert.doesNotMatch(mainThread, /startedExpand/);
		}
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/main-renderer.ts'), 'utf8'),
			/firstScreenPlanMs/,
		);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/core/papi.ts'), 'utf8'),
			/papiCreateMs/,
		);
		restore();
		for (const relative of sourceFiles) {
			assert.equal(fs.readFileSync(path.join(temporary, relative), 'utf8'), before.get(relative));
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
});
