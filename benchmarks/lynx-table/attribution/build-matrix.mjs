import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildTableApp } from '../scripts/build-app.mjs';
import { selectTargets } from './targets.mjs';

const benchmarkRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(benchmarkRoot, '../..');
const outputRoot = path.join(import.meta.dirname, 'artifacts');
const workRoot = path.join(import.meta.dirname, '.work');
const { values: args } = parseArgs({
	options: {
		targets: { type: 'string' },
		profile: { type: 'boolean', default: false },
		rows: { type: 'string', default: '0' },
	},
});
const targets = selectTargets(args.targets?.split(',').filter(Boolean));
const rows = Number(args.rows);
if (!Number.isSafeInteger(rows) || rows < 0)
	throw new TypeError('--rows must be a non-negative integer.');

function copyPackageLinks(checkout, packageName) {
	const source = path.join(repositoryRoot, 'packages', packageName, 'node_modules');
	if (!fs.existsSync(source)) return;
	const destination = path.join(checkout, 'packages', packageName, 'node_modules');
	fs.cpSync(source, destination, {
		recursive: true,
		dereference: false,
		verbatimSymlinks: true,
	});
}

function exportTarget(target, directory) {
	const archive = path.join(directory, 'source.tar');
	execFileSync('git', ['archive', '--format=tar', '-o', archive, target.sha, 'packages'], {
		cwd: repositoryRoot,
		stdio: 'inherit',
	});
	execFileSync('tar', ['-xf', archive, '-C', directory], { stdio: 'inherit' });
	fs.rmSync(archive);
	fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true });
	fs.symlinkSync(
		path.join(repositoryRoot, 'node_modules/.pnpm'),
		path.join(directory, 'node_modules/.pnpm'),
	);
	for (const packageName of ['octane', 'lynx', 'rspack-plugin-octane', 'rspeedy-plugin-octane']) {
		copyPackageLinks(directory, packageName);
	}
}

function sha256(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const previousProfile = process.env.OCTANE_LYNX_PROFILE;
const previousAttribution = process.env.OCTANE_LYNX_S3_PROFILE;
const previousRows = process.env.BENCH_AUTOROWS;
const manifest = [];
try {
	process.env.OCTANE_LYNX_PROFILE = args.profile ? '1' : '0';
	process.env.OCTANE_LYNX_S3_PROFILE = '1';
	process.env.BENCH_AUTOROWS = String(rows);
	fs.mkdirSync(workRoot, { recursive: true });
	for (const target of targets) {
		const checkout = fs.mkdtempSync(path.join(workRoot, `${target.id}-`));
		const variant = `${target.id}${rows === 0 ? '' : `-rows${rows}`}${args.profile ? '-profile' : ''}`;
		const destination = path.join(outputRoot, variant);
		try {
			exportTarget(target, checkout);
			buildTableApp({ silent: true, repositoryRoot: checkout, destinationRoot: destination });
			const bundle = path.join(destination, 'main.web.bundle');
			manifest.push({
				...target,
				rows,
				profile: args.profile,
				bundle: path.relative(import.meta.dirname, bundle),
				bytes: fs.statSync(bundle).size,
				sha256: sha256(bundle),
			});
			console.log(`[s3-build] ${variant} ${manifest.at(-1).sha256}`);
		} finally {
			fs.rmSync(checkout, { recursive: true, force: true });
		}
	}
} finally {
	fs.rmSync(workRoot, { recursive: true, force: true });
	if (previousProfile === undefined) delete process.env.OCTANE_LYNX_PROFILE;
	else process.env.OCTANE_LYNX_PROFILE = previousProfile;
	if (previousAttribution === undefined) delete process.env.OCTANE_LYNX_S3_PROFILE;
	else process.env.OCTANE_LYNX_S3_PROFILE = previousAttribution;
	if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
	else process.env.BENCH_AUTOROWS = previousRows;
}

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(
	path.join(outputRoot, 'manifest.json'),
	JSON.stringify({ generatedAt: new Date().toISOString(), targets: manifest }, null, 2) + '\n',
);
