/**
 * Assemble the L0 direct-emission prototype cell (issue #58) into Lynx web
 * bundles that the existing lynx-table harnesses can serve unmodified.
 *
 * The bundle is the JSON TasmJSONInfo form web-core's decode worker accepts
 * alongside the binary container: pageConfig is copied from the Octane-built
 * bundle's Configurations section so engine behavior toggles match the octane
 * cell exactly, and styleInfo carries the same app/src/app.css text, so the
 * only variable under measurement is the main-thread/background program pair.
 *
 *   node prototype/build.mjs [--rows 10000[,1000,...]] [--retain dynamic|none]
 *
 * writes prototype/dist/main.web.bundle           (empty table, click-driven)
 *        prototype/dist-rows{N}/main.web.bundle   (mount-create FCP ladder)
 *        prototype/dist-rows{N}-retain-none/...   (issue #215 D4 retention arm)
 *
 * `--retain none` drops the two per-row slot-table pushes and nothing else, so
 * the arm issues an *identical* PAPI call multiset and differs only in how many
 * created element wrappers JavaScript still holds when the row is finished. It
 * is a capacity probe for the ART global reference table (#215 D4) and it
 * breaks every delta op, so it is create-only: `--rows` is required and
 * `smoke.mjs` must not be pointed at it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { readWebBundleSections } from './bundle-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const { values: args } = parseArgs({
	options: {
		rows: { type: 'string', default: '' },
		/** Issue #215 D4: how many created wrappers a finished row still holds. */
		retain: { type: 'string', default: 'dynamic' },
	},
});
if (args.retain !== 'dynamic' && args.retain !== 'none') {
	throw new Error(`--retain takes 'dynamic' or 'none', not '${args.retain}'`);
}

const autoRowVariants = args.rows
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);
// The retention arm has no click-driven form: with nothing in the slot table
// every delta op addresses `undefined`, so an empty-table build of it would be
// a cell that paints and then breaks on the first tap.
if (args.retain === 'none' && autoRowVariants.length === 0) {
	throw new Error('--retain none is a create-only probe; pass --rows.');
}

const octaneBundlePath = path.join(root, 'app/dist/main.web.bundle');
if (!fs.existsSync(octaneBundlePath)) {
	throw new Error(
		`Build the octane app first (scripts/build-app.mjs): missing ${octaneBundlePath}`,
	);
}
const pageConfig = readWebBundleSections(octaneBundlePath).configurations;

const appCss = fs.readFileSync(path.join(root, 'app/src/app.css'), 'utf8');
const lepusSource = fs.readFileSync(path.join(here, 'lepus-root.js'), 'utf8');
const serviceSource = fs.readFileSync(path.join(here, 'app-service.js'), 'utf8');

// The only edit the retention arm makes. A deletion, so the `dynamic` arm's
// bundle stays byte-identical to what every published octane-direct number was
// measured on — the switch cannot perturb the floor cell it is compared against.
const SLOT_TABLE_PUSHES = '\t\trowViews.push(row);\n\t\tlabelRaws.push(labelRaw);\n';
if (!lepusSource.includes(SLOT_TABLE_PUSHES)) {
	throw new Error('prototype/lepus-root.js no longer has the slot-table push anchor.');
}

function buildVariant(autoRows) {
	const held =
		args.retain === 'none'
			? (source) =>
					source.replace(
						SLOT_TABLE_PUSHES,
						'\t\t// issue #215 D4 retention arm: the row keeps no created wrapper.\n',
					)
			: (source) => source;
	const define = (source) => held(source.replace(/__AUTO_ROWS__/g, String(autoRows)));
	return JSON.stringify({
		styleInfo: { 0: { content: [appCss], rules: [] } },
		manifest: { '/app-service.js': define(serviceSource) },
		cardType: pageConfig.cardType ?? 'react',
		appType: 'card',
		pageConfig,
		lepusCode: { root: define(lepusSource) },
		customSections: {},
		elementTemplates: {},
	});
}

const suffix = args.retain === 'none' ? '-retain-none' : '';
for (const autoRows of args.retain === 'none' ? autoRowVariants : [0, ...autoRowVariants]) {
	const dir = path.join(here, autoRows > 0 ? `dist-rows${autoRows}${suffix}` : 'dist');
	fs.mkdirSync(dir, { recursive: true });
	const outPath = path.join(dir, 'main.web.bundle');
	fs.writeFileSync(outPath, buildVariant(autoRows));
	console.log(`[prototype] wrote ${path.relative(root, outPath)}`);
}
