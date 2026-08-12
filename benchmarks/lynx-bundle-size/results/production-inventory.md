# Production Lynx bundle inventory after #706/#707 integration

## Reproducible baseline

- integration source: upstream `9b147781c9b4ec4df053a059633978ddc0ed922a`, then #706 head `8d8883c8`, then both #707 commits ending at `71b758e7` (local integration commit `5a373524`)
- fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Rspeedy, split chunks off, source maps off
- tool host: Node `v22.22.2`, Linux `5.15.120.bsk.3-amd64`
- cross-framework run: `2026-08-11T21-14-12-65160668d8d9-integration-706-707-featured.json`; calibration `2367.5`; all six entries rebuilt from one lockfile; zero DNF/null cells

| artifact | raw | gzip | Brotli | SHA-256 |
|---|---:|---:|---:|---|
| Octane Web | 484,572 B | 132,135 B | 99,989 B | `b025530d9718c85d0f50a86d5fb9e21facf5a47950b1f0b0c6d1718135accde0` |
| Octane Lynx | 473,851 B | 158,882 B | 133,850 B | `bb87aa1c1857ab1189996cddce4a536fb36b3a695be2c9934bb401cd99e07cdd` |
| Lynx main program | 203,712 B | 57,560 B | 48,962 B | `c85c7bfd6f6c2cba24d248fc5a9f30646ac3199696e3a5761a470cbea50c29fd` |
| Lynx background program | 276,738 B | 74,170 B | 63,294 B | `750e2453fe4a5032e25f3d5004d70bc8a953c87614265de71671ce1f42d2dd8b` |

The standalone cross-framework packager reports the same Web bytes and a
54 B raw / 15 B gzip Lynx-encoding difference (`473,905 / 158,897 B`). Budgets
are bound to the checked in-process fixture builder; the external values remain
the authoritative all-framework comparison. The five ReactLynx/Vue comparison
median is 44,489 B Web gzip and 51,228 B Lynx gzip, leaving Octane at 2.97× and
3.10× respectively.

## Reachable-owner inventory

The production compilation exposes 2,914,877 reachable transformed module
bytes. The inventory distributes each final artifact's raw total according to
those owner weights, accounting for 100%. This is a prioritization ledger, not
an additive compressed-size claim.

| owner | Web attributed raw | Lynx attributed raw | complete-artifact share |
|---|---:|---:|---:|
| compiler-emitted app/background program | 139,617 B | 136,528 B | 28.8% |
| main-thread build/runtime wrapper | 90,909 B | 88,897 B | 18.8% |
| universal runtime | 77,629 B | 75,912 B | 16.0% |
| host driver / PAPI | 37,654 B | 36,821 B | 7.8% |
| protocol / transport / profiling | 34,477 B | 33,715 B | 7.1% |
| other Lynx runtime | 32,834 B | 32,107 B | 6.8% |
| first screen / adoption | 30,818 B | 30,136 B | 6.4% |
| public state / worklets | 28,232 B | 27,608 B | 5.8% |
| authored fixture app | 11,437 B | 11,184 B | 2.4% |
| remaining wrappers, Octane helpers, third party | 965 B | 943 B | 0.2% |

Every owner above 2% remains on the feature-equivalence ledger. A child may
claim gzip ownership only after a controlled production ablation or isolated
product patch; these raw weights must not be converted into predicted gzip.

## Controlled gzip ledger

- #706: Web/Lynx gzip `+1.38%/+1.45%`, accepted as a measured clear-performance size tax.
- #707: preview main `76,915 -> 75,024 B` and IFR main `81,995 -> 79,980 B`, both `-2.46%`; complete preview `150,079 -> 148,183 B`, complete IFR `155,075 -> 152,968 B`; background raw unchanged. This is an accepted optional-worklet child, still pending upstream.
- integrated preview/IFR recalibration: main gzip `77,285 / 82,274 B`, background raw `271,737 B`. These exact combined-stack values replace the stale pre-#706 gate without adding the two gzip deltas arithmetically.

## Decision

This is the required inventory-only and budget patch before another product
size change. It does not claim the umbrella's 20% target: #707 is one controlled
child, #706 is an accepted tax, and all other >2% owners remain explicitly
accounted. Runtime acceptance continues to require AB/BA latency, startup,
heap, teardown, worklet/thread-call, adoption, mixed-version, and diagnostic
gates for each future child.
