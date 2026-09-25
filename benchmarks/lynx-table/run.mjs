// Deterministic wire-cost benchmark for the Octane Lynx table app.
//
// Builds the cross-framework table app (./app) plus the real dual-thread Lynx
// path with the Octane compiler, runs create/update10th/select and the two
// storms through real tap tokens in-process, and reports the per-operation
// COMMAND COUNT, SERIALIZED COMMIT BYTES, and ROW BODY RENDERS from the
// build-flag-gated `__OCTANE_LYNX_PROFILE__` counters. Those are deterministic
// for a fixed app and interaction sequence, so they carry the regression
// gates; wall-clock belongs to the Lynx-for-Web harness (web/run-web.mjs), which is
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

import { compile } from '../../packages/octane/src/compiler/compile.js';
import { octane } from '../../packages/octane/src/compiler/vite.js';
import { lynxMainThreadRenderer, lynxRenderers } from '../../packages/lynx/src/config.runtime.js';

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
	// Dirty-computation generation is intentionally disabled in profile builds,
	// while the table's row counters require that profile mode. Build the small
	// owner-count control once more without profiling so observing it from the
	// external wrapper does not change the compiler path under measurement. The
	// direct Vite plugin has no paired main/background build controller, so make
	// that one compiler pair explicitly and alias only this fixture to it.
	await build({
		configFile: false,
		root: REPO,
		logLevel: 'silent',
		build: {
			write: true,
			minify: false,
			target: 'node22',
			lib: {
				entry: path.join(LYNX_SOURCE, 'compiler/index.ts'),
				formats: ['es'],
				fileName: 'compiler-backend',
			},
			outDir: tempDir,
			emptyOutDir: false,
		},
	});
	const lynxCompilerBackend = await import(
		pathToFileURL(path.join(tempDir, 'compiler-backend.js')).href
	);
	const branchSourcePath = path.join(ROOT, 'app/src/BranchReplay.lynx.tsrx');
	const branchSource = fs.readFileSync(branchSourcePath, 'utf8');
	const branchModule = 'benchmarks/lynx-table/app/src/BranchReplay.lynx.tsrx';
	const compileBranch = (thread) =>
		compile(branchSource, branchSourcePath, {
			hmr: false,
			profile: false,
			renderer: {
				...lynxMainThreadRenderer,
				target: thread === 'main-thread' ? 'lynx' : 'universal',
				id: 'lynx',
				...(thread === 'background'
					? {
							module: '@octanejs/lynx/renderer',
							capabilities: [...lynxMainThreadRenderer.capabilities, 'compiler-program-ir'],
						}
					: null),
			},
			universalRuntime: { runtime: 'lynx', thread },
			mainThreadProgramBackend: lynxCompilerBackend,
			programModuleId: branchModule,
		}).code;
	const branchBackgroundPath = path.join(tempDir, 'BranchReplay.background.js');
	const branchMainPath = path.join(tempDir, 'BranchReplay.main.js');
	const branchEntryPath = path.join(tempDir, 'BranchReplay.js');
	fs.writeFileSync(branchBackgroundPath, compileBranch('background'));
	fs.writeFileSync(branchMainPath, compileBranch('main-thread'));
	fs.writeFileSync(
		branchEntryPath,
		`import './BranchReplay.main.js';\nexport { BranchReplay } from './BranchReplay.background.js';\n`,
	);
	await build({
		configFile: false,
		root: REPO,
		logLevel: 'silent',
		resolve: {
			alias: [
				{ find: './app/src/BranchReplay.lynx.tsrx', replacement: branchEntryPath },
				{
					find: './core/background-core-selection.js',
					replacement: path.join(LYNX_SOURCE, 'core/background-core-selection.block.ts'),
				},
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
			__OCTANE_LYNX_PROFILE__: 'false',
			__BENCH_AUTOROWS__: '0',
		},
		build: {
			write: true,
			minify: false,
			target: 'node22',
			lib: {
				entry: path.join(ROOT, 'workload.ts'),
				formats: ['es'],
				fileName: 'branch-workload',
			},
			outDir: tempDir,
			emptyOutDir: false,
			rollupOptions: { external: [] },
		},
	});

	const workload = await import(pathToFileURL(path.join(tempDir, 'workload.js')).href);
	const branchWorkload = await import(pathToFileURL(path.join(tempDir, 'branch-workload.js')).href);

	const failures = [];
	const octaneOps = {};
	const modelOps = {};
	// A second reference: not a floor but the ceiling the main thread used to
	// pay, one `nodes-ref` write per element node mounted whether or not anything
	// could ever query it.
	const eagerSelectorOps = {};
	const meta = {};
	let branchReplay = null;
	let branchSignature = null;
	for (let iteration = 0; iteration < iterations; iteration++) {
		branchReplay = await branchWorkload.runBranchReplay();
		const nextSignature = JSON.stringify(branchReplay);
		if (branchSignature === null) branchSignature = nextSignature;
		else if (branchSignature !== nextSignature) {
			failures.push(
				`branch replay counters drifted across iterations (${branchSignature} vs ${nextSignature}).`,
			);
			break;
		}
	}
	if (branchReplay !== null) {
		if (branchReplay.diagnostics.length !== 0) {
			failures.push(`branch replay: ${branchReplay.diagnostics.join(' | ')}`);
		}
		if (branchReplay.ownerRenders !== 1) {
			failures.push(
				`branch replay entered its owning component ${branchReplay.ownerRenders} times; expected one mount.`,
			);
		}
		octaneOps.branch_owner_renders = countStat(branchReplay.ownerRenders, iterations);
		modelOps.branch_owner_renders = countStat(1, iterations);
		meta.branchReplay = branchReplay;
		console.log(
			`branch-replay=${branchReplay.ownerRenders} owner render (${branchReplay.states.join(' -> ')}; ${branchReplay.linkedStates.join(' -> ')})`,
		);
	}

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
				create: [
					result.create.commands,
					result.create.itemRenders,
					result.create.refSelectorInstalls,
					result.create.createdSelectable,
					result.create.programRunOwnedHosts,
					result.create.programRunRetainedHostRefs,
					result.create.programRunReleasedHostRefs,
					result.create.programRunLiveRetainedHostRefs,
				],
				update10th: [result.update10th.commands, result.update10th.itemRenders],
				select: [result.select.commands, result.select.bytes, result.select.itemRenders],
				swap: {
					commands: result.swap.commands,
					itemRenders: result.swap.itemRenders,
					wireToMainBytes: result.swap.wireToMainBytes,
					wireToBackgroundBytes: result.swap.wireToBackgroundBytes,
					wireToMainMessages: result.swap.wireToMainMessages,
					wireToBackgroundMessages: result.swap.wireToBackgroundMessages,
					commandOps: result.swap.commandOps,
					handleOps: result.swap.handleOps,
					messageTypes: result.swap.messageTypes,
					counts: {
						synthesizedCommands: result.swap.synthesizedCommands,
						eventDetachCount: result.swap.eventDetachCount,
						papiRemoveCount: result.swap.papiRemoveCount,
						denseReleaseHostCount: result.swap.denseReleaseHostCount,
					},
					identityChecksum: result.swapIdentityChecksum,
					eventSurvived: result.swapEventSurvived,
				},
				updateStorm: [
					result.updateStorm.commits,
					result.updateStorm.commands,
					result.updateStorm.itemRenders,
				],
				selectStorm: [
					result.selectStorm.commits,
					result.selectStorm.commands,
					result.selectStorm.itemRenders,
				],
				clearLiveRetainedHostRefs: result.clear.programRunLiveRetainedHostRefs,
				recreateRetention: [
					result.recreate.programRunOwnedHosts,
					result.recreate.programRunRetainedHostRefs,
					result.recreate.programRunReleasedHostRefs,
					result.recreate.programRunLiveRetainedHostRefs,
				],
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
		if (result.swap.itemRenders !== 0) {
			failures.push(`rows=${rows}: swap re-rendered ${result.swap.itemRenders} unchanged rows.`);
		}
		if (!result.swapEventSurvived) {
			failures.push(`rows=${rows}: a moved survivor lost its delegated event.`);
		}

		octaneOps[`create_commands_${suffix}`] = countStat(result.create.commands, iterations);
		octaneOps[`create_ref_installs_${suffix}`] = countStat(
			result.create.refSelectorInstalls,
			iterations,
		);
		octaneOps[`clear_commands_${suffix}`] = countStat(result.clear.commands, iterations);
		octaneOps[`recreate_commands_${suffix}`] = countStat(result.recreate.commands, iterations);
		octaneOps[`update10th_commands_${suffix}`] = countStat(result.update10th.commands, iterations);
		octaneOps[`update10th_item_renders_${suffix}`] = countStat(
			result.update10th.itemRenders,
			iterations,
		);
		octaneOps[`select_commands_${suffix}`] = countStat(result.select.commands, iterations);
		octaneOps[`select_bytes_${suffix}`] = countStat(result.select.bytes, iterations);
		octaneOps[`select_item_renders_${suffix}`] = countStat(result.select.itemRenders, iterations);
		octaneOps[`swap_wire_bytes_${suffix}`] = countStat(
			result.swap.wireToMainBytes + result.swap.wireToBackgroundBytes,
			iterations,
		);
		octaneOps[`swap_wire_to_main_bytes_${suffix}`] = countStat(
			result.swap.wireToMainBytes,
			iterations,
		);
		octaneOps[`swap_wire_to_background_bytes_${suffix}`] = countStat(
			result.swap.wireToBackgroundBytes,
			iterations,
		);
		octaneOps[`swap_item_renders_${suffix}`] = countStat(result.swap.itemRenders, iterations);
		octaneOps[`swap_handle_deltas_${suffix}`] = countStat(
			Object.values(result.swap.handleOps).reduce((total, count) => total + count, 0),
			iterations,
		);
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
		for (const [name, counters] of Object.entries({
			create: result.create,
			update10th: result.update10th,
			select: result.select,
			swap: result.swap,
			updateStorm: result.updateStorm,
			selectStorm: result.selectStorm,
			clear: result.clear,
			recreate: result.recreate,
		})) {
			meta[`delta_${name}_${suffix}`] = {
				commits: counters.deltaCommits,
				misses: counters.deltaMisses,
				ops: counters.deltaOps,
				bytes: counters.deltaBytes,
			};
		}

		// Semantic floor: the wire a change of this size strictly implies.
		// Creating component-owned rows reuses one shared intrinsic-template
		// program, so the entire contiguous insertion is one host command.
		// select moves one .danger class between two rows (2 updates). update10th
		// rewrites ceil(rows/10) labels (1 text update each). A storm's floor is
		// one commit per tick in this synchronous harness — ticks arrive in their
		// own macrotasks, so nothing can legitimately merge them here — times the
		// per-tick change. select_bytes uses the absolute 2 KiB acceptance budget
		// for a point-update commit rather than a modeled byte count. The row
		// render floors count only components whose observable props changed.
		const changed = Math.ceil(rows / 10);
		modelOps[`create_commands_${suffix}`] = countStat(1, iterations);
		// Retiring a whole template run names the run, not its rows, and mounting
		// the replacement is the same single command the first create was: neither
		// may start scaling with the table because the container is no longer
		// virgin.
		modelOps[`clear_commands_${suffix}`] = countStat(1, iterations);
		modelOps[`recreate_commands_${suffix}`] = countStat(1, iterations);
		modelOps[`update10th_commands_${suffix}`] = countStat(changed, iterations);
		modelOps[`update10th_item_renders_${suffix}`] = countStat(changed, iterations);
		modelOps[`select_commands_${suffix}`] = countStat(2, iterations);
		modelOps[`select_bytes_${suffix}`] = countStat(2048, iterations);
		modelOps[`select_item_renders_${suffix}`] = countStat(2, iterations);
		modelOps[`swap_wire_bytes_${suffix}`] = countStat(2048, iterations);
		modelOps[`swap_wire_to_main_bytes_${suffix}`] = countStat(1024, iterations);
		modelOps[`swap_wire_to_background_bytes_${suffix}`] = countStat(1024, iterations);
		modelOps[`swap_item_renders_${suffix}`] = countStat(1, iterations);
		modelOps[`swap_handle_deltas_${suffix}`] = countStat(2, iterations);
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

		// One `nodes-ref` write per element node the create mounts: what the main
		// thread costs if it stamps every node whether or not anything can query
		// it. Guarded separately because it is a ceiling, not a semantic floor.
		eagerSelectorOps[`create_ref_installs_${suffix}`] = countStat(
			result.create.createdSelectable,
			iterations,
		);

		meta[`rows_${suffix}`] = {
			rows,
			createdElements: result.createdElements,
			wireRegime: result.wireRegime,
			createRefInstalls: result.create.refSelectorInstalls,
			createSelectableElements: result.create.createdSelectable,
			createAnnouncedPublicInstances: result.create.commandOps['ensure-public-instance'] ?? 0,
			createBytes: result.create.bytes,
			createItemRenders: result.create.itemRenders,
			programRunRetention: {
				create: {
					ownedHosts: result.create.programRunOwnedHosts,
					retainedHostRefs: result.create.programRunRetainedHostRefs,
					releasedHostRefs: result.create.programRunReleasedHostRefs,
					liveRetainedHostRefs: result.create.programRunLiveRetainedHostRefs,
				},
				clearLiveRetainedHostRefs: result.clear.programRunLiveRetainedHostRefs,
				recreate: {
					ownedHosts: result.recreate.programRunOwnedHosts,
					retainedHostRefs: result.recreate.programRunRetainedHostRefs,
					releasedHostRefs: result.recreate.programRunReleasedHostRefs,
					liveRetainedHostRefs: result.recreate.programRunLiveRetainedHostRefs,
				},
			},
			update10thBytes: result.update10th.bytes,
			updateStormBytes: result.updateStorm.bytes,
			updateStormItemRenders: result.updateStorm.itemRenders,
			selectStormBytes: result.selectStorm.bytes,
			selectStormItemRenders: result.selectStorm.itemRenders,
			ackPipeline: Object.fromEntries(
				Object.entries({
					create: result.create,
					update10th: result.update10th,
					select: result.select,
					swap: result.swap,
					updateStorm: result.updateStorm,
					selectStorm: result.selectStorm,
					clear: result.clear,
					recreate: result.recreate,
				}).map(([name, counters]) => [
					name,
					{
						queueMaxDepth: counters.blockRenderQueueMaxDepth,
						merges: counters.blockRenderMerges,
						preparations: counters.blockRenderPrepares,
						preparationsWhileAck: counters.blockRenderPreparesWhileAck,
						roundTrips: counters.blockAckRoundTrips,
						messagesToMain: counters.wireToMainMessages,
						messagesToBackground: counters.wireToBackgroundMessages,
					},
				]),
			),
			swap: {
				commands: result.swap.commands,
				commandOps: result.swap.commandOps,
				handleOps: result.swap.handleOps,
				messageTypes: result.swap.messageTypes,
				wireToMainMessages: result.swap.wireToMainMessages,
				wireToBackgroundMessages: result.swap.wireToBackgroundMessages,
				identityChecksum: result.swapIdentityChecksum,
				eventSurvived: result.swapEventSurvived,
				stagesMs: {
					selfcheck: result.swap.selfcheckMs,
					dispatch: result.swap.dispatchMs,
					validate: result.swap.validateMs,
					prepare: result.swap.prepareMs,
					apply: result.swap.applyMs,
					ack: result.swap.ackMs,
					destroyRunExpand: result.swap.destroyRunExpandMs,
					denseValidate: result.swap.denseValidateMs,
					eventDetach: result.swap.eventDetachMs,
					papiRemove: result.swap.papiRemoveMs,
					denseRelease: result.swap.denseReleaseMs,
				},
				counts: {
					synthesizedCommands: result.swap.synthesizedCommands,
					eventDetachCount: result.swap.eventDetachCount,
					papiRemoveCount: result.swap.papiRemoveCount,
					denseReleaseHostCount: result.swap.denseReleaseHostCount,
				},
			},
			// What the second create/teardown cycle costs the main thread, which
			// the command counts above cannot show: the wire stays at one command
			// either way, and the whole difference is how much of that command the
			// receiver has to expand back into per-host work.
			//
			// `clear.synthesizedCommands` is the number to read. A certified
			// teardown consumes the `destroy-run` whole and synthesizes none; the
			// expansion fallback rebuilds one remove, one destroy and one listener
			// detach per host from accepted state, and the count is that
			// expansion. `denseValidate` distinguishes the two: the certified path
			// times its validation there, so zero means it was never attempted.
			warmCycle: {
				clear: {
					commands: result.clear.commands,
					bytes: result.clear.bytes,
					synthesizedCommands: result.clear.synthesizedCommands,
					papiRemoveCount: result.clear.papiRemoveCount,
					denseReleaseHostCount: result.clear.denseReleaseHostCount,
					liveRetainedHostRefs: result.clear.programRunLiveRetainedHostRefs,
					stagesMs: {
						prepare: result.clear.prepareMs,
						apply: result.clear.applyMs,
						destroyRunExpand: result.clear.destroyRunExpandMs,
						denseValidate: result.clear.denseValidateMs,
					},
				},
				recreate: {
					commands: result.recreate.commands,
					bytes: result.recreate.bytes,
					createdElements: result.recreate.createdElements,
					itemRenders: result.recreate.itemRenders,
					refSelectorInstalls: result.recreate.refSelectorInstalls,
					ownedHosts: result.recreate.programRunOwnedHosts,
					retainedHostRefs: result.recreate.programRunRetainedHostRefs,
					releasedHostRefs: result.recreate.programRunReleasedHostRefs,
					liveRetainedHostRefs: result.recreate.programRunLiveRetainedHostRefs,
					stagesMs: {
						prepare: result.recreate.prepareMs,
						apply: result.recreate.applyMs,
					},
				},
				// The same op on a virgin container, for the comparison the pair
				// exists to make.
				createStagesMs: {
					prepare: result.create.prepareMs,
					apply: result.create.applyMs,
				},
			},
		};

		console.log(
			`rows=${String(rows).padStart(5)}  create=${result.create.commands} (${result.create.itemRenders}r, ` +
				`${result.create.refSelectorInstalls}/${result.create.createdSelectable} refs)  ` +
				`update10th=${result.update10th.commands} (${result.update10th.itemRenders}r)  ` +
				`select=${result.select.commands} (${result.select.bytes}B, ${result.select.itemRenders}r)  ` +
				`swap=${result.swap.commands} (${result.swap.wireToMainBytes + result.swap.wireToBackgroundBytes}B, ${result.swap.itemRenders}r)  ` +
				`updateStorm=${result.updateStorm.commits}c/${result.updateStorm.commands} (${result.updateStorm.itemRenders}r)  ` +
				`selectStorm=${result.selectStorm.commits}c/${result.selectStorm.commands} (${result.selectStorm.itemRenders}r)  ` +
				`clear=${result.clear.commands} (+${result.clear.synthesizedCommands} synth)  ` +
				`recreate=${result.recreate.commands} (${result.recreate.itemRenders}r)`,
		);
	}

	payload = {
		suite: 'lynx-table',
		iterations,
		targets: [
			{ name: 'octane-lynx', ops: octaneOps, meta },
			{ name: 'changed-rows-model', ops: modelOps, meta: {} },
			{ name: 'eager-selector-model', ops: eagerSelectorOps, meta: {} },
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
