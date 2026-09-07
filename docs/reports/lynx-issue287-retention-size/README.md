# Lynx issue #287, slice 4: retention and bundle-debt closure

## Verdict

The two gates left open by slice 3 now pass. Compact first-tree ownership has a
forced-GC lifecycle record from hand-over through one sparse update, background
unmount, and main-controller close; live ownership reaches exactly zero. The
uninstrumented production bundle also repays all manifest-era size debt and is
smaller than the slice-1 baseline in both graphs.

The exact-head Android rerun preserves the 1,000-row ready state with a 3 ms
main-thread apply and clears it with the same 7,000-command teardown shape used
by the earlier mechanism control. No sample timed out, crashed, enabled DevTool,
crossed the thermal gate, or needed a retry. Together with the prior slice-2 and
slice-3 A/B records, these results close the local acceptance work for #287.
Current-head PR CI remains a merge gate and is not claimed by this report.

## Revisions and controls

- slice-1 size baseline: `99576f6ea7196d79a8f71e0c93e002e986584267`
- merged slice-3 base: `6bbfd21f0d9d66722b58ed47c1d8b0af4e4bb719`
- product implementation: `e5372b3faffe28c82922a1e855e4386f6e021a4d`
- exact measured head: `7d9b6707d5e36d3e6440971d464e5d11192f9fa8`
  (the second commit only keeps the native benchmark probe on the single render
  branch; the uninstrumented bundle sizes remain unchanged)
- Web retention: Lynx for Web 0.22.2, Chromium 149.0.7827.55, five fresh pages,
  explicit V8 and CDP garbage collection at every boundary
- native: Android 10 `aries_10`, Lynx SDK 4.0 / app engine 3.9, DevTool disabled,
  cold launch per sample, temperature at most 35 C, thermal status 0
- native evidence is an exact-head single-cell release gate. The earlier
  expanded-ownership versus retained-run A/B remains the causal mechanism
  comparison; no ratio is manufactured across separate device windows here.

## Forced-GC ownership lifecycle

The profiled 1,000-row program owns 4,000 physical hosts. One selected-row
update promotes exactly one host to ordinary storage while the other 3,999 stay
under the compressed run. Background unmount releases the run and every host;
closing the main controller then releases another 3.25 MiB of renderer heap.

| phase | used heap median (range) | live runs | live hosts | promoted hosts |
| --- | ---: | ---: | ---: | ---: |
| fresh | 1.88 MiB (1.88–1.89) | n/a | n/a | n/a |
| hand-over | 7.99 MiB (7.99–8.02) | 1 | 4,000 | 0 |
| sparse update | 8.01 MiB (8.00–8.03) | 1 | 3,999 | 1 |
| background unmount | 7.93 MiB (7.93–7.96) | 0 | 0 | 1 |
| main close | 4.68 MiB (4.68–4.68) | 0 | 0 | 1 |

The 2.80 MiB fresh-to-close difference is the initialized Lynx Web Core/page
high-water mark, not attributed to adoption. The ownership counters are the
direct retention invariant: all five samples read 1/4,000, then 1/3,999, then
0/0. The heap decrease on close corroborates teardown but is not relabelled as
proof for an object class the aggregate heap API cannot identify.

## Shipping bundle ledger

Both cells are the same 1,000-row production-order main-thread-program build,
without profile or benchmark instrumentation.

| target | slice-1 baseline | exact-head candidate | delta | versus slice 3 |
| --- | ---: | ---: | ---: | ---: |
| Web | 582,545 B | 579,114 B | -3,431 B (-0.59%) | -20,280 B |
| Lynx | 564,273 B | 560,035 B | -4,238 B (-0.75%) | -19,649 B |

Bundle identities:

- baseline Web: `349ee799dc274fab6ce7e1b3949f87ff11ff5d4b3461691f53feb9cf5109c72a`
- candidate Web: `218adcb5f37353a47b0cf3b1d42c724b477cfdeb5a60c79659dc29aa7b57a68e`
- baseline Lynx: `4c72e87ba46701bb72de3ee4c5518852c7db16e1c31cfea9e88e7d266f5a9a0c`
- candidate Lynx: `2875ca60e84772d1b9223507bf25e081b27e96d0c2d5b843654e3e0371e93e62`

The recovered bytes are runtime error prose duplicated across the main and
background graphs. Rspeedy now injects one build-time diagnostic-mode constant
into every owned graph. Development bundles and direct source execution retain
the full message at its original throw/report site; production bundles retain a
stable `Octane Lynx OLnnn` identifier. The define folds at each call site, so a
shipping bundle carries neither the prose nor a runtime diagnostic branch.

All 483 identifiers from `OL001` through `OL483` are unique and complete. A
package-boundary regression pins that property, and the production build test
proves a known full transport message is absent while compact identifiers are
present. Searching an identifier in `packages/lynx/src` recovers the full
development message and the local invariant that raised it.

## Exact-head native ready and first Clear

Every startup sample produced the same 1,000 rows, IDs `1/2/3/999`, label
`pretty red table`, no selection, 69 compact commands, a 203-byte compact ACK +
complete reply, one ownership run, 4,000 owned hosts, and no fallback.

| native startup measure | exact-head result |
| --- | ---: |
| cold FCP | 1012 [1010–1030] ms |
| background start to transport ACK | 582 [574–583] ms |
| background start to second frame | 605 [602–613] ms |
| main instrument wall | 4 [3–4] ms |
| `prepared.apply()` | 3 [3–3] ms |

The first Clear ran only after adoption settled. Each sample proved the populated
pre-state and exact zero-row post-state, issued 2,000 event removals, 1,000 tree
removals, and 4,000 host destructions, and ended with zero live runs and hosts.

| native first Clear measure | exact-head result |
| --- | ---: |
| cold FCP | 1005 [1002–1016] ms |
| tap to transport ACK | 2103 [2091–2134] ms |
| tap to second frame | 2133 [2110–2159] ms |
| main instrument wall | 337 [334–339] ms |
| main apply | 290 [287–291] ms |

The exact-head observations reproduce the slice-3 representation result and
remain far below its causal expanded-ownership control (4,072 ms startup apply,
1,012 ms Clear apply). Those historical values are context only; the accepted
causal ratios remain the same-window A/B published with slice 3.

## Correctness and local gates

- full Lynx Vitest: 50 files, 856/856 passing;
- full Rspeedy plugin Vitest: 8 files, 71/71 passing;
- benchmark stage harness: 228/228 passing after the native-probe correction;
- Lynx source, testing, and typetest TypeScript projects: passing;
- full repository `pnpm typecheck`, including all workspace packages, examples,
  and benchmark typechecks: passing;
- `pnpm sync`, scoped formatting, stable-code completeness, and
  `git diff --check`: passing.

## Raw evidence

- `evidence/issue287-retention-final-1000.{json,md}`
- `evidence/issue287-final-native-startup-1000.json`
- `evidence/issue287-final-native-first-clear-1000.json`
