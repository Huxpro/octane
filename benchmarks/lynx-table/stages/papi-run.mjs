// Cross-framework Element PAPI / Web Core boundary decomposition.
//
//   node stages/papi-run.mjs --smoke --scales 1000 --allow-busy-host
//   node stages/papi-run.mjs --reps 5 --scales 1000,10000,30000
//   node stages/papi-run.mjs --cells octane,octane-profile --label papi-firstscreen
//
// `--label` stems every output basename, so a run over a different cell set
// writes beside the checked-in baseline instead of over it.
//
// The instrument is host-side (web/driver-client.mjs `papiInstrumentJs`): it
// wraps the single `Object.assign` with which @lynx-js/web-core installs the
// Element PAPI onto the main-thread script realm. Because the boundary belongs
// to the host, the identical probe applies to Octane, ReactLynx, and the Vue
// cells by construction — no framework is patched, no reference bundle is
// rebuilt, and the vendored bundles keep the hashes the featured runs recorded.
//
// Three page variants run in one interleaved host window:
//
//   control  no probe — the wall clock the other two are measured against
//   counts   host call counts, flush cadence, and start delay, with no
//            per-call clock read, so its wall clock stays representative
//   timed    adds the per-call brackets that exclusive host time needs
//
// Per page load the runner measures two windows with the byte-identical page
// driver: the app shell's startup paint, and the create@N click. Octane also
// carries a pre-populated auto-rows variant, so its FCP@N is measured
// directly; the vendored references have no such variant and are reported
// "not measured" rather than substituted from a different window.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import {
	analyzeBoundarySample,
	analyzeCountsSample,
	attributeDelta,
	countsAgree,
	overheadVerdict,
	requireMinimumRepetitions,
	requireOutputStem,
	rotatedSchedule,
	scalingVerdict,
	summarizeCell,
	summarizeCounts,
} from './papi-analyze.mjs';
import { renderBoundaryReport } from './papi-report.mjs';
import {
	applyNeutralize,
	applyStageClock,
	chromiumLaunchOptions,
	makeBenchHtml,
	papiInstrumentJs,
} from '../web/driver-client.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		reps: { type: 'string', default: '5' },
		scales: { type: 'string', default: '1000,10000,30000' },
		cells: { type: 'string', default: 'octane,react,vue-vdom' },
		label: { type: 'string', default: 'papi' },
		port: { type: 'string', default: '8362' },
		smoke: { type: 'boolean', default: false },
		'skip-build': { type: 'boolean', default: false },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});

const VARIANTS = ['control', 'counts', 'timed'];
const repetitions = args.smoke ? 1 : requireMinimumRepetitions(args.reps);
const scales = args.scales
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
if (scales.length === 0) throw new TypeError('at least one scale is required.');
for (const rows of scales) {
	if (!Number.isSafeInteger(rows) || rows <= 0) throw new TypeError('scales must be positive.');
}
// Every output basename is stemmed from `--label`, so a run that measures a
// different cell set writes its own files instead of overwriting the evidence a
// previous campaign checked in under the default stem.
const outputStem = requireOutputStem(args.label);
const port = Number(args.port);
const cpuCount = os.cpus().length;
const loadPerCpu = os.loadavg()[0] / cpuCount;
if (!args['allow-busy-host'] && loadPerCpu > 0.5) {
	throw new Error(
		`quiet-host preflight failed: 1-minute load ${os.loadavg()[0].toFixed(2)} / ${cpuCount} CPUs = ${loadPerCpu.toFixed(2)}; close competing work or pass --allow-busy-host and disclose it.`,
	);
}

// `bundle` is the shipping artifact every cell is driven through. `fcpBundle`
// is the pre-populated variant used for the direct FCP@N window; only the
// Octane app can be rebuilt here, so the vendored cells declare why they have
// none instead of borrowing a number from another window.
const CELLS = {
	octane: {
		bundle: () => path.join(root, 'app/dist/main.web.bundle'),
		fcpBundle: (rows) => path.join(root, `app/dist-rows${rows}/main.web.bundle`),
	},
	// The same app under `OCTANE_LYNX_PROFILE=1`, which is what publishes the
	// first-screen phase marker the boundary probe reads. It is a different build
	// configuration from the shipping `octane` cell, so it is a separate cell
	// rather than a flag on that one: its wall clock is only comparable to
	// itself, and the report has to be able to say so.
	'octane-profile': {
		bundle: () => path.join(root, 'app/dist-profile/main.web.bundle'),
		fcpBundle: (rows) => path.join(root, `app/dist-rows${rows}-profile/main.web.bundle`),
		profile: true,
	},
	react: {
		bundle: () => path.join(root, 'reference/react/main.web.bundle'),
		fcpBundle: () => null,
		fcpReason:
			'the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded',
	},
	'vue-vdom': {
		bundle: () => path.join(root, 'reference/vdom-ifr-et/main.web.bundle'),
		fcpBundle: () => null,
		fcpReason:
			'the vendored Vue vdom+IFR+ET bundle is a fixed black-box artifact; see the ReactLynx note',
	},
};
const cellIds = args.cells
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);
for (const id of cellIds) {
	if (CELLS[id] === undefined) throw new TypeError(`unknown cell ${id}.`);
}
// Every cross-cell delta is expressed against octane, so a run without it would
// have nothing to attribute against.
if (!cellIds.includes('octane')) throw new TypeError('the octane cell is required.');

const createLabels = new Map([
	[1000, 'Create 1,000 rows'],
	[3000, 'Create 3,000 rows'],
	[5000, 'Create 5,000 rows'],
	[10000, 'Create 10,000 rows'],
	[20000, 'Create 20,000 rows'],
	[30000, 'Create 30,000 rows'],
]);
for (const rows of scales) {
	if (!createLabels.has(rows)) throw new Error(`the shared app has no create button for ${rows}.`);
}

// --- bundles ----------------------------------------------------------------

function buildOctaneVariants({ profile = false } = {}) {
	const previousRows = process.env.BENCH_AUTOROWS;
	const previousProfile = process.env.OCTANE_LYNX_PROFILE;
	try {
		if (profile) process.env.OCTANE_LYNX_PROFILE = '1';
		else delete process.env.OCTANE_LYNX_PROFILE;
		for (const autoRows of ['0', ...scales.map(String)]) {
			process.env.BENCH_AUTOROWS = autoRows;
			buildTableApp({ silent: true });
		}
	} finally {
		if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
		else process.env.BENCH_AUTOROWS = previousRows;
		if (previousProfile === undefined) delete process.env.OCTANE_LYNX_PROFILE;
		else process.env.OCTANE_LYNX_PROFILE = previousProfile;
	}
}

const bundlePaths = new Map();
for (const id of cellIds) {
	bundlePaths.set(id, CELLS[id].bundle());
	for (const rows of scales) {
		const file = CELLS[id].fcpBundle(rows);
		if (file !== null) bundlePaths.set(`${id}-rows${rows}`, file);
	}
}

// --- server -----------------------------------------------------------------

// The three pages differ only by which probe build they carry, so the same
// bundle, the same driver, and the same predicates measure every variant.
const PAGES = {
	'/control': makeBenchHtml(),
	'/counts': makeBenchHtml({ instrumentJs: papiInstrumentJs({ timers: false }) }),
	'/timed': makeBenchHtml({ instrumentJs: papiInstrumentJs({ timers: true }) }),
};
const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const MIME = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.bundle': 'application/octet-stream',
};

/** The exact web-core build the boundary belongs to, recorded in the report. */
function webCoreVersion() {
	let directory = path.dirname(webCoreClientJs);
	while (directory !== path.dirname(directory)) {
		const manifest = path.join(directory, 'package.json');
		if (fs.existsSync(manifest)) {
			const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
			if (parsed.name === '@lynx-js/web-core') return parsed.version;
		}
		directory = path.dirname(directory);
	}
	throw new Error('could not resolve the @lynx-js/web-core version.');
}

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
		else if (url.pathname.startsWith('/bundle/')) file = bundlePaths.get(url.pathname.slice(8));
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

// --- page driving -----------------------------------------------------------

async function openPage(browser, variant) {
	const page = await browser.newPage();
	if (process.env.LYNX_BENCH_DEBUG) {
		page.on('console', (message) => console.log(`[console:${message.type()}]`, message.text()));
		page.on('pageerror', (error) => console.log('[pageerror]', String(error)));
	}
	await applyNeutralize(page);
	await applyStageClock(page);
	await page.goto(`http://127.0.0.1:${port}/${variant}`, { waitUntil: 'load' });
	return page;
}

/**
 * The main-thread slice start: the epoch at which the shared browser hook sees
 * the hidden main-thread iframe's Blob script URL assigned, before browser
 * load, parse, and evaluation. It is a host-side hook on that realm, so it is
 * the same start boundary for every framework.
 */
async function sliceStartEpoch(page) {
	const observed = await Promise.all(
		page
			.frames()
			.map((frame) =>
				frame
					.evaluate(() => globalThis.__OCTANE_LYNX_MT_SLICE_LOAD_START_EPOCH__ ?? null)
					.catch(() => null),
			),
	);
	const found = observed.filter((value) => typeof value === 'number' && Number.isFinite(value));
	if (found.length === 0) throw new Error('the main-thread slice start was never observed.');
	return Math.min(...found);
}

/**
 * Attach the view and observe the first composed paint in one page turn.
 * `paint` is `{ spec }` for a first screen with no row content, or
 * `{ minContent }` so the driver's fcp tick reuses the content count it
 * already walked instead of walking the composed tree a second time per
 * polling frame through `checkPredicate`.
 */
function attachAndObserve(page, bundleUrl, paint, timeoutMs) {
	return page.evaluate(
		(request) => {
			globalThis.__x.createView(request.bundleUrl);
			return globalThis.__x.fcp({ ...request.paint, idleMs: 300, timeoutMs: request.timeoutMs });
		},
		{ bundleUrl, paint, timeoutMs },
	);
}

async function clickAndWait(page, label, predicate, timeoutMs) {
	await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
		timeout: 60000,
	});
	await page.evaluate(() => globalThis.__x.settle());
	const armed = page.evaluate(
		(request) => globalThis.__x.arm(request.predicate, request.timeoutMs),
		{
			predicate,
			timeoutMs,
		},
	);
	const rectangle = await page.evaluate((text) => globalThis.__x.buttonRect(text), label);
	if (rectangle === null) throw new Error(`${label} button not found.`);
	await page.mouse.click(rectangle.x, rectangle.y);
	return armed;
}

const CREATE_TIMEOUT_MS = 240_000;
const SHELL_SPEC = { type: 'shellAtLeast', value: 1 };

function analyzeWindow(variant, window, label) {
	if (variant === 'timed') return analyzeBoundarySample(window, label);
	return analyzeCountsSample(window, label);
}

/**
 * One page load yields both startup windows: the shell's first composed paint
 * (slice start → paint) and the create@N click (pointerdown → all rows in the
 * composed tree). The probe is zeroed between them so create is attributed on
 * its own.
 */
async function runSample(browser, cell, rows, variant) {
	const page = await openPage(browser, variant);
	try {
		const startup = await attachAndObserve(
			page,
			`http://127.0.0.1:${port}/bundle/${cell}`,
			{ spec: SHELL_SPEC },
			60_000,
		);
		if (startup.dnf || startup.fcpEpoch === null) throw new Error(`${cell} shell never painted.`);
		const sliceStart = await sliceStartEpoch(page);
		if (variant !== 'control') {
			await page.evaluate(() => globalThis.__OCTANE_STAGE_PAPI_RESET__());
		}
		const created = await clickAndWait(
			page,
			createLabels.get(rows),
			{ type: 'rowCount', value: rows },
			CREATE_TIMEOUT_MS,
		);
		const sample = { startupMs: startup.fcpEpoch - sliceStart, createMs: created.ms };
		if (variant === 'control') return sample;
		return {
			...sample,
			startup: analyzeWindow(
				variant,
				{ wallMs: sample.startupMs, startEpoch: sliceStart, papi: startup.papiAtFcp },
				`${cell} startup`,
			),
			create: analyzeWindow(
				variant,
				{ wallMs: created.ms, startEpoch: created.startEpoch, papi: created.papiAtDone },
				`${cell} create@${rows}`,
			),
		};
	} finally {
		await page.close();
	}
}

/** Direct FCP@N on a pre-populated bundle: slice start → all N rows painted. */
async function runFcpSample(browser, cell, rows, variant) {
	const page = await openPage(browser, variant);
	try {
		const observed = await attachAndObserve(
			page,
			`http://127.0.0.1:${port}/bundle/${cell}-rows${rows}`,
			{ minContent: rows },
			CREATE_TIMEOUT_MS,
		);
		if (observed.dnf || observed.fcpEpoch === null) throw new Error(`${cell} FCP@${rows} DNF.`);
		const sliceStart = await sliceStartEpoch(page);
		const wallMs = observed.fcpEpoch - sliceStart;
		if (variant === 'control') return { fcpMs: wallMs };
		return {
			fcpMs: wallMs,
			fcp: analyzeWindow(
				variant,
				{ wallMs, startEpoch: sliceStart, papi: observed.papiAtFcp },
				`${cell} FCP@${rows}`,
			),
		};
	} finally {
		await page.close();
	}
}

/** The host clock's observable granularity, recorded so quantization is visible. */
async function clockGranularityMs(browser) {
	const page = await browser.newPage();
	try {
		await page.goto(`http://127.0.0.1:${port}/control`, { waitUntil: 'load' });
		return await page.evaluate(() => {
			let smallest = Infinity;
			for (let i = 0; i < 200000; i++) {
				const a = performance.now();
				const b = performance.now();
				if (b > a && b - a < smallest) smallest = b - a;
			}
			return Number.isFinite(smallest) ? smallest : null;
		});
	} finally {
		await page.close();
	}
}

// --- run --------------------------------------------------------------------

if (!args['skip-build']) {
	if (cellIds.includes('octane')) buildOctaneVariants();
	if (cellIds.includes('octane-profile')) buildOctaneVariants({ profile: true });
}
for (const [name, file] of bundlePaths) {
	if (!fs.existsSync(file)) throw new Error(`${name} bundle is missing: ${file}`);
}

const server = await startServer();
const { chromium } = require('playwright');
const browser = await chromium.launch(chromiumLaunchOptions());
const browserVersion = browser.version();
const loadStart = os.loadavg();
const samples = {};
let granularity = null;
try {
	granularity = await clockGranularityMs(browser);
	const schedule = args.smoke ? [VARIANTS] : rotatedSchedule(repetitions, VARIANTS);
	for (const rows of scales) {
		samples[rows] = {};
		for (const id of cellIds) {
			samples[rows][id] = {
				control: [],
				counts: [],
				timed: [],
				fcp: { control: [], counts: [], timed: [] },
			};
		}
		for (const order of schedule) {
			for (const variant of order) {
				for (const id of cellIds) {
					const sample = await runSample(browser, id, rows, variant);
					samples[rows][id][variant].push(sample);
					let fcpText = '';
					if (CELLS[id].fcpBundle(rows) !== null) {
						const fcp = await runFcpSample(browser, id, rows, variant);
						samples[rows][id].fcp[variant].push(fcp);
						fcpText = ` fcp=${fcp.fcpMs.toFixed(0)}`;
					}
					console.log(
						`[papi] rows=${rows} ${id.padEnd(9)} ${variant.padEnd(7)} startup=${sample.startupMs.toFixed(0)} create=${sample.createMs.toFixed(0)}${fcpText}`,
					);
				}
			}
		}
	}
} finally {
	await browser.close();
	server.close();
}

const meta = {
	date: new Date().toISOString(),
	node: process.version,
	cpus: cpuCount,
	cpuModel: os.cpus()[0]?.model ?? 'unknown',
	platform: os.platform(),
	release: os.release(),
	chromium: browserVersion,
	clockGranularityMs: granularity,
	repetitions,
	scales,
	cells: cellIds,
	variants: VARIANTS,
	reportable: !args.smoke,
	loadStart,
	loadEnd: os.loadavg(),
	webCore: webCoreVersion(),
	referenceManifest: fs.existsSync(path.join(root, 'reference/manifest.json'))
		? JSON.parse(fs.readFileSync(path.join(root, 'reference/manifest.json'), 'utf8'))
		: null,
	protocol:
		'fresh page per sample; control/counts/timed order rotates across repetitions in one host window; startup and create are measured in the same page load; the probe is host-side, so every variant runs the same framework bundle',
};

const output = path.join(import.meta.dirname, 'results');
fs.mkdirSync(output, { recursive: true });

if (args.smoke) {
	fs.writeFileSync(
		path.join(output, `${outputStem}-smoke.json`),
		JSON.stringify({ meta: { ...meta, reportable: false }, samples }, null, 2) + '\n',
	);
	console.log('[papi] smoke passed (not reportable).');
	process.exit(0);
}

const report = { meta, scales: {} };
for (const rows of scales) {
	const cells = {};
	for (const id of cellIds) {
		const cell = samples[rows][id];
		const timedCreate = summarizeCell(
			cell.timed.map((sample) => sample.create),
			{ rows },
		);
		const countedCreate = summarizeCounts(
			cell.counts.map((sample) => sample.create),
			{ rows },
		);
		cells[id] = {
			startup: {
				timed: summarizeCell(
					cell.timed.map((sample) => sample.startup),
					{ rows: null },
				),
				counts: summarizeCounts(cell.counts.map((sample) => sample.startup)),
				overhead: {
					counts: overheadVerdict(
						cell.counts.map((sample) => sample.startupMs),
						cell.control.map((sample) => sample.startupMs),
					),
					timed: overheadVerdict(
						cell.timed.map((sample) => sample.startupMs),
						cell.control.map((sample) => sample.startupMs),
					),
				},
			},
			create: {
				timed: timedCreate,
				counts: countedCreate,
				agreement: countsAgree(timedCreate, countedCreate),
				overhead: {
					counts: overheadVerdict(
						cell.counts.map((sample) => sample.createMs),
						cell.control.map((sample) => sample.createMs),
					),
					timed: overheadVerdict(
						cell.timed.map((sample) => sample.createMs),
						cell.control.map((sample) => sample.createMs),
					),
				},
			},
			fcp:
				cell.fcp.timed.length === 0
					? { measured: false, reason: CELLS[id].fcpReason ?? 'no pre-populated bundle' }
					: {
							measured: true,
							timed: summarizeCell(
								cell.fcp.timed.map((sample) => sample.fcp),
								{ rows },
							),
							counts: summarizeCounts(
								cell.fcp.counts.map((sample) => sample.fcp),
								{ rows },
							),
							overhead: {
								counts: overheadVerdict(
									cell.fcp.counts.map((sample) => sample.fcpMs),
									cell.fcp.control.map((sample) => sample.fcpMs),
								),
								timed: overheadVerdict(
									cell.fcp.timed.map((sample) => sample.fcpMs),
									cell.fcp.control.map((sample) => sample.fcpMs),
								),
							},
						},
		};
	}
	// Deltas are octane-vs-reference by construction; the CLI already requires
	// the octane cell up front, so a subject is always present here.
	const deltas = {};
	for (const id of cellIds) {
		if (id === 'octane') continue;
		// The profile cell carries the wire profiler's branches, so it is a
		// different build configuration from every other cell here. Its numbers
		// apportion its own window and nothing else; ratioing it against the
		// shipping build or a vendored reference would compare two builds and
		// report the difference as a framework gap.
		if (CELLS[id].profile === true) continue;
		deltas[id] = {
			create: attributeDelta({
				subject: cells.octane.create.timed,
				reference: cells[id].create.timed,
			}),
			startup: attributeDelta({
				subject: cells.octane.startup.timed,
				reference: cells[id].startup.timed,
			}),
			// The certified wall-clock delta, from the pass with no per-call clock
			// reads, so the reader can see whether probing changed the gap itself.
			createControlDeltaMs:
				cells.octane.create.overhead.timed.control.median -
				cells[id].create.overhead.timed.control.median,
			createCountsDeltaMs:
				cells.octane.create.counts.total.median - cells[id].create.counts.total.median,
			startupCountsDeltaMs:
				cells.octane.startup.counts.total.median - cells[id].startup.counts.total.median,
		};
	}
	report.scales[rows] = { cells, deltas };
}

report.scaling = {};
if (scales.length >= 2) {
	for (const id of cellIds) {
		// Scaling reads the counts build: op counts and flush cadence are the
		// load-bearing facts here, and that build measures them without a
		// per-call clock read.
		report.scaling[id] = scalingVerdict(
			Object.fromEntries(scales.map((rows) => [rows, report.scales[rows].cells[id].create.counts])),
		);
	}
}

// --- report ---------------------------------------------------------------

// The evidence lands first, then the report is rendered from it by the same
// module anyone can re-run over the checked-in JSON. A wording or attribution
// change never costs another measurement window.
for (const rows of scales) {
	fs.writeFileSync(
		path.join(output, `${outputStem}-${rows}.json`),
		JSON.stringify({ meta, rows, ...report.scales[rows], samples: samples[rows] }, null, 2) + '\n',
	);
}
fs.writeFileSync(
	path.join(output, `${outputStem}-scaling.json`),
	JSON.stringify({ meta, scaling: report.scaling }, null, 2) + '\n',
);
const text = renderBoundaryReport(
	scales.map((rows, index) => ({
		meta,
		rows,
		...report.scales[rows],
		...(index === 0 ? { scaling: report.scaling } : null),
	})),
);
fs.writeFileSync(path.join(output, `${outputStem}-boundary.md`), text + '\n');
console.log('\n' + text);
console.log(`[papi] wrote ${path.relative(root, path.join(output, `${outputStem}-boundary.md`))}`);
