// #288 production dual-thread evidence for one external-store selector owner.
//
// The same .lynx.tsrx source is compiled twice. Only the build-time background
// core changes; both arms run the production compiler, async transport, main
// receiver, host driver, and fake Element PAPI used by run.mjs. This is a CPU
// and protocol measurement, not a native paint/layout claim.
process.env.NODE_ENV = 'production';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

import { octane } from '../../packages/octane/src/compiler/vite.js';
import { lynxRenderers } from '../../packages/lynx/src/config.runtime.js';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const LYNX_SOURCE = path.join(REPO, 'packages/lynx/src');
const OCTANE_SOURCE = path.join(REPO, 'packages/octane/src');
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '9' },
		out: { type: 'string' },
	},
});
const rows = Number(args.rows);
const repetitions = Number(args.reps);
if (!Number.isSafeInteger(rows) || rows < 4) throw new TypeError('rows must be an integer >= 4.');
if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
	throw new TypeError('reps must be a positive integer.');
}
const selections = [Math.ceil(rows / 4), Math.ceil((rows * 3) / 4), Math.ceil(rows / 4)];
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-store-selector-'));

function stat(samples) {
	const sorted = [...samples].sort((left, right) => left - right);
	const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
	return {
		median: sorted[Math.floor((sorted.length - 1) / 2)],
		min: sorted[0],
		max: sorted.at(-1),
		mean,
		p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
		samples: sorted.length,
	};
}

async function buildArm(core) {
	const outDir = path.join(tempDir, core);
	await build({
		configFile: false,
		root: REPO,
		logLevel: 'silent',
		resolve: {
			alias: [
				{ find: /^@octanejs\/lynx$/, replacement: path.join(LYNX_SOURCE, 'index.ts') },
				{
					find: /^@octanejs\/lynx\/intrinsics\/jsx-runtime$/,
					replacement: path.join(LYNX_SOURCE, 'intrinsics.ts'),
				},
				{ find: /^@octanejs\/lynx\/(.*)$/, replacement: `${LYNX_SOURCE}/$1.ts` },
				{
					find: /^octane\/universal\/native$/,
					replacement: path.join(OCTANE_SOURCE, 'universal-native.ts'),
				},
				{ find: /^octane\/universal$/, replacement: path.join(OCTANE_SOURCE, 'universal.ts') },
				{ find: /^octane$/, replacement: path.join(OCTANE_SOURCE, 'index.ts') },
			],
		},
		plugins: [octane({ renderers: lynxRenderers, ssr: false })],
		define: {
			'process.env.NODE_ENV': '"production"',
			__OCTANE_LYNX_BACKGROUND_CORE__: JSON.stringify(core),
			__OCTANE_LYNX_PROFILE__: 'false',
		},
		build: {
			write: true,
			minify: 'esbuild',
			target: 'node22',
			lib: {
				entry: path.join(ROOT, 'workload.ts'),
				formats: ['es'],
				fileName: 'workload',
			},
			outDir,
			emptyOutDir: true,
			rollupOptions: { external: [] },
		},
	});
	const file = path.join(outDir, 'workload.js');
	const bytes = fs.readFileSync(file);
	return {
		module: await import(`${pathToFileURL(file).href}?arm=${core}`),
		bundle: { bytes: bytes.length, gzipBytes: gzipSync(bytes).length },
	};
}

let payload;
try {
	const arms = {
		universal: await buildArm('universal'),
		block: await buildArm('block'),
	};
	const failures = [];
	const samples = {
		universal: selections.map(() => []),
		block: selections.map(() => []),
	};
	const countOracles = { universal: null, block: null };
	const checksumOracles = new Map();
	const runArm = async (name) => {
		const result = await arms[name].module.runStoreSelections(rows, selections);
		if (result.diagnostics.length !== 0)
			failures.push(`${name}: ${result.diagnostics.join(' | ')}`);
		if (
			result.subscriptions !== 1 ||
			result.unsubscriptions !== 1 ||
			result.listenersAfterUnmount !== 0
		) {
			failures.push(
				`${name}: subscription lifecycle ${result.subscriptions}/${result.unsubscriptions}/${result.listenersAfterUnmount}, expected 1/1/0.`,
			);
		}
		if (
			result.unchanged.rowRenders !== 0 ||
			result.unchanged.commits !== 0 ||
			result.unchanged.commands !== 0
		) {
			failures.push(
				`${name}: unchanged notification produced work ${JSON.stringify(result.unchanged)}.`,
			);
		}
		const counts = result.steps.map((step) => ({
			rowRenders: step.rowRenders,
			commits: step.commits,
			commands: step.commands,
		}));
		const expectedCounts = [
			{ rowRenders: 1, commits: 1, commands: 1 },
			{ rowRenders: 2, commits: 1, commands: 2 },
			{ rowRenders: 2, commits: 1, commands: 2 },
		];
		if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
			failures.push(
				`${name}: selection counts ${JSON.stringify(counts)}, expected 1/2/2 rows and commands.`,
			);
		}
		countOracles[name] ??= counts;
		if (JSON.stringify(countOracles[name]) !== JSON.stringify(counts)) {
			failures.push(`${name}: deterministic counts changed across repetitions.`);
		}
		for (const [index, step] of result.steps.entries()) {
			samples[name][index].push(step.durationMs);
			if (step.selectedClasses !== 'row danger') {
				failures.push(
					`${name}: row ${step.selected} ended with ${JSON.stringify(step.selectedClasses)}.`,
				);
			}
			const key = `${index}:${step.selected}`;
			const checksum = checksumOracles.get(key);
			if (checksum === undefined) checksumOracles.set(key, step.checksum);
			else if (checksum !== step.checksum) {
				failures.push(
					`${name}: visible checksum for ${key} was ${step.checksum}, expected ${checksum}.`,
				);
			}
		}
	};

	// Warm both bundled runtimes before recording the paired window.
	await runArm('universal');
	await runArm('block');
	for (const list of Object.values(samples)) for (const values of list) values.length = 0;

	for (let repetition = 0; repetition < repetitions; repetition++) {
		const order =
			repetition % 2 === 0
				? ['universal', 'block', 'block', 'universal']
				: ['block', 'universal', 'universal', 'block'];
		for (const name of order) await runArm(name);
	}

	payload = {
		suite: 'lynx-production-store-selector-owner',
		meta: {
			date: new Date().toISOString(),
			node: process.version,
			cpus: `${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}`,
			rows,
			repetitions,
			protocol:
				'same authored .lynx.tsrx; production minified bundles; only background core differs; warm then alternating ABBA/BAAB; fresh root/store per sample',
		},
		selections,
		arms: Object.fromEntries(
			Object.entries(arms).map(([name, arm]) => [
				name,
				{
					bundle: arm.bundle,
					counts: countOracles[name],
					timingMs: samples[name].map(stat),
				},
			]),
		),
		unchanged: { rowRenders: 0, commits: 0, commands: 0 },
		subscriptionLifecycle: { subscribe: 1, unsubscribe: 1, remaining: 0 },
		...(failures.length === 0 ? null : { failed: failures.join(' | ') }),
	};
	if (failures.length !== 0) process.exitCode = 1;
} catch (error) {
	payload = {
		suite: 'lynx-production-store-selector-owner',
		failed: error instanceof Error ? error.stack || error.message : String(error),
	};
	process.exitCode = 1;
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}

const output = `${JSON.stringify(payload, null, 2)}\n`;
if (args.out === undefined) process.stdout.write(output);
else fs.writeFileSync(path.resolve(args.out), output);
