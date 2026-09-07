# Lynx issue #287, slice 1: first-tree program manifests

## Verdict

This is the proof-bearing protocol slice, not the CPU-removal slice and not a
standalone performance win. A fresh addressed program mount now carries a
compact `program-manifest` beside its unchanged expanded host commands. The
main thread accepts the proof only when program address, placement, host-ID
layout, listener-ID layout, run count, and dynamic values agree with the
painted tree. Any absent or unequal proof keeps the existing full-tree
comparison and repair path.

The production path hit the new proof in 5/5 profiled first screens at both 1k
and 10k rows (`program manifest runs=1`, `matches=1`, action `adopt`). The
shipping FCP A/B is neutral within the observed noise and host work is exactly
unchanged. This slice also adds measurable temporary work and bundle bytes, so
no speedup is attributed to it. Issue #287 remains open for slice 2, which can
now delete the certified redundant description/comparison and must repay these
costs before claiming a win.

## Revisions and measurement contract

- exact baseline: `9df140d2c00a7c580a6aef7395ffa8eecd7f31a8`
- implementation measured: `b6e3d9769b80d1c6b9cd93067f1580765bd06853`
- app: production `benchmarks/lynx-table` compiled main-thread-program build
- runtime: Lynx for Web, `@lynx-js/web-core` 0.22.2, Chromium 149.0.7827.55
- host: 32x Intel Xeon Platinum 8336C, Node 22.22.2, Linux 5.15.120
- order: five fresh pages per cell and variant; candidate/control cells and
  control/counts/timed variants rotate in one host window
- headline: uninstrumented `control` FCP only; counts/timed runs explain the
  host boundary and are not substituted for production wall time
- workload identity: every arm settles to the same table and issues the same
  host-call sequence and flush cadence

The baseline bundles were built from the exact baseline commit into the tagged
`base287` directories. Candidate and baseline identities were captured before
the window and rechecked after it.

## Production FCP and host work

Values are milliseconds. `paired median delta` is the median of the five
index-aligned candidate-minus-baseline differences; it is reported separately
from the difference of medians because the two are not interchangeable.

| scale | baseline raw FCP | candidate raw FCP | baseline median | candidate median | paired median delta |
| ---: | --- | --- | ---: | ---: | ---: |
| 1k | 116.4, 119.7, 119.4, 117.0, 121.8 | 117.5, 148.1, 120.4, 119.5, 121.2 | 119.4 | 120.4 | +1.1 |
| 10k | 787.8, 804.4, 796.7, 794.1, 781.4 | 793.0, 770.8, 786.9, 787.5, 847.1 | 794.1 | 787.5 | -6.6 |

The intervals overlap heavily and each scale contains a large outlier in the
opposite direction, so neither movement is a performance claim. The instrument
controls agree with that verdict:

| scale | variant | baseline median | candidate median | paired median delta |
| ---: | --- | ---: | ---: | ---: |
| 1k | counts | 125.5 | 126.2 | +1.9 |
| 1k | timed | 136.6 | 140.4 | +6.9 |
| 10k | counts | 873.2 | 866.3 | +16.0 |
| 10k | timed | 987.0 | 977.3 | -15.9 |

Both revisions perform exactly 17,113 host calls and two flushes at 1k, and
170,113 calls and two flushes at 10k. The manifest does not replace, defer, or
hide any host mutation in this slice.

## Mechanism hit and current cost

The same-window sampling build demonstrates the mechanism and prices its
shape. Sampling perturbs the page, so these numbers are attribution evidence,
not production wall-clock results.

| scale | profile measure | baseline | candidate |
| ---: | --- | ---: | ---: |
| 1k | manifest runs / matches | 0 / 0 | 1 / 1 |
| 1k | main-thread first-screen frames | 85.4 | 88.5 |
| 1k | `prepareLynxHostBatch` wall | 38.3 | 38.9 |
| 1k | `prepared.apply()` wall | 12.2 | 14.2 |
| 1k | paint to settled | 0.0 | 0.0 |
| 10k | manifest runs / matches | 0 / 0 | 1 / 1 |
| 10k | main-thread first-screen frames | 100.1 | 105.5 |
| 10k | adoption-window frames | 437.8 | 457.3 |
| 10k | `prepareLynxHostBatch` wall | 231.4 | 249.3 |
| 10k | `prepared.apply()` wall | 98.6 | 105.6 |
| 10k | paint to settled | 1012.5 | 1082.7 |

The 10k profile build therefore exposes a provisional +70.2 ms median
paint-to-settled cost, not a saving. Its intervals overlap, and the production
FCP does not move correspondingly, but slice 2 must remove the old row-scale
work and rerun this same window before the roadmap can count any improvement.

## Bundle cost

These are exact, uninstrumented production bundles. Row count changes bundle
content but not size because it is a build-time literal.

| target | baseline bytes / SHA-256 | candidate bytes / SHA-256 | delta |
| --- | --- | --- | ---: |
| Web, 1k | 570,889 / `c09cf4bb3f9cdbec5a3081fc94fd30a51b52f4efe7334eb8c4dc344ff17d820c` | 582,545 / `349ee799dc274fab6ce7e1b3949f87ff11ff5d4b3461691f53feb9cf5109c72a` | +11,656 (+2.04%) |
| Lynx, 1k | 553,867 / `1eb7142ab48d4f3a7a16da7bb060d15e57388dde7999d4dccbd81301c0bd8aad` | 564,273 / `797405df9f534eb9d17b66e79b88d76b33e808c5b67c6991d572a2dccd11b487` | +10,406 (+1.88%) |
| Web, 10k | 570,889 / `697e0f40e2ad8eefc0d575f34af713e80860f0db3a4daf35dc3d3616b41e99bb` | 582,545 / `32949a6a899ef52d7949cf45d7ac1b81f6ef9205463cf40ba025227a99837f37` | +11,656 (+2.04%) |
| Lynx, 10k | 553,867 / `3a3f8bd8fa59d0d450d6a20448dcc145f7ae1f18f3c529d2cc25a97f9f59c149` | 564,273 / `bc301cc629089d5f493e4e835e27d0893080e7c60e69db5aedf70ba9ae2db4e9` | +10,406 (+1.88%) |

This is explicit bundle debt for the follow-up slice. No part of it is hidden
as benchmark-only code.

## Proof boundary and fallback

The producer-local capability is deliberately narrower than peer permission:
it may construct a manifest while retaining the ordinary commands, but the
transport advertises it only when the peer has both the painted first tree and
the addressed program registry. Only the first prepared adoption batch may
carry manifests; unsupported peers have them stripped before transport.

Eligible mounts must be visible, host-rooted collapsed programs with a build
address and complete contiguous listener identities. Adjacent instances fold
into a run only when address, prepared layout, parent, anchor, host stride, and
listener stride remain deterministic. Portals, hidden roots, incomplete event
captures, unaddressed programs, and later batches retain the existing path.

On the main thread, address/layout/stride/count/listener/value disagreement
returns the existing mismatch reason and `repair`; it never treats the manifest
as host commands. The full per-host first-tree comparator still executes after
a manifest match in this slice. That duplication is intentional evidence for
the deletion slice, not finished optimization.

## Correctness and gates

Tests cover production manifest generation, a dense run split across multiple
addressed command segments, protocol validation, first-batch-only behavior,
exact adoption, address/layout/value/listener mismatch and repair, unsupported
peer stripping, registry lookup, and profile reset. Existing tap, snapshot,
inbound commit, sync-ready, second-render, unmount, and close fences remain on
the shared adoption path.

- focused Vitest: 372/372 passing across eight projects
- profile/instrument tests: 33/33 passing
- scoped source typecheck: passing
- `pnpm sync`: passing
- changed-file formatting and diff check: passing
- deliberate red/green check: removing manifest emission made the production
  generation assertion fail in both development and production; restoration
  returned both to green

First-tap latency, device cross-thread cost, GC/retention, and the net bundle
ledger are not claimed by this protocol slice. They remain explicit gates for
slice 2 and the final #287 verdict; the issue stays open.

## Raw evidence

- `owner-base-1k.json`, `owner-base-10k.json`: pre-change owner attribution
- `boundary-ab-1k.json`, `boundary-ab-10k.json`: complete same-window PAPI
  control/counts/timed samples, bundle identities, call counts, and host load
- `boundary-scaling.json`: 1k/10k scaling record
- `profile-abba-1k.json`, `profile-abba-10k.json`: same-window baseline and
  candidate sampling profiles, manifest counters, adoption action, and walls
