/**
 * Functional smoke for the direct-emission prototype cell: mounts the bundle
 * in web-core, drives every benchmark operation through the shared driver, and
 * asserts the composed-DOM outcomes (row counts, labels, selection class).
 * Run before any measurement session:
 *
 *   node prototype/smoke.mjs [--rows 1000] [--bundle dist/main.web.bundle]
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

const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '1000' },
		bundle: { type: 'string', default: 'dist/main.web.bundle' },
		fcp: { type: 'boolean', default: false },
		port: { type: 'string', default: '8377' },
	},
});
const ROWS = Number(args.rows);
const PORT = Number(args.port);
const BUNDLE = path.resolve(here, args.bundle);

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
	else if (url.pathname === '/bundle') filePath = BUNDLE;
	if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		response.writeHead(404);
		response.end('not found');
		return;
	}
	const type = filePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
	response.writeHead(200, {
		'content-type': filePath.endsWith('.js') ? 'text/javascript' : type,
		'cache-control': 'no-store',
	});
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
});
const page = await browser.newPage();
page.on('console', (message) =>
	console.log(`[console:${message.type()}]`, message.text().slice(0, 300)),
);
page.on('pageerror', (error) => console.log('[pageerror]', String(error).slice(0, 500)));
await applyNeutralize(page);
await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
await page.evaluate((url) => globalThis.__x.createView(url), `http://127.0.0.1:${PORT}/bundle`);
await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
	timeout: 30_000,
	polling: 16,
});
console.log('[smoke] mounted');

const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => ev(() => globalThis.__x.settle());
async function click(label) {
	const rect = await ev((l) => globalThis.__x.buttonRect(l), label);
	if (!rect) throw new Error(`button not found: ${label}`);
	await page.mouse.click(rect.x, rect.y);
}
async function measure(label, spec, timeoutMs = 120_000) {
	await settle();
	const armed = ev((r) => globalThis.__x.arm(r.spec, r.timeoutMs), { spec, timeoutMs });
	await click(label);
	return (await armed).ms;
}
const rowCount = () => ev(() => globalThis.__x.rowCount());
const labelAt = (index) => ev((i) => globalThis.__x.labelAt(i), index);

let failed = false;
function check(name, ok, detail = '') {
	console.log(`[smoke] ${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
	if (!ok) failed = true;
}

if (args.fcp) {
	const result = await ev(
		(rows) => globalThis.__x.fcp({ minContent: rows, idleMs: 300, timeoutMs: 60_000 }),
		ROWS,
	);
	check(
		'fcp rows visible',
		!result.dnf && (await ev(() => globalThis.__x.rowCount())) >= ROWS,
		`fcp=${result.fcp?.toFixed(1)}ms settled=${result.settled?.toFixed(1)}ms`,
	);
} else {
	const createLabel = `Create ${ROWS.toLocaleString('en-US')} rows`;
	const createMs = await measure(createLabel, { type: 'rowCount', value: ROWS });
	check('create', (await rowCount()) === ROWS, `${createMs.toFixed(1)}ms`);

	const before = await labelAt(0);
	const updateMs = await measure('Update every 10th row', {
		type: 'labelAt',
		index: 0,
		equals: `${before} !!!`,
	});
	check('update10th', (await labelAt(0)) === `${before} !!!`, `${updateMs.toFixed(1)}ms`);

	await settle();
	const cellRect = await ev((r) => globalThis.__x.cellRect(r.rowIndex, r.cls), {
		rowIndex: 1,
		cls: 'col-label',
	});
	const selectArmed = ev((s) => globalThis.__x.arm(s, 60_000), { type: 'dangerAt', index: 1 });
	await page.mouse.click(cellRect.x, cellRect.y);
	const selectMs = (await selectArmed).ms;
	check('select', true, `${selectMs.toFixed(1)}ms`);

	const removeRect = await ev((r) => globalThis.__x.cellRect(r.rowIndex, r.cls), {
		rowIndex: 1,
		cls: 'col-remove',
	});
	await page.mouse.click(removeRect.x, removeRect.y);
	await page.waitForFunction((rows) => globalThis.__x.rowCount() === rows - 1, ROWS, {
		timeout: 10_000,
		polling: 16,
	});
	check('remove', true);

	if (ROWS >= 1000) {
		const label1 = await labelAt(1);
		const label998 = await labelAt(998);
		await click('Swap Rows');
		await page.waitForFunction((expected) => globalThis.__x.labelAt(998) === expected, label1, {
			timeout: 10_000,
			polling: 16,
		});
		check('swap', (await labelAt(1)) === label998);
	}

	const stormMs = await measure(
		'Update storm',
		{ type: 'labelAt', index: 0, equals: 'bench 50' },
		240_000,
	);
	check('updateStorm', true, `${stormMs.toFixed(1)}ms`);

	const selectStormMs = await measure('Select storm', { type: 'dangerAt', index: 0 }, 240_000);
	check('selectStorm', true, `${selectStormMs.toFixed(1)}ms`);

	await click('Clear');
	await page.waitForFunction(() => globalThis.__x.rowCount() === 0, undefined, {
		timeout: 10_000,
		polling: 16,
	});
	check('clear', true);
}

await browser.close();
server.close();
if (failed) {
	console.error('[smoke] FAILED');
	process.exit(1);
}
console.log('[smoke] all checks passed');
