// Issue #278 Native attribution runner.
//
// This is intentionally a benchmark-app driver, not a runtime instrument. It
// loads one immutable bundle through the reviewed Native adapter, invokes the
// app's programmatic create entry point (bypassing #275's touch path), and
// writes raw boundary evidence through the repository's canonical JSON writer.
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
const bundleFile = path.resolve(arg('--bundle'));
const outputFile = path.resolve(arg('--out'));
const appPatchSha256 = arg('--app-patch-sha256');
const octaneSha = arg('--octane-sha');
const instrumentationSha = arg('--instrumentation-sha');
const driverSha = arg('--driver-sha');
const mode = arg('--mode', 'full');
const repetitions = Number(arg('--reps', '5'));
if (!['gate', 'full'].includes(mode)) throw new Error('--mode must be gate or full.');
if (!Number.isSafeInteger(repetitions) || repetitions < 5) throw new Error('--reps must be >= 5.');
if (!Number.isSafeInteger(expiredAt) || expiredAt <= Date.now()) {
	throw new Error('--expired-at must be an unexpired epoch-millisecond value.');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
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
const bundleBytes = fs.readFileSync(bundleFile);
const bundleSha256 = sha256(bundleBytes);
const identitySeed = `${octaneSha}:${appPatchSha256}:${bundleSha256}`;
const campaignIdentity = {
	campaignId: `octane-278-${sha256(identitySeed).slice(0, 12)}`,
	matrixContractSha256: sha256('octane-278-attribution-v1'),
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
const entry = { id: 'octane-issue278-attribution', framework: 'issue278' };
const samples = [];
const floors = { echo: [], vm: [], papi: [], nodeV8: [] };
let gate = null;

async function loadFresh(label) {
	await adapter.loadBundle(entry, {
		rows: 0,
		bundleBytes,
		bundleSha256,
		suite: `issue278-${label}`,
	});
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const ready = await adapter.evaluate(
			"typeof globalThis.__ISSUE278_RUN_CREATE__ === 'function' && typeof globalThis.__ISSUE278_RUN_VM_CALIBRATION__ === 'function'",
			{ awaitPromise: false, timeoutMs: 5_000 },
		);
		if (ready === true && (await adapter.domSearchCount('title')) === 1) return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('timeout waiting for issue #278 benchmark-app driver.');
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
	const event = await adapter.waitForConsoleMarker('__ISSUE278_ASYNC__', { key, timeoutMs });
	const markerIndex = event.args.indexOf('__ISSUE278_ASYNC__');
	const serialized = event.args[markerIndex + 2];
	if (typeof serialized !== 'string') throw new Error('Native async marker omitted its payload.');
	const settled = JSON.parse(serialized);
	if (!settled.ok)
		throw new Error(`Native async probe failed: ${settled.error}\n${settled.stack ?? ''}`);
	return settled.value;
}

async function createSample(scale, phase, ordinal) {
	await loadFresh(`${phase}-${scale}-${ordinal}`);
	const result = await evaluateAsync(`globalThis.__ISSUE278_RUN_CREATE__(${scale})`, 180_000);
	const mainLabelNodeCount = await adapter.domSearchCount('col-label');
	return {
		phase,
		ordinal,
		scale,
		capturedAt: new Date().toISOString(),
		mainLabelNodeCount,
		result,
	};
}

function assertGate(sample) {
	const { result, mainLabelNodeCount, scale } = sample;
	if (result?.protocol !== 'octane-issue278-create-v1') {
		throw new Error(`gate: unexpected result protocol ${JSON.stringify(result?.protocol)}`);
	}
	if (result.preState?.rowCount !== 0 || result.postState?.rowCount !== scale) {
		throw new Error(`gate: state count mismatch ${JSON.stringify(result)}`);
	}
	if (mainLabelNodeCount !== scale) {
		throw new Error(`gate: main-thread label count ${mainLabelNodeCount}, expected ${scale}`);
	}
	const ops = result.wire?.flatMap((event) => event.commandOps ?? []) ?? [];
	if (!ops.includes('mount-program-run')) {
		throw new Error(
			`gate: dynamic create silently missed mount-program-run (${JSON.stringify(ops)})`,
		);
	}
	if (ops.includes('<wire-decode-failed>')) throw new Error('gate: wire envelope decode failed.');
	return {
		passed: true,
		correctness: {
			btsRowCount: result.postState.rowCount,
			mainLabelNodeCount,
			firstId: result.postState.firstId,
			row998Id: result.postState.row998Id,
		},
		wireOps: ops,
		mountProgramRunObserved: true,
	};
}

function vmLoop(iterations) {
	let checksum = 0x9e3779b9;
	const startedAtNs = process.hrtime.bigint();
	for (let index = 0; index < iterations; index++) {
		checksum = Math.imul(checksum ^ index, 1664525) + 1013904223;
		checksum ^= checksum >>> 13;
	}
	const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1e6;
	return { elapsedMs, checksum: checksum >>> 0 };
}

function scaleSchedule(reps) {
	const ascending = [1000, 2000, 3000, 5000];
	const descending = [...ascending].reverse();
	const counts = new Map(ascending.map((scale) => [scale, 0]));
	const schedule = [];
	for (let round = 0; [...counts.values()].some((count) => count < reps); round++) {
		for (const scale of round % 2 === 0 ? ascending : descending) {
			if (counts.get(scale) >= reps) continue;
			counts.set(scale, counts.get(scale) + 1);
			schedule.push(scale);
		}
	}
	return schedule;
}

try {
	const gateSample = await createSample(1000, 'correctness-and-wire-gate', 0);
	gate = { ...assertGate(gateSample), sample: gateSample };
	if (mode === 'full') {
		await loadFresh('floors');
		const encodedBytes = gateSample.result.wire.find((event) =>
			event.commandOps?.includes('mount-program-run'),
		)?.encodedBytes;
		if (!Number.isSafeInteger(encodedBytes) || encodedBytes < 1) {
			throw new Error('gate did not yield the production commit encoded byte count.');
		}
		const iterations = 5_000_000;
		for (let ordinal = 0; ordinal < repetitions; ordinal++) {
			floors.echo.push(
				await evaluateAsync(`globalThis.__ISSUE278_RUN_ECHO__(${encodedBytes})`, 60_000),
			);
			floors.vm.push(
				await evaluateAsync(`globalThis.__ISSUE278_RUN_VM_CALIBRATION__(${iterations})`, 60_000),
			);
			floors.nodeV8.push({ iterations, ...vmLoop(iterations) });
			floors.papi.push(
				await evaluateAsync('globalThis.__ISSUE278_RUN_PAPI_FLOOR__(1000)', 180_000),
			);
		}
		const ordinalByScale = new Map();
		for (const scale of scaleSchedule(repetitions)) {
			const ordinal = ordinalByScale.get(scale) ?? 0;
			ordinalByScale.set(scale, ordinal + 1);
			const sample = await createSample(scale, 'scale-scan', ordinal);
			assertGate(sample);
			samples.push(sample);
		}
	}
} finally {
	await adapter.dispose();
}

const evidence = {
	protocol: 'octane-issue278-native-attribution-v1',
	status: mode === 'gate' ? 'gate-only' : 'complete',
	capturedAt: new Date().toISOString(),
	provenance: {
		octaneSha,
		instrumentationSha,
		appPatchSha256,
		bundle: {
			path: path.relative(path.resolve(import.meta.dirname, '../../..'), bundleFile),
			bytes: bundleBytes.length,
			sha256: bundleSha256,
		},
		driverRoot,
		driverSha,
		connectorPackageTrees,
		leaseReceipt,
	},
	method: {
		instrument: 'benchmark-app Date.now counters plus Lynx profileMark; no runtime source edits',
		createBoundary: 'programmatic BTS setRows start to transport commit ACK return',
		trigger: 'globalThis.__ISSUE278_RUN_CREATE__; programmatic bypass of #275 touch path',
		clockResolution: 'integer milliseconds in Explorer Native JS realms',
		wireGate: 'gate build decodes only the app-owned transport envelope to list command op names',
		floors: {
			papi: 'detached page; setup outside timer; 7 host nodes per row; outer-timed public PAPI loops',
			echo: 'ContextProxy round trip carrying one string sized to the 1k production commit',
			vm: 'same fixed integer loop in BTS and MTS plus Node V8 host control',
		},
		repetitions,
		scaleOrder: scaleSchedule(repetitions),
	},
	device: adapter.machine,
	gate,
	floors,
	samples,
	logs,
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
await writeEvidenceJson(outputFile, evidence);
console.log(`[issue278] wrote ${outputFile}`);
