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

Typed, flat, slot-addressed; the applier is a table dispatch into pre-bound
PAPI setters. Opcode families:

- `RUN(templateId, anchorSlot, count, values…)` — create `count` instances of
  a template appended at an anchor; the value stride is the template's dynamic
  slot count (the existing `mount-template-run` generalized to every
  template).
- `SET(instance, slotIndex, value)` — one slot write; the slot's compile-time
  kind (text, class list, attribute, style prop, event token) selects the
  setter, so no per-prop classification or prop-bag diff exists on either
  side.
- `REMOVE(instance | range)`, `MOVE(instance, before)` — keyed-range
  maintenance; `MOVE`s are the LIS output of the background reconciler, so
  final DOM order and survivor identity keep today's guarantees.
- `BRANCH(slot, templateId | none, values…)` — `@if`/`@switch` arm swap: both
  arms are compile-time-known templates; the slot is the branch anchor.
- Range framing for `@for`/`@empty` and `@try`/`@pending`/`@catch` boundaries:
  a range is (anchorSlot, member list) owned by the background core; boundary
  swaps are `BRANCH` at the boundary's anchor.

Validation shrinks to a header/type check (protocol version, opcode bounds,
value arity); there is no recursive structural walk of arbitrary prop values
because no arbitrary prop values cross the wire — only slot-typed scalars and
the value arrays of runs.

Batching: one message per commit (today's model). Finer-grained scheduling is
deferred until a lane scheduler exists (issue #58 open question 4); the
protocol does not preclude it because messages are self-delimiting op
sequences.

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

- **L2 (typed delta protocol):** `packages/lynx/src/core/delta-protocol.ts`
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
  minified at or below the plan encoding; gzip 10–22% larger on the fixture
  modules because repeated JSON keys compress better than code — accepted as
  an L1 trade, re-audited at L5 when the interpreter and batch pipeline leave
  the main-thread bundle.

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
