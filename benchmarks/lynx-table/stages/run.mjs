import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import {
	analyzeCreateSample,
	analyzeFcpSample,
	interleavedABSchedule,
	parseRealmSnapshots,
	requireMinimumRepetitions,
	summarizeSamples,
} from './analyze.mjs';
import {
	DRIVER_CLIENT_JS,
	applyNeutralize,
	applyStageClock,
	makeBenchHtml,
} from '../web/driver-client.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		reps: { type: 'string', default: '5' },
		rows: { type: 'string', default: '10000' },
		port: { type: 'string', default: '8361' },
		smoke: { type: 'boolean', default: false },
		'skip-build': { type: 'boolean', default: false },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});
const repetitions = args.smoke ? 1 : requireMinimumRepetitions(args.reps);
const rows = Number(args.rows);
if (!Number.isSafeInteger(rows) || rows <= 0)
	throw new TypeError('rows must be a positive integer.');
const port = Number(args.port);
const cpuCount = os.cpus().length;
const loadPerCpu = os.loadavg()[0] / cpuCount;
if (!args['allow-busy-host'] && loadPerCpu > 0.5) {
	throw new Error(
		`quiet-host preflight failed: 1-minute load ${os.loadavg()[0].toFixed(2)} / ${cpuCount} CPUs = ${loadPerCpu.toFixed(2)}; close competing work or pass --allow-busy-host and disclose it.`,
	);
}

const variants = {
	control: path.join(root, 'app/dist/main.web.bundle'),
	profile: path.join(root, 'app/dist-profile/main.web.bundle'),
	'control-fcp': path.join(root, `app/dist-rows${rows}/main.web.bundle`),
	'profile-fcp': path.join(root, `app/dist-rows${rows}-profile/main.web.bundle`),
	'vue-vdom': path.join(root, 'reference/vdom-ifr-et/main.web.bundle'),
};
const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const html = makeBenchHtml();

function buildVariants() {
	const previousProfile = process.env.OCTANE_LYNX_PROFILE;
	const previousStageProfile = process.env.OCTANE_LYNX_STAGE_PROFILE;
	const previousRows = process.env.BENCH_AUTOROWS;
	try {
		for (const [profile, autoRows] of [
			['0', '0'],
			['1', '0'],
			['0', String(rows)],
			['1', String(rows)],
		]) {
			process.env.OCTANE_LYNX_PROFILE = profile;
			process.env.OCTANE_LYNX_STAGE_PROFILE = profile;
			process.env.BENCH_AUTOROWS = autoRows;
			buildTableApp({ silent: true });
		}
	} finally {
		if (previousProfile === undefined) delete process.env.OCTANE_LYNX_PROFILE;
		else process.env.OCTANE_LYNX_PROFILE = previousProfile;
		if (previousStageProfile === undefined) delete process.env.OCTANE_LYNX_STAGE_PROFILE;
		else process.env.OCTANE_LYNX_STAGE_PROFILE = previousStageProfile;
		if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
		else process.env.BENCH_AUTOROWS = previousRows;
	}
	const control = fs.readFileSync(variants.control);
	const profile = fs.readFileSync(variants.profile);
	const marker = Buffer.from('__OCTANE_LYNX_MT_SLICE_LOAD_START_EPOCH__');
	if (control.includes(marker))
		throw new Error('default production bundle retained stage profiling.');
	if (!profile.includes(marker))
		throw new Error('profile bundle omitted its browser-owned slice-start read.');
}

function startServer() {
	const mime = {
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.wasm': 'application/wasm',
		'.bundle': 'application/octet-stream',
	};
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		if (url.pathname === '/') {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(html);
			return;
		}
		let file = null;
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		else if (url.pathname.startsWith('/bundle/')) file = variants[url.pathname.slice(8)];
		if (file === null || file === undefined || !fs.existsSync(file)) {
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

async function load(browser, variant) {
	const page = await browser.newPage();
	if (process.env.LYNX_BENCH_DEBUG) {
		page.on('console', (message) =>
			console.log(`[console:${variant}:${message.type()}]`, message.text().slice(0, 500)),
		);
		page.on('pageerror', (error) =>
			console.log(`[pageerror:${variant}]`, String(error).slice(0, 1000)),
		);
	}
	await applyNeutralize(page);
	await applyStageClock(page);
	await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
	await page.evaluate(
		(url) => globalThis.__x.createView(url),
		`http://127.0.0.1:${port}/bundle/${variant}`,
	);
	return page;
}

async function realmSnapshots(page) {
	const read = () => {
		const value = globalThis.__OCTANE_LYNX_PROF;
		if (value === undefined) return null;
		const copy = {};
		for (const key of Object.keys(value)) {
			if (typeof value[key] === 'number') copy[key] = value[key];
		}
		return copy;
	};
	const snapshots = [];
	for (const frame of page.frames()) {
		const profile = await frame.evaluate(read).catch(() => null);
		if (profile !== null) snapshots.push({ kind: 'frame', profile });
	}
	for (const worker of page.workers()) {
		const profile = await worker.evaluate(read).catch(() => null);
		if (profile !== null) snapshots.push({ kind: 'worker', profile });
	}
	return parseRealmSnapshots(snapshots);
}

async function resetProfiles(page) {
	const reset = () => {
		const profile = globalThis.__OCTANE_LYNX_PROF;
		if (profile === undefined) return;
		for (const key of Object.keys(profile)) profile[key] = 0;
	};
	await Promise.all([
		...page.frames().map((frame) => frame.evaluate(reset).catch(() => {})),
		...page.workers().map((worker) => worker.evaluate(reset).catch(() => {})),
	]);
}

async function runFcp(browser, variant, profile) {
	const page = await load(browser, `${variant}-fcp`);
	try {
		const observation = await page.evaluate(
			(count) => globalThis.__x.fcp({ minContent: count, idleMs: 300, timeoutMs: 120000 }),
			rows,
		);
		if (observation.dnf || observation.fcp === null)
			throw new Error(`${variant} FCP did not finish.`);
		if (!profile) return { rawMs: observation.fcp };
		const realms = await realmSnapshots(page);
		if (realms.main === null || realms.main.mtSliceStartEpochMs === 0) {
			throw new Error('profile FCP did not expose the main-thread realm snapshot.');
		}
		return {
			rawMs: observation.fcp,
			attribution: analyzeFcpSample({
				wallMs: observation.fcpEpoch - realms.main.mtSliceStartEpochMs,
				main: realms.main,
			}),
			realms,
		};
	} finally {
		await page.close();
	}
}

const createLabels = new Map([
	[1000, 'Create 1,000 rows'],
	[3000, 'Create 3,000 rows'],
	[5000, 'Create 5,000 rows'],
	[10000, 'Create 10,000 rows'],
	[20000, 'Create 20,000 rows'],
	[30000, 'Create 30,000 rows'],
]);

async function clickCreate(page) {
	const label = createLabels.get(rows);
	if (label === undefined) throw new Error(`the shared app has no create button for ${rows} rows.`);
	await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
		timeout: 60000,
	});
	await page.evaluate(() => globalThis.__x.settle());
	const armed = page.evaluate(
		(count) => globalThis.__x.arm({ type: 'rowCount', value: count }, 120000),
		rows,
	);
	const rectangle = await page.evaluate((text) => globalThis.__x.buttonRect(text), label);
	if (rectangle === null) throw new Error('create button not found.');
	await page.mouse.click(rectangle.x, rectangle.y);
	return (await armed).ms;
}

async function runCreate(browser, variant, profile) {
	const page = await load(browser, variant);
	try {
		if (profile) {
			await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
				timeout: 60000,
			});
			await page.evaluate(() => globalThis.__x.settle());
			await resetProfiles(page);
		}
		const rawMs = await clickCreate(page);
		if (!profile) return { rawMs };
		const realms = await realmSnapshots(page);
		if (realms.background === null || realms.main === null) {
			throw new Error('profile create did not expose both Lynx realm snapshots.');
		}
		return {
			rawMs,
			attribution: analyzeCreateSample({
				wallMs: rawMs,
				background: realms.background,
				main: realms.main,
			}),
			realms,
		};
	} finally {
		await page.close();
	}
}

function round(value, digits = 2) {
	return Number(value.toFixed(digits));
}

function markdown(report) {
	const lines = [
		'# Lynx 10k stage decomposition',
		'',
		`- measured: ${report.meta.date}`,
		`- host: ${report.meta.cpus}× ${report.meta.cpuModel}; ${report.meta.platform} ${report.meta.release}; Node ${report.meta.node}; Chromium ${report.meta.chromium}`,
		`- protocol: ${report.meta.protocol}`,
		`- host load: start ${report.meta.loadStart.map((value) => value.toFixed(2)).join('/')} (1/5/15m), end ${report.meta.loadEnd.map((value) => value.toFixed(2)).join('/')}`,
		`- repetitions: n=${report.meta.repetitions} per A/B cell`,
		'',
		'## FCP@10k',
		'',
		'Attribution starts when the shared browser hook assigns the hidden main-thread iframe Blob script URL, before load/parse/evaluation, and ends when the shared composed-tree observer first sees all 10,000 rows. `layout_flush_residual` is the exclusive remainder after directly observed slice evaluation, plan interpretation, and PAPI element creation; it includes PAPI prop/insertion work, `__FlushElementTree`, Web Core DOM publication, style/layout, and observer-frame delay because the host exposes no stable boundary between those costs.',
		'',
		'| segment | median ms | min–max ms | share |',
		'|---|---:|---:|---:|',
	];
	for (const [name, stage] of Object.entries(report.fcp.attribution.stages)) {
		lines.push(
			`| ${name} | ${round(stage.median)} | ${round(stage.min)}–${round(stage.max)} | ${(stage.share * 100).toFixed(1)}% |`,
		);
	}
	lines.push(
		'',
		`Raw view-attach FCP: profile ${round(report.fcp.rawProfile.median)} ms (${round(report.fcp.rawProfile.min)}–${round(report.fcp.rawProfile.max)}), control ${round(report.fcp.rawControl.median)} ms; same-window profile/control ${round(report.fcp.rawProfile.median / report.fcp.rawControl.median, 3)}×.`,
		'',
		'## create@10k',
		'',
		'Attribution starts at the shared pointerdown boundary and ends when the shared composed-tree observer sees 10,000 rows. `bg_replay`, `wire_clone_transfer`, `mt_expand`, and PAPI creation are directly observed exclusive intervals. `layout_flush_residual` is the wall-clock remainder, including event delivery before replay, validation/prepare, non-create PAPI work, flush/layout, scheduling, and observer-frame delay.',
		'',
		'| segment | median ms | min–max ms | share |',
		'|---|---:|---:|---:|',
	);
	for (const [name, stage] of Object.entries(report.create.attribution.stages)) {
		lines.push(
			`| ${name} | ${round(stage.median)} | ${round(stage.min)}–${round(stage.max)} | ${(stage.share * 100).toFixed(1)}% |`,
		);
	}
	lines.push(
		'',
		`Raw create: profile ${round(report.create.rawProfile.median)} ms (${round(report.create.rawProfile.min)}–${round(report.create.rawProfile.max)}), control ${round(report.create.rawControl.median)} ms, vue-vdom ${round(report.create.vueVdom.median)} ms; same-window profile/control ${round(report.create.rawProfile.median / report.create.rawControl.median, 3)}×, profile/vue-vdom ${round(report.create.rawProfile.median / report.create.vueVdom.median, 3)}×.`,
		'',
		'## Verdicts',
		'',
		...report.verdicts.map(
			(verdict) => `- **${verdict.step}: ${verdict.verdict}.** ${verdict.reason}`,
		),
		'',
	);
	return lines.join('\n');
}

if (!args['skip-build']) buildVariants();
for (const [name, file] of Object.entries(variants)) {
	if (!fs.existsSync(file)) throw new Error(`${name} bundle is missing: ${file}`);
}
const server = await startServer();
const { chromium } = require('playwright');
const browser = await chromium.launch({
	headless: true,
	args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const browserVersion = browser.version();
const loadStart = os.loadavg();
const samples = {
	fcp: { control: [], profile: [] },
	create: { control: [], profile: [], vueVdom: [] },
};
try {
	const schedule = args.smoke ? [['control', 'profile']] : interleavedABSchedule(repetitions);
	for (const [first, second] of schedule) {
		for (const variant of [first, second]) {
			const profile = variant === 'profile';
			const fcp = await runFcp(browser, variant, profile);
			samples.fcp[variant].push(fcp);
			const create = await runCreate(browser, variant, profile);
			samples.create[variant].push(create);
			console.log(
				`[stage] ${variant} fcp=${fcp.rawMs.toFixed(1)} create=${create.rawMs.toFixed(1)}`,
			);
		}
		const reference = await runCreate(browser, 'vue-vdom', false);
		samples.create.vueVdom.push(reference);
		console.log(`[stage] vue-vdom create=${reference.rawMs.toFixed(1)}`);
	}
} finally {
	await browser.close();
	server.close();
}

if (args.smoke) {
	const output = path.join(import.meta.dirname, 'results');
	fs.mkdirSync(output, { recursive: true });
	fs.writeFileSync(
		path.join(output, `smoke-${rows}.json`),
		JSON.stringify(
			{
				meta: {
					date: new Date().toISOString(),
					node: process.version,
					cpus: cpuCount,
					cpuModel: os.cpus()[0]?.model ?? 'unknown',
					chromium: browserVersion,
					rows,
					reportable: false,
				},
				samples,
			},
			null,
			2,
		) + '\n',
	);
	console.log(`[stage] smoke passed at ${rows} rows (not reportable).`);
	process.exit(0);
}

const fcpAttribution = summarizeSamples(samples.fcp.profile.map((sample) => sample.attribution));
const createAttribution = summarizeSamples(
	samples.create.profile.map((sample) => sample.attribution),
	{
		control: samples.create.control.map((sample) => sample.rawMs),
		reference: samples.create.vueVdom.map((sample) => sample.rawMs),
	},
);
const directFcpShare =
	fcpAttribution.stages.mt_slice_eval.share + fcpAttribution.stages.plan_interpretation.share;
const expandShare = createAttribution.stages.mt_expand.share;
const report = {
	meta: {
		date: new Date().toISOString(),
		node: process.version,
		cpus: cpuCount,
		cpuModel: os.cpus()[0]?.model ?? 'unknown',
		platform: os.platform(),
		release: os.release(),
		chromium: browserVersion,
		repetitions,
		rows,
		reportable: !args.smoke,
		loadStart,
		loadEnd: os.loadavg(),
		protocol:
			'fresh page per sample; control/profile order alternates AB/BA; one vue-vdom create sample follows each pair; no other benchmark process ran in this window',
	},
	fcp: {
		attribution: fcpAttribution,
		rawControl: summarizeSamples(
			samples.fcp.control.map((sample) => ({
				totalMs: sample.rawMs,
				stages: { raw: sample.rawMs },
			})),
		).total,
		rawProfile: summarizeSamples(
			samples.fcp.profile.map((sample) => ({
				totalMs: sample.rawMs,
				stages: { raw: sample.rawMs },
			})),
		).total,
	},
	create: {
		attribution: createAttribution,
		rawControl: summarizeSamples(
			samples.create.control.map((sample) => ({
				totalMs: sample.rawMs,
				stages: { raw: sample.rawMs },
			})),
		).total,
		rawProfile: summarizeSamples(
			samples.create.profile.map((sample) => ({
				totalMs: sample.rawMs,
				stages: { raw: sample.rawMs },
			})),
		).total,
		vueVdom: summarizeSamples(
			samples.create.vueVdom.map((sample) => ({
				totalMs: sample.rawMs,
				stages: { raw: sample.rawMs },
			})),
		).total,
	},
	verdicts: [
		{
			step: 's2-2 (#18)',
			verdict: fcpAttribution.stages.plan_interpretation.share >= 0.1 ? 'GO' : 'NO-GO',
			reason: `plan interpretation is ${(fcpAttribution.stages.plan_interpretation.share * 100).toFixed(1)}% of attributed FCP and instantiate expansion is ${(expandShare * 100).toFixed(1)}% of create; neither clears the 10% direct-share gate.`,
		},
		{
			step: 's2-3 (#19)',
			verdict: 'NO-GO from this instrument',
			reason:
				'This issue measures mount/FCP, not slot-update routing; the roadmap already records point updates inside the target band, so no measured mount share justifies updater staging here.',
		},
		{
			step: 's2-4 (#20)',
			verdict: directFcpShare >= 0.1 ? 'GO' : 'NO-GO',
			reason: `receiver slice evaluation plus plan interpretation is ${(directFcpShare * 100).toFixed(1)}% of attributed FCP and wire is ${(createAttribution.stages.wire_clone_transfer.share * 100).toFixed(1)}% of create; neither clears the 10% direct-share gate, and the create residual is deliberately not attributed to receiver code.`,
		},
	],
	samples,
};
const output = path.join(import.meta.dirname, 'results');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'sg1.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'sg1.md'), markdown(report) + '\n');
console.log(markdown(report));
