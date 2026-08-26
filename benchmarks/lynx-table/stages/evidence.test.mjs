// The claim `scripts/evidence.mjs` makes is not "these files pass Prettier" but
// something stronger: every measurement record checked in here is exactly what
// the writer would produce for it. That is what makes a record evidence — a
// re-run over the same numbers rewrites the same bytes, so a diff in a results
// directory is a measurement that moved and never a formatter that did.
//
// It is also the oracle a plausible wrong writer fails. Feeding Prettier one
// long line instead of the expanded form is gate-clean and reads fine, and it
// silently reshapes all 100 checked-in records the next time each harness runs.
// Checking only `prettier --check` would let that through; this does not.
//
// The module lives under `scripts/` because `web/`, `stages/` and `prototype/`
// all write records and all import their shared helpers from there. Its test
// lives here because this is the directory `pnpm test:stages` collects.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { bundleIdentity, formatEvidenceJson } from '../scripts/evidence.mjs';

/** The results directories whose contents are checked in. */
const TRACKED = [
	path.join(import.meta.dirname, 'results'),
	path.resolve(import.meta.dirname, '../prototype/results'),
];

function records() {
	return TRACKED.flatMap((directory) =>
		fs
			.readdirSync(directory)
			.filter((entry) => entry.endsWith('.json'))
			.map((entry) => path.join(directory, entry)),
	);
}

test('every checked-in record is what the evidence writer would write', async () => {
	const files = records();
	// A run that found nothing would pass every assertion below it, so the count
	// is asserted before the loop rather than left implied by it.
	assert.ok(files.length > 0, 'no records found to check');
	for (const file of files) {
		const checkedIn = fs.readFileSync(file, 'utf8');
		const written = await formatEvidenceJson(file, JSON.parse(checkedIn));
		assert.equal(
			written,
			checkedIn,
			`${path.relative(path.join(import.meta.dirname, '..'), file)} is not byte-identical to what writeEvidenceJson produces for it`,
		);
	}
});

test('a record is written where prettier --check accepts it, arrays included', async () => {
	// The short array is the whole reason this module exists: `JSON.stringify`
	// puts every element on its own line and Prettier does not, so a plainly
	// written record fails the repository's format gate on arrival.
	const file = path.join(import.meta.dirname, 'results', 'unwritten.json');
	const written = await formatEvidenceJson(file, { scales: [1000, 10000], meta: { reps: 5 } });
	assert.equal(written, '{\n  "scales": [1000, 10000],\n  "meta": {\n    "reps": 5\n  }\n}\n');
});

test('a record identifies the bundle it measured by its bytes, not by when it ran', () => {
	// The failure this guards is a scaling series assembled from records taken at
	// different times against different builds: it reads as a workload effect and
	// is a version difference. What separates the two cases is content, so what
	// the record carries has to move when the content moves and stay put when
	// only the file's name or timestamp does.
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-identity-'));
	try {
		const first = path.join(directory, 'main.web.bundle');
		const copy = path.join(directory, 'copy.web.bundle');
		const changed = path.join(directory, 'changed.web.bundle');
		fs.writeFileSync(first, 'painted 10000 rows');
		fs.writeFileSync(copy, 'painted 10000 rows');
		fs.writeFileSync(changed, 'painted 10000 rowt');
		// A rebuild that changed nothing still moves the timestamp, so a record
		// keyed on time would call two identical builds different.
		fs.utimesSync(copy, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));

		assert.equal(bundleIdentity(copy).digest, bundleIdentity(first).digest);
		assert.notEqual(bundleIdentity(changed).digest, bundleIdentity(first).digest);

		const identity = bundleIdentity(first, { relativeTo: directory });
		assert.equal(identity.path, 'main.web.bundle');
		assert.equal(identity.bytes, 18);
		assert.equal(identity.modified, new Date(fs.statSync(first).mtime).toISOString());
		// Reported relative to a root when one is given, so a record does not carry
		// the absolute path of the machine that wrote it.
		assert.equal(bundleIdentity(first).path, first);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
