// Issue-#103 B0 and issue-#163 C1d: what a bundle carries, in bytes, under each
// of the two independent switches that decide it.
//
// The first is the background core. Its claim is that a bundle carries exactly
// one, and that is a claim about tree-shaking — worth nothing asserted, because
// a branch on a constant the bundler declines to fold ships both cores and still
// passes every test. So this builds the same application through the real
// Rspeedy/Rspack production pipeline once per core, decodes both native bundles,
// and reports the background program's size next to a presence probe for each
// core's own identifying strings.
//
// The second is #163's main-thread program backend, and it moves the other half
// of the bundle. Handed one, the compiler lowers each eligible template into a
// straight-line create function that drives the Element PAPI directly, instead
// of the description an interpreter walks per node at run time. So there is a
// third arm: the same block-core build, with a backend.
//
// The two switches are orthogonal, and the file's assertions say so rather than
// assuming it. Across the *core* switch the main-thread program does not move at
// all — that is what makes the core a background-only concern. Across the
// *backend* the main-thread program must move, or the arm is measuring nothing,
// while the background program must not — that is #163's byte-identity promise.
//
// What it is not: a performance measurement. Bytes are the whole subject here.
process.env.NODE_ENV = 'production';

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants as zc, gzipSync } from 'node:zlib';

import { pluginOctane } from '../../packages/rspeedy-plugin-octane/src/index.js';
import { LYNX_TARGET_SDK_VERSION } from '../../packages/rspeedy-plugin-octane/src/application.js';
import { registerTypeScriptSourceResolution } from './ts-source-resolution.mjs';

// Before the backend is imported, and it has to be a dynamic import for that
// ordering to exist: a static one is resolved before any of this file's body
// runs. The backend is TypeScript, and `ts-source-resolution.mjs` explains what
// that costs a plain-`node` harness and what it does not.
registerTypeScriptSourceResolution();
const mainThreadProgramBackend = await import('../../packages/lynx/src/compiler/index.js');

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

/**
 * A string only a compiled main-thread program puts in the bundle.
 *
 * The main-thread script is LepusNG, not JavaScript text, so the emitted create
 * function's own identifiers are gone by the time this can read it — what
 * survives is the constant pool. This is the `TypeError` message
 * `emitMainThreadProgram` writes into every program's preamble, where it guards
 * the host's intrinsic element factories, so the minifier has to keep it and it
 * lands once per emitted program.
 *
 * It replaces `ranges`, which was the wire program's key for keyed holes and
 * stopped discriminating: the Lynx main renderer ships its own runtime into
 * every main-thread chunk, and once that runtime could mount a program it
 * carried the key too. Measured on this fixture, `ranges` is in all three arms'
 * main-thread chunk three times over, so the probe read `yes` for arms that had
 * compiled nothing. That is the failure mode a probe on a *consumer* of programs
 * always has, and the reason this one is taken from the emitter instead: the
 * renderer has no reason to contain a message only emitted code throws.
 *
 * The old probe also depended on the fixture having a keyed hole. This one
 * depends only on the fixture having something to lower, which is already what
 * the third arm means. It is still a string in a file this repository owns, so
 * it fails by name if the preamble is reworded — the same staleness contract the
 * core probes have.
 */
const PROGRAM_PROBE = 'Octane main-thread programs need a host with intrinsic element factories.';

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

function countOf(haystack, needle) {
	let count = 0;
	for (
		let at = haystack.indexOf(needle);
		at !== -1;
		at = haystack.indexOf(needle, at + needle.length)
	) {
		count += 1;
	}
	return count;
}

function decodedScript(decoded, key) {
	const bytes = nativeScriptBytes(decoded[key]);
	return { bytes, text: bytes.toString('latin1') };
}

/**
 * One arm: a core, and whether the main-thread chunk is compiled to create
 * functions. `label` names the arm rather than the core, because two arms now
 * share a core and the reported rows have to be told apart.
 */
async function buildWithCore(label, core, outputRoot, backend) {
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
			plugins: [
				pluginOctane({
					core,
					// Pinned so the arms differ only in what they are measuring. A
					// worker receives its loader options by structured clone, and the
					// backend is a pair of functions, so the third arm compiles on the
					// main thread no matter what — while the first two would reach for
					// the worker pool. That is not a difference in emitted code, but the
					// pool reaches the minifier with a different module order, and the
					// short names it hands out rotate. Under the byte-identity check
					// below that reads as the backend having moved the background
					// program when nothing in it moved at all.
					parallel: false,
					hmr: false,
					dev: false,
					...(backend === undefined ? null : { mainThreadProgramBackend: backend }),
				}),
			],
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
		throw new Error(`${label}: unexpected engine version ${decoded['engine-version']}`);
	}
	const background = decodedScript(decoded, 'background-thread-script');
	const main = decodedScript(decoded, 'main-thread-script');
	if (background.bytes.length === 0) throw new Error(`${label}: background program is empty`);
	if (main.bytes.length === 0) throw new Error(`${label}: main program is empty`);
	assertMainDigestPinned(label, main.text);
	return {
		label,
		core,
		backgroundRaw: background.bytes.length,
		backgroundGzip: gzipBytes(background.bytes),
		mainRaw: main.bytes.length,
		mainGzip: gzipBytes(main.bytes),
		mainSha: createHash('sha256').update(main.text).digest('hex'),
		// The background program is compared across the backend, not only sized,
		// so it needs an identity of its own. Unpinned, deliberately: the digest
		// plugin stamps each chunk from that chunk's own source, so if the
		// background text really does not move neither does its digest — and a
		// pin here would hide the case where that stops being true.
		backgroundSha: createHash('sha256').update(background.text).digest('hex'),
		// Counted rather than tested for presence. A count says how many programs
		// the arm compiled, and it is what makes a probe that stops being specific
		// show up as a number on the arms that should read zero instead of as a
		// silent `yes` everywhere.
		program: countOf(main.text, PROGRAM_PROBE),
		// #163 splits the bundle: the program half belongs to the main-thread
		// chunk. A program in the background chunk is that split leaking, and
		// nothing else here would notice it.
		backgroundProgram: countOf(background.text, PROGRAM_PROBE),
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
	const universal = await buildWithCore('universal', 'universal', path.join(outputs, 'universal'));
	const block = await buildWithCore('block', 'block', path.join(outputs, 'block'));
	// The same core as `block`, so any difference between the two is the
	// backend's and nothing else's.
	const blockProgram = await buildWithCore(
		'block+program',
		'block',
		path.join(outputs, 'block-program'),
		mainThreadProgramBackend,
	);

	const rows = [universal, block, blockProgram];
	const delta = (value) => (value >= 0 ? '+' : '') + value.toLocaleString();

	console.log('\nbackground program, one core per bundle\n');
	console.log('| arm | raw | gzip | block core | universal root | plan constructors |');
	console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
	for (const row of rows) {
		console.log(
			`| ${row.label} | ${row.backgroundRaw.toLocaleString()} | ${row.backgroundGzip.toLocaleString()} | ` +
				`${row.probes.block.length}/${CORE_PROBES.block.length} | ` +
				`${row.probes.universalRoot.length}/${CORE_PROBES.universalRoot.length} | ` +
				`${row.probes.universalPlan.length}/${CORE_PROBES.universalPlan.length} |`,
		);
	}

	console.log('\nmain-thread program (moved by the backend, not by the core)\n');
	console.log('| arm | raw | gzip | sha256 | compiled programs |');
	console.log('| --- | ---: | ---: | --- | ---: |');
	for (const row of rows) {
		console.log(
			`| ${row.label} | ${row.mainRaw.toLocaleString()} | ${row.mainGzip.toLocaleString()} | ` +
				`${row.mainSha.slice(0, 12)} | ${row.program} |`,
		);
	}

	console.log(
		`\nbackground delta (block − universal): ${delta(block.backgroundGzip - universal.backgroundGzip)} B gzip, ` +
			`${delta(block.backgroundRaw - universal.backgroundRaw)} B raw`,
	);
	console.log(
		`main-thread delta (block+program − block): ${delta(blockProgram.mainGzip - block.mainGzip)} B gzip, ` +
			`${delta(blockProgram.mainRaw - block.mainRaw)} B raw`,
	);

	// The controls. Each one names a way the numbers above could be measuring
	// something other than what the row says they are.
	const failures = [];
	const missing = (row, name) =>
		CORE_PROBES[name].filter((marker) => !row.probes[name].includes(marker));

	// Either core surviving in the other's bundle means the branch did not fold.
	if (universal.probes.block.length !== 0) {
		failures.push(
			`core: 'universal' kept block-core strings: ${universal.probes.block.join(', ')}`,
		);
	}
	for (const row of [block, blockProgram]) {
		if (row.probes.universalRoot.length !== 0) {
			failures.push(
				`${row.label} kept universal-root strings: ${row.probes.universalRoot.join(', ')}`,
			);
		}
		if (row.probes.block.length !== CORE_PROBES.block.length) {
			failures.push(
				`${row.label} is missing its own probes (stale probe strings): ${missing(row, 'block').join(' | ')}`,
			);
		}
	}
	if (universal.probes.universalRoot.length !== CORE_PROBES.universalRoot.length) {
		failures.push(
			`core: 'universal' is missing its own probes (stale probe strings): ${missing(universal, 'universalRoot').join(' | ')}`,
		);
	}

	// The core switch is background-only: it must not reach the main thread.
	if (universal.mainSha !== block.mainSha) {
		failures.push('the main-thread program is not byte-identical across the core switch');
	}

	// The backend is the mirror image, and both halves of it are load-bearing.
	// It must move the main-thread program, because an arm that compiled nothing
	// would report a flattering zero delta and pass every check above it. And it
	// must not move the background program, which is #163's promise that the
	// half of the bundle it does not own does not move underneath it.
	if (blockProgram.mainSha === block.mainSha) {
		failures.push(
			'the main-thread program backend changed nothing; the third arm is measuring the second',
		);
	}
	if (blockProgram.program === 0) {
		failures.push(
			`block+program carries no compiled program: nothing in its main-thread chunk contains ` +
				`'${PROGRAM_PROBE}'. Either the backend compiled nothing, or the probe is stale — ` +
				`it is the preamble emitMainThreadProgram writes, so reword one and this fails.`,
		);
	}
	for (const row of [universal, block]) {
		if (row.program !== 0) {
			failures.push(
				`${row.label} carries ${row.program} compiled program(s) without a backend, so the probe ` +
					`is measuring something other than emitted code. Either the core switch is leaking the ` +
					`backend, or something that is not an emitted program now contains ` +
					`'${PROGRAM_PROBE}' and the probe needs replacing — the way 'ranges' did once the main ` +
					`renderer could mount a program.`,
			);
		}
	}
	for (const row of rows) {
		if (row.backgroundProgram !== 0) {
			failures.push(
				`${row.label} carries ${row.backgroundProgram} compiled program(s) in its background ` +
					`chunk; #163's split puts them in the main-thread chunk only`,
			);
		}
	}
	if (blockProgram.backgroundSha !== block.backgroundSha) {
		failures.push(
			'the main-thread program backend moved the background program, which it must not',
		);
	}

	if (failures.length !== 0) {
		console.error(`\nFAILED\n- ${failures.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		console.log(
			'\nOK — each bundle carries exactly one core, the core switch leaves the main-thread\n' +
				'program byte-identical, and the program backend moves that program and only that program.',
		);
	}
} finally {
	fs.rmSync(outputs, { recursive: true, force: true });
}
