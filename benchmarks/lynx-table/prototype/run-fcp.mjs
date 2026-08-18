/**
 * Raw view-attach FCP comparison for the mount-create ladder: the Octane
 * universal-path cell versus the L0 direct-emission prototype (issue #58),
 * plus any other bundle given via --cells. Fresh page per sample, cells
 * alternate AB/BA within one host window, identical driver and predicate
 * (`__x.fcp({minContent: rows, idleMs: 300})`, the same boundary
 * stages/run.mjs reports as "raw view-attach FCP").
 *
 *   node prototype/run-fcp.mjs --rows 10000 --reps 5
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { makeBenchHtml, applyNeutralize, stats } from '../web/driver-client.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '5' },
		port: { type: 'string', default: '8378' },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});
const ROWS = Number(args.rows);
const REPS = Number(args.reps);
const PORT = Number(args.port);

const CELLS = [
	{ id: 'octane', bundle: path.join(root, `app/dist-rows${ROWS}/main.web.bundle`) },
	{ id: 'octane-direct', bundle: path.join(here, `dist-rows${ROWS}/main.web.bundle`) },
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
	if (url.pathname.startsWith('/webcore/')) filePath = path.join(webCoreRoot, url.pathname.slice(9));
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
		return { fcp: observation.fcp, settled: observation.settled };
	} finally {
		await page.close();
	}
}

const samples = {};
for (let rep = 0; rep < REPS; rep += 1) {
	const order = rep % 2 === 0 ? CELLS : [...CELLS].reverse();
	for (const cell of order) {
		const observation = await sampleFcp(cell);
		(samples[cell.id] ??= []).push(observation);
		console.log(
			`[fcp] rep=${rep} ${cell.id.padEnd(13)} fcp=${observation.fcp.toFixed(1)}ms settled=${observation.settled.toFixed(1)}ms`,
		);
	}
}

await browser.close();
server.close();

const lines = [];
lines.push(`# Mount-create FCP@${ROWS} — octane universal path vs direct-emission prototype`);
lines.push('');
lines.push(`- date: ${new Date().toISOString()}`);
lines.push(
	`- host: ${os.cpus().length}× ${os.cpus()[0]?.model ?? 'unknown'}; load at start ${load.toFixed(2)}; Node ${process.version}`,
);
lines.push(`- protocol: fresh page per sample; cells alternate AB/BA; n=${REPS} per cell`);
lines.push('- boundary: view attach → first frame with the shared composed-tree predicate');
lines.push('');
lines.push('| cell | median fcp ms | min–max | median settled ms |');
lines.push('|---|---:|---:|---:|');
for (const cell of CELLS) {
	const fcpStats = stats(samples[cell.id].map((sample) => sample.fcp));
	const settledStats = stats(samples[cell.id].map((sample) => sample.settled));
	lines.push(
		`| ${cell.id} | ${fcpStats.median.toFixed(1)} | ${fcpStats.min.toFixed(1)}–${fcpStats.max.toFixed(1)} | ${settledStats.median.toFixed(1)} |`,
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
fs.writeFileSync(path.join(outDir, `fcp-${ROWS}.md`), report);
fs.writeFileSync(
	path.join(outDir, `fcp-${ROWS}.json`),
	JSON.stringify({ rows: ROWS, reps: REPS, samples }, null, 2) + '\n',
);
console.log(`[fcp] wrote prototype/results/fcp-${ROWS}.md`);
