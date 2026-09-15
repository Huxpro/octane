#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
	issue291M0ProbeReceipt,
	patchIssue291M0App,
	patchIssue291M0Index,
} from './issue291-m0-native-probe.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const pins = Object.freeze({
	'm0-current': 'e82160fc0e663f52848e2181d83c6203d633bc86',
	'm0-upstream': '184631809c8eb61f5bbf15fa23b2470c1d38eea6',
});
const sourceFiles = [
	'benchmarks/lynx-table/app/src/App.lynx.tsrx',
	'benchmarks/lynx-table/app/src/index.ts',
];
const producerFiles = [
	'benchmarks/lynx-table/stages/issue194-device-protocol.mjs',
	'benchmarks/lynx-table/stages/issue194-device-run.mjs',
	'benchmarks/lynx-table/stages/issue291-m0-native-build.mjs',
	'benchmarks/lynx-table/stages/issue291-m0-native-probe.mjs',
	'benchmarks/lynx-table/stages/issue291-native-memory-analyze.mjs',
];
const bundleProbeMarkers = [
	'__NATIVE_BENCH_RESULT__',
	'lynx-native-bench-v2',
	'octane-root.flushTransport',
];

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFiles(directory, files) {
	const hash = crypto.createHash('sha256');
	for (const relative of [...files].sort()) {
		hash.update(relative);
		hash.update('\0');
		hash.update(fs.readFileSync(path.join(directory, relative)));
		hash.update('\0');
	}
	return {
		algorithm: 'sha256-path-content-v1',
		files: [...files].sort(),
		sha256: hash.digest('hex'),
	};
}

function git(directory, args) {
	return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function version(directory, command, args) {
	const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8' });
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
	if (result.error !== undefined || result.status !== 0 || output === '') {
		throw (
			result.error ??
			new Error(
				`could not identify ${command}: exit ${String(result.status)}${output && `\n${output}`}`,
			)
		);
	}
	return output;
}

const { values } = parseArgs({
	options: {
		checkout: { type: 'string' },
		label: { type: 'string' },
		out: { type: 'string' },
	},
});
const label = values.label;
const expectedCommit = label === undefined ? undefined : pins[label];
if (values.checkout === undefined || values.out === undefined || expectedCommit === undefined) {
	throw new Error(
		'usage: issue291-m0-native-build.mjs --label m0-current|m0-upstream --checkout <clean-checkout> --out <new-directory>',
	);
}
const checkout = path.resolve(values.checkout);
const output = path.resolve(values.out);
if (!fs.statSync(checkout).isDirectory())
	throw new Error(`checkout is not a directory: ${checkout}`);
if (fs.existsSync(output)) throw new Error(`output already exists: ${output}`);
const producerDirty = git(root, [
	'status',
	'--porcelain',
	'--untracked-files=all',
	'--',
	...producerFiles,
]);
if (producerDirty !== '') {
	throw new Error(
		`M0 producer must be committed before it can identify a bundle:\n${producerDirty}`,
	);
}
const commit = git(checkout, ['rev-parse', 'HEAD']);
if (commit !== expectedCommit) {
	throw new Error(`${label} requires ${expectedCommit}, received ${commit}`);
}
const dirty = git(checkout, [
	'status',
	'--porcelain',
	'--untracked-files=all',
	'--',
	'packages',
	'benchmarks',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
]);
if (dirty !== '') throw new Error(`${label} checkout is dirty:\n${dirty}`);

const originals = new Map(
	sourceFiles.map((relative) => [relative, fs.readFileSync(path.join(checkout, relative), 'utf8')]),
);
const patched = new Map([
	[sourceFiles[0], patchIssue291M0App(originals.get(sourceFiles[0]))],
	[sourceFiles[1], patchIssue291M0Index(originals.get(sourceFiles[1]))],
]);
const originalReceipt = issue291M0ProbeReceipt(
	originals.get(sourceFiles[0]),
	originals.get(sourceFiles[1]),
);
const patchedReceipt = issue291M0ProbeReceipt(
	patched.get(sourceFiles[0]),
	patched.get(sourceFiles[1]),
);

let bundle;
try {
	for (const [relative, source] of patched) {
		fs.writeFileSync(path.join(checkout, relative), source);
	}
	const environment = { ...process.env };
	for (const name of Object.keys(environment)) {
		if (name.startsWith('BENCH_') || name.startsWith('LEPUS_') || name === 'OCTANE_LYNX_PROFILE') {
			delete environment[name];
		}
	}
	Object.assign(environment, {
		NODE_ENV: 'production',
		BENCH_AUTOROWS: '0',
		BENCH_CORE: 'universal',
		OCTANE_LYNX_PROFILE: '0',
	});
	execFileSync(
		process.execPath,
		[path.join(checkout, 'benchmarks/lynx-table/scripts/build-app.mjs')],
		{ cwd: checkout, env: environment, stdio: 'inherit' },
	);
	bundle = fs.readFileSync(path.join(checkout, 'benchmarks/lynx-table/app/dist/main.lynx.bundle'));
} finally {
	for (const [relative, source] of originals) {
		fs.writeFileSync(path.join(checkout, relative), source);
	}
}
const restored = git(checkout, [
	'status',
	'--porcelain',
	'--untracked-files=all',
	'--',
	...sourceFiles,
]);
if (restored !== '') throw new Error(`${label} source restoration failed:\n${restored}`);
for (const marker of bundleProbeMarkers) {
	if (!bundle.includes(Buffer.from(marker))) {
		throw new Error(`${label} bundle is missing the Native receipt marker ${marker}`);
	}
}

fs.mkdirSync(output, { recursive: false });
fs.writeFileSync(path.join(output, 'main.lynx.bundle'), bundle);
const receipt = {
	protocol: 'octane-issue291-m0-native-build-v1',
	label,
	source: {
		commit,
		checkoutDirtyBeforeBuild: false,
		sourceRestoredAfterBuild: true,
		dependencyLock: {
			path: 'pnpm-lock.yaml',
			sha256: sha256(fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml'))),
		},
	},
	probe: {
		purpose: 'Native create/clear semantic receipt only; framework runtime source is unmodified',
		originalSource: originalReceipt,
		patchedSource: patchedReceipt,
		producer: {
			commit: git(root, ['rev-parse', 'HEAD']),
			...hashFiles(root, producerFiles),
		},
	},
	configuration: {
		production: true,
		core: 'universal',
		elementTemplates: false,
		profile: false,
		initialRows: 0,
		workloads: ['create-1000', 'clear'],
	},
	toolchain: {
		node: process.version,
		pnpm: version(checkout, 'pnpm', ['--version']),
		rspeedy: version(
			path.join(checkout, 'packages/rspeedy-plugin-octane'),
			path.join(checkout, 'packages/rspeedy-plugin-octane/node_modules/.bin/rspeedy'),
			['--version'],
		),
		platform: process.platform,
		architecture: process.arch,
	},
	bundle: {
		file: 'main.lynx.bundle',
		sha256: sha256(bundle),
		bytes: bundle.length,
		probeMarkers: bundleProbeMarkers,
	},
};
fs.writeFileSync(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
	`[issue291-m0] ${label} ${commit.slice(0, 12)} -> ${receipt.bundle.sha256} (${receipt.bundle.bytes} bytes)`,
);
