# Issue #288: Block external-store selector owner

This slice moves a page-level `useSyncExternalStore` selector onto the shipping
Lynx Block background core without adding an owner to each keyed row. It is one
part of issue #288, not the issue's final acceptance report.

## Revision and baseline

- Baseline: `920515c4a22c93e33ec21637b6eeeba65804711a` (merged PR #301).
- Candidate implementation: `4c3462babb09e72d213e46025a5aae51d6e2096a`.
- The initial focused RED run had four expected failures in the new lifecycle
  and store cases: the Block page scope rejected the layout effect used by
  `useSyncExternalStore`, so this workload could only run on the Universal root.
- Both production benchmark arms use the candidate source. They compile the
  same authored `.lynx.tsrx` with the background core as the only build-time
  difference; this measures the newly reachable workload rather than comparing
  different revisions or maintaining a synthetic reimplementation of the old
  refusal.

## Mechanism and observable contract

`createUniversalHookScope` now has one optional service by which its adopter can
schedule layout-effect cleanup/create work at an accepted-host boundary. A
successful Block render publishes its hook cells only after all plan checks,
slot writes, and keyed-range reconciliation have succeeded. The background root
then waits for the main-thread acknowledgement before running the queued layout
work. A render that throws before commit discards that work.

This is deliberately a page owner, not a row owner. The existing
compiler-certified keyed-selection path receives the selected key and revisits
only the old and new rows. The page retains one stable external-store
subscription, an unchanged snapshot schedules no render, and unmount performs
one cleanup.

The following remain explicit refusals rather than hidden fallbacks:

- hooks in keyed row components;
- insertion and passive effects, whose phases the Block core does not own;
- context reads, which require an owner chain;
- nested keyed ranges and every previously documented unsupported Block shape.

The lifecycle tests also cover cleanup-before-create when the subscribe
function changes, removal of a conditional layout effect, exact unmount
cleanup, no publication before acknowledgement, and abandonment after a render
throws.

## Production CPU/protocol A/B

The benchmark builds shipping, minified bundles with profiling disabled. It
warms both arms, alternates ABBA/BAAB order for five repetitions, and creates a
fresh root and store for each of the resulting ten samples per arm. Mount is
settled before timing. Each timed selection includes background notification,
render, transport framing, main-thread receive/apply, acknowledgement, and the
accepted layout boundary. The in-process fake Element PAPI is intentionally
cheap, so these numbers are CPU/protocol evidence and make no native paint or
layout claim.

Every arm must independently satisfy the following oracle before a timing is
accepted:

- quarter → three-quarters → quarter paints `row danger` on the selected host;
- reachable-tree checksums match between arms after every step;
- row renders and host commands are exactly `1 / 2 / 2`, with one commit per
  step;
- one subscription is installed and exactly one cleanup leaves zero listeners;
- an unchanged notification produces zero row renders, commits, and commands;
- diagnostics and failed/DNF samples are zero.

Median elapsed milliseconds (lower is better):

| rows | selection | Universal | Block | speedup |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | first | 2.527 | 0.422 | 6.0× |
| 1,000 | switch | 2.339 | 0.404 | 5.8× |
| 1,000 | switch back | 2.008 | 0.355 | 5.7× |
| 10,000 | first | 22.670 | 0.494 | 45.9× |
| 10,000 | switch | 18.200 | 0.478 | 38.1× |
| 10,000 | switch back | 17.613 | 0.457 | 38.5× |
| 30,000 | first | 68.556 | 0.617 | 111.1× |
| 30,000 | switch | 57.289 | 0.529 | 108.3× |
| 30,000 | switch back | 54.645 | 0.518 | 105.5× |

Raw samples and all counters are checked in:

- [`issue288-production-store-selector-1000.json`](../../../benchmarks/lynx-table/stages/results/issue288-production-store-selector-1000.json)
- [`issue288-production-store-selector-10000.json`](../../../benchmarks/lynx-table/stages/results/issue288-production-store-selector-10000.json)
- [`issue288-production-store-selector-30000.json`](../../../benchmarks/lynx-table/stages/results/issue288-production-store-selector-30000.json)

The Block median remains below 0.62 ms at 30,000 rows while the Universal root
grows with the retained tree. The exact row-render, lookup, and command counters
are constant in the touched set (`K = 1` or `2`), so the speedup is not obtained
by deferring row rendering or host work to another step.

## Bundle cost attribution

`benchmarks/lynx-bundle-size/core-switch.mjs` built the same unchanged production
fixture at the baseline and candidate revisions. The harness's Block probes were
updated from development-only prose (absent in both builds under `dev: false`)
to production error codes, then both revisions passed the one-core-only,
main-thread byte-identity, and backend-isolation controls.

| artifact | baseline | candidate | candidate − baseline |
| --- | ---: | ---: | ---: |
| Block background raw | 192,545 B | 194,560 B | +2,015 B |
| Block background gzip | 55,059 B | 55,713 B | +654 B |
| Universal background raw | 301,253 B | 301,265 B | +12 B |
| Universal background gzip | 83,523 B | 83,533 B | +10 B |
| main thread | 255,400 B / 115,950 B gzip | identical | 0 B |

The store workload's complete minified bundle is 588,165 B raw / 134,261 B gzip
for Block and 723,868 B / 163,044 B for Universal. Those totals describe the
core switch, not this patch's cost; the controlled revision delta above is the
cost attributed to the implementation.

The added allocations are confined to page renders that actually carry layout
effects: the scope derives slot maps and ordered cleanup/create task lists at
commit, and the Block root holds an after-commit task queue until acknowledgement.
There is no per-row owner, subscription, map, or lifecycle cell. Retained native
and JS memory has not been measured in this slice and is not claimed here.

## Verification

- Focused behavior suites: 4 files, 89 tests passed.
- Targeted typecheck for the seven changed source/test files: passed.
- `pnpm typecheck`: passed, including typetests, published surfaces, examples,
  and the SPA benchmark.
- `pnpm format:files:check`: passed.
- `pnpm sync`: passed with no unexpected generated changes.
- `pnpm test` reached the local worker's approximately 4 GB heap ceiling after
  the main process had run for about 20 minutes. Before the OOM, the only two
  reported five-second resource timeouts were
  `packages/cli/tests/analyze.test.js` and
  `packages/waypoint/tests/differential/parity.test.ts`; isolated reruns passed
  8/8 and 1/1 respectively. Exact-current-head sharded CI is therefore the
  required full-suite gate for this revision.

## Remaining #288 gates

This report does not claim native tap-to-frame percentiles, LepusNG cost,
retained-memory parity, deep-context fan-out, async-resolution storm behavior,
or final #288 acceptance. Those remain separate same-window/native slices so a
CPU-only improvement cannot conceal work moved to the main thread, GC, memory,
startup, or a later frame.
