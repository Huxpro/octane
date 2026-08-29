import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildTableApp } from '../../scripts/build-app.mjs';

const scales = [1000, 10000, 30000];
const appFile = path.resolve(import.meta.dirname, '../../app/src/App.lynx.tsrx');
const messageChannelAnchor = 'const _stormChannel = new MessageChannel();';
const messageChannelFallback = `const _stormChannel =
\ttypeof MessageChannel === 'undefined'
\t\t? ({ port1: { onmessage: null }, port2: { postMessage() {} } } as unknown as MessageChannel)
\t\t: new MessageChannel();`;

export function buildLepusQ2Bundles(
	outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-lepus-q2-')),
) {
	const previous = Object.fromEntries(
		['BENCH_AUTOROWS', 'BENCH_MTS_PROGRAM', 'OCTANE_LYNX_PROFILE', 'LEPUS_Q2_PROFILE'].map(
			(name) => [name, process.env[name]],
		),
	);
	const originalApp = fs.readFileSync(appFile, 'utf8');
	if (
		!originalApp.includes(messageChannelAnchor) ||
		originalApp.indexOf(messageChannelAnchor) !== originalApp.lastIndexOf(messageChannelAnchor)
	) {
		throw new Error('Q2 MessageChannel build anchor is missing or ambiguous.');
	}
	fs.mkdirSync(outputDirectory, { recursive: true });
	const outputs = [];
	try {
		// The leased SDK 4.0 image exposes no MessageChannel on either runtime.
		// Storms are not part of first-screen Q2, so install a build-local inert
		// fallback and restore the authored benchmark byte-for-byte afterwards.
		fs.writeFileSync(appFile, originalApp.replace(messageChannelAnchor, messageChannelFallback));
		process.env.OCTANE_LYNX_PROFILE = '1';
		process.env.LEPUS_Q2_PROFILE = '1';
		for (const rows of scales) {
			process.env.BENCH_AUTOROWS = String(rows);
			for (const variant of [
				{ name: 'template', mtsProgram: false },
				{ name: 'program', mtsProgram: true },
			]) {
				process.env.BENCH_MTS_PROGRAM = variant.mtsProgram ? '1' : '0';
				const dist = buildTableApp({ silent: true, mtsProgram: variant.mtsProgram });
				const output = path.join(outputDirectory, `q2-${variant.name}-${rows}.lynx.bundle`);
				fs.copyFileSync(path.join(dist, 'main.lynx.bundle'), output);
				outputs.push(output);
			}
		}
		return outputs;
	} finally {
		fs.writeFileSync(appFile, originalApp);
		if (fs.readFileSync(appFile, 'utf8') !== originalApp) {
			throw new Error('Q2 build did not restore App.lynx.tsrx byte-for-byte.');
		}
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	for (const output of buildLepusQ2Bundles(process.argv[2])) console.log(output);
}
