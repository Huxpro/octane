# Measuring `heapMtsAfterClear`

#241 sets a retention oracle — `heapMtsAfterClear@10k` at or below upstream's —
and nothing in this repository names that metric. It is not missing; it lives in
the campaign harness at
[`Huxpro/lynx-js-framework-benchmark`](https://github.com/Huxpro/lynx-js-framework-benchmark),
in `packages/runner/src/harness-web.mjs`. Grepping `benchmarks/` for it returns
nothing and invites the conclusion that the oracle is unmeasurable. It is not.
This file is here so the next person spends five minutes rather than an hour.

## What the instrument actually does

On a **fresh** page (never the warm page the latency cases run on, whose heap
carries every preceding workload's allocation history):

1. click `Create 10,000 rows`, wait for `rowCount == 10000`, settle;
2. for the page realm and the `lynx-bg` worker realm, over CDP:
   `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage` →
   `heapMts` / `heapBts`;
3. click `Clear`, wait for `rowCount == 0`, settle;
4. the same two reads again → `heapMtsAfterClear` / `heapBtsAfterClear`.

Two properties follow from that shape and are worth stating because they decide
what the number can be used for:

- **It is a post-collection reading, not a retained peak.** Anything released by
  the next batch is already collectable when the GC runs, so it does not appear
  here regardless of how large it was while live. A cache measured at its peak
  and this metric are different quantities; neither settles the other.
- **`heapMts` and `heapMtsAfterClear` answer different questions.** The first is
  what 10,000 live rows cost. The second is what survives their removal. A change
  can move one and not the other.

## Recipe

### 1. Build each arm as an entry bundle

The harness clicks `Create 10,000 rows` itself, so only the `rows-0` entry
bundle is needed — not the whole 0/1k/10k/30k ladder that
`scripts/build-octane-upstream.mjs` produces.

```bash
# in each octane checkout (base and candidate)
NODE_ENV=production BENCH_AUTOROWS=0 BENCH_CORE=block BENCH_BLOCK_MODE=scoped \
  node benchmarks/lynx-table/scripts/build-app.mjs
# → benchmarks/lynx-table/app/dist-block/main.{web,lynx}.bundle
```

Both arms must use identical `BENCH_CORE` / `BENCH_BLOCK_MODE`. To compare
against a number the campaign published, match the entry's recorded
`provenance.buildEnv` as well.

### 2. Install each build as an entry

```bash
mkdir -p <bench-repo>/entries/<id>/dist/rows-0
cp <checkout>/benchmarks/lynx-table/app/dist-block/main.{web,lynx}.bundle \
   <bench-repo>/entries/<id>/dist/rows-0/
```

`entries/<id>/entry.json` needs `id` (matching the directory name — discovery
throws otherwise), `harnesses: ["web"]`, and `bundles.web` pointing at
`dist/rows-0/main.web.bundle`.

### 3. Drive the memory block directly

A full `lynx-bench run` reaches these numbers only after every latency case, at
roughly forty times the wall clock. `runWebHarness` with **no cases** skips
straight to the memory block, because the case loop is what `cases: []` empties
and the memory block sits after it.

```js
// scripts/heap-gate.mjs in the bench repo — node scripts/heap-gate.mjs 4
import { discoverEntries } from '../packages/runner/src/entries.mjs';
import { runWebHarness } from '../packages/runner/src/harness-web.mjs';

const REPS = Number(process.argv[2] ?? 3);
const byId = new Map(
	discoverEntries({ only: ['e2base', 'e2cand'] }).map((e) => [e.id, e]),
);

const rows = [];
for (let rep = 0; rep < REPS; rep++) {
	// Interleave AB/BA so both arms sit in one window; only the within-window
	// comparison is a claim, per #230's protocol.
	const order = rep % 2 === 0 ? ['e2base', 'e2cand'] : ['e2cand', 'e2base'];
	const { records } = await runWebHarness({
		entries: order.map((id) => byId.get(id)),
		cases: [],
		suites: ['table'],
		scales: [10000],
		reps: 1,
		stormReps: 0,
		includeMemory: true,
	});
	for (const r of records) {
		if (r.workload === 'memory' || r.workload === 'memoryAfterClear') {
			rows.push({
				rep,
				entry: r.entry,
				metric: r.metric,
				mib: +(r.value / 1024 / 1024).toFixed(2),
			});
		}
	}
}
console.table(rows);
```

Report the median with its full range per arm, and call a difference a result
only when the ranges are disjoint.

## Units

The harness records **bytes**. #241 quotes **MB** (decimal, `/1e6`); the script
above prints **MiB** (`/2**20`). The two differ by 4.9%, which is larger than
the movement most changes produce, so convert before comparing to a published
figure rather than reading the label.

A worked check: a base cell reading **10.23 MiB** is **10.73 MB**, against the
**10.74 MB** #241 records for `octane-hux`. Reproducing a published figure from a
separately built cell on unrelated hardware is what says the instrument is
measuring the same thing — do this before trusting a delta, especially a
negative one.
