# Lynx issue #287, slice 2: compact first-tree program adoption

## Verdict

The build-addressed manifest from slice 1 now replaces an eligible expanded
first-tree program description on the wire. The receiver proves the same
address, placement, ID stride, listener allocation, count, and dynamic values,
then adopts the painted run without repeating the row-scale host comparator,
selector writes, native-event installation, main-thread prop installation, or
temporary active-node indexing. Unsupported or unequal trees retain the full
description and repair path.

This is a material adoption/ready improvement, not an FCP improvement. At 10k
on Lynx for Web, the profile build reduced the framework adoption window from
437.9 to 135.0 ms and paint-to-settled from 1047.9 to 477.1 ms. On native
Android at 1k, the exact mechanism A/B reduced commands from 10,068 to 69, the
acknowledgement from 973,504 to 203 bytes, and main-thread apply from 4570 to
3778 ms. Cold FCP remained neutral in both Web and native observations.

Issue #287 remains open. The production bundle is still larger than slice 1,
and this slice did not collect an adoption-specific post-GC heap series. Those
are explicit remaining gates, not zeroes. The native apply is also still 3.78 s
at 1k on this LepusNG device, so the retained per-host ownership transfer needs
another representation-level deletion before the roadmap can call native ready
competitive.

## Revisions and controls

- merged slice-1 baseline: `99576f6ea7196d79a8f71e0c93e002e986584267`
  (tree-identical source build at `d26c25770966dc9e607a14ebd4043ce43a13a44d`)
- product implementation: `338239970ad75c69d7eccec2d67c41e88c54f9d3`
- exact measured candidate: `8d834fbcbb0bd7095e85e0330dc256f569e345e2`
  (adds bounded benchmark logging, production-equivalent wire fixtures, and
  the 32k envelope, sparse-host-ID, and background-lifecycle corrections)
- Web owner-attribution build: `338239970ad75c69d7eccec2d67c41e88c54f9d3`;
  exact-head shipping Web and native measurements use the candidate above
- native mechanism control: `ae58d5ab638f3e203a75fa0441087931cbd5773c`
  (candidate plus one runtime early return that retains expanded commands;
  framing, protocol, ACK support, profiling, app, and compiler output remain)
- Web: Lynx for Web 0.22.2, Chromium 149.0.7827.55, five fresh pages per cell
- native: Android 10 `aries_10`, Lynx SDK 4.0 / app engine 3.9, DevTool disabled,
  cold launch per sample, temperature at most 35 C, thermal status 0
- order: AB/BA (`A,B,B,A`) with five accepted samples per cell

The native control is intentionally not the old slice-1 bundle. That bundle's
large unframed ContextProxy payload can be silently dropped by this engine, so
using its timeout as a baseline would count a DNF as a speedup. Both formal
native cells contain the same framing implementation and differ only in whether
the proven program description is compacted.

## Shipping FCP

These are uninstrumented production bundles. Every sample settled to the exact
row count and checksum; intervals overlap, so neither scale supports an FCP
claim.

| scale | baseline median (min–max) | candidate median (min–max) | ratio |
| ---: | ---: | ---: | ---: |
| 1k | 142.6 (142.3–146.1) ms | 145.1 (143.2–151.8) ms | 1.018x |
| 10k | 843.7 (800.5–873.6) ms | 821.6 (781.7–838.8) ms | 0.974x |

The two exact-head windows move in opposite directions and both ranges overlap.
The mechanism runs after paint, so the report treats those movements as neutral
and does not use the much larger post-paint profile gain to relabel either one.

## Web adoption attribution

Five same-window 10k profile samples per cell all adopted. The candidate hit
one background compaction and one manifest match per sample, and compared only
the 28 non-program shell nodes. The baseline kept the expanded description.

| adoption measure | slice-1 baseline | compact candidate | ratio |
| --- | ---: | ---: | ---: |
| `prepareLynxHostBatch` wall | 238.2 [231.6–271.8] ms | 99.4 [98.6–107.1] ms | 0.417x |
| `prepared.apply()` wall | 93.8 [90.6–114.2] ms | 38.0 [35.2–41.1] ms | 0.405x |
| sampled host-record building | 65.7 [61.9–70.3] ms | 6.3 [5.4–6.5] ms | 0.096x |
| sampled inbound validation | 63.5 [62.0–70.9] ms | 6.3 [6.2–6.8] ms | 0.099x |
| sampled first-tree comparator | 14.3 [12.0–15.8] ms | 0.2 [0.0–0.3] ms | 0.014x |
| sampled event bookkeeping | 13.0 [11.1–17.1] ms | 0.0 [0.0–0.2] ms | — |
| all adoption-window main frames | 437.9 [431.4–482.3] ms | 135.0 [134.3–143.4] ms | 0.308x |
| paint to settled | 1047.9 [1026.1–1091.2] ms | 477.1 [456.7–487.1] ms | 0.455x |

Sampling perturbs the page. These rows explain ownership and scaling; the
shipping FCP table above remains the only Web headline wall clock.

## Native startup mechanism A/B

Every accepted sample produced the same 1,000-row state: IDs `1/2/3/999`, label
`pretty red table`, and no selection. No sample crashed, timed out, enabled
DevTool, or crossed the thermal gate.

| native startup measure | expanded control | compact candidate | ratio |
| --- | ---: | ---: | ---: |
| cold FCP | 1003 [984–1018] ms | 994 [985–1020] ms | 0.991x |
| background start to second frame | 605 [585–621] ms | 605 [599–616] ms | 1.000x |
| background start to transport ACK | 573 [562–592] ms | 581 [576–592] ms | 1.014x |
| main apply | 4570 [4557–4575] ms | 3778 [3754–3779] ms | 0.827x |
| commands | 10,068 | 69 | 0.0069x |
| program-node comparisons | 4,028 | 28 | 0.0070x |
| main-to-background ACK + complete | 973,504 B | 203 B | 0.00021x |
| ACK encoding | per-handle | compact-v1 (4,028 hosts) | — |

The cold-FCP intervals overlap and are neutral. `main apply` is the receiver's
own `prepared.apply()` wall on one device realm; cross-realm epoch timestamps
are not subtracted from each other.

## First interaction and state

The first native Clear tap ran only after adoption completed. All ten samples
proved the same populated pre-state and zero-row post-state. Both arms issued
7,000 commands and returned the same 163,613-byte acknowledgement, so the
startup deletion did not change or hide clear work.

| native first Clear | expanded control | compact candidate | ratio |
| --- | ---: | ---: | ---: |
| tap to transport ACK | 2280 [2279–2287] ms | 2299 [2290–2315] ms | 1.008x |
| tap to second native frame | 2308 [2299–2310] ms | 2325 [2310–2346] ms | 1.007x |
| main apply wall | 961 [955–964] ms | 960 [959–972] ms | 0.999x |

This small adverse movement is reported as observed, not called a regression or
a win from five samples. It rules out a large transfer of deleted adoption work
into the first settled interaction. Existing adoption-gap tests continue to
cover buffered tap, snapshot, inbound commit, sync-ready, second-render,
unmount, and close fences.

## Wire framing and acknowledgement

The Android engine delivered a 33,722-character ContextProxy event but silently
dropped a 37,649-character one during diagnosis. Encoded messages at or below
32,000 characters therefore remain single events; larger messages use ordered
32,000-character frames with sequence/index/total headers. Receiver state
rejects malformed, overlapping, interrupted, missing, or out-of-order frames
before decoding. Small messages retain the original one-event shape.

The specialized compact ACK is allowed only when the first-tree addressed run
itself supplied the accepted adoption proof. Its host count is recomputed in
both realms, and the background retains the expanded in-memory batch until the
ACK is accepted so it can reconstruct the complete generation/type ledger.
Ordinary main-thread refs remain ineligible; unnegotiated and mismatch paths
retain per-handle acknowledgements.

## Bundle ledger and remaining gates

Exact uninstrumented production sizes:

| target | slice-1 baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| Web | 582,545 B | 594,553 B | +12,008 B (+2.06%) |
| Lynx | 564,273 B | 575,777 B | +11,504 B (+2.04%) |

Slice 1 itself was already +11,656 B Web / +10,406 B Lynx over the pre-manifest
revision. The compact wire repays the runtime description cost but not the code
size debt; framing and generalized fallback validation replace the bytes the
deleted comparison saved. This is why #287 stays open.

The next #287 slice must:

1. remove or consolidate enough protocol/compaction code to repay the temporary
   manifest debt in the shipping bundle;
2. replace the remaining per-host native ownership transfer that leaves 1k
   LepusNG apply at 3.78 s;
3. collect a same-window, forced-GC adoption retention series after hand-over,
   update, unmount, and close;
4. rerun native first-interaction and Web/native ready gates from the resulting
   exact head.

## Correctness gates

Focused tests cover contiguous and strided addressed runs, worklet owner IDs,
compact ACK reconstruction across ID gaps, proof match and repair, announced
selector demand, update after compact adoption, text and main-thread-event
updates, malformed framing, interruption/order, and delta-shadow identity.
The shared first-tree suite retains portal/list, visibility, native-event,
ref/effect, rejection, abort, cleanup, and fence coverage.

At the report head:

- focused mechanism Vitest: 292/292 passing, plus the program-update and
  native-instrument checks after the mechanism commit;
- full Lynx Vitest: 50 files, 854/854 passing;
- benchmark stage harness: 228/228 passing;
- full repository `pnpm typecheck`: passing, including the Lynx testing config;
- native instrumentation tests: 10/10 passing;
- `pnpm sync`, formatting, and `git diff --check`: passing.

Current-head CI remains a PR gate and is not claimed by this local report.

## Raw evidence

- `evidence/web-production-ab-1000.{json,md}`
- `evidence/web-production-ab-10000.{json,md}`
- `evidence/web-profile-abba-10000.{json,md}`
- `evidence/native-startup-abba-1000.json`
- `evidence/native-first-clear-abba-1000.json`
