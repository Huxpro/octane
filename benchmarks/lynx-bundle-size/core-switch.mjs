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

// `@lynx-js/debug-metadata-rsbuild-plugin` stamps a release digest for each
// chunk and prepends it to that chunk's source. It moves whenever the bundle
// moves, which is exactly what the switch does on purpose — so the two builds
// hand the minifier main-thread text that differs in forty characters.
//
// That is not survivable by normalizing the digest afterwards, which is what
// this harness used to do. The mangler orders its identifier alphabet by
// character frequency over the text it is given, and two of the rarest
// characters sit close enough to swap: a digest carrying seven `4`s against one
// carrying two is enough to reverse `4` and `6`, which renames three
// identifiers and leaves the two programs six bytes apart for no reason at all.
// By the time the digest is normalized in the decoded output the names are
// already chosen, so the difference survives the normalization it was supposed
// to be removed by.
//
// It is therefore pinned where the difference actually exists: in the source,
// after the plugin's banner stage and before minification. Any real change to
// the main-thread program still moves the hash.
//
// Only the main-thread asset is pinned, selected by the same `lynx:main-thread`
// flag the debug-metadata plugin reads to tell the two programs apart. Pinning
// every chunk reaches the background program too and moves it by a few bytes —
// 3 on `universal` and 4 on `block` where it was measured — and the background
// program is the measurement here rather than the assertion. Nothing compares
// two background programs across the switch, so normalizing one buys nothing
// and spends the number. Pinned this narrowly, both come back at exactly the
// bytes an unpinned build reports.
const PINNED_DIGEST = createHash('sha1').update('octane-core-switch').digest('hex');
const PINNED_RELEASE = `debugmetadata:${PINNED_DIGEST}`;
const BUILD_DIGEST = /debugmetadata:[0-9a-f]{40}/g;

class PinBuildDigestPlugin {
	apply(compiler) {
		const { RawSource } = compiler.webpack.sources;
		const { PROCESS_ASSETS_STAGE_ADDITIONS } = compiler.webpack.Compilation;
		compiler.hooks.thisCompilation.tap('PinBuildDigest', (compilation) => {
			// The banner lands at `ADDITIONS + 1` and the minifier at
			// `OPTIMIZE_SIZE`, so this is the one window where the digest is text.
			compilation.hooks.processAssets.tap(
				{ name: 'PinBuildDigest', stage: PROCESS_ASSETS_STAGE_ADDITIONS + 2 },
				() => {
					for (const name of Object.keys(compilation.assets)) {
						const asset = compilation.getAsset(name);
						// The same flag `@lynx-js/debug-metadata-rsbuild-plugin` reads to
						// tell the two thread programs apart.
						if (!name.endsWith('.js') || asset?.info?.['lynx:main-thread'] !== true) continue;
						const before = asset.source.source().toString();
						const after = before.replace(BUILD_DIGEST, PINNED_RELEASE);
						if (after !== before) compilation.updateAsset(name, new RawSource(after));
					}
				},
			);
		});
	}
}

// The control for the pin. A stage that stopped running, an asset flag that
// stopped being set, or a plugin that moved its banner past the minifier would
// otherwise come back as an unexplained byte difference in the identity check.
function assertMainDigestPinned(core, text) {
	const found = text.match(BUILD_DIGEST) ?? [];
	if (found.length === 0) {
		throw new Error(`${core}: the main-thread program carries no build digest to pin`);
	}
	const unpinned = found.filter((digest) => digest !== PINNED_RELEASE);
	if (unpinned.length !== 0) {
		throw new Error(
			`${core}: the main-thread program kept an unpinned build digest: ${unpinned[0]}`,
		);
	}
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
			tools: {
				rspack: {
					plugins: [new PinBuildDigestPlugin()],
					resolve: { modules: [RSPEEDY_MODULES, 'node_modules'] },
				},
			},
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
	assertMainDigestPinned(core, main.text);
	return {
		core,
		backgroundRaw: background.bytes.length,
		backgroundGzip: gzipBytes(background.bytes),
		mainRaw: main.bytes.length,
		mainGzip: gzipBytes(main.bytes),
		mainSha: createHash('sha256').update(main.text).digest('hex'),
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
			? '\nThe main-thread program is byte-identical across the switch (build digest pinned in source).'
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
