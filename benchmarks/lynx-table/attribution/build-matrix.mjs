import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { buildTableApp } from '../scripts/build-app.mjs';
import { parseGitTargets } from './targets.mjs';

const benchmarkRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(benchmarkRoot, '../..');
const outputRoot = path.join(import.meta.dirname, 'artifacts');
const workRoot = path.join(import.meta.dirname, '.work');
const { values: args } = parseArgs({
	options: {
		targets: { type: 'string' },
		profile: { type: 'boolean', default: false },
		instrument: { type: 'boolean', default: false },
	},
});
if (args.profile !== args.instrument) {
	throw new TypeError('--profile and --instrument must be passed together.');
}
const targets = parseGitTargets(args.targets).map((target) => ({
	...target,
	sha: execFileSync('git', ['rev-parse', '--verify', `${target.revision}^{commit}`], {
		cwd: repositoryRoot,
		encoding: 'utf8',
	}).trim(),
}));
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
const previousAttribution = process.env.OCTANE_LYNX_ATTRIBUTION;
const manifest = [];
try {
	process.env.OCTANE_LYNX_PROFILE = args.profile ? '1' : '0';
	process.env.OCTANE_LYNX_ATTRIBUTION = args.instrument ? '1' : '0';
	fs.mkdirSync(workRoot, { recursive: true });
	for (const target of targets) {
		const checkout = fs.mkdtempSync(path.join(workRoot, `${target.id}-`));
		const variant = `${target.id}-${args.instrument ? 'profile' : 'control'}`;
		const destination = path.join(outputRoot, variant);
		try {
			exportTarget(target, checkout);
			buildTableApp({ silent: true, repositoryRoot: checkout, destinationRoot: destination });
			const bundle = path.join(destination, 'main.web.bundle');
			manifest.push({
				...target,
				profile: args.profile,
				instrument: args.instrument,
				bundle: path.relative(outputRoot, bundle),
				bytes: fs.statSync(bundle).size,
				sha256: sha256(bundle),
			});
			console.log(`[attribution:build] ${variant} ${manifest.at(-1).sha256}`);
		} finally {
			fs.rmSync(checkout, { recursive: true, force: true });
		}
	}
} finally {
	fs.rmSync(workRoot, { recursive: true, force: true });
	if (previousProfile === undefined) delete process.env.OCTANE_LYNX_PROFILE;
	else process.env.OCTANE_LYNX_PROFILE = previousProfile;
	if (previousAttribution === undefined) delete process.env.OCTANE_LYNX_ATTRIBUTION;
	else process.env.OCTANE_LYNX_ATTRIBUTION = previousAttribution;
}

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(
	path.join(outputRoot, 'manifest.json'),
	JSON.stringify({ generatedAt: new Date().toISOString(), targets: manifest }, null, 2) + '\n',
);
