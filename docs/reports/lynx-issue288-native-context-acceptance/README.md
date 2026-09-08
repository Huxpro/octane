# Lynx issue #288: native sparse-context acceptance

## Verdict

The compiler-proved sparse deep-context path now survives the real ReactLynx
production shape: delegated native events, a collapsed template containing the
touch handler, and the stable effect installed by `useMainThreadRef`. On a
leased Android 10 `aries_10`, the fixed candidate reduces DevTool-off native
touch-to-changed-frame p50 from 347 ms to 290 ms (-16.4%) and p95 from 370 ms
to 336 ms (-9.2%). All eight paired groups win and all 32 accepted samples are
first-attempt cold launches.

The production CPU window attributes the result to background work rather than
a shifted bill: `Lynx_JS` p50 falls from 247.2 to 90.8 ms per interaction
(-63.3%), while whole-process p50 falls from 263.2 to 109.2 ms (-58.5%). A clean
native trace places the dominant change in the Lynx async JS task after the
background handler, not in the main-thread host commit.

Process-wide Android memory is also lower in every paired PSS/RSS/private group
before and after the interaction window. The Explorer SDK does not implement
`Memory.getAllMemoryUsage`, so this report does not invent per-Lynx-instance
attribution; it records the unavailable API and uses the broader process
accounting as the no-cost-transfer gate.

This closes the native/cross-thread/memory gate for the deep-context mechanism,
not all of #288. Async/Suspense/transition/rejection storm acceptance remains a
separate issue slice.

## Fixed revisions and production artifacts

- Baseline runtime: `2cca2572ef1f90133f709cb2b6ac0d63b9e5f34b`, merged PR #303,
  before sparse component-row descriptors.
- Candidate runtime: `eb054e91c79ce54d12022b4faad5aa8a0377a04f`. This is the
  committed source used to rebuild every final candidate bundle below.
- Both arms compile the same candidate fixture, compiler, Lynx transport/PAPI
  chassis, row data, styles, and direct memo component shape. Only the Octane
  runtime root differs.
- Shipping bundle SHA-256: baseline
  `3b1f2e80cf3924d00d8838523cc5ac4d84df7471edea1b2943568500bde272fe`;
  candidate
  `c0d4dd4dcbfe4c6c5be75a347c79be288ac4b284b2e9a94ef226e5803e1bdcdc`.
- CPU bundle SHA-256: baseline
  `f192ff4e988f7eeff77fcd6bd7054384fc014629ae72f444497a9b8ba4d0bcc3`;
  candidate
  `9b31a507b8dc51ba0793e1a149979d0917046c407d2f7fd9a742164dc48f973e`.
- Trace bundle SHA-256: baseline
  `4d277a57c3f7eed65270426e5193115d2f1b8e42d2d36692901abe341b116e79`;
  candidate
  `029268db0eca4dbfa1d8e42afae1693fed5c7eadf37181cb3034a15251b2554f`.

The machine-readable rollup, including file receipts and raw ordered arrays, is
[`issue288-native-context-aries10-analysis.json`](../../../benchmarks/lynx-touch-frame/results/issue288-native-context-aries10-analysis.json).
Its inputs are the checked-in
[`touch-to-frame`](../../../benchmarks/lynx-touch-frame/results/issue288-native-context-tap-frame-aries10-sparse-formal.json),
[`CPU`](../../../benchmarks/lynx-touch-frame/results/issue288-native-context-cpu-aries10-sparse-formal.json),
and
[`memory`](../../../benchmarks/lynx-touch-frame/results/issue288-native-context-memory-aries10-sparse-formal.json)
files. The analyzer uses nearest-rank p50/p95 and never removes a DNF or retry.

## Why the production path previously fell back

PR #304 retained a sparse context-to-component-row index after an accepted full
render, but the conservative transaction gate rejected the actual native page
for three independent reasons:

1. the root has a stable effect from `useMainThreadRef`;
2. the root and toolbar contain native delegated event handlers;
3. the row program can be committed in collapsed-template form while a sparse
   replay prepares the equivalent expanded logical shape.

The new transaction validates rather than ignores those owners. An effect is
accepted only when its exact previous cell is mounted, its phase is unchanged,
and its dependencies are equal. An event is accepted only when prop, type,
priority, owner, listener ID, and published handler identity all match the
committed contract. Collapsed-template event sites additionally require the
same node and slot layout. Any changed/opaque case keeps the complete fallback.

The latest handler closure is staged under the accepted listener ID. It is not
published until host acknowledgement, so an event arriving before ACK or after
rejection still reaches the last accepted closure. If the renderer classifies a
prop update as host recreation, the transaction reattaches the accepted event
listener after the recreate command. The stable effect is neither recreated nor
cleaned during the sparse update and remains owned for the eventual single
unmount cleanup.

## Independent semantic boundary

The regressions exercise user-observable behavior rather than comparing two
compiler paths:

- a real transported event toggles the provider through successive light/dark
  closures without invoking the keyed-list key or body functions;
- the stable effect mounts once, does not rerun for sparse context updates, and
  cleans once at unmount;
- a rejected transport update leaves the prior painted value and prior event
  closure active, after which another sparse update remains usable;
- a compact Lynx template mount delivers the old collapsed-template closure
  before update ACK and the new closure only after ACK;
- the sparse update still emits only the two changed host updates for the deep
  consumer, while iterable replacement takes the full three-row path.

Structural host changes, changed effects, different event topology or owner,
suspension, transitions, active boundaries, hidden content, refs, bridge roots,
and unproved compiler shapes retain the ordinary complete transaction.

## Native touch-to-changed-frame

The headline uses the unprofiled shipping bundles. Each accepted sample starts
a fresh Explorer process, runs the DevTool-off preflight, cold-loads the target,
settles for four seconds, and sends one real Android touch. A main-thread capture
handler records the native event timestamp, and the first subsequent VSYNC whose
computed native background color differs closes the sample. Platform epoch and
uptime clocks are calibrated with the Android `SystemClock` bridge.

Eight alternating ABBA/BAAB groups produce 16 samples per arm:

| metric | baseline | candidate | reduction |
| --- | ---: | ---: | ---: |
| touch-to-changed-frame p50 | 347 ms | 290 ms | 16.4% |
| touch-to-changed-frame p95 | 370 ms | 336 ms | 9.2% |
| mean | 342.0 ms | 283.7 ms | 17.1% |
| changed-frame ordinal p50 | 21 | 17 | 19.0% |
| changed-frame ordinal p95 | 22 | 20 | 9.1% |

All 32 samples have `coldLaunchAttempt: 1`, zero discarded attempts, a changed
light-to-dark pixel oracle, and thermal start/end of 35.0 °C / status 0. Paired
mean reductions are 15.7%, 13.2%, 22.1%, 5.1%, 13.2%, 7.3%, 23.6%, and 34.5%;
no pair loses.

## Production CPU and cross-thread ownership

The CPU runner uses a fresh DevTool-off process per window and samples Linux
`/proc/<pid>/task/*/stat` user+system ticks around 25 real native touches. Four
alternating ABBA/BAAB groups yield eight windows per arm and 200 interactions
per arm. Every window observes exactly 25 `PageTouchEvent` records and the
expected final native pixel.

| CPU ms / interaction | baseline p50 / p95 | candidate p50 / p95 | p50 / p95 reduction |
| --- | ---: | ---: | ---: |
| `Lynx_JS` | 247.2 / 258.8 | 90.8 / 97.6 | 63.3% / 62.3% |
| whole process | 263.2 / 275.6 | 109.2 / 131.2 | 58.5% / 52.4% |
| `m.lynx.explorer` main | 10.4 / 10.8 | 10.8 / 28.4 | -3.8% / -163.0% |
| `RenderThread` | 1.6 / 2.4 | 2.0 / 2.4 | -25.0% / 0.0% |

All four paired `Lynx_JS` groups win by 62.2%–64.0%. The main-thread p95 includes
two visible candidate outliers (19.6 and 28.4 ms/interaction); they are not
trimmed. Even with them included, whole-process p95 improves by 52.4%, so the
background saving is not transferred into total process CPU. RenderThread p95
is unchanged at 2.4 ms/interaction.

## Clean native trace attribution

Trace absolute latency is diagnostic because tracing and DevTool are enabled;
it is not mixed into the unprofiled headline. The two arms were captured
sequentially on the same leased device in the same measurement window. Each arm
starts from a full Explorer restart, trace start, one target `LynxViewShell`,
four-second settle, one real touch, and the same changed-pixel completion
marker. Both traces parse successfully and report `dataLossOccurred: false`.

- Baseline trace: 3,367,525 B, SHA-256
  `6c0490efb491587cf00bc98db6d22d6b3d5169172882bd3b2ee5c32998c65f0e`.
- Candidate trace: 3,309,131 B, SHA-256
  `e7b9fb2f490434bd4215717be66d728c0c078f2c936815b43f41936cf354a16c`.

The marker-bounded critical path is:

| segment | baseline | candidate | result |
| --- | ---: | ---: | ---: |
| MTS input → BTS handler | 162.991 ms | 197.137 ms | +34.146 ms |
| BTS handler → changed VSYNC | 262.914 ms | 174.393 ms | -33.7% |
| MTS input → changed VSYNC | 425.904 ms | 371.530 ms | -12.8% |

The exact anchors are `Issue288::baseline::mts-input [slice id: 284583]`,
`TouchEventHandler::FireEvent [slice id: 284586]`,
`Issue288::baseline::bts-handler [slice id: 287944]`, and
`Issue288::baseline::changed-vsync [slice id: 289345]`; candidate anchors are
`Issue288::candidate::mts-input [slice id: 283188]`,
`TouchEventHandler::FireEvent [slice id: 283191]`,
`Issue288::candidate::bts-handler [slice id: 286643]`, and
`Issue288::candidate::changed-vsync [slice id: 288001]`.

The dominant background async task is
`JsTaskAdapter::SetTimeout [slice id: 287959]` at 231.110 ms versus
`JsTaskAdapter::SetTimeout [slice id: 286658]` at 136.579 ms (-40.9%). This is a
Lynx async scheduling slice, not a browser timer. Its parents are
`MessageLoop::FlushTasks [slice id: 287958]` at 232.629 ms and
`MessageLoop::FlushTasks [slice id: 286657]` at 145.075 ms.

The main host work is essentially flat:
`EventTarget::DispatchEvent [slice id: 288095]` at 29.435 ms versus
`EventTarget::DispatchEvent [slice id: 286749]` at 28.393 ms, and
`FiberFlushElementTree [slice id: 288111]` at 5.831 ms versus
`FiberFlushElementTree [slice id: 286766]` at 5.877 ms. Candidate input reaches
the background handler 34.1 ms later yet still paints 54.4 ms earlier, which
isolates the win to post-handler framework work. Whole-trace event counts and
file sizes are not compared because the capture durations differ; only the
explicit marker-bounded update windows are compared.

The raw traces and query evidence are in
[`issue288-native-traces-final`](../../../benchmarks/lynx-touch-frame/results/issue288-native-traces-final).

## Process memory and limitation

Memory uses the same shipping bundles, eight fresh processes per arm, four
alternating ABBA/BAAB groups, and a four-second settle. Each process is sampled
through `/proc/<pid>/smaps_rollup`, `/proc/<pid>/status`, and Android `dumpsys
meminfo`; then it receives 25 real touches, settles again, and is sampled a
second time. The initial `dumpsys meminfo` collection sits between the two
snapshots for both arms, so post-interaction values are compared only to the
matching phase in the other arm, not subtracted from the initial sample as an
allocation ledger.

| process memory | baseline p50 / p95 | candidate p50 / p95 | p50 / p95 reduction |
| --- | ---: | ---: | ---: |
| settled PSS | 194,087 / 201,253 KB | 183,040 / 186,293 KB | 5.7% / 7.4% |
| settled RSS | 293,652 / 301,052 KB | 282,792 / 286,316 KB | 3.7% / 4.9% |
| settled private | 180,436 / 187,376 KB | 169,088 / 172,252 KB | 6.3% / 8.1% |
| post-interaction PSS | 178,742 / 181,248 KB | 166,232 / 168,889 KB | 7.0% / 6.8% |
| post-interaction RSS | 278,288 / 281,460 KB | 265,616 / 268,640 KB | 4.6% / 4.6% |
| post-interaction private | 165,052 / 167,400 KB | 152,548 / 155,192 KB | 7.6% / 7.3% |

Every PSS, RSS, and private-memory pair wins in both phases. Settled native heap
allocation improves 124,954 / 129,069 KB to 113,719 / 114,847 KB. After the
interaction window its p50 improves 77,396→72,614 KB, but one candidate sample
at 78,676 KB makes native-heap p95 1.34% worse than baseline's 77,635 KB. That
outlier remains in the raw result. Post-interaction Dalvik is effectively flat:
7,218 / 7,242 KB versus 7,239 / 7,243 KB.

`Memory.getAllMemoryUsage` returns `Not implemented` on this Explorer SDK
0.0.1, including the documented global session `-1`. Therefore instance-level
element/view/MTS/BTS byte attribution and collection-status fields are
unavailable. The process result is broader and demonstrates that the measured
optimization does not increase total native process memory, but it is not
presented as a Lynx-instance leak proof. #291's 20-cycle clear/recreate and
after-clear retained-heap acceptance remains separate.

## Bundle debt and verification

The shipping bundle grows from 574,096 B / 203,546 B gzip to 587,937 B /
207,435 B gzip: +13,841 B raw (+2.41%) and +3,889 B gzip (+1.91%). This is the
aggregate delta from the #303 baseline through the already-merged #304 sparse
descriptor and this native event/effect acceptance slice; it is not attributed
solely to the small gate extension in this PR.

Local gates for the fixed implementation include:

- 112 focused transported Universal/Lynx tests passing after the event/effect
  regressions;
- `tsrx-tsc` for all 12 benchmark fixture files and `tsgo` for the changed
  Octane runtime;
- the full repository `pnpm typecheck`;
- checked formatting, `git diff --check`, and a clean `pnpm sync` generation;
- deterministic rebuilds matching all reported shipping/CPU/trace hashes.

Exact-current-head repository CI remains the merge authority. The issue stays
open after this slice for the remaining async storm and final M2 acceptance
crosswalk.
