import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { applyNeutralize, makeBenchHtml } from '../web/driver-client.mjs';
import {
	attachOnlyWorker,
	collectHeap,
	startCpuProfile,
	stopCpuProfile,
	summarizeCpuProfile,
	takeHeapSnapshot,
} from './cdp.mjs';
import { loadArtifactTargets, loadVendoredReferences, selectTargetIds } from './targets.mjs';

const require = createRequire(import.meta.url);
const benchmarkRoot = path.resolve(import.meta.dirname, '..');
const resultRoot = path.join(import.meta.dirname, 'results');
const snapshotRoot = path.join(import.meta.dirname, 'snapshots');
const { values: args } = parseArgs({
	options: {
		targets: { type: 'string' },
		manifest: { type: 'string', default: 'artifacts/manifest.json' },
		modes: { type: 'string', default: 'heap,cpu,cold,storm' },
		scales: { type: 'string', default: '1000,10000,30000' },
		reps: { type: 'string' },
		'cold-samples': { type: 'string' },
		port: { type: 'string', default: '8362' },
		snapshots: { type: 'string' },
		output: { type: 'string', default: 'raw.json' },
		'bundle-variant': { type: 'string' },
		smoke: { type: 'boolean', default: false },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});
const manifestFile = path.resolve(import.meta.dirname, args.manifest);
const artifactTargets = loadArtifactTargets(manifestFile);
const availableTargets = [...artifactTargets, ...loadVendoredReferences(benchmarkRoot)];
if (new Set(availableTargets.map((target) => target.id)).size !== availableTargets.length) {
	throw new Error('artifact and reference target ids must be unique.');
}
const targets = selectTargetIds(
	availableTargets,
	args.targets ?? artifactTargets.map((target) => target.id).join(','),
);
const bundleVariant =
	args['bundle-variant'] ??
	(artifactTargets.every((target) => target.instrument === true) ? 'profile' : 'control');
const modes = new Set(args.modes.split(',').filter(Boolean));
const scales = args.scales.split(',').map(Number);
const repetitions = Number(args.reps ?? (args.smoke ? '1' : '5'));
const coldSamples = Number(args['cold-samples'] ?? (args.smoke ? '2' : '5'));
const port = Number(args.port);
const snapshotTargets = new Set(args.snapshots?.split(',').filter(Boolean) ?? []);
const outputName = path.basename(args.output);
if (!['profile', 'control'].includes(bundleVariant))
	throw new TypeError('--bundle-variant must be profile or control.');
const manifestVariant = artifactTargets.every(
	(target) => target.instrument === true && target.profile === true,
)
	? 'profile'
	: 'control';
if (bundleVariant !== manifestVariant) {
	throw new Error(`--bundle-variant ${bundleVariant} does not match ${manifestVariant} artifacts.`);
}
const knownModes = new Set(['heap', 'cpu', 'cold', 'storm']);
const unknownModes = [...modes].filter((mode) => !knownModes.has(mode));
if (modes.size === 0 || unknownModes.length !== 0) {
	throw new TypeError(`--modes contains unknown values: ${unknownModes.join(', ') || '(empty)'}.`);
}
if (modes.has('storm') && bundleVariant !== 'profile') {
	throw new Error('storm mode requires the profiled bundle variant.');
}
if (!Number.isSafeInteger(repetitions) || repetitions < (args.smoke ? 1 : 5)) {
	throw new TypeError(
		args.smoke ? '--reps must be a positive integer.' : '--reps must be at least 5.',
	);
}
if (!Number.isSafeInteger(coldSamples) || coldSamples < 2)
	throw new TypeError('--cold-samples must be at least 2.');
if (scales.some((value) => !Number.isSafeInteger(value) || value <= 0))
	throw new TypeError('--scales must contain positive integers.');
if (!args['allow-busy-host'] && os.loadavg()[0] / os.cpus().length > 0.5) {
	throw new Error('quiet-host preflight failed; close competing work or pass --allow-busy-host.');
}

const CREATE_BUTTON = new Map([
	[1000, 'Create 1,000 rows'],
	[3000, 'Create 3,000 rows'],
	[5000, 'Create 5,000 rows'],
	[10000, 'Create 10,000 rows'],
	[20000, 'Create 20,000 rows'],
	[30000, 'Create 30,000 rows'],
]);
const bundles = new Map(targets.map((target) => [target.id, target.bundleFile]));
for (const [id, bundle] of bundles) {
	if (!fs.existsSync(bundle)) throw new Error(`missing ${id} attribution bundle: ${bundle}`);
}

const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const html = makeBenchHtml();
function startServer() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		let file = null;
		if (url.pathname === '/') {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(html);
			return;
		}
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		if (url.pathname.startsWith('/bundle/')) file = bundles.get(url.pathname.slice(8));
		if (file === null || file === undefined || !fs.existsSync(file)) {
			response.writeHead(404);
			response.end('not found');
			return;
		}
		const mime = {
			'.js': 'text/javascript',
			'.css': 'text/css',
			'.wasm': 'application/wasm',
			'.bundle': 'application/octet-stream',
		};
		response.writeHead(200, {
			'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(response);
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function loadPage(browser, target) {
	const page = await browser.newPage();
	if (process.env.LYNX_BENCH_DEBUG) {
		page.on('console', (message) =>
			console.log(`[console:${target.id}:${message.type()}]`, message.text().slice(0, 1000)),
		);
		page.on('pageerror', (error) =>
			console.log(`[pageerror:${target.id}]`, String(error).slice(0, 2000)),
		);
	}
	await applyNeutralize(page);
	await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
	await page.evaluate(
		(url) => globalThis.__x.createView(url),
		`http://127.0.0.1:${port}/bundle/${target.id}`,
	);
	await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
		timeout: 60000,
	});
	await page.evaluate(() => globalThis.__x.settle());
	if (!page.workers().some((worker) => worker.url().includes('web-core-worker-chunk.js'))) {
		await page.waitForEvent('worker', {
			predicate: (worker) => worker.url().includes('web-core-worker-chunk.js'),
			timeout: 60000,
		});
	}
	if (backgroundWorker(page) === null) {
		throw new Error(
			`${target.id}: expected one background worker, found ${page.workers().length}: ${page
				.workers()
				.map((worker) => worker.url())
				.join(', ')}`,
		);
	}
	return page;
}

function backgroundWorker(page) {
	return page.workers().find((worker) => worker.url().includes('web-core-worker-chunk.js')) ?? null;
}

async function backgroundTargetCount(browser) {
	const session = await browser.newBrowserCDPSession();
	try {
		const { targetInfos } = await session.send('Target.getTargets');
		return targetInfos.filter(
			(target) => target.type === 'worker' && target.url.includes('web-core-worker-chunk.js'),
		).length;
	} finally {
		await session.detach();
	}
}

async function buttonRect(page, label) {
	const rectangle = await page.evaluate((text) => globalThis.__x.buttonRect(text), label);
	if (rectangle === null) throw new Error(`button not found: ${label}`);
	return rectangle;
}

async function measureButton(page, label, spec, timeoutMs = 180000) {
	// Target discovery is driver work, not framework response time. Resolve the
	// hit point before arming the in-page click-to-presentation timer.
	const rectangle = await buttonRect(page, label);
	const token = await page.evaluate(
		(request) => globalThis.__x.armToken(request.spec, request.timeoutMs),
		{
			spec,
			timeoutMs,
		},
	);
	const armed = page.evaluate((value) => globalThis.__x.armResult(value), token);
	await page.mouse.click(rectangle.x, rectangle.y);
	return (await armed).ms;
}

async function measureCell(page, index) {
	// Keep the same boundary as buttons: locating a row must not become select
	// time merely because one bundle changes the page's JIT/layout state.
	const rectangle = await page.evaluate((row) => globalThis.__x.cellRect(row, 'col-label'), index);
	if (rectangle === null) throw new Error(`row ${index} label not found.`);
	const token = await page.evaluate(
		(row) => globalThis.__x.armToken({ type: 'dangerAt', index: row }),
		index,
	);
	const armed = page.evaluate((value) => globalThis.__x.armResult(value), token);
	await page.mouse.click(rectangle.x, rectangle.y);
	return (await armed).ms;
}

async function measureDeterministicUpdateStorm(page, ticks = 5) {
	let ms = 0;
	for (let tick = 0; tick < ticks; tick++) {
		const before = await page.evaluate(() => globalThis.__x.labelAt(0));
		ms += await measureButton(page, 'Update every 10th row', {
			type: 'labelAt',
			index: 0,
			equals: `${before} !!!`,
		});
		await page.evaluate(() => globalThis.__x.settle(0));
	}
	return ms;
}

async function measureDeterministicSelectStorm(page) {
	let ms = 0;
	for (const row of [1, 2]) {
		ms += await measureCell(page, row);
		await page.evaluate(() => globalThis.__x.settle(0));
	}
	return ms;
}

function readProfileGlobalsInRealm() {
	const copy = (value) => {
		const output = {};
		if (value === undefined) return output;
		for (const key of Object.keys(value))
			if (typeof value[key] === 'number') output[key] = value[key];
		return output;
	};
	return {
		allocation: copy(globalThis.__OCTANE_LYNX_ATTRIBUTION__),
		wire: copy(globalThis.__OCTANE_LYNX_PROF),
	};
}

async function profileGlobals(page) {
	const worker = backgroundWorker(page);
	if (worker === null) throw new Error('background worker is unavailable.');
	const [background, ...frames] = await Promise.all([
		worker.evaluate(readProfileGlobalsInRealm),
		...page
			.frames()
			.map((frame) =>
				frame.evaluate(readProfileGlobalsInRealm).catch(() => ({ allocation: {}, wire: {} })),
			),
	]);
	const main = frames.find((profile) =>
		Object.prototype.hasOwnProperty.call(profile.wire, 'prepareMs'),
	);
	return { ...background, mainWire: main?.wire ?? {} };
}

function numericDelta(after, before) {
	const output = {};
	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		output[key] = (after[key] ?? 0) - (before[key] ?? 0);
	}
	return output;
}

function compactOracle(oracle) {
	let identityChecksum = 2166136261;
	for (const identity of oracle.identities) {
		identityChecksum ^= identity;
		identityChecksum = Math.imul(identityChecksum, 16777619) >>> 0;
	}
	const { identities: _identities, ...semantic } = oracle;
	return { ...semantic, identityChecksum };
}

async function createRows(page, rows) {
	const button = CREATE_BUTTON.get(rows);
	if (button === undefined) throw new Error(`unsupported row scale ${rows}.`);
	return measureButton(page, button, { type: 'rowCount', value: rows });
}

async function heapSample(browser, target, rows, takeSnapshot) {
	const page = await loadPage(browser, target);
	const worker = await attachOnlyWorker(browser);
	let pageClosed = false;
	try {
		const baseline = await collectHeap(worker.session);
		const beforeProfile = await profileGlobals(page);
		const createMs = await createRows(page, rows);
		await page.evaluate(() => globalThis.__x.settle());
		const held = await collectHeap(worker.session);
		const afterProfile = await profileGlobals(page);
		const oracle = await page.evaluate(() => globalThis.__x.tableOracle());
		let snapshot = null;
		if (takeSnapshot) {
			fs.mkdirSync(snapshotRoot, { recursive: true });
			const file = path.join(snapshotRoot, `${target.id}-${rows}.heapsnapshot`);
			snapshot = {
				file: path.relative(import.meta.dirname, file),
				...(await takeHeapSnapshot(worker.session, file)),
			};
		}
		const clearMs = await measureButton(page, 'Clear', { type: 'rowCount', value: 0 });
		await page.evaluate(() => globalThis.__x.settle());
		const cleared = await collectHeap(worker.session);
		const viewDestroyMs = await page.evaluate(() => {
			const started = performance.now();
			globalThis.__x.removeView();
			return performance.now() - started;
		});
		const workerReleaseStarted = performance.now();
		await page.close();
		pageClosed = true;
		let workerReleased = false;
		for (let attempt = 0; attempt < 40; attempt++) {
			if ((await backgroundTargetCount(browser)) === 0) {
				workerReleased = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const workerReleaseMs = performance.now() - workerReleaseStarted;
		return {
			createMs,
			clearMs,
			viewDestroyMs,
			workerReleaseMs,
			baseline,
			held,
			cleared,
			retainedBytes: held.usedSize - baseline.usedSize,
			clearResidualBytes: cleared.usedSize - baseline.usedSize,
			oracle: compactOracle(oracle),
			allocation: numericDelta(afterProfile.allocation, beforeProfile.allocation),
			wire: numericDelta(afterProfile.wire, beforeProfile.wire),
			mainWire: numericDelta(afterProfile.mainWire, beforeProfile.mainWire),
			snapshot,
			workerReleased,
		};
	} finally {
		await worker.detach();
		if (!pageClosed) await page.close();
	}
}

async function cpuSample(browser, target) {
	const page = await loadPage(browser, target);
	const worker = await attachOnlyWorker(browser);
	const main = await page.context().newCDPSession(page);
	try {
		const before = await profileGlobals(page);
		await Promise.all([startCpuProfile(worker.session), startCpuProfile(main)]);
		const wallMs = await createRows(page, 10000);
		const [backgroundProfile, mainProfile] = await Promise.all([
			stopCpuProfile(worker.session),
			stopCpuProfile(main),
		]);
		const after = await profileGlobals(page);
		if (bundleVariant === 'profile' && !Object.hasOwn(after.mainWire, 'prepareMs')) {
			throw new Error(`${target.id}: profile bundle did not expose a main-realm wire profile.`);
		}
		return {
			wallMs,
			background: summarizeCpuProfile(backgroundProfile),
			main: summarizeCpuProfile(mainProfile),
			allocation: numericDelta(after.allocation, before.allocation),
			wire: numericDelta(after.wire, before.wire),
			mainWire: numericDelta(after.mainWire, before.mainWire),
			oracle: compactOracle(await page.evaluate(() => globalThis.__x.tableOracle())),
		};
	} finally {
		await main.detach();
		await worker.detach();
		await page.close();
	}
}

async function unmeasuredCreate(page, rows) {
	await createRows(page, rows);
	await page.evaluate(() => globalThis.__x.settle());
}

async function coldSequence(browser, target, operation, rows = 1000) {
	const page = await loadPage(browser, target);
	try {
		if (operation !== 'create') await unmeasuredCreate(page, rows);
		const samples = [];
		for (let index = 0; index < coldSamples; index++) {
			if (operation === 'create' && index !== 0) {
				await measureButton(page, 'Clear', { type: 'rowCount', value: 0 });
				await page.evaluate(() => globalThis.__x.settle());
			}
			if (operation === 'clear' && index !== 0) await unmeasuredCreate(page, rows);
			const beforeOracle = await page.evaluate(() => globalThis.__x.tableOracle());
			const beforeProfile = await profileGlobals(page);
			await page.evaluate(() => globalThis.__x.startPresentationObserver());
			let ms;
			if (operation === 'create') ms = await createRows(page, rows);
			else if (operation === 'clear')
				ms = await measureButton(page, 'Clear', { type: 'rowCount', value: 0 });
			else if (operation === 'replace') {
				ms = await measureButton(page, CREATE_BUTTON.get(rows), {
					type: 'checksumNot',
					value: beforeOracle.checksum,
				});
			} else if (operation === 'swap') {
				ms = await measureButton(page, 'Swap Rows', {
					type: 'checksumNot',
					value: beforeOracle.checksum,
				});
			} else if (operation === 'update10th') {
				const before = await page.evaluate(() => globalThis.__x.labelAt(0));
				ms = await measureButton(page, 'Update every 10th row', {
					type: 'labelAt',
					index: 0,
					equals: `${before} !!!`,
				});
			} else if (operation === 'select') ms = await measureCell(page, index % 2 === 0 ? 1 : 2);
			else throw new Error(`unknown cold operation ${operation}.`);
			await page.evaluate(() => globalThis.__x.settle());
			const presentation = await page.evaluate(() => globalThis.__x.stopPresentationObserver());
			const afterOracle = await page.evaluate(() => globalThis.__x.tableOracle());
			const afterProfile = await profileGlobals(page);
			const survivors =
				operation === 'create' || operation === 'replace' || operation === 'clear'
					? null
					: beforeOracle.identities
							.slice()
							.sort((a, b) => a - b)
							.join(',') ===
						afterOracle.identities
							.slice()
							.sort((a, b) => a - b)
							.join(',');
			samples.push({
				ms,
				presentation,
				wire: numericDelta(afterProfile.wire, beforeProfile.wire),
				mainWire: numericDelta(afterProfile.mainWire, beforeProfile.mainWire),
				before: compactOracle(beforeOracle),
				after: compactOracle(afterOracle),
				survivors,
			});
		}
		return samples;
	} finally {
		await page.close();
	}
}

async function stormSample(browser, target, rows = 1000) {
	const page = await loadPage(browser, target);
	try {
		await unmeasuredCreate(page, rows);
		const operations = {};
		for (const operation of ['updateStorm', 'selectStorm']) {
			const before = await page.evaluate(() => globalThis.__x.tableOracle());
			const beforeProfile = await profileGlobals(page);
			await page.evaluate(() => globalThis.__x.startPresentationObserver());
			const ms =
				operation === 'updateStorm'
					? await measureDeterministicUpdateStorm(page)
					: await measureDeterministicSelectStorm(page);
			await page.evaluate(() => globalThis.__x.settle());
			const presentation = await page.evaluate(() => globalThis.__x.stopPresentationObserver());
			const after = await page.evaluate(() => globalThis.__x.tableOracle());
			const afterProfile = await profileGlobals(page);
			const sample = {
				ms,
				presentation,
				wire: numericDelta(afterProfile.wire, beforeProfile.wire),
				mainWire: numericDelta(afterProfile.mainWire, beforeProfile.mainWire),
				before: compactOracle(before),
				after: compactOracle(after),
				survivors:
					before.identities
						.slice()
						.sort((a, b) => a - b)
						.join(',') ===
					after.identities
						.slice()
						.sort((a, b) => a - b)
						.join(','),
			};
			const expected =
				operation === 'updateStorm'
					? { commits: 5, changedRows: 500, wireCommits: 5, wireCommands: 500 }
					: { commits: 2, changedRows: 3, wireCommits: 2, wireCommands: 3 };
			if (
				presentation.commits !== expected.commits ||
				presentation.changedRows !== expected.changedRows ||
				sample.wire.commits !== expected.wireCommits ||
				sample.wire.commands !== expected.wireCommands
			) {
				throw new Error(
					`${target.id} ${operation} constants diverged: ${JSON.stringify({ presentation, wire: sample.wire, expected })}`,
				);
			}
			operations[operation] = sample;
		}
		return operations;
	} finally {
		await page.close();
	}
}

const server = await startServer();
const { chromium } = require('playwright');
const executablePath = fs.existsSync('/opt/pw-browsers/chromium')
	? '/opt/pw-browsers/chromium'
	: undefined;
const browser = await chromium.launch({
	headless: true,
	...(executablePath ? { executablePath } : null),
	args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = {
	meta: {
		date: new Date().toISOString(),
		node: process.version,
		chromium: browser.version(),
		cpus: os.cpus().length,
		cpuModel: os.cpus()[0]?.model ?? 'unknown',
		platform: os.platform(),
		release: os.release(),
		loadStart: os.loadavg(),
		repetitions,
		coldSamples,
		scales,
		protocol:
			'fresh page and background worker per repetition; explicit CDP GC before Runtime.getHeapUsage; UI clear, synchronous view destroy, and page-close-to-worker-release timed separately; deterministic five-commit update and two-commit select storms; sample order retained; identical driver and semantic oracle for every target',
		bundleVariant,
		manifest: path.relative(benchmarkRoot, manifestFile),
		targetOrder: targets.map((target) => target.id),
		reportable: !args.smoke,
	},
	targets: {},
};
try {
	for (const target of targets) {
		const targetResult = (report.targets[target.id] = {
			sha: target.sha,
			...(target.reference ? { reference: true } : null),
		});
		if (modes.has('heap')) {
			targetResult.heap = {};
			for (const rows of scales) {
				const samples = [];
				for (let repetition = 0; repetition < repetitions; repetition++) {
					const takeSnapshot = snapshotTargets.has(target.id) && rows === 10000 && repetition === 0;
					const sample = await heapSample(browser, target, rows, takeSnapshot);
					samples.push(sample);
					console.log(
						`[attribution:heap] ${target.id} rows=${rows} rep=${repetition + 1} retained=${sample.retainedBytes} clear=${sample.clearMs.toFixed(1)} destroy=${sample.viewDestroyMs.toFixed(1)} release=${sample.workerReleaseMs.toFixed(1)}`,
					);
				}
				targetResult.heap[rows] = samples;
			}
		}
		if (modes.has('cpu')) {
			targetResult.cpu = [];
			for (let repetition = 0; repetition < repetitions; repetition++) {
				const sample = await cpuSample(browser, target);
				targetResult.cpu.push(sample);
				console.log(
					`[attribution:cpu] ${target.id} rep=${repetition + 1} bg=${sample.background.activeMs.toFixed(1)} main=${sample.main.activeMs.toFixed(1)}`,
				);
			}
		}
		if (modes.has('cold')) {
			targetResult.cold = {};
			for (const operation of ['swap', 'replace', 'create', 'clear', 'select', 'update10th']) {
				const realms = [];
				for (let repetition = 0; repetition < repetitions; repetition++) {
					const samples = await coldSequence(browser, target, operation);
					realms.push(samples);
					console.log(
						`[attribution:cold] ${target.id} ${operation} realm=${repetition + 1} first=${samples[0].ms.toFixed(1)}`,
					);
				}
				targetResult.cold[operation] = realms;
			}
		}
		if (modes.has('storm')) {
			targetResult.storm = [];
			for (let repetition = 0; repetition < repetitions; repetition++) {
				const sample = await stormSample(browser, target);
				targetResult.storm.push(sample);
				console.log(
					`[attribution:storm] ${target.id} rep=${repetition + 1} update=${sample.updateStorm.ms.toFixed(1)} select=${sample.selectStorm.ms.toFixed(1)}`,
				);
			}
		}
	}
} finally {
	report.meta.loadEnd = os.loadavg();
	await browser.close();
	server.close();
}

report.meta.bundleSha256 = Object.fromEntries(
	[...bundles].map(([id, file]) => [
		id,
		crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
	]),
);
fs.mkdirSync(resultRoot, { recursive: true });
fs.writeFileSync(path.join(resultRoot, outputName), JSON.stringify(report, null, 2) + '\n');
console.log(
	`[attribution] wrote ${path.relative(benchmarkRoot, path.join(resultRoot, outputName))}`,
);
