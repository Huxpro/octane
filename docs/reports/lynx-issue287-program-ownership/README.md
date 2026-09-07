# Lynx issue #287, slice 3: retain compact adoption ownership

## Verdict

The main thread now retains a proof-covered first-tree program run as one dense
ownership record instead of materializing and transferring one record per host.
Only a host touched by a later update is promoted to ordinary per-node storage;
untouched nodes remain in the run until destruction or root disposal. Mismatch,
sparse, unsupported, and fault paths continue through the existing expanded
representation.

This deletes the remaining native adoption bottleneck found in slice 2. On the
same 1,000-row LepusNG workload, an exact one-line mechanism A/B reduced
`prepared.apply()` from 4,072 to 3 ms. Every candidate sample retained exactly
one run covering 4,000 program hosts with no fallback. Cold FCP remained neutral,
and the first Clear interaction also became faster, so the startup result is not
work deferred into the next settled mutation.

Issue #287 remains open. The shipping bundle is still larger than the slice-1
baseline, and an adoption-specific forced-GC retention series has not yet been
collected. Those remain explicit gates rather than being reported as zero cost.

## Revisions and controls

- merged slice-2 base: `ccc61b0f6a50f17cdf159fa07b15c1d1e0209449`
- exact measured candidate: `6993c08c476a33fe801ff8477644531ced295306`
- exact mechanism control: the candidate source plus one early `return false`
  in `adoptProgramRun`; application, compiler output, protocol, profiling, and
  all other runtime code are identical
- native candidate profile bundle: 602,170 B
- native control profile bundle: 601,858 B
- native: Android 10 `aries_10`, Lynx SDK 4.0 / app engine 3.9, DevTool disabled,
  cold launch per sample, temperature at most 35 C, thermal status 0
- Web: Lynx for Web 0.22.2, five fresh pages per cell
- order: AB/BA with five accepted samples per cell

Both native result files identify commit `6993c08c476a33fe801ff8477644531ced295306`.
An earlier diagnostic run recorded before that commit existed was excluded from
the formal evidence.

## Native startup mechanism A/B

Every accepted sample settled to the exact 1,000-row state and issued the same
69 compact commands. No sample crashed, timed out, enabled DevTool, or crossed
the thermal gate.

| native startup measure | expanded-ownership control | retained-run candidate | ratio |
| --- | ---: | ---: | ---: |
| cold FCP | 994 [992–1017] ms | 1012 [995–1014] ms | 1.018x |
| background start to transport ACK | 573 [570–582] ms | 572 [565–603] ms | 0.998x |
| background start to second frame | 604 [603–605] ms | 603 [590–623] ms | 0.998x |
| `prepared.apply()` | 4072 [4063–4098] ms | 3 [3–3] ms | 0.00074x |
| main instrument wall | 4073 [4064–4098] ms | 3 [3–4] ms | 0.00074x |
| program ownership | 0 runs / 0 hosts | 1 run / 4,000 hosts | — |
| ownership fallback | `dense-run-mismatch` | none | — |

The cold-FCP ranges overlap and are treated as neutral. The apply result is the
receiver's own same-realm phase wall, not a subtraction between device clocks.
The 99.93% reduction removes JavaScript ownership materialization after native
paint; it is not relabelled as an FCP improvement.

## First Clear and cost-transfer check

Clear ran only after adoption completed. Every sample proved the same populated
pre-state and empty post-state. Both cells issued exactly 7,000 commands:
2,000 event removals, 1,000 tree removals, and 4,000 host destructions.

| native first Clear | expanded-ownership control | retained-run candidate | ratio |
| --- | ---: | ---: | ---: |
| cold FCP | 992 [982–1002] ms | 997 [978–1010] ms | 1.005x |
| tap to transport ACK | 2561 [2551–2571] ms | 2061 [2059–2080] ms | 0.805x |
| tap to second native frame | 2585 [2574–2597] ms | 2086 [2082–2113] ms | 0.807x |
| main apply | 1012 [1008–1016] ms | 279 [277–280] ms | 0.276x |
| main instrument wall | 1059 [1055–1063] ms | 326 [325–328] ms | 0.308x |

This result exercises lazy event promotion plus run retirement. Equal commands,
equal state, and lower interaction wall rule out moving the deleted startup loop
into the first full-tree teardown.

## Web mechanism cross-check

The exact 1,000-row profile A/B reproduced the representation switch in all five
samples. Both cells matched one manifest and compared only the 28 shell nodes.

| Web receiver measure | expanded-ownership control | retained-run candidate |
| --- | ---: | ---: |
| `prepareLynxHostBatch` median | 4.7 ms | 4.8 ms |
| `prepared.apply()` median | 12.5 ms | 0.5 ms |
| program ownership | 0 runs / 0 hosts | 1 run / 4,000 hosts |
| ownership fallback | `dense-run-mismatch` | none |

The page had already settled before the stage profiler's sampled adoption
window, so its aggregate adoption-window wall is zero and is not used. The
receiver phase timer and deterministic ownership counters are retained only as
a cross-engine mechanism check; native is the primary wall-clock evidence.

## Representation and correctness

The dense host store may now alias one validated `LynxProgramRun`, including a
logical host-ID stride wider than its physical program width. A run-level live
count owns all unpromoted hosts. Update, event, destroy, and fault paths promote
only the addressed host, while run release retires the remaining aliases.

Manifest comparison now precedes global per-ID auditing. IDs covered by the
matched program proof skip redundant record lookup, which otherwise recreated
all 4,000 records before ownership transfer. Ordinary shell records and every
non-matching path retain their previous validation and repair behavior.

A production-shaped regression covers a 128-row strided addressed run through
the full transport handshake, compact acknowledgement, one-row update, and
complete teardown. Existing first-tree coverage continues to exercise malformed
input, repair, sparse IDs, events, refs, aborts, close, and disposal boundaries.

## Bundle ledger and remaining gates

Exact uninstrumented production sizes:

| target | merged slice 2 | retained ownership | slice delta | slice-1 baseline | total manifest-era delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web | 594,553 B | 599,394 B | +4,841 B | 582,545 B | +16,849 B |
| Lynx | 575,777 B | 579,684 B | +3,907 B | 564,273 B | +15,411 B |

The runtime wall is fixed, but code-size debt increased. #287 therefore remains
open. Its next slice must consolidate the manifest/compaction/ownership paths,
repay the temporary shipping-bundle debt, collect forced-GC retention across
hand-over, targeted update, unmount, and close, then rerun the exact-head native
ready and first-interaction gates.

## Validation

At the report head:

- focused ownership and first-tree tests: 184/184 passing;
- full Lynx Vitest: 50 files, 855/855 passing;
- benchmark stage harness: 228/228 passing;
- full repository `pnpm typecheck`: passing across 294 workspaces;
- `pnpm sync`, formatting, and `git diff --check`: passing.

Current-head CI remains a PR gate and is not claimed by this local report.

## Raw evidence

- `evidence/native-startup-abba-1000.json`
- `evidence/native-first-clear-abba-1000.json`
- `evidence/web-profile-abba-1000.{json,md}`
