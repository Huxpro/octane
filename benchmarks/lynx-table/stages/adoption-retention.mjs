// Forced-GC lifecycle probe for compact first-tree adoption (#287).
//
// This is deliberately separate from `heap-retention.mjs`: that runner drives
// the background-only clear path, while this one requires the production-order
// dual-thread program build and observes the main-thread ownership container.
// Each repetition uses a fresh page and collects the renderer heap at five
// boundaries: before attach, after hand-over, after one row selection, after
// background unmount, and after the Octane main controller closes.
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import {
	applyMainRealmProbe,
	applyNeutralize,
	chromiumLaunchOptions,
	makeBenchHtml,
	stats,
} from '../web/driver-client.mjs';
import { writeEvidenceJson } from '../scripts/evidence.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '1000' },
		reps: { type: 'string', default: '5' },
		label: { type: 'string', default: 'adoption-retention' },
		port: { type: 'string', default: '8391' },
		'dist-tag': { type: 'string', default: 'retention-candidate' },
	},
});
const rows = Number(args.rows);
const repetitions = Number(args.reps);
const port = Number(args.port);
if (!Number.isSafeInteger(rows) || rows <= 0) throw new TypeError('--rows must be positive.');
if (!Number.isSafeInteger(repetitions) || repetitions < 3) {
	throw new TypeError('--reps must be an integer of at least 3.');
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(args['dist-tag'])) {
	throw new TypeError('--dist-tag must be lowercase alphanumeric with dashes.');
}

const bundle = path.join(
	root,
	`app/dist-mtsprogram-${args['dist-tag']}-rows${rows}-profile/main.web.bundle`,
);
if (!fs.existsSync(bundle)) throw new Error(`profile bundle missing: ${bundle}`);

const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const html = makeBenchHtml();
const mime = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.bundle': 'application/octet-stream',
};

function startServer() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		if (url.pathname === '/') {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(html);
			return;
		}
		let file = null;
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		else if (url.pathname === '/bundle') file = bundle;
		if (file === null || !fs.existsSync(file)) {
			response.writeHead(404);
			response.end('not found');
			return;
		}
		response.writeHead(200, {
			'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function mainProfile(page) {
	return page.evaluate(() => {
		const realm = globalThis.__OCTANE_LYNX_MT_REALM__;
		const profile = realm?.__OCTANE_LYNX_PROF;
		if (profile === undefined) return null;
		return {
			action: profile.firstTreeAction,
			settled: profile.firstTreeSettled,
			ownershipRuns: profile.firstTreeProgramOwnershipRuns,
			ownershipHosts: profile.firstTreeProgramOwnershipHosts,
			liveRuns: profile.firstTreeProgramOwnershipLiveRuns,
			liveHosts: profile.firstTreeProgramOwnershipLiveHosts,
			promotedHosts: profile.firstTreeProgramOwnershipPromotedHosts,
			fallback: profile.firstTreeProgramOwnershipFallback,
		};
	});
}

async function capture(page, cdp, phase) {
	await page.evaluate(() => {
		const realm = globalThis.__OCTANE_LYNX_MT_REALM__;
		if (typeof realm?.gc === 'function') realm.gc();
		if (typeof globalThis.gc === 'function') globalThis.gc();
	});
	await cdp.send('HeapProfiler.collectGarbage');
	const heap = await cdp.send('Runtime.getHeapUsage');
	return {
		phase,
		usedBytes: heap.usedSize,
		totalBytes: heap.totalSize,
		profile: await mainProfile(page),
		workers: page.workers().length,
		rows: await page.evaluate(() => globalThis.__x.rowCount()),
	};
}

async function backgroundWorker(page) {
	for (const worker of page.workers()) {
		const ownsRoot = await worker
			.evaluate(() => typeof globalThis.__OCTANE_BENCH_UNMOUNT__ === 'function')
			.catch(() => false);
		if (ownsRoot) return worker;
	}
	throw new Error('no background worker published the profile-only unmount hook.');
}

async function runLifecycle(page, cdp) {
	await page.evaluate((url) => globalThis.__x.createView(url), `http://127.0.0.1:${port}/bundle`);
	const paint = await page.evaluate(
		(count) => globalThis.__x.fcp({ rowCount: count, idleMs: 300, timeoutMs: 240000 }),
		rows,
	);
	if (paint.dnf) throw new Error(`first screen did not paint ${rows} rows.`);
	await page.waitForFunction(
		() => globalThis.__OCTANE_LYNX_MT_REALM__?.__OCTANE_LYNX_PROF?.firstTreeSettled >= 1,
		undefined,
		{ timeout: 60000 },
	);
	await page.evaluate(() => globalThis.__x.settle());
	const phases = [await capture(page, cdp, 'handOver')];

	const cell = await page.evaluate(() => globalThis.__x.cellRect(0, 'col-label'));
	if (cell === null) throw new Error('first row label is not clickable.');
	await page.mouse.click(cell.x, cell.y);
	await page.evaluate(() => globalThis.__x.until({ type: 'dangerAt', index: 0 }));
	await page.evaluate(() => globalThis.__x.settle());
	phases.push(await capture(page, cdp, 'sparseUpdate'));

	const worker = await backgroundWorker(page);
	await worker.evaluate(() => globalThis.__OCTANE_BENCH_UNMOUNT__());
	await page.waitForFunction(() => globalThis.__x.contentCount() === 0, undefined, {
		timeout: 60000,
	});
	await page.evaluate(() => globalThis.__x.settle());
	phases.push(await capture(page, cdp, 'unmount'));

	await page.evaluate(() => {
		const close = globalThis.__OCTANE_LYNX_MT_REALM__?.__OCTANE_BENCH_MAIN_CLOSE__;
		if (typeof close !== 'function') throw new Error('main controller published no close hook.');
		close();
	});
	phases.push(await capture(page, cdp, 'close'));
	return { paint, phases };
}

async function runSample(browser) {
	const page = await browser.newPage();
	try {
		await applyNeutralize(page);
		await applyMainRealmProbe(page);
		await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('HeapProfiler.enable');
		const phases = [await capture(page, cdp, 'fresh')];
		const lifecycle = await runLifecycle(page, cdp);
		phases.push(...lifecycle.phases);
		await cdp.detach();
		return { paint: lifecycle.paint, phases };
	} finally {
		await page.close();
	}
}

function headCommit() {
	try {
		return {
			commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
			dirty:
				execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
					.length !== 0,
		};
	} catch {
		return { commit: null, dirty: null };
	}
}

const server = await startServer();
const { chromium } = require('playwright');
const launch = chromiumLaunchOptions();
const browser = await chromium.launch({
	...launch,
	args: [...launch.args, '--js-flags=--expose-gc'],
});
const chromiumVersion = browser.version();
const samples = [];
try {
	for (let index = 0; index < repetitions; index++) samples.push(await runSample(browser));
} finally {
	await browser.close();
	server.close();
}

const phaseNames = ['fresh', 'handOver', 'sparseUpdate', 'unmount', 'close'];
const summary = Object.fromEntries(
	phaseNames.map((phase) => {
		const records = samples.map((sample) => sample.phases.find((item) => item.phase === phase));
		return [
			phase,
			{
				usedBytes: stats(records.map((record) => record?.usedBytes)),
				totalBytes: stats(records.map((record) => record?.totalBytes)),
				liveRuns: stats(records.map((record) => record?.profile?.liveRuns)),
				liveHosts: stats(records.map((record) => record?.profile?.liveHosts)),
				promotedHosts: stats(records.map((record) => record?.profile?.promotedHosts)),
			},
		];
	}),
);
const head = headCommit();
const record = {
	protocol: 'octane-issue287-adoption-retention-v1',
	label: args.label,
	createdAt: new Date().toISOString(),
	octaneCommit: head.commit,
	dirty: head.dirty,
	rows,
	repetitions,
	chromium: chromiumVersion,
	bundle: {
		path: path.relative(root, bundle),
		bytes: fs.statSync(bundle).size,
	},
	summary,
	samples,
};
const resultsDir = path.join(root, 'stages/results');
fs.mkdirSync(resultsDir, { recursive: true });
const stem = `${args.label}-${rows}`;
await writeEvidenceJson(path.join(resultsDir, `${stem}.json`), record);

const mib = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const lines = [
	`# Compact adoption forced-GC lifecycle — ${rows.toLocaleString('en-US')} rows`,
	'',
	`Commit \`${head.commit ?? 'unknown'}\`${head.dirty ? ' with local modifications' : ''}; ${repetitions} fresh pages; Chromium ${chromiumVersion}.`,
	'',
	'| phase | used heap median (range) | live runs | live hosts | promoted hosts |',
	'| --- | ---: | ---: | ---: | ---: |',
];
for (const phase of phaseNames) {
	const value = summary[phase];
	const heap = value.usedBytes;
	lines.push(
		`| ${phase} | ${mib(heap.median)} MiB (${mib(heap.min)}–${mib(heap.max)}) | ${value.liveRuns?.median ?? 'n/a'} | ${value.liveHosts?.median ?? 'n/a'} | ${value.promotedHosts?.median ?? 'n/a'} |`,
	);
}
const report = `${lines.join('\n')}\n`;
fs.writeFileSync(path.join(resultsDir, `${stem}.md`), report);
console.log(report);
console.log(`[adoption-retention] wrote stages/results/${stem}.{json,md}`);
