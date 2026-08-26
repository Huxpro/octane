/**
 * Raw view-attach FCP comparison for the mount-create ladder: the Octane
 * universal-path cell versus the L0 direct-emission prototype (issue #58),
 * plus any other bundle given via --cells. Fresh page per sample, cells
 * alternate AB/BA within one host window, identical driver and predicate
 * (`__x.fcp({minContent: rows, idleMs: 300})`, the same boundary
 * stages/run.mjs reports as "raw view-attach FCP").
 *
 *   node prototype/run-fcp.mjs --rows 10000 --reps 5
 *
 * The issue-#103 `octane-block` cell joins automatically once its bundle
 * exists, and so do the two issue-#163 program cells:
 *
 *   BENCH_CORE=block BENCH_AUTOROWS=10000 node scripts/build-app.mjs
 *   BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=10000 node scripts/build-app.mjs
 *   BENCH_CORE=block BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=10000 node scripts/build-app.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { makeBenchHtml, applyNeutralize, stats } from '../web/driver-client.mjs';
import { writeEvidenceJson } from '../scripts/evidence.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '5' },
		port: { type: 'string', default: '8378' },
		'allow-busy-host': { type: 'boolean', default: false },
		'out-suffix': { type: 'string', default: '' },
		// Repeatable `id=path` cells measured in the same window (for example a
		// preserved pre-change octane build as a same-harness baseline).
		extra: { type: 'string', multiple: true, default: [] },
	},
});
const ROWS = Number(args.rows);
const REPS = Number(args.reps);
const PORT = Number(args.port);

// Issue-#103 B0: the Block-core build of the same application entry, present
// only when it has been built (`BENCH_CORE=block BENCH_AUTOROWS=<rows> node
// scripts/build-app.mjs`). Absent, it is simply not a cell — a bundle that
// cannot be driven reports nothing rather than a number from a degraded run.
const BLOCK_BUNDLE = path.join(root, `app/dist-block-rows${ROWS}/main.web.bundle`);

// Issue-#163 C4b: the same entry again, built with the main-thread program
// backend, so its first screen is straight-line compiled code driving the
// Element PAPI rather than a description an interpreter walks per node. It is
// the cell this ladder exists to price: `octane` is what it replaces and
// `octane-direct` is the hand-written ceiling it is trying to reach. Built with
// `BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=<rows> node scripts/build-app.mjs`, and
// like the Block cell it is simply absent until then.
const MTS_PROGRAM_BUNDLE = path.join(root, `app/dist-mtsprogram-rows${ROWS}/main.web.bundle`);

// Issue-#163 C5: both switches on at once, which is the configuration oracle
// clause 1 actually names — "block-core FCP within 5% of the `octane-direct`
// ceiling cell". The two switches are orthogonal by construction (the backend
// moves the main-thread chunk, the core moves the background one), so the cell
// above prices the same first screen with the universal background beside it;
// this is the one the clause is written against, and the two together say
// whether the core the first screen is paired with costs anything at the
// boundary. Built with
// `BENCH_CORE=block BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=<rows> node scripts/build-app.mjs`.
const BLOCK_PROGRAM_BUNDLE = path.join(
	root,
	`app/dist-block-mtsprogram-rows${ROWS}/main.web.bundle`,
);

const CELLS = [
	{ id: 'octane', bundle: path.join(root, `app/dist-rows${ROWS}/main.web.bundle`) },
	{ id: 'octane-direct', bundle: path.join(here, `dist-rows${ROWS}/main.web.bundle`) },
	...(fs.existsSync(BLOCK_BUNDLE) ? [{ id: 'octane-block', bundle: BLOCK_BUNDLE }] : []),
	...(fs.existsSync(MTS_PROGRAM_BUNDLE)
		? [{ id: 'octane-mts-program', bundle: MTS_PROGRAM_BUNDLE }]
		: []),
	...(fs.existsSync(BLOCK_PROGRAM_BUNDLE)
		? [{ id: 'octane-block-program', bundle: BLOCK_PROGRAM_BUNDLE }]
		: []),
	...args.extra.map((entry) => {
		const separator = entry.indexOf('=');
		if (separator === -1) throw new Error(`--extra expects id=path, got ${entry}`);
		return {
			id: entry.slice(0, separator),
			bundle: path.resolve(root, entry.slice(separator + 1)),
		};
	}),
];
for (const cell of CELLS) {
	if (!fs.existsSync(cell.bundle)) {
		throw new Error(`missing bundle for ${cell.id}: ${cell.bundle}`);
	}
}

const load = os.loadavg()[0];
if (!args['allow-busy-host'] && load > 0.5 * os.cpus().length) {
	throw new Error(
		`host busy (1m load ${load.toFixed(2)} > 0.5×${os.cpus().length} CPUs); retry when quiet or pass --allow-busy-host for non-reportable runs`,
	);
}

const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const BENCH_HTML = makeBenchHtml();

const server = http.createServer((request, response) => {
	const url = new URL(request.url, 'http://localhost');
	if (url.pathname === '/' || url.pathname === '/bench.html') {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(BENCH_HTML);
		return;
	}
	let filePath = null;
	if (url.pathname.startsWith('/webcore/'))
		filePath = path.join(webCoreRoot, url.pathname.slice(9));
	else {
		const cell = CELLS.find((entry) => url.pathname === `/bundles/${entry.id}`);
		filePath = cell?.bundle ?? null;
	}
	if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		response.writeHead(404);
		response.end('not found');
		return;
	}
	const contentType = filePath.endsWith('.js')
		? 'text/javascript'
		: filePath.endsWith('.wasm')
			? 'application/wasm'
			: filePath.endsWith('.css')
				? 'text/css'
				: 'application/octet-stream';
	response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
	fs.createReadStream(filePath).pipe(response);
});
await new Promise((resolve) => server.listen(PORT, resolve));

const { chromium } = require('playwright');
const executablePath = fs.existsSync('/opt/pw-browsers/chromium')
	? '/opt/pw-browsers/chromium'
	: undefined;
const browser = await chromium.launch({
	headless: true,
	...(executablePath ? { executablePath } : null),
	args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});

async function sampleFcp(cell) {
	const page = await browser.newPage();
	try {
		await applyNeutralize(page);
		await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
		const observation = await page.evaluate(
			async (request) => {
				globalThis.__x.createView(request.url);
				return globalThis.__x.fcp({
					minContent: request.rows,
					idleMs: 300,
					timeoutMs: 120000,
				});
			},
			{ url: `http://127.0.0.1:${PORT}/bundles/${cell.id}`, rows: ROWS },
		);
		if (observation.dnf) throw new Error(`${cell.id}: FCP DNF`);
		const rowCount = await page.evaluate(() => globalThis.__x.rowCount());
		if (rowCount < ROWS) throw new Error(`${cell.id}: only ${rowCount} rows after settle`);
		// Which selector regime this arm actually ran in. A cell that installs a
		// `nodes-ref` selector on every node and one that installs none look the
		// same in the FCP column alone, so an unchanged number has to be
		// distinguishable from an unchanged build.
		const selectors = await page.evaluate(() => globalThis.__x.countAttribute('octane-ref'));
		return { fcp: observation.fcp, settled: observation.settled, selectors };
	} finally {
		await page.close();
	}
}

/**
 * Which first-screen regime this cell actually painted in.
 *
 * The `selector attrs` column below is read after the page settles, which is
 * the right moment for the question it was added for — did this arm install a
 * `nodes-ref` selector per node — but the wrong one for a compiled main-thread
 * program (issue #163). A program installs none by construction, and whatever
 * the adopting commit decides afterwards lands on top of that, so a settled
 * count can report the interpreted regime for a page the interpreter never
 * touched. Asked at the first painted frame, before any peer exists to adopt
 * anything, the same count separates them: 0 is a program, per-node is the
 * interpreted walk.
 *
 * Sampled on its own pages after the timed reps, so the timed path stays exactly
 * the path every earlier run on this ladder measured. Twice, and both readings
 * are reported: a regime is a structural property and should not move between
 * two loads of the same bundle, so a pair that disagrees is the finding.
 */
async function sampleFirstFrame(cell) {
	const readings = [];
	for (let sample = 0; sample < 2; sample += 1) {
		const page = await browser.newPage();
		try {
			await applyNeutralize(page);
			await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
			readings.push(
				await page.evaluate(async (url) => {
					globalThis.__x.createView(url);
					await globalThis.__x.fcp({ minContent: 1, idleMs: 0, timeoutMs: 120000 });
					return {
						rows: globalThis.__x.rowCount(),
						selectors: globalThis.__x.countAttribute('octane-ref'),
					};
				}, `http://127.0.0.1:${PORT}/bundles/${cell.id}`),
			);
		} finally {
			await page.close();
		}
	}
	return readings;
}

/** `rows/selectors`, or every distinct reading when the two disagree. */
function formatRegime(readings) {
	return [...new Set(readings.map((r) => `${r.rows}/${r.selectors}`))].join(' , ');
}

const samples = {};
for (let rep = 0; rep < REPS; rep += 1) {
	const order = rep % 2 === 0 ? CELLS : [...CELLS].reverse();
	for (const cell of order) {
		const observation = await sampleFcp(cell);
		(samples[cell.id] ??= []).push(observation);
		console.log(
			`[fcp] rep=${rep} ${cell.id.padEnd(13)} fcp=${observation.fcp.toFixed(1)}ms settled=${observation.settled.toFixed(1)}ms selectors=${observation.selectors}`,
		);
	}
}

const regimes = {};
for (const cell of CELLS) {
	regimes[cell.id] = await sampleFirstFrame(cell);
	console.log(
		`[regime] ${cell.id.padEnd(18)} at first painted frame (rows/selectors, n=2): ${formatRegime(regimes[cell.id])}`,
	);
}

await browser.close();
server.close();

const lines = [];
lines.push(`# Mount-create FCP@${ROWS} — ${CELLS.map((cell) => cell.id).join(' vs ')}`);
lines.push('');
lines.push(`- date: ${new Date().toISOString()}`);
lines.push(
	`- host: ${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}; load at start ${load.toFixed(2)}; Node ${process.version}`,
);
lines.push(`- protocol: fresh page per sample; cells alternate AB/BA; n=${REPS} per cell`);
lines.push('- boundary: view attach → first frame with the shared composed-tree predicate');
lines.push('');
lines.push(
	'| cell | median fcp ms | min–max | median settled ms | selector attrs | first frame rows/selectors |',
);
lines.push('|---|---:|---:|---:|---:|---:|');
for (const cell of CELLS) {
	const fcpStats = stats(samples[cell.id].map((sample) => sample.fcp));
	const settledStats = stats(samples[cell.id].map((sample) => sample.settled));
	const selectors = [...new Set(samples[cell.id].map((sample) => sample.selectors))];
	const regime = formatRegime(regimes[cell.id]);
	lines.push(
		`| ${cell.id} | ${fcpStats.median.toFixed(1)} | ${fcpStats.min.toFixed(1)}–${fcpStats.max.toFixed(1)} | ${settledStats.median.toFixed(1)} | ${selectors.join('/')} | ${regime} |`,
	);
}
const octaneMedian = stats(samples['octane'].map((sample) => sample.fcp)).median;
const directMedian = stats(samples['octane-direct'].map((sample) => sample.fcp)).median;
lines.push('');
lines.push(`Same-window direct/octane FCP ratio: ${(directMedian / octaneMedian).toFixed(3)}×`);
const report = lines.join('\n') + '\n';
console.log('\n' + report);
const outDir = path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `fcp-${ROWS}${args['out-suffix']}.md`), report);
await writeEvidenceJson(path.join(outDir, `fcp-${ROWS}${args['out-suffix']}.json`), {
	rows: ROWS,
	reps: REPS,
	samples,
	regimes,
});
console.log(`[fcp] wrote prototype/results/fcp-${ROWS}${args['out-suffix']}.md`);
