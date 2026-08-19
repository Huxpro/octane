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
 *   node prototype/build.mjs [--rows 10000[,1000,...]]
 *
 * writes prototype/dist/main.web.bundle           (empty table, click-driven)
 *        prototype/dist-rows{N}/main.web.bundle   (mount-create FCP ladder)
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
	},
});

const autoRowVariants = args.rows
	.split(',')
	.map((value) => Number(value.trim()))
	.filter(Boolean);

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

function buildVariant(autoRows) {
	const define = (source) => source.replace(/__AUTO_ROWS__/g, String(autoRows));
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

for (const autoRows of [0, ...autoRowVariants]) {
	const dir = path.join(here, autoRows > 0 ? `dist-rows${autoRows}` : 'dist');
	fs.mkdirSync(dir, { recursive: true });
	const outPath = path.join(dir, 'main.web.bundle');
	fs.writeFileSync(outPath, buildVariant(autoRows));
	console.log(`[prototype] wrote ${path.relative(root, outPath)}`);
}
