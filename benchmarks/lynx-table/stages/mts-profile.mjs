// What the main-thread script itself spends the first screen on.
//
//   node stages/mts-profile.mjs --rows 10000
//   node stages/mts-profile.mjs --rows 1000 --reps 3 --cells octane,octane-mts-program
//
// The Element PAPI boundary instrument (`stages/papi-run.mjs`) prices the first
// screen either side of the host boundary, and its phase split says which
// first-screen phase owns the part above it. Issue #163 needs one level finer:
// a compiled main-thread program issues the same host calls a hand-written
// emitter issues, for the same host time, and is still well short of it — so
// the cost is the framework's own script, and the question is which part.
//
// This samples that script directly. Chromium's CPU profiler runs over the page
// while a pre-populated bundle paints, and only frames belonging to the hidden
// main-thread realm's Blob script are folded: the page realm runs the harness's
// own predicate walker, which is measurement rather than framework. Frames are
// named by the string literals in the code, which the minifier cannot rename —
// see `stages/mts-profile-buckets.mjs` for the probe table.
//
// **The absolute milliseconds here are not the boundary instrument's.** A
// sampling profiler perturbs the page it measures, and this run has no
// uninstrumented control beside it. What this instrument reports is the shape:
// which framework function owns the script, and how the three cells compare on
// the same axis. Take wall clocks from `papi-run.mjs`.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import {
	applyNeutralize,
	applyStageClock,
	chromiumLaunchOptions,
	makeBenchHtml,
	stats,
} from '../web/driver-client.mjs';
import { foldProfile, PROBE_WINDOW, SITES_BY_BUCKET } from './mts-profile-buckets.mjs';
import { tagFrom } from '../scripts/build-app.mjs';
import { bundleIdentity, writeEvidenceJson } from '../scripts/evidence.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '5' },
		cells: { type: 'string', default: 'octane,octane-mts-program,octane-direct' },
		label: { type: 'string', default: 'mts-profile' },
		port: { type: 'string', default: '8364' },
		interval: { type: 'string', default: '100' },
		'allow-busy-host': { type: 'boolean', default: false },
		// Issue-#163 C10: the same app and the same program backend, built from a
		// different revision of the renderer into a tagged dist, so an A/B of
		// main-thread script is one window rather than two runs compared across
		// hours. Mirrors `papi-run.mjs --control-dist`, including registering the
		// cell only when the flag names a tag: a run that built no control arm
		// gets no such cell instead of one pointing at a directory nothing wrote.
		// Nothing here says which revision it is, because the harness cannot know
		// and a name implying it could would be the harness lying about
		// provenance the record now carries honestly.
		//
		// Issue-#163 C11 widened it to a comma-separated list, because a ladder of
		// ablations is only a ladder when every rung ran in the same window: two
		// records of identical bundles disagree by up to 9% on the whole-script
		// median, which is larger than the rungs being separated, so arms compared
		// across windows are not compared at all. Each tag becomes its own cell,
		// named after the tag — a single arm used to be spelled
		// `octane-mts-program-control`, which is the cell name in C10's record.
		'control-dist': { type: 'string', default: '' },
	},
});
const rows = Number(args.rows);
const reps = Number(args.reps);
const port = Number(args.port);
const interval = Number(args.interval);
const cellIds = args.cells.split(',').map((value) => value.trim());

const controlTags = args['control-dist']
	.split(',')
	.map((value) => value.trim())
	.filter((value) => value !== '');
// A repeated tag would quietly halve the ladder: two cells resolving to one
// directory read as two arms that agreed, which is the one answer an ablation
// must never be able to fake.
if (new Set(controlTags).size !== controlTags.length) {
	throw new Error(`--control-dist repeats a tag: ${args['control-dist']}`);
}
/** Pre-populated bundles only: this instrument measures a first screen, never a click. */
const CELLS = {
	octane: (n) => path.join(root, `app/dist-rows${n}/main.web.bundle`),
	'octane-mts-program': (n) => path.join(root, `app/dist-mtsprogram-rows${n}/main.web.bundle`),
	...Object.fromEntries(
		controlTags.map((tag) => [
			`octane-mts-program-${tag}`,
			// Validated by the writer of that directory name rather than re-spelled
			// here, so a value `build-app.mjs` would have refused cannot name a path
			// nothing built.
			(n) => path.join(root, `app/dist-mtsprogram${tagFrom(tag)}-rows${n}/main.web.bundle`),
		]),
	),
	'octane-direct': (n) => path.join(root, `prototype/dist-rows${n}/main.web.bundle`),
};
const HEADINGS = {
	octane: 'Octane',
	'octane-mts-program': 'Octane (main-thread program)',
	...Object.fromEntries(
		controlTags.map((tag) => [
			`octane-mts-program-${tag}`,
			`Octane (main-thread program, \`${tag}\` arm)`,
		]),
	),
	'octane-direct': 'L0 direct-emission prototype',
};
for (const id of cellIds) {
	if (CELLS[id] === undefined) throw new Error(`unknown cell ${JSON.stringify(id)}.`);
	const file = CELLS[id](rows);
	if (!fs.existsSync(file)) {
		throw new Error(`${id} has no pre-populated bundle at ${rows} rows: ${file}`);
	}
}

// --- server -----------------------------------------------------------------

const PAGES = { '/control': makeBenchHtml() };
const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const MIME = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.wasm': 'application/wasm',
	'.bundle': 'application/octet-stream',
};

function startServer() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, 'http://localhost');
		const page = PAGES[url.pathname];
		if (page !== undefined) {
			response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
			response.end(page);
			return;
		}
		let file = null;
		if (url.pathname.startsWith('/webcore/')) file = path.join(webCoreRoot, url.pathname.slice(9));
		else if (url.pathname.startsWith('/bundle/')) file = CELLS[url.pathname.slice(8)]?.(rows);
		if (file === undefined || file === null || !fs.existsSync(file)) {
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
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// --- sampling ---------------------------------------------------------------

/**
 * One profiled first screen. The main-thread script is a Blob minted in the
 * page realm, so the URL is recorded there on the way past and its source is
 * fetched back afterwards — the profile names frames by that URL and nothing
 * else can say what the code at a position is.
 */
async function profileSample(browser, cell) {
	const page = await browser.newPage();
	try {
		await page.addInitScript(() => {
			const mint = URL.createObjectURL.bind(URL);
			globalThis.__OCTANE_BLOB_URLS__ = [];
			URL.createObjectURL = (blob) => {
				const url = mint(blob);
				globalThis.__OCTANE_BLOB_URLS__.push(url);
				return url;
			};
		});
		await applyNeutralize(page);
		await applyStageClock(page);
		await page.goto(`http://127.0.0.1:${port}/control`, { waitUntil: 'load' });
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Profiler.enable');
		await cdp.send('Profiler.setSamplingInterval', { interval });
		await cdp.send('Profiler.start');
		const observed = await page.evaluate(
			(request) => {
				globalThis.__x.createView(request.bundleUrl);
				return globalThis.__x.fcp({ minContent: request.rows, idleMs: 300, timeoutMs: 240000 });
			},
			{ bundleUrl: `http://127.0.0.1:${port}/bundle/${cell}`, rows },
		);
		const { profile } = await cdp.send('Profiler.stop');
		if (observed.dnf) throw new Error(`${cell} never painted ${rows} rows.`);

		const scriptUrl = [...new Set(profile.nodes.map((node) => node.callFrame.url))].find((url) =>
			url.startsWith('blob:'),
		);
		if (scriptUrl === undefined) {
			throw new Error(`${cell} produced no main-thread script frames; the profile named none.`);
		}
		const source = await page.evaluate(
			(url) =>
				fetch(url)
					.then((response) => response.text())
					.catch(() => null),
			scriptUrl,
		);
		if (source === null) throw new Error(`${cell}'s main-thread script could not be read back.`);
		const lines = source.split('\n');
		const sourceAt = (line, column) =>
			(lines[line] ?? '').slice(Math.max(0, column), Math.max(0, column) + PROBE_WINDOW);
		return { ...foldProfile(profile, scriptUrl, sourceAt), sourceAt };
	} finally {
		await page.close();
	}
}

/** Cell order rotates per repetition, so no cell always runs on a cold browser. */
function rotated(count, ids) {
	return Array.from({ length: count }, (_, index) =>
		ids.map((_, i) => ids[(i + index) % ids.length]),
	);
}

// --- run --------------------------------------------------------------------

const loadStart = os.loadavg();
if (loadStart[0] > 2 && !args['allow-busy-host']) {
	throw new Error(
		`host one-minute load is ${loadStart[0].toFixed(2)}; pass --allow-busy-host to sample anyway.`,
	);
}
const server = await startServer();
const { chromium } = require('playwright');
const browser = await chromium.launch(chromiumLaunchOptions());
const samples = Object.fromEntries(cellIds.map((id) => [id, []]));
const witnesses = new Map();
try {
	for (const order of rotated(reps, cellIds)) {
		for (const id of order) {
			const folded = await profileSample(browser, id);
			samples[id].push(folded);
			// One reading's source is kept per cell so the report can show the code
			// behind an unnamed frame instead of only its position.
			if (!witnesses.has(id)) witnesses.set(id, folded.sourceAt);
			const total = [...folded.buckets.values()].reduce((sum, cell) => sum + cell.us, 0);
			console.log(
				`[mts] ${id} @${rows}: ${(total / 1000).toFixed(1)} ms named, ${folded.samples} samples`,
			);
		}
	}
} finally {
	await browser.close();
	server.close();
}
const loadEnd = os.loadavg();

// --- report -----------------------------------------------------------------

const round = (value, places) => Number(value.toFixed(places));
const bucketNames = [
	...new Set(cellIds.flatMap((id) => samples[id].flatMap((s) => [...s.buckets.keys()]))),
];
const cells = {};
for (const id of cellIds) {
	const perBucket = {};
	for (const name of bucketNames) {
		const ms = samples[id].map((sample) => (sample.buckets.get(name)?.us ?? 0) / 1000);
		perBucket[name] = stats(ms);
	}
	// The same time keyed by source site rather than by bucket. A bucket folding
	// six functions says where the script is without saying what it is doing,
	// and the sites are what answer that.
	const perSite = {};
	for (const name of bucketNames) {
		for (const site of SITES_BY_BUCKET[name] ?? []) {
			const ms = samples[id].map((sample) => (sample.sites.get(site)?.us ?? 0) / 1000);
			// Across every reading, not per reading: a function entered in one rep
			// and not the next is still a function this site folds.
			const positions = new Set(
				samples[id].flatMap((sample) => [...(sample.sites.get(site)?.positions ?? [])]),
			);
			perSite[site] = { ...stats(ms), frames: positions.size };
		}
	}
	// A site the fold produced that no bucket claims would go missing silently,
	// and a bucket whose sites do not sum to it would be a split that reads as an
	// attribution while hiding time. Both are refusals rather than roundings: the
	// two maps are built from one pass over one set of frames, so any drift
	// between them is a defect in this file, not a property of the run.
	for (const sample of samples[id]) {
		for (const site of sample.sites.keys()) {
			if (perSite[site] === undefined) {
				throw new Error(
					`${id}: fold produced site ${JSON.stringify(site)}, which no bucket lists.`,
				);
			}
		}
		for (const [name, cell] of sample.buckets) {
			const fromSites = (SITES_BY_BUCKET[name] ?? []).reduce(
				(sum, site) => sum + (sample.sites.get(site)?.us ?? 0),
				0,
			);
			if (Math.abs(fromSites - cell.us) > 1e-6) {
				throw new Error(
					`${id}: bucket ${JSON.stringify(name)} is ${cell.us} µs but its sites sum to ${fromSites}.`,
				);
			}
		}
	}
	const namedMs = samples[id].map(
		(sample) => [...sample.buckets.values()].reduce((sum, cell) => sum + cell.us, 0) / 1000,
	);
	const unmatchedMs = samples[id].map(
		(sample) => [...sample.unmatched.values()].reduce((sum, cell) => sum + cell.us, 0) / 1000,
	);
	// The largest frame the probe table did not name, from the first reading, so
	// an unnamed cost is inspectable rather than a number with nothing behind it.
	const first = samples[id][0];
	const worst = [...first.unmatched].sort((a, b) => b[1].us - a[1].us).slice(0, 3);
	const sourceAt = witnesses.get(id);
	cells[id] = {
		buckets: perBucket,
		sites: perSite,
		namedMs: stats(namedMs),
		unmatchedMs: stats(unmatchedMs),
		totalMs: stats(namedMs.map((value, index) => value + unmatchedMs[index])),
		largestUnnamed: worst.map(([position, cell]) => {
			const [line, column] = position.split(':').map(Number);
			return {
				position,
				ms: round(cell.us / 1000, 1),
				source: sourceAt(line, column).slice(0, 140).replace(/\s+/g, ' '),
			};
		}),
	};
}

const meta = {
	date: new Date().toISOString(),
	node: process.version,
	cpus: os.cpus().length,
	cpuModel: os.cpus()[0]?.model ?? 'unknown',
	platform: os.platform(),
	release: os.release(),
	chromium: null,
	rows,
	reps,
	samplingIntervalUs: interval,
	cells: cellIds,
	// Which bytes this run measured, not merely when it ran. A profile compared
	// against another profile is only a comparison if both measured the same
	// build, and a date cannot say whether they did — see `bundleIdentity`.
	bundles: Object.fromEntries(
		cellIds.map((id) => [id, bundleIdentity(CELLS[id](rows), { relativeTo: root })]),
	),
	loadStart: loadStart.map((value) => round(value, 2)),
	loadEnd: loadEnd.map((value) => round(value, 2)),
};
const report = { meta, cells };
const outDir = path.join(import.meta.dirname, 'results');
fs.mkdirSync(outDir, { recursive: true });
await writeEvidenceJson(path.join(outDir, `${args.label}-${rows}.json`), report);

const lines = [
	`# Main-thread script attribution — ${cellIds.map((id) => HEADINGS[id] ?? id).join(' vs ')}`,
	'',
	`- measured: ${meta.date}`,
	`- host: ${meta.cpus}× ${meta.cpuModel}; ${meta.platform} ${meta.release}; Node ${meta.node}`,
	`- ${rows} rows, ${reps} profiled first screens per cell, ${interval} µs sampling interval`,
	`- one-minute load ${meta.loadStart[0]} → ${meta.loadEnd[0]}`,
	'',
	'## Which build this measured',
	'',
	'`digest` names the bytes: two records that agree on it for a cell measured the',
	'same code, which is what an A/B at one scale needs in order to be an A/B.',
	'Across scales the bundles differ by construction — the row count is compiled',
	'in — so what makes several records one series is instead that every bundle was',
	'built from one revision, and `built` is what answers that. A bundle older than',
	'the last commit under `packages/` measured a stale build, and reading it beside',
	'a fresh one turns a version difference into an apparent workload effect.',
	'',
	'| cell | bundle | bytes | digest | built |',
	'|---|---|---:|---|---|',
	...cellIds.map((id) => {
		const it = meta.bundles[id];
		return `| \`${id}\` | \`${it.path}\` | ${it.bytes} | \`${it.digest}\` | ${it.modified} |`;
	}),
	'',
	'## What this is, and is not',
	'',
	'Self time inside the hidden main-thread realm only. The page realm runs the',
	"harness's own paint predicate, which is measurement rather than framework, and",
	'is excluded. Frames are named by the string literals in the code, because a',
	'production bundle is minified and a mangled name says nothing; the probe table',
	'is `stages/mts-profile-buckets.mjs`, and every probe cites the source it came',
	'from.',
	'',
	'**These milliseconds are not the boundary instrument’s.** A sampling profiler',
	'perturbs the page it measures and this run carries no uninstrumented control.',
	'What is reportable here is the shape — which function owns the script, and how',
	'the cells compare on one axis. Wall clocks come from `stages/papi-run.mjs`.',
	'',
	`## Self time by framework function @${rows}`,
	'',
	`| main-thread script | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
	`|---|${cellIds.map(() => '---:').join('|')}|`,
];
const rowFor = (name, pick) =>
	`| ${name} | ${cellIds
		.map((id) => {
			const stat = pick(cells[id]);
			return stat === null
				? '—'
				: `${round(stat.median, 1)} [${round(stat.min, 1)}–${round(stat.max, 1)}]`;
		})
		.join(' | ')} |`;
const ordered = [...bucketNames].sort((a, b) => {
	const weight = (name) => Math.max(...cellIds.map((id) => cells[id].buckets[name]?.median ?? 0));
	return weight(b) - weight(a);
});
for (const name of ordered) lines.push(rowFor(name, (cell) => cell.buckets[name]));
lines.push(
	rowFor('named total', (cell) => cell.namedMs),
	rowFor('unnamed by the probe table', (cell) => cell.unmatchedMs),
	rowFor('**main-thread script, all frames**', (cell) => cell.totalMs),
	'',
);

// How many buckets fold several functions, and which folds the most, are facts
// about the probe table rather than about the run. Deriving them keeps the
// paragraph below from describing a split the table stopped having: a probe
// added upstairs would otherwise leave a record confidently naming the wrong
// bucket as the widest, in the prose that exists to warn against exactly that.
const multiSite = ordered.filter((name) => (SITES_BY_BUCKET[name] ?? []).length > 1);
const widest = multiSite.reduce(
	(a, b) => (SITES_BY_BUCKET[b].length > SITES_BY_BUCKET[a].length ? b : a),
	multiSite[0],
);
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = (n) => COUNT_WORDS[n] ?? String(n);

if (multiSite.length > 0) {
	lines.push(
		'### Inside the buckets that fold several functions',
		'',
		`A bucket is a probe table entry, not a function, and ${countWord(multiSite.length)} of the rows above`,
		`name more than one. \`${widest}\` names ${countWord(SITES_BY_BUCKET[widest].length)}, so its row says which`,
		'file the script is in and nothing about what it is doing there. These are the',
		'same samples keyed by the source each probe was taken from; every bucket below',
		'sums to its own row above, which the report checks rather than assumes. A site',
		'at 0.0 is a function the run never entered, reported rather than dropped so',
		'that a probe which stopped matching looks different from a branch nothing took.',
		'',
		'A site is a claim about the source, so each cell also says how many distinct',
		'frame positions its probe actually matched. One is a site whose total is a',
		'single function’s. More is a total shared between frames, and which kind it is',
		'has to be read from the source: two entrances the minifier made to one',
		'function look exactly like two functions a probe was wide enough to reach.',
		'The count does not settle that, and it is printed so the number is not read as',
		'a single function’s cost before it has been.',
		'',
	);
}
for (const name of multiSite) {
	const sites = SITES_BY_BUCKET[name];
	// `frames` is how many distinct frame positions the site folded. One is a
	// site that measured a single function; more is a site whose total is shared,
	// which the reader has to see before reading it as one function's cost.
	const siteRow = (site) =>
		`| \`${site}\` | ${cellIds
			.map((id) => {
				const stat = cells[id].sites[site];
				if (stat === undefined) return '—';
				const value = `${round(stat.median, 1)} [${round(stat.min, 1)}–${round(stat.max, 1)}]`;
				return stat.frames > 1 ? `${value} · ${stat.frames} frames` : value;
			})
			.join(' | ')} |`;
	lines.push(
		`**${name}**`,
		'',
		`| source site | ${cellIds.map((id) => `\`${id}\``).join(' | ')} |`,
		`|---|${cellIds.map(() => '---:').join('|')}|`,
		...sites.map((site) => siteRow(site)),
		rowFor(`**${name}, all sites**`, (cell) => cell.buckets[name]),
		'',
	);
}
lines.push(
	'### The largest frames the probe table did not name',
	'',
	'Reported rather than folded away: an unnamed frame is either a function worth a',
	'probe or a bucket whose probe stopped matching, and both are visible here. The',
	'prototype cell is the exception by construction: it runs no Octane code, so no',
	'probe can name it and its whole script is unnamed.',
	'',
);
for (const id of cellIds) {
	lines.push(`- \`${id}\``);
	for (const frame of cells[id].largestUnnamed) {
		lines.push(`  - ${frame.ms} ms at ${frame.position} — \`${frame.source}\``);
	}
}
lines.push('');
fs.writeFileSync(path.join(outDir, `${args.label}-${rows}.md`), `${lines.join('\n')}\n`);
console.log(`\n[mts] wrote results/${args.label}-${rows}.{json,md}`);
