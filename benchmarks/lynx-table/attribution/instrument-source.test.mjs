import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { instrumentLynxAttributionSources } from './instrument-source.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const sourceFiles = [
	'packages/octane/src/universal-core.ts',
	'packages/lynx/src/core/profiling.ts',
	'packages/lynx/src/main-thread.ts',
	'packages/lynx/src/core/plan-wire.ts',
].filter((relative) => fs.existsSync(path.join(repositoryRoot, relative)));

test('instruments an isolated source copy and restores every byte', () => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-attribution-source-'));
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
		const restore = instrumentLynxAttributionSources(temporary);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/octane/src/universal-core.ts'), 'utf8'),
			/__OCTANE_LYNX_ATTRIBUTION__/,
		);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/core/profiling.ts'), 'utf8'),
			/messageBytes/,
		);
		if (before.has('packages/lynx/src/core/plan-wire.ts')) {
			assert.match(
				fs.readFileSync(path.join(temporary, 'packages/lynx/src/core/plan-wire.ts'), 'utf8'),
				/planFoldingMs/,
			);
		}
		restore();
		for (const relative of sourceFiles) {
			assert.equal(fs.readFileSync(path.join(temporary, relative), 'utf8'), before.get(relative));
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
});
