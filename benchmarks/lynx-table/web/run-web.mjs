// Lynx-for-Web wall-clock harness: octane vs vendored reference bundles.
//
// Serves each framework's `.web.bundle` into a `<lynx-view>` (@lynx-js/web-core
// + headless Chromium), drives real clicks through the composed DOM, and waits
// for shadow-piercing DOM predicates. Every cell — octane and the references —
// is driven by the byte-identical page driver, per the measurement-honesty
// rules in README.md: no octane-only workloads, and a cell that cannot be
// driven end-to-end reports "not measured", never a number from a degraded
// run.
//
// Wall-clock here is host-bound and informational; the regression gates live
// in the deterministic counter harness (../run.mjs). Ratios versus the
// vue-vdom cell are the portable claim — the report prints both.
//
//   node web/run-web.mjs [--scales 1000,10000] [--reps 3] [--cells octane,...]
//   node web/run-web.mjs --skip-app-build     # reuse app/dist
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
	DRIVER_CLIENT_JS,
	applyNeutralize,
	chromiumLaunchOptions,
	makeBenchHtml,
	stats,
} from './driver-client.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: args } = parseArgs({
	options: {
		scales: { type: 'string', default: '1000,10000' },
		reps: { type: 'string', default: '3' },
		cells: { type: 'string', default: 'octane,vue-vdom,vue-vapor,react' },
		port: { type: 'string', default: '8360' },
		headed: { type: 'boolean', default: false },
		'skip-app-build': { type: 'boolean', default: false },
		// Serve the OCTANE_LYNX_PROFILE=1 bundles for the octane cells, so the
		// wire counters below have something to read. Those bundles carry the
		// profiler's branches, so their milliseconds are not the shipping
		// configuration and the report says so at the top.
		'counter-build': { type: 'boolean', default: false },
		// `--cell-bundle id=path`, repeatable: measure a bundle this checkout does
		// not build, in the same window as the cells it does. The question it
		// exists for is "did this regress since commit X", which the honesty rules
		// say may only be answered by driving both bundles through one instrument
		// in one window — never by dividing a number from one session by a number
		// from another. Build the other commit's bundle in a worktree, point a
		// cell at it, and the report prints its ÷ octane ratio beside the rest.
		'cell-bundle': { type: 'string', multiple: true, default: [] },
	},
});

const SCALES = args.scales
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
const REPS = Number(args.reps);
const PORT = Number(args.port);
const STORM_TIMEOUT_MS = 240_000;

// Reference cells are vendored black-box fixtures (see reference/manifest.json
// for build provenance). vue-vdom is the vdom top config (`vdom +b +ifr`,
// legacy id vdom-ifr-et); vue-vapor is `vapor +b +ifr` (legacy id vapor-ifr).
const ALL_CELLS = [
	{ id: 'octane', bundle: path.join(root, 'app/dist/main.web.bundle') },
	// octane-direct is the issue-#58 L0 direct-emission prototype (see
	// prototype/README.md): the same workload behind the same driver, but the
	// main-thread/background programs a `target: 'lynx'` backend would emit.
	// Build it with `node prototype/build.mjs`; it is opt-in via --cells.
	{ id: 'octane-direct', bundle: path.join(root, 'prototype/dist/main.web.bundle') },
	// Issue-#103 B0: the same application entry and the same page driver, built
	// with `pluginOctane({ core: 'block' })` so the Block core drives background
	// updates instead of the universal one. The program `octane-block` runs is
	// hand-written (app/src/block-program.ts), so that cell is an architecture
	// ceiling, not a framework measurement — read it beside `octane`, never
	// instead of it. `-reconcile` is the same core driven by whole-list
	// reconciles rather than scoped slot writes.
	{ id: 'octane-block', bundle: path.join(root, 'app/dist-block/main.web.bundle'), core: 'block' },
	{
		id: 'octane-block-reconcile',
		bundle: path.join(root, 'app/dist-block-reconcile/main.web.bundle'),
		core: 'block',
		blockMode: 'reconcile',
	},
	// Issue-#135 item 1b: the Block core driven by the compiled `App` itself,
	// through the same lowering the framework ships, with no hand-written
	// program in the bundle at all. This is the cell that answers the question
	// the two above can only bound: what Octane on the Block core costs. Its
	// claim is the ÷ octane ratio printed beside it, read against the ceiling
	// `octane-block` records in the same window.
	{
		id: 'octane-block-derived',
		bundle: path.join(root, 'app/dist-block-derived/main.web.bundle'),
		core: 'block',
		blockMode: 'derived',
	},
	{ id: 'vue-vdom', bundle: path.join(root, 'reference/vdom-ifr-et/main.web.bundle') },
	{ id: 'vue-vapor', bundle: path.join(root, 'reference/vapor-ifr/main.web.bundle') },
	{ id: 'react', bundle: path.join(root, 'reference/react/main.web.bundle') },
];
const wanted = new Set(
	args.cells
		.split(',')
		.map((cell) => cell.trim())
		.filter(Boolean),
);
const COUNTER_BUILD = args['counter-build'];
// A counter build is the same dist path with `-profile` appended, which is what
// `scripts/build-app.mjs` writes under OCTANE_LYNX_PROFILE=1 — so the auto-build
// below must run under that same flag, or it would stage a fresh default dist
// while the session serves whatever `-profile` dist was already on disk.
// Reference cells are vendored black boxes with no counters to turn on, so they
// keep their bundle.
if (COUNTER_BUILD) process.env.OCTANE_LYNX_PROFILE = '1';
const CELLS = ALL_CELLS.filter((cell) => wanted.has(cell.id)).map((cell) =>
	COUNTER_BUILD && cell.bundle.includes('/app/dist')
		? {
				...cell,
				bundle: cell.bundle.replace(/(\/app\/dist[^/]*)\//, '$1-profile/'),
				profiled: true,
			}
		: cell,
);
// An injected cell is compared against `octane` explicitly, because the reason
// to inject one is always "how does this differ from the octane this checkout
// builds" and that ratio is the only same-window claim available for it.
for (const spec of args['cell-bundle']) {
	const separator = spec.indexOf('=');
	if (separator < 1) {
		throw new Error(`--cell-bundle expects id=path, got: ${spec}`);
	}
	const id = spec.slice(0, separator);
	const bundle = path.resolve(spec.slice(separator + 1));
	if (ALL_CELLS.some((cell) => cell.id === id)) {
		throw new Error(`--cell-bundle ${id}: that id is a built-in cell; pick another name.`);
	}
	CELLS.push({ id, bundle, compare: 'octane', injected: true });
	ALL_CELLS.push({ id, bundle });
}

const CREATE_BUTTON = {
	1000: 'Create 1,000 rows',
	3000: 'Create 3,000 rows',
	5000: 'Create 5,000 rows',
	10000: 'Create 10,000 rows',
	20000: 'Create 20,000 rows',
	30000: 'Create 30,000 rows',
};

// --- server ----------------------------------------------------------------

const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const BENCH_HTML = makeBenchHtml();
const MIME = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.html': 'text/html',
	'.json': 'application/json',
	'.map': 'application/json',
	'.bundle': 'application/octet-stream',
	'.wasm': 'application/wasm',
};

function startServer() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		let filePath = null;
		if (url.pathname === '/' || url.pathname === '/bench.html') {
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end(BENCH_HTML);
			return;
		}
		if (url.pathname.startsWith('/webcore/')) {
			filePath = path.join(webCoreRoot, url.pathname.slice(9));
		} else if (url.pathname.startsWith('/bundles/')) {
			// Resolve against the selected cells first: that is where a
			// `--counter-build` cell carries its redirected bundle path, and serving
			// the default-build bundle for it would silently measure the wrong
			// artifact under the right name.
			const cell =
				CELLS.find((entry) => url.pathname === `/bundles/${entry.id}`) ??
				ALL_CELLS.find((entry) => url.pathname === `/bundles/${entry.id}`);
			filePath = cell?.bundle ?? null;
		}
		if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
			response.writeHead(404);
			response.end('not found: ' + url.pathname);
			return;
		}
		response.writeHead(200, {
			'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(filePath).pipe(response);
	});
	return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

// --- driver ----------------------------------------------------------------

class Driver {
	constructor(page) {
		this.page = page;
	}
	ev(fn, arg) {
		return this.page.evaluate(fn, arg);
	}
	labelAt(index) {
		return this.ev((idx) => globalThis.__x.labelAt(idx), index);
	}
	settle() {
		return this.ev(() => globalThis.__x.settle());
	}
	async hasButton(label) {
		return (await this.ev((l) => globalThis.__x.buttonRect(l), label)) !== null;
	}
	async clickButton(label) {
		const rect = await this.ev((l) => globalThis.__x.buttonRect(l), label);
		if (!rect) throw new Error(`button not found: ${label}`);
		await this.page.mouse.click(rect.x, rect.y);
	}
	async clickCell(rowIndex, cls) {
		const rect = await this.ev(
			(request) => globalThis.__x.cellRect(request.rowIndex, request.cls),
			{ rowIndex, cls },
		);
		if (!rect) throw new Error(`cell not found: row ${rowIndex} ${cls}`);
		await this.page.mouse.click(rect.x, rect.y);
	}
	async measureButton(label, spec, timeoutMs) {
		const armed = this.ev((request) => globalThis.__x.arm(request.spec, request.timeoutMs), {
			spec,
			timeoutMs,
		});
		await this.clickButton(label);
		return (await armed).ms;
	}
	async measureCell(rowIndex, cls, spec) {
		const armed = this.ev((s) => globalThis.__x.arm(s), spec);
		await this.clickCell(rowIndex, cls);
		return (await armed).ms;
	}
}

// Deterministic floor counters, read from whichever realms publish them (issue
// #103 U0). Only the octane-direct cell defines them; every other cell reports
// null and the report omits the column, exactly as a cell that cannot be driven
// reports "not measured" rather than a zero.
const READ_FLOOR = () => {
	const main = globalThis.__BENCH_DIRECT_MAIN__;
	const background = globalThis.__BENCH_DIRECT_BG__;
	if (main === undefined && background === undefined) return null;
	return {
		rowVisits: main?.rowVisits ?? 0,
		writes: main?.writes ?? 0,
		rowScans: background?.rowScans ?? 0,
		blockLookups: background?.blockLookups ?? 0,
	};
};
const RESET_FLOOR = () => {
	const main = globalThis.__BENCH_DIRECT_MAIN__;
	if (main !== undefined) {
		main.rowVisits = 0;
		main.writes = 0;
	}
	const background = globalThis.__BENCH_DIRECT_BG__;
	if (background !== undefined) {
		background.rowScans = 0;
		background.blockLookups = 0;
	}
};

async function eachRealm(page, fn) {
	const results = [];
	for (const frame of page.frames()) results.push(await frame.evaluate(fn).catch(() => null));
	for (const worker of page.workers()) results.push(await worker.evaluate(fn).catch(() => null));
	return results;
}

async function readFloorCounters(page) {
	const seen = (await eachRealm(page, READ_FLOOR)).filter((value) => value !== null);
	if (seen.length === 0) return null;
	return {
		rowVisits: Math.max(...seen.map((value) => value.rowVisits)),
		writes: Math.max(...seen.map((value) => value.writes)),
		rowScans: Math.max(...seen.map((value) => value.rowScans)),
		blockLookups: Math.max(...seen.map((value) => value.blockLookups)),
	};
}

async function resetFloorCounters(page) {
	await eachRealm(page, RESET_FLOOR);
}

// What the background thread did to produce one operation's paint, on the two
// axes the wire cannot show (issue #135 item 1):
//
//   rowBodies    `Row` component bodies executed, counted by the app itself
//                (`app/src/App.lynx.tsrx`). The two hand-written cells never
//                run one and report nothing.
//   blockVisits  blocks the Block core looked up, summed over the realm's
//                cores (`core/block-core.ts`). The universal cell has no
//                Block core and reports nothing.
//
// Both are published behind the same `__OCTANE_LYNX_PROFILE__` flag as the
// wire counters, so both read as null unless the cell was served from a
// `--counter-build` bundle, and the vendored reference cells define neither.
//
// This is the one place in the report where "the same paint for less work" is
// visible at all. A core that re-renders ten thousand rows and then discovers
// one changed sends exactly what a core that re-rendered one sends: same
// commit, same command, same bytes. Every other column agrees; these two do
// not.
const READ_WORK = () => {
	const bodies = globalThis.__BENCH_ROW_RENDERS__;
	const cores = globalThis.__OCTANE_LYNX_BLOCK_CORES__;
	const value = {};
	if (typeof bodies === 'number') value.rowBodies = bodies;
	if (Array.isArray(cores) && cores.length !== 0) {
		value.blockVisits = cores.reduce((total, core) => total + core.counters().blockLookups, 0);
	}
	return Object.keys(value).length === 0 ? null : value;
};
const RESET_WORK = () => {
	if (typeof globalThis.__BENCH_ROW_RENDERS__ === 'number') globalThis.__BENCH_ROW_RENDERS__ = 0;
	const cores = globalThis.__OCTANE_LYNX_BLOCK_CORES__;
	if (Array.isArray(cores)) for (const core of cores) core.resetCounters();
	return true;
};

// Summed rather than maxed across realms, unlike the floor counters: a row body
// and a block visit each happen once wherever they happen, so two realms that
// both report are two halves of one number. In this hosting only the background
// realm reports either.
async function readWorkCounters(page) {
	const seen = (await eachRealm(page, READ_WORK)).filter((value) => value !== null);
	if (seen.length === 0) return null;
	const total = {};
	for (const field of WORK_FIELDS) {
		const reported = seen.filter((value) => typeof value[field] === 'number');
		if (reported.length === 0) continue;
		total[field] = reported.reduce((sum, value) => sum + value[field], 0);
	}
	return Object.keys(total).length === 0 ? null : total;
}

async function resetWorkCounters(page) {
	await eachRealm(page, RESET_WORK);
}

// Wire counters: how many commits each cell actually put on the wire for one
// operation, and how many host commands rode in them. `@octanejs/lynx` keeps
// these per realm under `__OCTANE_LYNX_PROF` (core/profiling.ts) behind the
// `__OCTANE_LYNX_PROFILE__` build flag, so they read as null unless the cell was
// served from a `--counter-build` bundle, and they are core-agnostic: both
// background cores dispatch through the same transport.
//
// Unlike the floor counts above these are NOT invariants, and the report must
// not present them as ones. A storm's tick can render while a commit is still in
// flight, and what the renderer has not yet flushed coalesces into the next
// commit — so the commit count is a function of how the ticks and the flushes
// interleaved on this host, and its run-to-run range is the measurement, not
// noise to be averaged away.
const READ_WIRE = () => {
	const profile = globalThis.__OCTANE_LYNX_PROF;
	if (profile === undefined) return null;
	return {
		commits: profile.commits ?? 0,
		commands: profile.commands ?? 0,
		emptyCommits: profile.emptyCommits ?? 0,
	};
};
const RESET_WIRE = () => {
	const profile = globalThis.__OCTANE_LYNX_PROF;
	if (profile === undefined) return null;
	profile.commits = 0;
	profile.commands = 0;
	profile.emptyCommits = 0;
	return true;
};

// The background renderer and the main-thread receiver are separate realms with
// separate records under the same global name, and they count opposite ends of
// the same wire: background counts what it dispatched, main counts what it
// applied. Reporting their sum would hide exactly the question these counters
// exist to answer, so they stay apart. The split is by realm kind: Lynx-for-Web
// runs the background renderer in a worker and the main thread in a hidden
// iframe, and since both records carry the same field names, realm kind is the
// only signal there is. That makes this classification a property of the
// Lynx-for-Web hosting choice — a hosting that ran the background renderer in a
// frame would need a different split, and until one exists this stays honest by
// saying so rather than by pretending to be hosting-independent.
async function eachRealmTagged(page, fn) {
	const seen = [];
	for (const frame of page.frames()) {
		const value = await frame.evaluate(fn).catch(() => null);
		if (value !== null) seen.push({ kind: 'frame', value });
	}
	for (const worker of page.workers()) {
		const value = await worker.evaluate(fn).catch(() => null);
		if (value !== null) seen.push({ kind: 'worker', value });
	}
	return seen;
}

async function readWireCounters(page) {
	const seen = await eachRealmTagged(page, READ_WIRE);
	if (seen.length === 0) return null;
	const bg = seen.filter((realm) => realm.kind === 'worker');
	const mt = seen.filter((realm) => realm.kind === 'frame');
	const sum = (realms, field) => realms.reduce((total, realm) => total + realm.value[field], 0);
	return {
		bgCommits: sum(bg, 'commits'),
		bgCommands: sum(bg, 'commands'),
		bgEmptyCommits: sum(bg, 'emptyCommits'),
		mtCommits: sum(mt, 'commits'),
		mtCommands: sum(mt, 'commands'),
	};
}

async function resetWireCounters(page) {
	await eachRealmTagged(page, RESET_WIRE);
}

async function loadCell(browser, cell) {
	const page = await browser.newPage();
	if (process.env.LYNX_BENCH_DEBUG) {
		page.on('console', (message) =>
			console.log(`[console:${message.type()}]`, message.text().slice(0, 400)),
		);
		page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 600)));
	}
	await applyNeutralize(page);
	await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
	await page.evaluate(
		(url) => globalThis.__x.createView(url),
		`http://127.0.0.1:${PORT}/bundles/${cell.id}`,
	);
	await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
		timeout: 60_000,
		polling: 16,
	});
	if (process.env.LYNX_BENCH_DEBUG) console.log('[debug] mounted', cell.id, Date.now());
	return page;
}

// one (cell, scale) rep → {op: ms}
async function runRep(browser, cell, rows) {
	const button = CREATE_BUTTON[rows];
	const page = await loadCell(browser, cell);
	const driver = new Driver(page);
	const sample = {};
	// Counters are zeroed immediately before the click and read immediately
	// after the op's predicate resolves, so each op's counts cover that op only.
	const measure = async (name, run) => {
		await resetFloorCounters(page);
		await resetWireCounters(page);
		await resetWorkCounters(page);
		sample[name] = await run();
		const counts = await readFloorCounters(page);
		if (counts !== null) (sample.counts ??= {})[name] = counts;
		const wire = await readWireCounters(page);
		if (wire !== null) (sample.wire ??= {})[name] = wire;
		const work = await readWorkCounters(page);
		if (work !== null) (sample.work ??= {})[name] = work;
	};
	try {
		await driver.settle();
		await measure('create', () =>
			driver.measureButton(button, { type: 'rowCount', value: rows }, STORM_TIMEOUT_MS),
		);
		await driver.settle();
		const before = await driver.labelAt(0);
		await measure('update10th', () =>
			driver.measureButton('Update every 10th row', {
				type: 'labelAt',
				index: 0,
				equals: `${before} !!!`,
			}),
		);
		await driver.settle();
		await measure('select', () =>
			driver.measureCell(1, 'col-label', { type: 'dangerAt', index: 1 }),
		);
		await driver.settle();
		await measure('updateStorm', () =>
			driver.measureButton(
				'Update storm',
				{ type: 'labelAt', index: 0, equals: 'bench 50' },
				STORM_TIMEOUT_MS,
			),
		);
		await driver.settle();
		await measure('selectStorm', () =>
			driver.measureButton('Select storm', { type: 'dangerAt', index: 0 }, STORM_TIMEOUT_MS),
		);
		await driver.settle();
		// `clear` empties the table, so it runs last: every op above it sees the
		// same tree it saw before this op existed, which is what keeps this
		// schedule comparable with the sessions recorded before it. A cell whose
		// app has no Clear button reports the op "not measured" rather than
		// failing the whole repetition — the same stance the harness takes for a
		// bundle it cannot drive, and a different fact from a DNF, so the sample
		// records which one this was.
		if (await driver.hasButton('Clear')) {
			await measure('clear', () =>
				driver.measureButton('Clear', { type: 'rowCount', value: 0 }, STORM_TIMEOUT_MS),
			);
		} else {
			(sample.notMeasured ??= []).push('clear');
		}
	} finally {
		await page.close();
	}
	return sample;
}

const OPS = ['create', 'update10th', 'select', 'updateStorm', 'selectStorm', 'clear'];
const FLOOR_FIELDS = ['rowVisits', 'writes', 'rowScans', 'blockLookups'];
const WIRE_FIELDS = ['bgCommits', 'bgCommands', 'bgEmptyCommits', 'mtCommits', 'mtCommands'];
const WORK_FIELDS = ['rowBodies', 'blockVisits'];

/**
 * How many rows each single-change operation changes — what a core that touches
 * only what changed does the work for.
 *
 * `create` fills an empty table, so every row is new. `update10th` relabels
 * every tenth row. `select` is the first selection this ladder makes, so one
 * row gains the class and none loses it — a second selection would change two.
 * `clear` empties the table, and a removed row has neither a body to run nor a
 * survivor to look up.
 *
 * It is read against a body count directly and against a visit count with one
 * offset: `create` and `clear` mount and destroy rather than revisit, so a
 * keyed core looks nothing up for either and the visit floor there is 0, not
 * the table. `block-counts.mjs` says the same of its own `create` row.
 *
 * The storms are deliberately absent rather than modelled as their ticks
 * summed. A tick posts a state change and a render answers it, but two ticks
 * that land before the scheduler flushes are answered by one render — the same
 * interleaving the wire section describes for commits, one layer earlier. What
 * a storm's counts measure is therefore how the ticks and the renders
 * interleaved on this host, and the observed range is that result.
 *
 * This is the change, not a budget: a core may legitimately do more.
 */
const WORK_CHANGE_SIZE = {
	create: (rows) => rows,
	update10th: (rows) => Math.ceil(rows / 10),
	select: () => 1,
	clear: () => 0,
};
const WORK_STORM_OPS = new Set(['updateStorm', 'selectStorm']);
const WORK_FIELD_LABEL = { rowBodies: 'row bodies', blockVisits: 'block visits' };

/**
 * Per-op median and observed range for one family of per-rep count records.
 * The range travels with the median in both families, but it means opposite
 * things: for the floor counts a non-zero spread means the number is not the
 * invariant it is claimed to be, while for the wire counts it is the reportable
 * result — how much the tick/flush interleaving moved on this host.
 */
function statsByOp(samples, fields) {
	const entries = Object.entries(samples).filter(([, values]) => values.length > 0);
	if (entries.length === 0) return null;
	const summary = {};
	for (const [op, values] of entries) {
		summary[op] = {};
		for (const field of fields) {
			const observed = values.map((value) => value[field]);
			// A field no sample carries is a counter this cell does not publish,
			// which is a different fact from a zero and is reported as one: the
			// column is dropped rather than filled in.
			if (observed.some((value) => typeof value !== 'number')) continue;
			const min = Math.min(...observed);
			const max = Math.max(...observed);
			summary[op][field] = {
				median: observed.slice().sort((a, b) => a - b)[observed.length >> 1],
				min,
				max,
				spread: max - min,
			};
		}
	}
	return summary;
}

// Floor counters are deterministic for a given op and scale, so the spread is
// reported alongside the value: a non-zero spread means the count is not the
// invariant it is claimed to be, and the number should not be quoted as one.
function countsByOp(countSamples) {
	return statsByOp(countSamples, FLOOR_FIELDS);
}

/** 1/5/15-minute load averages, as the session header prints them. */
function formatLoad(load) {
	return load.map((value) => value.toFixed(2)).join('/');
}

async function main() {
	// Load is recorded, not gated: this harness reports whole-operation medians
	// whose absolute milliseconds are already declared host-bound, and a reader
	// cannot judge a same-window ratio without knowing how quiet the window was.
	const startLoad = os.loadavg();
	if (!args['skip-app-build']) {
		if (wanted.has('octane')) buildTableApp();
		for (const cell of ALL_CELLS) {
			if (cell.core === 'block' && wanted.has(cell.id)) {
				buildTableApp({ core: 'block', blockMode: cell.blockMode ?? 'scoped' });
			}
		}
	}

	const missing = CELLS.filter((cell) => !fs.existsSync(cell.bundle));
	const runnable = CELLS.filter((cell) => fs.existsSync(cell.bundle));
	for (const cell of missing) {
		console.warn(`[lynx-table] ${cell.id}: bundle missing (${cell.bundle}) — not measured.`);
	}

	const manifestPath = path.join(root, 'reference/manifest.json');
	const manifest = fs.existsSync(manifestPath)
		? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		: null;

	const server = await startServer();
	const { chromium } = require('playwright');
	const browser = await chromium.launch(chromiumLaunchOptions({ headless: !args.headed }));

	// cellId -> scale -> op -> stats|null
	const results = {};
	// Raw per-rep accumulators, filled by the interleaved schedule below and
	// summarized after the browser closes.
	const collected = {};
	for (const cell of runnable) {
		results[cell.id] = {};
		collected[cell.id] = {};
		for (const rows of SCALES)
			collected[cell.id][rows] = {
				samples: {},
				countSamples: {},
				wireSamples: {},
				workSamples: {},
				notMeasured: new Set(),
				dnf: 0,
			};
	}
	try {
		for (const rows of SCALES) {
			for (let rep = 0; rep < REPS; rep++) {
				// AB/BA: reverse the cell order every other repetition. Running all
				// of one cell's repetitions and then all of another's would let any
				// host drift over the run land entirely on the cell that went second,
				// which is exactly the error a same-window comparison exists to avoid.
				const order = rep % 2 === 0 ? runnable : [...runnable].reverse();
				for (const cell of order) {
					const bucket = collected[cell.id][rows];
					try {
						const { counts, wire, work, notMeasured, ...timings } = await runRep(
							browser,
							cell,
							rows,
						);
						for (const op of notMeasured ?? []) bucket.notMeasured.add(op);
						for (const [op, ms] of Object.entries(timings)) (bucket.samples[op] ??= []).push(ms);
						for (const [op, value] of Object.entries(counts ?? {}))
							(bucket.countSamples[op] ??= []).push(value);
						for (const [op, value] of Object.entries(wire ?? {}))
							(bucket.wireSamples[op] ??= []).push(value);
						for (const [op, value] of Object.entries(work ?? {}))
							(bucket.workSamples[op] ??= []).push(value);
					} catch (error) {
						if (process.env.LYNX_BENCH_DEBUG) console.log('[debug] rep error:', String(error));
						if (!String(error).includes('timeout')) throw error;
						bucket.dnf += 1;
					}
				}
			}
		}
	} finally {
		await browser.close();
		server.close();
	}
	for (const cell of runnable) {
		for (const rows of SCALES) {
			const bucket = collected[cell.id][rows];
			const ops = {};
			for (const op of OPS) ops[op] = bucket.samples[op] ? stats(bucket.samples[op]) : null;
			results[cell.id][rows] = {
				ops,
				counts: countsByOp(bucket.countSamples),
				wire: statsByOp(bucket.wireSamples, WIRE_FIELDS),
				work: statsByOp(bucket.workSamples, WORK_FIELDS),
				notMeasured: [...bucket.notMeasured],
				dnf: bucket.dnf,
			};
			// "not measured" is the op-not-present outcome (the app has no such
			// button); DNF is the op-timed-out outcome. Conflating them would report
			// an older bundle's missing Clear button as a failure.
			const missing = (op) => (bucket.notMeasured.has(op) ? 'not measured' : 'DNF');
			const cellText = OPS.map(
				(op) => `${op}=${ops[op] ? ops[op].median.toFixed(0) : missing(op)}`,
			).join(' ');
			console.log(`[web] ${cell.id.padEnd(10)} rows=${String(rows).padStart(5)} ${cellText}`);
		}
	}
	const endLoad = os.loadavg();

	// --- markdown report -----------------------------------------------------
	const lines = [];
	lines.push('# Octane on Lynx — unified table benchmark (Lynx for Web)');
	lines.push('');
	lines.push(`- date: ${new Date().toISOString()}`);
	lines.push(
		`- host: ${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'} (medians of n=${REPS}, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)`,
	);
	lines.push(
		`- host load: start ${formatLoad(startLoad)}, end ${formatLoad(endLoad)} (1/5/15m over ${os.cpus().length} CPUs)`,
	);
	if (manifest) lines.push(`- references: ${manifest.source} @ ${manifest.commit}`);
	if (COUNTER_BUILD) {
		const profiled = runnable.filter((cell) => cell.profiled).map((cell) => cell.id);
		const kept = runnable.filter((cell) => !cell.profiled).map((cell) => cell.id);
		lines.push(
			`- **counter build**: ${profiled.length === 0 ? 'no cell was' : `${profiled.join(', ')} ${profiled.length === 1 ? 'was' : 'were'}`} served from \`OCTANE_LYNX_PROFILE=1\` bundles, which carry the wire profiler's branches. The wire-count tables below are the result of this run; those cells' milliseconds are not the shipping configuration and must not be quoted beside a default-build session${kept.length === 0 ? '' : `, nor ratioed against the cells that kept their default or vendored builds (${kept.join(', ')})`}.`,
		);
	}
	for (const cell of missing) lines.push(`- ${cell.id}: not measured (bundle missing)`);
	for (const rows of SCALES) {
		lines.push('');
		lines.push(`## ${rows.toLocaleString('en-US')} rows (median ms; ×vs vue-vdom)`);
		lines.push('');
		lines.push(`| op | ${runnable.map((cell) => cell.id).join(' | ')} |`);
		lines.push(`|---|${runnable.map(() => '---').join('|')}|`);
		const reference = results['vue-vdom']?.[rows]?.ops;
		const missingLabel = (cellId, op) =>
			results[cellId][rows].notMeasured.includes(op) ? 'not measured' : 'DNF';
		for (const op of OPS) {
			const row = runnable.map((cell) => {
				const stat = results[cell.id][rows].ops[op];
				if (!stat) return missingLabel(cell.id, op);
				const referenceMedian = reference?.[op]?.median;
				const ratio =
					referenceMedian && cell.id !== 'vue-vdom'
						? ` (${(stat.median / referenceMedian).toFixed(2)}×)`
						: '';
				return `${stat.median.toFixed(0)} ±${stat.ci95?.toFixed(0) ?? '0'}${ratio}`;
			});
			lines.push(`| ${op} | ${row.join(' | ')} |`);
		}
		// Issue-#103 B0: the A/B the core switch exists to produce, printed as its
		// own ratio rather than left to be divided out of the vue-vdom column.
		// Same window, same page driver, same application entry — the build flag
		// is the only variable — but the block column runs a hand-written program
		// (app/src/block-program.ts), so it is an architecture ceiling and is
		// labelled as one wherever it is quoted.
		const universal = results['octane']?.[rows]?.ops;
		const octaneProfiled = Boolean(runnable.find((cell) => cell.id === 'octane')?.profiled);
		for (const cell of runnable) {
			if ((cell.core !== 'block' && cell.compare !== 'octane') || universal === undefined) continue;
			// A ratio is a same-configuration claim on top of the same-window one.
			// Under --counter-build only the app-dist cells are redirected to
			// profiler bundles, so a cell that kept its default build (octane-direct,
			// an injected --cell-bundle) would divide default-build milliseconds by
			// profiler-instrumented ones — the cross-configuration quote the header
			// forbids. Print the medians for the record; withhold the ratio.
			const comparable = Boolean(cell.profiled) === octaneProfiled;
			const block = results[cell.id][rows].ops;
			lines.push('');
			lines.push(`### ${cell.id} ÷ octane (${rows.toLocaleString('en-US')} rows, same window)`);
			lines.push('');
			if (!comparable) {
				lines.push(
					`> ${octaneProfiled ? 'octane' : cell.id} was served from an \`OCTANE_LYNX_PROFILE=1\` bundle and ${octaneProfiled ? cell.id : 'octane'} was not, so these columns are different build configurations: medians are printed for the record, ratios are withheld.`,
				);
				lines.push('');
			}
			lines.push('| op | octane | ' + cell.id + ' | ratio |');
			lines.push('|---|---:|---:|---:|');
			for (const op of OPS) {
				const before = universal[op];
				const after = block[op];
				const ratio = !comparable
					? 'withheld (cross-build)'
					: before && after
						? `${(after.median / before.median).toFixed(2)}×`
						: 'not measured';
				lines.push(
					`| ${op} | ${before ? before.median.toFixed(0) : missingLabel('octane', op)} | ${after ? after.median.toFixed(0) : missingLabel(cell.id, op)} | ${ratio} |`,
				);
			}
		}
		for (const cell of runnable) {
			const counts = results[cell.id][rows].counts;
			if (!counts) continue;
			lines.push('');
			lines.push(
				`### ${cell.id} — deterministic floor counts (${rows.toLocaleString('en-US')} rows)`,
			);
			lines.push('');
			lines.push(
				'Counts, not milliseconds: deterministic for this app and interaction, so they carry across hosts and sessions where the medians above do not. "Row regions visited" and "slot writes" are main-thread; "keyed block lookups" is what a keyed core touches on the background thread and "background row scans" is what this stub actually touched, which is larger wherever the stub keeps state in an array instead of a key map. Spread is the summed median-to-extreme range over all four columns and must be 0.',
			);
			lines.push('');
			lines.push(
				'| op | row regions visited | slot writes | keyed block lookups | background row scans | spread |',
			);
			lines.push('|---|---:|---:|---:|---:|---:|');
			for (const op of OPS) {
				const value = counts[op];
				if (!value) continue;
				const spread = FLOOR_FIELDS.reduce((sum, field) => sum + value[field].spread, 0);
				lines.push(
					`| ${op} | ${value.rowVisits.median.toLocaleString('en-US')} | ${value.writes.median.toLocaleString('en-US')} | ${value.blockLookups.median.toLocaleString('en-US')} | ${value.rowScans.median.toLocaleString('en-US')} | ${spread} |`,
				);
			}
		}
		// Row bodies: how much of the page each cell re-rendered to produce the
		// same paint. A cell that renders every row and then finds one changed
		// ships exactly what a cell that rendered one row ships, so this is the
		// only column in the report where that difference is visible at all.
		const workRange = (field) =>
			field.spread === 0
				? field.median.toLocaleString('en-US')
				: `${field.median.toLocaleString('en-US')} (${field.min.toLocaleString('en-US')}–${field.max.toLocaleString('en-US')})`;
		for (const cell of runnable) {
			const work = results[cell.id][rows].work;
			if (!work) continue;
			const present = WORK_FIELDS.filter((field) =>
				OPS.some((op) => work[op]?.[field] !== undefined),
			);
			if (present.length === 0) continue;
			lines.push('');
			lines.push(`### ${cell.id} — background work (${rows.toLocaleString('en-US')} rows)`);
			lines.push('');
			lines.push(
				'What the background thread did to produce each operation\'s paint, on the two axes the wire counts below cannot show. "Row bodies" is how many times the app\'s `Row` component body ran, counted by the app itself (`app/src/App.lynx.tsrx`); "block visits" is how many blocks the Block core looked up (`packages/lynx/src/core/block-core.ts`). A cell publishes a counter or it does not: the universal cell has no Block core, the two hand-written cells have no component body, and a column they do not publish is dropped rather than filled with a zero. Both are read under the same `--counter-build` flag as the wire counts. The single-change ops are invariants for this app and interaction, so their spread must be 0 and they carry across hosts and sessions; the storms are not, for the reason their commit counts are not, and their observed range is the result rather than noise. "Rows changed" is what the operation moved, printed beside the counts because they are unreadable without it — it is the change, not a budget, and a core may legitimately do more.',
			);
			lines.push('');
			const heading = present.map((field) => WORK_FIELD_LABEL[field]);
			lines.push(`| op | ${heading.join(' | ')} | rows changed | spread |`);
			lines.push(`|---|${present.map(() => '---:').join('|')}|---:|---:|`);
			for (const op of OPS) {
				const value = work[op];
				if (!value) continue;
				const changed = WORK_CHANGE_SIZE[op]?.(rows);
				// A field can be dropped for one op and kept for another, so this
				// prints per op rather than trusting the header: a report that
				// throws here loses a whole window that has already been measured.
				const cells = present.map((field) =>
					value[field] === undefined
						? '—'
						: WORK_STORM_OPS.has(op)
							? workRange(value[field])
							: value[field].median.toLocaleString('en-US'),
				);
				const spread = present.reduce((sum, field) => sum + (value[field]?.spread ?? 0), 0);
				lines.push(
					`| ${op} | ${cells.join(' | ')} | ${changed === undefined ? '—' : changed.toLocaleString('en-US')} | ${spread} |`,
				);
			}
		}
		// Wire counts: what each cell actually put on the wire for the same driver
		// script. Two cells whose milliseconds differ by more than their work does
		// are separated here or nowhere — a cell that ships fewer commits for the
		// same script is not faster at the same job, it is doing a smaller one.
		for (const cell of runnable) {
			const wire = results[cell.id][rows].wire;
			if (!wire) continue;
			lines.push('');
			lines.push(`### ${cell.id} — wire counts (${rows.toLocaleString('en-US')} rows)`);
			lines.push('');
			lines.push(
				'Commits dispatched by the background renderer and applied by the main thread, and the host commands they carried, per operation. "Of those, empty" is how many dispatched commits carried no host command at all, which is what separates a large batch split into chunks from a render pass that found nothing to say. These are counts rather than milliseconds, but unlike the floor counts above they are **not** invariants: a tick that renders while a commit is in flight folds into the next commit, so the count depends on how ticks and flushes interleaved on this host. The observed range is printed for that reason and must not be read as noise. The two ends are read across a live boundary, so bg and mt commit counts may differ by one where a commit crossed it; the command totals are what the two ends must agree on.',
			);
			lines.push('');
			lines.push('| op | bg commits | of those, empty | mt commits | bg commands | mt commands |');
			lines.push('|---|---:|---:|---:|---:|---:|');
			const cellRange = (field) =>
				field.spread === 0
					? field.median.toLocaleString('en-US')
					: `${field.median.toLocaleString('en-US')} (${field.min.toLocaleString('en-US')}–${field.max.toLocaleString('en-US')})`;
			for (const op of OPS) {
				const value = wire[op];
				if (!value) continue;
				lines.push(
					`| ${op} | ${cellRange(value.bgCommits)} | ${cellRange(value.bgEmptyCommits)} | ${cellRange(value.mtCommits)} | ${cellRange(value.bgCommands)} | ${cellRange(value.mtCommands)} |`,
				);
			}
		}
	}
	const report = lines.join('\n') + '\n';
	console.log('\n' + report);

	const outDir = path.join(root, 'results');
	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, 'web.md'), report);
	fs.writeFileSync(
		path.join(outDir, 'web.json'),
		JSON.stringify(
			{
				meta: {
					date: new Date().toISOString(),
					node: process.version,
					cpus: os.cpus().length,
					cpuModel: os.cpus()[0]?.model,
					loadStart: startLoad,
					loadEnd: endLoad,
					reps: REPS,
					scales: SCALES,
					reference: manifest,
					notMeasured: missing.map((cell) => cell.id),
				},
				results,
			},
			null,
			2,
		) + '\n',
	);
	console.log(`[lynx-table] wrote ${path.relative(root, path.join(outDir, 'web.md'))}`);

	// BENCH_JSON: the runner-facing payload, so `bench.mjs --record` can check
	// in a `lynx-table-web` baseline for the site's cross-framework Lynx chart.
	// Cells that could not be driven end-to-end are omitted entirely — "not
	// measured", never a number from a degraded run — and per-op DNFs stay null.
	if (process.env.BENCH_JSON) {
		const scaleLabel = (rows) => (rows % 1000 === 0 ? `${rows / 1000}k` : String(rows));
		const targets = runnable.map((cell) => {
			const ops = {};
			for (const rows of SCALES) {
				for (const op of OPS) {
					const stat = results[cell.id][rows].ops[op];
					if (!stat) continue;
					ops[`${op}_${scaleLabel(rows)}`] = {
						score: stat.median,
						median: stat.median,
						min: stat.min,
						mean: stat.mean,
						p95: stat.max,
						sd: stat.std,
						rme: stat.mean === 0 ? 0 : (stat.std / stat.mean) * 100,
						warmupRatio: 1,
						samples: stat.n,
					};
				}
			}
			return {
				name: cell.id,
				ops,
				meta: {
					dnf: Object.fromEntries(SCALES.map((rows) => [rows, results[cell.id][rows].dnf])),
				},
			};
		});
		fs.writeFileSync(
			process.env.BENCH_JSON,
			JSON.stringify(
				{
					suite: 'lynx-table-web',
					iterations: REPS,
					targets,
					...(missing.length === 0
						? null
						: { failed: `not measured (bundle missing): ${missing.map((c) => c.id).join(', ')}` }),
				},
				null,
				'\t',
			) + '\n',
		);
		if (missing.length !== 0) process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
