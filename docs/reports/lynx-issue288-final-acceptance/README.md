# Lynx issue #288: final M2 acceptance crosswalk

## Verdict

Issue #288's scoped M2 acceptance is complete across five merged mechanism
slices and this final asynchronous-recovery slice. Compiler-proved leaf work
now scales with the selected keys or context-consuming rows rather than the
parent table size, the external-store selector has one page owner, and the real
ReactLynx production shape reaches the sparse deep-context path without moving
event/effect publication ahead of host acknowledgement.

The final missing composition was pre-ACK transport rejection. The accepted
root and its committed sparse context index were already intact, but recovery
unconditionally raised a full-root marker. That marker made the retry enumerate
the whole keyed list. A same-component retry now dirties the accepted root owner
instead: the root still re-executes and rebases every rejected hook edit, while
ordinary retention proofs remain available below it. Updates that arrived while
the host was blocked reuse their already queued urgent pass, avoiding a third
empty transaction. A component identity change retains the complete-root
fallback.

This report closes #288, not the roadmap. It does not claim that the final
default build beats upstream, ReactLynx, or Vue; #289, #290, and the exact-head
formal comparison in #291 remain the authority for those conclusions.

## Exact revisions and final-slice artifact

- Final-slice baseline: `c6ce2caf9aef28d14888319afc4c35857dd43372`,
  merged PR #305.
- Final-slice runtime candidate:
  `16dbc99d582a1ab477560dee9baaf9fa81a721f6`.
- Both bundles below use the same `storm` arm label, 1,000 rows, depth 32,
  production mode, Universal background core, disabled profiling/HMR, identical
  fixture hashes, and lockfile SHA-256
  `33848875a47a0aca5b36fdbe0d9b211f008b07a27315fc1dc685f54a89e2e596`.
- Baseline bundle: 587,925 B / 207,447 B gzip, SHA-256
  `96d257545a68f55b8e49566fde510e5978a5b377227a8abd47c90e83b6c4d434`.
- Candidate bundle: 588,019 B / 207,472 B gzip, SHA-256
  `1e06bf9b6ff9057cda47d69bbe8688ffef1b909c7b2fc1864420fdb7088ad32e`.
- Final-slice shipping debt: +94 B raw / +25 B gzip. No persistent owner,
  index, queue, listener, handle, or cross-thread message was added. The new
  branches execute only after a scheduled async transaction rejects before ACK.

The fixture inputs match byte-for-byte in both worktrees:

| input | SHA-256 |
| --- | --- |
| `App.lynx.tsrx` | `166205b2c5096adfea96a24c00803cf7c6eceb09a2b2c9cef68f5b63fd663bb2` |
| `index.ts` | `22bcbe52b639287edf757bbb51313444bd935ab71b09093d1792aae9cde30e8b` |
| `issue288.css` | `20b86380ff3a750d1aca2cb4262512c9679d41968bba5bca5ce67efd4b140107` |
| `lynx.config.mjs` | `61c34c46577cb78a7bf64b9dc8d0a0faf44bde7a5bdbc3c2e75daca42d0e912b` |

The candidate bundle is only a size/cost-transfer receipt. The runtime change
cannot execute on the successful native interaction path measured by PR #305,
so no new tap-to-frame latency benefit is claimed from it. The roadmap's final
candidate will be rebuilt and remeasured at #291 rather than treating a cold
rejection branch as a new native headline.

## Asynchronous storm and recovery contract

The public Universal async transport regression mounts three stable keyed rows,
only one of which consumes the provider. It holds a real transport commit before
acknowledgement and drives state through the public setter. The painted host
value, effect lifetime, received wire batches, and authored key/body callbacks
are independent oracles; the comparison is not between two compiler modes.

| scenario | final painted value | key/body calls | consumer renders | received batches | commands per batch |
| --- | --- | ---: | ---: | ---: | --- |
| 50-tick final-state storm behind accepted in-flight commit | `final-50` | 0 / 0 | 2 | 2 | 1, 1 |
| isolated pre-ACK rejection and automatic retry | `isolated-recovery` | 0 / 0 | 2 | 2 | 1, 1 |
| pre-ACK rejection plus 49 later ticks | `recovered-50` | 0 / 0 | 2 | 2 | 1, 1 |

The pre-fix red run produced three key calls and three body calls on the recovery
pass (`[3, 3, 2]` including consumer renders). An intermediate implementation
removed that scan but sent a third empty batch (`[1, 1, 0]` commands); the final
implementation removes both costs. In all three accepted outcomes the stable
effect remains mounted and cleans exactly once on unmount.

This is #201's **final-state** contract: intermediate values are intentionally
droppable behind ACK backpressure. It does not relabel a failing every-tick
workload as a win, and no DNF, retry, or rejected batch is removed from the
accounting.

Transitions deliberately remain on the complete-list path because transition
attempts carry bookkeeping for every owner. The new regression observes three
key calls and three body calls for a three-row transition, then proves that the
next urgent context update restores the sparse path with zero key/body calls.
A sparse row that suspends likewise restarts from the complete list after wakeup,
using the existing cold retry rather than publishing a partial owner tree.

## Issue-level acceptance crosswalk

| #288 requirement | evidence and result |
| --- | --- |
| Select switches at most the old/new rows | PR #301: deterministic row renders / Block lookups / host commands are `1/1/1`, `2/2/2`, `2/2/2`, then `0/0/0` for unchanged selection. |
| `update10th` | The pre-existing #103 Block path already renders and writes the changed tenth; #301's same-window production control retained its result. Because this operation changes parent list data, list visitation is reported separately and is not promised as O(1). |
| External-store selector | PR #302: one page subscription; changed selection is `1/2/2` row renders / lookups / commands and unchanged notification is `0/0/0`, with ACK-gated subscribe/cleanup semantics. |
| Deep context | PRs #303–#305: unrelated memo owners are retained, a sparse context-to-row index removes source/key/body enumeration, and native effects/events/collapsed templates pass the same transaction proof. |
| Keyed reorder | PR #301 and the Universal regressions force the complete keyed path when source identity/order changes, preserve host identity, refresh committed indices, and allow a later sparse update. |
| Async storm | This slice: 50 final-state updates coalesce into the in-flight batch plus one final batch; isolated and overlapping rejection recover with the same two one-command batches and no list scan. |
| Zero change | Selection, store notification, and deep-context controls all record zero authored render, zero commit, and zero host/wire command. |
| Getter/opaque expressions | Compiler proofs reject member reads, calls, getters, compound expressions, spreads, live/imported bindings, HMR/profile builds, and any unproved capture; those shapes keep the complete path. |
| Closure freshness | PR #305 stages the new event closure under the accepted listener ID and publishes it only after ACK; rejection continues dispatching the old closure. |
| `memo`, dependencies, effects, cleanup | Stable props/context are checked with `Object.is`; changed captures fall back. Stable accepted effects neither recreate nor clean during sparse work and clean once at unmount. |
| Suspense and transition | Partial sparse owner trees are never replayed. Suspension and transition use the complete list; a later ordinary urgent update regains sparse execution. |
| Reject/abort | Speculative host, hook, context version, descriptor, event closure, and effect state publish only after ACK. Rejection preserves the accepted tree and now also preserves sparse recovery complexity. |
| Real native result | PR #305: Android 10 `aries_10`, 16 samples/arm in eight ABBA/BAAB pairs, 32/32 first attempt, zero DNF; touch-to-changed-frame p50 347→290 ms and p95 370→336 ms. |
| CPU and cross-thread attribution | PR #305: 200 real touches/arm, `Lynx_JS` p50 247.2→90.8 ms/interaction and whole-process p50 263.2→109.2; paired traces place the gain in the post-handler Lynx async JS task while main dispatch/flush stays flat. |
| Memory and bundle cost | PR #304 records 30k forced-GC mount +0.40%, transient update -67.9%, and post-GC update +13.99 MB→-0.22 MB. PR #305 records winning paired PSS/RSS/private groups but retains a +1.34% native-heap p95 outlier. This slice adds no retained state and +94/+25 B shipping bytes. |

Detailed source and raw evidence:

- [compiler-proved keyed selection](../lynx-issue288-keyed-selection/README.md)
- [Block external-store selector](../lynx-issue288-store-selector/README.md)
- [context-independent memo retention](../lynx-issue288-context-retention/README.md)
- [sparse deep-context component rows](../lynx-issue288-context-descriptor/README.md)
- [native sparse-context acceptance](../lynx-issue288-native-context-acceptance/README.md)

## Aggregate performance and cost boundary

The strongest production scaling proof remains PR #304's unprofiled ABBA result:
at 30,000 rows with one deep consumer, changed-context median falls from
163.059 ms to 2.951 ms (-98.2%, 55.3x), while 1k/10k/30k candidate medians stay
approximately flat and every sample preserves one leaf render, one commit, two
commands, the painted leaf, and the reachable-host checksum. PR #305 then proves
that mechanism reaches the actual native dual-thread page and improves both
touch-to-frame and whole-process CPU in the measured window.

PR #305's published rolling ledger from the PR #303 native baseline was +13,841
B raw / +3,889 B gzip. Adding this slice's controlled same-label delta yields a
#288 rolling debt of +13,935 B raw / +3,914 B gzip (about +2.43% / +1.92%
against that published baseline). This is explicit M2 debt, not a free win. The
exact current final-slice candidate artifact is the 588,019 B / 207,472 B gzip
bundle recorded above; the rolling total is not presented as a fresh rebuild of
the older PR #303 arm.

No native heap result is hidden: the process-wide PSS/RSS/private comparisons
win, but the post-interaction native-heap p95 outlier remains adverse and the
Explorer SDK's `Memory.getAllMemoryUsage` endpoint is unavailable. The broader
20-cycle create/clear/recreate leak bound, #241 clear cost, #193/#202 native-list
workloads, and final exact-head bundle/bytecode budget belong to #290/#291.

## Verification

- Pre-fix failure: the new rejection-storm oracle observed full list enumeration
  (`[3, 3, 2]`) instead of `[0, 0, 2]`.
- Focused final run: five Universal scheduling/state/Suspense/event/transport
  files, 212/212 tests passing across development and production projects.
- `pnpm typecheck:files` passed for the changed runtime and transport test.
- Repository-wide `pnpm typecheck` passed all workspace bindings, packages,
  website, Lynx demo, and examples.
- `pnpm format:files:check`, `pnpm sync`, and `git diff --check` passed.
- Both shipping artifacts were rebuilt from their exact worktrees with matching
  fixture and lockfile hashes; their hashes and byte counts are recorded above.

Exact-current-head CI is still the merge gate for the final report commit. Once
green and merged, #288 can close and M3 capability work proceeds in #289.
