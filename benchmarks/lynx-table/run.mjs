// Deterministic wire-cost benchmark for the Octane Lynx table app.
//
// Builds the cross-framework table app (./app) plus the real dual-thread Lynx
// path with the Octane compiler, runs create/update10th/select and the two
// storms through real tap tokens in-process, and reports the per-operation
// COMMAND COUNT and SERIALIZED COMMIT BYTES from the build-flag-gated
// `__OCTANE_LYNX_PROFILE__` counters. Those are deterministic for a fixed app
// and interaction sequence, so they carry the regression gates; wall-clock
// belongs to the Lynx-for-Web harness (web/run-web.mjs), which is
// informational. The `changed-rows-model` target is the semantic floor: the
// commands a change of that size strictly implies. Ratios of octane-lynx over
// that model are the "wire cost is proportional to change size, not tree
// size" claim in gateable form.
process.env.NODE_ENV = 'production';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

import { octane } from '../../packages/octane/src/compiler/vite.js';
import { lynxRenderers } from '../../packages/lynx/src/config.runtime.js';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const rawIterations = process.argv[2] ?? '2';
const iterations = Number(rawIterations);

if (!Number.isSafeInteger(iterations) || iterations <= 0) {
	throw new TypeError(`iterations must be a positive safe integer, received ${rawIterations}.`);
}

const SCALES = (process.env.LYNX_TABLE_SCALES ?? '1000,10000')
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
const SWAP_COMMAND_WATERLINE = 997;

const LYNX_SOURCE = path.join(REPO, 'packages/lynx/src');
const OCTANE_SOURCE = path.join(REPO, 'packages/octane/src');

function countStat(value, samples) {
	return {
		score: value,
		median: value,
		min: value,
		mean: value,
		p95: value,
		sd: 0,
		rme: 0,
		warmupRatio: 1,
		samples,
	};
}

const scaleLabel = (rows) => (rows % 1000 === 0 ? `${rows / 1000}k` : String(rows));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lynx-table-'));
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
				entry: path.join(ROOT, 'workload.ts'),
				formats: ['es'],
				fileName: 'workload',
			},
			outDir: tempDir,
			emptyOutDir: false,
			rollupOptions: { external: [] },
		},
	});

	const workload = await import(pathToFileURL(path.join(tempDir, 'workload.js')).href);

	const failures = [];
	const octaneOps = {};
	const modelOps = {};
	const meta = {};

	for (const rows of SCALES) {
		const suffix = scaleLabel(rows);
		// The label text is randomized (krausest semantics), so only counts that
		// cannot depend on label bytes are asserted identical across iterations.
		let signature = null;
		let result = null;
		for (let iteration = 0; iteration < iterations; iteration++) {
			result = await workload.runTable(rows);
			if (result.diagnostics.length !== 0) {
				failures.push(`rows=${rows}: ${result.diagnostics.join(' | ')}`);
				break;
			}
			const nextSignature = JSON.stringify({
				create: [result.create.commands, result.create.itemRenders],
				update10th: [result.update10th.commands, result.update10th.itemRenders],
				select: [result.select.commands, result.select.bytes, result.select.itemRenders],
				swap: [result.swap.commands, result.swap.itemRenders],
				updateStorm: [result.updateStorm.commits, result.updateStorm.commands],
				selectStorm: [result.selectStorm.commits, result.selectStorm.commands],
			});
			if (signature === null) signature = nextSignature;
			else if (signature !== nextSignature) {
				failures.push(
					`rows=${rows}: command counters drifted across iterations (${signature} vs ${nextSignature}).`,
				);
				break;
			}
		}
		if (result === null || result.diagnostics.length !== 0) continue;

		octaneOps[`create_commands_${suffix}`] = countStat(result.create.commands, iterations);
		octaneOps[`update10th_commands_${suffix}`] = countStat(result.update10th.commands, iterations);
		octaneOps[`update10th_item_renders_${suffix}`] = countStat(
			result.update10th.itemRenders,
			iterations,
		);
		octaneOps[`select_commands_${suffix}`] = countStat(result.select.commands, iterations);
		octaneOps[`select_bytes_${suffix}`] = countStat(result.select.bytes, iterations);
		octaneOps[`select_item_renders_${suffix}`] = countStat(result.select.itemRenders, iterations);
		octaneOps[`swap_commands_${suffix}`] = countStat(result.swap.commands, iterations);
		octaneOps[`swap_item_renders_${suffix}`] = countStat(result.swap.itemRenders, iterations);
		octaneOps[`update_storm_commits_${suffix}`] = countStat(result.updateStorm.commits, iterations);
		octaneOps[`update_storm_commands_${suffix}`] = countStat(
			result.updateStorm.commands,
			iterations,
		);
		octaneOps[`select_storm_commits_${suffix}`] = countStat(result.selectStorm.commits, iterations);
		octaneOps[`select_storm_commands_${suffix}`] = countStat(
			result.selectStorm.commands,
			iterations,
		);

		// Semantic floor: the wire a change of this size strictly implies.
		// select moves one .danger class between two rows (2 updates). update10th
		// rewrites ceil(rows/10) labels (1 text update each). A storm's floor is
		// one commit per tick in this synchronous harness — ticks arrive in their
		// own macrotasks, so nothing can legitimately merge them here — times the
		// per-tick change. select_bytes uses the absolute 2 KiB acceptance budget
		// for a point-update commit rather than a modeled byte count.
		// Render-breadth floors: an update renders exactly the rows whose props
		// changed (update10th rewrites ceil(rows/10) row objects, select moves
		// `isSelected` between 2 rows), and a pure reorder renders none. The swap
		// command model pins today's known 997-command LIS-reorder waterline; it
		// is an upper bound, not a claim that the command set is minimal.
		const changed = Math.ceil(rows / 10);
		modelOps[`create_commands_${suffix}`] = countStat(result.create.commands, iterations);
		modelOps[`update10th_commands_${suffix}`] = countStat(changed, iterations);
		modelOps[`update10th_item_renders_${suffix}`] = countStat(changed, iterations);
		modelOps[`select_commands_${suffix}`] = countStat(2, iterations);
		modelOps[`select_bytes_${suffix}`] = countStat(2048, iterations);
		modelOps[`select_item_renders_${suffix}`] = countStat(2, iterations);
		modelOps[`swap_commands_${suffix}`] = countStat(SWAP_COMMAND_WATERLINE, iterations);
		modelOps[`swap_item_renders_${suffix}`] = countStat(1, iterations);
		modelOps[`update_storm_commits_${suffix}`] = countStat(workload.STORM_UPDATE_TICKS, iterations);
		modelOps[`update_storm_commands_${suffix}`] = countStat(
			workload.STORM_UPDATE_TICKS * changed,
			iterations,
		);
		modelOps[`select_storm_commits_${suffix}`] = countStat(workload.STORM_SELECT_TICKS, iterations);
		modelOps[`select_storm_commands_${suffix}`] = countStat(
			workload.STORM_SELECT_TICKS * 2,
			iterations,
		);

		meta[`rows_${suffix}`] = {
			rows,
			createdElements: result.createdElements,
			createBytes: result.create.bytes,
			update10thBytes: result.update10th.bytes,
			updateStormBytes: result.updateStorm.bytes,
			selectStormBytes: result.selectStorm.bytes,
		};

		console.log(
			`rows=${String(rows).padStart(5)}  create=${result.create.commands}  ` +
				`update10th=${result.update10th.commands} (${result.update10th.itemRenders}r)  ` +
				`select=${result.select.commands} (${result.select.bytes}B, ${result.select.itemRenders}r)  ` +
				`swap=${result.swap.commands} (${result.swap.itemRenders}r)  ` +
				`updateStorm=${result.updateStorm.commits}c/${result.updateStorm.commands}  ` +
				`selectStorm=${result.selectStorm.commits}c/${result.selectStorm.commands}`,
		);
	}

	// Frame-paced storm: an injected main-thread frame source holds commits to
	// one per frame, and the app posts ticks faster than frames, so ticks fold.
	// The gate compares commits against a frames-elapsed floor rather than the
	// one-commit-per-tick floor the unpaced synchronous harness pins.
	const PACED_ROWS = 1000;
	if (failures.length === 0 && SCALES.includes(PACED_ROWS)) {
		const suffix = scaleLabel(PACED_ROWS);
		let signature = null;
		let paced = null;
		for (let iteration = 0; iteration < iterations; iteration++) {
			paced = await workload.runPacedUpdateStorm(PACED_ROWS);
			if (paced.diagnostics.length !== 0) {
				failures.push(`paced rows=${PACED_ROWS}: ${paced.diagnostics.join(' | ')}`);
				break;
			}
			const nextSignature = JSON.stringify([
				paced.updateStorm.commits,
				paced.updateStormPacedCommits,
				paced.updateStorm.commands,
				paced.framesPumped,
			]);
			if (signature === null) signature = nextSignature;
			else if (signature !== nextSignature) {
				failures.push(
					`paced rows=${PACED_ROWS}: paced storm counters drifted across iterations (${signature} vs ${nextSignature}).`,
				);
				break;
			}
		}
		if (paced !== null && paced.diagnostics.length === 0 && failures.length === 0) {
			octaneOps[`update_storm_paced_commits_${suffix}`] = countStat(
				paced.updateStorm.commits,
				iterations,
			);
			octaneOps[`update_storm_paced_frame_commits_${suffix}`] = countStat(
				paced.updateStormPacedCommits,
				iterations,
			);
			octaneOps[`update_storm_paced_commands_${suffix}`] = countStat(
				paced.updateStorm.commands,
				iterations,
			);
			// Total commits may not exceed one per scheduled flush (the unpaced
			// per-tick ceiling); frame-consuming commits may not exceed the frames
			// the driver actually pumped during the measured storm;
			// commands are gated against the single-final-commit floor: the storm
			// touches ceil(rows/10) unique rows, so that is the minimum wire to
			// reach the final state.
			modelOps[`update_storm_paced_commits_${suffix}`] = countStat(
				workload.STORM_UPDATE_TICKS,
				iterations,
			);
			modelOps[`update_storm_paced_frame_commits_${suffix}`] = countStat(
				paced.framesPumped,
				iterations,
			);
			modelOps[`update_storm_paced_commands_${suffix}`] = countStat(
				Math.ceil(PACED_ROWS / 10),
				iterations,
			);
			meta[`paced_${suffix}`] = {
				rows: PACED_ROWS,
				framesPumped: paced.framesPumped,
				updateStormBytes: paced.updateStorm.bytes,
			};
			console.log(
				`paced rows=${String(PACED_ROWS).padStart(5)}  ` +
					`updateStorm=${paced.updateStorm.commits}c/${paced.updateStorm.commands}  ` +
					`framed=${paced.updateStormPacedCommits}  frames=${paced.framesPumped}`,
			);
		}
	}

	payload = {
		suite: 'lynx-table',
		iterations,
		targets: [
			{ name: 'octane-lynx', ops: octaneOps, meta },
			{ name: 'changed-rows-model', ops: modelOps, meta: {} },
		],
		...(failures.length === 0 ? null : { failed: failures.join(' | ') }),
	};

	if (failures.length !== 0) {
		console.error(failures.join('\n'));
		process.exitCode = 1;
	}
} catch (error) {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	payload = { suite: 'lynx-table', iterations, targets: [], failed: message };
	console.error(message);
	process.exitCode = 1;
} finally {
	if (!process.env.LYNX_BENCH_KEEP_BUNDLE) fs.rmSync(tempDir, { recursive: true, force: true });
	else console.log(`bundle: ${path.join(tempDir, 'workload.js')}`);
}

if (process.env.BENCH_JSON) {
	fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(payload, null, '\t') + '\n');
}

// The app module opens a MessageChannel for its storm ticks, which would keep
// this process alive after the measurement completes.
process.exit(process.exitCode ?? 0);
