// What the main-thread script itself spends the first screen on.
//
//   node stages/mts-profile.mjs --rows 10000
//   node stages/mts-profile.mjs --rows 1000 --reps 3 --cells octane,octane-mts-program
//
// The Element PAPI boundary instrument (`stages/papi-run.mjs`) prices the first
// screen either side of the host boundary, and its phase split says which
// first-screen phase owns the part above it. Issue #163 needs one level finer:
// a compiled main-thread program issues the same host calls a hand-written
// emitter issues, for the same host time, and is still well short of it — so
// the cost is the framework's own script, and the question is which part.
//
// This samples that script directly. Chromium's CPU profiler runs over the page
// while a pre-populated bundle paints, and only frames belonging to the hidden
// main-thread realm's Blob script are folded: the page realm runs the harness's
// own predicate walker, which is measurement rather than framework. Frames are
// named by the string literals in the code, which the minifier cannot rename —
// see `stages/mts-profile-buckets.mjs` for the probe table.
//
// **The absolute milliseconds here are not the boundary instrument's.** A
// sampling profiler perturbs the page it measures, and this run has no
// uninstrumented control beside it. What this instrument reports is the shape:
// which framework function owns the script, and how the three cells compare on
// the same axis. Take wall clocks from `papi-run.mjs`.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import {
	applyMainRealmProbe,
	applyNeutralize,
	applyStageClock,
	chromiumLaunchOptions,
	makeBenchHtml,
	stats,
} from '../web/driver-client.mjs';
import { foldProfile, PROBE_WINDOW, SITES_BY_BUCKET } from './mts-profile-buckets.mjs';
import { tagFrom } from '../scripts/build-app.mjs';
import { bundleIdentity, writeEvidenceJson } from '../scripts/evidence.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '5' },
		cells: { type: 'string', default: 'octane,octane-mts-program,octane-direct' },
		label: { type: 'string', default: 'mts-profile' },
		port: { type: 'string', default: '8364' },
		interval: { type: 'string', default: '100' },
		'allow-busy-host': { type: 'boolean', default: false },
		// How long the window stays open past first paint waiting for the
		// first-tree lifecycle to end (issue #215 D7). It is a refusal deadline
		// rather than a duration to sample for: a run that reaches it reports the
		// window as truncated instead of reporting its buckets as complete.
		'adoption-timeout': { type: 'string', default: '60000' },
		// Issue-#163 C10: the same app and the same program backend, built from a
		// different revision of the renderer into a tagged dist, so an A/B of
		// main-thread script is one window rather than two runs compared across
		// hours. Mirrors `papi-run.mjs --control-dist`, including registering the
		// cell only when the flag names a tag: a run that built no control arm
		// gets no such cell instead of one pointing at a directory nothing wrote.
		// Nothing here says which revision it is, because the harness cannot know
		// and a name implying it could would be the harness lying about
		// provenance the record now carries honestly.
		//
		// Issue-#163 C11 widened it to a comma-separated list, because a ladder of
		// ablations is only a ladder when every rung ran in the same window: two
		// records of identical bundles disagree by up to 9% on the whole-script
		// median, which is larger than the rungs being separated, so arms compared
		// across windows are not compared at all. Each tag becomes its own cell,
		// named after the tag — a single arm used to be spelled
		// `octane-mts-program-control`, which is the cell name in C10's record.
		'control-dist': { type: 'string', default: '' },
	},
});
const rows = Number(args.rows);
const reps = Number(args.reps);
const port = Number(args.port);
const interval = Number(args.interval);
const adoptionTimeout = Number(args['adoption-timeout']);
const cellIds = args.cells.split(',').map((value) => value.trim());

const controlTags = args['control-dist']
	.split(',')
	.map((value) => value.trim())
	.filter((value) => value !== '');
// A repeated tag would quietly halve the ladder: two cells resolving to one
// directory read as two arms that agreed, which is the one answer an ablation
// must never be able to fake.
if (new Set(controlTags).size !== controlTags.length) {
	throw new Error(`--control-dist repeats a tag: ${args['control-dist']}`);
}
/**
 * Pre-populated bundles only: this instrument measures a first screen, never a
 * click.
 *
 * Each cell also says whether it was built with `OCTANE_LYNX_PROFILE=1`, which
 * decides one thing here: whether the adoption window can close on the
 * framework's own first-tree marker (issue #215 D7). A shipping-shaped build
 * folds `LYNX_PROFILE` to false and publishes no record at all, so on those
 * cells this instrument goes on measuring exactly the window it always did, and
 * the record says the adoption window was not reachable rather than showing an
 * empty bucket group as though adoption were free.
 *
 * A profile cell is a different build configuration — the same rule
 * `papi-run.mjs` states for its own profile cells — so its numbers apportion its
 * own window and are comparable only to another profile cell's. That is enough
 * for the A/B this exists to serve, which compares two revisions built the same
 * way, and it is not enough to compare a profile arm against a shipping one.
 */
const CELLS = {
	octane: { bundle: (n) => path.join(root, `app/dist-rows${n}/main.web.bundle`) },
	'octane-profile': {
		bundle: (n) => path.join(root, `app/dist-rows${n}-profile/main.web.bundle`),
		profile: true,
	},
	'octane-mts-program': {
		bundle: (n) => path.join(root, `app/dist-mtsprogram-rows${n}/main.web.bundle`),
	},
	'octane-mts-program-profile': {
		bundle: (n) => path.join(root, `app/dist-mtsprogram-rows${n}-profile/main.web.bundle`),
		profile: true,
	},
	...Object.fromEntries(
		controlTags.flatMap((tag) => [
			[
				`octane-mts-program-${tag}`,
				{
					// Validated by the writer of that directory name rather than
					// re-spelled here, so a value `build-app.mjs` would have refused
					// cannot name a path nothing built.
					bundle: (n) =>
						path.join(root, `app/dist-mtsprogram${tagFrom(tag)}-rows${n}/main.web.bundle`),
				},
			],
			[
				`octane-mts-program-${tag}-profile`,
				{
					bundle: (n) =>
						path.join(root, `app/dist-mtsprogram${tagFrom(tag)}-rows${n}-profile/main.web.bundle`),
					profile: true,
				},
			],
		]),
	),
	'octane-direct': { bundle: (n) => path.join(root, `prototype/dist-rows${n}/main.web.bundle`) },
};
const HEADINGS = {
	octane: 'Octane',
	'octane-profile': 'Octane (profile build)',
	'octane-mts-program': 'Octane (main-thread program)',
	'octane-mts-program-profile': 'Octane (main-thread program, profile build)',
	...Object.fromEntries(
		controlTags.flatMap((tag) => [
			[`octane-mts-program-${tag}`, `Octane (main-thread program, \`${tag}\` arm)`],
			[
				`octane-mts-program-${tag}-profile`,
				`Octane (main-thread program, \`${tag}\` arm, profile build)`,
			],
		]),
	),
	'octane-direct': 'L0 direct-emission prototype',
};
const bundleOf = (id, n) => CELLS[id].bundle(n);
for (const id of cellIds) {
	if (CELLS[id] === undefined) throw new Error(`unknown cell ${JSON.stringify(id)}.`);
	const file = bundleOf(id, rows);
	if (!fs.existsSync(file)) {
		throw new Error(`${id} has no pre-populated bundle at ${rows} rows: ${file}`);
	}
}

// --- server -----------------------------------------------------------------

const PAGES = { '/control': makeBenchHtml() };
const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const MIME = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.bundle': 'application/octet-stream',
};

function startServer() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		const page = PAGES[url.pathname];
		if (page !== undefined) {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(page);
			return;
		}
		let file = null;
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		else if (url.pathname.startsWith('/bundle/')) file = CELLS[url.pathname.slice(8)]?.bundle(rows);
		if (file === undefined || file === null || !fs.existsSync(file)) {
			response.writeHead(404);
			response.end('not found');
			return;
		}
		response.writeHead(200, {
			'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// --- sampling ---------------------------------------------------------------

/**
 * One profiled first screen, sampled as two windows rather than one.
 *
 * The main-thread script is a Blob minted in the page realm, so the URL is
 * recorded there on the way past and its source is fetched back afterwards —
 * the profile names frames by that URL and nothing else can say what the code
 * at a position is.
 *
 * **Two windows, two profiles.** The first is the window this instrument has
 * always had: attach to settled paint. The second runs from there until the
 * framework says the first-tree lifecycle has ended — the background's
 * description arriving, `prepareLynxHostBatch` answering adopt or repair, the
 * apply, and on an adoption the hand-over a message later (issue #215 D7).
 *
 * They are two profiles because a bucket is a function and several functions
 * run in both: the command path builds host records exactly as the first screen
 * did. Folding one profile would put the two windows' `host record building` in
 * one number and call the sum an attribution. Splitting the profile by
 * timestamp would need the profiler's clock and the page's to be the same
 * clock, which is a claim about Chromium rather than about the framework. A
 * second `Profiler.start` needs neither: each window is folded from the samples
 * taken during it, and the boundary is exactly where the first window ended.
 *
 * The gap between the two is one CDP round trip, and it lands in the quiet
 * after paint has settled — `fcp` resolves only once the content count has been
 * stable for its idle window, and the commit arrives later than that. When it
 * does not, the marker read at the boundary says so and the record reports the
 * adoption window as overlapped rather than as clean.
 */
async function profileSample(browser, cell) {
	const page = await browser.newPage();
	try {
		await page.addInitScript(() => {
			const mint = URL.createObjectURL.bind(URL);
			globalThis.__OCTANE_BLOB_URLS__ = [];
			URL.createObjectURL = (blob) => {
				const url = mint(blob);
				globalThis.__OCTANE_BLOB_URLS__.push(url);
				return url;
			};
		});
		await applyNeutralize(page);
		await applyStageClock(page);
		await applyMainRealmProbe(page);
		await page.goto(`http://127.0.0.1:${port}/control`, { waitUntil: 'load' });
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Profiler.enable');
		await cdp.send('Profiler.setSamplingInterval', { interval });
		await cdp.send('Profiler.start');
		const observed = await page.evaluate(
			async (request) => {
				globalThis.__x.createView(request.bundleUrl);
				const paint = await globalThis.__x.fcp({
					minContent: request.rows,
					idleMs: 300,
					timeoutMs: 240000,
				});
				// Read at the boundary, not after it: whether any of the first-tree
				// lifecycle already ran inside the paint window is a fact about this
				// instant and about no later one.
				const realm = globalThis.__OCTANE_LYNX_MT_REALM__;
				const profile =
					realm === undefined || realm === null ? undefined : realm.__OCTANE_LYNX_PROF;
				if (realm === undefined || realm === null) {
					return {
						...paint,
						adoption: { reachable: false, reason: 'no main-thread realm was published' },
					};
				}
				if (profile === undefined) {
					// A shipping-shaped build: `LYNX_PROFILE` folded to false and there
					// is no record to close a window on. Reported rather than waited
					// out, so such a cell keeps exactly the paint window it always had.
					return {
						...paint,
						adoption: { reachable: false, reason: 'the cell carries no profile record' },
					};
				}
				return {
					...paint,
					adoption: {
						reachable: true,
						overlapped: profile.firstTreeAction !== null,
						actionAtPaint: profile.firstTreeAction,
					},
				};
			},
			{ bundleUrl: `http://127.0.0.1:${port}/bundle/${cell}`, rows },
		);
		const { profile: paintProfile } = await cdp.send('Profiler.stop');
		if (observed.dnf) throw new Error(`${cell} never painted ${rows} rows.`);

		let adoptionProfile = null;
		let adoption = observed.adoption;
		if (adoption.reachable === true) {
			await cdp.send('Profiler.start');
			adoption = await page.evaluate(
				async (request) => {
					const profile = globalThis.__OCTANE_LYNX_MT_REALM__.__OCTANE_LYNX_PROF;
					const started = performance.now();
					for (;;) {
						const waitedMs = performance.now() - started;
						const settled = profile.firstTreeSettled >= 1;
						if (settled || waitedMs >= request.adoptionTimeoutMs) {
							return {
								...request.opened,
								action: profile.firstTreeAction,
								settled: profile.firstTreeSettled,
								prepareMs: profile.prepareMs,
								applyMs: profile.applyMs,
								handOverMs: profile.handOverMs,
								waitedMs,
								timedOut: !settled,
							};
						}
						await new Promise((resolve) => setTimeout(resolve, 8));
					}
				},
				{ adoptionTimeoutMs: adoptionTimeout, opened: adoption },
			);
			({ profile: adoptionProfile } = await cdp.send('Profiler.stop'));
			if (adoption.timedOut === true) {
				throw new Error(
					`${cell}: the first-tree lifecycle had not settled ${Math.round(adoption.waitedMs)} ms after paint ` +
						`(action ${JSON.stringify(adoption.action)}); an adoption window that never closed is not one to report.`,
				);
			}
		}

		// Selected from the recorded mints rather than "any blob: frame", so a
		// second blob-backed script in the page realm surfaces as an ambiguity
		// instead of silently taking the whole fold.
		const minted = await page.evaluate(() => globalThis.__OCTANE_BLOB_URLS__ ?? []);
		const profiled = [...new Set(paintProfile.nodes.map((node) => node.callFrame.url))].filter(
			(url) => url.startsWith('blob:') && minted.includes(url),
		);
		if (profiled.length === 0) {
			throw new Error(`${cell} produced no main-thread script frames; the profile named none.`);
		}
		if (profiled.length > 1) {
			throw new Error(
				`${cell} profiled ${profiled.length} page-minted scripts; attribution is ambiguous.`,
			);
		}
		const scriptUrl = profiled[0];
		const source = await page.evaluate(
			(url) =>
				fetch(url)
					.then((response) => response.text())
					.catch(() => null),
			scriptUrl,
		);
		if (source === null) throw new Error(`${cell}'s main-thread script could not be read back.`);
		const lines = source.split('\n');
		const sourceAt = (line, column) =>
			(lines[line] ?? '').slice(Math.max(0, column), Math.max(0, column) + PROBE_WINDOW);
		return {
			paint: foldProfile(paintProfile, scriptUrl, sourceAt),
			adoption: adoptionProfile === null ? null : foldProfile(adoptionProfile, scriptUrl, sourceAt),
			facts: adoption,
			sourceAt,
		};
	} finally {
		await page.close();
	}
}

/** Cell order rotates per repetition, so no cell always runs on a cold browser. */
function rotated(count, ids) {
	return Array.from({ length: count }, (_, index) =>
		ids.map((_, i) => ids[(i + index) % ids.length]),
	);
}

// --- run --------------------------------------------------------------------

const loadStart = os.loadavg();
if (loadStart[0] > 2 && !args['allow-busy-host']) {
	throw new Error(
		`host one-minute load is ${loadStart[0].toFixed(2)}; pass --allow-busy-host to sample anyway.`,
	);
}
const server = await startServer();
const { chromium } = require('playwright');
const browser = await chromium.launch(chromiumLaunchOptions());
const samples = Object.fromEntries(cellIds.map((id) => [id, []]));
const witnesses = new Map();
try {
	for (const order of rotated(reps, cellIds)) {
		for (const id of order) {
			const folded = await profileSample(browser, id);
			samples[id].push(folded);
			// One reading's source is kept per cell so the report can show the code
			// behind an unnamed frame instead of only its position.
			if (!witnesses.has(id)) witnesses.set(id, folded.sourceAt);
			const named = (window) =>
				[...window.buckets.values()].reduce((sum, cell) => sum + cell.us, 0) / 1000;
			const window =
				folded.facts.reachable === true
					? `+ ${named(folded.adoption).toFixed(1)} ms adoption, first tree ` +
						`${folded.facts.action} after ${Math.round(folded.facts.waitedMs)} ms`
					: `paint window only (${folded.facts.reason})`;
			console.log(
				`[mts] ${id} @${rows}: ${named(folded.paint).toFixed(1)} ms named over ` +
					`${folded.paint.samples} samples, ${window}`,
			);
		}
	}
} finally {
	await browser.close();
	server.close();
}
const loadEnd = os.loadavg();

// --- report -----------------------------------------------------------------

const round = (value, places) => Number(value.toFixed(places));
// `line:column` sorted as numbers, so a record's frame list is stable across
// runs and two records of one build can be diffed line for line.
const comparePositions = (a, b) => {
	const parse = (text) => text.split(':').map(Number);
	const [aLine, aColumn] = parse(a);
	const [bLine, bColumn] = parse(b);
	return aLine - bLine || aColumn - bColumn;
};
/**
 * One window's attribution, over every reading of one cell.
 *
 * Called once per window, and the two are folded the same way on purpose: the
 * adoption window is not a summary beside the real one, it is the same
 * attribution over a different span of the same run.
 */
function attributeWindow(id, windows, sourceAt) {
	const bucketNames = [...new Set(windows.flatMap((window) => [...window.buckets.keys()]))];
	const perBucket = {};
	for (const name of bucketNames) {
		perBucket[name] = stats(windows.map((window) => (window.buckets.get(name)?.us ?? 0) / 1000));
	}
	// The same time keyed by source site rather than by bucket. A bucket folding
	// six functions says where the script is without saying what it is doing,
	// and the sites are what answer that.
	const perSite = {};
	for (const name of bucketNames) {
		for (const site of SITES_BY_BUCKET[name] ?? []) {
			const ms = windows.map((window) => (window.sites.get(site)?.us ?? 0) / 1000);
			// Across every reading, not per reading: a function entered in one rep
			// and not the next is still a function this site folds.
			const positions = new Set(
				windows.flatMap((window) => [...(window.sites.get(site)?.positions ?? [])]),
			);
			// Kept, not just counted. A site over one frame is exactly the case the
			// count cannot settle — two entrances to one function look like two
			// functions — and settling it means reading the source at each frame.
			// The record hands that over rather than telling the reader to go and
			// dump the script, which is what narrowing the probe needs next.
			perSite[site] = {
				...stats(ms),
				frames: positions.size,
				positions: [...positions].sort(comparePositions),
			};
		}
	}
	// A site the fold produced that no bucket claims would go missing silently,
	// and a bucket whose sites do not sum to it would be a split that reads as an
	// attribution while hiding time. Both are refusals rather than roundings: the
	// two maps are built from one pass over one set of frames, so any drift
	// between them is a defect in this file, not a property of the run.
	for (const window of windows) {
		for (const site of window.sites.keys()) {
			if (perSite[site] === undefined) {
				throw new Error(
					`${id}: fold produced site ${JSON.stringify(site)}, which no bucket lists.`,
				);
			}
		}
		for (const [name, cell] of window.buckets) {
			const fromSites = (SITES_BY_BUCKET[name] ?? []).reduce(
				(sum, site) => sum + (window.sites.get(site)?.us ?? 0),
				0,
			);
			if (Math.abs(fromSites - cell.us) > 1e-6) {
				throw new Error(
					`${id}: bucket ${JSON.stringify(name)} is ${cell.us} µs but its sites sum to ${fromSites}.`,
				);
			}
		}
	}
	const namedMs = windows.map(
		(window) => [...window.buckets.values()].reduce((sum, cell) => sum + cell.us, 0) / 1000,
	);
	const unmatchedMs = windows.map(
		(window) => [...window.unmatched.values()].reduce((sum, cell) => sum + cell.us, 0) / 1000,
	);
	// The largest frames the probe table did not name, from the first reading, so
	// an unnamed cost is inspectable rather than a number with nothing behind it.
	const worst = [...windows[0].unmatched].sort((a, b) => b[1].us - a[1].us).slice(0, 3);
	return {
		buckets: perBucket,
		sites: perSite,
		namedMs: stats(namedMs),
		unmatchedMs: stats(unmatchedMs),
		totalMs: stats(namedMs.map((value, index) => value + unmatchedMs[index])),
		largestUnnamed: worst.map(([position, cell]) => {
			const [line, column] = position.split(':').map(Number);
			return {
				position,
				ms: round(cell.us / 1000, 1),
				source: sourceAt(line, column).slice(0, 140).replace(/\s+/g, ' '),
			};
		}),
	};
}

const cells = {};
for (const id of cellIds) {
	const sourceAt = witnesses.get(id);
	// What the second window this cell's buckets came from actually covered. A
	// bucket group named `adoption` is only a measurement of adoption on a cell
	// that reached it, and a reader cannot tell those apart from the buckets:
	// both show numbers, and one of them is a first screen that ended at paint
	// (issue #215 D7). `action` is the second half of the same honesty — an
	// adoption and a repair are both correct pages and wildly different costs,
	// and a record that did not say which would price a repaint as an adoption.
	const facts = samples[id].map((sample) => sample.facts);
	const reachable = facts.every((one) => one.reachable === true);
	const adoption = reachable
		? {
				window: 'settled paint through hand-over',
				actions: [...new Set(facts.map((one) => one.action))],
				// True on any reading where the lifecycle had already begun before
				// the paint window closed, which makes that reading's split a
				// boundary rather than a wall. Reported per cell rather than thrown
				// on, because one overlapping reading in five is a fact about the
				// record and not a reason to have no record.
				overlapped: facts.some((one) => one.overlapped === true),
				waitedMs: stats(facts.map((one) => one.waitedMs)),
				// The framework's own walls for the three stages this window samples,
				// as a cross-check on its buckets in the same way the first-screen
				// phase walls cross-check the paint ones. They accumulate for the life
				// of a realm and each realm paints once, so a reading is this run's
				// and no other's.
				prepareMs: stats(facts.map((one) => one.prepareMs)),
				applyMs: stats(facts.map((one) => one.applyMs)),
				handOverMs: stats(facts.map((one) => one.handOverMs)),
				...attributeWindow(
					`${id} (adoption)`,
					samples[id].map((sample) => sample.adoption),
					sourceAt,
				),
			}
		: {
				window: 'none — this cell ended at settled paint',
				reasons: [...new Set(facts.map((one) => one.reason ?? 'settled on some readings only'))],
			};
	cells[id] = {
		...attributeWindow(
			id,
			samples[id].map((sample) => sample.paint),
			sourceAt,
		),
		adoption,
	};
}

const meta = {
	date: new Date().toISOString(),
	node: process.version,
	cpus: os.cpus().length,
	cpuModel: os.cpus()[0]?.model ?? 'unknown',
	platform: os.platform(),
	release: os.release(),
	chromium: browser.version(),
	rows,
	reps,
	samplingIntervalUs: interval,
	cells: cellIds,
	// Which bytes this run measured, not merely when it ran. A profile compared
	// against another profile is only a comparison if both measured the same
	// build, and a date cannot say whether they did — see `bundleIdentity`.
	bundles: Object.fromEntries(
		cellIds.map((id) => [id, bundleIdentity(bundleOf(id, rows), { relativeTo: root })]),
	),
	loadStart: loadStart.map((value) => round(value, 2)),
	loadEnd: loadEnd.map((value) => round(value, 2)),
};
const report = { meta, cells };
const outDir = path.join(import.meta.dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
await writeEvidenceJson(path.join(outDir, `${args.label}-${rows}.json`), report);

const lines = [
	`# Main-thread script attribution — ${cellIds.map((id) => HEADINGS[id] ?? id).join(' vs ')}`,
	'',
	`- measured: ${meta.date}`,
	`- host: ${meta.cpus}× ${meta.cpuModel}; ${meta.platform} ${meta.release}; Node ${meta.node}`,
	`- ${rows} rows, ${reps} profiled first screens per cell, ${interval} µs sampling interval`,
	`- one-minute load ${meta.loadStart[0]} → ${meta.loadEnd[0]}`,
	'',
	'## Which build this measured',
	'',
	'`digest` names the bytes: two records that agree on it for a cell measured the',
	'same code, which is what an A/B at one scale needs in order to be an A/B.',
	'Across scales the bundles differ by construction — the row count is compiled',
	'in — so what makes several records one series is instead that every bundle was',
	'built from one revision, and `built` is what answers that. A bundle older than',
	'the last commit under `packages/` measured a stale build, and reading it beside',
	'a fresh one turns a version difference into an apparent workload effect.',
	'',
	'| cell | bundle | bytes | digest | built |',
	'|---|---|---:|---|---|',
	...cellIds.map((id) => {
		const it = meta.bundles[id];
		return `| \`${id}\` | \`${it.path}\` | ${it.bytes} | \`${it.digest}\` | ${it.modified} |`;
	}),
	'',
	'## What this is, and is not',
	'',
	'Self time inside the hidden main-thread realm only. The page realm runs the',
	"harness's own paint predicate, which is measurement rather than framework, and",
	'is excluded. Frames are named by the string literals in the code, because a',
	'production bundle is minified and a mangled name says nothing; the probe table',
	'is `stages/mts-profile-buckets.mjs`, and every probe cites the source it came',
	'from.',
	'',
	'**These milliseconds are not the boundary instrument’s.** A sampling profiler',
	'perturbs the page it measures and this run carries no uninstrumented control.',
	'What is reportable here is the shape — which function owns the script, and how',
	'the cells compare on one axis. Wall clocks come from `stages/papi-run.mjs`.',
	'',
	`## Self time by framework function @${rows}`,
	'',
	`| main-thread script | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
	`|---|${cellIds.map(() => '---:').join('|')}|`,
];
const rowFor = (name, pick, view = (id) => cells[id]) =>
	`| ${name} | ${cellIds
		.map((id) => {
			const stat = pick(view(id));
			return stat === undefined || stat === null
				? '—'
				: `${round(stat.median, 1)} [${round(stat.min, 1)}–${round(stat.max, 1)}]`;
		})
		.join(' | ')} |`;
/** Buckets one window produced, heaviest first, so two windows order their own. */
const orderedFor = (view) =>
	[...new Set(cellIds.flatMap((id) => Object.keys(view(id)?.buckets ?? {})))].sort((a, b) => {
		const weight = (name) =>
			Math.max(...cellIds.map((id) => view(id)?.buckets?.[name]?.median ?? 0));
		return weight(b) - weight(a);
	});
const ordered = orderedFor((id) => cells[id]);
const bucketNames = ordered;
for (const name of ordered) lines.push(rowFor(name, (cell) => cell.buckets[name]));
lines.push(
	rowFor('named total', (cell) => cell.namedMs),
	rowFor('unnamed by the probe table', (cell) => cell.unmatchedMs),
	rowFor('**main-thread script, all frames**', (cell) => cell.totalMs),
	'',
);

// The second window, when the run had one. Same fold, same probe table, a
// different span of the same first screen: from the moment paint settled to the
// moment the framework says the first-tree lifecycle ended (issue #215 D7).
// D3 moved ~56 ms of event bookkeeping past first paint and the record of that
// slice said honestly that nothing measured where it landed. This is where it
// lands.
const adoptionCells = cellIds.filter((id) => cells[id].adoption.buckets !== undefined);
if (adoptionCells.length > 0) {
	const adoptionOf = (id) => cells[id].adoption;
	lines.push(
		`## The adoption window @${rows}`,
		'',
		'What the main-thread script spends after the screen is already painted and',
		'before the tree is the background’s: the background’s description arriving and',
		'being validated, `prepareLynxHostBatch` answering adopt or repair, the apply,',
		'and — on an adoption — the hand-over a message after that. None of it moves a',
		'pixel, so no paint predicate can wait for it and the window above ends before',
		'it starts.',
		'',
		'A cell reaches this window only when it carries the framework’s profile record,',
		'which a shipping-shaped build folds away entirely. `—` below is that, not zero:',
		'the cell ended at settled paint and this window does not exist for it. A profile',
		'build is a different build configuration, so these numbers apportion their own',
		'window and compare to another profile cell’s, never to a shipping one’s.',
		'',
		`| adoption window | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
		`|---|${cellIds.map(() => '---:').join('|')}|`,
	);
	for (const name of orderedFor(adoptionOf)) {
		lines.push(rowFor(name, (cell) => cell?.buckets?.[name], adoptionOf));
	}
	lines.push(
		rowFor('named total', (cell) => cell?.namedMs, adoptionOf),
		rowFor('unnamed by the probe table', (cell) => cell?.unmatchedMs, adoptionOf),
		rowFor('**main-thread script, all frames**', (cell) => cell?.totalMs, adoptionOf),
		'',
		'The framework’s own walls for the same three stages, which it measures itself',
		'and this instrument only samples. They are the cross-check: a bucket total far',
		'from its wall is a probe that stopped matching, not a stage that got cheaper.',
		'',
		`| framework wall | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
		`|---|${cellIds.map(() => '---:').join('|')}|`,
		rowFor('`prepareLynxHostBatch`', (cell) => cell?.prepareMs, adoptionOf),
		rowFor('`prepared.apply()`', (cell) => cell?.applyMs, adoptionOf),
		rowFor('hand-over', (cell) => cell?.handOverMs, adoptionOf),
		rowFor('paint → settled', (cell) => cell?.waitedMs, adoptionOf),
		'',
	);
	for (const id of adoptionCells) {
		const cell = cells[id];
		lines.push(
			`- \`${id}\`: first tree ${cell.adoption.actions.map((one) => `\`${one}\``).join(', ')}` +
				`${cell.adoption.overlapped ? ', **and some reading began before the paint window closed**' : ''}.`,
		);
	}
	lines.push('');
	for (const id of adoptionCells) {
		if (cells[id].adoption.largestUnnamed.length === 0) continue;
		lines.push(`Largest frames the probe table did not name, \`${id}\`:`, '');
		for (const frame of cells[id].adoption.largestUnnamed) {
			lines.push(`- ${frame.ms} ms at \`${frame.position}\` — \`${frame.source}\``);
		}
		lines.push('');
	}
}

// How many buckets fold several functions, and which folds the most, are facts
// about the probe table rather than about the run. Deriving them keeps the
// paragraph below from describing a split the table stopped having: a probe
// added upstairs would otherwise leave a record confidently naming the wrong
// bucket as the widest, in the prose that exists to warn against exactly that.
const multiSite = ordered.filter((name) => (SITES_BY_BUCKET[name] ?? []).length > 1);
const widest = multiSite.reduce(
	(a, b) => (SITES_BY_BUCKET[b].length > SITES_BY_BUCKET[a].length ? b : a),
	multiSite[0],
);
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = (n) => COUNT_WORDS[n] ?? String(n);

if (multiSite.length > 0) {
	lines.push(
		'### Inside the buckets that fold several functions',
		'',
		`A bucket is a probe table entry, not a function, and ${countWord(multiSite.length)} of the rows above`,
		`name more than one. \`${widest}\` names ${countWord(SITES_BY_BUCKET[widest].length)}, so its row says which`,
		'file the script is in and nothing about what it is doing there. These are the',
		'same samples keyed by the source each probe was taken from; every bucket below',
		'sums to its own row above, which the report checks rather than assumes. A site',
		'at 0.0 is a function the run never entered, reported rather than dropped so',
		'that a probe which stopped matching looks different from a branch nothing took.',
		'',
		'A site is a claim about the source, so each cell also says how many distinct',
		'frame positions its probe actually matched. One is a site whose total is a',
		'single function’s. More is a total shared between frames, and which kind it is',
		'has to be read from the source: two entrances the minifier made to one',
		'function look exactly like two functions a probe was wide enough to reach.',
		'The count does not settle that, and it is printed so the number is not read as',
		'a single function’s cost before it has been.',
		'',
	);
}
for (const name of multiSite) {
	const sites = SITES_BY_BUCKET[name];
	// `frames` is how many distinct frame positions the site folded. One is a
	// site that measured a single function; more is a site whose total is shared,
	// which the reader has to see before reading it as one function's cost.
	const siteRow = (site) =>
		`| \`${site}\` | ${cellIds
			.map((id) => {
				const stat = cells[id].sites[site];
				if (stat === undefined) return '—';
				const value = `${round(stat.median, 1)} [${round(stat.min, 1)}–${round(stat.max, 1)}]`;
				return stat.frames > 1 ? `${value} · ${stat.frames} frames` : value;
			})
			.join(' | ')} |`;
	lines.push(
		`**${name}**`,
		'',
		`| source site | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
		`|---|${cellIds.map(() => '---:').join('|')}|`,
		...sites.map((site) => siteRow(site)),
		rowFor(`**${name}, all sites**`, (cell) => cell.buckets[name]),
		'',
	);
}
const entered = cellIds.flatMap((id) =>
	Object.entries(cells[id].sites)
		.filter(([, stat]) => stat.frames > 0)
		.map(([site, stat]) => ({ id, site, stat })),
);
if (entered.length > 0) {
	lines.push(
		'### The source at every site the run entered',
		'',
		'A site’s name is a claim that its probe matches one named function in one',
		'named file, and nothing in the run checks that claim — a probe is matched',
		'against minified text, so a label naming the wrong function, or naming a file',
		'that does not exist, reads exactly like a correct one. The source at each',
		'frame is what makes the claim checkable, so the record carries it for every',
		'site rather than only for the ones already known to be shared.',
		'',
		'For a site over one frame it answers what the frame count cannot: frames',
		'whose text differs are different functions the probe was wide enough to',
		'reach, and the total is shared between them; frames whose text is one',
		'function entered twice are that function after all. For a site at one frame',
		'it is the evidence that the label names what it says it names.',
		'',
	);
	for (const { id, site, stat } of entered) {
		lines.push(`- \`${id}\` — \`${site}\`, ${stat.frames} frame${stat.frames === 1 ? '' : 's'}`);
		const sourceAt = witnesses.get(id);
		for (const position of stat.positions) {
			const [line, column] = position.split(':').map(Number);
			lines.push(
				`  - ${position} — \`${sourceAt(line, column).slice(0, 140).replace(/\s+/g, ' ')}\``,
			);
		}
	}
	lines.push('');
}
lines.push(
	'### The largest frames the probe table did not name',
	'',
	'Reported rather than folded away: an unnamed frame is either a function worth a',
	'probe or a bucket whose probe stopped matching, and both are visible here. The',
	'prototype cell is the exception by construction: it runs no Octane code, so no',
	'probe can name it and its whole script is unnamed.',
	'',
);
for (const id of cellIds) {
	lines.push(`- \`${id}\``);
	for (const frame of cells[id].largestUnnamed) {
		lines.push(`  - ${frame.ms} ms at ${frame.position} — \`${frame.source}\``);
	}
}
lines.push('');
fs.writeFileSync(path.join(outDir, `${args.label}-${rows}.md`), `${lines.join('\n')}\n`);
console.log(`\n[mts] wrote results/${args.label}-${rows}.{json,md}`);
