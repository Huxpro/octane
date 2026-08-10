import fs from 'node:fs';
import path from 'node:path';

const TARGET_ID = /^[a-z0-9][a-z0-9._-]*$/;

export function parseGitTargets(value = 'workspace=HEAD') {
	const targets = [];
	const ids = new Set();
	for (const spec of value.split(',').filter(Boolean)) {
		const separator = spec.indexOf('=');
		if (separator <= 0 || separator === spec.length - 1) {
			throw new TypeError(`invalid target ${JSON.stringify(spec)}; expected id=revision.`);
		}
		const id = spec.slice(0, separator);
		const revision = spec.slice(separator + 1);
		if (!TARGET_ID.test(id)) throw new TypeError(`invalid target id ${JSON.stringify(id)}.`);
		if (ids.has(id)) throw new TypeError(`duplicate target id ${JSON.stringify(id)}.`);
		ids.add(id);
		targets.push({ id, revision });
	}
	if (targets.length === 0) throw new TypeError('at least one target is required.');
	return targets;
}

export function selectTargetIds(targets, value) {
	if (value === undefined || value === '') return targets;
	const wanted = value.split(',').filter(Boolean);
	if (new Set(wanted).size !== wanted.length)
		throw new Error('target selection contains duplicates.');
	const byId = new Map(targets.map((target) => [target.id, target]));
	const missing = wanted.filter((id) => !byId.has(id));
	if (missing.length !== 0) throw new Error(`unknown attribution target(s): ${missing.join(', ')}`);
	return wanted.map((id) => byId.get(id));
}

export function loadArtifactTargets(manifestFile) {
	const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
	if (!Array.isArray(manifest.targets))
		throw new TypeError('artifact manifest targets must be an array.');
	const directory = path.dirname(manifestFile);
	return manifest.targets.map((target) => {
		if (!TARGET_ID.test(target.id) || typeof target.sha !== 'string') {
			throw new TypeError('artifact manifest target must contain a valid id and sha.');
		}
		if (typeof target.bundle !== 'string') {
			throw new TypeError(`artifact manifest target ${target.id} is missing its bundle.`);
		}
		return { ...target, bundleFile: path.resolve(directory, target.bundle) };
	});
}

export function loadVendoredReferences(benchmarkRoot) {
	const referenceRoot = path.join(benchmarkRoot, 'reference');
	const manifest = JSON.parse(fs.readFileSync(path.join(referenceRoot, 'manifest.json'), 'utf8'));
	if (typeof manifest.commit !== 'string') {
		throw new TypeError('reference manifest is missing its source commit.');
	}
	const cells = [
		['vue-vdom', 'vdom-ifr-et'],
		['vue-vapor', 'vapor-ifr'],
		['react', 'react'],
	];
	return cells
		.map(([id, directory]) => ({
			id,
			sha: manifest.commit,
			reference: true,
			bundleFile: path.join(referenceRoot, directory, 'main.web.bundle'),
		}))
		.filter((target) => fs.existsSync(target.bundleFile));
}
