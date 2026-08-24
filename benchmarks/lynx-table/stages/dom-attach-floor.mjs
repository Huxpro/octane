// Speed-of-light control for #148 W2: what does the platform charge to publish
// a first screen?
//
//   node stages/dom-attach-floor.mjs --reps 5 --scales 1000,10000,30000
//
// W2 resolved publication's ~27% share into a swap plus a rate. The swap is
// exact: in the pre-populated first-screen window the page is detached until
// the first flush, so every node's DOM insertion lands inside `papi_flush`,
// while in the post-mount create window the page is already attached and the
// identical insertions land inside `papi_topology`. What survives the swap is
// not a fixed publication cost but a per-node rate that rises with the tree:
// the incremental path measured 2.39 / 2.34 / 2.22 us per node across a 30x
// range while the first-screen path measured 2.39 / 2.55 / 2.95.
//
// That rise is the whole of publication's residue, so the campaign needs to
// know whose it is. Nothing here is Octane's or web-core's: `__AppendElement`
// is `parent.appendChild(child)` and the first flush's publication is
// `rootDom.appendChild(page)` on a shadow root
// (`pureElementPAPIs.js:5`, `createElementAPI.js:411`). This probe therefore
// asks the browser the same question with no framework in the page at all.
//
// Five arms build the identical tree and differ only in where and when it is
// attached, and every arm runs against two element kinds. Two pairs, plus the
// allocation floor they all pay:
//
//   build              every node created, nothing ever attached
//   live-incremental   rows created and appended one at a time into a
//                      container already in the document - the post-mount
//                      shape
//   live-bulk          rows created and appended one at a time into a
//                      detached container, then one `appendChild` publishes
//                      the tree - the first-screen shape
//   split-incremental  every row built first, then all of them appended into
//                      an attached container
//   split-bulk         every row built first, then all of them appended into a
//                      detached container, then one `appendChild` publishes it
//
// The two kinds are `inert`, with the three tags unregistered, and `upgraded`,
// with the same tags registered as custom elements whose callbacks are empty.
// The harness page holds the upgraded kind - `@lynx-js/web-elements` defines
// `x-view`, `x-text`, and `raw-text` - so web-core's publishing `appendChild`
// runs one reaction per node inside the insertion. `upgraded` therefore
// decides, and `upgraded` minus `inert` is the platform's price for dispatching
// a reaction, measured in the same window and isolated from what web-elements
// does inside one.
//
// The `live-*` pair decides. It interleaves creation and attachment exactly as
// the command stream does, so it needs no deviation from what Octane pays and
// its loop is directly comparable to `papi_topology` - plus `papi_flush` on the
// bulk side. The price is that attachment is not separable from creation there
// without a clock read per append, so a live arm's rate is its whole loop. The
// `split-*` pair buys a separable `attachMs` by building everything before
// attaching anything, which the command stream never does; it localizes
// whatever the live pair finds and never overturns it.
//
// The verdict reads command cost and holds the browser's frame beside it rather
// than folding it in, because the rate this control has to explain is
// `papi_topology (+ papi_flush)` self time, which is time inside `appendChild`
// and contains no style, layout, or paint. The reading registered before the
// run - command plus frame - is printed at the end of the report so the
// substitution can be checked rather than taken on trust. Both readings refute.
//
// Falsifiable prediction, registered before the run: the platform reproduces
// the split - incremental flat per node, bulk rising with the tree. If it does,
// publication's residue is the platform floor and W2 closes under #148's second
// oracle branch. If both arms are flat, the rise is web-core's and becomes
// reducible work with a named owner.
//
// Measured outcome: refuted, on both pairs and both readings. On the deciding
// pair the platform charges the same per node whichever shape it is handed -
// bulk over incremental is 1.030x / 1.013x / 1.024x across a 30x range - so it
// does not reproduce the split, and publication's rise is not the platform's.
//
// What the run does settle is how much of publication the platform owns. The
// cleanest reading is free of instrument overhead on both sides, one call
// against two: `live-bulk`'s attach span is exactly the
// `rootDom.appendChild(page)` that `__FlushElementTree` performs, and
// `papi_flush` is two calls in the whole first-screen window, against the timed
// variant's 0.50-0.72 us per call.
//
//   rows     papi_flush   platform publish   platform share
//   1,000    1.636        0.543              33.2%
//   10,000   1.768        0.656              37.1%
//   30,000   2.175        0.660              30.3%
//
// (us per node, `upgraded` kind.) The inert kind puts the same share at
// 9.6 / 8.7 / 8.1%, which is what the first revision of this probe measured and
// reported as the whole answer. Registering the tags is three quarters of the
// platform's bill here, and the harness page registers them.
//
// Read wider - `papi_topology + papi_flush` against the control's insertion
// span - the platform is 24.5 / 26.7 / 24.1% of Octane's first-screen insertion
// rate and 22.4% of its rise across the range. Same order, weaker precision:
// `papi_topology` is 7,041 / 70,041 / 210,041 calls, so it carries per-call
// instrument overhead the flush comparison does not.
//
// So about a third of publication is the platform, and the rest is named code -
// web-core's own `__FlushElementTree` body and the `connectedCallback` bodies
// `@lynx-js/web-elements` installs, which the empty callbacks here deliberately
// exclude. Neither is a platform floor, so #148's second oracle branch does not
// close on publication.
//
// Fidelity to what web-core actually builds, so the browser does the same work:
// the same tag names (`x-view`, `x-text`, `raw-text`), the same 7 elements per
// row, the same `text` attribute on each `raw-text`, the same class names, and
// the same shadow root carrying the app's own stylesheet.
//
// Registration is an axis here rather than an assumption. The first revision of
// this probe asserted the three tags were unregistered - read from sources,
// never checked in the running page - and attributed the whole difference to
// web-core. They are registered, and the attribution was wrong by a factor of
// three. Every sample now reports its own registration state and the runner
// rejects a cell that ran the wrong kind.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
	ARM_NAMES,
	ELEMENT_KINDS,
	NODES_PER_ROW,
	cellName,
	cellNames,
	summarizeArm,
	verdictFor,
} from './dom-attach-analyze.mjs';
import { renderFloorReport } from './dom-attach-report.mjs';
import { rotatedSchedule } from './papi-analyze.mjs';
import { chromiumLaunchOptions } from '../web/driver-client.mjs';

const root = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
	options: {
		reps: { type: 'string', default: '5' },
		scales: { type: 'string', default: '1000,10000,30000' },
		port: { type: 'string', default: '8364' },
		label: { type: 'string', default: 'dom-attach-floor' },
		'allow-busy-host': { type: 'boolean', default: false },
	},
});
// Five arms in two pairs plus a floor, measured against both element kinds in
// one window. The `live-*` pair interleaves creation and attachment exactly as
// the command stream does, so its total is directly comparable to Octane's
// `papi_topology (+ papi_flush)` group and carries no deviation — that pair
// decides the prediction. The `split-*` pair builds first and attaches second,
// which costs a deviation but buys a separable `attachMs`, and localizes
// whatever the live pair finds.
const CELLS = cellNames();
const scales = args.scales
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
if (scales.length === 0) throw new TypeError('at least one scale is required.');
for (const rows of scales) {
	if (!Number.isSafeInteger(rows) || rows <= 0) throw new TypeError('scales must be positive.');
}
const outputStem = args.label.trim();
if (!/^[a-z0-9][a-z0-9-]*$/.test(outputStem)) {
	throw new TypeError('--label must be lowercase alphanumeric with dashes.');
}
const port = Number(args.port);
const cpuCount = os.cpus().length;
const loadPerCpu = os.loadavg()[0] / cpuCount;
if (!args['allow-busy-host'] && loadPerCpu > 0.5) {
	throw new Error(
		`quiet-host preflight failed: 1-minute load ${os.loadavg()[0].toFixed(2)} / ${cpuCount} CPUs = ${loadPerCpu.toFixed(2)}; close competing work or pass --allow-busy-host and disclose it.`,
	);
}

const appCss = fs.readFileSync(path.join(root, 'app/src/app.css'), 'utf8');

// The measured page. Everything runs in the page realm with no module loading,
// so nothing but the browser is on the clock inside a measured span.
//
// Each arm reports three spans, and only their sum is a wall the arms share:
//
//   buildMs    creating the row's 7 elements and linking them to each other,
//              always detached - identical work in all three arms
//   attachMs   linking each row into its container (`incremental` into a live
//              one, `bulk` into a detached one), plus `bulk`'s single publishing
//              `appendChild` of the whole tree
//   frameMs    the next animation frame with a forced layout read, so style and
//              layout are inside the measurement rather than after it
//
// `build` and `attach` are timed as two spans over the whole loop rather than
// per call: a clock read per row would cost more than the append it brackets at
// these scales, and the arms differ only in attachment, so their difference is
// the answer whether or not the split inside a row is exact.
const PAGE_JS = String.raw`
const COLUMNS = ['col-id', 'col-label', 'col-remove'];

function buildRow(index) {
  const row = document.createElement('x-view');
  row.setAttribute('class', 'row');
  for (let column = 0; column < 3; column += 1) {
    const cell = document.createElement('x-text');
    cell.setAttribute('class', COLUMNS[column]);
    const text = document.createElement('raw-text');
    text.setAttribute('text', column === 0 ? String(index) : column === 1 ? 'row ' + index : 'x');
    cell.appendChild(text);
    row.appendChild(cell);
  }
  return row;
}

// The three tags the first screen is built from. The harness page has all of
// them registered - @lynx-js/web-elements defines each one - so an 'upgraded'
// sample runs one custom-element reaction per node inside the insertion, as
// web-core's publishing appendChild does. The callback bodies are empty on
// purpose: what is being isolated here is the platform's cost of running a
// reaction, not what web-elements does inside one.
const TAGS = ['x-view', 'x-text', 'raw-text'];
globalThis.__upgradeElements = function () {
  for (const tag of TAGS) {
    if (customElements.get(tag) !== undefined) continue;
    customElements.define(
      tag,
      class extends HTMLElement {
        connectedCallback() {}
        disconnectedCallback() {}
      },
    );
  }
};

globalThis.__registered = function () {
  return TAGS.filter((tag) => customElements.get(tag) !== undefined);
};

globalThis.__domAttachFloor = function (arm, rows) {
  const bulk = arm.endsWith('-bulk');
  const live = arm.startsWith('live-');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = document.getElementById('app-css').textContent;
  shadow.appendChild(style);

  // The page node web-core creates, and the container the rows go into. For
  // 'incremental' the page is published before the loop, so every row append
  // lands in a live tree; for 'bulk' it is published after, in one call.
  const page = document.createElement('x-view');
  page.setAttribute('class', 'page');
  const container = document.createElement('x-view');
  container.setAttribute('class', 'rows');
  page.appendChild(container);
  // The incremental arms publish the page before the loop, so every row append
  // lands in a live tree; the bulk arms publish after, in one call.
  if (arm !== 'build' && !bulk) shadow.appendChild(page);

  const built = new Array(rows);
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  if (live) {
    // One loop, create and attach per row: the command stream's own shape. No
    // separable attach span exists here, and none is claimed - buildMs is the
    // whole loop and attachMs is only the publishing call the bulk arm makes.
    t0 = performance.now();
    for (let index = 0; index < rows; index += 1) {
      const row = buildRow(index);
      built[index] = row;
      container.appendChild(row);
    }
    t1 = performance.now();
    if (bulk) shadow.appendChild(page);
    t2 = performance.now();
  } else {
    t0 = performance.now();
    for (let index = 0; index < rows; index += 1) built[index] = buildRow(index);
    t1 = performance.now();
    if (arm !== 'build') {
      for (let index = 0; index < rows; index += 1) container.appendChild(built[index]);
      if (bulk) shadow.appendChild(page);
    }
    t2 = performance.now();
  }

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      // Reading a layout property inside the frame forces style resolution and
      // layout to happen before the stamp rather than after it. 'build' has
      // nothing in the document to lay out, which is the point: its frame is
      // the arm's own floor for this read.
      const laidOut = arm === 'build' ? built[rows - 1].childElementCount : shadow.host.offsetHeight;
      const t3 = performance.now();
      const attached = arm === 'build' ? 0 : shadow.querySelectorAll('x-view.row').length;
      resolve({
        arm,
        rows,
        registered: globalThis.__registered(),
        upgraded: built[0].constructor !== HTMLElement,
        buildMs: t1 - t0,
        attachMs: t2 - t1,
        frameMs: t3 - t2,
        totalMs: t3 - t0,
        attached,
        laidOut,
      });
    });
  });
};
`;

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style id="app-css-holder">html,body{margin:0;padding:0}</style>
  <script type="application/x-css" id="app-css">${appCss}</script>
</head>
<body>
<script>${PAGE_JS}</script>
</body>
</html>`;

const server = await new Promise((resolve) => {
	const created = http.createServer((request, response) => {
		if (new URL(request.url, 'http://localhost').pathname !== '/') {
			response.writeHead(404);
			response.end('not found');
			return;
		}
		response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
		response.end(html);
	});
	created.listen(port, () => resolve(created));
});

const { chromium } = await import('playwright');
const browser = await chromium.launch(chromiumLaunchOptions());
// Every node in this probe is created and attached by the page's own script, so
// the row count each arm reports is the oracle on whether it did the work: an
// arm that silently attached nothing would otherwise report a very fast wall.
const samples = Object.fromEntries(
	scales.map((rows) => [rows, Object.fromEntries(CELLS.map((cell) => [cell, []]))]),
);
const loadStart = os.loadavg();

for (const rows of scales) {
	for (const order of rotatedSchedule(args.reps, CELLS)) {
		for (const cell of order) {
			const [kind, arm] = cell.split(':');
			// Fresh page per sample: a second run in the same realm would inherit
			// the first one's heap and its resolved style rules — and a realm that
			// has already registered the tags can never measure the inert kind
			// again, since `customElements.define` is permanent.
			const page = await browser.newPage();
			await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
			if (kind === 'upgraded') await page.evaluate(() => globalThis.__upgradeElements());
			const sample = await page.evaluate(
				([armName, rowCount]) => globalThis.__domAttachFloor(armName, rowCount),
				[arm, rows],
			);
			await page.close();
			if (arm === 'build' ? sample.attached !== 0 : sample.attached !== rows) {
				throw new Error(
					`${cell}@${rows} published ${sample.attached} rows; the arm did not do its own work.`,
				);
			}
			// The forced read inside the frame is what puts style and layout on
			// the clock. A zero here means it resolved nothing, so the arm's
			// `frameMs` would be an empty frame reported as a layout.
			if (!(sample.laidOut > 0)) {
				throw new Error(
					`${cell}@${rows} forced no layout: the frame read returned ${sample.laidOut}.`,
				);
			}
			// The kind is the whole point of this axis, so it is asserted from the
			// page rather than assumed from the cell name. The claim that failed
			// the first time this control ran was exactly a registration claim
			// made from reading sources instead of from the running page.
			const wantUpgraded = kind === 'upgraded';
			if (sample.upgraded !== wantUpgraded || sample.registered.length !== (wantUpgraded ? 3 : 0)) {
				throw new Error(
					`${cell}@${rows} ran with registered=[${sample.registered}] upgraded=${sample.upgraded}; expected ${wantUpgraded ? 'all three tags registered' : 'none registered'}.`,
				);
			}
			samples[rows][cell].push(sample);
			console.log(
				`[floor] rows=${rows} ${cell} build=${sample.buildMs.toFixed(1)} attach=${sample.attachMs.toFixed(1)} frame=${sample.frameMs.toFixed(1)} total=${sample.totalMs.toFixed(1)}`,
			);
		}
	}
}

await browser.close();
server.close();

// --- analysis -------------------------------------------------------------

const round = (value, digits = 1) => Number(value.toFixed(digits));

const perScale = scales.map((rows) => ({
	rows,
	arms: Object.fromEntries(CELLS.map((cell) => [cell, summarizeArm(samples[rows][cell], rows)])),
}));

// --- report ---------------------------------------------------------------

const meta = {
	date: new Date().toISOString(),
	cpus: cpuCount,
	cpuModel: os.cpus()[0]?.model ?? 'unknown',
	platform: os.platform(),
	release: os.release(),
	node: process.version,
	chromium: browser.version?.() ?? 'unknown',
	repetitions: Number(args.reps),
	arms: ARM_NAMES,
	kinds: ELEMENT_KINDS,
	cells: CELLS,
	scales,
	nodesPerRow: NODES_PER_ROW,
	loadStart,
	loadEnd: os.loadavg(),
	protocol:
		'fresh page per sample; cell order rotates across repetitions; no framework, no web-core, and no app bundle is loaded — the page builds the tree itself, and every sample asserts in the page whether its three tags were registered',
};

// Rendered and decided by the report module, so a finished run can be
// re-rendered from its frozen samples with `dom-attach-report.mjs` when the
// rules that decide the claim change.
const text = renderFloorReport(meta, perScale);
const verdict = verdictFor(perScale, CELLS);

const output = path.join(import.meta.dirname, 'results');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
	path.join(output, `${outputStem}.json`),
	JSON.stringify({ meta, scales: perScale, verdict, samples }, null, 2) + '\n',
);
fs.writeFileSync(path.join(output, `${outputStem}.md`), text + '\n');
console.log('\n' + text);
console.log(`[floor] wrote ${path.relative(root, path.join(output, `${outputStem}.md`))}`);
