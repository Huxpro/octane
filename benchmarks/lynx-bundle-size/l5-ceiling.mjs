// L5 ceiling ablation for the Lynx main-thread program.
//
// Issue #58's L5 bullet asks for the accepted bundle trade to be repaid by
// "deleting the plan interpreter, batch pipeline, and recursive validator from
// the main-thread bundle", and issue #66 §6 makes that a cutover gate against
// ~1.5x the reference median. Neither says what the deletion is worth. This
// measures the ceiling: it builds the same production artifacts with each
// target's transitive closure absent and reports the delta.
//
// It is a measurement device, not product code and not a CI gate. It rewrites
// working-tree sources so a production build can be taken with a target gone,
// then restores them with `git checkout --`. It refuses to start unless those
// sources are clean, so the restore can never lose work, and it restores in a
// `finally` so an aborted run still leaves the tree as it found it.
//
// A ceiling is an upper bound, not a forecast. Each arm deletes its target
// outright, where the shipping change replaces it: #66's exit gate keeps header
// checks on delta traffic, and the staged batch path remains the direct
// applier's fallback until the specialized core covers every page. What the
// repayment actually collects is therefore less than what this reports.
//
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --harness run
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --arms baseline,both
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const CORE = 'packages/lynx/src/core';

// The five-config ReactLynx/Vue comparison median, carried from
// `results/production-inventory.md`. It is a recorded constant, not something
// this repository can rebuild: only the three references' `.web.bundle`
// fixtures are vendored. Every ratio printed below inherits that.
const REFERENCE_MEDIAN_GZIP = 51_228;
const TARGET_RATIO = 1.5;

// Each arm names what #58's bullet calls for, and the one exported entry whose
// removal takes that machinery's whole transitive closure with it. Production
// tree-shaking computes the closure, which is what makes the number honest:
// a helper the direct first-screen path still calls stays, and is not counted.
const ARMS = {
	baseline: { label: 'baseline (no ablation)', edits: [] },
	validator: {
		label: 'recursive validator',
		edits: [
			[
				'protocol.ts',
				[
					['selfCheckLynxBackgroundInboundMessage', '\treturn message;'],
					[
						'validateLynxBackgroundOutboundMessage',
						'\treturn value as LynxBackgroundOutboundMessage;',
					],
					[
						'validateLynxBackgroundInboundMessage',
						'\treturn value as LynxBackgroundInboundMessage;',
					],
				],
			],
		],
	},
	batch: {
		label: 'plan interpreter + batch pipeline',
		edits: [['host-driver.ts', [['prepareLynxHostBatch', "\tthrow new Error('ablated');"]]]],
	},
	both: { label: 'both', edits: [] },
};
ARMS.both.edits = [...ARMS.validator.edits, ...ARMS.batch.edits];

/** Replace one exported function's body, brace-matched from its signature. */
function stubFunction(source, name, body) {
	const signature = new RegExp(`\\nexport function ${name}\\b`);
	const match = signature.exec(source);
	if (match === null) throw new Error(`${name} is not an exported function declaration.`);
	let depth = 0;
	let open = -1;
	// The first brace at parameter/type depth zero opens the body.
	for (let index = match.index; index < source.length; index++) {
		const character = source[index];
		if (character === '(' || character === '[') depth++;
		else if (character === ')' || character === ']') depth--;
		else if (character === '{' && depth === 0) {
			open = index;
			break;
		}
	}
	if (open === -1) throw new Error(`${name} has no body.`);
	depth = 0;
	for (let index = open; index < source.length; index++) {
		const character = source[index];
		if (character === '{') depth++;
		else if (character === '}' && --depth === 0) {
			return `${source.slice(0, open)}{\n${body}\n}${source.slice(index + 1)}`;
		}
	}
	throw new Error(`${name} has an unbalanced body.`);
}

function applyArm(arm) {
	for (const [file, stubs] of ARMS[arm].edits) {
		const target = path.join(REPO, CORE, file);
		let source = fs.readFileSync(target, 'utf8');
		for (const [name, body] of stubs) source = stubFunction(source, name, body);
		fs.writeFileSync(target, source);
	}
}

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const restore = () => git('checkout', '--', CORE);

function runHarness(script, environment) {
	try {
		execFileSync('node', [script], {
			cwd: ROOT,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: { ...process.env, ...environment },
		});
	} catch (error) {
		// `run.mjs` exits non-zero whenever a frozen budget is red, which it is
		// on every tree this tool is useful on. The measurement is in the JSON
		// either way; a missing or short payload is the real failure, and the
		// caller detects that.
		if (error.status === undefined) throw error;
	}
}

function measureRun(scratch) {
	const output = path.join(scratch, 'run.json');
	runHarness('run.mjs', { BENCH_JSON: output });
	const payload = JSON.parse(fs.readFileSync(output, 'utf8'));
	if (payload.targets?.length !== 2) {
		throw new Error(`run.mjs produced ${payload.targets?.length ?? 0} targets: ${payload.failed}`);
	}
	const [preview, ifr] = payload.targets;
	return {
		previewMainRaw: preview.ops.main_raw.score,
		previewMainGzip: preview.ops.main_gzip.score,
		ifrMainRaw: ifr.ops.main_raw.score,
		ifrMainGzip: ifr.ops.main_gzip.score,
		backgroundRaw: preview.ops.background_raw.score,
		checksums: [ifr.meta.mainSemanticChecksum, preview.meta.backgroundSemanticChecksum].join('/'),
	};
}

function measureInventory(scratch) {
	const output = path.join(scratch, 'inventory.json');
	runHarness('inventory.mjs', {
		OCTANE_INVENTORY_CALIBRATE: '1',
		OCTANE_INVENTORY_OUTPUT: output,
	});
	const lynx = JSON.parse(fs.readFileSync(output, 'utf8')).artifacts.lynx;
	return {
		rowsMainRaw: lynx.sections.main.raw,
		rowsMainGzip: lynx.sections.main.gzip,
		rowsBackgroundRaw: lynx.sections.background.raw,
		rowsArtifactGzip: lynx.gzip,
	};
}

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	options.set(process.argv[index].replace(/^--/, ''), process.argv[index + 1]);
}
const harness = options.get('harness') ?? 'all';
const arms = (options.get('arms') ?? 'baseline,validator,batch,both').split(',');
for (const arm of arms) if (!(arm in ARMS)) throw new Error(`unknown arm ${JSON.stringify(arm)}`);
// Every delta and every checksum comparison below is against the baseline arm,
// so a selection that drops it has nothing to report against.
if (!arms.includes('baseline'))
	throw new Error('the baseline arm is what the others are read against.');

if (git('status', '--porcelain', '--', CORE).trim() !== '') {
	throw new Error(`${CORE} has uncommitted changes; this tool restores by discarding them.`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-l5-ceiling-'));
const measured = new Map();
try {
	for (const arm of arms) {
		process.stderr.write(`measuring ${arm}…\n`);
		applyArm(arm);
		try {
			measured.set(arm, {
				...(harness === 'inventory' ? {} : measureRun(scratch)),
				...(harness === 'run' ? {} : measureInventory(scratch)),
			});
		} finally {
			restore();
		}
	}
} finally {
	restore();
	fs.rmSync(scratch, { force: true, recursive: true });
}

// The control: an ablation may delete machinery, never application. Every arm
// must still emit the same visible first tree and the same background program
// semantics as the baseline, or the number below measures the wrong thing.
const baseline = measured.get('baseline');
if (baseline?.checksums !== undefined) {
	for (const [arm, result] of measured) {
		if (result.checksums !== baseline.checksums) {
			throw new Error(`${arm} changed the authored application: ${result.checksums}`);
		}
	}
}

const cell = (value) => (value === undefined ? '' : String(value).padStart(11));
const delta = (value, from) =>
	value === undefined || from === undefined
		? ''
		: `${value === from ? '' : value < from ? '-' : '+'}${Math.abs(from - value)}`.padStart(9);
const ratio = (value) =>
	value === undefined ? '' : `${(value / REFERENCE_MEDIAN_GZIP).toFixed(3)}x`.padStart(8);

console.log(
	`\nreference median ${REFERENCE_MEDIAN_GZIP} B gzip; ${TARGET_RATIO}x target ${
		TARGET_RATIO * REFERENCE_MEDIAN_GZIP
	} B\n`,
);
for (const [key, title] of [
	['previewMainGzip', 'App.lynx.tsrx preview main gzip'],
	['ifrMainGzip', 'App.lynx.tsrx IFR main gzip'],
	['rowsMainGzip', 'lynx-table rows-0 main gzip'],
	['rowsArtifactGzip', 'lynx-table rows-0 complete artifact gzip'],
	['previewMainRaw', 'App.lynx.tsrx preview main raw'],
	['rowsMainRaw', 'lynx-table rows-0 main raw'],
	['backgroundRaw', 'App.lynx.tsrx background raw'],
	['rowsBackgroundRaw', 'lynx-table rows-0 background raw'],
]) {
	if (baseline?.[key] === undefined) continue;
	console.log(`${title}`);
	for (const [arm, result] of measured) {
		const showRatio = key.endsWith('Gzip') ? ratio(result[key]) : '';
		console.log(
			`  ${ARMS[arm].label.padEnd(34)}${cell(result[key])}${delta(result[key], baseline[key])}${showRatio}`,
		);
	}
}
