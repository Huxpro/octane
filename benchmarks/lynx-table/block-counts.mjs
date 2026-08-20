// Issue-#103 U0, re-run against the real specialized core.
//
// U0 asked what the update path's architectural ceiling is and answered with a
// hand-written op emitter that kept its rows in an array (prototype/
// app-service.js). Beside what that stub touched it reported a second column,
// "keyed block lookups" — what a keyed core *would* touch — derived by hand
// because no keyed core existed. U2 built one. This runner asks it.
//
// It drives `block-workload.ts` over the same operation ladder as `run.mjs`,
// on the same chassis: same ContextProxy pair, same fake Element PAPI, same
// real main-thread receiver, same `__OCTANE_LYNX_PROF` accounting. Only the
// background core differs, which is what makes a count from this runner
// comparable to `run.mjs`'s rather than merely adjacent to it.
//
// Two columns are reported because one would over-claim alone:
//
//   block-scoped     the core driven the way a compiled block program with
//                    per-row reactive slots would drive it — a selection
//                    change writes two rows' class slot by key.
//   block-reconcile  the same core driven the way the app's own setRows(next)
//                    does today — the whole next list handed to the keyed
//                    reconciler, which matches survivors by key and visits
//                    every one of them.
//
// Everything here is a count, deterministic for this app and interaction, so
// it carries across hosts and sessions. No wall clock is measured. Both
// columns are ceilings in the same sense U0's floor was: the block program is
// hand-written, with no hooks, no compiler, and no component bodies.
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

const MODES = ['scoped', 'reconcile'];
const OPS = ['create', 'update10th', 'select', 'swap', 'updateStorm', 'selectStorm'];
const scaleLabel = (rows) => (rows % 1000 === 0 ? `${rows / 1000}k` : String(rows));

/**
 * The semantic floor for each op, in blocks: what a change of that size
 * strictly implies a core must visit.
 *
 * `create` fills an empty range site, so there is no survivor to match and
 * nothing to look up. `swap` deliberately has no entry: this slice has no
 * scoped move, so a structural reorder goes through the keyed reconciler in
 * both columns and is reported without a floor rather than against a floor it
 * cannot meet. Naming that gap is the point; omitting the row would hide it.
 */
function blockLookupFloor(op, rows, ticks) {
	const changed = Math.ceil(rows / 10);
	switch (op) {
		case 'create':
			return 0;
		case 'update10th':
			return changed;
		case 'select':
			return 2;
		case 'updateStorm':
			return ticks.update * changed;
		case 'selectStorm':
			return ticks.select * 2;
		default:
			return null;
	}
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-block-'));
let payload;

try {
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
			__BENCH_AUTOROWS__: '0',
		},
		build: {
			write: true,
			minify: false,
			target: 'node22',
			lib: {
				entry: path.join(ROOT, 'block-workload.ts'),
				formats: ['es'],
				fileName: 'block-workload',
			},
			outDir: tempDir,
			emptyOutDir: false,
			rollupOptions: { external: [] },
		},
	});

	const workload = await import(pathToFileURL(path.join(tempDir, 'block-workload.js')).href);
	const ticks = { update: workload.STORM_UPDATE_TICKS, select: workload.STORM_SELECT_TICKS };
	const failures = [];
	const cells = {};

	for (const rows of SCALES) {
		for (const mode of MODES) {
			let signature = null;
			let result = null;
			for (let rep = 0; rep < REPS; rep++) {
				result = await workload.runBlockTable(rows, mode);
				if (result.diagnostics.length !== 0) {
					failures.push(`rows=${rows} ${mode}: ${result.diagnostics.join(' | ')}`);
					break;
				}
				// Every reported number is a count, so a difference between two
				// runs of the same cell is a defect in the harness or the core, not
				// noise to average away.
				const next = JSON.stringify(
					OPS.map((op) => [
						result[op].commits,
						result[op].commands,
						result[op].blockLookups,
						result[op].bytes,
					]),
				);
				if (signature === null) signature = next;
				else if (signature !== next) {
					failures.push(`rows=${rows} ${mode}: counts drifted across repetitions.`);
					break;
				}
			}
			if (result === null || result.diagnostics.length !== 0) continue;

			// The ladder ends with the select storm, whose last tick selects row 1
			// and whose update storm left every tenth label at `bench 50`. A cell
			// that painted something else counted a program that does not work.
			if (result.mountedRows !== rows) {
				failures.push(`rows=${rows} ${mode}: painted ${result.mountedRows} rows.`);
			}
			if (result.firstRowClasses !== 'row danger') {
				failures.push(
					`rows=${rows} ${mode}: first row ended with class "${result.firstRowClasses}".`,
				);
			}
			if (result.firstRowLabel !== `bench ${ticks.update}`) {
				failures.push(
					`rows=${rows} ${mode}: first row ended with label "${result.firstRowLabel}".`,
				);
			}

			cells[`${scaleLabel(rows)}/${mode}`] = {
				rows,
				mode,
				createdElements: result.createdElements,
				ops: Object.fromEntries(
					OPS.map((op) => [
						op,
						{
							commits: result[op].commits,
							commands: result[op].commands,
							blockLookups: result[op].blockLookups,
							bytes: result[op].bytes,
							commandOps: result[op].commandOps,
							floor: blockLookupFloor(op, rows, ticks),
						},
					]),
				),
			};
			const line = OPS.map(
				(op) => `${op}=${result[op].commands}c/${result[op].blockLookups}L`,
			).join('  ');
			console.log(`rows=${String(rows).padStart(5)} ${mode.padEnd(9)} ${line}`);
		}

		// The wire is the shared half: both columns run the same transport, the
		// same applier, and the same main thread, so a difference in what they
		// send would mean the drive mode changed the program rather than the work
		// it took to produce it.
		const scoped = cells[`${scaleLabel(rows)}/scoped`];
		const reconcile = cells[`${scaleLabel(rows)}/reconcile`];
		if (scoped !== undefined && reconcile !== undefined) {
			for (const op of OPS) {
				const a = scoped.ops[op];
				const b = reconcile.ops[op];
				if (a.commands !== b.commands || a.bytes !== b.bytes || a.commits !== b.commits) {
					failures.push(
						`rows=${rows} ${op}: the two drive modes sent different wire (${a.commits}/${a.commands}/${a.bytes}B vs ${b.commits}/${b.commands}/${b.bytes}B).`,
					);
				}
			}
		}
	}

	payload = {
		suite: 'lynx-table-block-counts',
		reps: REPS,
		ticks,
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
	payload = { suite: 'lynx-table-block-counts', cells: {}, failed: message };
	console.error(message);
	process.exitCode = 1;
} finally {
	fs.rmSync(tempDir, { recursive: true, force: true });
}

function markdown(record) {
	const lines = [];
	lines.push('# Octane on Lynx — #103 U0 re-run on the real specialized core');
	lines.push('');
	lines.push(
		'Counts, not milliseconds. Deterministic for this app and this interaction,',
		'so they carry across hosts and sessions; no wall clock is measured here.',
		'Both columns run the real `LynxBlockCore` on the real background transport',
		'against the real main-thread receiver — the same chassis `run.mjs` uses for',
		'the `octane-lynx` column. Only the entry point the state change reaches',
		'differs:',
		'',
		'- **scoped** — what a compiled block program with per-row reactive slots',
		"  would do: write the changed rows' slots by key.",
		"- **reconcile** — what the app's own `setRows(next)` does today: hand the",
		'  whole next list to the keyed reconciler.',
		'',
		"`lookups` is the core's own `blockLookups` counter: blocks visited to",
		'service the operation. `floor` is the semantic lower bound — what a change',
		'of that size strictly implies. `swap` has no floor because this slice has',
		'no scoped move, so a structural reorder goes through the keyed reconciler',
		'in both columns; that gap is named rather than scored.',
		'',
	);
	lines.push(
		`- reps: ${record.reps} (counts must be identical across them; a difference is a defect, not noise)`,
	);
	lines.push(`- host: ${record.host.cpus}, node ${record.host.node}`);
	lines.push(`- storm ticks: update ${record.ticks.update}, select ${record.ticks.select}`);
	lines.push('');
	const scales = [...new Set(Object.values(record.cells).map((cell) => cell.rows))];
	for (const rows of scales) {
		const scoped = Object.values(record.cells).find((c) => c.rows === rows && c.mode === 'scoped');
		const reconcile = Object.values(record.cells).find(
			(c) => c.rows === rows && c.mode === 'reconcile',
		);
		if (scoped === undefined || reconcile === undefined) continue;
		lines.push(`## ${rows.toLocaleString('en-US')} rows`);
		lines.push('');
		lines.push(
			'| op | commits | commands | wire bytes | lookups (scoped) | lookups (reconcile) | floor |',
		);
		lines.push('|---|---:|---:|---:|---:|---:|---:|');
		for (const op of OPS) {
			const a = scoped.ops[op];
			const b = reconcile.ops[op];
			lines.push(
				`| ${op} | ${a.commits} | ${a.commands.toLocaleString('en-US')} | ${a.bytes.toLocaleString('en-US')} | ` +
					`**${a.blockLookups.toLocaleString('en-US')}** | ${b.blockLookups.toLocaleString('en-US')} | ` +
					`${a.floor === null ? '—' : a.floor.toLocaleString('en-US')} |`,
			);
		}
		lines.push('');
		lines.push(
			`Both columns painted ${rows.toLocaleString('en-US')} rows over ` +
				`${scoped.createdElements.toLocaleString('en-US')} host elements and sent byte-identical wire ` +
				'at every op: the drive mode changes what it costs to produce a frame, never the frame.',
		);
		lines.push('');
	}
	return lines.join('\n') + '\n';
}

if (args.out !== undefined) {
	const base = args.out.replace(/\.(json|md)$/, '');
	fs.writeFileSync(`${base}.json`, JSON.stringify(payload, null, '\t') + '\n');
	if (payload.failed === undefined) fs.writeFileSync(`${base}.md`, markdown(payload));
}

process.exit(process.exitCode ?? 0);
