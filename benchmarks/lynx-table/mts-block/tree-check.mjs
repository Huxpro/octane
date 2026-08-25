/**
 * Issue-#163 C0 — the semantic control for the FCP numbers.
 *
 * A first-screen time is only comparable between two cells if they painted the
 * same first screen. `emit.mjs` refuses by name every prop the Lynx template-run
 * applier does not write, so a silently dropped prop should be impossible — but
 * "should be impossible" is an argument, and the comparison needs evidence.
 *
 * This loads each cell in the same window, waits for the same settle predicate
 * `run-fcp.mjs` uses, and reads back a normalized signature of the composed
 * tree: element tag, `class`, and text, in document order, shadow roots
 * pierced. Attributes outside that set are deliberately excluded — `octane-ref`
 * is the adoption handoff's selector attribute, and its absence from the two
 * program cells is the architecture under test, not a tree difference.
 *
 * Stylesheet text is held out of the structural signature and compared on its
 * own, because it is provenance rather than tree: the `octane` cell ships the
 * bundler's compiled `styleInfo`, while both program cells ship
 * `app/src/app.css` as authored. Those render the same page and are not the
 * same bytes, so folding them together would make every comparison fail for a
 * reason that is not the one being tested.
 *
 *   node mts-block/tree-check.mjs --rows 1000
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { makeBenchHtml, applyNeutralize } from '../web/driver-client.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: args } = parseArgs({
	options: { rows: { type: 'string', default: '1000' }, port: { type: 'string', default: '8379' } },
});
const ROWS = Number(args.rows);
const PORT = Number(args.port);

const CELLS = [
	{ id: 'octane', bundle: path.join(root, `app/dist-rows${ROWS}/main.web.bundle`) },
	{ id: 'octane-direct', bundle: path.join(root, `prototype/dist-rows${ROWS}/main.web.bundle`) },
	{ id: 'octane-mts-block', bundle: path.join(here, `dist-rows${ROWS}/main.web.bundle`) },
];
for (const cell of CELLS) {
	if (!fs.existsSync(cell.bundle)) throw new Error(`missing bundle for ${cell.id}: ${cell.bundle}`);
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
		: (CELLS.find((entry) => url.pathname === `/bundles/${entry.id}`)?.bundle ?? null);
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
});

async function signature(cell) {
	const page = await browser.newPage();
	try {
		await applyNeutralize(page);
		await page.goto(`http://127.0.0.1:${PORT}/bench.html`, { waitUntil: 'load' });
		const observation = await page.evaluate(
			async (request) => {
				globalThis.__x.createView(request.url);
				return globalThis.__x.fcp({ minContent: request.rows, idleMs: 300, timeoutMs: 120000 });
			},
			{ url: `http://127.0.0.1:${PORT}/bundles/${cell.id}`, rows: ROWS },
		);
		if (observation.dnf) throw new Error(`${cell.id}: FCP DNF`);
		return await page.evaluate(() => {
			const tree = [];
			const styles = [];
			const walk = (node, depth, inStyle) => {
				if (!node) return;
				if (node.nodeType === 3) {
					const text = node.textContent;
					if (inStyle) styles.push(text);
					else if (text.trim() !== '') tree.push(`${depth}|#text|${text}`);
					return;
				}
				if (node.nodeType === 1) {
					const tag = node.tagName.toLowerCase();
					tree.push(`${depth}|${tag}|${node.getAttribute('class') ?? ''}`);
					if (node.shadowRoot) walk(node.shadowRoot, depth + 1, inStyle);
					const styleChild = inStyle || tag === 'style' || tag === 'script';
					for (const child of node.childNodes || []) walk(child, depth + 1, styleChild);
					return;
				}
				for (const child of node.childNodes || []) walk(child, depth + 1, inStyle);
			};
			walk(document.body, 0, false);
			return { tree, styleBytes: styles.reduce((sum, text) => sum + text.length, 0) };
		});
	} finally {
		await page.close();
	}
}

const signatures = {};
for (const cell of CELLS) {
	signatures[cell.id] = await signature(cell);
	const observed = signatures[cell.id];
	console.log(
		`[tree] ${cell.id.padEnd(17)} ${observed.tree.length} nodes, ${observed.styleBytes} stylesheet bytes`,
	);
}
await browser.close();
server.close();

/** Compare two structural signatures, reporting the first place they differ. */
function compare(leftId, rightId) {
	const left = signatures[leftId].tree;
	const right = signatures[rightId].tree;
	for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
		if (left[i] === right[i]) continue;
		console.log(
			`[tree] ${leftId} != ${rightId}: first divergence at node ${i}\n` +
				`         ${leftId}: ${left[i] ?? '<end>'}\n` +
				`         ${rightId}: ${right[i] ?? '<end>'}\n` +
				`         lengths ${left.length} vs ${right.length}`,
		);
		return false;
	}
	console.log(`[tree] ${leftId} == ${rightId}: ${left.length} nodes identical`);
	return true;
}

// Both pairs matter, and they answer different questions. Against `octane-direct`
// the question is whether the derived program paints what the hand-written
// ceiling paints, which is what makes their FCP numbers a comparison rather than
// two unrelated measurements. Against `octane` it is whether either program
// paints what the framework's own universal path paints — the claim that the
// architecture is a different route to the same screen.
let ok = true;
ok = compare('octane-direct', 'octane-mts-block') && ok;
ok = compare('octane', 'octane-mts-block') && ok;
console.log(`[tree] host ${os.cpus().length} cpu; rows=${ROWS}; ${ok ? 'PASS' : 'DIVERGED'}`);
process.exit(ok ? 0 : 1);
