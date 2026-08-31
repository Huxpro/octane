// What a heterogeneous feed costs a commit, before and after the deferred-run
// lookup stopped being a linear scan.
//
// This file is not a test and does not run in CI: the claim it supports is a
// complexity one, and a wall-clock assertion in the unit suite would be a flaky
// gate on a machine-dependent number. It is checked in because a measurement
// whose recipe is unreachable is a number you can only take on trust, and the
// record beside it — `benchmarks/lynx-table/stages/results/` — cites this file.
//
// Run it by copying it to a name the `lynx` project's glob matches. The copy
// stays in this directory so the relative imports below still resolve:
//
//   cp packages/lynx/tests/_probes/list-run-lookup.probe.ts \
//      packages/lynx/tests/_probes/list-run-lookup.probe.test.ts
//   npx vitest run --project lynx \
//      packages/lynx/tests/_probes/list-run-lookup.probe.test.ts \
//      --silent=false --reporter=verbose
//   rm packages/lynx/tests/_probes/list-run-lookup.probe.test.ts
//
// ## What the two arms are
//
// Both render the same fixture at the same row count, and both send the same
// rows through the same code. They differ only in how many *runs* those rows are
// declared as: a run covers a contiguous span of one row shape, so the
// homogeneous feed declares one run and the alternating feed declares one per
// row. The ratio between the arms is therefore the price of the run count
// alone, with row count, tree shape and value count held equal — which is why
// the ratio is the reading, and neither arm's absolute number is.
//
// ## The two windows
//
// `mount` is the first commit: each declared range is checked against the ranges
// already staged, and every id it declares is looked up once. `update` is the
// second commit, where the walk that tells a list about its logical rows reads
// every row again — the window that repeats for as long as the list exists.
import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import type { UniversalComponent } from 'octane/universal/native';
import { describe, expect, it } from 'vitest';

import { createLynxRoot, type LynxRoot } from '../../src/index.js';
import { installLynxMainThread, type LynxMainThreadController } from '../../src/main-thread.js';
import { NativeListShapeClassesFixture } from '../_fixtures/native-list-shape-classes.lynx.tsrx';

interface FeedRow {
	readonly id: string;
	readonly label: string;
	readonly caption: string;
	readonly media: boolean;
}

interface Windows {
	readonly mount: number;
	readonly update: number;
}

const fixture = NativeListShapeClassesFixture as UniversalComponent<{
	readonly items: readonly FeedRow[];
}>;

const ROWS = [1_000, 2_000, 4_000];
const SAMPLES = 5;

const feed = (count: number, media: (index: number) => boolean, tag: string): FeedRow[] =>
	Array.from({ length: count }, (_unused, index) => ({
		id: String(index),
		label: `${tag} ${index}`,
		caption: `Caption ${index}`,
		media: media(index),
	}));

/** Time the commit that mounts `count` rows, then one that updates all of them. */
async function timeCommits(count: number, media: (index: number) => boolean): Promise<Windows> {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, { window: dom.window as never });
	const environment = globalThis.lynxTestingEnv;
	environment.switchToMainThread();
	const context = (
		globalThis as unknown as { lynx: { getJSContext(): unknown } }
	).lynx.getJSContext();
	let main: LynxMainThreadController | null = installLynxMainThread({ context: context as never });
	environment.switchToBackgroundThread();
	let root: LynxRoot | null = createLynxRoot();
	try {
		// Both item arrays are built before either window opens, so neither window
		// carries the cost of composing the props it is handed.
		const mountItems = feed(count, media, 'Row');
		const updateItems = feed(count, media, 'Next');
		const mountStarted = performance.now();
		await root.render(fixture, { items: mountItems });
		await root.flushTransport();
		const mount = performance.now() - mountStarted;
		const updateStarted = performance.now();
		await root.render(fixture, { items: updateItems });
		await root.flushTransport();
		const update = performance.now() - updateStarted;
		await root.unmount();
		root = null;
		return { mount, update };
	} finally {
		await root?.unmount();
		main?.close();
		main = null;
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		dom.window.close();
	}
}

const median = (samples: readonly number[]): number =>
	[...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)]!;

describe.sequential('deferred-run lookup scaling', () => {
	it('reports the alternating-over-homogeneous ratio at three row counts', async () => {
		const lines: string[] = [];
		const report = (
			rows: number,
			label: string,
			homogeneous: readonly number[],
			alternating: readonly number[],
		): void => {
			const format = (samples: readonly number[]): string =>
				samples.map((value) => value.toFixed(1)).join(', ');
			lines.push(
				[
					`rows=${rows}`,
					`window=${label}`,
					`homogeneous=${median(homogeneous).toFixed(1)}ms [${format(homogeneous)}]`,
					`alternating=${median(alternating).toFixed(1)}ms [${format(alternating)}]`,
					`ratio=${(median(alternating) / median(homogeneous)).toFixed(2)}x`,
				].join(' '),
			);
		};
		for (const rows of ROWS) {
			const homogeneous: Windows[] = [];
			const alternating: Windows[] = [];
			for (let sample = 0; sample < SAMPLES; sample++) {
				// AB on even samples, BA on odd, so neither arm always runs on the
				// colder heap.
				if (sample % 2 === 0) {
					homogeneous.push(await timeCommits(rows, () => false));
					alternating.push(await timeCommits(rows, (index) => index % 2 === 1));
				} else {
					alternating.push(await timeCommits(rows, (index) => index % 2 === 1));
					homogeneous.push(await timeCommits(rows, () => false));
				}
			}
			for (const label of ['mount', 'update'] as const) {
				report(
					rows,
					label,
					homogeneous.map((sample) => sample[label]),
					alternating.map((sample) => sample[label]),
				);
			}
		}
		console.log(`LIST RUN LOOKUP\n${lines.join('\n')}`);
		expect(lines).toHaveLength(ROWS.length * 2);
	}, 900_000);
});
