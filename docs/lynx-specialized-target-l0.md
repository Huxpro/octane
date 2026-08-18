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

### L0 results (this host, Chromium 141, 4 CPUs; see prototype/results/)

Filled from `prototype/results/` and `stages/results/` in the same session:

- FCP@10k (mount-create ladder, raw view-attach boundary): octane universal
  path vs `octane-direct` — see `prototype/results/fcp-10000.md`.
- create/update/select/storms at 1k and 10k across `octane`, `octane-direct`,
  `vue-vdom`, `vue-vapor`, `react`: see `results/web.md`.
- Stage attribution of the current path on the same host:
  `stages/results/` live reports.

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

## 6. What the specialized path deletes (mapped to measured cost)

Generic command vocabulary and per-command recursive validation
(`mt_validate`), per-prop classify/encode/clone and `delete props[name]`
churn (`bg_replay`, `mt_apply_other`), `updates.classify` double diffing
(`bg_replay`), plan interpretation and batch prepare on first screen
(`plan_interpretation`, FCP residual), template-program/compact-blueprint
compensation layers and the capability handshake (code size), and per-node
handle/ack state (`mt_apply_other`, memory).

## 7. L0 exit-gate verdict

Recorded after the measurement session on this branch; see
`benchmarks/lynx-table/prototype/results/` for the full tables and
`prototype/README.md` for the protocol.

<!-- L0-VERDICT -->

## 8. Open questions carried into L1+

1. How much static structure can live in native `.lynx.bundle`
   element-template sections versus create functions — needs the native
   encoder surface; the web path measured the code-side form only.
2. Whether `@octanejs/three` wants the slot-table mechanism (informing what
   remains in `octane/universal`) — deferred to the L6 ABI decision.
3. Delta batching granularity beyond per-commit once a lane scheduler exists.
4. The exact kernel-extraction boundary (§5) — settled by the L2 spike.
