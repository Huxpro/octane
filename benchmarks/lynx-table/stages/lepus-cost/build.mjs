import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildTableApp } from '../../scripts/build-app.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
const entryFile = path.join(
	repositoryRoot,
	'packages/rspeedy-plugin-octane/src/main-thread-entry.js',
);
const anchor = 'installMainThreadProcessData();\n';

const variants = {
	m1a: { runtime: 'runtime.js', bundle: 'm1-dispatch-property.lynx.bundle' },
	m1b: { runtime: 'runtime-m1b.js', bundle: 'm1-allocation-string-branch.lynx.bundle' },
};

export function buildLepusCostBundle(
	outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lepus-cost-')),
	variantName = 'm1a',
) {
	const variant = variants[variantName];
	if (variant === undefined) throw new Error(`unknown Lepus cost variant ${variantName}.`);
	const original = fs.readFileSync(entryFile, 'utf8');
	const runtime = fs.readFileSync(path.join(import.meta.dirname, variant.runtime), 'utf8');
	const index = original.indexOf(anchor);
	if (index === -1 || original.indexOf(anchor, index + anchor.length) !== -1) {
		throw new Error('Lepus cost build anchor is missing or ambiguous.');
	}
	fs.mkdirSync(outputDirectory, { recursive: true });
	try {
		fs.writeFileSync(entryFile, original.replace(anchor, `${runtime}\n${anchor}`));
		const dist = buildTableApp({ silent: true });
		const output = path.join(outputDirectory, variant.bundle);
		fs.copyFileSync(path.join(dist, 'main.lynx.bundle'), output);
		return output;
	} finally {
		fs.writeFileSync(entryFile, original);
		if (fs.readFileSync(entryFile, 'utf8') !== original) {
			throw new Error('Lepus cost build did not restore the main-thread entry byte-for-byte.');
		}
	}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	console.log(buildLepusCostBundle(process.argv[2], process.argv[3]));
}
