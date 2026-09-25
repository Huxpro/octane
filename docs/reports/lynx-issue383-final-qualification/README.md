# Lynx R11 final qualification: NO-GO

This is the release decision for roadmap issue #383 and the final-candidate
handoff from #382. The decision is **NO-GO**: do not switch the Lynx default and
do not remove the Universal compatibility path. The Android candidate has a
large-batch creation regression, the Native list lane produced no valid sample,
and the required iOS, AB/BA tail-latency, memory/GC, low-end no-JIT, and device
bytecode evidence is absent. These are release blockers, not documentation-only
follow-ups.

The existing whole-entry product selection and fail-closed Universal fallback
therefore remain unchanged. No post-switch build or old-path retirement was run
because the pre-switch gate failed.

Post-decision work implemented the only SDK-supported architecture identified
below as an explicit experimental option: a compiler-proved **whole-root**
Element Template owner. It does not change the NO-GO decision or the default,
but it replaces the earlier unbounded ordinary-Element creation path for the
eligible opt-in slice and adds a narrowly qualified Android safety boundary.

## Current-head status (2026-09-25)

The frozen campaign below still describes code candidate `b62a642a1`, not the
newer local product line. The later product head passed complete Lynx and
Rspeedy package suites and reduced an ordinary structural application's decoded
background program by 6,794 raw / 2,080 gzip bytes through compiler-proved
feature pruning; its decoded main-thread program stayed byte-identical. See the
[R10 current-head addendum](../lynx-issue382-release-candidate/README.md#post-candidate-current-head-graph-requalification).

A qualified leased Android client subsequently became available for one narrow
exact-head window. It completed 10 AB/BA pairs for the 1,000-row create cell,
but no iOS client or registered fresh-process memory lane became available.
That result closes one configuration-level Android latency cell only; it cannot
stand in for memory/GC, no-JIT, native list, device bytecode, cross-framework,
or the powered full matrix. The release decision therefore remains **NO-GO**,
and neither the default switch nor old-path retirement is authorized.

The latest authoritative #383 correction invalidates the earlier `6.5655x`
Element Template/latest-upstream Native-heap ratio because timeout recovery had
restarted Explorer before that memory sample. The corrected screen preserved
the timed-out page: nine eligible pairs all favored Element Template, with a
Native-heap-allocation paired geometric mean of `0.9023745x`, but pair 7 lost
the CDP channel before semantic census, leaving the required 10-pair cohort
incomplete. A separate six-pair comparison against the merged automatic owner
still measured `1.149152x`; a real-device shared-row-values experiment measured
`0.998643x` Native heap and `1.008772x` creation latency, rejecting per-row
JavaScript slices as the remaining owner.

The current native-owner reduction therefore reuses the already-versioned
paired feature proof. When a one-shot production graph proves that Activity,
retained try/Suspense boundaries, and transitions are absent, encoder metadata,
synchronous first-screen creation, and background-frame creation omit the
synthetic root `hidden` slot. Source-safe or visibility-capable graphs retain it
unchanged, and an impossible specialized VIS fails closed. Unit tests assert
the reduced slot arity and metadata shape, and a real production Element
Template build retains the structural feature module. This proves one fewer
native attribute slot per live template instance; it does not establish the
Native heap delta without a new qualified-device cohort.

The exact-head Android follow-up at `54f2ac806` compared the automatic ordinary
compiled-program owner with the compiler-proved structural Element Template
owner in one cold-launch AB/BA window. All 20 samples were accepted on their
first attempt, retained the exact 0-to-1,000-row state oracle, kept DevTool
disabled, and reported no errors. The Native input-to-second-frame median moved
from 585.5 ms to 524.5 ms; Element Template won all 10 pairs, with a paired
median delta of -64 ms. Compact main-thread frame application through ACK and
complete moved from 485.5 ms to 424.5 ms and also won all 10 pairs, with a
paired median delta of -70 ms. The compact frame payload median was effectively
unchanged, so transport bytes do not explain the result.

This is a complete-configuration comparison, not a single-primitive causal
claim: both cells ran on Lynx SDK 4.1, but the ordinary bundle declares engine
3.9 while the current Element Template encoder declares 3.2. The uninstrumented
production Element Template bundle is also 16,678 raw bytes (+6.34%), 6,672
gzip bytes (+7.24%), and 5,676 Brotli bytes (+7.13%) larger. The result is
positive evidence for this admitted app shape, while the engine-version
difference, bundle cost, missing native memory cohort, and broader matrix remain
explicit acceptance inputs.

The same immutable structural Element Template product bundle later completed
five fresh Android 10 cold launches of the registered 10k mutation sequence:
create, update every tenth row, select the second row, swap rows 2 and 999, a
50-tick update storm, a 30-tick select storm, and remove the current second row.
All 35 operations passed on their first attempt. Every operation carried one
Native ContextProxy ACK, one `complete` message, and two native frames; the
storms additionally carried all 50/30 tick ACKs and render barriers. Their
latest main versions were exactly 55 and 85 in every run, proving that the
runner attributed the final storm commits instead of consuming the next input.

The Native input-to-second-frame medians were 21,717 ms create, 220 ms update,
43 ms select, 75 ms swap, 8,792 ms for all 50 update ticks, 1,436 ms for all 30
select ticks, and 145 ms remove. Update-storm first feedback was 177 ms median;
select-storm first feedback was 19 ms. Pure mutations retained the populated
owner census exactly. Remove changed it by precisely one live handle, two
listener slots, and four retained host references, all represented by one
recycled handle and four recycled host references. This closes the narrow 10k
semantic/owner gate for those operations at `n=5`; it is one serialized
single-cell cohort, not a powered AB/BA comparison or 100 independent inputs,
and it does not close append, list, process-memory/GC, or platform coverage.

## Frozen cohort

The cohort was last checked against the live remotes at 2026-09-14 02:55:01
UTC. Both upstream and the peer source still matched the commits used by the
artifacts.

| Role | Source | Commit |
| --- | --- | --- |
| R11 release candidate | `Huxpro/octane`, this branch | `b62a642a187298fee10a22329dfe906966efd8f7` |
| Published `new-lynx` tip at qualification | `Huxpro/octane:new-lynx` | `7a523bf20d04578c39fe0b5fe532cdef6dab3e9e` |
| Latest upstream comparator | `octanejs/octane:main` | `8e5ca22a6e17582b4293232406a2c0420509f4a4` |
| ReactLynx/VueLynx comparator source | `Huxpro/vue-lynx:feat/unified-benchmark-framework-ui` | `0da216caf3b474347423a8cd694d5449fa4e4215` |
| Benchmark runner base | `Huxpro/lynx-js-framework-benchmark` PR 66 checkout | `429c9f958ed32157078c2297300a1911df796589` |

The runner checkout changed only the frozen campaign label, candidate pin, and
upstream pin (plus the matching contract assertions); the binary diff SHA-256
is `1b4d2618bc9e36cf001ee7329ed261a4751e57a69a95d4f43102c22347bce3ef`.
The result receipts independently hash the adapter, runner sources, manifests,
and every served bundle, so generated-artifact identity does not rely on this
description.

The formal Native cohort contains eight entries: candidate, latest upstream,
ReactLynx default, ReactLynx + Element Template, Vue Vapor default, Vue Vapor +
IFR, Vue VDOM default, and Vue VDOM + IFR + Element Template. M3 entries were
kept as archive-only inputs and were not mixed into the scorecard.

## Device and input receipt

The Android run used one leased ByteDance `aries_10` device on Android 10, eight
cores, through the direct DevTool transport. Raw ADB serials do not cross the
evidence boundary; the stable serial digest is
`692a7527b3d158f8057196b819af64e93d4af1ead4a1ff5ab0e46f8e60fbdd60`.
All observed battery-temperature readings were 35 C and thermal status remained
0.

The installed official Lynx Explorer 4.1.0 APK was 173,293,606 bytes with
SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`.
The connector receipt freezes `@byted/agent-lynx@0.14.12`,
`@byted-lynx/devtool-connector@0.15.5`, and
`@byted-lynx/bdc-client@0.4.5`; its combined package-tree SHA-256 is
`aa891c81ffb5d96e353881dcf885009739f1bafe2d2aaa6a26ee2e94aab56199`.

Table/startup campaign ID `3afdd19acf016876` used device cohort
`b04046c85d4128a8`, matrix contract
`08d23cf1ab5940bd8a96b7e927850484e1be481d5e9dafd18a0ad3d5d10da3d8`,
and input receipt
`31529ef9edc32df4db35eed6a3b3e66aacafc5326e0859bcff59805669378fab`.
Native-list campaign ID `e6b1359942e543f9` used device cohort
`31f9f55f4cd4d82c`. Lease handoffs retained the same serial digest and were
validated against the full device cohort before resume.

## Android table and startup result

The uninstrumented production run covered 184/184 declared records: 105
measured, 56 DNF, and 23 capability-unsupported. The result is a complete
checkpoint. Table cells used five repetitions; startup cells used three. Native
table interactions were triggered by actual device taps and measured from the
native input handler to the second native frame, with semantic pre/post-state
checks.

The creation result alone blocks the default switch:

| Entry | 1k | 3k | 5k | 10k | 20k | 30k |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Octane candidate | 830 | 3,471 | 7,657 | DNF | DNF | DNF |
| ReactLynx default | 140 | 390 | 671 | 1,332 | 2,692 | 4,219 |
| ReactLynx + ET | 209 | 557 | 879 | 1,869 | 3,727 | 5,681 |
| Vue Vapor default | 320 | 932 | 1,501 | 3,360 | 6,405 | 9,952 |
| Vue Vapor + IFR | 315 | 980 | 1,597 | 3,466 | 6,756 | 10,482 |
| Vue VDOM default | 299 | 935 | 1,578 | 3,232 | 5,961 | 9,456 |
| Vue VDOM + IFR + ET | 317 | 947 | 1,540 | 3,148 | 6,014 | 9,139 |

Values are median milliseconds, not a formal AB/BA aggregate. The candidate is
already 5.9x slower than ReactLynx default at 1k, 11.4x slower at 5k, and 5/5
attempts at each of 10k, 20k, and 30k exceeded the 240-second operation timeout.
Every peer completed all five creation attempts at all six scales. This is a
candidate large-batch creation/scaling failure even though the run is too small
to satisfy the final confidence-interval gate.

The candidate did complete the 1k follow-up actions: replace 987 ms, append-1k
1,424 ms, update-every-tenth 49 ms, select 30 ms, swap 43 ms, and remove 43 ms.
Its rows-0 startup medians were 110 ms to compact transport acknowledgement and
134 ms to the second frame; rows-1k was 936/969 ms. Rows-10k and rows-30k
startup were DNF. These smaller successes do not offset the required creation
cells.

The latest upstream build intentionally had no patched
`lynx-native-bench-v2` producer, so all 23 of its records were classified as
capability-unsupported rather than silently compared. At 10k, steady-operation
cells for the candidate and all peers were also lost to initialization or
DevTool transport failures; 30k startup failed across the runnable peers. The
result recorded 16 recovered transport disconnects before the remaining DNF
cells. Those lane-wide failures are measurement limitations, not evidence that
the frameworks tie.

## Native-list result

The runner visited all 32 Native execution cells (four per entry: startup at 1k
and 10k, recycle at 10k, and fling at 10k), 20 repetitions each. All 640
physical attempts failed, so all 80 emitted metric records have `n=0` and
`dnfCount=20`. The coverage assertion correctly exited non-zero with 32 failed
Native cells and left `checkpointComplete=false`; this means “fully visited but
failed qualification,” not an interrupted successful campaign. The additional
32 Web cells in the coverage contract are `unscheduled` because this was a
Native-only run; Web is not used to fill Native evidence.

Failure ownership is deliberately separated:

- Candidate: 60 attempts found no Native list viewport; 20 found a visible cell
  with an undefined `item-key`.
- Latest upstream: 37 attempts found no viewport and 43 timed out enabling the
  CDP runtime.
- Both ReactLynx variants: each had 56 undefined-`item-key` failures and 24 CDP
  runtime-enable timeouts.
- The four Vue variants lost the DevTool channel after the first Vue capture;
  their remaining attempts failed opening the page.

Because an undefined stable key reproduces outside Octane and the transport
subsequently closes across the Vue entries, the list lane is not a valid
cross-framework performance comparison. It also cannot establish candidate
list correctness, recycling, fling smoothness, or wire cost. A repaired
fixture/observer and stable DevTool lifecycle are prerequisites for a rerun.

## Release-gate disposition

| Gate inherited from #290/#291/#383 | Result | Evidence or gap |
| --- | --- | --- |
| Android output, identity, events/effects, real input | **Partial / fail** | Current-product structural create cells at 1k, 3k, and 5k passed their paired semantic samples and native taps. Fresh ET-only 10k create and create-clear-recreate cohorts each passed 5/5 cold starts; a separate 5/5 10k sequence passed update-every-tenth, select, swap, 50/30-tick storms, and remove with exact state, ACK, two frames, and strict ownership census. The ordinary owner still crashes at the JNI global-reference ceiling, while append, higher-scale startup, and all list cells remain failed or unqualified. |
| Latest upstream strict win, weighted geometric mean, CI upper bound `< 1.0` | **Inconclusive / fail** | Upstream lacks the Native producer; no valid full scorecard exists. |
| Peer strict win and per-cell non-inferiority CI upper bound `<= 1.05` | **Fail** | Candidate creation is materially slower and becomes DNF at 10k while every peer completes. |
| At least 10 independent AB/BA pairs | **Partial** | The current-product ordinary/structural Element Template 1k, 3k, and 5k create cells each completed 10 pairs; the 10k mutation sequence is a single-cell `n=5` correctness cohort, and the 10k+ performance, memory, list, upstream, and peer matrix has not completed. |
| Ready/first-tap/steady p95 from at least 100 valid interactions | **Missing** | The mutation cohort has five serialized sequences / 35 registered inputs, not 100 independent samples; list has none. |
| Peak/settled/after-clear heap and 20 create-clear-recreate GC cycles | **Missing** | No current-candidate Native memory campaign was completed. |
| Native list reuse, recycle, fling, and stable identity | **Fail** | 640/640 Native attempts DNF across the lane. |
| Android no-JIT and retained low-end device | **Missing** | The Android 10 cohort is recorded, but a no-JIT policy and a separate retained low-end lane were not established. |
| iOS correctness/performance, separately reported | **Externally blocked** | Qualification host is Linux x86_64 and has no `xcrun`/Simulator or leased iOS device. Android cannot substitute. |
| Native bytecode/chunk-load and bundle budget | **Incomplete** | R10 records source/encoded/gzip/Brotli inventories; device VM bytecode and native chunk-load latency remain unmeasured. |
| Framework self-time near the platform floor | **Missing** | No current-candidate phase-ablation/profile campaign attributes the critical path. |
| Default build rerun and old-path retirement | **Not attempted** | Preconditions failed; changing the default would violate the release contract. |

Historical #291/M4 and earlier Web/profile reports remain useful diagnostic
context, but a new release-candidate head and a newer upstream commit invalidate
them as final qualification. They are not counted as R11 passes.

## Evidence

- [`android-native-table-startup.json`](evidence/android-native-table-startup.json)
  is the 184-record table/startup result; SHA-256
  `85ee045fd06f8ffc061f2c23a1e3ddf93ea6b889245d77a4341e07a7d110fbb1`.
- [`android-native-list.json`](evidence/android-native-list.json) is the failed
  80-record list result; SHA-256
  `c4e2065aa51ff629d4c0860b3100ad5dbadbf24e1fe3be1d947f7b4d106d6a89`.
- [`android-structural-element-template-create1000-abba.json`](evidence/android-structural-element-template-create1000-abba.json)
  is the sanitized exact-head 10-pair ordinary/structural configuration record;
  SHA-256
  `459f88ef8244499e38733b53e3f89b733c8bbd2853caafb27c366df1bc539df4`.
- [`android-current-head-structural-element-template-create1000-abba.json`](evidence/android-current-head-structural-element-template-create1000-abba.json)
  is the sanitized current-head 10-pair cell-gate record on
  `be7615df441519a99e7478d951a8f494feed6af4`; SHA-256
  `17d4576f488a30f4fca089c87ecce71a57352ba156748c69bbfbcc2449a143d3`.
- [`android-current-head-structural-element-template-create-scale.json`](evidence/android-current-head-structural-element-template-create-scale.json)
  is the sanitized current-product 3k/5k ten-pair continuation, ordinary 10k
  native-capacity failure, and structural ET 10k stability result at runner head
  `5c571c70ec7bd052b2c6d59ed1004bf06ff22ccc`; SHA-256
  `279f04381513836afd151e5558664315d3a32dce92210f935533f5f3f3201325`.
- [`android-current-head-structural-element-template-create10000-et-only.json`](evidence/android-current-head-structural-element-template-create10000-et-only.json)
  is the sanitized clean-device structural ET-only 10k five-sample cohort;
  SHA-256
  `01137d3243d23025dce498d2d59bafbcbf5e7b123248bed5efd4d2a5365641f3`.
- [`android-current-head-structural-element-template-create10000-lifecycle.json`](evidence/android-current-head-structural-element-template-create10000-lifecycle.json)
  is the sanitized five-sample 10k create-clear-recreate lifecycle cohort;
  SHA-256
  `d99bf205ef6cab2165a900f689d7660119a5e71ff680cdcf3470136c5be9fecd`.
- [`android-current-head-structural-element-template-10000-mutations.json`](evidence/android-current-head-structural-element-template-10000-mutations.json)
  is the sanitized five-sample 10k registered mutation-sequence cohort;
  SHA-256
  `a33d81f9bb1c8ef666a6aa189f84febc0dee1ad878ce5a239fbdd70bfe1b193c`.
- [`../lynx-issue382-release-candidate/README.md`](../lynx-issue382-release-candidate/README.md)
  records the source/build, external-consumer, semantic, graph-retention, and
  bundle inventory qualification inherited from R10.

Both raw result files retain DNF records, per-repetition failures, served bundle
hashes, source/manifests receipts, device/thermal metadata, lease-chain hashes,
and exact runner arguments. They contain only the one-way serial digest, not the
raw leased serial.

## Post-decision owner investigation

The first framework-owned hypothesis was that the compact program store's
repeated `insertBefore(parent, root, null)` tail attachment made Native scan an
ever-growing sibling run. Commit
`b2a50ae0873b2b4be40fde4f5d4b9bdf18b137d6` selected the engine's native
`__AppendElement` primitive for that exact case, retained anchored insertion,
and passed the full Lynx project suite. A fresh production/automatic build on a
new lease then measured create medians of 780 ms at 1k, 3,475 ms at 3k, and
7,930 ms at 5k (five valid samples each). Relative to the qualifying candidate
above, those ratios are 0.94x, 1.00x, and 1.04x. This is no repeatable
end-to-end improvement and does not change the superlinear shape.

The 10k cell was stopped rather than spending another five 240-second timeout
windows after the three lower scales had already falsified the hypothesis. The
experiment was reverted by `2c7bf2163`; it is not part of the candidate and no
performance claim is attached to it. A second source-only diagnostic replaced
per-handle `Map` ownership with a cached paged table and measured 815 ms at 1k,
also ruling out the instance index as the leading owner. That uncommitted
ablation is deliberately not retained as release evidence.

[`android-native-tail-append-diagnostic.json`](evidence/android-native-tail-append-diagnostic.json)
is the exact three-cell source checkpoint for the clean tail-append commit;
SHA-256
`5202c8b1fb244646ac103960c66d67add1d177ece61645bd2e5d38712358394b`.
It is explicitly a partial diagnostic (`checkpointComplete=false`), not a
publishable campaign. Together with the earlier #278 attribution, it narrows
the remaining owner to the generated Native creation/application primitive
sequence rather than transport, codec, root-tail selection, or handle lookup.

A final source experiment tried replacing later fixed-shape run instances with
Lynx's native deep `__CloneElement`, recovering descendants through
`__GetChildren`, and overwriting every inherited dynamic value and event. The
production rows-0 bundle reached the first 1k create action, then Explorer 4.1
terminated with `SIGSEGV` before any timing or semantic sample could be
recorded. Immediately before the fault, Lynx DevTool reported null inspector
metadata for the cloned elements; the top two native frames were in
`liblynxdevtool.so`. The run was stopped, the device was disconnected and
released, and all six source/test edits were reverted. A passing fake-PAPI unit
model is therefore insufficient evidence for this SDK primitive, and no clone
path is retained.

[`android-native-clone-diagnostic.json`](evidence/android-native-clone-diagnostic.json)
records the exact candidate bundle, lane, thermal preflight, requested matrix,
sanitized lease identity, crash signature, cleanup, and rejection decision. It
contains no completed benchmark record and makes no performance claim; SHA-256
`937195b92ac5fbfd10fe811edf961cd2f50d356fb69669608cfd0326bb8824be`.

A final PAPI phase-ablation run compared the clean `339107836` production
bundle with five deliberately incomplete diagnostic bundles in one device
session. The clean baseline reproduced the release result at 819 ms versus 830
ms in the formal campaign. Each cell has five accepted samples and the same
native-input-handler-to-second-native-frame boundary.

| 1k create variant | Median | Difference from clean baseline |
| --- | ---: | ---: |
| Clean production baseline | 819 ms | - |
| No repeated-run event registration | 693 ms | -126 ms (-15%) |
| Complete subtrees, no root attachment | 378 ms | -441 ms (-54%) |
| Full values/events, no three internal attachments | 358 ms | -461 ms (-56%) |
| Four detached host creates, no values/events/internal attachments | 207 ms | -612 ms (-75%) |
| One root create only | 189 ms | -630 ms (-77%) |

The last five bundles intentionally violate visual output and are attribution
probes only. Their medians are not additive cost accounting: removing an
attachment changes later materialization and layout work. Two conclusions are
nevertheless stable across the controls. First, adding three detached host
creates changes the median by only 18 ms, so `__CreateElement` call count is not
the leading owner. Second, independently removing root attachment or internal
child attachment removes more than half of end-to-end latency. The remaining
owner is therefore native subtree integration/materialization and its layout
consequences, with event registration a smaller but material secondary cost.
This also explains why swapping tail-append primitives and handle storage did
not change the scaling curve: neither reduced the number of fully materialized
trees.

[`android-native-papi-phase-ablation.json`](evidence/android-native-papi-phase-ablation.json)
is the exact six-cell partial diagnostic; SHA-256
`9331d31f67d0d10139e5765a3c4fe0de413b8c839180a50f25389863229b434a`.
It contains the production baseline and all control samples, bundle/input
receipts, thermal readings, and only a one-way serial digest. It remains
`checkpointComplete=false` and is not a publishable benchmark campaign.

## Element Template feasibility boundary

The SDK-supported compile-time boundary was checked against the latest
`lynx-family/lynx-stack` source at commit
[`2b837edbf640587be59211ad146a764a1703851b`](https://github.com/lynx-family/lynx-stack/tree/2b837edbf640587be59211ad146a764a1703851b)
and the official
[`experimental_useElementTemplate`](https://lynx.bytedance.net/3.8/api/rspeedy/react-rsbuild-plugin.pluginreactlynxoptions.experimental_useelementtemplate.html)
option. The public option only enables the feature. The source establishes the
actual contract used for this architecture decision:

- The transform emits per-module template records with a `templateId` and a
  compiled tree. Static attributes remain in that tree, while dynamic
  attributes/events and structural children become indexed attribute and child
  slots. The webpack plugin collects and collision-checks these records, sets
  `enableUnifyFixedBehavior`, and writes them to `encodeData.elementTemplate`
  before Lynx encoding. See the
  [template lowering](https://github.com/lynx-family/lynx-stack/blob/2b837edbf640587be59211ad146a764a1703851b/packages/react/transform/crates/swc_plugin_element_template/template_definition.rs)
  and
  [encoder handoff](https://github.com/lynx-family/lynx-stack/blob/2b837edbf640587be59211ad146a764a1703851b/packages/webpack/react-webpack-plugin/src/ReactWebpackPlugin.ts).
- Native instances are created and updated with the Element Template API,
  including `__CreateElementTemplate`, `__SetAttributeOfElementTemplate`, and
  `__InsertNodeToElementTemplate`. Even the page is created as a typed template
  and receives roots through child slot zero. See the
  [runtime API types](https://github.com/lynx-family/lynx-stack/blob/2b837edbf640587be59211ad146a764a1703851b/packages/react/runtime/src/element-template/types.d.ts)
  and
  [page setup](https://github.com/lynx-family/lynx-stack/blob/2b837edbf640587be59211ad146a764a1703851b/packages/react/runtime/src/element-template/runtime/page/page.ts)
  plus
  [root insertion](https://github.com/lynx-family/lynx-stack/blob/2b837edbf640587be59211ad146a764a1703851b/packages/react/runtime/src/element-template/runtime/render/render-main-thread.ts).
- The official types intentionally make `ElementTemplateHandle` and ordinary
  `ElementRef` mutually unassignable. This rules out inserting a templated row
  into Octane's current ordinary-element page through the existing
  `insertBefore` store path. A partial emitter swap would cross an explicit SDK
  ownership boundary rather than provide a safe batch primitive.

Octane's application build now uses that existing `LynxTemplatePlugin` hook for
an explicit `experimentalElementTemplate: true` mode. The shared immutable
program IR lowers to collision-checked Template Definitions; the encoder writes
them to `encodeData.elementTemplate` with target SDK `3.2`; and the application
selector atomically installs a typed template page and opaque template-handle
owner. Value slots, delegated background-event slots, optional root visibility,
and structural child slots retain the compact background protocol's positional
ABI. Adoption, update, move, removal, rollback, disposal, and serialization stay
inside that handle domain.

The paired graph proof now also owns the compiler shape. When the graph selects
structural Block semantics, finishMake rebuilds only its reachable main-thread
compiler modules with a separately cache-identified structural Element Template
backend. That backend emits no root `hidden` slot and no `visibilitySlot` plan
field; the runtime allocates the exact reported arity and refuses VIS from the
plan itself. The encoder only collects the already-lowered definition, removing
the earlier post-lowering metadata rewrite and making plan, JavaScript creation
arrays, and native Template Definition agree by construction. Its handoff also
checks the compiler-reported visibility-slot count against the graph selection,
so a stale or skipped specialization fails the build instead of silently losing
the reduction.

The implementation deliberately does not claim the unsupported part of the
earlier precondition list. Refs, native lists, `main-thread:*` bindings,
text-polymorphic ranges, portals, and unsupported native attribute composition
reject complete template lowering at build time. They do not enter a partial
backend or get converted to ordinary Element refs. Ordinary builds retain the
existing owner, and the whole-entry Universal compatibility path remains.

Device qualification exposed two independent Android 4.1 JNI ceilings. Pending
PaintingContext work is drained with a real `{ triggerLayout: true }` flush at
8,192 compiler-counted nodes. Synchronous `renderPage` admits no more than that
same bound because its nested flushes coalesce; larger first screens defer intact
to the background store. Live ownership is separately capped at 32,768 template
instances and 40,960 resident plan nodes. Exceeding a live limit produces
`Octane Lynx OL512` before native creation and rolls the frame back; an eager
30,000-row table must use the virtualized native-list architecture instead.

The final pinned Android Explorer 4.1.0 candidate accepted one native-tap
10,000-row create and one 10,000-row startup, and rejected one 30,000-row startup
without a fresh JNI/fatal marker or Explorer process death. An earlier 40,960
synchronous-first-screen threshold crashed at 10,000 rows with a PaintingContext
global-reference overflow, and an earlier queue-only budget crashed at 30,000
rows with a TextShadowNode weak-global-reference overflow; both candidates were
rejected. The immutable hashes and exact scope are recorded in
[`packages/lynx/audit/android-element-template-evidence.json`](../../../packages/lynx/audit/android-element-template-evidence.json).
These single-sample checks qualify a correctness and fail-closed boundary, not a
cross-framework A/B, general Android support, memory result, or iOS release gate.

The later exact-head 1,000-row create follow-up adds the 10-pair
ordinary/structural configuration comparison summarized above. It does not
broaden the earlier 10,000/30,000 safety qualification, and it does not replace
the missing fresh-process native-memory or full release matrix evidence.

### 2026-09-25 current-head continuity check

After the background publication and teardown serialization fixes, commit
`be7615df441519a99e7478d951a8f494feed6af4` was rebuilt from source in both the
ordinary automatic configuration and the experimental structural Element
Template configuration. A fresh Android 10 Sandbox lease ran 10 adjacent
AB/BA pairs with cold Explorer launches, DevTool disabled before each sample,
native ADB taps, a 35 °C / thermal-status-0 gate, and the existing strict state,
transport-ACK, and second-native-frame receipt.

The implementation and this qualification update are reviewed together in
[Huxpro/octane#395](https://github.com/Huxpro/octane/pull/395).

All 20 attempts passed on their first try. Ordinary tap-to-second-frame latency
had a 587 ms median; structural Element Template had a 533 ms median. The
paired structural-minus-ordinary values ranged from −85 to −40 ms, so
structural Element Template won all 10 pairs with a −56 ms paired median. Main
commit wall time moved from a 500 ms ordinary median to 438.5 ms, again winning
all 10 pairs with a −62 ms paired median. Median frame bytes were effectively
unchanged at 32,987 versus 32,942.5.

The shipping Element Template bundle remained larger: 243,769 versus 226,542
raw bytes (+7.60%), 85,628 versus 78,431 gzip bytes (+9.18%), and 73,951 versus
67,942 Brotli bytes (+8.84%). The run used Lynx SDK 4.2, whereas the earlier
ten-pair record used SDK 4.1, so the two windows are continuity evidence rather
than one merged statistical cohort. This current-head 1,000-row create cell
satisfies the registered 10-pair sample count and semantic checks, but the
result still preserves the **NO-GO** verdict and does not authorize the default
switch; memory/GC, broader operations and scales, native list, no-JIT/low-end
Android, iOS, bytecode, latest-upstream, and peer qualification remain open.

### 2026-09-25 current-product scale continuation

The same immutable ordinary and structural Element Template bundle cohort was
then exercised at 3,000 and 5,000 rows on another Android 10 / Lynx SDK 4.2
lease. The final runner head was `5c571c70ec7bd052b2c6d59ed1004bf06ff22ccc`;
the only changes since the bundle build were the M0 test mirror and this report's
documentation/evidence, so no product or build input changed. Each formal cell used 10 cold
AB/BA pairs with DevTool disabled, native taps, the 0-to-scale state oracle,
transport ACK, two native frames, and a 35 °C / thermal-status-0 gate. All 40
formal attempts were accepted on the first try.

| create scale | ordinary median | structural ET median | paired ET−ordinary median | native pair wins | main-commit pair wins |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3,000 | 2,636.5 ms | 2,465 ms | −184 ms | 9/10 | 10/10 |
| 5,000 | 6,041 ms | 5,744 ms | −341 ms | 10/10 | 10/10 |

The encoded frame sizes stayed effectively level: the paired median was +82
bytes at 3k and −73 bytes at 5k. The 3k result is positive in aggregate but does
not satisfy an all-pairs strict-win reading because one native pair was 4 ms
slower. The 5k result won every pair at both registered latency boundaries.

The first 10k safety window did not qualify. The ordinary owner hit an
Android ART `SIGABRT` after 24,048 ms because the JNI global-reference table
reached its 51,200-entry ceiling; the captured summary contained 30,000
`PaintingContext$a` and 20,474 `w9.w` references. The structural Element
Template owner avoided that crash and one retry completed with exact 10,000-row
state, ACK, and two frames in 21,525 ms, but its preceding attempt produced no
state or attribution before the 180-second cutoff. One valid retry after one
timeout was correctness/safety evidence, not a stable result.

A fresh lease then ran only the structural owner, with no ordinary crash before
it. All five cold starts completed on their first attempt with zero invalid
samples and the exact state, transport ACK, and two-frame oracle. Native
tap-to-second-frame values were 20,547 / 21,702 / 21,306 / 21,025 / 20,739 ms
(median 21,025 ms); main commit walls were 19,904 / 21,063 / 20,657 / 20,379 /
20,099 ms (median 20,379 ms). Every sample reported 10,001 handles, two ranges,
20,012 listener slots, and 40,028 retained host refs. This supersedes the
earlier unstable observation for the structural 10k stability decision. It does
not establish why the earlier attempt timed out, and it is not a paired latency
rank because the ordinary owner cannot complete this scale.

This continuation narrows the Android creation gap through 5k and demonstrates
that the structural owner crosses a native capacity boundary the ordinary owner
does not. The ET-specific 10k correctness/stability blocker is closed, but
ordinary 10k, behavior above 10k, memory/GC, the non-create/list matrix, and the
other release gates remain open. The **NO-GO** verdict, ordinary/Universal
compatibility paths, and default selection therefore remain unchanged.

The same immutable bundle then completed five independent cold-launch
create→clear→recreate samples on a fresh lease. All 15 operations passed on the
first attempt with exact pre/post state, one transport ACK, two native frames,
and the required lifecycle census. Median native input-to-second-frame latency
was 21,342 ms for the first create, 2,585 ms for clear, and 2,934 ms for
recreate; corresponding main commit medians were 20,721 / 2,512 / 2,371 ms.
Clear returned live ownership to the rows-0 baseline of one handle, one range,
12 listener slots, and 28 retained host refs while retaining a bounded recycle
pool of 10,000 handles and 40,000 host refs. Recreate consumed that pool and
restored the populated 10,001 / 2 / 20,012 / 40,028 census exactly in every
sample.

This closes the single-cycle 10k owner-lifecycle correctness/stability slice and
adds registered clear/recreate operation timings. It does not prove a causal
latency benefit from recycling, does not replace the required 20-cycle Android
11+ peak/settled/after-clear/post-GC memory campaign, and does not cover sparse
updates, selection, swapping, removal, storms, or native-list behavior.

## Upstream alignment and remaining owner work

At the 2026-09-15 read-only refresh, published `new-lynx` still pointed
to `7a523bf20d04578c39fe0b5fe532cdef6dab3e9e`, upstream `main` still pointed to
`277c10c3fa80f56ef162959832dba35c1b43b32e`, and
[octanejs/octane#1055](https://github.com/octanejs/octane/issues/1055) remained
open. The shared compiler IR, independent two-thread lowering, versioned paired
ABI, attempt/acceptance boundary, hybrid generated/resident representation, and
whole-root selection described in that issue are the seams used here. The
Element Template backend adds a distinct native-owner specialization without
reconstructing universal plans or host records at runtime.

This increment does **not** close #1055. The compiler and Vite public types now
expose the implemented `target: 'lynx'` registry dispatch, but it does not add
Lynx signal-read ownership, Strong-mode projection caching, the remaining
semantic surface, or default migration and retirement. It retains the resident
compact program where code size warrants, the existing
PAPI/transport/list/resource boundaries, and the fail-closed Universal
compatibility path. No upstream acceptance or merge is claimed.

The remaining framework-owned investigation is no longer an undifferentiated
PAPI sequence. Tail append, handle lookup, detached host creation, and runtime
deep-cloning have been eliminated as safe leading owners; controlled ablation
places the dominant cost at native subtree integration/materialization. The
implemented architecture reduces repeated host construction through the
SDK-supported compile-time Template Definition boundary while preserving the
currently admitted dynamic values, delegated native events, identity, and
updates. Refs and the other rejected surfaces still require explicit
template-native designs; inventing private calls or reusing the crashing clone
primitive would not meet that bar.

In parallel, the benchmark owner must restore stable list viewport/key
observation and recover the DevTool connector between entries. Only a new
exact-head Android no-JIT/low-end and iOS campaign satisfying the registered
AB/BA, tail-latency, memory/GC, bytecode, and list gates can reopen the
default-switch decision. Until then, #383 and the performance objective in
#291 remain open.
