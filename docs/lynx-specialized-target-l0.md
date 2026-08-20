# Lynx-specialized target — L0 representation spec and cost model

Status: L0 deliverable for the roadmap in issue #58 (replace the
universal-renderer target for Lynx with a Lynx-specialized compiler and
renderer). This document is the Lynx IR spec, the cost model, the
fresh-core-versus-extraction recommendation, and the record of the L0
prototype measurements. It changes freely until L1 lands; nothing here is a
published contract.

The public API and component model stay exactly Octane
(`docs/differences-from-react.md`); everything below the compiler front-end is
in scope. The DOM path (`runtime.ts`) and the `@octanejs/three` universal path
are out of scope and unchanged.

## 1. What L0 had to establish

The stage attribution (`benchmarks/lynx-table/stages/results/`) already pinned
the costs: wire/clone is ≤1% of create; the owners are PAPI/host
materialization plus the generic apply machinery around it
(`papi_element_creation` + `mt_apply_other` ≈ 76% of create@10k) and, on first
screen, plan interpretation plus batch prepare on top of the same PAPI calls.
What attribution alone cannot say is whether those costs are *engine-intrinsic*
(the `__CreateElement` family is simply that expensive) or
*representation-caused* (the generic vocabulary forces work around every PAPI
call). L0's exit gate is exactly that question, answered on the same engine,
same workload, same driver, with a representation-changed cell.

## 2. L0 prototype: what was built

`benchmarks/lynx-table/prototype/` contains a hand-written rendition of what a
`target: 'lynx'` backend would emit for the `lynx-table` fixture — the L0
"create-function codegen for the lynx-table fixture only" milestone:

- `lepus-root.js` — the main-thread program: straight-line Element PAPI create
  functions for the two fixture templates (chrome, row), a dense slot table of
  node references per row instance, and a typed slot-delta applier. No plan
  objects, no `FirstScreenNode` graph, no `UniversalHostBatch`, no prop-bag
  diffing, no per-command validation.
- `app-service.js` — the background program: owns the row state, mirrors
  `app/src/App.lynx.tsrx` operation-for-operation (including the
  one-macrotask-per-tick storms), and emits typed slot deltas over
  `callLepusMethod`. It is a state-owner stub, **not** a hook/reconciler core;
  see the honesty notes below.
- `build.mjs` — assembles the JSON web bundle. `pageConfig` is copied from the
  Octane-built bundle's Configurations section and `styleInfo` carries the same
  `app.css`, so the engine-behavior toggles and styles are identical to the
  octane cell; the only variable is the program pair.

The prototype cells run behind the byte-identical drivers of the existing
harnesses: `web/run-web.mjs` (cell `octane-direct`, opt-in via `--cells`) and
`prototype/run-fcp.mjs` (mount-create FCP ladder versus the octane
`BENCH_AUTOROWS` build). `prototype/smoke.mjs` asserts functional parity for
every benchmark operation (create/append/update-10th/select/remove/swap/
clear/both storms) before any measurement session.

### Measurement honesty and scope

- The prototype is an **architecture floor**, not an achievable-Octane number.
  Its background thread does no component re-render, hook bookkeeping, or
  keyed diff; a real Lynx core adds background work bounded by today's
  measured `bg_replay` stage. Main-thread claims (FCP, PAPI-adjacent apply)
  are the load-bearing ones; whole-op wall clocks are quoted with that caveat
  attached.
- Same workload, same driver, same CSS, same engine toggles as every other
  cell; a cell that cannot be driven end-to-end reports "not measured".
- All numbers are same-host, same-window comparisons; absolute milliseconds
  are host-bound.

### L0 results (this host: 4× Xeon 2.10GHz, Chromium 141, quiet-host, n=5, AB/BA)

Session records under `prototype/results/`; medians, same-window ratios.

FCP@10k, mount-create ladder, raw view-attach boundary (`fcp-10000.md`):

| cell | median ms | min–max |
|---|---:|---:|
| octane (universal path) | 1590.9 | 1541.4–1636.2 |
| octane-direct | 915.0 | 886.2–947.9 |

**0.575×**, −675.9 ms. Same-session stage attribution of the octane path
(`stages-10000-l0-session.md`): `mt_slice_eval` 18.7 / `plan_interpretation`
111.5 / `papi_element_creation` 476.6 / `layout_flush_residual` 1010.1.

Per-op wall clock at 10k across all cells (`web-l0-session.md`, ×vs vue-vdom):

| op | octane | octane-direct | vue-vdom | vue-vapor | react |
|---|---:|---:|---:|---:|---:|
| create | 1082 (0.80×) | 862 (0.64×) | 1350 | 1407 (1.04×) | 1107 (0.82×) |
| update10th | 146 (1.34×) | 82 (0.75×) | 109 | 70 (0.64×) | 156 (1.43×) |
| select | 75 (1.15×) | 44 (0.67×) | 65 | 35 (0.53×) | 94 (1.44×) |
| updateStorm | 539 (0.32×) | 572 (0.34×) | 1668 | 808 (0.48×) | 3766 (2.26×) |
| selectStorm | 103 (0.15×) | 91 (0.13×) | 708 | 129 (0.18×) | 1851 (2.62×) |

Same-session octane create@10k attribution: `bg_replay` 138.7, `mt_validate`
11.2, `papi_element_creation` 582.9, `mt_apply_other` 290.3, raw 1165.9
(profile) / 1105.2 (control).

Verdict recorded in §7.

## 3. Lynx IR spec

The compiler front-end is unchanged: `compile.js` lowers JSX, assigns hook
slots, infers dependencies, and re-enters `compileInternal`. The Lynx backend
replaces what `compileUniversal` emits. Per `.lynx.tsrx` module the backend
emits, for each template (a contiguous host-element region between dynamic
holes):

### 3.1 Static structure

A **shape** known at compile time: node types in creation order, parent index
per node, static prop writes (classes, id, attributes, dataset, CSS scope),
and event sites. Encoded as code (the create function below), not as data to
be interpreted. Whether part of this can additionally live in the
`.lynx.bundle` element-template sections on native is an open engine-side
question (§8); the web path has no such section for JSON bundles, and L0
measured the code-side form.

### 3.2 Create functions

One straight-line function per template: dense `__CreateView`/`__CreateText`/
`__CreateRawText`/`__CreateElement` calls with `__SetClasses`/`__SetAttribute`
for static props, `__AddEvent` for event sites, `__AppendElement` in
child-before-parent-attach order, parameterized only by the template's dynamic
slot values. The `intrinsics.view/text/rawText` + `append` factories of
`core/papi.ts` are the primary path. The first screen is these functions
called at `renderPage` time — no interpreter and no intermediate command
batch. This is the same shape as the dense template-run hot loop the universal
path already reaches for background-driven creates
(`core/host-driver.ts:4916`), promoted from a negotiated fast path to the only
path, and extended to the first screen where today no fast path exists.

### 3.3 Slot table

Per template instance, one dense array of node references covering only the
dynamic slots: text holes, class-bearing hosts whose class list has a dynamic
member, dynamic attribute/style hosts, event-token hosts whose token embeds
instance identity, and child-range anchors. Slot indices are compiler-assigned
and stable across rebuilds of the same source (same discipline as hook slots).
Everything else in the template has no per-instance state at all.

### 3.4 Delta opcodes (background → main)

Typed, flat, and instance-addressed; the applier is a table dispatch into
pre-bound PAPI setters. **Protocol version 2** (`delta-protocol.ts`), after the
closure analysis on #61 refuted the draft below it.

Every address is a pair `(instance, slot)`. A bare slot cannot be an address:
slot indices are per-template, so one index names one anchor *per instance* —
in a 10,000-row list, 10,000 of them. Instance handle `0` is the `END`
sentinel; handles are dense, monotonic, and never reused.

- `RUN(templateId, (Ip,sp), (Ib,sb), first, count, values…)` — instantiate
  `count` instances of a template into range site `(Ip,sp)`, before anchor
  `(Ib,sb)` or appended when the anchor is `END`, taking handles
  `first … first+count-1`. Generalizes today's `mount-template-run`.
- `SET(instance, slot, value)` — one slot write. The slot's compile-time kind
  selects the setter, so no per-prop classification or prop-bag diff exists on
  either side.
- `REMOVE(first, count)` — destroy a contiguous handle run.
- `CLEAR((Ip,sp))` — destroy every member of a range site, valid only where the
  site owns all of its parent node's children.
- `MOVE(instance, (Ip,sp), (Ib,sb))` — reposition, possibly under a different
  parent, which is what portal retargeting emits. `MOVE`s are the LIS output of
  the background reconciler, so final DOM order and survivor identity keep
  today's guarantees. Anchors name identities and are position-invariant across
  the message, so "before or after the other moves" does not arise.
- `VIS(instance, hidden | visible)` — Activity and retained Suspense are
  visibility transitions over instances whose identity does not change. The
  applier composes it with the authored `hidden` prop and owns native-event
  teardown and reinstall, so a flip carries no event ops.

Two opcodes from the draft are gone. **`BRANCH` is deleted**: retained Suspense
keeps the committed arm and the pending arm live simultaneously, which a
single-arm opcode cannot express, and every arm swap is already `REMOVE` +
`RUN` into the same range site. **`RECREATE` was never added**: a template's CSS
scope is baked into its create function, so an instance cannot change scope and
a scope change is a different template.

Values are scalars — string, number, boolean, null. All structure travels as
ops. This is the premise header-only validation rests on: a structured value
would have to be walked to be checked, which is the recursive cost this format
exists to delete. Validation is therefore a single forward scan with no
recursion and no allocation (protocol version, opcode bounds, frame arity, one
`typeof` per value).

Batching: one message per commit (today's model). Finer-grained scheduling is
deferred until a lane scheduler exists (issue #58 open question 4); the
protocol does not preclude framing it, though the dense-handle invariant would
need revisiting.

### 3.5 Events

Event tokens are compile-time-stable strings minted per event site, with
instance identity embedded for per-instance sites (the prototype's
`s:<rowId>` form). Registration happens once inside the create function;
identity-stable updates never touch the event system. Priority rides in the
token as today. Buffered replay before background-listener acceptance keeps
the current contract.

### 3.6 Adoption identity

First-tree adoption keys off (templateId, instance path) — compile-time
identity shared by both compiled graphs — instead of runtime-minted logical
IDs plus snapshot field comparison. The main thread records, per created
instance, its template id and creation ordinal; the background core's first
commit addresses the same coordinates. Mismatch handling (repair/remount +
source-attributed diagnostic) carries over; matching becomes an array-index
walk instead of structural comparison, which should collapse most of
`core/first-screen.ts` and the per-node ack/handle machinery. Thread-DCE and
deterministic-metadata discipline from Milestone 6 are unchanged
prerequisites.

### 3.7 Lists

Native list descriptors and recycling callbacks port as-is; a list cell body
is a template, so `componentAtIndex` calls its create function directly and
cell updates are `SET` deltas. The native-lists-excluded-from-adoption
divergence is revisited in L4, not here.

## 4. Cost model

Per created host node, the universal path today pays (create@10k attribution):
plan walk or command decode, per-prop classify/encode, prop-bag diff (twice on
update paths), generic apply dispatch, handle/ack bookkeeping, then the PAPI
call. The specialized path pays: the PAPI call, plus amortized-per-template
(not per-node) code. The model predicts:

- first screen: `plan_interpretation` → 0 by construction; batch
  prepare/validate → 0; `papi_element_creation` unchanged per call but no
  longer wrapped in per-node record building.
- create: `mt_validate`/`mt_prepare`/`mt_apply_other` collapse toward the raw
  PAPI loop; wire stays at the changed-rows floor by construction (`RUN`
  carries exactly the changed rows' values).
- update/select: single `SET`/class writes; no prop-bag re-diff on either
  side.
- bundle: the main-thread program is create functions + a small applier — no
  plan interpreter, no protocol validator, no host-driver generality. (Bundle
  accounting is an L5 gate; L0 only notes the prototype's main-thread source
  is ~250 lines against the current main-thread graph's bundled runtime.)

What the model does *not* claim: the background core's own render/diff cost
(bounded by today's `bg_replay`), engine-side layout/paint
(`layout_flush_residual`), and native-engine behavior (separate gates,
unchanged).

## 5. Fresh core vs extraction (L0 decision)

Recommendation: **extract a host-neutral ownership/hook kernel from
`universal-core.ts`, then build the Lynx core on it** — the escape clause in
`docs/universal-renderer-architecture.md` §13 explicitly allows extraction
"after evidence from two renderers", and Lynx + Three are that evidence. The
kernel boundary is: hook cells (slot-keyed state/memo/effect entries), context
propagation, effect phasing, Suspense/Activity state machines, and the keyed
LIS reconciler over abstract instance handles. Host records, command staging,
prop planning, and the transported-commit encoding stay out of the kernel —
the Lynx core produces slot deltas natively where the universal core produces
`UniversalHostCommand`s.

Fallback: if kernel extraction cannot keep the universal path's test surface
green without behavioral drift (the 15K-line `universal-*` suite is the
oracle), L2 builds a fresh core against the same suite, accepting the third
semantic-drift surface with the differential suites as the guard. The
decision point is early in L2, after a spike that extracts only the hook-cell
module; drift found there is cheap, drift found after a full fresh core is
not.

**Spike result (landed):** `packages/octane/src/universal-kernel.ts` now holds
the host-neutral first slice — every hook cell shape (state, linked state,
reducer, memo, ref, id, effect, effect-event), the hook update-queue value
types (batch type as a parameter), and the pure helpers (`depsEqual`,
`isThenable`, thenable tracking, effect create/cleanup runners, effect-event
deactivation) — with `universal-core.ts` binding the generics and re-exporting
the public types, all with zero behavior change against the guard suites. The
inventory of remaining seams, in extraction order for the L2 core proper:

1. `EffectHook.owner` and every setter closure capture the owner record; the
   kernel keeps the owner as a type parameter, so the next slice needs an
   owner abstraction (hooks map + update queues + disposed/needsRender flags).
2. `scheduleOwner` → `root.scheduleOwned` and profiling: a one-function
   injected callback.
3. Transition batches: `universalTransitionBatchForUpdate` and staging depend
   on module globals and three root services (`scheduleTransition`,
   `discardTransitionBatch`, `__scheduleMicrotask`).
4. Root services used inside hooks: `formatUniversalId` (useId), the warm
   memo cache keyed by root (useMemo/useBatch), `readBridgeContext`
   (useContext fallback).
5. `currentDraftOwner`/`resolveHookSlot` reach owner claiming
   (`claimChildOwner`) — the reconciler-side boundary, last to move.

`ComponentMemoHook` stays renderer-facing (its value is a renderable), and
the hook union stays in `universal-core.ts` composing kernel cells with it.

## 6. What the specialized path deletes (mapped to measured cost)

Generic command vocabulary and per-command recursive validation
(`mt_validate`), per-prop classify/encode/clone and `delete props[name]`
churn (`bg_replay`, `mt_apply_other`), `updates.classify` double diffing
(`bg_replay`), plan interpretation and batch prepare on first screen
(`plan_interpretation`, FCP residual), template-program/compact-blueprint
compensation layers and the capability handshake (code size), and per-node
handle/ack state (`mt_apply_other`, memory).

## 7. L0 exit-gate verdict

**GO.** Direct emission beats the interpreted representation on the FCP
stages, and by far more than the plan walk alone: same-window mount-create
FCP@10k is 915.0 ms versus 1590.9 ms (0.575×, −675.9 ms), against a path whose
directly observed `plan_interpretation` is only 111.5 ms. The win is the
whole interpret → `FirstScreenNode` record graph → command batch → prepare →
generic apply pipeline wrapped around the identical PAPI calls, which is
exactly what §6 predicted from attribution. The costs that persist in both
cells — PAPI creation (476.6 ms same-session) and layout/flush — are the
engine-intrinsic remainder; the prototype confirms they do not yield to
representation change, and nothing else in the Lynx path is left to blame on
the engine.

Secondary observations, same session:

- create@10k 862 ms vs 1082 ms (0.80× of octane; 0.64× of vue-vdom, the
  fastest cell measured) with the caveat that the prototype's background stub
  skips real replay work bounded by `bg_replay` 138.7 ms — the main-thread
  apply-side collapse (`mt_validate` + `mt_apply_other` ≈ 300 ms) is the
  attributable share.
- update10th 82 vs 146 ms and select 44 vs 75 ms: slot-addressed writes
  remove the per-update prop-bag replanning.
- Storms are at parity (572 vs 539 ms; both far below every reference except
  vapor): the universal path's per-tick cost is already dominated by
  flush/layout, so the representation change neither helps nor hurts the
  storm case on web. This bounds expectations: the specialized path's wins
  are first screen, bulk creates, and point updates — not commit overhead
  the engine already floors.

The L0 exit gate is satisfied; proceed to L1 (compiler backend) with the spec
in §3 and the extraction-first decision in §5.

## 8. Landed increments

- **L2 Phase 0 (update-path attribution, decision gate: NO-GO for the delta
  candidate).** The stage harness decomposed only `create`, `replace`, and
  `append`, so the operations the A4/A5 wire cutover targets had a wall-clock
  total and no owner. `update10th`, `updateStorm`, and `select` are now
  decomposed on the real dual-thread web-core path
  (`benchmarks/lynx-table/stages/results/live-10000.md`). Same-window, n=5,
  quiet host, AB/BA, fresh page per sample:

  | cell | `mt_prepare` + `wire_clone_transfer` | `bg_replay` | `presentation_residual` |
  |---|---:|---:|---:|
  | update10th@10k | 3.4% | 49.5% | 33.1% |
  | updateStorm@10k | 2.3% | 12.3% | 74.9% |
  | select@10k | 0.1% | 62.0% | 35.7% |

  **The gate fails by an order of magnitude.** A typed delta plus main-thread
  slot dispatch can only remove host prop-patch planning and wire cost, and
  together those are 3.4% / 2.3% / 0.1% against a 10% owner gate. The wire is
  not merely small, it is already change-sized: `select` flips one row's class
  in a 10,000-row table and sends **289 B**, yet spends **126.7 ms** on the
  background thread producing it. `bg_replay` is instrumented from the native
  event batch arriving on the background thread to the commit message being
  ready, so it covers event dispatch, render, reconcile, and batch
  construction. The update path's cost is therefore proportional to the tree,
  while its output is proportional to the change — an owner no wire
  representation can reach.

  The conclusion survives the instrumentation caveat. Profile/control is
  1.40× on `update10th` and 1.47× on `select`, the largest of any cell; even
  charging that entire delta to `bg_replay` leaves it at 29.4% and 44.4%
  respectively, still an order of magnitude above the delta candidate's share.
  `updateStorm` sits at the flush/layout floor exactly as predicted, which
  bounds what any upstream change can win there. Absolute milliseconds come
  from a 4-CPU container and are not comparable with the 32-core sessions
  recorded elsewhere in this section; only the within-window shares are.

  Consequence for the roadmap: the A4/A5 wire cutover is **not** the
  update-path lever. `delta-protocol.ts` remains worth completing for
  correctness and for the validation simplification (§3.4, header-only checks),
  but it must not be justified by update-path milliseconds. Re-aiming belongs
  to background render/reconcile.

- **L2 Phase 2 (re-aim: the update path's owner is the background drain, and
  the reason is that a transported root cannot scope an update).** Phase 0's
  gate said that if the wire did not explain the cost, Phase 2 was to be
  re-aimed at the segment that does, and that the gate's output outranks the
  original plan. This is that re-aim, and it required fixing the measurement
  twice before it could be trusted.

  Two boundaries were tried and both reported a confident zero. `renderBlock`
  is never reached on the table's mutation path, because item bodies run
  through the keyed for-block's survivor and call-site caches. The DOM
  runtime's `flushWork` is never reached at all — the Lynx background thread
  reaches Octane through `octane/universal/native`, which is
  `universal-core.ts`, a *different renderer* from `runtime.ts`. A profile
  bundle built against that patch contains zero occurrences of its counter
  while the neighbouring `bgReplayMs` and `papiCreateMs` are both present. A
  stage that reads zero because it is watching an unreachable function is worse
  than no stage, so the rule the harness now follows is to confirm a non-zero
  count at low scale before trusting a full run.

  The drain is `UniversalRoot.prepare()`: render, reconcile, and host-batch
  construction. It is gated on a replay-window flag the transport publishes, so
  the first screen's own prepare cannot leak into the update stage. Same-window,
  n=5, quiet host, AB/BA, fresh page per sample:

  | cell | `bg_prepare` | `bg_replay_other` | `mt_prepare` + wire | `presentation_residual` |
  |---|---:|---:|---:|---:|
  | update10th@10k | **36.0%** | 0.2% | 4.6% | 47.9% |
  | updateStorm@10k | **9.9%** | 0.1% | 2.5% | 77.3% |
  | select@10k | **43.3%** | 0.2% | 0.3% | 51.5% |

  Event delivery, the handler, scheduling, and the commit hand-off together are
  0.1–0.2% of the replay window. The window *is* the drain. Phase 0's
  instrumentation caveat is also gone: profile/control is 0.96× on update10th,
  1.07× on select, 0.92× on updateStorm and 0.93× on append — within noise in
  both directions, against 1.40×/1.47× in the Phase 0 window.

  **The drain is tree-sized while its output is change-sized.** At 10,000 rows
  the three mutation cells span three orders of magnitude of change and less
  than a factor of two of drain:

  | cell | row-body renders | host commands | `bg_prepare` |
  |---|---:|---:|---:|
  | select@10k | 1 | 1 | 64.2 ms |
  | update10th@10k | 1,000 | 1,000 | 96.0 ms |
  | updateStorm@10k | 4,000 | 4,000 | 100.8 ms |

  `select` flips one row's class and sends 289 B, and the row-render counts are
  deterministic for this app and interaction, so auto-memoization is already
  keeping render *breadth* proportional to the change. Holding that change
  fixed and varying the list instead moves the drain 12.1 ms at 1k to 64.2 ms
  at 10k, with non-overlapping per-sample ranges ([12.1, 13.8] against
  [60.0, 128.0]) — roughly 6 ms fixed plus ~5.8 µs per row of *untouched* list.
  (The two windows are adjacent rather than interleaved, so the same-window
  change-size comparison above is the stronger of the two arguments.)

  **The mechanism is in the source, not inferred from the numbers.**
  `prepareOwnedUpdate` in `universal-core.ts` is the scoped, O(change) update
  path: it re-renders only the owner that owns the updated hook. It returns
  `null` unconditionally when `this.transport !== null`, and `root.ts`
  constructs every Lynx background root with a transport, so every Lynx update
  falls through to the full-root `prepareWithReplay`. Its own comment gives the
  reason: a transported commit is acknowledged against a whole-tree version, so
  a scoped batch would need its own ACK/rollback protocol on the far side
  before it could be accepted independently.

  Consequence for the roadmap. The A4/A5 wire cutover stays NO-GO (`mt_prepare`
  plus clone/transfer is 4.6% / 2.5% / 0.3%). The lever is a **scoped commit
  for transported roots**: letting the background acknowledge a sub-tree batch
  rather than a whole-tree version. That is precisely the capability the v2
  delta protocol's instance-addressed `(instance, slot)` pairs exist to
  provide, which is why Phase 1 remains worth having even though it was refused
  as a performance argument. Designing that ACK/rollback protocol is the next
  slice; it is a runtime and transport change, not a wire-encoding change.
  `updateStorm` is excluded from any such claim — 77.3% of it is the
  flush/layout residual, which bounds what any upstream change can win there.

- **L2 Phase 1 (delta protocol v2, and one amendment that could not be
  implemented as specified).** `delta-protocol.ts` is rewritten to the opcode
  set the closure analysis on #61 settled: every address is an `(instance,
  slot)` pair, `BRANCH` is deleted, `CLEAR` and `VIS` are added, and values are
  restricted to scalars so a frame is checkable by its header alone.
  `LYNX_DELTA_PROTOCOL_VERSION` is 2; §3.4 above is the normative description.
  The #78 shadow now emits v2 and allocates dense instance handles of its own
  rather than reusing command-batch node ids, and its differential oracle
  addresses instances by handle — which is the property instance-qualified
  addressing exists to provide. The worked examples from #61's Cases 1–3 are
  encoded as tests and were verified to fail against v1 first.

  **A6 could not be completed, and the reason is a finding rather than a
  shortfall.** The amendment asks for the range-site kind `r` to be split from
  the scalar kind `c` in `lynxTemplateSlotKinds`. That split is not available
  there: the universal plan IR has no scalar hole to split off. `kind: 'text'`
  is produced only for *static* text and never carries a slot, and every
  dynamic hole — a bare `{expr}`, a cast `{expr as string}`, `@if`, `@for`,
  `@switch`, `@try`, Activity, and a component call — reaches
  `addDynamicAst` and becomes one indistinguishable `{kind:'slot'}` node. The
  `as string` cast is a type assertion the compiler strips, so it leaves no
  trace in the plan. Compiling all four forms and comparing their emitted slot
  tables shows them identical.

  What did land is the truthful half: every renderable hole is now `r`, because
  every one of them is a range site — a bare expression can evaluate to an
  array or a component exactly as a directive can. That is enough for the
  validator rule requiring a `RUN`/`CLEAR` parent slot to be a range site, and
  it is pinned by a test over all four hole forms. A scalar kind has no
  producer today, so introducing one is an IR change — the compiler would have
  to mark a hole it can prove is text-scalar — and it belongs with the applier
  work that would consume it, not here. Recorded so the next slice does not
  re-derive it. The `n` (instance root) and `a` (static anchor) kinds from the
  same amendment are likewise deferred to the applier.

  No measurement is claimed: the protocol remains deliberately unwired, and
  Phase 0 established that the update path's cost is not in the wire.

- **L2 (typed delta protocol, superseded by v2 above):**
  `packages/lynx/src/core/delta-protocol.ts`
  defines the versioned, flat, self-delimiting transport planned in §3.4.
  `RUN`, `SET`, `REMOVE`, `MOVE`, and `BRANCH` round-trip through explicit
  operation arities; `REMOVE` distinguishes instance and range addresses,
  and range/branch member counts frame their trailing values. The decoder
  validates only the envelope, version, opcode, arity, and typed header fields;
  slot values remain opaque and are never recursively walked. This slice is
  deliberately not connected to the runtime. Same-window deterministic
  `lynx-table` runs against the #65 stack were identical at 1k and 10k for
  create, update10th, select, swap, update storm, and select storm; runtime
  performance remains **not measured** until background emission consumes the
  protocol.

- **L1 (compiler backend, first slice):** `target: 'lynx'` is accepted by the
  renderer config (v5) and routed through the shared universal front-end;
  eligible host-only templates emit create functions + slot-kind tables, and
  ineligible plans keep the interpreted encoding. `lynxMainThreadRenderer`
  runs on the new target; its first-screen renderer executes create programs
  through a record-building env that reproduces the plan path's host batch
  byte-for-byte (differential-tested), so the representation swap lands with
  adoption identity and the whole Lynx test surface unchanged. Binding the
  same env directly to PAPI is the L3 cutover. Module-level size: raw and
  minified at or below the plan encoding. **The gzip trade this bullet
  originally recorded as "10–22% larger, because repeated JSON keys compress
  better than code" was wrong on both counts** — see the create-function local
  naming entry below.

- **L2 (kernel-extraction spike):** `universal-kernel.ts` holds the
  host-neutral hook-cell slice (see §5 spike result); the seam inventory
  there sequences the rest of the extraction. The next slice now also owns
  the minimal committed/draft hook-owner contracts (`hooks`, update queues,
  `disposed`, and `needsRender`) and a once-bound injected `scheduleOwner`
  service; universal profiling plus `root.scheduleOwned` remain renderer-core
  policy. A render-through-public-root guard drives captured state and reducer
  updates together, pins one batched commit, and proves setters become inert
  after unmount. Same-window B/A/B/A `universal-leaf-update` measurements found
  no systematic regression: the 4k scoped leaf was 0.038/0.037 ms on the A1
  base versus 0.040/0.040 ms on this slice, while the 4k clean-root control was
  6.764/6.571 versus 6.927/6.615 ms (dirty control remained 33–35 ms). Treat
  those small sign/magnitude changes as noise, not a performance claim.
  The transition-batch slice moves active/in-flight state, nested/async
  entanglement, pending listeners, promotion, cross-root settlement, and
  promotion re-homing into a host-neutral controller. Universal core injects
  owner-to-root lookup, queue membership, update enqueueing,
  `scheduleTransition`, `discardTransitionBatch`, root/fallback microtasks, and
  the discrete notification scope; root implementation and hook-queue replay
  remain renderer-owned. A public-root guard pins pending `false → true →
  false` around the staged `0 → 1` owner update; deliberate microtask-service
  removal leaves it stuck at `true/0`. Same-window B/A/B/A transition medians
  (7 samples × 200 public transitions) were 0.0559/0.0576 ms on the owner-seam
  base versus 0.0591/0.0579 ms here: the first-window difference did not
  reproduce, so this is equivalence evidence, not a performance claim.
  The hook-root service slice removes hooks' remaining dependency on the full
  universal root: `useId` calls injected `formatId`, warm memo caches are keyed
  by an opaque per-root token, and context fallback calls injected
  `readBridgeContext`. A render attempt carries the same root through this
  narrow interface; the only new allocation is one cold token per root. The
  public-root guard proves two hook slots receive distinct opaque IDs, and the
  existing abort/reclaim, warm-stratum, and mixed-owner bridge suites stay
  green. Same-window B/A/B/A `universal-leaf-update` was mixed: 4k scoped leaf
  0.037/0.039 ms base versus 0.041/0.041 ms candidate; 4k clean-root
  6.654/6.565 versus 6.628/6.093 ms, with dirty controls 33.87–36.97 ms. The
  microsecond scoped difference has no whole-path corroboration; treat the
  result as inconclusive and keep measuring, not as a performance claim.
  The final claiming seam is also extraction-viable: a host-neutral controller
  now distinguishes nullable active-owner probes from strict hook access,
  activates lazy keyed owners through an injected `claimChildOwner` callback,
  and owns explicit/implicit compiler slot composition. Record creation,
  identity buckets, replay ordinals, and reconciler adoption stay in universal
  core. The first draft incorrectly required an active universal attempt for a
  DOM-owned renderer-region probe (22 guard failures); splitting nullable probe
  from strict hook access restored all mixed-boundary behavior. Deliberately
  disabling lazy-scope claiming then made a keyed getter list reuse item A's
  state for item B, proving the guard reaches the injected claim path. Final
  B/A/B/A: 4k scoped leaf 0.039/0.039 ms base versus 0.042/0.040 ms candidate;
  4k list-item 0.203/0.217 versus 0.192/0.195 ms; clean-root 6.490/6.368 versus
  6.683/6.382 ms, with dirty controls 34–37 ms. Differences change magnitude
  or direction across windows/scenarios, so this is equivalence evidence only.
  **Extraction remains GO; the fresh-core fallback is not selected.**

- **L2 (background delta emission, shadow slice):** the profiling build now
  maps accepted `mount-template-run`, binding-only `update`, keyed `move`, and
  instance `remove` command commits into the typed protocol without changing
  the production wire or acknowledgement ABI. The encoder is transactional:
  unsupported commands/props return a miss without mutating shadow state, and
  a prepared shadow publishes only after host acknowledgement callbacks
  succeed. A command-reference versus encode/decode/delta-applier differential
  pins RUN/SET/MOVE/REMOVE after every commit; production-fold tests prove the
  entire shadow is absent when profiling is disabled. The real 1k+10k
  `lynx-table` sequence covered all 166 measured commits with **0 misses** while
  preserving existing wire/identity/event controls. At 10k, encoded delta
  payload estimates versus current command commit bytes were: create
  349,778/350,619; update10th 36,755/69,874; select 40/225; swap 27/368;
  50-tick update storm 1,133,250/2,789,296; 30-tick select storm 1,346/6,956.
  These are cutover projections, not shipped performance gains: transport and
  main-thread application still consume the command batch. The next slice can
  make this encoding authoritative and remove full-prop update bags /
  background `updates.classify`; the shadow proves the table workload needs no
  lossy fallback.

- **L2 (background update classification):** `updates.classify` no longer runs
  the semantic prop planner to keep one boolean. `classifyLynxHostPropUpdate`
  answers `update`/`recreate` directly on both the background client driver and
  the main-thread host driver; losing a CSS scope is the only condition that
  makes a host un-updatable in place. Every rejection still fires in the same
  order and both paths still read the same own-properties of the bag, so only
  the construction is gone — pinned by a differential over 7,168 type × fragment
  pairs plus 21,504 merged-bag pairs that compares verdict *and* thrown message
  against `planLynxHostPropPatch`, red-green verified across six deliberate
  breaks. Same-window seam A/B over the 4,000 real triples captured from
  `lynx-table@10k`: 178 → 40 ns per call, **0.224×**, ranges separated.
  Same-window end-to-end `runTable(10000)`, n=7: 7,367.2 → 7,263.3 ms,
  **0.986× with overlapping ranges — no whole-path performance is claimed**, and
  the arithmetic agrees (51,065 calls × ~138 ns ≈ 7 ms of ~7,300 ms). The value
  is the removed allocation and the prop-bag-independent classification contract
  the remaining A4/A5 slices need, not a measurable FCP or commit win.

- **L3 (direct first-screen, depth).** The direct applier and the
  `firstScreenTreeHasList` predicate ahead of it each consumed a call frame per
  tree level, so the first screen became the only stack-bound stage in a
  pipeline whose staged path walks a flat command array; trees the renderer
  produces failed the applier with `RangeError` (#90). Both are explicit work
  stacks now. The attach stays bottom-up and roots and siblings stay in authored
  order — properties of the walk that the snapshot and physical-tree
  differentials cannot see, since a top-down attach builds the identical final
  tree, so they are pinned directly. Same-window FCP@10k, n=5, quiet host:
  1694.6 ms (1464.6–1728.1) recursive versus 1557.1 ms (1510.2–1725.2)
  iterative, architecture floor 1038.0 ms. **The ranges overlap almost entirely;
  this is a no-regression result, not a speedup.** Raw bundle grows 506 B on
  489 KB.

- **First-screen adoption (hidden `<Activity>` handlers).** The background gates
  first-screen event emission on a host's resolved visibility; the main renderer
  walked every host with no gate. A `bind*`/`catch*` handler anywhere inside a
  hidden `<Activity>` therefore made the two batches disagree by exactly one
  `event` command, and a first screen whose event bindings do not match is
  unadoptable — the paint is thrown away and rebuilt on every launch, native node
  identity with it, and the taps buffered in between are discarded (#81,
  pre-existing rather than stack drift). The main renderer now walks with the
  same inherited-visibility rule the host driver applies, which is also the rule
  the direct applier already used when *installing* events — the batch was the
  half that disagreed. Pinned twice: the main and background batches must be
  equal for that shape, and the retained-integration adoption round now carries a
  handler on its hidden Activity and asserts no mismatch diagnostic. Without the
  gate that round reports `first-screen mismatch at snapshot.nodes[13].events:
  the event binding count differs`.

- **L1 × L3 (runtime coverage of the shipped pair).** The `lynx` vitest project
  compiles its fixtures with the background preset, so `target: 'lynx'` output
  had never been executed by a committed test: L1's differential compares
  compile output and first-screen batches without reaching `host-driver.ts`, and
  L3's differential never saw a template-encoded plan (#87). The pair production
  ships was therefore uncovered. `lynx-target-first-screen.test.ts` closes it —
  one fixture compiled at both targets, rendered, and applied through both the
  direct and staged appliers, four cells compared on physical tree and adoption
  snapshot. It is a differential across encoding × applier, so it catches
  divergence between cells and not a regression that moves all four together;
  its fixture also adds `@if`/`@else` to the covered shapes, which L1's `@for`-only
  fixture lacked. `@try`/`@pending` through the template encoding stays open.

- **L1 (create-function local naming).** The gzip penalty was neither bounded
  at 10–22% nor caused by JSON keys compressing well. It was caused by the
  emitter naming every host local from a per-node counter, so each repeated
  subtree differed from the last by the bytes of its identifier — which is what
  LZ77 matches on — and the penalty therefore grew without bound in node count.
  A host local is live only from its own creation until the `env.a` that appends
  it, and that window nests exactly with tree depth, so siblings can share a
  name. Naming locals by depth makes repeated subtrees byte-identical.
  Deterministic, measured on a toolbar ladder compiled at both targets:

  | fixture | gzip vs interpreted, before | after |
  |---|---:|---:|
  | toolbar-4 | +14.9% | +4.8% |
  | toolbar-40 | +81.5% | +1.8% |
  | toolbar-120 | +128.6% | **−2.9%** |

  Raw output, already the smaller of the two, improves from −6.8% to −15.0% at
  120 nodes. On the `lynx-table` app — one small row template, so the shallow
  end of the ladder — gzipped bundles shrink 273 B (web) and 367 B (lynx).
  `lynx-target-template-size.test.ts` pins the structural property (identifier
  count bounded by depth, not node count) and a ≤1.10× gzip ratio across the
  ladder. Same-window FCP@10k, n=5, quiet host: 1604.1 ms (1547.5–1687.4)
  before versus 1584.6 ms (1524.0–1607.3) after — overlapping, no runtime
  change. **The L5 bundle re-audit no longer has this trade to repay.**

- **L3 (direct first-screen, event-channel refusal).** The staged path runs
  `assertNoMainThreadEventCollision` over the batch's final host set during
  prepare, so a host carrying both a main-thread worklet and a background
  listener on one native channel is refused at zero PAPI cost. The direct path
  has no prepare stage and skipped the check entirely, so such a page painted
  and the background token silently superseded the main-thread handler —
  reported or swallowed depending on whether an unrelated part of the page used
  a native `<list>`, which is what makes the direct applier decline (#84). It
  now pre-walks the tree and refuses before mutating, checking only hosts the
  batch gave a listener and skipping the walk entirely when the page has none.
  Same-window FCP@10k, n=5, quiet host: 1798.7 ms (1738.8–1815.8) without the
  pre-walk versus 1752.0 ms (1701.8–2107.5) with it, floor 1102.2 ms — ranges
  overlap, so **no measurable cost**. Raw bundle grows 219 B. Absolute
  milliseconds are not comparable with the depth-fix window above; only the
  within-window ratios are.

- **L3 (direct first-screen, first slice):** `renderFirstScreenNow` applies
  the rendered record tree straight to the Element PAPI
  (`applyLynxFirstScreenDirect`): no command staging, cloned record maps, or
  operation replay, with container state indistinguishable from the staged
  path so adoption capture, mismatch repair, and buffered-event replay are
  untouched (pinned by a differential snapshot/journal/physical-tree test).
  Native-list trees keep the staged path. Same-window mount-create FCP@10k
  (`prototype/results/fcp-10000-l3.md`): pre-L3 stack 1782.9 ms → L1+L3
  stack 1542.8 ms (**0.865×, −240 ms**), architecture floor 979.1 ms. The
  remaining gap is owned by the still-built command batch and record graph,
  background-thread boot, capture validation, and the engine floor —
  candidates for the next L3 slices.

## 9. Open questions carried into L1+

1. How much static structure can live in native `.lynx.bundle`
   element-template sections versus create functions — needs the native
   encoder surface; the web path measured the code-side form only.
2. Whether `@octanejs/three` wants the slot-table mechanism (informing what
   remains in `octane/universal`) — deferred to the L6 ABI decision.
3. Delta batching granularity beyond per-commit once a lane scheduler exists.
4. The exact kernel-extraction boundary (§5) — settled by the L2 spike.
