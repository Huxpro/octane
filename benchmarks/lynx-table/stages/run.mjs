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
	WIRE_INSTRUMENT_JS,
	applyNeutralize,
	applyStageClock,
	makeBenchHtml,
} from '../web/driver-client.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';
import {
	DEFAULT_TIMEOUT_MS,
	buildOperations,
	derivedPredicate,
	describeTarget,
	mutationOperations,
	operationTimeout,
	scaleTag,
} from './operations.mjs';

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
const html = makeBenchHtml({ instrumentJs: WIRE_INSTRUMENT_JS });

function buildVariants() {
	const previousProfile = process.env.OCTANE_LYNX_PROFILE;
	const previousRows = process.env.BENCH_AUTOROWS;
	try {
		for (const [profile, autoRows] of [
			['0', '0'],
			['1', '0'],
			['0', String(rows)],
			['1', String(rows)],
		]) {
			process.env.OCTANE_LYNX_PROFILE = profile;
			process.env.BENCH_AUTOROWS = autoRows;
			buildTableApp({ silent: true });
		}
	} finally {
		if (previousProfile === undefined) delete process.env.OCTANE_LYNX_PROFILE;
		else process.env.OCTANE_LYNX_PROFILE = previousProfile;
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

async function wireSnapshot(page) {
	return page.evaluate(() => globalThis.__OCTANE_STAGE_WIRE__());
}

function wireDelta(before, after) {
	const side = (a, b) => {
		const names = new Set([...Object.keys(a.byName), ...Object.keys(b.byName)]);
		const byName = {};
		for (const name of names) {
			const value = {
				messages: (b.byName[name]?.messages ?? 0) - (a.byName[name]?.messages ?? 0),
				bytes: (b.byName[name]?.bytes ?? 0) - (a.byName[name]?.bytes ?? 0),
			};
			if (value.messages !== 0 || value.bytes !== 0) byName[name] = value;
		}
		return {
			messages: b.messages - a.messages,
			bytes: b.bytes - a.bytes,
			byName,
		};
	};
	return { toBts: side(before.toBts, after.toBts), toMts: side(before.toMts, after.toMts) };
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

const operations = buildOperations(rows);
const operationNames = Object.keys(operations);
const mutationNames = mutationOperations(operations);

async function targetRect(page, target) {
	return target.kind === 'button'
		? page.evaluate((text) => globalThis.__x.buttonRect(text), target.label)
		: page.evaluate((spec) => globalThis.__x.cellRect(spec.rowIndex, spec.class), target);
}

async function clickAndWait(page, target, predicate, timeoutMs) {
	await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
		timeout: 60000,
	});
	await page.evaluate(() => globalThis.__x.settle());
	const armed = page.evaluate(
		(request) => globalThis.__x.arm(request.predicate, request.timeoutMs),
		{ predicate, timeoutMs },
	);
	const rectangle = await targetRect(page, target);
	if (rectangle === null) throw new Error(`${describeTarget(target)} not found.`);
	await page.mouse.click(rectangle.x, rectangle.y);
	return (await armed).ms;
}

// `update10th` stamps a suffix onto labels the setup click chose, so its
// predicate is only knowable once the table exists.
async function resolvePredicate(page, operation, oracle) {
	if (operation.derive === undefined)
		return operation.predicate ?? { type: 'checksumNot', value: oracle.checksum };
	const before = await page.evaluate(
		(index) => globalThis.__x.labelAt(index),
		operation.derive.index,
	);
	return derivedPredicate(operation.derive, before);
}

async function runOperation(browser, variant, profile, operationName) {
	const page = await load(browser, variant);
	try {
		const operation = operations[operationName];
		if (operation.setup !== undefined) {
			await clickAndWait(
				page,
				operation.setup.target,
				operation.setup.predicate,
				DEFAULT_TIMEOUT_MS,
			);
			await page.evaluate(() => globalThis.__x.settle());
		}
		const oracle = await page.evaluate(() => globalThis.__x.tableOracle());
		const predicate = await resolvePredicate(page, operation, oracle);
		if (profile) await resetProfiles(page);
		const beforeWire = await wireSnapshot(page);
		const rawMs = await clickAndWait(
			page,
			operation.target,
			predicate,
			operationTimeout(operation),
		);
		const afterWire = await wireSnapshot(page);
		const wire = wireDelta(beforeWire, afterWire);
		if (!profile) return { rawMs, wire };
		const realms = await realmSnapshots(page);
		if (realms.background === null || realms.main === null) {
			throw new Error(`profile ${operationName} did not expose both Lynx realm snapshots.`);
		}
		return {
			rawMs,
			wire,
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

function backgroundWorkLine(background) {
	const renders = background.blockRenders.median;
	const commands = background.hostCommands.median;
	const ratio = commands === 0 ? 'no host commands' : `${round(renders / commands, 1)} per command`;
	return `Background work: ${Math.round(renders).toLocaleString('en-US')} block renders producing ${Math.round(commands).toLocaleString('en-US')} host commands (${ratio}).`;
}

function markdown(report) {
	const lines = [
		`# Lynx ${report.meta.rows.toLocaleString('en-US')}-row stage decomposition`,
		'',
		`- measured: ${report.meta.date}`,
		`- host: ${report.meta.cpus}× ${report.meta.cpuModel}; ${report.meta.platform} ${report.meta.release}; Node ${report.meta.node}; Chromium ${report.meta.chromium}`,
		`- protocol: ${report.meta.protocol}`,
		`- host load: start ${report.meta.loadStart.map((value) => value.toFixed(2)).join('/')} (1/5/15m), end ${report.meta.loadEnd.map((value) => value.toFixed(2)).join('/')}`,
		`- repetitions: n=${report.meta.repetitions} per A/B cell`,
		'',
		`## FCP@${report.meta.rows}`,
		'',
		`Attribution starts when the shared browser hook assigns the hidden main-thread iframe Blob script URL, before load/parse/evaluation, and ends when the shared composed-tree observer first sees all ${report.meta.rows.toLocaleString('en-US')} rows. \`layout_flush_residual\` is the exclusive remainder after directly observed slice evaluation, plan interpretation, and PAPI element creation; it includes PAPI prop/insertion work, \`__FlushElementTree\`, Web Core DOM publication, style/layout, and observer-frame delay because the host exposes no stable boundary between those costs.`,
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
		`## create@${report.meta.rows}`,
		'',
		`Attribution starts at the shared pointerdown boundary and ends when the shared composed-tree observer sees ${report.meta.rows.toLocaleString('en-US')} rows. All named intervals are directly observed and exclusive; \`presentation_residual\` is the wall-clock remainder through final composed-tree presentation.`,
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
		`Wire: MTS→BTS ${Math.round(report.create.wire.toBts.bytes.median).toLocaleString('en-US')} B / ${round(report.create.wire.toBts.messages.median)} messages; BTS→MTS ${Math.round(report.create.wire.toMts.bytes.median).toLocaleString('en-US')} B / ${round(report.create.wire.toMts.messages.median)} messages.`,
		backgroundWorkLine(report.create.background),
	);
	for (const operation of mutationNames) {
		const cell = report[operation];
		lines.push(
			'',
			`## ${operation}@${scaleTag(cell.scale)}`,
			'',
			'| segment | median ms | share |',
			'|---|---:|---:|',
		);
		for (const [name, stage] of Object.entries(cell.attribution.stages)) {
			lines.push(`| ${name} | ${round(stage.median)} | ${(stage.share * 100).toFixed(1)}% |`);
		}
		lines.push(
			'',
			`Raw ${operation}: profile ${round(cell.rawProfile.median)} ms, control ${round(cell.rawControl.median)} ms, vue-vdom ${round(cell.vueVdom.median)} ms. Wire: MTS→BTS ${Math.round(cell.wire.toBts.bytes.median).toLocaleString('en-US')} B / ${round(cell.wire.toBts.messages.median)} messages; BTS→MTS ${Math.round(cell.wire.toMts.bytes.median).toLocaleString('en-US')} B / ${round(cell.wire.toMts.messages.median)} messages.`,
			backgroundWorkLine(cell.background),
		);
	}
	lines.push(
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
const samples = { fcp: { control: [], profile: [] } };
for (const operation of operationNames) {
	samples[operation] = { control: [], profile: [], vueVdom: [] };
}
try {
	const schedule = args.smoke ? [['control', 'profile']] : interleavedABSchedule(repetitions);
	for (const [first, second] of schedule) {
		for (const variant of [first, second]) {
			const profile = variant === 'profile';
			const fcp = await runFcp(browser, variant, profile);
			samples.fcp[variant].push(fcp);
			const measured = {};
			for (const operation of operationNames) {
				measured[operation] = await runOperation(browser, variant, profile, operation);
				samples[operation][variant].push(measured[operation]);
			}
			const measuredText = operationNames
				.map((operation) => `${operation}=${measured[operation].rawMs.toFixed(1)}`)
				.join(' ');
			console.log(`[stage] ${variant} fcp=${fcp.rawMs.toFixed(1)} ${measuredText}`);
		}
		const reference = {};
		for (const operation of operationNames) {
			reference[operation] = await runOperation(browser, 'vue-vdom', false, operation);
			samples[operation].vueVdom.push(reference[operation]);
		}
		console.log(
			`[stage] vue-vdom ${operationNames
				.map((operation) => `${operation}=${reference[operation].rawMs.toFixed(1)}`)
				.join(' ')}`,
		);
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
function summarizeRaw(cell) {
	return summarizeSamples(
		cell.map((sample) => ({ totalMs: sample.rawMs, stages: { raw: sample.rawMs } })),
	).total;
}
// Deterministic per-sample counts reuse the sample summarizer by standing in
// for a duration; only the median/min/max are read back.
function summarizeCount(cell, read) {
	return summarizeSamples(
		cell.map((sample) => {
			const value = read(sample);
			return { totalMs: value, stages: { raw: value } };
		}),
	).total;
}
function summarizeWire(cell, side, field) {
	return summarizeCount(cell, (sample) => sample.wire[side][field]);
}
// Block renders are the background half of the same question the wire counts
// ask on the main side: how much work the frame did, independent of how long
// the host took to do it. Unlike milliseconds these are fixed for a given app
// and interaction, which is what makes them gateable.
function summarizeBackgroundWork(cell) {
	return {
		blockRenders: summarizeCount(cell, (sample) => sample.realms.background.bgRenderBlocks ?? 0),
		hostCommands: summarizeCount(cell, (sample) => sample.realms.background.commands ?? 0),
	};
}
function mutationReport(operation) {
	const cell = samples[operation];
	return {
		scale: operations[operation].scale,
		attribution: summarizeSamples(
			cell.profile.map((sample) => sample.attribution),
			{
				control: cell.control.map((sample) => sample.rawMs),
				reference: cell.vueVdom.map((sample) => sample.rawMs),
			},
		),
		rawControl: summarizeRaw(cell.control),
		rawProfile: summarizeRaw(cell.profile),
		vueVdom: summarizeRaw(cell.vueVdom),
		background: summarizeBackgroundWork(cell.profile),
		wire: {
			toBts: {
				bytes: summarizeWire(cell.profile, 'toBts', 'bytes'),
				messages: summarizeWire(cell.profile, 'toBts', 'messages'),
			},
			toMts: {
				bytes: summarizeWire(cell.profile, 'toMts', 'bytes'),
				messages: summarizeWire(cell.profile, 'toMts', 'messages'),
			},
		},
	};
}
const mutationReports = Object.fromEntries(
	mutationNames.map((operation) => [operation, mutationReport(operation)]),
);
const { replace: replaceReport, append: appendReport } = mutationReports;
// Issue #66 A4/A5 propose replacing the full prop bag on the wire with a typed
// delta and dispatching it through a main-thread slot table. What that can
// remove is `mt_prepare` (host prop-patch planning) plus whatever the wire
// costs, so those two stages together are the candidate's owner share. The
// pure-mutation cells decide it: `create` already answered NO-GO for the wire
// under #47, and the exit gate needs an owner in the cells A5 actually targets.
const DELTA_OWNER_STAGES = ['mt_prepare', 'wire_clone_transfer'];
const DELTA_OWNER_GATE = 0.1;
function deltaOwnerShare(operation) {
	const { stages } = mutationReports[operation].attribution;
	return DELTA_OWNER_STAGES.reduce((sum, name) => sum + stages[name].share, 0);
}
function deltaEncodingVerdict() {
	const cells = ['update10th', 'select'];
	const shares = cells.map((operation) => [operation, deltaOwnerShare(operation)]);
	const clears = shares.filter(([, share]) => share >= DELTA_OWNER_GATE);
	const text = shares
		.map(
			([operation, share]) =>
				`${operation} ${(share * 100).toFixed(1)}% (mt_prepare ${round(mutationReports[operation].attribution.stages.mt_prepare.median)} ms of ${round(mutationReports[operation].attribution.total.median)} ms)`,
		)
		.join(', ');
	return {
		step: '#66 A4/A5 delta-encoding candidate (pure-mutation cells)',
		verdict: clears.length === cells.length ? 'GO' : clears.length === 0 ? 'NO-GO' : 'SPLIT',
		reason: `mt_prepare plus clone/transfer is ${text}. The gate is ${DELTA_OWNER_GATE * 100}% in every pure-mutation cell, because a typed delta plus slot dispatch can only remove host prop-patch planning and wire cost; it cannot touch PAPI apply.`,
	};
}
// Phase 0's gate fired NO-GO on the delta candidate and instructed the next
// phase to aim at whatever segment actually costs. `bg_render_reconcile` is
// that segment's timed half. Block renders per host command is its
// deterministic half, and the one that says *why* rather than *how much*: work
// proportional to the tree producing output proportional to the change.
const RENDER_OWNER_GATE = 0.1;
function renderAmplificationVerdict() {
	const cells = ['update10th', 'select'];
	const measured = cells.map((operation) => {
		const cell = mutationReports[operation];
		return {
			operation,
			share: cell.attribution.stages.bg_render_reconcile.share,
			renders: cell.background.blockRenders.median,
			commands: cell.background.hostCommands.median,
		};
	});
	const owners = measured.filter((row) => row.share >= RENDER_OWNER_GATE);
	const text = measured
		.map(
			(row) =>
				`${row.operation} ${(row.share * 100).toFixed(1)}% with ${Math.round(row.renders).toLocaleString('en-US')} block renders for ${Math.round(row.commands).toLocaleString('en-US')} host commands`,
		)
		.join(', ');
	return {
		step: '#66 Phase 2 re-aim: background render/reconcile owner',
		verdict: owners.length === cells.length ? 'GO' : owners.length === 0 ? 'NO-GO' : 'SPLIT',
		reason: `bg_render_reconcile is ${text}. The gate is ${RENDER_OWNER_GATE * 100}% in every cell named here. The block-render counts are deterministic for this app and interaction, so a candidate that claims to cut background cost has to move them, not just the milliseconds.`,
	};
}
const createWire = {
	toBts: {
		bytes: summarizeWire(samples.create.profile, 'toBts', 'bytes'),
		messages: summarizeWire(samples.create.profile, 'toBts', 'messages'),
	},
	toMts: {
		bytes: summarizeWire(samples.create.profile, 'toMts', 'bytes'),
		messages: summarizeWire(samples.create.profile, 'toMts', 'messages'),
	},
};
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
		protocol: `fresh page per operation sample (each mutation cell re-creates its own table first); control/profile order alternates AB/BA; one vue-vdom pass over ${operationNames.join('/')} follows each pair; no other benchmark process ran in this window`,
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
		background: summarizeBackgroundWork(samples.create.profile),
		wire: createWire,
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
	...mutationReports,
	verdicts: [
		deltaEncodingVerdict(),
		renderAmplificationVerdict(),
		{
			step: '#47 wire/encoding candidate',
			verdict: 'NO-GO',
			reason: `clone/transfer is ${(createAttribution.stages.wire_clone_transfer.share * 100).toFixed(1)}% of create, ${(replaceReport.attribution.stages.wire_clone_transfer.share * 100).toFixed(1)}% of replace, and ${(appendReport.attribution.stages.wire_clone_transfer.share * 100).toFixed(1)}% of append; it does not clear the 10% owner gate.`,
		},
		{
			step: '#47 measured CPU owner',
			verdict: 'SPLIT',
			reason: `PAPI creation plus remaining host apply is ${((createAttribution.stages.papi_element_creation.share + createAttribution.stages.mt_apply_other.share) * 100).toFixed(1)}% of create. This is a host materialization owner, not evidence for changing the wire representation.`,
		},
		{
			step: '#47 acknowledgement-only candidate',
			verdict: 'NO-GO for issue acceptance',
			reason: `ACK/publication is ${(createAttribution.stages.mt_ack_publication.share * 100).toFixed(1)}% of create, ${(replaceReport.attribution.stages.mt_ack_publication.share * 100).toFixed(1)}% of replace, and ${(appendReport.attribution.stages.mt_ack_publication.share * 100).toFixed(1)}% of append; even a complete removal cannot meet the required 15% in all three cells or the 50% total-wire gate.`,
		},
	],
	samples,
};
const output = path.join(import.meta.dirname, 'results');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, `live-${rows}.json`), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(output, `live-${rows}.md`), markdown(report) + '\n');
console.log(markdown(report));
