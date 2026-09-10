// Same-window scaling probe for the command-batch -> compact-frame producer.
//
// Usage:
//   node benchmarks/lynx-bundle-size/delta-shadow.mjs \
//     --baseline /path/to/exact-base-worktree \
//     --candidate /path/to/candidate-worktree \
//     --output /absolute/path/to/receipt.json
//
// Both worktrees must have dependencies installed. The harness bundles each
// worktree's authored TypeScript with the same esbuild process, then alternates
// fresh Node processes in AB/BA order. The measured operation is one accepted
// scalar SET after the requested number of resident rows has been committed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';

function argument(name) {
	const index = process.argv.indexOf(name);
	if (index === -1 || index + 1 === process.argv.length) {
		throw new TypeError(`delta-shadow: ${name} is required.`);
	}
	return resolve(process.argv[index + 1]);
}

const baseline = argument('--baseline');
const candidate = argument('--candidate');
const output = argument('--output');
const temporary = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'octane-delta-shadow-'));
const scenarios = [1_000, 10_000, 50_000];
const samples = 50;
const rounds = 3;

function artifact(path) {
	const bytes = readFileSync(path);
	return {
		raw: bytes.length,
		gzip: gzipSync(bytes, { level: 9 }).length,
		brotli: brotliCompressSync(bytes).length,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function git(repo, ...args) {
	return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

async function compile(repo, name) {
	const entry = join(temporary, `${name}.ts`);
	const bundle = join(temporary, `${name}.mjs`);
	const universal = join(repo, 'packages/octane/src/universal-native.ts');
	const shadow = join(repo, 'packages/lynx/src/core/delta-shadow.ts');
	writeFileSync(
		entry,
		`import { performance } from 'node:perf_hooks';
import { recordUniversalProgramCommand } from ${JSON.stringify(universal)};
import { createLynxDeltaShadow } from ${JSON.stringify(shadow)};
const rows = Number(process.argv[2]);
const samples = Number(process.argv[3]);
const program = Object.freeze({
  nodes: Object.freeze([
    Object.freeze({ type: 'view', parent: -1, props: Object.freeze({}), bindings: Object.freeze([Object.freeze({ name: 'class', valueIndex: 0 })]) }),
    Object.freeze({ type: '#text', parent: 0, props: Object.freeze({}), bindings: Object.freeze([Object.freeze({ name: 'value', valueIndex: 1 })]) }),
  ]),
  events: Object.freeze([]),
});
const shadow = createLynxDeltaShadow();
const values = Array.from({ length: rows }, (_, index) => ['row', String(index)]).flat();
const command = { op: 'mount-program-run', address: Object.freeze({ module: 'bench/Row.lynx.tsrx', index: 0 }), parent: null, before: null, firstId: 10, firstListenerId: null, count: rows, values };
recordUniversalProgramCommand(command, program);
shadow.prepare({ renderer: 'lynx', version: 1, commands: [command] }).commit();
for (let warmup = 0; warmup < 10; warmup++) shadow.prepare({ renderer: 'lynx', version: warmup + 2, commands: [{ op: 'update', id: 11, props: { value: 'warm-' + warmup } }] }).commit();
const elapsed = [];
for (let sample = 0; sample < samples; sample++) {
  const started = performance.now();
  shadow.prepare({ renderer: 'lynx', version: sample + 12, commands: [{ op: 'update', id: 11, props: { value: 'next-' + sample } }] }).commit();
  elapsed.push(performance.now() - started);
}
process.stdout.write(JSON.stringify(elapsed));
`,
	);
	await build({
		entryPoints: [entry],
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node22',
		outfile: bundle,
		logLevel: 'silent',
	});
	return { bundle, artifact: artifact(bundle) };
}

function run(bundle, rows) {
	const result = spawnSync(process.execPath, [bundle, String(rows), String(samples)], {
		encoding: 'utf8',
	});
	if (result.status !== 0)
		throw new Error(result.stderr || `delta-shadow child exited ${result.status}`);
	return JSON.parse(result.stdout);
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)];
}

try {
	const artifacts = {
		baseline: await compile(baseline, 'baseline'),
		candidate: await compile(candidate, 'candidate'),
	};
	const windows = [];
	for (let round = 0; round < rounds; round++) {
		const order = round % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
		for (const arm of order) {
			for (const rows of scenarios) {
				const rawMs = run(artifacts[arm].bundle, rows);
				windows.push({ round, arm, rows, rawMs, medianMs: median(rawMs) });
			}
		}
	}
	const receipt = {
		schema: 1,
		generatedAt: new Date().toISOString(),
		node: process.version,
		samples,
		rounds,
		scenarios,
		baseline: {
			path: baseline,
			head: git(baseline, 'rev-parse', 'HEAD'),
			status: git(baseline, 'status', '--short'),
			bundle: artifacts.baseline.artifact,
		},
		candidate: {
			path: candidate,
			head: git(candidate, 'rev-parse', 'HEAD'),
			status: git(candidate, 'status', '--short'),
			bundle: artifacts.candidate.artifact,
		},
		windows,
	};
	writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
