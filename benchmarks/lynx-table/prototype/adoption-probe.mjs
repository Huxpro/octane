/**
 * Did the main thread's first screen get *adopted*, or painted and then
 * repaired?
 *
 *   node prototype/adoption-probe.mjs --rows 10000
 *
 * `run-fcp.mjs` cannot answer this and should not try: FCP is the first frame,
 * and a repair lands after it, so a cell that paints fast and is then rebuilt
 * from the background's batch reports the same number as one that is kept. The
 * distinction matters because it decides what the FCP column *means* — against
 * `octane` it is only an apples-to-apples first-screen comparison for a cell
 * whose first screen survived. The `octane-block` cell's does not (see the
 * README), and that is exactly the thing a millisecond cannot show.
 *
 * Node identity can. Tag every row element at the first painted frame, hold
 * well past any plausible repaint of this many rows, then count how many tags
 * are still attached: a repair builds different elements, so a repaired tree
 * keeps none of them, while an adopted one keeps all of them. Counts only — no
 * wall clock is reported and no quiet host is needed.
 *
 * Cells are discovered the way `run-fcp.mjs` discovers them: a build that is
 * not there is simply not a cell.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { makeBenchHtml, applyNeutralize } from '../web/driver-client.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		port: { type: 'string', default: '8391' },
		/** How long to hold after the first paint before counting survivors. */
		'hold-ms': { type: 'string', default: '4000' },
	},
});
const ROWS = Number(args.rows);
const PORT = Number(args.port);
const HOLD_MS = Number(args['hold-ms']);

const CANDIDATES = [
	{ id: 'octane', bundle: path.join(root, `app/dist-rows${ROWS}/main.web.bundle`) },
	{ id: 'octane-block', bundle: path.join(root, `app/dist-block-rows${ROWS}/main.web.bundle`) },
	{
		id: 'octane-mts-program',
		bundle: path.join(root, `app/dist-mtsprogram-rows${ROWS}/main.web.bundle`),
	},
];
const CELLS = CANDIDATES.filter((cell) => fs.existsSync(cell.bundle));
if (CELLS.length === 0) {
	throw new Error(`no built bundles for ${ROWS} rows; see the README for the build commands`);
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
	const filePath = url.pathname.startsWith('/webcore/')
		? path.join(webCoreRoot, url.pathname.slice(9))
		: (CELLS.find((cell) => url.pathname === `/bundles/${cell.id}`)?.bundle ?? null);
	if (filePath === null || !fs.existsSync(filePath)) {
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

let failed = false;
for (const cell of CELLS) {
	const page = await browser.newPage();
	try {
		await applyNeutralize(page);
		await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
		const result = await page.evaluate(
			async (request) => {
				globalThis.__x.createView(request.url);
				// The exact row predicate, not the ladder's `minContent` one: a tag on a
				// tree that is still growing would count as a casualty of nothing.
				await globalThis.__x.fcp({
					spec: { type: 'rowCount', value: request.rows },
					idleMs: 0,
					timeoutMs: 120000,
				});
				const rows = () => globalThis.__x.findByClass('row');
				const painted = rows();
				for (const [index, node] of painted.entries()) {
					node.setAttribute('data-octane-adoption-probe', String(index));
				}
				await new Promise((resolve) => setTimeout(resolve, request.holdMs));
				const after = rows();
				return {
					painted: painted.length,
					after: after.length,
					survivors: after.filter((node) => node.hasAttribute('data-octane-adoption-probe')).length,
				};
			},
			{ url: `http://127.0.0.1:${PORT}/bundles/${cell.id}`, rows: ROWS, holdMs: HOLD_MS },
		);
		// A partial survival is neither adoption nor a repair, so it gets its own
		// word rather than being rounded to whichever it is closer to.
		const verdict =
			result.after !== ROWS
				? 'INCOMPLETE'
				: result.survivors === result.after
					? 'ADOPTED'
					: result.survivors === 0
						? 'REPAIRED'
						: 'MIXED';
		if (verdict === 'INCOMPLETE' || verdict === 'MIXED') failed = true;
		console.log(
			`${cell.id.padEnd(20)} painted=${result.painted} after=${result.after} survivors=${result.survivors} → ${verdict}`,
		);
	} finally {
		await page.close();
	}
}
await browser.close();
server.close();
if (failed) {
	throw new Error('a cell neither adopted nor repaired its first screen cleanly; see above');
}
