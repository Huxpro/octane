// Bounds the driver's own per-frame cost at each scale.
//
//   node stages/papi-predicate-cost.mjs --scales 1000,10000,30000
//
// The two measured windows resolve on different predicates: create polls
// `rowCount()`, a shallow scan of the row container, while FCP polls
// `contentCount()`, the composed-tree walk `stages/run.mjs` already uses. The
// FCP window therefore carries up to one polling frame of the more expensive
// walk that a create window does not, and that term lands in `off_boundary`.
//
// This measures both predicates on a settled tree at each scale so the report
// can state the bound instead of waving at it. It is a property of the driver
// and the composed tree, not of any framework, so one cell suffices — the walk
// visits the same published DOM whichever framework produced it.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { writeEvidenceJson } from '../scripts/evidence.mjs';

import {
	applyNeutralize,
	chromiumLaunchOptions,
	makeBenchHtml,
	stats,
} from '../web/driver-client.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		scales: { type: 'string', default: '1000,10000,30000' },
		reps: { type: 'string', default: '9' },
		port: { type: 'string', default: '8363' },
	},
});
const scales = args.scales.split(',').map((value) => Number(value.trim()));
const reps = Number(args.reps);
const port = Number(args.port);

const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const html = makeBenchHtml();
const MIME = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.bundle': 'application/octet-stream',
};

const server = await new Promise((resolve) => {
	const created = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		if (url.pathname === '/') {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(html);
			return;
		}
		let file = null;
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		else if (url.pathname.startsWith('/bundle/')) {
			file = path.join(root, `app/dist-rows${url.pathname.slice(8)}/main.web.bundle`);
		}
		if (file === null || !fs.existsSync(file)) {
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
	created.listen(port, '127.0.0.1', () => resolve(created));
});

const { chromium } = require('playwright');
const browser = await chromium.launch(chromiumLaunchOptions());
const measured = {};
try {
	for (const rows of scales) {
		const page = await browser.newPage();
		await applyNeutralize(page);
		await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
		await page.evaluate(
			(url) => globalThis.__x.createView(url),
			`http://127.0.0.1:${port}/bundle/${rows}`,
		);
		await page.waitForFunction((count) => globalThis.__x.contentCount() >= count, rows, {
			timeout: 240000,
			polling: 100,
		});
		await page.evaluate(() => globalThis.__x.settle(200));
		const sample = await page.evaluate((count) => {
			const time = (fn) => {
				const started = performance.now();
				const value = fn();
				return { ms: performance.now() - started, value };
			};
			const content = [];
			const row = [];
			for (let i = 0; i < count; i++) {
				content.push(time(() => globalThis.__x.contentCount()));
				row.push(time(() => globalThis.__x.rowCount()));
			}
			return {
				contentMs: content.map((entry) => entry.ms),
				rowMs: row.map((entry) => entry.ms),
				contentCount: content[0].value,
				rowCount: row[0].value,
			};
		}, reps);
		measured[rows] = {
			contentCount: sample.contentCount,
			rowCount: sample.rowCount,
			contentCountMs: stats(sample.contentMs),
			rowCountMs: stats(sample.rowMs),
		};
		console.log(
			`[predicate] rows=${rows} contentCount=${measured[rows].contentCountMs.median.toFixed(1)} ms (n=${sample.contentMs.length}), rowCount=${measured[rows].rowCountMs.median.toFixed(2)} ms`,
		);
		await page.close();
	}
} finally {
	await browser.close();
	server.close();
}

const output = path.join(import.meta.dirname, 'results');
fs.mkdirSync(output, { recursive: true });
await writeEvidenceJson(path.join(output, 'papi-predicate-cost.json'), {
	meta: {
		date: new Date().toISOString(),
		node: process.version,
		cpus: os.cpus().length,
		cpuModel: os.cpus()[0]?.model ?? 'unknown',
		chromium: browser.version(),
		reps,
		note: 'settled octane auto-rows tree; the walk is a driver property, not a framework one',
	},
	measured,
});
console.log('[predicate] wrote results/papi-predicate-cost.json');
