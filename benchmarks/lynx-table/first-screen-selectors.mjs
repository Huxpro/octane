// What a first screen costs in `nodes-ref` selectors, on both sides of the
// handshake.
//
// #130 made the main thread install a `nodes-ref` selector only where a commit
// announced it would query the host, and left one case eager on purpose: a
// commit composed before the main-ready reply reaches the background announces
// nothing, whatever the session goes on to negotiate, so eager is the only
// sound answer for it. `run.mjs` cannot see that case at all. Its main thread is
// installed before the first render and its wire is synchronous, so every commit
// it sends was composed after the handshake.
//
// This runner drives the same app, the same chassis, and the same counters
// through two arms that differ in exactly one thing:
//
//   before-render   the main thread exists when the background first renders,
//                   which is what `run.mjs` measures.
//   after-render    the background renders first and the main thread arrives
//                   after, which is the order a production Lynx bundle starts
//                   in — the background bundle does not wait for the main
//                   thread to reply before composing its first batch.
//
// Both arms mount with the table already populated (`__BENCH_AUTOROWS__`), so
// the first commit carries the rows rather than an empty shell. Everything
// reported is a count, deterministic for this app, so no quiet host is needed
// and no wall clock is measured.
//
//   node benchmarks/lynx-table/first-screen-selectors.mjs
//   node benchmarks/lynx-table/first-screen-selectors.mjs --scales 1000 --reps 1
//   pnpm bench:first-screen-selectors -- --out prototype/results/first-screen-selectors
process.env.NODE_ENV = 'production';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

import { octane } from '../../packages/octane/src/compiler/vite.js';
import { lynxRenderers } from '../../packages/lynx/src/config.runtime.js';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const LYNX_SOURCE = path.join(REPO, 'packages/lynx/src');
const OCTANE_SOURCE = path.join(REPO, 'packages/octane/src');

const { values: args } = parseArgs({
	options: {
		scales: { type: 'string', default: '1000,10000' },
		reps: { type: 'string', default: '2' },
		out: { type: 'string' },
	},
});

const SCALES = args.scales
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
const REPS = Number(args.reps);
if (!Number.isSafeInteger(REPS) || REPS <= 0)
	throw new TypeError('reps must be a positive integer.');

const ARMS = ['before-render', 'after-render'];
const scaleLabel = (rows) => (rows % 1000 === 0 ? `${rows / 1000}k` : String(rows));

/** Build the workload once per scale, because the row count is a build define. */
async function buildWorkload(rows, outDir) {
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
			__OCTANE_LYNX_PROFILE__: 'true',
			__BENCH_AUTOROWS__: JSON.stringify(rows),
		},
		build: {
			write: true,
			minify: false,
			target: 'node22',
			lib: {
				entry: path.join(ROOT, 'workload.ts'),
				formats: ['es'],
				fileName: 'workload',
			},
			outDir,
			emptyOutDir: false,
			rollupOptions: { external: [] },
		},
	});
	return import(pathToFileURL(path.join(outDir, 'workload.js')).href);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-first-screen-'));
let payload;

try {
	const failures = [];
	const cells = {};

	for (const rows of SCALES) {
		const outDir = path.join(tempDir, `rows-${rows}`);
		const workload = await buildWorkload(rows, outDir);
		for (const arm of ARMS) {
			let signature = null;
			let result = null;
			let drifted = false;
			for (let rep = 0; rep < REPS; rep++) {
				result = await workload.runFirstScreenSelectors(rows, arm);
				if (result.diagnostics.length !== 0) {
					failures.push(`rows=${rows} ${arm}: ${result.diagnostics.join(' | ')}`);
					break;
				}
				// Counts, so a difference between two runs of the same cell is a
				// defect in the harness or the runtime, not noise to average away.
				const next = JSON.stringify([
					result.createdSelectable,
					result.refSelectorInstalls,
					result.refSelectorClears,
					result.commands,
				]);
				if (signature === null) signature = next;
				else if (signature !== next) {
					failures.push(`rows=${rows} ${arm}: counts drifted across repetitions.`);
					drifted = true;
					break;
				}
			}
			if (result === null || result.diagnostics.length !== 0 || drifted) continue;

			// An install count means nothing if the arm did not paint the tree it
			// claims to have mounted.
			if (result.rowsPainted !== rows) {
				failures.push(`rows=${rows} ${arm}: painted ${result.rowsPainted} rows.`);
				continue;
			}

			cells[`${scaleLabel(rows)}/${arm}`] = {
				rows,
				arm,
				rowsPainted: result.rowsPainted,
				createdElements: result.createdElements,
				createdSelectable: result.createdSelectable,
				refSelectorInstalls: result.refSelectorInstalls,
				refSelectorClears: result.refSelectorClears,
				commits: result.commits,
				commands: result.commands,
				wireRegime: result.wireRegime,
			};
			const announced = Object.entries(result.wireRegime.commitAnnouncements)
				.map(([key, count]) => `${key}=${count}`)
				.join(',');
			console.log(
				`rows=${String(rows).padStart(5)} ${arm.padEnd(13)} ` +
					`installs=${String(result.refSelectorInstalls).padStart(6)}/${result.createdSelectable} ` +
					`commits=${result.commits} announces=${announced}`,
			);
		}
	}

	payload = {
		suite: 'lynx-table-first-screen-selectors',
		reps: REPS,
		host: {
			cpus: `${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}`,
			node: process.version,
		},
		cells,
		...(failures.length === 0 ? null : { failed: failures.join(' | ') }),
	};

	if (failures.length !== 0) {
		console.error(failures.join('\n'));
		process.exitCode = 1;
	}
} catch (error) {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	payload = { suite: 'lynx-table-first-screen-selectors', cells: {}, failed: message };
	console.error(message);
	process.exitCode = 1;
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}

function markdown(record) {
	const lines = [];
	lines.push('# Octane on Lynx — what a first screen costs in `nodes-ref` selectors');
	lines.push('');
	lines.push(
		'Counts, not milliseconds. Both arms run the same app, the same chassis, and',
		'the same counters, and differ in one thing: whether the main thread exists',
		'when the background first renders.',
		'',
		'- **before-render** — the handshake completes before the first commit is',
		'  composed. This is the order `run.mjs` measures.',
		'- **after-render** — the background composes its first batch before the',
		'  main-ready reply reaches it, which is the order a production Lynx bundle',
		'  starts in.',
		'',
		'`installs` is `nodes-ref` selector writes at the Element PAPI;',
		'`selectable` is the element nodes mounted, which is what an eager main',
		'thread would write one selector for each of. `announces` is the per-commit',
		'promise that the batch names every host it will query — only a commit that',
		'makes it may have its hosts skipped.',
		'',
	);
	lines.push(`- reps: ${record.reps} (counts must be identical across them)`);
	lines.push(`- host: ${record.host.cpus}, node ${record.host.node}`);
	lines.push('');
	lines.push('| rows | arm | selectable | installs | commits | announcement regime |');
	lines.push('| ---: | --- | ---: | ---: | ---: | --- |');
	for (const cell of Object.values(record.cells)) {
		const announced = Object.entries(cell.wireRegime.commitAnnouncements)
			.map(([key, count]) => `\`${key}\` ×${count}`)
			.join(', ');
		lines.push(
			`| ${cell.rows.toLocaleString('en-US')} | ${cell.arm} | ` +
				`${cell.createdSelectable.toLocaleString('en-US')} | ` +
				`${cell.refSelectorInstalls.toLocaleString('en-US')} | ${cell.commits} | ${announced} |`,
		);
	}
	lines.push('');
	if (record.failed !== undefined) {
		lines.push(`**Failed:** ${record.failed}`);
		lines.push('');
	}
	return lines.join('\n') + '\n';
}

if (args.out !== undefined) {
	const base = path.resolve(ROOT, args.out.replace(/\.(json|md)$/, ''));
	fs.mkdirSync(path.dirname(base), { recursive: true });
	fs.writeFileSync(`${base}.json`, JSON.stringify(payload, null, '\t') + '\n');
	if (payload.failed === undefined) fs.writeFileSync(`${base}.md`, markdown(payload));
	console.log(`wrote ${path.relative(REPO, base)}.{json,md}`);
}

// The app module opens a MessageChannel for its storm ticks, which would keep
// this process alive after the measurement completes.
process.exit(process.exitCode ?? 0);
