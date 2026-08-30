// Issue #234 Part D — the device correctness gate, as one command.
//
// Reads one window's observations, judges them against the oracle table in
// `issue234-gate-oracles.mjs`, writes one record, and exits non-zero if any
// step failed. The non-zero exit is the point: a gate a lease can ignore is a
// report, and this is meant to run *before* the measurement windows of every
// device round and stop them when it fails.
//
//   node benchmarks/lynx-table/stages/issue234-device-gate.mjs \
//     --observations results/issue234-gate-observations-1000.json \
//     --out results/issue234-gate-1000.json \
//     --scale 1000 --cycles 3 \
//     --question 'does the D-train paint, adopt, route, update, clear and dispose correctly on device?'
//
// The observations come from the device half — the build-only app probe and the
// adb runner that drives it. Splitting the judgement from the collection is not
// tidiness: the judgement is what decides whether a device round's verdict means
// anything, and keeping it pure is what lets it be tested on every commit
// without a lease, so the only thing a lease adds is the device.
//
// It also means a window whose collection went wrong can be re-judged from the
// observations it did produce, without re-taking the lease.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeEvidenceJson } from '../scripts/evidence.mjs';
import { DEVICE_GATE_PROTOCOL, evaluateDeviceGate } from './issue234-gate-oracles.mjs';

/**
 * Everything the record says about where and when it was taken.
 *
 * A verdict without a device stamp cannot be read six weeks later: "the gate
 * passed" is a different claim on a different engine build, and round 1 of #194
 * lost evidence to exactly that gap. `serial` is optional so the judgement can
 * be re-run off the checked-in observations without a device attached, and the
 * record then says so rather than inventing a stamp.
 */
export function deviceStamp(serial, { exec = spawnSync } = {}) {
	if (serial === null) return { attached: false };
	const getprop = (name) => {
		const result = exec('adb', ['-s', serial, 'shell', 'getprop', name], { encoding: 'utf8' });
		if (result.status !== 0) {
			throw new Error(`adb getprop ${name} failed: ${result.stderr || result.stdout}`);
		}
		return String(result.stdout).trim();
	};
	return {
		attached: true,
		serial,
		model: getprop('ro.product.model'),
		product: getprop('ro.product.name'),
		android: getprop('ro.build.version.release'),
		fingerprint: getprop('ro.build.fingerprint'),
		abi: getprop('ro.product.cpu.abi'),
	};
}

/**
 * Assemble the record a window is checked in as.
 *
 * Separate from the write and from `process.argv` so a test can ask what a
 * record would say without a filesystem or a device.
 */
export function buildGateRecord({ observations, scale, cycles, question, device, octaneCommit }) {
	const verdict = evaluateDeviceGate(observations, { scale, cycles });
	return {
		protocol: DEVICE_GATE_PROTOCOL,
		question,
		createdAt: new Date().toISOString(),
		octaneCommit,
		device,
		scale,
		cycles,
		// Hoisted so a directory of records can be scanned for the failures
		// without parsing six verdicts out of each one.
		pass: verdict.pass,
		failedSteps: verdict.steps.filter((step) => !step.pass && !step.skipped).map((step) => step.id),
		steps: verdict.steps,
		observations,
	};
}

function readArg(args, name, { required = true } = {}) {
	const index = args.indexOf(name);
	if (index === -1 || args[index + 1] === undefined) {
		if (required) throw new Error(`missing ${name}`);
		return null;
	}
	return args[index + 1];
}

function readInteger(args, name, fallback) {
	const raw = readArg(args, name, { required: fallback === undefined });
	const value = raw === null ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer.`);
	}
	return value;
}

export async function main(argv, { log = console.log, exec = spawnSync } = {}) {
	const args = argv.slice(2);
	const observationsFile = path.resolve(readArg(args, '--observations'));
	const output = path.resolve(readArg(args, '--out'));
	const scale = readInteger(args, '--scale');
	const cycles = readInteger(args, '--cycles', 3);
	const question = readArg(args, '--question');
	const serial = readArg(args, '--serial', { required: false });
	const observations = JSON.parse(fs.readFileSync(observationsFile, 'utf8'));
	const commit = exec('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
	const record = buildGateRecord({
		observations,
		scale,
		cycles,
		question,
		device: deviceStamp(serial, { exec }),
		octaneCommit: commit.status === 0 ? String(commit.stdout).trim() : null,
	});
	fs.mkdirSync(path.dirname(output), { recursive: true });
	await writeEvidenceJson(output, record);
	for (const step of record.steps) {
		const mark = step.skipped ? 'skip' : step.pass ? 'pass' : 'FAIL';
		log(`[issue234] ${mark} ${step.id}${step.reason === null ? '' : ` — ${step.reason}`}`);
	}
	log(`[issue234] ${record.pass ? 'GATE PASS' : 'GATE FAIL'} → ${output}`);
	return record.pass ? 0 : 1;
}

// `import.meta.main` is not available on every Node this repository runs, so the
// entry check compares the resolved paths the way the other stage scripts do.
if (
	process.argv[1] !== undefined &&
	path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
	process.exitCode = await main(process.argv);
}
