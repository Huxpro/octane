// Build one arm of the issue-#246 §7 ablation.
//
//   node stages/e1-ablation-build.mjs --scales 1000,10000
//   node stages/e1-ablation-build.mjs --scales 1000,10000 --ablate --tag e1abl
//
// Both arms carry the census patch, so the only thing that differs between them
// is the stub itself. That is the whole point: a control built from pristine
// sources and a candidate built from patched ones would differ by the
// instrumentation as well as by the ablation, and the delta would be a sum of
// two changes with no way to separate them.
//
// The arm is the full set `papi-run.mjs` expects — the shell bundle plus one
// pre-populated bundle per scale — because the runner resolves an FCP bundle
// per scale and a missing one is a 404 rather than a "not measured".
import { parseArgs } from 'node:util';

import { instrumentE1AblationSources } from './e1-ablation-source.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';

const { values: args } = parseArgs({
	options: {
		scales: { type: 'string', default: '1000,10000' },
		ablate: { type: 'boolean', default: false },
		// The second ablation arm: also hoists an unbound node's creation patch when
		// every write it performs is a constant. Reported separately because it
		// removes more than the first arm and the two together bracket the answer.
		aggressive: { type: 'boolean', default: false },
		tag: { type: 'string', default: '' },
		// `papi-run.mjs` requires the `octane` cell in every run, so the universal
		// configuration has to be buildable from here too — as a bystander carrying
		// the same census as the two arms, rather than as a fourth thing to compare.
		universal: { type: 'boolean', default: false },
	},
});

const repo = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const scales = args.scales
	.split(',')
	.filter((value) => value.trim() !== '')
	.map((value) => Number(value.trim()));
if (scales.length === 0) throw new TypeError('at least one scale is required.');
for (const rows of scales) {
	if (!Number.isSafeInteger(rows) || rows <= 0) throw new TypeError('scales must be positive.');
}

const previousTag = process.env.BENCH_DIST_TAG;
const previousRows = process.env.BENCH_AUTOROWS;
const restore = instrumentE1AblationSources(repo, {
	ablate: args.ablate,
	aggressive: args.aggressive,
});
try {
	if (args.tag === '') delete process.env.BENCH_DIST_TAG;
	else process.env.BENCH_DIST_TAG = args.tag;
	for (const autoRows of ['0', ...scales.map(String)]) {
		process.env.BENCH_AUTOROWS = autoRows;
		const dist = buildTableApp({ silent: true, mtsProgram: !args.universal });
		console.log(
			`[e1] ${args.ablate ? (args.aggressive ? 'ablation+' : 'ablation') : 'control'} rows=${autoRows} → ${dist}`,
		);
	}
} finally {
	if (previousTag === undefined) delete process.env.BENCH_DIST_TAG;
	else process.env.BENCH_DIST_TAG = previousTag;
	if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
	else process.env.BENCH_AUTOROWS = previousRows;
	restore();
}
