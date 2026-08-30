import { parseRealmSnapshots } from './analyze.mjs';

function readProfile() {
	const value = globalThis.__OCTANE_LYNX_PROF;
	if (value === undefined) return null;
	const copy = {};
	for (const key of Object.keys(value)) {
		if (typeof value[key] === 'number') copy[key] = value[key];
	}
	// The app's own Row-body counter lives in the profile build beside these
	// (see app/src/App.lynx.tsrx). It is the render-breadth number the runtime
	// counters cannot see, because a memoized item body is invoked directly
	// rather than through any instrumented runtime entry.
	if (typeof globalThis.__BENCH_ROW_RENDERS__ === 'number') {
		copy.rowRenders = globalThis.__BENCH_ROW_RENDERS__;
	}
	// The universal renderer's drain probe keeps its own globals rather than
	// writing into a profile record it does not own (see
	// stages/instrument-source.mjs). Fold them in under the names the
	// attribution reads.
	if (typeof globalThis.__BENCH_BG_PREPARE_MS__ === 'number') {
		copy.bgPrepareMs = globalThis.__BENCH_BG_PREPARE_MS__;
		copy.bgPrepares = globalThis.__BENCH_BG_PREPARES__ ?? 0;
		copy.reconcileVisits = globalThis.__BENCH_RECONCILE_VISITS__ ?? 0;
	}
	return copy;
}

function resetProfile() {
	if (typeof globalThis.__BENCH_ROW_RENDERS__ === 'number') globalThis.__BENCH_ROW_RENDERS__ = 0;
	if (typeof globalThis.__BENCH_BG_PREPARE_MS__ === 'number') {
		globalThis.__BENCH_BG_PREPARE_MS__ = 0;
		globalThis.__BENCH_BG_PREPARES__ = 0;
		globalThis.__BENCH_RECONCILE_VISITS__ = 0;
	}
	const profile = globalThis.__OCTANE_LYNX_PROF;
	if (profile === undefined) return;
	for (const key of Object.keys(profile)) profile[key] = 0;
}

export async function realmSnapshots(page) {
	const snapshots = [];
	for (const frame of page.frames()) {
		const profile = await frame.evaluate(readProfile).catch(() => null);
		if (profile !== null) snapshots.push({ kind: 'frame', profile });
	}
	for (const worker of page.workers()) {
		const profile = await worker.evaluate(readProfile).catch(() => null);
		if (profile !== null) snapshots.push({ kind: 'worker', profile });
	}
	return parseRealmSnapshots(snapshots);
}

export async function resetProfiles(page) {
	await Promise.all([
		...page.frames().map((frame) => frame.evaluate(resetProfile).catch(() => {})),
		...page.workers().map((worker) => worker.evaluate(resetProfile).catch(() => {})),
	]);
}
