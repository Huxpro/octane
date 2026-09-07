# Issue #288: context-independent Universal owner retention

This slice stops an ancestor context-provider update from executing memoized
Universal owner subtrees that provably do not observe the changed context. It is
one part of issue #288, not the issue's final acceptance report.

## Revision and workload

- Baseline: `1c44bea38c284f476315977478fee11f9eaa9c6b`, which adds the benchmark and
  leaves the existing conservative context invalidation unchanged.
- Candidate: `27527776128c2ea190078206a2644240406fb69e`.
- Both arms compile the same authored ReactLynx fixture with the candidate
  compiler and Lynx transport/PAPI chassis. Only the aliased Octane runtime
  source changes between revisions.
- The production fixture mounts 1,000, 10,000, or 30,000 keyed memo rows below
  one provider. Exactly one row contains a 32-level memo chain and a leaf that
  reads the provider; every other row is context-independent.

The benchmark uses Lynx's Universal background core and asynchronous
background-to-main transport. Built-in `view` and `text` nodes are applied by
the same fake Element PAPI used by the production transport benchmark. It does
not use a DOM and it makes no browser-layout claim.

## Mechanism and safety boundary

Before this change, any changed ancestor provider made
`ancestorContextsStable` false for every child. Stable memo rows still avoided
their user component bodies, but the runtime invoked all memo comparators and
materialized their returned owner values before discovering that no host work
was needed.

The candidate adds a recursive proof at the existing retained-subtree gate. A
subtree may be adopted across an ancestor provider change only when every
component owner in it:

- has a committed component-memo hook; and
- has the same value for every context it directly read during the committed
  render.

An owner with no context reads therefore proves independence. The recursion is
necessary because a memo wrapper's returned child is materialized after the
wrapper call and owns a separate set of context reads. Any non-memo component
below the candidate subtree is opaque and takes the old conservative path.

This context proof is additive to `ownerSubtreeRetainable`; pending hook
updates, boundary episodes, hidden retained content, warm plans, HMR revision
drift, and the existing feature gates still refuse retention. Direct and nested
memo consumers update to the new value. Host identity, effect lifetime, and
transport ordering remain unchanged for retained siblings.

The first implementation deliberately tested only the outer memo owner. The
new regression oracle caught it: the non-memo child of a memo wrapper failed to
receive the new context. The shipped recursive proof treats that child as
opaque. A separate mutation control removed the new retention alternative;
the regression then failed because the stable comparator ran once instead of
zero times. Restoring the gate returned both development and production
Universal configurations to green.

## Deterministic owner and protocol result

At 30,000 rows the profiling build reports:

| observable | baseline | candidate |
| --- | ---: | ---: |
| profiler events | 30,035 | 36 |
| unrelated plain-row owner attempts | 29,999 | 0 |
| provider/page attempts | 1 | 1 |
| memo-layer attempts | 33 | 33 |
| consumer-row attempts | 1 | 1 |
| leaf attempts / authored leaf renders | 1 / 1 | 1 / 1 |
| host commits / commands | 1 / 2 | 1 / 2 |

Every accepted changed-context sample independently paints
`context-leaf dark`, records the leaf value `dark`, and has the same reachable
host checksum in both arms. Every same-value control records zero component
bodies, commits, and commands. Diagnostics and failed/DNF samples are zero.

The eliminated owner attempts are proportional to the unrelated memo subtrees,
but this is not yet an end-to-end `O(touched)` result. The provider's list plan
still enumerates all row descriptors while rebuilding the parent value. The
candidate removes useless component-owner execution and allocation inside that
scan; a later #288 slice must remove or bypass the remaining descriptor owner.

## Production CPU/protocol A/B

Both arms are minified production bundles with compiler/runtime profiling
disabled. The harness warms every arm and size, uses a fresh mounted root for
each sample, mirrors arm order as ABBA/BAAB, rotates size and changed/control
order, and records ten timing values per arm and cell.

Median changed-provider elapsed milliseconds (lower is better):

| rows | baseline | candidate | reduction | candidate range |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 34.269 | 24.626 | 28.1% | 20.860–43.285 |
| 10,000 | 349.548 | 217.976 | 37.6% | 209.794–301.852 |
| 30,000 | 1,023.262 | 661.121 | 35.4% | 598.925–926.362 |

The same-value control remains approximately constant: candidate medians are
0.011, 0.016, and 0.019 ms at 1k, 10k, and 30k, with zero wire work. These are
background CPU plus protocol/fake-PAPI results. They do not include native
layout, paint, display, or real cross-thread scheduling, so they are not a
substitute for #288's native tap-to-frame gate.

The complete metadata, hashes, counters, min/max/mean/p95, and sorted raw timing
arrays are checked in at
[`issue288-production-deep-context.json`](../../../benchmarks/lynx-table/stages/results/issue288-production-deep-context.json).

## Allocation and retained-memory ledger

Memory samples use the same 30,000-row mounted update under `node --expose-gc`.
Each sample runs in a new child process, warms once, measures once, and forces
GC before the mount ledger and after the update. Five samples per revision are
included in the raw result.

| forced-GC ledger | baseline median | candidate median | delta |
| --- | ---: | ---: | ---: |
| mount heap | 193,705,016 B | 193,686,024 B | -18,992 B |
| transient update | 545,925,536 B | 309,180,680 B | -236,744,856 B (-43.4%) |
| post-GC update over mounted heap | 1,229,152 B | 3,861,408 B | +2,632,256 B |

The transient reduction matches the removed memo execution. The post-GC
difference is adverse and is not relabelled as noise. A diagnostic pair of V8
heap snapshots at 10,000 rows showed 857,454 / 71.75 MB baseline nodes versus
847,577 / 72.60 MB candidate nodes: 9,877 fewer nodes but 0.86 MB more total
self size. Most positive byte differences were bundle source/code/JIT families
and aggregate array backing capacity, so the snapshots did not prove a leaking
logical owner family or explain the full process-ledger difference. Confidence
is high for the isolated process measurements and low for assigning that
retained delta to a specific native-equivalent object class. Native JS heap,
LepusNG, and global Lynx-attributed memory remain required #288 gates.

## Bundle and thread attribution

The complete benchmark bundle changes from 735,166 B raw / 165,651 B gzip to
735,522 B / 165,723 B: +356 B raw and +72 B gzip. A controlled build of the
unchanged core-switch fixture attributes the Universal background program
change as follows:

| artifact | baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| Universal background raw | 301,265 B | 301,561 B | +296 B |
| Universal background gzip | 83,538 B | 83,619 B | +81 B |
| Block background | 194,560 B / 55,715 B gzip | identical | 0 B |
| main-thread program | 255,400 B / 115,950 B gzip | identical | 0 B |

The one-core probes, main-thread byte-identity check, and backend-isolation
controls all pass. The added code and update work are background-only; no bytes
or commands move to the main thread.

## Verification and remaining #288 gates

- The focused Universal regression passes in development and production
  configurations; the explicit RED mutation fails both at the intended
  comparator assertion.
- Seven Universal semantics files pass in both configurations: 14 files and
  260 tests covering transport, scheduling, retained Suspense, Activity,
  portals, event scope, and external stores.
- Targeted Octane source/test typecheck and the repository-wide `pnpm typecheck`
  pass, including Lynx bindings, published surfaces, typetests, examples, and
  benchmark type projects.
- Changed-file formatting and `pnpm sync` pass with no generated drift.
- Exact-current-head repository CI remains the full-suite authority before
  merge.

This report does not close #288. The remaining gates include eliminating the
parent descriptor scan for the proven leaf shape, async
resolution/Suspense/transition/rejection storms, native tap-to-frame p50/p95,
real cross-thread and LepusNG cost, and native/global retained-memory bounds.
