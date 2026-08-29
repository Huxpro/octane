// The command a device lease runs. What matters here is not that it prints
// nicely: it is that a failing window exits non-zero, that a record carries the
// stamp it would be read against six weeks later, and that neither depends on a
// device being attached — so the judgement can be re-run off checked-in
// observations without re-taking the lease.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildGateRecord, deviceStamp, main } from './issue234-device-gate.mjs';
import { DEVICE_GATE_PROTOCOL } from './issue234-gate-oracles.mjs';

function passingObservations() {
	return {
		firstScreen: { rowCount: 1000, firstRowClass: 'row' },
		adoption: { firstTreeAction: 'adopt', firstTreeSettled: 1 },
		nativeTap: {
			target: { index: 500, id: 501 },
			dispatchedTo: 501,
			tapped: { index: 500, class: 'row danger' },
			neighbours: [{ index: 499, class: 'row' }],
		},
		slotUpdate: {
			marker: ' !!!',
			updated: [{ index: 0, label: 'a !!!' }],
			untouched: [{ index: 1, label: 'b' }],
		},
		clearCycles: [
			{ cycle: 1, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
			{ cycle: 2, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
			{ cycle: 3, rowCountAfterClear: 0, liveElementsAfterClear: 41 },
		],
		dispose: {
			provokedAfterDispose: 2,
			acksAfterDispose: 0,
			observationsAfterDispose: 0,
			orphanEvidence: [],
		},
	};
}

function temporaryDirectory() {
	// Not `os.tmpdir()`. Records are checked in, so `writeEvidenceJson` resolves
	// the repository's Prettier config for the destination and refuses a
	// directory where none does — which is every path outside the workspace.
	// Staging the scratch beside the real `results/` is what gives this test the
	// same config the command gets in earnest; `.test-scratch/` is gitignored.
	const root = path.join(import.meta.dirname, '.test-scratch');
	fs.mkdirSync(root, { recursive: true });
	return fs.mkdtempSync(path.join(root, 'issue234-gate-'));
}

/** `spawnSync` for a run with no device and a known commit. */
function fakeExec(command, args) {
	if (command === 'git') return { status: 0, stdout: 'abc123\n', stderr: '' };
	throw new Error(`unexpected ${command} ${args.join(' ')}`);
}

describe('issue #234 device gate: the record', () => {
	it('carries the verdict, the stamp, and the observations it judged', () => {
		const observations = passingObservations();
		const record = buildGateRecord({
			observations,
			scale: 1000,
			cycles: 3,
			question: 'does the D-train behave on device?',
			device: { attached: false },
			octaneCommit: 'abc123',
		});
		assert.equal(record.protocol, DEVICE_GATE_PROTOCOL);
		assert.equal(record.pass, true);
		assert.deepEqual(record.failedSteps, []);
		assert.equal(record.steps.length, 6);
		// The observations travel with the verdict: a record that says "fail" and
		// not what it read cannot be acted on without re-taking the lease.
		assert.deepEqual(record.observations, observations);
		assert.equal(record.octaneCommit, 'abc123');
	});

	it('hoists the failing step ids so a directory of records can be scanned', () => {
		const observations = passingObservations();
		observations.adoption.firstTreeAction = 'repair';
		const record = buildGateRecord({
			observations,
			scale: 1000,
			cycles: 3,
			question: 'q',
			device: { attached: false },
			octaneCommit: null,
		});
		assert.equal(record.pass, false);
		// Only the step that actually failed, not the four the failure skipped.
		assert.deepEqual(record.failedSteps, ['adoption']);
	});
});

describe('issue #234 device gate: the device stamp', () => {
	it('records that no device was attached rather than inventing one', () => {
		assert.deepEqual(deviceStamp(null), { attached: false });
	});

	it('reads the properties a verdict has to be read against', () => {
		const stamp = deviceStamp('R5CT30', {
			exec: (command, args) => {
				assert.equal(command, 'adb');
				assert.deepEqual(args.slice(0, 4), ['-s', 'R5CT30', 'shell', 'getprop']);
				return { status: 0, stdout: `${args[4]}-value\n`, stderr: '' };
			},
		});
		assert.equal(stamp.attached, true);
		assert.equal(stamp.serial, 'R5CT30');
		assert.equal(stamp.model, 'ro.product.model-value');
		assert.equal(stamp.fingerprint, 'ro.build.fingerprint-value');
	});

	it('fails loudly when adb cannot answer', () => {
		assert.throws(
			() =>
				deviceStamp('R5CT30', { exec: () => ({ status: 1, stdout: '', stderr: 'no devices' }) }),
			/adb getprop .* failed/u,
		);
	});
});

describe('issue #234 device gate: the command', () => {
	it('writes a gate-clean record and exits zero on a clean window', async () => {
		const directory = temporaryDirectory();
		const observations = path.join(directory, 'observations.json');
		const output = path.join(directory, 'results', 'issue234-gate-1000.json');
		fs.writeFileSync(observations, JSON.stringify(passingObservations()));
		const lines = [];
		const code = await main(
			[
				'node',
				'gate',
				'--observations',
				observations,
				'--out',
				output,
				'--scale',
				'1000',
				'--cycles',
				'3',
				'--question',
				'q',
			],
			{ log: (line) => lines.push(line), exec: fakeExec },
		);
		assert.equal(code, 0);
		assert.match(lines.at(-1), /GATE PASS/u);
		const written = JSON.parse(fs.readFileSync(output, 'utf8'));
		assert.equal(written.pass, true);
		assert.equal(written.scale, 1000);
		assert.equal(written.cycles, 3);
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('exits non-zero on a failing window, which is what makes it a gate', async () => {
		const directory = temporaryDirectory();
		const observations = path.join(directory, 'observations.json');
		const output = path.join(directory, 'gate.json');
		const broken = passingObservations();
		broken.nativeTap.dispatchedTo = 999;
		fs.writeFileSync(observations, JSON.stringify(broken));
		const lines = [];
		const code = await main(
			[
				'node',
				'gate',
				'--observations',
				observations,
				'--out',
				output,
				'--scale',
				'1000',
				'--cycles',
				'3',
				'--question',
				'q',
			],
			{ log: (line) => lines.push(line), exec: fakeExec },
		);
		assert.equal(code, 1);
		assert.match(lines.at(-1), /GATE FAIL/u);
		assert.ok(lines.some((line) => /FAIL native-tap/u.test(line)));
		// A failing gate still writes its record: the verdict is the deliverable,
		// and a run that exits 1 with nothing on disk cannot be acted on.
		assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).pass, false);
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('refuses a window it cannot judge rather than guessing at one', async () => {
		const directory = temporaryDirectory();
		const observations = path.join(directory, 'observations.json');
		fs.writeFileSync(observations, JSON.stringify(passingObservations()));
		const base = [
			'node',
			'gate',
			'--observations',
			observations,
			'--out',
			path.join(directory, 'gate.json'),
		];
		await assert.rejects(
			() => main([...base, '--question', 'q'], { log: () => {}, exec: fakeExec }),
			/--scale/u,
		);
		await assert.rejects(
			() => main([...base, '--scale', '1000'], { log: () => {}, exec: fakeExec }),
			/--question/u,
		);
		await assert.rejects(
			() => main([...base, '--scale', '0', '--question', 'q'], { log: () => {}, exec: fakeExec }),
			/--scale must be a positive integer/u,
		);
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it('defaults to three clear cycles, the fewest that can show a trend', async () => {
		const directory = temporaryDirectory();
		const observations = path.join(directory, 'observations.json');
		const output = path.join(directory, 'gate.json');
		fs.writeFileSync(observations, JSON.stringify(passingObservations()));
		const code = await main(
			[
				'node',
				'gate',
				'--observations',
				observations,
				'--out',
				output,
				'--scale',
				'1000',
				'--question',
				'q',
			],
			{ log: () => {}, exec: fakeExec },
		);
		assert.equal(code, 0);
		assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).cycles, 3);
		fs.rmSync(directory, { recursive: true, force: true });
	});
});
