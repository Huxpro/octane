# Lynx Block semantic support

Status: implementation contract for roadmap issue #378. This document describes
the current repository state; it is not a claim that issue #378 or the Lynx
roadmap is complete.

## Reading the matrix

The implementation has three distinct outcomes:

- **Block selected**: the paired main/background application graph is completely
  addressed, every compiler fact is supported by the versioned Block matrix,
  and the production build selects the Block application and compact compiled
  program product.
- **Block kernel proved**: focused source tests exercise the Block component
  core, but the production selector still fails closed for that syntax. An
  ordinary application therefore takes the whole-entry Universal compatibility
  path until a paired compiler/build test proves the selection safe.
- **Rejected by Block**: an explicit Block build or a value that violates an
  admitted invariant receives a source-attributed build reason or a stable
  runtime diagnostic. The core never renders an unsupported region as empty and
  never publishes half of it.

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
| `useState`, `useRef`, `useCallback`, `useEffect`, and `useSyncExternalStore` | Block selected | Hook cells publish only after host acceptance; layout and passive cleanup are retained. |
| Last-child keyed `@for` with inline-host or local-component rows | Block selected | Keyed identity, LIS moves, row-local hooks, `@for` component rows, and sparse dirty-row updates are covered. |
| Context propagation through a keyed move | Block kernel proved | Provider values and `useContext` reach retained row scopes; `useContext` is not yet in the production selector's runtime-name set. |
| `@for … @empty` | Block kernel proved | Empty is a separate retained lifetime with rollback, effects, events, removal, and remount; the selector still records `keyed-range-empty-branch`. |
| `@if` and `@switch` | Block kernel proved | A single region retains the selected arm, state, handlers, and cleanup; the selector still reports the authored template feature. |
| Local component boundaries, component children, and render props | Block kernel proved | Transparent component chains resolve to the eventual host plan and preserve stateful descendants; the selector still reports non-row component sites. |
| Component-valued host holes | Block kernel proved | Component identity plus an explicit authored key owns the region lifetime; component → empty → component remounts cleanly. |
| `memo()` | Block kernel proved | Prop comparisons may skip parent updates, while a local state write still renders with the latest accepted props; the selector has not admitted the runtime export. |
| Compiler-proved dirty hook slots and binding groups | Block selected | Owner-local invalidation reaches only dependent computations and program slots; structural changes retain the full reconcile path. |
| Main-thread props and thread functions | General Block application only | The Block transport can carry them, but the compact compiled-program product fails closed and keeps the general application product. |
| Ordered host spreads with unknown property names | Whole-entry Universal compatibility | `UniversalHostPlan.propsSlot` has no resident Block prop-name table. Static named props remain Block-native. |
| Generic renderable holes (primitive/array/fragment shape changes) | Whole-entry Universal compatibility | The compiler cannot yet prove a stable structural region kind, and Block does not infer one from the first value. |
| Host refs, native `list`, Activity/visibility, `@try`/Suspense, and portals | Whole-entry Universal compatibility | These retain the existing Universal lifecycle until separate Block transaction and identity proofs land. |
| Nested keyed ranges | Rejected by Block | An inner range needs retained state scoped to each outer key; the current core diagnoses the nesting before publication. |
| A keyed range followed by a dynamic/static sibling | Rejected by Block | Correct insertion requires a compiler-emitted static `(instance, slot)` anchor. Delta protocol v2 reserves the address shape, but the producer has no `a` slot yet. |
| Insertion effects | Rejected by Block | The Block transaction has no pre-mutation publication phase. |
| A row whose root is non-host, has a root event, or is not compile-time host structure | Rejected by Block | The row program cannot currently name the parent-inserted root and its own root event independently. |
| Unknown compiler/runtime proof version or graph mismatch | Whole-entry Universal compatibility | The selector fails closed and records structured reasons in the build asset. |

## Transactional publication rules

A Block render drafts hook state, subscriptions, refs, listener ownership,
range templates, and lifecycle work before transport. Rejection restores the
previous accepted state. Layout work publishes only after acknowledgement, and
passive work follows on the root's next microtask. Removing a retained keyed or
branch owner disposes its scope exactly once. These rules apply equally to an
initial mount, an event-driven update, and a parent render.

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
