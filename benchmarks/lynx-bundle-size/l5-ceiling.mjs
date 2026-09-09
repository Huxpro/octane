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
// then restores their exact original bytes. It refuses to start unless those
// sources are clean, so the restore can never conceal work, and it restores in
// a `finally` so an aborted run still leaves the tree as it found it.
//
// A ceiling is an upper bound, not a forecast. Each arm deletes its target
// outright, where the shipping change replaces it: #66's exit gate keeps header
// checks on delta traffic, and the staged batch path remains the direct
// applier's fallback until the specialized core covers every page. What the
// repayment actually collects is therefore less than what this reports.
//
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --harness run
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --harness product --output /tmp/l5.json
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --arms baseline,both
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --harness product --arms baseline,receiver
//   node benchmarks/lynx-bundle-size/l5-ceiling.mjs --harness product --arms baseline,receiver,receiver-papi,receiver-container,receiver-direct,receiver-render,receiver-transport,receiver-worklets,receiver-foundation-lite,receiver-foundation
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = import.meta.dirname;
const REPO = path.resolve(ROOT, '../..');
const LYNX_SOURCE = 'packages/lynx/src';

// The current six-config ReactLynx/Vue comparison median, carried from
// `results/m3-default-path-audit.md`. It is a recorded constant, not something
// this repository can rebuild: only the three references' `.web.bundle`
// fixtures are vendored. Every ratio printed below inherits that.
const REFERENCE_MEDIAN_GZIP = 54_323;
const TARGET_RATIO = 1.5;

// Each arm names what #58's bullet calls for, and the one exported entry whose
// removal takes that machinery's whole transitive closure with it. Production
// tree-shaking computes the closure, which is what makes the number honest:
// a helper the direct first-screen path still calls stays, and is not counted.
// `receiver` asks the larger M3 architecture question: what remains when a
// specialized product entry replaces the general main-thread receiver whole.
// Its result is the compressed budget that replacement must fit inside, not a
// claim that a receiver-free artifact is functional.
function receiverSlice(label, body, retainedRuntimeExports) {
	return {
		label,
		retainedRuntimeExports,
		edits: [['main-thread-implementation.ts', [['installLynxMainThreadWithValidator', body]]]],
	};
}

const ARMS = {
	baseline: { label: 'baseline (no ablation)', edits: [] },
	validator: {
		label: 'recursive validator',
		edits: [
			[
				'core/protocol.ts',
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
		edits: [['core/host-driver.ts', [['prepareLynxHostBatch', "\tthrow new Error('ablated');"]]]],
	},
	receiver: receiverSlice(
		'general main-thread receiver',
		'\treturn Object.freeze({}) as LynxMainThreadController;',
		[],
	),
	'receiver-papi': receiverSlice(
		'receiver floor + Element PAPI/page',
		`\tconst papi = createLynxElementPAPI<Node>(options.target ?? globalThis);
\tpapi.createPage(options.componentId ?? '0', options.cssId ?? 0);
\treturn Object.freeze({}) as LynxMainThreadController;`,
		['core/papi.ts:createLynxElementPAPI', 'LynxElementPAPI:createPage'],
	),
	'receiver-container': receiverSlice(
		'receiver floor + general host container',
		`\tconst papi = createLynxElementPAPI<Node>(options.target ?? globalThis);
\tcreateLynxHostContainer(papi, {
\t\troot: 1,
\t\tpage: papi.createPage(options.componentId ?? '0', options.cssId ?? 0),
\t});
\treturn Object.freeze({}) as LynxMainThreadController;`,
		['core/papi.ts:createLynxElementPAPI', 'core/host-driver.ts:createLynxHostContainer'],
	),
	'receiver-direct': receiverSlice(
		'receiver floor + general direct first-screen applier',
		`\tconst papi = createLynxElementPAPI<Node>(options.target ?? globalThis);
\tconst container = createLynxHostContainer(papi, {
\t\troot: 1,
\t\tpage: papi.createPage(options.componentId ?? '0', options.cssId ?? 0),
\t});
\tif (options.firstScreen === true) {
\t\tapplyLynxFirstScreenDirect(container, options as never, options as never);
\t}
\treturn Object.freeze({}) as LynxMainThreadController;`,
		[
			'core/papi.ts:createLynxElementPAPI',
			'core/host-driver.ts:createLynxHostContainer',
			'core/host-driver.ts:applyLynxFirstScreenDirect',
		],
	),
	'receiver-render': receiverSlice(
		'receiver floor + compiled first-screen evaluator',
		`\tif (options.firstScreen === true) {
\t\trenderLynxFirstScreen(
\t\t\toptions as unknown as UniversalComponent<InstallLynxMainThreadOptions>,
\t\t\toptions,
\t\t);
\t}
\treturn Object.freeze({}) as LynxMainThreadController;`,
		['main-renderer.ts:renderLynxFirstScreen'],
	),
	'receiver-transport': receiverSlice(
		'receiver floor + paired string transport',
		`\tif (options.firstScreen === true) {
\t\tdecodeLynxTransportValue(encodeLynxTransportValue(options));
\t}
\treturn Object.freeze({}) as LynxMainThreadController;`,
		[
			'core/transport-codec.ts:encodeLynxTransportValue',
			'core/transport-codec.ts:decodeLynxTransportValue',
		],
	),
	'receiver-worklets': receiverSlice(
		'receiver floor + optional worklet seam',
		`\tconst worklets = createReplaceableLynxMainThreadWorkletRegistry(
\t\tcreateUnavailableLynxMainThreadWorkletRegistry(),
\t);
\tconst unsubscribe = subscribeLynxMainThreadWorkletFeature((feature) => {
\t\tworklets.replace(feature.createRegistry(options as never));
\t});
\tif (options.firstScreen === true) unsubscribe();
\treturn Object.freeze({}) as LynxMainThreadController;`,
		[
			'core/main-thread-worklet-feature.ts:createUnavailableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:createReplaceableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:subscribeLynxMainThreadWorkletFeature',
		],
	),
	'receiver-foundation-lite': receiverSlice(
		'receiver floor + reusable non-host foundation',
		`\tconst papi = createLynxElementPAPI<Node>(options.target ?? globalThis);
\tpapi.createPage(options.componentId ?? '0', options.cssId ?? 0);
\tif (options.firstScreen === true) {
\t\trenderLynxFirstScreen(
\t\t\toptions as unknown as UniversalComponent<InstallLynxMainThreadOptions>,
\t\t\toptions,
\t\t);
\t\tdecodeLynxTransportValue(encodeLynxTransportValue(options));
\t}
\tconst worklets = createReplaceableLynxMainThreadWorkletRegistry(
\t\tcreateUnavailableLynxMainThreadWorkletRegistry(),
\t);
\tconst unsubscribe = subscribeLynxMainThreadWorkletFeature((feature) => {
\t\tworklets.replace(feature.createRegistry(options as never));
\t});
\tif (options.firstScreen === true) unsubscribe();
\treturn Object.freeze({}) as LynxMainThreadController;`,
		[
			'core/papi.ts:createLynxElementPAPI',
			'main-renderer.ts:renderLynxFirstScreen',
			'core/transport-codec.ts:encodeLynxTransportValue',
			'core/transport-codec.ts:decodeLynxTransportValue',
			'core/main-thread-worklet-feature.ts:createUnavailableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:createReplaceableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:subscribeLynxMainThreadWorkletFeature',
		],
	),
	'receiver-foundation': receiverSlice(
		'receiver floor + reusable foundation with general host container',
		`\tconst papi = createLynxElementPAPI<Node>(options.target ?? globalThis);
\tcreateLynxHostContainer(papi, {
\t\troot: 1,
\t\tpage: papi.createPage(options.componentId ?? '0', options.cssId ?? 0),
\t});
\tif (options.firstScreen === true) {
\t\trenderLynxFirstScreen(
\t\t\toptions as unknown as UniversalComponent<InstallLynxMainThreadOptions>,
\t\t\toptions,
\t\t);
\t\tdecodeLynxTransportValue(encodeLynxTransportValue(options));
\t}
\tconst worklets = createReplaceableLynxMainThreadWorkletRegistry(
\t\tcreateUnavailableLynxMainThreadWorkletRegistry(),
\t);
\tconst unsubscribe = subscribeLynxMainThreadWorkletFeature((feature) => {
\t\tworklets.replace(feature.createRegistry(options as never));
\t});
\tif (options.firstScreen === true) unsubscribe();
\treturn Object.freeze({}) as LynxMainThreadController;`,
		[
			'core/papi.ts:createLynxElementPAPI',
			'core/host-driver.ts:createLynxHostContainer',
			'main-renderer.ts:renderLynxFirstScreen',
			'core/transport-codec.ts:encodeLynxTransportValue',
			'core/transport-codec.ts:decodeLynxTransportValue',
			'core/main-thread-worklet-feature.ts:createUnavailableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:createReplaceableLynxMainThreadWorkletRegistry',
			'core/main-thread-worklet-feature.ts:subscribeLynxMainThreadWorkletFeature',
		],
	),
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
		const target = path.join(REPO, LYNX_SOURCE, file);
		let source = fs.readFileSync(target, 'utf8');
		for (const [name, body] of stubs) source = stubFunction(source, name, body);
		fs.writeFileSync(target, source);
	}
}

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const originalSources = new Map(
	Array.from(
		new Set(
			Object.values(ARMS).flatMap(({ edits }) =>
				edits.map(([file]) => path.join(REPO, LYNX_SOURCE, file)),
			),
		),
		(file) => [file, fs.readFileSync(file)],
	),
);
const restore = () => {
	for (const [file, source] of originalSources) fs.writeFileSync(file, source);
};

function runHarness(script, environment, allowNonzero = false) {
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
		// caller detects that. Other harnesses fail closed.
		if (error.status === undefined || !allowNonzero) throw error;
	}
}

function measureRun(scratch) {
	const output = path.join(scratch, 'run.json');
	runHarness('run.mjs', { BENCH_JSON: output }, true);
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

/**
 * Build the current shipping comparison arm, not the old universal-default
 * sample `run.mjs` and `inventory.mjs` still carry for historical continuity.
 *
 * `core-switch.mjs` deliberately builds and checks all four core/backend arms.
 * Repeating those controls per ablation is slower than asking it for one row,
 * but it makes a flattering number impossible to obtain by accidentally moving
 * the application, leaking the other core, or compiling no main-thread program.
 */
function measureProduct(scratch, arm) {
	const output = path.join(scratch, `core-switch-${arm}.json`);
	runHarness('core-switch.mjs', {
		OCTANE_AUDIT_BASE: 'HEAD',
		OCTANE_CORE_SWITCH_OUTPUT: output,
	});
	const payload = JSON.parse(fs.readFileSync(output, 'utf8'));
	if (payload.controls?.passed !== true) {
		throw new Error(
			`core-switch controls failed for ${arm}: ${(payload.controls?.failures ?? []).join('; ')}`,
		);
	}
	const product = payload.arms?.find((candidate) => candidate.label === 'block+program');
	if (product === undefined)
		throw new Error(`core-switch produced no block+program arm for ${arm}`);
	return {
		productBundleRaw: product.bundle.raw,
		productBundleGzip: product.bundle.gzip,
		productBundleBrotli: product.bundle.brotli,
		productBundleSha256: product.bundle.sha256,
		productBackgroundRaw: product.background.raw,
		productBackgroundGzip: product.background.gzip,
		productBackgroundBrotli: product.background.brotli,
		productBackgroundSha256: product.background.sha256,
		productMainRaw: product.main.raw,
		productMainGzip: product.main.gzip,
		productMainBrotli: product.main.brotli,
		productMainSha256: product.main.sha256,
		productProgramCount: product.program,
		productBackgroundProgramCount: product.backgroundProgram,
		productCoreControls: payload.controls,
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
if (!['run', 'inventory', 'all', 'product', 'full'].includes(harness)) {
	throw new Error(`unknown harness ${JSON.stringify(harness)}`);
}
for (const arm of arms) if (!(arm in ARMS)) throw new Error(`unknown arm ${JSON.stringify(arm)}`);
// Every delta and every checksum comparison below is against the baseline arm,
// so a selection that drops it has nothing to report against.
if (!arms.includes('baseline'))
	throw new Error('the baseline arm is what the others are read against.');

if (git('status', '--porcelain', '--', LYNX_SOURCE).trim() !== '') {
	throw new Error(`${LYNX_SOURCE} has uncommitted changes; this tool restores by discarding them.`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'octane-l5-ceiling-'));
const measured = new Map();
try {
	for (const arm of arms) {
		process.stderr.write(`measuring ${arm}…\n`);
		applyArm(arm);
		try {
			measured.set(arm, {
				...(['run', 'all', 'full'].includes(harness) ? measureRun(scratch) : {}),
				...(['inventory', 'all', 'full'].includes(harness) ? measureInventory(scratch) : {}),
				...(['product', 'full'].includes(harness) ? measureProduct(scratch, arm) : {}),
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
const receiverFloor = measured.get('receiver');
const checksumFailures = [];
if (baseline?.checksums !== undefined) {
	for (const [arm, result] of measured) {
		if (result.checksums !== baseline.checksums) {
			checksumFailures.push(`${arm}: ${result.checksums}`);
			throw new Error(`${arm} changed the authored application: ${result.checksums}`);
		}
	}
} else {
	// Checksums come only from measureRun; the inventory harness carries none,
	// so this run's arms were NOT validated against the baseline application.
	// Say so loudly rather than printing the byte deltas as if they were.
	console.warn(
		'\nWARNING: semantic-checksum control DID NOT RUN (no checksums in this harness mode);' +
			'\nan arm that changed the authored application would not have been caught.\n',
	);
}

// Every receiver linkage probe edits a main-thread-only exported entry. A BTS
// change means the build stopped isolating layers, so its apparent replacement
// cost is invalid rather than merely surprising.
const receiverIsolationFailures = [];
if (receiverFloor !== undefined) {
	for (const [arm, result] of measured) {
		if (!arm.startsWith('receiver')) continue;
		if (result.productBackgroundSha256 !== receiverFloor.productBackgroundSha256) {
			receiverIsolationFailures.push(
				`${arm}: ${result.productBackgroundSha256} !== ${receiverFloor.productBackgroundSha256}`,
			);
		}
	}
}
if (receiverIsolationFailures.length !== 0) {
	throw new Error(`receiver frontier moved BTS: ${receiverIsolationFailures.join('; ')}`);
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
	['productBundleGzip', 'block+program complete artifact gzip'],
	['productBackgroundGzip', 'block+program decoded BTS gzip'],
	['productMainGzip', 'block+program decoded MTS gzip'],
	['productBundleRaw', 'block+program complete artifact raw'],
	['productBackgroundRaw', 'block+program decoded BTS raw'],
	['productMainRaw', 'block+program decoded MTS raw'],
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

const output = options.get('output') ?? process.env.OCTANE_L5_CEILING_OUTPUT;
if (output !== undefined) {
	const receipt = {
		schemaVersion: 2,
		generatedAt: new Date().toISOString(),
		source: {
			commit: git('rev-parse', 'HEAD').trim(),
			dirty: git('status', '--porcelain').trim().length !== 0,
			toolSha256: createHash('sha256')
				.update(fs.readFileSync(new URL(import.meta.url)))
				.digest('hex'),
		},
		toolchain: { node: process.version, platform: `${os.platform()} ${os.release()}` },
		harness,
		reference: {
			medianGzip: REFERENCE_MEDIAN_GZIP,
			targetRatio: TARGET_RATIO,
			targetGzip: REFERENCE_MEDIAN_GZIP * TARGET_RATIO,
			source: 'benchmarks/lynx-bundle-size/results/m3-default-path-audit.md',
		},
		arms: Array.from(measured, ([key, result]) => ({
			key,
			label: ARMS[key].label,
			retainedRuntimeExports: ARMS[key].retainedRuntimeExports ?? null,
			ablatedExports: ARMS[key].edits.flatMap(([file, stubs]) =>
				stubs.map(([name]) => `${file}:${name}`),
			),
			...(key.startsWith('receiver') &&
			receiverFloor?.productBundleGzip !== undefined &&
			result.productBundleGzip !== undefined
				? {
						productBundleGzipOverReceiverFloor:
							result.productBundleGzip - receiverFloor.productBundleGzip,
						productMainGzipOverReceiverFloor:
							result.productMainGzip - receiverFloor.productMainGzip,
						productBundleGzipHeadroomToTarget:
							REFERENCE_MEDIAN_GZIP * TARGET_RATIO - result.productBundleGzip,
					}
				: null),
			...result,
		})),
		controls: {
			checksumRan: baseline?.checksums !== undefined,
			checksum: baseline?.checksums ?? null,
			checksumFailures,
			receiverIsolationFailures,
			productCoreControlsPassed: ['product', 'full'].includes(harness)
				? Array.from(measured.values()).every(
						(result) => result.productCoreControls?.passed === true,
					)
				: null,
		},
	};
	fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
}
