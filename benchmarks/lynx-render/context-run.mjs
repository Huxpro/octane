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
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '1000,10000,30000' },
		depth: { type: 'string', default: '32' },
		reps: { type: 'string', default: '5' },
		'baseline-root': { type: 'string' },
		'memory-reps': { type: 'string', default: '0' },
		'plain-attempts': { type: 'string' },
		out: { type: 'string' },
	},
});
const rowCounts = args.rows.split(',').map(Number);
const depth = Number(args.depth);
const repetitions = Number(args.reps);
const memoryRepetitions = Number(args['memory-reps']);
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
if (!Number.isSafeInteger(memoryRepetitions) || memoryRepetitions < 0) {
	throw new TypeError('memory-reps must be a non-negative integer.');
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

async function buildWorkload(label, octaneSource, profile) {
	const outDir = path.join(tempDir, label, profile ? 'profile' : 'shipping');
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
					replacement: path.join(octaneSource, 'universal-native.ts'),
				},
				{
					find: /^octane\/profiling$/,
					replacement: path.join(octaneSource, 'profiling.ts'),
				},
				{ find: /^octane\/universal$/, replacement: path.join(octaneSource, 'universal.ts') },
				{ find: /^octane$/, replacement: path.join(octaneSource, 'index.ts') },
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
		module: await import(`${pathToFileURL(file).href}?arm=${label}&profile=${profile}`),
		bundle: {
			bytes: bytes.length,
			gzipBytes: gzipSync(bytes).length,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		},
	};
}

let payload;
try {
	const baselineRoot =
		args['baseline-root'] === undefined ? null : path.resolve(args['baseline-root']);
	if (
		baselineRoot !== null &&
		!fs.existsSync(path.join(baselineRoot, 'packages/octane/src/universal-core.ts'))
	) {
		throw new Error(`baseline-root is not an Octane checkout: ${baselineRoot}`);
	}
	const armRoots =
		baselineRoot === null ? { candidate: REPO } : { baseline: baselineRoot, candidate: REPO };
	const arms = {};
	for (const [name, root] of Object.entries(armRoots)) {
		const octaneSource = path.join(root, 'packages/octane/src');
		arms[name] = {
			root,
			gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
			shipping: await buildWorkload(name, octaneSource, false),
			profile: await buildWorkload(name, octaneSource, true),
		};
	}
	const failures = [];
	const durations = new Map(
		Object.keys(arms).flatMap((name) =>
			rowCounts.flatMap((count) => [
				[`${name}:${count}:changed`, []],
				[`${name}:${count}:unchanged`, []],
			]),
		),
	);
	const oracles = new Map();
	const run = async (name, count, kind, record) => {
		const nextTone = kind === 'changed' ? 'dark' : 'light';
		const result = await arms[name].shipping.module.runContextChange(count, depth, nextTone);
		if (result.diagnostics.length !== 0) {
			failures.push(`${name}:${count}: ${result.diagnostics.join(' | ')}`);
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
				`${name}:${count}:${kind}: counts ${JSON.stringify(counts)}, expected ${JSON.stringify(expectedCounts)}.`,
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
		if (record) durations.get(`${name}:${key}`).push(result.durationMs);
	};

	// Warm every arm/size once. A revision A/B uses mirrored ABBA/BAAB order;
	// size and changed/unchanged order also rotate while every sample gets a
	// fresh mounted root.
	for (const name of Object.keys(arms)) {
		for (const count of rowCounts) {
			await run(name, count, 'changed', false);
			await run(name, count, 'unchanged', false);
		}
	}
	for (let repetition = 0; repetition < repetitions; repetition++) {
		const pivot = repetition % rowCounts.length;
		const order = [...rowCounts.slice(pivot), ...rowCounts.slice(0, pivot)];
		if (repetition % 2 !== 0) order.reverse();
		for (const count of order) {
			const kinds = repetition % 2 === 0 ? ['changed', 'unchanged'] : ['unchanged', 'changed'];
			const armOrder =
				baselineRoot === null
					? ['candidate']
					: repetition % 2 === 0
						? ['baseline', 'candidate', 'candidate', 'baseline']
						: ['candidate', 'baseline', 'baseline', 'candidate'];
			for (const name of armOrder) {
				for (const kind of kinds) await run(name, count, kind, true);
			}
		}
	}
	const profileCount = Math.max(...rowCounts);
	const candidatePlainAttempts =
		args['plain-attempts'] === undefined ? profileCount - 1 : Number(args['plain-attempts']);
	if (!Number.isSafeInteger(candidatePlainAttempts) || candidatePlainAttempts < 0) {
		throw new TypeError('plain-attempts must be a non-negative integer.');
	}
	const ownerProfiles = {};
	for (const [name, arm] of Object.entries(arms)) {
		const ownerProfile = await arm.profile.module.runContextChange(
			profileCount,
			depth,
			'dark',
			true,
		);
		if (ownerProfile.diagnostics.length !== 0) {
			failures.push(`${name}:profile: ${ownerProfile.diagnostics.join(' | ')}`);
		}
		const profileAttempts = Object.fromEntries(
			(ownerProfile.ownerProfile?.summary ?? []).map((entry) => [entry.component, entry.attempts]),
		);
		const expectedPlainAttempts = name === 'baseline' ? profileCount - 1 : candidatePlainAttempts;
		const expectedProfileAttempts = {
			ContextBenchApp: 1,
			...(expectedPlainAttempts === 0 ? null : { MemoContextBenchPlainRow: expectedPlainAttempts }),
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
				`${name}: profile attempts ${JSON.stringify(profileAttempts)}, expected ${JSON.stringify(expectedProfileAttempts)}.`,
			);
		}
		ownerProfiles[name] = {
			rows: profileCount,
			counts: {
				plainRenders: ownerProfile.plainRenders,
				layerRenders: ownerProfile.layerRenders,
				leafRenders: ownerProfile.leafRenders,
			},
			...ownerProfile.ownerProfile,
		};
	}
	const memorySamples = Object.fromEntries(
		Object.keys(arms).map((name) => [
			name,
			{ mountHeapBytes: [], transientUpdateBytes: [], retainedUpdateBytes: [] },
		]),
	);
	const runMemory = async (name, record) => {
		const result = await arms[name].shipping.module.runContextMemory(profileCount, depth);
		if (
			result.diagnostics.length !== 0 ||
			result.commits !== 1 ||
			result.commands !== 2 ||
			result.leafClasses !== 'context-leaf dark'
		) {
			failures.push(`${name}: invalid memory oracle ${JSON.stringify(result)}.`);
		}
		if (!record) return;
		for (const field of ['mountHeapBytes', 'transientUpdateBytes', 'retainedUpdateBytes']) {
			memorySamples[name][field].push(result[field]);
		}
	};
	if (memoryRepetitions !== 0) {
		for (const name of Object.keys(arms)) await runMemory(name, false);
		for (let repetition = 0; repetition < memoryRepetitions; repetition++) {
			const order =
				baselineRoot === null
					? ['candidate']
					: repetition % 2 === 0
						? ['baseline', 'candidate']
						: ['candidate', 'baseline'];
			for (const name of order) await runMemory(name, true);
		}
	}

	payload = {
		suite: 'lynx-production-deep-context-owner',
		meta: {
			date: new Date().toISOString(),
			revisions: Object.fromEntries(Object.entries(arms).map(([name, arm]) => [name, arm.gitSha])),
			node: process.version,
			cpus: `${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}`,
			rows: rowCounts,
			depth,
			repetitions,
			memoryRepetitions,
			protocol:
				baselineRoot === null
					? 'production minified Universal bundle; warm each size; rotated/reversed size order; fresh mounted root per sample; provider state light→dark plus same-value control; one deep memo consumer among stable memo rows'
					: 'same candidate fixture/compiler/Lynx chassis; only Octane runtime source revision differs; production minified Universal bundles; warm then mirrored ABBA/BAAB with rotated size and changed/control order; fresh mounted root per sample',
		},
		arms: Object.fromEntries(
			Object.entries(arms).map(([name, arm]) => [
				name,
				{
					bundle: arm.shipping.bundle,
					profileBundle: arm.profile.bundle,
					ownerProfile: ownerProfiles[name],
					...(memoryRepetitions === 0
						? null
						: {
								memory: Object.fromEntries(
									Object.entries(memorySamples[name]).map(([field, samples]) => [
										field,
										stat(samples),
									]),
								),
							}),
					results: Object.fromEntries(
						rowCounts.map((count) => [
							count,
							Object.fromEntries(
								['changed', 'unchanged'].map((kind) => [
									kind,
									{
										oracle: oracles.get(`${count}:${kind}`),
										timingMs: stat(durations.get(`${name}:${count}:${kind}`)),
									},
								]),
							),
						]),
					),
				},
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
