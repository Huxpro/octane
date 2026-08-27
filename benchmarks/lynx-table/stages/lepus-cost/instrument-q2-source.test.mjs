import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { instrumentLepusQ2Sources } from './instrument-q2-source.mjs';

test('adds the Q2 self-time boundary and restores all framework files', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-q2-instrument-'));
	// The shared stage instrument has many exact anchors; exercising it against a
	// copied repository is the useful integration test and keeps production files
	// byte-identical even if this assertion fails.
	const sourceRoot = path.resolve(import.meta.dirname, '../../../..');
	for (const relative of [
		'packages/lynx/src',
		'packages/octane/src',
		'packages/rspeedy-plugin-octane/src',
	]) {
		fs.mkdirSync(path.join(root, relative), { recursive: true });
		fs.cpSync(path.join(sourceRoot, relative), path.join(root, relative), { recursive: true });
	}
	const hostFile = path.join(root, 'packages/lynx/src/core/host-driver.ts');
	const papiFile = path.join(root, 'packages/lynx/src/core/papi.ts');
	const originalHost = fs.readFileSync(hostFile, 'utf8');
	const originalPapi = fs.readFileSync(papiFile, 'utf8');
	const previousRows = process.env.BENCH_AUTOROWS;
	process.env.BENCH_AUTOROWS = '1000';
	const restore = instrumentLepusQ2Sources(root);
	try {
		assert.match(fs.readFileSync(hostFile, 'utf8'), /q2ProgramCreateSelfMs/);
		assert.match(fs.readFileSync(hostFile, 'utf8'), /q2NumericCrossing/);
	} finally {
		restore();
		if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
		else process.env.BENCH_AUTOROWS = previousRows;
	}
	assert.equal(fs.readFileSync(hostFile, 'utf8'), originalHost);
	assert.equal(fs.readFileSync(papiFile, 'utf8'), originalPapi);
});
