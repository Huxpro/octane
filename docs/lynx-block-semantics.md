# Lynx Block semantic support

Status: implementation contract through roadmap issue #383 (R11 experimental
Element Template candidate). This document describes the current source/build
state and the narrowly qualified Android table samples; it is not a claim that
the default switch or the full Lynx roadmap is complete.

## Reading the matrix

The implementation has three distinct outcomes:

- **Block selected**: the paired main/background application graph is completely
  addressed, every compiler fact is supported by the versioned Block matrix,
  and the production build selects the Block core. The independent application
  decision selects the compact compiled-program product only when every parent
  and resource can be represented by its delta vocabulary; otherwise it keeps
  the general Block application.
- **Block kernel proved**: focused source tests exercise the Block component
  core, but the production selector still fails closed for that syntax. An
  ordinary application therefore takes the whole-entry Universal compatibility
  path until a paired compiler/build test proves the selection safe.
- **Rejected by Block**: an explicit Block build or a value that violates an
  admitted invariant receives a source-attributed build reason or a stable
  runtime diagnostic. The core never renders an unsupported region as empty and
  never publishes half of it.
- **Experimental Element Template selected**: an explicit application-build
  option requires every selected whole root to lower to the public Template
  Definition schema, replaces the ordinary Element owner atomically, and fails
  the build when coverage is incomplete. It is not the default Block backend.

Automatic selection is atomic per application entry. There is no hidden
mid-tree switch to the Universal reconciler. The conservative first compilation
may select the complete Universal application when any module lacks paired
coverage. An explicit `core: 'block'` may retain an interpreted Universal plan
descriptor on the Block component path, but it still uses the Block core and
must satisfy the runtime invariants below.

## Current matrix

| Authored or runtime behavior | Current outcome | Evidence or boundary |
| --- | --- | --- |
| Static `view` / `text` host topology | Block selected | Resident create programs share compiler-owned addresses across both graphs. |
| Dynamic scalar props, classes, text, and event slots | Block selected | Slot values and listener tables update addressed program instances directly. |
| Host refs | Block selected | Compiler-addressed non-text hosts publish stable clone-safe handles only after ACK, disconnect while hidden, and detach exactly once on replacement or teardown. |
| `useState`, `useLinkedState`, `useReducer`, `useActionState`, `useOptimistic`, `useMemo`, `useRef`, `useCallback`, `useId`, `useImperativeHandle`, `useEffectEvent`, `useEffect`, `useInsertionEffect`, `useLayoutEffect`, and `useSyncExternalStore` | Block selected | Hook cells publish only after host acceptance; memo/reducer identity, linked source generations, action state, optimistic overlays, opaque IDs, imperative handles, and Effect Event bodies survive keyed moves. `useLinkedState` retains local edits while a changed source reconciles from the last accepted generation; rejected drafts do not advance it. `useActionState` queues dispatches so only one action runs at a time, threads each completed result into the next action, keeps pending true until the queue drains, and reports errors through the host microtask service without stalling later work. `useOptimistic` publishes its overlay urgently, folds queued actions over the latest passthrough, and pairs each overlay with its Action batch so the accepted transition reverts it atomically; a rejected native frame retains both the prior overlay and its retry marker. Block event bridges preserve discrete priority when they enter a hook scope, so urgent canonical updates do not accidentally join an unrelated in-flight Action. Imperative handles are background-owned layout effects: they remain untouched before ACK and across rejected drafts, disconnect while hidden, reconnect with the last accepted value when revealed, and clear on disposal. Effect Event wrappers are inactive before their first ACK, keep calling the previous body while an update is in flight or rejected, switch to the new body only after ACK, and deactivate on scope disposal. A removed and later recreated row receives a fresh ID scope. The compact first screen evaluates linked/action initial state and optimistic passthrough without scheduling updates, uses the same deterministic root-1 ID namespace as the complete main-thread renderer, and treats imperative handles and Effect Events as render-only placeholders without publishing background resources. Insertion, layout, and passive work use separate root-wide phases, so every insertion callback precedes every layout callback; rejected attempts publish none. Activity keeps insertion effects connected while hidden and disconnects layout/passive effects, including imperative handles. Because Lynx is cross-thread, insertion runs after native acknowledgement and cannot synchronously block native paint. |
| Keyed `@for` with inline-host or local-component rows, including a retained static sibling after the range | Block selected | The compiler emits the next static child as an `(instance, slot)` anchor; first-screen paint, RUN, MOVE, CLEAR, rollback, keyed identity, and sparse updates preserve authored order. |
| Context propagation through a keyed move | Block selected | Compiler-recognized Providers stay transparent to host topology; `createContext` and `useContext` are admitted by the production selector, with authored dual-backend state/identity coverage and a paired compiled-program build. |
| `@for … @empty` | Block selected | Empty is a separate retained lifetime with rollback, effects, events, removal, remount, paired compiler metadata, and a production dual-graph build. |
| `@if` and `@switch` | Block selected | A compiler-addressable region retains the selected arm, state, handlers, and cleanup; paired metadata and the production build cover both directives. |
| Immutable same-module component boundaries, component children, and inline render props | Block selected | The compiler proves the referenced binding is an immutable module-root function (including proven `memo` wrappers), records template-returning function props independently, and keeps sole component children as descriptors instead of unaddressable host holes. Authored state/reorder coverage and the paired production build cover the chain; imported, dynamic, reassigned, or shadowed component bindings stay on Universal. |
| Compiler-proved component-valued host holes | Block selected | An expression-wrapped immutable local component, or a conditional whose two outcomes are such a component and an explicit empty value, becomes a typed structural region. The region may start empty; same component/key updates retain state, while key replacement or component → empty → component transitions remount cleanly. Imported components, arbitrary values, arrays, and mixed primitive shapes remain generic renderable holes and keep the whole entry on Universal. |
| `memo()` | Block selected | Stateful keyed rows honor custom prop comparators without swallowing local updates; context reads pierce the memo bailout, the compact first screen treats the wrapper as identity, and the production selector admits the runtime export. |
| Compiler-proved dirty hook slots and binding groups | Block selected | Owner-local `useState`, `useLinkedState`, and `useReducer` invalidation reaches only dependent computations and program slots, including hook and derived bindings grouped into one `const` statement; linked-source changes still reconcile through the caller-driven component render, and unproved structural changes retain the full path. |
| Fixed-shape keyed `list-item` rows under native `list` | Block selected | The compact store retains logical rows, publishes `update-list-info` before the accepting flush, materializes only requested cells, rebinds scalar/event identity across the established reuse pools, rejects stale enqueue callbacks, and reports accepted async callback faults. Native-list IFR is explicitly deferred to the first compact frame; it neither paints generic list hosts nor switches to Universal. Rows with nested structural ranges still fail closed. |
| Compiler-proved `Activity` / retained visibility | Block selected | A structural Activity region keeps its component and hook cells across hidden/visible transitions, disconnects effects, refs, and listeners while hidden, and lowers visibility to ordered general-host commands or one compact `VIS`. Hidden compiled first-screen programs are hidden before insertion and reserve—but do not announce—their deterministic listener identities. |
| Compiler-proved `@try` / Suspense | Block selected | Body, pending, and catch arms have independent compiler-owned semantic scopes. A retained body stays physically mounted but hidden while pending, disconnects effects/refs/listeners after ACK, and reconnects the same host and hook identity on reveal. Thenable retry subscription, caught-error state, and reset publish only after an accepted fallback/catch frame; rejected attempts and completions after deletion or unmount publish nothing. The compact first screen handles synchronous throw plus `use`/`useBatch` suspension without loading the Universal reconciler. |
| `startTransition`, `useTransition`, and `useDeferredValue` | Block selected | The host-neutral hook scope preserves urgent and transition queues independently, promotes through the Block scheduler, and publishes pending/value changes only at accepted transaction boundaries. Page and retained keyed-row scopes share one coalesced Block transition attempt. A transition that suspends retains its last accepted range without mounting the pending arm, holds pending across retries, and reveals atomically when the thenable settles. Standalone transitions and deferred-value preview/final passes use the same lane machinery in both general and compact Block applications. |
| Compiler-proved whole-root Template Definitions | Experimental Element Template selected | `experimentalElementTemplate: true` requires complete paired Block/application proof plus complete template lowering. Static hosts, scalar/event slots, and compiler-ordered structural slots use opaque template handles; refs, native lists, main-thread props, text-polymorphic ranges, and non-scalar native composition fail closed instead of mixing ordinary Element refs into the tree. |
| Main-thread props and thread functions | General Block application only | The Block transport can carry them, but the compact compiled-program product fails closed and keeps the general application product. |
| Ordered host spreads with unknown property names | Whole-entry Universal compatibility | `UniversalHostPlan.propsSlot` has no resident Block prop-name table. Static named props remain Block-native. |
| Generic renderable holes (primitive/array/fragment shape changes) | Whole-entry Universal compatibility | The compiler cannot yet prove a stable structural region kind, and Block does not infer one from the first value. |
| Compiler-proved portals | General Block application only | A direct `createPortal`, or a conditional whose outcomes are a portal and an explicit empty value, owns a retained Block range under an acknowledged same-root Lynx handle. Target changes emit `MOVE` for the existing hosts, preserving child state/ref identity; removal, rejection, and unmount release listeners, refs, effects, and target registration only after ACK. The compact delta product cannot encode renderer-owned parents, so the production selector keeps the Block core but chooses the general application. Block currently admits one active portal boundary per target; arrays remain whole-entry Universal compatibility, while multiple sibling boundaries that dynamically claim one target refuse explicitly instead of aliasing ownership. |
| Nested keyed ranges | Block selected | Every outer key retains independent recursive range state; nested RUN/MOVE/CLEAR stays compiler-addressed, including `@empty`, visibility, rollback, and recursive resource cleanup. |
| Multiple independently owned keyed ranges under one host | Block selected | Every range keeps its compiler `(owner, slot)` identity even when several slots resolve to the same native parent and static anchor. General and compact RUN/MOVE/CLEAR, rollback, first-screen paint, and Element Template child slots preserve authored order; an empty middle range does not hide the next live sibling anchor. |
| A row whose root is non-host, has a root event, or is not compile-time host structure | Rejected by Block | The row program cannot currently name the parent-inserted root and its own root event independently. |
| Unknown compiler/runtime proof version or graph mismatch | Whole-entry Universal compatibility | The selector fails closed and records structured reasons in the build asset. |

## Experimental whole-root Element Template backend

The explicit `experimentalElementTemplate: true` Rspeedy option changes both
halves of an otherwise eligible compiled-program application. The main-thread
compiler lowers the shared immutable Lynx program IR into the public SDK
Template Definition shape; the encoder attaches the complete definitions with
target SDK `3.2`; and the application selector installs a whole-root native
owner built only on opaque Element Template handles. Attribute slots preserve
the compact plan's value order, then event order, then one root-visibility slot;
child slots preserve structural-range order. The background delta protocol and
program identity therefore stay unchanged.

Selection is atomic. If any main-thread program cannot lower, the production
build fails instead of silently mixing Template handles with ordinary Element
PAPI refs or switching a subtree to Universal. The first slice rejects refs,
`list`/`list-item`, `main-thread:*` bindings, text-polymorphic structural ranges,
duplicate/native-composed attributes, and any plan outside the existing
whole-entry compiled-program proof. The default remains the ordinary compiled
Element owner.

Android 4.1 qualification found two independent finite JNI resources, so the
runtime enforces independent budgets before calling the public Template PAPI:

- at most 8,192 compiler-counted nodes may remain as pending PaintingContext
  work before a real `{ triggerLayout: true }` flush;
- synchronous `renderPage` first-screen painting admits at most the same 8,192
  plan nodes, because nested flushes are coalesced there and one node may enqueue
  multiple callbacks; larger first screens defer intact to the first background
  frame, where the store can drain between chunks;
- at most 32,768 live template instances and 40,960 compiler-counted resident
  native nodes may be owned. Exceeding either resident limit throws production
  diagnostic `Octane Lynx OL512` before native creation, then rolls back the
  frame. Large collections beyond that bound must use the callback-materialized
  native `list` backend rather than an eager host tree.

The pinned Android Explorer 4.1.0 evidence records one accepted native-tap
10,000-row create sample (4,966 ms to the second native frame), one accepted
10,000-row startup (5,024 ms to transport acknowledgement and 5,056 ms to the
second frame), and one expected fail-closed 30,000-row startup. Fresh device
logs after all three final samples contained no JNI overflow or fatal marker,
and Explorer remained alive. The table-action observer disabled DevTool DOM
events only around the measured tap to avoid instrumentation backpressure;
startup did not use that suppression. These are single-sample correctness and
safety qualifications, not comparative performance, general Android coverage,
or an iOS claim. The immutable inputs, result hashes, rejected-candidate
findings, and scope are recorded in
[`android-element-template-evidence.json`](../packages/lynx/audit/android-element-template-evidence.json).

## Context boundary cost

A compiler-recognized `.Provider` is a semantic boundary, not a generic
component feature. Each evaluated Provider copies the current context map once
to add or replace its value; all consumers below it read that map, so there is
no map allocation per consumer. The compact main-thread renderer materializes
one range boundary around the Provider's children for stable ownership, but it
creates no Universal host or owner records and executes no interpreted
Universal plan. The Block background carries the same context map alongside the
rendered resident program and into retained keyed row scopes. The paired
production build asserts that this shape still selects the compact
compiled-program product.

## Component-hole cost

A proven nullable component expression allocates one `universalIf` descriptor per
parent render so the structural kind survives even when the initial value is
empty. The Block owner retains one range record, one template record per observed
branch/component/key identity, and at most one live component hook scope at the
site. A stable identity performs one branch selection, an identity lookup, and a
shallow props comparison before reusing the resident template and state; it does
not allocate Universal host records or execute an interpreted Universal host
plan. Removing or replacing the identity disposes the active scope before the
new identity is published. A non-tail structural range carries its
compiler-selected static sibling through the program digest, first-screen plan,
compact delta frame, and resident range store.

## Sibling-range identity cost

Physical host identity is insufficient when several compiler ranges share one
parent, so Block keeps logical identity at the owner slot. The general core
allocates one range-site array only for a block that opens structural ranges and
links adjacent sites once. The compact store lazily allocates stable object keys
for only the child slots that are used; it performs no per-command string-key
construction. Each live range keeps its ordered later sibling keys so a tail
insertion can find the next non-empty range before falling back to the shared
static anchor. Range-free programs retain neither structure.

The compiler emits the same ordered range facts to background and main-thread
plans. First-screen painting consumes them forwards, and experimental Element
Template lowering emits every same-host child slot in that order. The production
application fixture contains two adjacent nested ranges and proves all 18 paired
plans are addressed before selecting the compact compiled-program product.

## Error and Suspense boundary cost

Each compiler-proved boundary retains one constant-size state record for its
accepted error, active thenable, retry bit, and committed body key, plus one
template record for each body/pending/catch arm that has been observed. An arm
gets one hook scope when it is first observed, whether or not its authored
callback ultimately uses semantic cells. The ordinary state has one live range
member. A retained suspension has at most two: the committed body, hidden in
place, followed by the visible pending arm. Reveal removes the pending member
and reuses the body member; it does not remount or re-run the body template
merely to restore visibility.

A render evaluates only the selected arm and performs constant-size boundary
selection around the normal work of that arm. `useBatch` necessarily scans its
declared thenables once; multiple pending entries share one aggregate
first-screen suspension. The background registers the retry callback only in
the fallback frame's post-ACK journal, so an abandoned frame retains no
subscription or published error state. A settled callback marks the owning
range dirty and may pierce retained parent-row memoization, but it still enters
the serialized Block attempt/ACK queue.

The arm wrappers reuse the Block keyed-row hook kernel. Their host output is an
addressed compiler program, and their physical state is a normal template
instance plus range member. No Universal host record, host-plan executor, or
Universal reconciler is added to the selected production graph.

## Portal boundary cost

A proven portal retains one range site and one registration for its current
renderer-owned target. The program caches one opaque target handle per target ID
it has observed; handles and registrations are root-scoped and are cleared on
unmount. Mounting below a portal uses the general create vocabulary because the
run protocol deliberately cannot name a portal parent. Stable updates remain
ordinary keyed slot writes. Retargeting visits each top-level portal member once
and emits one `MOVE` per member, so its cost is O(portal member count), without
recreating descendants or changing refs and hook cells.

The target must already be a current, attached `LynxPublicHandle` acknowledged
by this root; an initial portal cannot race the target's first ref publication.
Target claims, registration replacement, member removal, listener/ref release,
and effect cleanup share the Block attempt journal. A rejected frame restores
the previous target and ownership and releases only the speculative
registration. The compact application remains ineligible because its instance
parent vocabulary has no renderer-owned target representation; this boundary
does not add Universal host records, plan execution, or a mid-tree core switch.

## Transition scheduling cost

Each hook scope allocates transition sets only when its adopting renderer opts
into the two scheduling services. Promotion adds the participating scope to one
program-level set; one queued Block render consumes all promoted page and row
lanes. Ordinary renders retain the urgent fast path and scopes used by other
adopting cores remain backward-compatible and urgent-only.

An accepted non-suspending attempt settles each participating scope once. A
suspending attempt retains the range's existing state record and emits no range
mutation for that boundary; the thenable schedules a transition retry through
the same serialized host/ACK queue. Host rejection restores the consumed lanes
and queues one retry, while an escaping error or unmount settles every owned
batch so pending subscriptions cannot outlive the Block program.

## Resident host retention

The compiler derives one sorted, immutable `resident` node set per program. It
always contains the root and every value, event, range parent/anchor, authored
ref, main-thread worklet target, and native `list` node. The set is optional so
older or hand-written version-1 plans retain every node; when present it is part
of the cross-layer program digest and both the emitter and development store
validate the facts they can observe before binding a driver.

Both `create()` and `run()` preserve their dense output ABI for synchronous
first-screen capture and legacy consumers. After a successful driver call, the
compiled-product store copies only resident positions into its caller-sized
physical-stride ownership table; adoption performs the same compaction from its
dense first-screen source. The unused positions are holes: offset arithmetic
does not change, while static internal native controls remain linked below the
retained root without a long-lived JavaScript reference. Native-list cell
ownership copies and clears the same resident positions; list-node indexes
are derived once per plan, and remove, rollback, clear, recycle, and terminal
disposal release each owner once. A physical cell compacts its dense creation
output before entering the attached, retained, or recycle-pool lifetime, so a
pooled cell does not keep static internal native controls alive through the
JavaScript handle table merely because its creation driver had to publish them.

Profile builds expose `programRunOwnedHosts`,
`programRunRetainedHostRefs`, `programRunReleasedHostRefs`, and the live gauge
`programRunLiveRetainedHostRefs`. The authored compiled-product lifecycle fixture
creates 21 hosts at adoption, retains 15 references, omits 6 static references,
keeps the live count at 15 while replacing a keyed row, and returns it to zero on
unmount. The store density regression scales the same invariant from one to
1,000 rows: `3N` native hosts, `2N` retained references, `N` released references,
and zero live references after disposal.

Native-list demand has a separate physical-cell gauge because deferred logical
rows do not own native hosts. `listProgramCellHosts`,
`listProgramCellRetainedHostRefs`, `listProgramCellReleasedHostRefs`, and
`listProgramCellLiveRetainedHostRefs` count fresh cell materialization, resident
compaction, and the attached/pool lifetime. Rebinding a pooled cell does not
increase any cumulative count or the live gauge; destroying that cell returns
the live gauge to its prior value. Attachment moves resident handles from the
physical-cell table into the logical run, and recycling moves them back, rather
than keeping duplicate references in both owners.

Generated fixed-shape list-item resident drivers advertise a values-offset
capability. Fresh list cells without main-thread worklet rewriting therefore
read their row directly from the retained run table instead of allocating a
cell-sized slice; legacy or hand-written drivers keep the zero-based ABI and
receive the old copy. Reuse setters also read the retained table in place, and
eventless fixed-shape rows share immutable empty event/range tables. The profile counter
`listProgramCellValueCopies` records only the compatibility/worklet copies.

Logical list descriptors likewise cache one immutable metadata plan per
resident template. The plan selects only `item-key`, `reuse-identifier`,
`recyclable`, and `defer`; each row reads only the selected dynamic values and
does not copy the root props table or reinterpret unrelated root bindings.
`listProgramItemDescriptorPlanBuilds` and
`listProgramItemDescriptorValueReads` distinguish the template-constant work
from the value-density work.

After a logical list delta publishes, physical-cell settlement resolves current
items through the store's authoritative instance table. It no longer builds a
second whole-list handle map or snapshots each ownership table before cleanup;
pooled tables swap before re-partitioning so cleanup may safely mutate the old
table. `listProgramCellSettlementLookups` therefore scales with materialized
cells, not the number of dormant logical rows.

Terminal list disposal shares one empty item table and disabled callback
sentinels across lists, walks the authoritative cell map without a snapshot,
and allocates its error collection only after the first cleanup fault. A failed
cell remains registered for a later terminal retry while iteration continues to
release the other cells.

Whole-store disposal preserves reverse-handle cleanup order with one scalar
handle snapshot. It does not spread the instance map into an outer array plus
one `[handle, instance]` pair allocation per live instance; failed roots remain
in the authoritative map for the next terminal retry.

A list may demand a physical cell while its logical row is retained but hidden.
Fresh and recycled cells paint that hidden state without native event tokens,
host-ref attachment publication, or main-thread worklet/ref activation. A later
visible transaction installs those resources exactly once; hiding or recycling
the cell disconnects them before the physical owner returns to the pool. This
keeps demand from activating a dormant logical handle merely to clean it up.
Terminal list disposal first replaces native callbacks with inert handlers, then
cleans every physical cell independently. A cell cleanup that mutates and throws
does not prevent sibling cells from releasing, and a later terminal retry keeps
ownership of only the failed cells instead of treating the callback-closed list
as fully disposed.

Creation failure cleanup is also best-effort across ownership classes. If a
prepared main-thread worklet abort fails, native roots are still removed; if a
root removal also fails, the original create/insert error and every cleanup
error are reported together and the compact store becomes terminally faulted.
List callback failures use the same rule instead of replacing the producer
failure with whichever cleanup happened to throw first. A rejected single or
batched demand also releases every cell that the callback materialized before
the failure; batch cleanup continues in reverse order, aggregates cleanup
faults, and retains only failed owners for terminal disposal retry. Cells that
the batch never touched remain under the list's existing terminal owner.

Logical list-item descriptors are cached on their keyed instances. A child
binding update therefore changes the retained value (and an attached physical
cell) without re-expanding static root props or rebuilding every row descriptor.
Only `item-key`, `reuse-identifier`, `recyclable`, and `defer` root-binding slots
invalidate one descriptor and publish native list metadata; structural changes
reuse surviving cached descriptors. Profile builds count cache misses in
`listProgramItemDescriptorBuilds`.

A same-machine production A/B against exact parent `887042796` attributes the
shipping cost instead of the already-stale frozen absolute budget. Preview adds
244 raw / 76 gzip bundle bytes (decoded MTS: 130 / 44); IFR adds 265 raw / 95
gzip (decoded MTS: 151 / 72). The rows-0 inventory adds 680 raw / 370 gzip
overall and 700 raw / 231 gzip on MTS, while BTS raw is unchanged and gzip is
3 bytes smaller. The parent already fails the frozen preview-MTS ceiling at
101,597 gzip bytes versus 82,070; this candidate reads 101,641. Both semantic
checksums remain valid and all available relative ratio guards pass.

The R10 production rows-0 inventory at `f63023d76` plus the working candidate
measures 246,673 raw / 86,109 gzip / 74,684 Brotli bytes for the encoded Lynx
bundle. Its decoded scripts are 82,464 / 25,621 / 22,620 bytes for MTS and
159,748 / 46,231 / 40,454 bytes for BTS (raw / gzip / Brotli). Against exact
parent `887042796`, the encoded artifact is +680 raw / +366 gzip, MTS is +700
raw / +231 gzip, and BTS is unchanged raw and -7 gzip; the Web control is +700
raw / +253 gzip. This distinguishes authored/emitted source, compressed script
bytes, and the encoded TASM bundle. Actual engine bytecode, native load time,
and native execution time are not observable in this Linux build receipt and
remain R11 device evidence rather than inferred claims.

Static creation source is guarded at 1, 8, 32, 128, and 256 hosts by a linear
per-host ceiling, while the complex keyed-component and native-list products
execute their resident programs through the JavaScript host acceptance suites.
The packed consumer separately proves a content-hashed lazy chunk remains an
independent artifact. These controls catch whole-template prefix duplication,
runtime-graph transfer, and accidental lazy inlining; they are build/host
execution evidence, not native latency measurements.

## R10 toolchain boundary

Plain `.ts` and `.js` custom hooks use the same main-thread render-only
capability as `.tsrx` lowering. Effect arguments become `undefined` on MTS, and
pure module-local function declarations or single function-valued declarators
are removed only when all of their surviving reachability begins in those
erased arguments. Helper chains and cycles are handled together. A helper also
used by setup/render remains, and imports plus potentially effectful module
initializers are left to the bundler. BTS remains unchanged.

The clean packed-consumer matrix exercises production automatic selection,
explicit whole-root Universal opt-out, development/HMR configuration, CSS and
CSS Modules, referenced SVG assets, complex custom-hook semantics, native-list
programs, and lazy code splitting. Automatic compact products are selected only
after paired semantic, feature, program, ABI, and root-edge proof. A missing or
mismatched proof fails closed for the complete entry; there is no dynamic
mid-tree Universal fallback and no pair of full runtimes hidden in an eligible
product.

## Transactional publication rules

A Block render drafts hook state, subscriptions, refs, listener ownership,
range templates, and lifecycle work before transport. Rejection restores the
previous accepted state. Layout work publishes only after acknowledgement, and
passive work follows on the root's next microtask. Removing a retained keyed or
branch owner disposes its scope exactly once. These rules apply equally to an
initial mount, an event-driven update, and a parent render.

## ACK pipeline state machine

The Block background owns three versions but permits only one physical frame in
flight. The accepted version is the only state visible to events, refs, effects,
and native callbacks. A sent version owns the core, listener, ref, resource, and
hook journals waiting for its matching ACK. One bounded logical draft may be
prepared beside it; newer state notifications replace that draft instead of
adding an unbounded queue.

Only compiler-proved pure scalar dirty computations may run before the sent
version settles. When no non-empty frame occupies the commit lane, the queued
render computes directly and allocates no detached draft. A prepared hook draft
and its output values are detached, but they do not write a host slot, send a
message, publish a listener/ref, or run lifecycle work. Structural regions,
caller-driven prop renders, scoped row renders, and unknown computations retain
the serialized path. A scalar dependency group that also writes an authored
host-ref slot stays serialized too: refs are absent from the template value map
and must be rebound as one complete ownership snapshot at ACK. If an accepted
render changes the computation closure before the logical draft can apply, the
draft is discarded and recomputed from the new accepted state.

The linearization points are:

1. prepareBatch fixes the sent frame and increments the non-empty round-trip
   count; no later logical draft can mutate it.
2. A matching ACK publishes hook/listener/ref ownership and layout work in
   program order. A pre-ACK reject publishes none of them.
3. complete settles the physical operation. A fault after ACK reports failure
   but cannot roll accepted logical state back.
4. Only after settlement may the latest prepared draft write the next host
   attempt. Duplicate, stale, or foreign ACKs remain protocol errors, and
   teardown waits for both the sent frame and the bounded logical draft.

Profile builds expose blockRenderQueueMaxDepth, blockRenderMerges,
blockRenderPrepares, blockRenderPreparesWhileAck, and blockAckRoundTrips. The
Lynx benchmark reports those beside commit/message counts. Native storm receipts
also declare the every-tick commit contract and record the first visible native
frame separately from final completion; fewer commits alone are not accepted as
an interaction improvement.

A new semantic row is promoted from **Block kernel proved** to **Block selected**
only with all of the following:

1. a compiled `.lynx.tsrx` fixture exercising the authored syntax;
2. Block-vs-Universal public-observation coverage where both implementations
   support the behavior;
3. rejection/abandonment coverage proving no listener, ref, subscription, hook
   state, or effect is published early;
4. paired compiler metadata and application-selection tests; and
5. production build evidence that the selected graph contains the resident
   program and omits the Universal reconciler.

The machine-readable production gate is
`LYNX_BLOCK_SUPPORT_MATRIX` in
`packages/rspeedy-plugin-octane/src/program-coverage.js`. This document is the
human contract; if the two disagree, the selector must remain conservative until
the mismatch is fixed.
