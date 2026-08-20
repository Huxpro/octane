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

import { DRIVER_CLIENT_JS, makeBenchHtml, applyNeutralize, stats } from './driver-client.mjs';
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
const CELLS = ALL_CELLS.filter((cell) => wanted.has(cell.id));

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
			const cell = ALL_CELLS.find((entry) => url.pathname === `/bundles/${entry.id}`);
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
		sample[name] = await run();
		const counts = await readFloorCounters(page);
		if (counts !== null) (sample.counts ??= {})[name] = counts;
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
	} finally {
		await page.close();
	}
	return sample;
}

const OPS = ['create', 'update10th', 'select', 'updateStorm', 'selectStorm'];
const FLOOR_FIELDS = ['rowVisits', 'writes', 'rowScans', 'blockLookups'];

// Floor counters are deterministic for a given op and scale, so the spread is
// reported alongside the value: a non-zero spread means the count is not the
// invariant it is claimed to be, and the number should not be quoted as one.
function countsByOp(countSamples) {
	const entries = Object.entries(countSamples).filter(([, values]) => values.length > 0);
	if (entries.length === 0) return null;
	const summary = {};
	for (const [op, values] of entries) {
		summary[op] = {};
		for (const field of FLOOR_FIELDS) {
			const observed = values.map((value) => value[field]);
			const min = Math.min(...observed);
			const max = Math.max(...observed);
			summary[op][field] = {
				median: observed.sort((a, b) => a - b)[observed.length >> 1],
				min,
				max,
				spread: max - min,
			};
		}
	}
	return summary;
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
	if (wanted.has('octane') && !args['skip-app-build']) buildTableApp();

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
	const executablePath = fs.existsSync('/opt/pw-browsers/chromium')
		? '/opt/pw-browsers/chromium'
		: undefined;
	const browser = await chromium.launch({
		headless: !args.headed,
		...(executablePath ? { executablePath } : null),
		args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
	});

	// cellId -> scale -> op -> stats|null
	const results = {};
	// Raw per-rep accumulators, filled by the interleaved schedule below and
	// summarized after the browser closes.
	const collected = {};
	for (const cell of runnable) {
		results[cell.id] = {};
		collected[cell.id] = {};
		for (const rows of SCALES) collected[cell.id][rows] = { samples: {}, countSamples: {}, dnf: 0 };
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
						const { counts, ...timings } = await runRep(browser, cell, rows);
						for (const [op, ms] of Object.entries(timings)) (bucket.samples[op] ??= []).push(ms);
						for (const [op, value] of Object.entries(counts ?? {}))
							(bucket.countSamples[op] ??= []).push(value);
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
				dnf: bucket.dnf,
			};
			const cellText = OPS.map((op) => `${op}=${ops[op] ? ops[op].median.toFixed(0) : 'DNF'}`).join(
				' ',
			);
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
	for (const cell of missing) lines.push(`- ${cell.id}: not measured (bundle missing)`);
	for (const rows of SCALES) {
		lines.push('');
		lines.push(`## ${rows.toLocaleString('en-US')} rows (median ms; ×vs vue-vdom)`);
		lines.push('');
		lines.push(`| op | ${runnable.map((cell) => cell.id).join(' | ')} |`);
		lines.push(`|---|${runnable.map(() => '---').join('|')}|`);
		const reference = results['vue-vdom']?.[rows]?.ops;
		for (const op of OPS) {
			const row = runnable.map((cell) => {
				const stat = results[cell.id][rows].ops[op];
				if (!stat) return 'DNF';
				const referenceMedian = reference?.[op]?.median;
				const ratio =
					referenceMedian && cell.id !== 'vue-vdom'
						? ` (${(stat.median / referenceMedian).toFixed(2)}×)`
						: '';
				return `${stat.median.toFixed(0)} ±${stat.ci95?.toFixed(0) ?? '0'}${ratio}`;
			});
			lines.push(`| ${op} | ${row.join(' | ')} |`);
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
