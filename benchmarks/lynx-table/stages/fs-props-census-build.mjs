// Build the census bundle for #247's bucket-4 cut sizing.
//
//   node stages/fs-props-census-build.mjs --scales 1000,10000 --tag fsprops
//
// One bundle per scale, because the first screen is what is being counted and
// the row count is compiled in. No control arm and no A/B: the patch changes no
// host call and no painted output, so there is nothing to compare against — the
// tally is the whole result.
import { parseArgs } from 'node:util';

import { instrumentFirstScreenPropsCensus } from './fs-props-census-source.mjs';
import { buildTableApp } from '../scripts/build-app.mjs';

const { values: args } = parseArgs({
	options: {
		scales: { type: 'string', default: '1000,10000' },
		tag: { type: 'string', default: 'fsprops' },
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
const restore = instrumentFirstScreenPropsCensus(repo);
try {
	if (args.tag === '') delete process.env.BENCH_DIST_TAG;
	else process.env.BENCH_DIST_TAG = args.tag;
	for (const autoRows of ['0', ...scales.map(String)]) {
		process.env.BENCH_AUTOROWS = autoRows;
		const dist = buildTableApp({ silent: true, mtsProgram: !args.universal });
		console.log(`[fsprops] rows=${autoRows} → ${dist}`);
	}
} finally {
	if (previousTag === undefined) delete process.env.BENCH_DIST_TAG;
	else process.env.BENCH_DIST_TAG = previousTag;
	if (previousRows === undefined) delete process.env.BENCH_AUTOROWS;
	else process.env.BENCH_AUTOROWS = previousRows;
	restore();
}
