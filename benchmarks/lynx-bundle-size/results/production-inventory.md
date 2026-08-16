# Production Lynx bundle inventory for the issue #57 candidate

## Reproducible baseline

- formal source: the issue #57 first-screen template-range candidate over exact upstream `0fc84da02fd05403ac5e36d2aff631b31168d5ac`
- fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Rspeedy, split chunks off, source maps off
- tool host: Node `v22.22.2`, Linux `5.15.120.bsk.3-amd64`
- checked command: `node benchmarks/bench.mjs --ratios lynx-bundle-size`, run at `2026-08-16T05:58:34.959Z` from one lockfile and an isolated dependency tree

| artifact | raw | gzip | Brotli | SHA-256 |
|---|---:|---:|---:|---|
| Octane Web | 499,380 B | 136,977 B | 103,618 B | `fc8558b804d8bd3ee1d625c9b4e7fbfdd57b28f068723c40168cbcbfbba83b40` |
| Octane Lynx | 487,188 B | 164,664 B | 138,589 B | `ada1b9c876f348c2ec8e9f6c7789943cd768aff0ff0eeb9b3fe323e98e961ec3` |
| Lynx main program | 213,501 B | 60,547 B | 51,363 B | `154530fae4d610f8bdfdae59a460afb08535228017cdac5a59783110c08310ad` |
| Lynx background program | 281,753 B | 76,042 B | 64,814 B | `b016770ecd3e245caf9bdbe8a56ff466e7338756da107b726d07ecdfdf209c48` |

The exact `0fc84da` control built in the same measurement window was 495,178 / 135,664 B
for Web and 483,591 / 162,892 B for Lynx. The candidate therefore adds 1,313 B
(0.97%) Web gzip and 1,772 B (1.09%) Lynx gzip. Those controlled deltas, rather
than the cumulative movement from older frozen caps, are the issue #57 size tax.

## Reachable-owner inventory

The production compilation exposes 3,013,811 reachable transformed module
bytes. The inventory distributes each final artifact's raw total according to
those owner weights, accounting for 100%. This is a prioritization ledger, not
an additive compressed-size claim.

| owner | Web attributed raw | Lynx attributed raw | complete-artifact share |
|---|---:|---:|---:|
| compiler-emitted app/background program | 142,234 B | 138,762 B | 28.5% |
| main-thread build/runtime wrapper | 93,743 B | 91,454 B | 18.8% |
| universal runtime | 78,788 B | 76,865 B | 15.8% |
| host driver / PAPI | 39,858 B | 38,885 B | 8.0% |
| protocol / transport / profiling | 35,133 B | 34,275 B | 7.0% |
| first screen / adoption | 34,566 B | 33,722 B | 6.9% |
| other Lynx runtime | 33,095 B | 32,287 B | 6.6% |
| public state / worklets | 29,326 B | 28,610 B | 5.9% |
| authored fixture app | 11,209 B | 10,935 B | 2.2% |
| remaining wrappers, Octane helpers, third party | 1,428 B | 1,393 B | 0.3% |

Every owner above 2% remains on the feature-equivalence ledger. A child may
claim gzip ownership only after a controlled production ablation or isolated
product patch; these raw weights must not be converted into predicted gzip.

## Controlled gzip ledger

- #706: Web/Lynx gzip `+1.38%/+1.45%`, accepted as a measured clear-performance size tax.
- #707: preview main `76,915 -> 75,024 B` and IFR main `81,995 -> 79,980 B`, both `-2.46%`; complete preview `150,079 -> 148,183 B`, complete IFR `155,075 -> 152,968 B`; background raw unchanged. This is an accepted optional-worklet child, still pending upstream.
- merged mainline through `0fc84da`: rows-0 Web/Lynx gzip moved from the old caps to `135,664 / 162,892 B`, and preview/IFR main gzip to `79,394 / 84,559 B`. This is pre-existing drift, not issue #57 ownership.
- issue #57: rows-0 Web/Lynx gzip `135,664 -> 136,977 B` (+0.97%) and `162,892 -> 164,664 B` (+1.09%); preview/IFR main gzip `79,394 -> 81,016 B` (+2.04%) and `84,559 -> 86,318 B` (+2.08%). The size tax is accepted against same-window public/all-row 10k FCP improvements of 13.2%/11.8% and a 30k all-row improvement of 9.3%.

## Decision

The deterministic artifact, inventory, and ratio gates pass with the candidate.
This report accepts its measured size tax for the independently measured FCP
gain; it does not convert the reachable-owner weights into compressed ownership
or claim that remaining startup, heap, teardown, adoption, and mixed-version
work is complete.
