// #288 production dual-thread evidence for one deep context consumer among
// stable memoized rows. This measures Octane CPU and protocol work through the
// real compiler, async transport, main receiver, and fake Element PAPI; it
// makes no native paint or layout claim.
process.env.NODE_ENV = 'production';

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
		rows: { type: 'string', default: '1000,10000,30000' },
		depth: { type: 'string', default: '32' },
		reps: { type: 'string', default: '9' },
		out: { type: 'string' },
	},
});
const rowCounts = args.rows.split(',').map(Number);
const depth = Number(args.depth);
const repetitions = Number(args.reps);
if (
	rowCounts.length === 0 ||
	rowCounts.some((count) => !Number.isSafeInteger(count) || count < 2)
) {
	throw new TypeError('rows must be a comma-separated list of integers >= 2.');
}
if (!Number.isSafeInteger(depth) || depth < 0) {
	throw new TypeError('depth must be a non-negative integer.');
}
if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
	throw new TypeError('reps must be a positive integer.');
}
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-context-'));

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

async function buildWorkload(profile) {
	const outDir = path.join(tempDir, profile ? 'profile' : 'shipping');
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
				{
					find: /^octane\/profiling$/,
					replacement: path.join(OCTANE_SOURCE, 'profiling.ts'),
				},
				{ find: /^octane\/universal$/, replacement: path.join(OCTANE_SOURCE, 'universal.ts') },
				{ find: /^octane$/, replacement: path.join(OCTANE_SOURCE, 'index.ts') },
			],
		},
		plugins: [octane({ renderers: lynxRenderers, ssr: false, profile })],
		define: {
			'process.env.NODE_ENV': '"production"',
			__OCTANE_LYNX_BACKGROUND_CORE__: '"universal"',
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
		module: await import(`${pathToFileURL(file).href}?profile=${profile}`),
		bundle: {
			bytes: bytes.length,
			gzipBytes: gzipSync(bytes).length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		},
	};
}

let payload;
try {
	const workload = await buildWorkload(false);
	const profileWorkload = await buildWorkload(true);
	const failures = [];
	const durations = new Map(
		rowCounts.flatMap((count) => [
			[`${count}:changed`, []],
			[`${count}:unchanged`, []],
		]),
	);
	const oracles = new Map();
	const run = async (count, kind, record) => {
		const nextTone = kind === 'changed' ? 'dark' : 'light';
		const result = await workload.module.runContextChange(count, depth, nextTone);
		if (result.diagnostics.length !== 0) {
			failures.push(`${count}: ${result.diagnostics.join(' | ')}`);
		}
		const counts = {
			plainRenders: result.plainRenders,
			layerRenders: result.layerRenders,
			leafRenders: result.leafRenders,
			commits: result.commits,
			commands: result.commands,
		};
		const expectedCounts =
			kind === 'changed'
				? { plainRenders: 0, layerRenders: 0, leafRenders: 1, commits: 1, commands: 2 }
				: { plainRenders: 0, layerRenders: 0, leafRenders: 0, commits: 0, commands: 0 };
		if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
			failures.push(
				`${count}:${kind}: counts ${JSON.stringify(counts)}, expected ${JSON.stringify(expectedCounts)}.`,
			);
		}
		const oracle = {
			counts,
			leafValues: result.leafValues,
			leafClasses: result.leafClasses,
			checksum: result.checksum,
		};
		const key = `${count}:${kind}`;
		const previous = oracles.get(key);
		if (previous === undefined) oracles.set(key, oracle);
		else if (JSON.stringify(previous) !== JSON.stringify(oracle)) {
			failures.push(`${key}: nondeterministic oracle ${JSON.stringify(oracle)}.`);
		}
		if (result.leafClasses !== `context-leaf ${nextTone}`) {
			failures.push(`${key}: leaf class was ${JSON.stringify(result.leafClasses)}.`);
		}
		const expectedLeafValues = kind === 'changed' ? '["dark"]' : '[]';
		if (JSON.stringify(result.leafValues) !== expectedLeafValues) {
			failures.push(`${key}: leaf values were ${JSON.stringify(result.leafValues)}.`);
		}
		if (record) durations.get(key).push(result.durationMs);
	};

	// Warm every size once, then rotate the first size to avoid a fixed ordering
	// advantage while each measured update still uses a fresh mounted root.
	for (const count of rowCounts) {
		await run(count, 'changed', false);
		await run(count, 'unchanged', false);
	}
	for (let repetition = 0; repetition < repetitions; repetition++) {
		const pivot = repetition % rowCounts.length;
		const order = [...rowCounts.slice(pivot), ...rowCounts.slice(0, pivot)];
		if (repetition % 2 !== 0) order.reverse();
		for (const count of order) {
			const kinds = repetition % 2 === 0 ? ['changed', 'unchanged'] : ['unchanged', 'changed'];
			for (const kind of kinds) await run(count, kind, true);
		}
	}
	const profileCount = Math.max(...rowCounts);
	const ownerProfile = await profileWorkload.module.runContextChange(
		profileCount,
		depth,
		'dark',
		true,
	);
	if (ownerProfile.diagnostics.length !== 0) {
		failures.push(`profile: ${ownerProfile.diagnostics.join(' | ')}`);
	}
	const profileAttempts = Object.fromEntries(
		(ownerProfile.ownerProfile?.summary ?? []).map((entry) => [entry.component, entry.attempts]),
	);
	const expectedProfileAttempts = {
		ContextBenchApp: 1,
		MemoContextBenchPlainRow: profileCount - 1,
		MemoContextBenchLayer: depth + 1,
		MemoContextBenchConsumerRow: 1,
		MemoContextBenchLeaf: 1,
	};
	if (
		Object.keys(profileAttempts).length !== Object.keys(expectedProfileAttempts).length ||
		Object.entries(expectedProfileAttempts).some(
			([component, attempts]) => profileAttempts[component] !== attempts,
		)
	) {
		failures.push(
			`profile attempts ${JSON.stringify(profileAttempts)}, expected ${JSON.stringify(expectedProfileAttempts)}.`,
		);
	}

	payload = {
		suite: 'lynx-production-deep-context-owner',
		meta: {
			date: new Date().toISOString(),
			gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
			node: process.version,
			cpus: `${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}`,
			rows: rowCounts,
			depth,
			repetitions,
			protocol:
				'production minified Universal bundle; warm each size; rotated/reversed size order; fresh mounted root per sample; provider light→dark; one deep memo consumer among stable memo rows',
		},
		bundle: workload.bundle,
		profileBundle: profileWorkload.bundle,
		ownerProfile: {
			rows: profileCount,
			counts: {
				plainRenders: ownerProfile.plainRenders,
				layerRenders: ownerProfile.layerRenders,
				leafRenders: ownerProfile.leafRenders,
			},
			...ownerProfile.ownerProfile,
		},
		results: Object.fromEntries(
			rowCounts.map((count) => [
				count,
				Object.fromEntries(
					['changed', 'unchanged'].map((kind) => [
						kind,
						{
							oracle: oracles.get(`${count}:${kind}`),
							timingMs: stat(durations.get(`${count}:${kind}`)),
						},
					]),
				),
			]),
		),
		...(failures.length === 0 ? null : { failed: failures.join(' | ') }),
	};
	if (failures.length !== 0) process.exitCode = 1;
} catch (error) {
	payload = {
		suite: 'lynx-production-deep-context-owner',
		failed: error instanceof Error ? error.stack || error.message : String(error),
	};
	process.exitCode = 1;
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}

const output = `${JSON.stringify(payload, null, 2)}\n`;
if (args.out === undefined) process.stdout.write(output);
else fs.writeFileSync(path.resolve(args.out), output);
