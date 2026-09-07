// Issue #278 Native attribution runner.
//
// This is a benchmark-app instrument, not a runtime feature. It keeps the real
// descriptor fallback separate from the scalar E1 capability probe, compares
// checked/trusted validation in alternating same-lease windows, and never uses
// the deeply counted arm as a timing result.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeEvidenceJson } from '../scripts/evidence.mjs';

const argv = process.argv.slice(2);
function arg(name, fallback) {
	const index = argv.indexOf(name);
	if (index === -1) {
		if (fallback !== undefined) return fallback;
		throw new Error(`missing ${name}`);
	}
	if (argv[index + 1] === undefined) throw new Error(`missing value for ${name}`);
	return argv[index + 1];
}

const driverRoot = path.resolve(arg('--driver-root'));
const serial = arg('--serial');
const expiredAt = Number(arg('--expired-at'));
const outputFile = path.resolve(arg('--out'));
const appPatchSha256 = arg('--app-patch-sha256');
const octaneSha = arg('--octane-sha');
const instrumentationSha = arg('--instrumentation-sha');
const driverSha = arg('--driver-sha');
const runtimeLabel = arg('--runtime-label', 'sandbox-default');
const mode = arg('--mode', 'full');
const repetitions = Number(arg('--reps', '5'));
const roundStart = Number(arg('--round-start', '0'));
const scales = arg('--scales', '1000,2000,3000,5000').split(',').map(Number);
const sections = new Set(arg('--sections', 'overhead,validation,floors').split(','));
if (!['gate', 'full'].includes(mode)) throw new Error('--mode must be gate or full.');
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new Error('--reps must be >= 1.');
if (!Number.isSafeInteger(roundStart) || roundStart < 0) {
	throw new Error('--round-start must be a non-negative integer.');
}
if (
	scales.length === 0 ||
	new Set(scales).size !== scales.length ||
	scales.some((scale) => ![1000, 2000, 3000, 5000].includes(scale))
) {
	throw new Error('--scales must be a unique comma-separated subset of 1000,2000,3000,5000.');
}
const knownSections = new Set(['overhead', 'validation', 'floors']);
if (sections.size === 0 || [...sections].some((section) => !knownSections.has(section))) {
	throw new Error('--sections must be a comma-separated subset of overhead,validation,floors.');
}
if (!Number.isSafeInteger(expiredAt) || expiredAt <= Date.now()) {
	throw new Error('--expired-at must be an unexpired epoch-millisecond value.');
}

const bundleFiles = Object.freeze({
	controlChecked: path.resolve(arg('--control-checked-bundle')),
	timedChecked: path.resolve(arg('--timed-checked-bundle')),
	timedTrusted: path.resolve(arg('--timed-trusted-bundle')),
	countsChecked: path.resolve(arg('--counts-checked-bundle')),
	scalarCountsChecked: path.resolve(arg('--scalar-counts-checked-bundle')),
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const bundles = Object.fromEntries(
	Object.entries(bundleFiles).map(([name, file]) => {
		const bytes = fs.readFileSync(file);
		return [name, { file, bytes, sha256: sha256(bytes) }];
	}),
);
if (new Set(Object.values(bundles).map((bundle) => bundle.sha256)).size !== 5) {
	throw new Error('issue #278 requires five distinct control/profile/count/scalar bundles.');
}

const importFromDriver = (relative) => import(pathToFileURL(path.join(driverRoot, relative)).href);
const [{ default: createAdapter }, connectorModule, nativeProtocol] = await Promise.all([
	importFromDriver('packages/runner/adapters/lynx-sandbox-android.mjs'),
	importFromDriver('packages/runner/src/connector-receipt.mjs'),
	importFromDriver('packages/runner/src/native-protocol.mjs'),
]);

const leaseReceipt = nativeProtocol.parseNativeLeaseReceipt(
	{ serial, issueId: 'Huxpro/octane#278', expiredAt },
	{ serial },
);
const connectorPackageTrees = connectorModule.resolveConnectorPackageTrees({
	fromPath: path.join(driverRoot, 'packages/runner/adapters/lynx-sandbox-android.mjs'),
});
const bundleReceipt = Object.fromEntries(
	Object.entries(bundles).map(([name, bundle]) => [
		name,
		{
			path: path.relative(path.resolve(import.meta.dirname, '../../..'), bundle.file),
			bytes: bundle.bytes.length,
			sha256: bundle.sha256,
		},
	]),
);
const identitySeed = JSON.stringify({ octaneSha, appPatchSha256, bundleReceipt });
const campaignIdentity = {
	campaignId: `octane-278-${sha256(identitySeed).slice(0, 12)}`,
	matrixContractSha256: sha256('octane-278-attribution-v2'),
	inputReceiptSha256: sha256(identitySeed),
	connectorPackageTreesSha256: connectorPackageTrees.sha256,
	connectorPackageTrees,
	leaseReceipt,
};

process.env.LYNX_SANDBOX_SERIAL = serial;
const logs = [];
const adapter = await createAdapter({
	campaignIdentity,
	log(message) {
		logs.push({ at: new Date().toISOString(), message });
		console.log(message);
	},
});

const evidence = {
	protocol: 'octane-issue278-native-attribution-v2',
	status: 'running',
	capturedAt: new Date().toISOString(),
	provenance: {
		octaneSha,
		instrumentationSha,
		appPatchSha256,
		driverRoot,
		driverSha,
		runtimeLabel,
		bundles: bundleReceipt,
		connectorPackageTrees,
		leaseReceipt,
	},
	method: {
		instrument:
			'build-time-restored codec phase counters plus Lynx profileMark; no authored runtime source changes',
		createBoundary: 'programmatic BTS setRows start to transport commit ACK return',
		clockResolution: 'integer milliseconds in Explorer Native JS realms',
		realPathGate: 'range-bearing table must use mount-template-run descriptor fallback',
		scalarPathGate: 'separate range-free scalar replacement must use mount-program-run',
		countArm:
			'deep prepare/restore/alias visits are mechanism evidence only and never timing evidence',
		profileOverhead:
			'unprofiled app-driver control versus timed profile, alternating order at create@1k',
		validationControl: 'checked versus trusted, alternating order at 1k/2k/3k/5k',
		floors: {
			papi: 'detached page; setup outside timer; 7 host nodes per row; public Element PAPI loops',
			echo: 'ContextProxy round trip carrying one string sized to the 1k production commit',
			vm: 'same fixed integer loop in BTS and MTS plus Node V8 host control',
		},
		repetitions,
		roundStart,
		scales,
		sections: [...sections],
	},
	device: adapter.machine,
	gate: null,
	profileOverheadPairs: [],
	validationPairs: [],
	floors: { echo: [], vm: [], papi: [], nodeV8: [] },
	failures: [],
	logs,
};

async function checkpoint(status = evidence.status) {
	evidence.status = status;
	await writeEvidenceJson(outputFile, evidence);
}

function ensureLease() {
	if (Date.now() >= expiredAt)
		throw new Error('issue #278 Sandbox lease expired during the campaign.');
}

async function loadFresh(arm, label) {
	ensureLease();
	const bundle = bundles[arm];
	const entry = { id: `octane-issue278-${arm}`, framework: 'issue278' };
	await adapter.loadBundle(entry, {
		rows: 0,
		bundleBytes: bundle.bytes,
		bundleSha256: bundle.sha256,
		suite: `issue278-${label}`,
	});
	const scalar = arm === 'scalarCountsChecked';
	const readyExpression = scalar
		? "typeof globalThis.__ISSUE278_RUN_SCALAR__ === 'function'"
		: "typeof globalThis.__ISSUE278_RUN_CREATE__ === 'function' && typeof globalThis.__ISSUE278_RUN_VM_CALIBRATION__ === 'function'";
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const ready = await adapter.evaluate(readyExpression, {
			awaitPromise: false,
			timeoutMs: 5_000,
		});
		const expectedNode = scalar ? '.issue278-scalar-placeholder' : '.title';
		if (ready === true && (await adapter.domSearchCount(expectedNode)) === 1) return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`timeout waiting for issue #278 ${arm} benchmark-app driver.`);
}

let asyncProbeOrdinal = 0;
async function evaluateAsync(expression, timeoutMs) {
	const key = `__ISSUE278_CDP_ASYNC_${asyncProbeOrdinal++}__`;
	await adapter.evaluate(
		`(() => {
			Promise.resolve(${expression}).then(
				(value) => console.log('__ISSUE278_ASYNC__', ${JSON.stringify(key)}, JSON.stringify({ ok: true, value })),
				(error) => console.log('__ISSUE278_ASYNC__', ${JSON.stringify(key)}, JSON.stringify({ ok: false, error: String(error), stack: error?.stack ?? null })),
			);
			return 'started';
		})()`,
		{ awaitPromise: false, timeoutMs: 5_000 },
	);
	let event;
	try {
		event = await adapter.waitForConsoleMarker('__ISSUE278_ASYNC__', { key, timeoutMs });
	} catch (error) {
		const diagnostic = await adapter
			.evaluate(
				`JSON.stringify({
					progress: globalThis.__ISSUE278_PROGRESS__ ?? null,
					snapshot: globalThis.__ISSUE278_SNAPSHOT__?.() ?? null,
					last: globalThis.__ISSUE278_LAST__ ?? null,
					wire: globalThis.__ISSUE278_WIRE__ ?? null,
					btsProfile: globalThis.__OCTANE_LYNX_PROF ?? null,
					btsCodecProfile: globalThis.__ISSUE278_CODEC_PROFILE__ ?? null,
				})`,
				{ awaitPromise: false, timeoutMs: 5_000 },
			)
			.catch((diagnosticError) => JSON.stringify({ diagnosticError: String(diagnosticError) }));
		throw new Error(`${error.message}; diagnostic=${diagnostic}`, { cause: error });
	}
	const markerIndex = event.args.indexOf('__ISSUE278_ASYNC__');
	const serialized = event.args[markerIndex + 2];
	if (typeof serialized !== 'string') throw new Error('Native async marker omitted its payload.');
	const settled = JSON.parse(serialized);
	if (!settled.ok) {
		throw new Error(`Native async probe failed: ${settled.error}\n${settled.stack ?? ''}`);
	}
	return settled.value;
}

async function createSample(arm, scale, phase, ordinal) {
	await loadFresh(arm, `${phase}-${scale}-${ordinal}`);
	const result = await evaluateAsync(
		`globalThis.__ISSUE278_RUN_CREATE__(${scale})`,
		Number(process.env.ISSUE278_CREATE_TIMEOUT_MS ?? 240_000),
	);
	return {
		arm,
		phase,
		ordinal,
		scale,
		capturedAt: new Date().toISOString(),
		mainLabelNodeCount: await adapter.domSearchCount('.col-label'),
		result,
	};
}

async function scalarSample() {
	await loadFresh('scalarCountsChecked', 'scalar-e1-gate');
	const result = await evaluateAsync('globalThis.__ISSUE278_RUN_SCALAR__()', 60_000);
	return {
		arm: 'scalarCountsChecked',
		capturedAt: new Date().toISOString(),
		mainNodeCount: await adapter.domSearchCount('issue278-addressed-card'),
		result,
	};
}

function commandOps(sample) {
	const value = sample.result?.btsCodecProfile?.commandOps;
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertCodecAccounting(profile, label) {
	if (profile === null || typeof profile !== 'object')
		throw new Error(`${label}: missing codec profile.`);
	if (profile.encodeCalls !== profile.encodeFlags0 + profile.encodeFlags1) {
		throw new Error(`${label}: encode flag counts do not account for every encode.`);
	}
	if (profile.decodeCalls !== profile.decodeFlags0 + profile.decodeFlags1) {
		throw new Error(`${label}: decode flag counts do not account for every decode.`);
	}
}

function assertRealGate(sample, { requireProfile = true } = {}) {
	const { result, mainLabelNodeCount, scale } = sample;
	if (result?.protocol !== 'octane-issue278-create-v2') {
		throw new Error(`gate: unexpected result protocol ${JSON.stringify(result?.protocol)}`);
	}
	if (result.preState?.rowCount !== 0 || result.postState?.rowCount !== scale) {
		throw new Error(`gate: state count mismatch ${JSON.stringify(result)}`);
	}
	if (mainLabelNodeCount !== scale) {
		throw new Error(`gate: main-thread label count ${mainLabelNodeCount}, expected ${scale}`);
	}
	if (requireProfile) {
		const ops = commandOps(sample);
		if (!(ops['mount-template-run'] > 0) || (ops['mount-program-run'] ?? 0) !== 0) {
			throw new Error(
				`gate: real range-bearing create missed descriptor fallback: ${JSON.stringify(ops)}`,
			);
		}
		assertCodecAccounting(result.btsCodecProfile, 'gate BTS');
		assertCodecAccounting(result.mtsCodecProfile, 'gate MTS');
	}
	return sample;
}

function assertScalarGate(sample) {
	if (sample.result?.protocol !== 'octane-issue278-scalar-v2' || sample.mainNodeCount !== 1) {
		throw new Error(`scalar gate: incorrect result ${JSON.stringify(sample)}`);
	}
	const ops = commandOps(sample);
	if (!(ops['mount-program-run'] > 0) || (ops['mount-template-run'] ?? 0) !== 0) {
		throw new Error(`scalar gate: range-free probe missed E1: ${JSON.stringify(ops)}`);
	}
	assertCodecAccounting(sample.result.btsCodecProfile, 'scalar BTS');
	return sample;
}

function vmLoop(iterations) {
	let checksum = 0x9e3779b9;
	const startedAtNs = process.hrtime.bigint();
	for (let index = 0; index < iterations; index++) {
		checksum = Math.imul(checksum ^ index, 1664525) + 1013904223;
		checksum ^= checksum >>> 13;
	}
	return {
		elapsedMs: Number(process.hrtime.bigint() - startedAtNs) / 1e6,
		checksum: checksum >>> 0,
	};
}

function scaleOrder(round) {
	return round % 2 === 0 ? scales : [...scales].reverse();
}

class StopAfterDnf extends Error {}

async function safeSample(arm, scale, phase, ordinal) {
	try {
		return {
			ok: true,
			sample: assertRealGate(await createSample(arm, scale, phase, ordinal), {
				requireProfile: arm !== 'controlChecked',
			}),
		};
	} catch (error) {
		const failure = {
			capturedAt: new Date().toISOString(),
			arm,
			scale,
			phase,
			ordinal,
			message: String(error),
		};
		evidence.failures.push(failure);
		await checkpoint('incomplete-with-dnf');
		return { ok: false, failure };
	}
}

try {
	const real = assertRealGate(
		await createSample('countsChecked', 1000, 'correctness-path-flags-gate', 0),
	);
	const scalar = assertScalarGate(await scalarSample());
	evidence.gate = {
		passed: true,
		real,
		scalar,
		realPath: 'mount-template-run',
		scalarPath: 'mount-program-run',
	};
	await checkpoint(mode === 'gate' ? 'gate-complete' : 'running');

	if (mode === 'full') {
		for (let offset = 0; sections.has('overhead') && offset < repetitions; offset++) {
			const ordinal = roundStart + offset;
			const order =
				ordinal % 2 === 0 ? ['controlChecked', 'timedChecked'] : ['timedChecked', 'controlChecked'];
			const pair = { ordinal, order, samples: [] };
			evidence.profileOverheadPairs.push(pair);
			for (const arm of order) {
				const sample = await safeSample(arm, 1000, 'profile-overhead', ordinal);
				pair.samples.push(sample);
				await checkpoint();
				if (!sample.ok) throw new StopAfterDnf('stopped after profile-overhead DNF');
			}
		}

		for (let offset = 0; sections.has('validation') && offset < repetitions; offset++) {
			const ordinal = roundStart + offset;
			for (const scale of scaleOrder(ordinal)) {
				const order =
					(ordinal + scale / 1000) % 2 === 0
						? ['timedChecked', 'timedTrusted']
						: ['timedTrusted', 'timedChecked'];
				const pair = { ordinal, scale, order, samples: [] };
				evidence.validationPairs.push(pair);
				for (const arm of order) {
					const sample = await safeSample(arm, scale, 'validation-control', ordinal);
					pair.samples.push(sample);
					await checkpoint();
					if (!sample.ok) throw new StopAfterDnf('stopped after validation-control DNF');
				}
			}
		}

		if (sections.has('floors')) {
			await loadFresh('timedChecked', 'floors');
			const encodedBytes = Math.max(...real.result.wire.map((event) => event.encodedBytes ?? 0));
			if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1) {
				throw new Error('gate did not yield the production commit encoded byte count.');
			}
			const iterations = 5_000_000;
			for (let offset = 0; offset < repetitions; offset++) {
				const ordinal = roundStart + offset;
				evidence.floors.echo.push({
					ordinal,
					...(await evaluateAsync(`globalThis.__ISSUE278_RUN_ECHO__(${encodedBytes})`, 60_000)),
				});
				evidence.floors.vm.push({
					ordinal,
					...(await evaluateAsync(
						`globalThis.__ISSUE278_RUN_VM_CALIBRATION__(${iterations})`,
						60_000,
					)),
				});
				evidence.floors.nodeV8.push({ ordinal, iterations, ...vmLoop(iterations) });
				evidence.floors.papi.push({
					ordinal,
					...(await evaluateAsync('globalThis.__ISSUE278_RUN_PAPI_FLOOR__(1000)', 240_000)),
				});
				await checkpoint();
			}
		}
	}

	await checkpoint(
		mode === 'gate'
			? 'gate-complete'
			: evidence.failures.length === 0
				? 'complete'
				: 'complete-with-dnf',
	);
} catch (error) {
	if (error instanceof StopAfterDnf) {
		evidence.stopReason = error.message;
		await checkpoint('stopped-after-dnf');
	} else {
		evidence.failures.push({
			capturedAt: new Date().toISOString(),
			phase: 'fatal',
			message: String(error),
			stack: error instanceof Error ? error.stack : null,
		});
		await checkpoint('failed');
		throw error;
	}
} finally {
	await adapter.dispose();
}

console.log(`[issue278] wrote ${outputFile}`);
