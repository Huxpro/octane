// Retained-heap attribution for the clear path (#230's retention Order).
//
// E2 closed on clear *cost* and explicitly did not close on retention:
// `heapMtsAfterClear@10k` moved 10.23 → 10.21 MiB against a 7.37 MB target, so
// 3.34 MB survives a clear with no mechanism named. That gap was measured with
// `Runtime.getHeapUsage`, which returns one number — and #230's rule is that a
// named remainder nominates nobody. Two totals subtracted cannot say who holds
// the bytes, however many repetitions back the subtraction.
//
// So this probe does not measure the gap again. It takes a V8 heap snapshot at
// three points on one fresh page and folds each into per-constructor buckets,
// which is what turns "3.34 MB is unexplained" into "N constructors hold M of
// it, and the rest is still unexplained" — a table with owners in it.
//
//   node stages/heap-retention.mjs [--rows 10000] [--reps 3] [--top 25]
//                                  [--core universal|block] [--label <name>]
//                                  [--skip-build] [--allow-busy-host]
//
// The three points are: `fresh` (shell painted, no rows), `afterCreate`, and
// `afterClear`. Two differences follow from them and answer different
// questions, which is the same split `heap-after-clear.md` draws between
// `heapMts` and `heapMtsAfterClear`:
//
//   live    = afterCreate - fresh   what 10,000 rows cost while they exist
//   retained = afterClear - fresh   what survives their removal  ← the Order
//
// Each point also records `Runtime.getHeapUsage`, the exact scalar the campaign
// harness reports. That is deliberate: it is the only way to check this
// instrument against the published `heapMtsAfterClear` rather than asking to be
// trusted, and #230 requires a metric to self-certify before it is a target.
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { applyNeutralize, makeBenchHtml } from '../web/driver-client.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';
import {
	aggregateHeapSnapshot,
	diffAggregates,
	mib,
	shareOf,
	topRetainers,
} from './heap-retention-analyze.mjs';
import {
	buildRootPaths,
	immediateRetainers,
	nodesInBucket,
	rootPathFor,
} from './heap-retainer-paths.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '10000' },
		reps: { type: 'string', default: '3' },
		top: { type: 'string', default: '25' },
		core: { type: 'string', default: 'universal' },
		label: { type: 'string', default: 'heap-retention' },
		port: { type: 'string', default: '8371' },
		attribute: { type: 'string' },
		'skip-build': { type: 'boolean', default: false },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});
const rows = Number(args.rows);
const repetitions = Number(args.reps);
const topCount = Number(args.top);
const port = Number(args.port);
if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
	throw new Error('--reps must be a positive integer.');
}
if (args.core !== 'universal' && args.core !== 'block') {
	throw new Error('--core must be universal or block.');
}

const cpuCount = os.cpus().length;
const loadPerCpu = os.loadavg()[0] / cpuCount;
if (!args['allow-busy-host'] && loadPerCpu > 0.5) {
	throw new Error(
		`quiet-host preflight failed: 1-minute load ${os.loadavg()[0].toFixed(2)} / ${cpuCount} CPUs = ${loadPerCpu.toFixed(2)}; close competing work or pass --allow-busy-host and disclose it.`,
	);
}

const createLabels = new Map([
	[1000, 'Create 1,000 rows'],
	[10000, 'Create 10,000 rows'],
]);
const createLabel = createLabels.get(rows);
if (createLabel === undefined) {
	throw new Error(`the shared app has no create button for ${rows} rows.`);
}

const bundle = path.join(
	root,
	args.core === 'block' ? 'app/dist-block' : 'app/dist',
	'main.web.bundle',
);
const webCoreClientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const webCoreRoot = path.resolve(path.dirname(webCoreClientJs), '../..');
const html = makeBenchHtml();

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
		else if (url.pathname === '/bundle/control') file = bundle;
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

/**
 * One capture: collect, read the scalar, then snapshot and fold.
 *
 * The order matters. `collectGarbage` runs first so both the scalar and the
 * snapshot describe a post-collection heap — the property `heap-after-clear.md`
 * names, and the reason anything released by a later batch does not appear
 * here. Taking the scalar before the snapshot keeps it comparable to the
 * campaign harness, which never takes a snapshot at all.
 *
 * The raw snapshot is folded and dropped inside this function rather than
 * returned. A 10,000-row snapshot is tens of megabytes of JSON, and holding
 * three of them to diff at the end would cost more memory than the thing being
 * measured.
 */
async function capture(client, phase) {
	await client.send('HeapProfiler.collectGarbage');
	const { usedSize } = await client.send('Runtime.getHeapUsage');
	const chunks = [];
	const onChunk = ({ chunk }) => chunks.push(chunk);
	client.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
	try {
		await client.send('HeapProfiler.takeHeapSnapshot', {
			reportProgress: false,
			// Roots the global objects so page-realm state is reachable and
			// attributed rather than appearing as unowned.
			treatGlobalObjectsAsRoots: true,
		});
	} finally {
		client.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
	}
	const text = chunks.join('');
	chunks.length = 0;
	const parsed = JSON.parse(text);
	const aggregate = aggregateHeapSnapshot(parsed);
	const retainers = args.attribute === undefined ? null : attributeBucket(parsed, args.attribute);
	return { phase, usedSize, aggregate, retainers };
}

/**
 * Who holds the largest nodes of one bucket, for a run given `--attribute`.
 *
 * Off by default and deliberately so. The fold is one linear pass over the
 * nodes; this adds a pass over the edges and a breadth-first walk of the whole
 * graph, on a snapshot the probe otherwise drops as soon as it is folded. That
 * is worth paying once a bucket has earned it by size and by growing per cycle,
 * and worth paying never otherwise — which is exactly the line
 * `heap-retention-attribution.md` already drew for this step.
 *
 * Both answers are recorded because they answer different questions. The
 * immediate retainers are *every* edge that lands on the node, which is exact.
 * The root path is one shortest chain from a GC root, which is context: it
 * nominates something to read in the source, and does not by itself prove the
 * nomination is why the bytes survive.
 */
function attributeBucket(parsed, bucket) {
	const nodes = nodesInBucket(parsed, bucket);
	if (nodes.length === 0) return { bucket, nodes: [] };
	const retainers = immediateRetainers(
		parsed,
		nodes.map((node) => node.ordinal),
	);
	const paths = buildRootPaths(parsed);
	return {
		bucket,
		nodes: nodes.map((node) => ({
			bytes: node.bytes,
			heldBy: retainers.get(node.ordinal) ?? [],
			rootPath: rootPathFor(parsed, paths, node.ordinal),
		})),
	};
}

async function clickAndAwait(page, label, predicate) {
	const armed = page.evaluate((spec) => globalThis.__x.arm(spec, 240000), predicate);
	const rectangle = await page.evaluate((text) => globalThis.__x.buttonRect(text), label);
	if (rectangle === null) throw new Error(`${label} button not found.`);
	await page.mouse.click(rectangle.x, rectangle.y);
	return (await armed).ms;
}

/**
 * One repetition on a page that has never held rows before.
 *
 * A fresh page per repetition is not tidiness — `heap-after-clear.md` requires
 * it. A warm page carries every preceding workload's allocation history, so a
 * second create on the same page measures that history as much as this one.
 *
 * The second create-and-clear inside a repetition is warm on purpose, and is
 * the reason the first one can be read at all. A single cycle cannot tell a
 * leak from a high-water mark: an array that grew to hold the rows and kept its
 * backing store after the clear looks exactly like an array that is still
 * holding the rows. Cycle two separates them, and it is only ever compared
 * against cycle one on the same page — never against `fresh`, which is the one
 * capture that page is entitled to.
 */
async function runSample(browser) {
	const page = await browser.newPage();
	try {
		await applyNeutralize(page);
		await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
		await page.evaluate(
			(url) => globalThis.__x.createView(url),
			`http://127.0.0.1:${port}/bundle/control`,
		);
		await page.waitForFunction(() => globalThis.__x.findText('Benchmark on Lynx'), undefined, {
			timeout: 60000,
		});
		await page.evaluate(() => globalThis.__x.settle());
		const client = await page.context().newCDPSession(page);
		await client.send('HeapProfiler.enable');
		const fresh = await capture(client, 'fresh');
		const createMs = await clickAndAwait(page, createLabel, { type: 'rowCount', value: rows });
		await page.evaluate(() => globalThis.__x.settle());
		const afterCreate = await capture(client, 'afterCreate');
		const clearMs = await clickAndAwait(page, 'Clear', { type: 'rowCount', value: 0 });
		await page.evaluate(() => globalThis.__x.settle());
		const afterClear = await capture(client, 'afterClear');
		const createMs2 = await clickAndAwait(page, createLabel, { type: 'rowCount', value: rows });
		await page.evaluate(() => globalThis.__x.settle());
		const clearMs2 = await clickAndAwait(page, 'Clear', { type: 'rowCount', value: 0 });
		await page.evaluate(() => globalThis.__x.settle());
		const afterClear2 = await capture(client, 'afterClear2');
		await client.detach();
		return {
			createMs,
			clearMs,
			createMs2,
			clearMs2,
			fresh,
			afterCreate,
			afterClear,
			afterClear2,
		};
	} finally {
		await page.close();
	}
}

function table(head, gapBytes) {
	const lines = [
		'| bucket | bytes | MiB | share of retained | nodes |',
		'|---|---:|---:|---:|---:|',
	];
	for (const row of head) {
		const share = shareOf(row.bytes, gapBytes);
		lines.push(
			`| \`${row.bucket}\` | ${row.bytes.toLocaleString('en-US')} | ${mib(row.bytes)} | ${share === null ? 'n/a' : `${share}%`} | ${row.count.toLocaleString('en-US')} |`,
		);
	}
	return lines.join('\n');
}

if (!args['skip-build']) {
	buildTableApp({ core: args.core, blockMode: 'scoped' });
}
if (!fs.existsSync(bundle)) throw new Error(`the ${args.core} bundle is missing: ${bundle}`);

const server = await startServer();
const { chromium } = require('playwright');
const browser = await chromium.launch({
	headless: true,
	...(process.env.PLAYWRIGHT_CHROMIUM_PATH
		? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
		: null),
	args: [
		'--js-flags=--expose-gc',
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
	],
});
// Read while the browser is still open; `version()` is unavailable after close.
const chromiumVersion = browser.version();
const samples = [];
try {
	for (let index = 0; index < repetitions; index++) samples.push(await runSample(browser));
} finally {
	await browser.close();
	server.close();
}

// Attribution runs on the median sample by retained scalar, not on a mean of
// aggregates. Averaging bucket tables across repetitions would invent a heap
// that no run ever had; picking one run keeps every row internally consistent
// with the scalar printed beside it.
const ordered = [...samples].sort(
	(left, right) => left.afterClear.usedSize - right.afterClear.usedSize,
);
const median = ordered[Math.floor(ordered.length / 2)];
const retained = diffAggregates(median.afterClear.aggregate, median.fresh.aggregate);
const live = diffAggregates(median.afterCreate.aggregate, median.fresh.aggregate);
// Cycle two against cycle one, on the same page. A bucket that grows again by
// roughly what it grew the first time is unbounded in the number of cycles; one
// that stays flat took its capacity once and is reusing it. Neither reading is
// available from the first cycle alone.
const perCycle = diffAggregates(median.afterClear2.aggregate, median.afterClear.aggregate);
const retainedTop = topRetainers(retained, topCount);
const liveTop = topRetainers(live, topCount);
const perCycleTop = topRetainers(perCycle, topCount);

/**
 * The commit this record measured, and whether the tree was clean.
 *
 * A record that does not name its code cannot be compared to another one. That
 * is not hypothetical: the first record this probe checked in was taken before
 * #250 folded a text child onto its host, and the two differ by half the
 * retained total — a reader holding both files could not have told which was
 * which, because neither says.
 *
 * `dirty` is part of the answer rather than a footnote. A commit id on a record
 * taken from a modified tree names code that was not what ran, which is worse
 * than naming nothing.
 *
 * Never fatal. This probe has to run from a checkout without git as readily as
 * from one with it, and a missing stamp is a known gap where a thrown error
 * would be a lost measurement.
 */
function headCommit() {
	try {
		const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		}).trim();
		const status = execFileSync('git', ['status', '--porcelain'], {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return { commit, dirty: status.trim().length > 0 };
	} catch {
		return { commit: null, dirty: null };
	}
}

const head = headCommit();

const record = {
	label: args.label,
	rows,
	core: args.core,
	reps: repetitions,
	generatedAt: new Date().toISOString(),
	provenance: {
		commit: head.commit,
		dirty: head.dirty,
		node: process.version,
		chromium: chromiumVersion,
		loadPerCpu: +loadPerCpu.toFixed(2),
		bundle: path.relative(root, bundle),
	},
	attribution: median.afterClear.retainers,
	scalars: samples.map((sample) => ({
		freshBytes: sample.fresh.usedSize,
		afterCreateBytes: sample.afterCreate.usedSize,
		afterClearBytes: sample.afterClear.usedSize,
		afterClear2Bytes: sample.afterClear2.usedSize,
		createMs: sample.createMs,
		clearMs: sample.clearMs,
		createMs2: sample.createMs2,
		clearMs2: sample.clearMs2,
	})),
	median: {
		freshBytes: median.fresh.usedSize,
		afterCreateBytes: median.afterCreate.usedSize,
		afterClearBytes: median.afterClear.usedSize,
		afterClear2Bytes: median.afterClear2.usedSize,
	},
	retained: {
		totalBytes: retained.totalBytes,
		growthBytes: retainedTop.growthBytes,
		tailBytes: retainedTop.tailBytes,
		tailBuckets: retainedTop.tailBuckets,
		top: retainedTop.head,
	},
	live: {
		totalBytes: live.totalBytes,
		growthBytes: liveTop.growthBytes,
		tailBytes: liveTop.tailBytes,
		tailBuckets: liveTop.tailBuckets,
		top: liveTop.head,
	},
	perCycle: {
		totalBytes: perCycle.totalBytes,
		growthBytes: perCycleTop.growthBytes,
		tailBytes: perCycleTop.tailBytes,
		tailBuckets: perCycleTop.tailBuckets,
		top: perCycleTop.head,
	},
};

const resultsDir = path.join(root, 'stages/results');
fs.mkdirSync(resultsDir, { recursive: true });
const jsonPath = path.join(resultsDir, `${args.label}-${rows}.json`);
fs.writeFileSync(jsonPath, `${JSON.stringify(record, null, '\t')}\n`);

/**
 * The `--attribute` walk, rendered.
 *
 * Every hop is printed, including the ones that say nothing, because a path
 * edited down to its interesting steps is a path the reader has to trust rather
 * than check. The two lists are labelled apart on purpose: `held by` is every
 * edge into the node and is exact, while the root path is one shortest chain of
 * many and is a nomination.
 */
function attributionSection(attribution) {
	if (attribution === null || attribution === undefined) return '';
	if (attribution.nodes.length === 0)
		return `\n## Retainers of \`${attribution.bucket}\`\n\nNo node in the \`afterClear\` snapshot carries that bucket.\n`;
	const blocks = attribution.nodes.map((node, index) => {
		const held = node.heldBy
			.map((entry) => `- \`${entry.holder}\` via \`${entry.via}\``)
			.join('\n');
		const path =
			node.rootPath === null
				? '_No GC root reaches this node in this snapshot._'
				: node.rootPath
						.map((hop, depth) => `${'  '.repeat(depth)}\`${hop.holder}\` --\`${hop.via}\`-->`)
						.join('\n');
		return `### Node ${index + 1} — ${node.bytes.toLocaleString('en-US')} bytes

Held by ${node.heldBy.length} edge${node.heldBy.length === 1 ? '' : 's'}:

${held}

A shortest chain from a GC root:

${path}
`;
	});
	return `
## Retainers of \`${attribution.bucket}\` — \`afterClear\`, median sample

\`held by\` is every edge that lands on the node, which is exact. The chain
below it is *a* shortest path from a GC root, not the only one and not
necessarily the responsible one: it nominates something to read in the source.

${blocks.join('\n')}`;
}

const scalarRows = record.scalars
	.map(
		(sample, index) =>
			`| ${index} | ${mib(sample.freshBytes)} | ${mib(sample.afterCreateBytes)} | ${mib(sample.afterClearBytes)} | ${mib(sample.afterClear2Bytes)} | ${sample.createMs.toFixed(1)} | ${sample.clearMs.toFixed(1)} |`,
	)
	.join('\n');

const report = `# Retained-heap attribution — ${args.core} core, ${rows.toLocaleString('en-US')} rows

${repetitions} repetition${repetitions === 1 ? '' : 's'}, a fresh page each. Attribution below is the
median sample by \`afterClear\`; the scalars from every repetition are listed so
the median is visible rather than asserted.

Measured at \`${head.commit ?? 'unknown commit'}\`${head.dirty === true ? ' **with local modifications**' : ''}, on
Node ${process.version} and ${chromiumVersion}, 1-minute load ${loadPerCpu.toFixed(2)} per CPU. The
commit is here because the numbers below are only comparable to another record
taken at a *named* commit: this probe's readings move with the element count,
and the element count moves with the code.

## Scalars (\`Runtime.getHeapUsage\`, post-collection, MiB)

These are the same reading the campaign harness records as \`heapMts\` and
\`heapMtsAfterClear\`. They are here so this probe can be checked against a
published figure rather than trusted.

| rep | fresh | afterCreate | afterClear | afterClear2 | create ms | clear ms |
|---:|---:|---:|---:|---:|---:|---:|
${scalarRows}

Median retained over fresh: **${mib(record.median.afterClearBytes - record.median.freshBytes)} MiB**
(${(record.median.afterClearBytes - record.median.freshBytes).toLocaleString('en-US')} bytes).
Median live over fresh: **${mib(record.median.afterCreateBytes - record.median.freshBytes)} MiB**.

## What survives the clear — \`afterClear\` minus \`fresh\`

Self size per constructor. The share column divides by the **retained total
above**, not by the summed rows, so the rows do not add to 100% and the
unattributed part stays visible.

A share above 100% is not an error and must not be normalised away. The
denominator is \`Runtime.getHeapUsage\`, which counts V8's managed heap only,
while a snapshot's \`self_size\` for a \`native:system / JSArrayBufferData\` row
counts the **external** backing store. Such a row is real retention that the
scalar cannot see, so it is reported at its own size against the scalar it
exceeds rather than folded into it.

${table(retainedTop.head, record.median.afterClearBytes - record.median.freshBytes)}

Beyond the top ${topCount}: **${mib(retainedTop.tailBytes)} MiB** across
${retainedTop.tailBuckets} further buckets. That row is a remainder and names no
owner — the same shape as \`off_boundary\`, and subject to the same rule.

## What the rows cost while live — \`afterCreate\` minus \`fresh\`

Kept beside the retention table because a bucket that appears in both is holding
on after teardown, while one that appears only here was released. That contrast
is the attribution; neither table alone makes it.

${table(liveTop.head, record.median.afterCreateBytes - record.median.freshBytes)}

## Leak or high-water mark — \`afterClear2\` minus \`afterClear\`

A second create-and-clear on the same page. The first cycle cannot separate a
bucket that is still holding data from one that grew a backing store and kept
it; this one can. A bucket here at roughly its cycle-one size grows once per
cycle and is unbounded. A bucket absent here took its capacity once and is
reusing it, and the cycle-one row is a high-water mark rather than a leak.

Second cycle: create ${median.createMs2.toFixed(1)} ms, clear ${median.clearMs2.toFixed(1)} ms; scalar moved
**${mib(record.median.afterClear2Bytes - record.median.afterClearBytes)} MiB**
(${(record.median.afterClear2Bytes - record.median.afterClearBytes).toLocaleString('en-US')} bytes).

${table(perCycleTop.head, record.median.afterClear2Bytes - record.median.afterClearBytes)}

Beyond the top ${topCount}: **${mib(perCycleTop.tailBytes)} MiB** across
${perCycleTop.tailBuckets} further buckets, and it names no owner either.
${attributionSection(record.attribution)}`;
const mdPath = path.join(resultsDir, `${args.label}-${rows}.md`);
fs.writeFileSync(mdPath, report);

console.log(report);
console.log(`[heap-retention] wrote ${path.relative(root, jsonPath)}`);
console.log(`[heap-retention] wrote ${path.relative(root, mdPath)}`);
