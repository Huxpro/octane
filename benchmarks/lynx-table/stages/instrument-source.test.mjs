import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';

import { instrumentLynxStageSources } from './instrument-source.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
// The background replay stage is split by timing Octane's update drain, so the
// harness now reaches outside `@octanejs/lynx` and this list has to say so — a
// framework source left instrumented would poison every later build.
const sourceFiles = [
	'packages/lynx/src/core/profiling.ts',
	'packages/lynx/src/core/papi.ts',
	'packages/lynx/src/core/transport.ts',
	'packages/lynx/src/main-renderer.ts',
	'packages/lynx/src/main-thread.ts',
	'packages/octane/src/universal-core.ts',
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
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/main-thread.ts'), 'utf8'),
			/mtExpandMs/,
		);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/main-renderer.ts'), 'utf8'),
			/firstScreenPlanMs/,
		);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/lynx/src/core/papi.ts'), 'utf8'),
			/papiCreateMs/,
		);
		assert.match(
			fs.readFileSync(path.join(temporary, 'packages/octane/src/universal-core.ts'), 'utf8'),
			/__BENCH_BG_PREPARES__/,
		);
		restore();
		for (const relative of sourceFiles) {
			assert.equal(fs.readFileSync(path.join(temporary, relative), 'utf8'), before.get(relative));
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
});

test('leaves profiling.ts the only creator of the profile record', () => {
	// The record is per realm and created by whichever probe touches it first —
	// `??=`, so the shape the winner chose is the shape everyone else inherits.
	// `profilePapiCreate` runs at PAPI creation, before anything else on the main
	// thread, so a copy of the initializer inlined beside it decides what every
	// later counter sees. When such a copy has drifted from `profiling.ts`, the
	// fields it omits are undefined and the first `+=` against one yields NaN,
	// which is a number and passes every downstream guard. The Octane-side probe
	// is exempt: it runs in the background realm and cannot import this package,
	// which is why it keeps its counters off the record entirely.
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-stage-owner-'));
	try {
		for (const relative of sourceFiles) {
			const target = path.join(temporary, relative);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(path.join(repositoryRoot, relative), target);
		}
		instrumentLynxStageSources(temporary);
		for (const relative of sourceFiles) {
			if (!relative.startsWith('packages/lynx/')) continue;
			const patched = fs.readFileSync(path.join(temporary, relative), 'utf8');
			const creations = patched.split('__OCTANE_LYNX_PROF ??=').length - 1;
			assert.equal(
				creations,
				relative === 'packages/lynx/src/core/profiling.ts' ? 1 : 0,
				`${relative} must reach the profile record through lynxWireProfile()`,
			);
		}
	} finally {
		fs.rmSync(temporary, { recursive: true, force: true });
	}
});

test('profiled first-screen rendering works without a stage-harness slice hook', async () => {
	const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-stage-profile-'));
	try {
		for (const relative of [...sourceFiles, 'packages/lynx/src/resource.ts']) {
			const target = path.join(temporary, relative);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(path.join(repositoryRoot, relative), target);
		}
		instrumentLynxStageSources(temporary);

		const entry = path.join(temporary, 'profile-first-screen.ts');
		const output = path.join(temporary, 'profile-first-screen.mjs');
		fs.writeFileSync(
			entry,
			[
				"import { defineUniversalComponent, renderLynxFirstScreen, universalPlan, universalValue } from './packages/lynx/src/main-renderer.ts';",
				"import { lynxWireProfile } from './packages/lynx/src/core/profiling.ts';",
				"const plan = universalPlan('lynx', { kind: 'host', type: 'view' });",
				"const App = defineUniversalComponent('lynx', () => universalValue(plan));",
				'export function run() {',
				'\tdelete globalThis.__OCTANE_LYNX_PROF;',
				'\tconst result = renderLynxFirstScreen(App, {});',
				'\tconst profile = globalThis.__OCTANE_LYNX_PROF;',
				// The shape the shared helper creates, taken from a clean global so the
				// render's own accumulation cannot be mistaken for it.
				'\tdelete globalThis.__OCTANE_LYNX_PROF;',
				'\tconst canonical = lynxWireProfile();',
				'\tdelete globalThis.__OCTANE_LYNX_PROF;',
				'\treturn { profile, canonical, result };',
				'}',
			].join('\n'),
		);
		await build({
			entryPoints: [entry],
			bundle: true,
			format: 'esm',
			logLevel: 'silent',
			outfile: output,
			platform: 'node',
		});

		const { run } = await import(`${pathToFileURL(output).href}?profile-first-screen`);
		const { profile, canonical, result } = run();
		assert.equal(result.hostCount, 1);
		assert.ok(Number.isFinite(profile.firstScreenPlanMs));
		// Every probe this module compiles in accumulates onto one record per
		// realm, created by whichever probe runs first. A probe that built its own
		// would leave out whatever `profiling.ts` has gained since the copy was
		// written, and the first `+=` against a missing field yields NaN — silently,
		// because NaN is a number and survives every `typeof` check downstream. So
		// what this pins is that the record the first screen leaves behind is the
		// shared one, whole: derived from the helper rather than from a list here,
		// which is the same drift by another route.
		for (const [name, value] of Object.entries(canonical)) {
			if (typeof value !== 'number') continue;
			assert.equal(profile[name], 0, `${name} must start at zero on the shared record`);
		}
		assert.equal(profile.firstScreenPhase, null);
	} finally {
		delete globalThis.__OCTANE_LYNX_PROF;
		fs.rmSync(temporary, { recursive: true, force: true });
	}
});
