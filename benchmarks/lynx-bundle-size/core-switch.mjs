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
// of the description an interpreter walks per node at run time. The production
// default also enables positional program addressing, which changes background
// descriptor transport and main-thread registration. Separate descriptor and
// addressed arms keep those two thread costs distinct from codegen.
//
// The two switches are orthogonal, and the file's assertions say so rather than
// assuming it. Across the *core* switch the main-thread program does not move at
// all — that is what makes the core a background-only concern. Across the
// descriptor-mode *backend* the main-thread program must move while the
// background program does not. Addressing is a separate, explicit BTS delta.
//
// The structured receipt additionally keeps the encoded bundle, decoded
// LepusNG main/background programs, and the Rspack module/used-export inventory
// for each thread separate. The compilation graph deliberately remains visible
// even when final tree-shaking removes a closure: it is a source-reachability
// ledger, not a substitute for the byte identity and final-program controls.
//
// What it is not: a performance measurement. Bytes are the whole subject here.
process.env.NODE_ENV = 'production';

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';

import { pluginOctane } from '../../packages/rspeedy-plugin-octane/src/index.js';
import { LYNX_TARGET_SDK_VERSION } from '../../packages/rspeedy-plugin-octane/src/application.js';
import {
	LYNX_BACKGROUND_LAYER,
	LYNX_MAIN_THREAD_LAYER,
} from '../../packages/rspeedy-plugin-octane/src/layers.js';
import { registerTypeScriptSourceResolution } from './ts-source-resolution.mjs';

// Before the backend is imported, and it has to be a dynamic import for that
// ordering to exist: a static one is resolved before any of this file's body
// runs. The backend is TypeScript, and `ts-source-resolution.mjs` explains what
// that costs a plain-`node` harness and what it does not.
registerTypeScriptSourceResolution();
const baseMainThreadProgramBackend = await import('../../packages/lynx/src/compiler/index.js');
const programFeatures = Object.freeze(
	(process.env.OCTANE_CORE_SWITCH_PROGRAM_FEATURES ?? '')
		.split(',')
		.map((feature) => feature.trim())
		.filter(Boolean)
		.sort(),
);
for (const feature of programFeatures) {
	if (feature !== 'slot-updates' && feature !== 'structural-runs') {
		throw new Error(`unknown main-thread program feature ${JSON.stringify(feature)}`);
	}
}
const mainThreadProgramBackend =
	programFeatures.length === 0
		? baseMainThreadProgramBackend
		: Object.freeze({
				...baseMainThreadProgramBackend,
				emitLynxMainThreadProgram(program, options) {
					return baseMainThreadProgramBackend.emitLynxMainThreadProgram(program, {
						...options,
						...(programFeatures.includes('slot-updates') ? { slotUpdates: true } : null),
						...(programFeatures.includes('structural-runs') ? { structuralRuns: true } : null),
					});
				},
			});

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const RSPEEDY_MODULES = path.join(REPO, 'packages/rspeedy-plugin-octane/node_modules');
const RSPEEDY_CWD = path.join(REPO, 'packages/rspeedy-plugin-octane/tests/_fixtures/application');
const ENTRY = path.join(REPO, 'benchmarks/lynx-table/app/src/index.ts');
const ENTRY_NAME = 'main';
const BUNDLE_NAME = 'main.lynx.bundle';
const AUDIT_INPUTS = Object.freeze([
	'benchmarks/lynx-bundle-size/README.md',
	'benchmarks/lynx-bundle-size/core-switch.mjs',
	'benchmarks/lynx-bundle-size/inventory.mjs',
]);
const AUDIT_BASE = process.env.OCTANE_AUDIT_BASE ?? 'HEAD';

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
	// The fixture is built with `dev: false`, so use one production code from
	// each Block layer rather than development-only prose that production
	// constant folding correctly removes.
	block: ['Octane Lynx OL015', 'Octane Lynx OL011', 'Octane Lynx OL013'],
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
const brotliBytes = (buffer) =>
	brotliCompressSync(buffer, {
		params: { [zc.BROTLI_PARAM_QUALITY]: zc.BROTLI_MAX_QUALITY },
	}).length;
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function artifactStat(bytes) {
	return {
		raw: bytes.length,
		gzip: gzipBytes(bytes),
		brotli: brotliBytes(bytes),
		sha256: sha256(bytes),
	};
}

function portableIdentifier(identifier) {
	const value = identifier.replaceAll('\\', '/');
	const repo = REPO.replaceAll('\\', '/');
	if (value.startsWith(`${repo}/`)) return `@/${value.slice(repo.length + 1)}`;
	const nodeModules = value.lastIndexOf('/node_modules/');
	if (nodeModules !== -1) return value.slice(nodeModules + 1);
	for (const anchor of ['/packages/', '/benchmarks/']) {
		const index = value.lastIndexOf(anchor);
		if (index !== -1) return `@${value.slice(index)}`;
	}
	return value;
}

function normalizeUsedExports(value) {
	if (value === true || value === false || value == null) return value;
	if (typeof value[Symbol.iterator] === 'function') return [...value].map(String).sort();
	return String(value);
}

function chunkRuntime(chunk) {
	if (typeof chunk.runtime === 'string') return chunk.runtime;
	if (chunk.runtime != null && typeof chunk.runtime[Symbol.iterator] === 'function') {
		return [...chunk.runtime];
	}
	return chunk.name ?? String(chunk.id ?? 'unnamed');
}

function moduleLayers(compilation, module) {
	const layers = new Set();
	const visited = new Set();
	const pending = [module];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		if (typeof current.layer === 'string' && current.layer.length > 0) {
			layers.add(current.layer);
		}
		for (const connection of compilation.moduleGraph.getIncomingConnections(current)) {
			if (connection.originModule) pending.push(connection.originModule);
		}
	}
	return [...layers].sort();
}

function threadForModule(layers, chunks) {
	const main =
		layers.includes(LYNX_MAIN_THREAD_LAYER) ||
		chunks.some((chunk) => /(?:main-thread|__octane_main_thread)/.test(chunk));
	const background =
		layers.includes(LYNX_BACKGROUND_LAYER) ||
		chunks.some((chunk) => /(?:^|\/)background$/.test(chunk) || chunk === ENTRY_NAME);
	if (main && background) return 'shared';
	if (main && !background) return 'main';
	if (background && !main) return 'background';
	return 'unassigned';
}

class CaptureReachableModulesPlugin {
	constructor(target) {
		this.target = target;
	}

	apply(compiler) {
		compiler.hooks.done.tap(this.constructor.name, (stats) => {
			const compilation = stats.compilation;
			for (const module of compilation.modules) {
				const size = Number(module.size?.() ?? 0);
				if (!Number.isFinite(size) || size <= 0) continue;
				const moduleChunks = [...compilation.chunkGraph.getModuleChunksIterable(module)];
				const chunks = moduleChunks
					.map((chunk) => chunk.name ?? String(chunk.id ?? 'unnamed'))
					.sort();
				const identifier = module.nameForCondition?.() ?? module.identifier?.() ?? 'unknown';
				const layers = moduleLayers(compilation, module);
				const thread = threadForModule(layers, chunks);
				const runtimes =
					moduleChunks.length > 0
						? moduleChunks.map((chunk) => [
								chunk.name ?? String(chunk.id ?? 'unnamed'),
								chunkRuntime(chunk),
							])
						: thread === 'main'
							? [['main__octane_main_thread', 'main__octane_main_thread']]
							: thread === 'background'
								? [[ENTRY_NAME, ENTRY_NAME]]
								: [];
				const usedExports = Object.fromEntries(
					runtimes.map(([name, runtime]) => [
						name,
						normalizeUsedExports(compilation.moduleGraph.getUsedExports(module, runtime)),
					]),
				);
				this.target.push({
					identifier: portableIdentifier(identifier),
					layers,
					thread,
					size,
					chunks,
					usedExports,
				});
			}
		});
	}
}

function reachableInventory(modules) {
	const sorted = modules.toSorted(
		(left, right) =>
			left.thread.localeCompare(right.thread) ||
			left.identifier.localeCompare(right.identifier) ||
			left.layers.join('\0').localeCompare(right.layers.join('\0')) ||
			left.size - right.size,
	);
	const byThread = Object.fromEntries(
		['main', 'background', 'shared', 'unassigned'].map((thread) => {
			const selected = sorted.filter((module) => module.thread === thread);
			return [
				thread,
				{
					reachableRaw: selected.reduce((sum, module) => sum + module.size, 0),
					moduleCount: selected.length,
					sha256: sha256(Buffer.from(JSON.stringify(selected))),
					modules: selected,
				},
			];
		}),
	);
	return {
		method:
			'Rspack production compilation modules classified by complete incoming Lynx layers, then chunk ownership',
		byThread,
	};
}

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
async function buildWithCore(label, core, outputRoot, { backend, programAddressing } = {}) {
	const reachableModules = [];
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
			source: {
				entry: { [ENTRY_NAME]: ENTRY },
				define: {
					__BENCH_AUTOROWS__: '0',
					__BENCH_CORE__: JSON.stringify(core),
					// The derived arm runs the same compiler-produced App on both
					// cores. The hand-authored ceiling program is not part of this
					// product-default comparison and must fold out.
					__BENCH_BLOCK_MODE__: JSON.stringify('derived'),
					__OCTANE_LYNX_PROFILE__: 'false',
				},
			},
			splitChunks: false,
			tools: {
				rspack: {
					plugins: [
						new PinBuildDigestPlugin(),
						new CaptureReachableModulesPlugin(reachableModules),
					],
					resolve: { modules: [RSPEEDY_MODULES, 'node_modules'] },
				},
			},
			plugins: [
				pluginOctane({
					core,
					// Pinned so the arms differ only in what they are measuring. The
					// first two explicitly disable the now-default backend; the latter
					// two pass its live module. Keeping every arm serial prevents worker
					// scheduling from rotating minifier short names and masquerading as
					// a background-program delta.
					parallel: false,
					hmr: false,
					dev: false,
					mainThreadProgramBackend: backend ?? false,
					...(programAddressing === undefined ? null : { programAddressing }),
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
	const reachable = reachableInventory(reachableModules);
	if (
		reachable.byThread.main.moduleCount === 0 ||
		reachable.byThread.background.moduleCount === 0
	) {
		throw new Error(`${label}: reachable-module capture did not identify both Lynx threads`);
	}
	return {
		label,
		core,
		backend: backend === undefined ? 'descriptor' : 'compiled-program',
		programAddressing: backend === undefined ? false : programAddressing !== false,
		bundle: artifactStat(bundle),
		background: artifactStat(background.bytes),
		main: artifactStat(main.bytes),
		reachable,
		// The background program is compared across the backend, not only sized,
		// so it needs an identity of its own. Unpinned, deliberately: the digest
		// plugin stamps each chunk from that chunk's own source, so if the
		// background text really does not move neither does its digest — and a
		// pin here would hide the case where that stops being true.
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
	// Keep descriptor transport to isolate main-thread codegen. The background
	// program must stay byte-identical to `block` in this arm.
	const blockProgramDescriptor = await buildWithCore(
		'block+program-descriptor',
		'block',
		path.join(outputs, 'block-program-descriptor'),
		{ backend: mainThreadProgramBackend, programAddressing: false },
	);
	// Omit the addressing option exactly as a product build does. Supplying the
	// backend enables positional addressing by default.
	const blockProgram = await buildWithCore(
		'block+program',
		'block',
		path.join(outputs, 'block-program'),
		{ backend: mainThreadProgramBackend },
	);

	const rows = [universal, block, blockProgramDescriptor, blockProgram];
	const delta = (value) => (value >= 0 ? '+' : '') + value.toLocaleString();

	console.log('\nencoded production bundle\n');
	console.log('| arm | raw | gzip | brotli | sha256 |');
	console.log('| --- | ---: | ---: | ---: | --- |');
	for (const row of rows) {
		console.log(
			`| ${row.label} | ${row.bundle.raw.toLocaleString()} | ${row.bundle.gzip.toLocaleString()} | ` +
				`${row.bundle.brotli.toLocaleString()} | ${row.bundle.sha256.slice(0, 12)} |`,
		);
	}

	console.log('\ndecoded background LepusNG program, one core per bundle\n');
	console.log(
		'| arm | raw | gzip | brotli | reachable modules/raw | block core | universal root | plan constructors |',
	);
	console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
	for (const row of rows) {
		const reachable = row.reachable.byThread.background;
		console.log(
			`| ${row.label} | ${row.background.raw.toLocaleString()} | ${row.background.gzip.toLocaleString()} | ` +
				`${row.background.brotli.toLocaleString()} | ${reachable.moduleCount}/${reachable.reachableRaw.toLocaleString()} | ` +
				`${row.probes.block.length}/${CORE_PROBES.block.length} | ` +
				`${row.probes.universalRoot.length}/${CORE_PROBES.universalRoot.length} | ` +
				`${row.probes.universalPlan.length}/${CORE_PROBES.universalPlan.length} |`,
		);
	}

	console.log('\ndecoded main-thread LepusNG program (moved by the backend, not by the core)\n');
	console.log('| arm | raw | gzip | brotli | reachable modules/raw | sha256 | compiled programs |');
	console.log('| --- | ---: | ---: | ---: | ---: | --- | ---: |');
	for (const row of rows) {
		const reachable = row.reachable.byThread.main;
		console.log(
			`| ${row.label} | ${row.main.raw.toLocaleString()} | ${row.main.gzip.toLocaleString()} | ` +
				`${row.main.brotli.toLocaleString()} | ${reachable.moduleCount}/${reachable.reachableRaw.toLocaleString()} | ` +
				`${row.main.sha256.slice(0, 12)} | ${row.program} |`,
		);
	}

	console.log(
		`\nbackground delta (block − universal): ${delta(block.background.gzip - universal.background.gzip)} B gzip, ` +
			`${delta(block.background.brotli - universal.background.brotli)} B brotli, ` +
			`${delta(block.background.raw - universal.background.raw)} B raw`,
	);
	console.log(
		`main-thread codegen delta (block+program-descriptor − block): ` +
			`${delta(blockProgramDescriptor.main.gzip - block.main.gzip)} B gzip, ` +
			`${delta(blockProgramDescriptor.main.brotli - block.main.brotli)} B brotli, ` +
			`${delta(blockProgramDescriptor.main.raw - block.main.raw)} B raw`,
	);
	console.log(
		`addressing delta (block+program − block+program-descriptor): ` +
			`${delta(blockProgram.background.gzip - blockProgramDescriptor.background.gzip)} B background gzip, ` +
			`${delta(blockProgram.main.gzip - blockProgramDescriptor.main.gzip)} B main gzip`,
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
	for (const row of [block, blockProgramDescriptor, blockProgram]) {
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
	if (universal.main.sha256 !== block.main.sha256) {
		failures.push('the main-thread program is not byte-identical across the core switch');
	}

	// The descriptor backend isolates codegen, and both halves of its control
	// are load-bearing.
	// It must move the main-thread program, because an arm that compiled nothing
	// would report a flattering zero delta and pass every check above it. And it
	// must not move the background program, which is #163's promise that the
	// half of the bundle it does not own does not move underneath it.
	if (blockProgramDescriptor.main.sha256 === block.main.sha256) {
		failures.push(
			'the main-thread program backend changed nothing; the third arm is measuring the second',
		);
	}
	if (blockProgramDescriptor.program === 0 || blockProgram.program === 0) {
		failures.push(
			`a program arm carries no compiled program: nothing in its main-thread chunk contains ` +
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
	if (blockProgramDescriptor.background.sha256 !== block.background.sha256) {
		failures.push('the descriptor-mode main-thread program backend moved the background program');
	}
	if (blockProgram.main.sha256 === blockProgramDescriptor.main.sha256) {
		failures.push(
			'default program addressing did not register addresses in the main-thread program',
		);
	}
	if (blockProgram.background.sha256 === blockProgramDescriptor.background.sha256) {
		failures.push('default program addressing did not move the background descriptor path');
	}

	if (failures.length !== 0) {
		console.error(`\nFAILED\n- ${failures.join('\n- ')}`);
		process.exitCode = 1;
	} else {
		console.log(
			'\nOK — each bundle carries exactly one core, the core switch leaves the main-thread\n' +
				'program byte-identical, descriptor-mode isolates codegen, and addressing costs both threads explicitly.',
		);
	}

	const payload = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			commit: execFileSync('git', ['rev-parse', AUDIT_BASE], {
				cwd: REPO,
				encoding: 'utf8',
			}).trim(),
			dirty:
				execFileSync('git', ['status', '--porcelain'], {
					cwd: REPO,
					encoding: 'utf8',
				}).trim().length > 0,
			diffScope: AUDIT_INPUTS,
			diffSha256: sha256(
				execFileSync('git', ['diff', '--binary', AUDIT_BASE, '--', ...AUDIT_INPUTS], {
					cwd: REPO,
				}),
			),
		},
		toolchain: {
			node: process.version,
			platform: `${os.platform()} ${os.release()}`,
			targetSdkVersion: LYNX_TARGET_SDK_VERSION,
		},
		fixture: 'benchmarks/lynx-table/app, BENCH_AUTOROWS=0, derived compiler path',
		programFeatures,
		arms: rows,
		controls: {
			passed: failures.length === 0,
			failures,
		},
	};
	if (process.env.OCTANE_CORE_SWITCH_OUTPUT) {
		fs.writeFileSync(
			process.env.OCTANE_CORE_SWITCH_OUTPUT,
			`${JSON.stringify(payload, null, 2)}\n`,
		);
	}
} finally {
	fs.rmSync(outputs, { recursive: true, force: true });
}
