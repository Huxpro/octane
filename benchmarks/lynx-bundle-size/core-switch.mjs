// Issue-#103 B0: what the compile-time core switch costs and removes, in bytes.
//
// The claim the switch makes is that a bundle carries exactly one background
// core. That is a claim about tree-shaking, and tree-shaking claims are worth
// nothing asserted — a branch on a constant the bundler declines to fold ships
// both cores and still passes every test. So this builds the same application
// twice through the real Rspeedy/Rspack production pipeline, changing only
// `pluginOctane({ core })`, decodes both native bundles, and reports the
// background program's size next to a presence probe for each core's own
// identifying strings.
//
// What it is not: a performance measurement, and not a statement about the
// main-thread program. The main thread renders from the compiled template
// either way and does not read the switch; it is reported so a regression that
// moved main-thread bytes would be visible rather than silent.
process.env.NODE_ENV = 'production';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants as zc, gzipSync } from 'node:zlib';

import { pluginOctane } from '../../packages/rspeedy-plugin-octane/src/index.js';
import { LYNX_TARGET_SDK_VERSION } from '../../packages/rspeedy-plugin-octane/src/application.js';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const RSPEEDY_MODULES = path.join(REPO, 'packages/rspeedy-plugin-octane/node_modules');
const RSPEEDY_CWD = path.join(REPO, 'packages/rspeedy-plugin-octane/tests/_fixtures/application');
const ENTRY_NAME = 'main';
const BUNDLE_NAME = 'main.lynx.bundle';

// Strings only one core's source can produce. Each is a diagnostic literal the
// minifier has to keep, taken from the core it names, so "absent" means the
// module's closure is gone rather than merely renamed.
//
// `universalPlan` is deliberately separate from `universalRoot`. A compiled
// `.tsrx` component calls `universalPlan`/`universalValue` to build its own plan
// whichever core consumes it, so that slice of `universal-core.ts` is reachable
// from the application module itself and survives under either flag. Counting it
// as a leak would fail a control for something that is not a core at all;
// reporting it separately is what keeps the removal claim about the core.
const CORE_PROBES = Object.freeze({
	block: ['Octane Lynx block core:', 'Octane Lynx block root', 'onto the Block core:'],
	universalRoot: [
		'Universal roots accept only compiler-defined universal components.',
		'Duplicate universal list key ',
	],
	universalPlan: ['universalValue expected a universal plan.'],
});

function packageEntry(packageName) {
	const packageRoot = path.join(RSPEEDY_MODULES, ...packageName.split('/'));
	const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
	const exported = manifest.exports?.['.'];
	const entry =
		typeof exported === 'string'
			? exported
			: typeof exported?.import === 'string'
				? exported.import
				: manifest.module || manifest.main;
	if (typeof entry !== 'string') throw new Error(`${packageName} has no importable package entry.`);
	return pathToFileURL(path.join(packageRoot, entry)).href;
}

const [{ createRspeedy }, tasm] = await Promise.all([
	import(packageEntry('@lynx-js/rspeedy')),
	import(packageEntry('@lynx-js/tasm')),
]);

const gzipBytes = (buffer) => gzipSync(buffer, { level: zc.Z_BEST_COMPRESSION }).length;

function nativeScriptBytes(script) {
	if (typeof script === 'string') return Buffer.from(script);
	if (ArrayBuffer.isView(script)) {
		return Buffer.from(script.buffer, script.byteOffset, script.byteLength);
	}
	if (Array.isArray(script)) {
		if (script.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
			return Buffer.from(script);
		}
		return Buffer.concat(script.map(nativeScriptBytes));
	}
	if (script !== null && typeof script === 'object') {
		return Buffer.concat(Object.values(script).map(nativeScriptBytes));
	}
	return Buffer.alloc(0);
}

// `@lynx-js/debug-metadata-rsbuild-plugin` stamps one digest over the whole
// bundle — both thread programs — and embeds it in each. It therefore moves
// whenever the background program moves, which is exactly what the switch does
// on purpose. Normalizing it is what lets the main-thread comparison mean "the
// main-thread program did not change"; any real change to that program still
// moves the hash.
const BUILD_DIGEST = /debugmetadata:[0-9a-f]{40}/g;

function normalizeBuildDigest(text) {
	return text.replace(BUILD_DIGEST, 'debugmetadata:<normalized>');
}

function decodedScript(decoded, key) {
	const bytes = nativeScriptBytes(decoded[key]);
	return { bytes, text: bytes.toString('latin1') };
}

async function buildWithCore(core, outputRoot) {
	const rspeedy = await createRspeedy({
		cwd: RSPEEDY_CWD,
		loadEnv: false,
		environment: ['lynx'],
		rspeedyConfig: {
			mode: 'production',
			environments: { lynx: {} },
			dev: { hmr: false, liveReload: false },
			output: {
				cleanDistPath: true,
				distPath: { root: outputRoot },
				filenameHash: false,
				inlineScripts: true,
				sourceMap: false,
			},
			source: { entry: { [ENTRY_NAME]: path.join(ROOT, 'src/entry.ts') } },
			splitChunks: false,
			tools: { rspack: { resolve: { modules: [RSPEEDY_MODULES, 'node_modules'] } } },
			plugins: [pluginOctane({ core, hmr: false, dev: false })],
		},
	});
	let build;
	try {
		build = await rspeedy.build();
	} finally {
		await build?.close();
	}
	const bundle = fs.readFileSync(path.join(outputRoot, BUNDLE_NAME));
	const decoded = tasm.supportNapi() ? tasm.decode_napi(bundle) : await tasm.decode_wasm(bundle);
	if (decoded['engine-version'] !== LYNX_TARGET_SDK_VERSION) {
		throw new Error(`${core}: unexpected engine version ${decoded['engine-version']}`);
	}
	const background = decodedScript(decoded, 'background-thread-script');
	const main = decodedScript(decoded, 'main-thread-script');
	if (background.bytes.length === 0) throw new Error(`${core}: background program is empty`);
	if (main.bytes.length === 0) throw new Error(`${core}: main program is empty`);
	return {
		core,
		backgroundRaw: background.bytes.length,
		backgroundGzip: gzipBytes(background.bytes),
		mainRaw: main.bytes.length,
		mainGzip: gzipBytes(main.bytes),
		mainSha: createHash('sha256').update(normalizeBuildDigest(main.text)).digest('hex'),
		probes: Object.fromEntries(
			Object.entries(CORE_PROBES).map(([name, markers]) => [
				name,
				markers.filter((marker) => background.text.includes(marker)),
			]),
		),
	};
}

const outputs = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-core-switch-'));
try {
	const universal = await buildWithCore('universal', path.join(outputs, 'universal'));
	const block = await buildWithCore('block', path.join(outputs, 'block'));

	const rows = [universal, block];
	console.log('\nbackground program, one core per bundle\n');
	console.log('| core | raw | gzip | block core | universal root | plan constructors |');
	console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
	for (const row of rows) {
		console.log(
			`| ${row.core} | ${row.backgroundRaw.toLocaleString()} | ${row.backgroundGzip.toLocaleString()} | ` +
				`${row.probes.block.length}/${CORE_PROBES.block.length} | ` +
				`${row.probes.universalRoot.length}/${CORE_PROBES.universalRoot.length} | ` +
				`${row.probes.universalPlan.length}/${CORE_PROBES.universalPlan.length} |`,
		);
	}
	console.log('\nmain-thread program (does not read the switch)\n');
	console.log('| core | raw | gzip | sha256 |');
	console.log('| --- | ---: | ---: | --- |');
	for (const row of rows) {
		console.log(
			`| ${row.core} | ${row.mainRaw.toLocaleString()} | ${row.mainGzip.toLocaleString()} | ${row.mainSha.slice(0, 12)} |`,
		);
	}
	console.log(
		universal.mainSha === block.mainSha
			? '\nThe main-thread program is byte-identical across the switch (bundle-wide debug digest normalized).'
			: '\nThe main-thread program DIFFERS across the switch; the switch is not background-only.',
	);

	// The control. Either core surviving in the other's bundle means the branch
	// did not fold, and every byte reported above is measuring something else.
	const failures = [];
	const missing = (row, name) =>
		CORE_PROBES[name].filter((marker) => !row.probes[name].includes(marker));
	if (universal.probes.block.length !== 0) {
		failures.push(
			`core: 'universal' kept block-core strings: ${universal.probes.block.join(', ')}`,
		);
	}
	if (block.probes.universalRoot.length !== 0) {
		failures.push(
			`core: 'block' kept universal-root strings: ${block.probes.universalRoot.join(', ')}`,
		);
	}
	if (universal.probes.universalRoot.length !== CORE_PROBES.universalRoot.length) {
		failures.push(
			`core: 'universal' is missing its own probes (stale probe strings): ${missing(universal, 'universalRoot').join(' | ')}`,
		);
	}
	if (block.probes.block.length !== CORE_PROBES.block.length) {
		failures.push(
			`core: 'block' is missing its own probes (stale probe strings): ${missing(block, 'block').join(' | ')}`,
		);
	}
	if (universal.mainSha !== block.mainSha) {
		failures.push('the main-thread program is not byte-identical across the switch');
	}
	console.log(
		`\nbackground delta (block − universal): ${(block.backgroundGzip - universal.backgroundGzip).toLocaleString()} B gzip, ` +
			`${(block.backgroundRaw - universal.backgroundRaw).toLocaleString()} B raw`,
	);
	if (failures.length !== 0) {
		console.error(`\nFAILED\n- ${failures.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		console.log('\nOK — each bundle carries exactly one core.');
	}
} finally {
	fs.rmSync(outputs, { recursive: true, force: true });
}
