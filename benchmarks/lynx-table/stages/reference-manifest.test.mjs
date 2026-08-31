// The vendored reference bundles are the one part of this harness nothing here
// builds. Every other cell is compiled from source on each run, so a wrong
// bundle is a wrong build and shows up as a wrong number against a known one.
// A vendored bundle has no such backstop: swap the bytes and the harness will
// happily report a number for whatever it was handed.
//
// `reference/manifest.json` is the record that closes that gap — it names the
// artifacts and pins their digests — and these tests are what make the record
// binding rather than decorative.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'reference/manifest.json'), 'utf8'));

function sha256(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('every bundle the first-screen set pins is present and has the pinned bytes', () => {
	const pinned = manifest.firstScreen?.sha256;
	assert.ok(pinned, 'reference/manifest.json carries a firstScreen.sha256 section');
	const entries = Object.entries(pinned);
	assert.ok(entries.length > 0, 'the section pins at least one bundle');
	for (const [relative, digest] of entries) {
		const file = path.join(root, 'reference/react-first-screen', relative);
		assert.ok(fs.existsSync(file), `${relative} exists`);
		assert.equal(sha256(file), digest, `${relative} matches its pinned digest`);
	}
});

test('the first-screen set pins one bundle per row count, and nothing else', () => {
	const keys = Object.keys(manifest.firstScreen.sha256);
	const rows = keys.map((key) => {
		const match = /^rows-(\d+)\/main\.web\.bundle$/.exec(key);
		assert.ok(match, `${key} is a rows-<n>/main.web.bundle key`);
		return Number(match[1]);
	});
	// `papi-run.mjs` derives the scales it can offer from these keys, so a
	// duplicate would silently shadow a variant and a stray key would advertise a
	// scale nobody vendored.
	assert.equal(new Set(rows).size, rows.length, 'no row count is pinned twice');
	assert.deepEqual(
		[...rows].sort((a, b) => a - b),
		rows,
		'keys are in ascending row order',
	);
});

test('the vendored tree carries nothing the manifest does not pin', () => {
	const directory = path.join(root, 'reference/react-first-screen');
	const found = fs
		.readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
		.map((relative) => relative.split(path.sep).join('/'));
	// An unpinned file in here is a bundle with no provenance, which is the exact
	// thing the manifest exists to prevent.
	assert.deepEqual(found.sort(), Object.keys(manifest.firstScreen.sha256).sort());
});

test('the first-screen set is a different artifact from the react cell, and says so', () => {
	const shipping = path.join(root, 'reference/react/main.web.bundle');
	const first = path.join(root, 'reference/react-first-screen/rows-0/main.web.bundle');
	// Both are ReactLynx at rows-0, and they are still not the same bytes: they
	// come from different upstream commits. The manifest has to carry a separate
	// provenance block for that reason, and a future edit that collapses the two
	// records without collapsing the artifacts should fail here.
	assert.notEqual(sha256(shipping), sha256(first));
	assert.notEqual(manifest.firstScreen.upstream.commit, manifest.commit);
});
