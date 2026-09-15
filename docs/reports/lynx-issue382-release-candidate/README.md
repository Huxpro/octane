# Lynx R10 production-toolchain release candidate

This is the source/build qualification report for roadmap issue #382. The
candidate is based on merged `new-lynx@f63023d76`; the implementation diff is
the R10 commit layered on that merge. The comparison parent for accumulated
R9/R10 product cost is `887042796`. This report does not close #291 or #383 and
does not claim Android/iOS correctness or performance.

## Product matrix

| Entry/configuration | Selected product | Production evidence |
| --- | --- | --- |
| Ordinary general/unsupported application | whole-entry Universal | Paired MTS/BTS build remains the fail-closed compatibility lane. |
| Complex keyed/context/memo/branch application | Block + compiled program | Paired program, semantic, and feature proofs; direct MTS native creation; compact-only event transport; no general Universal application modules. |
| Fixed-shape keyed native list | Block + compiled program | Paired `list`/`list-item` programs, logical list ownership, emitted CSS/CSS Module/SVG assets, compact-only transport. Native-list IFR stays deferred to the first compact frame by contract. |
| `lazy(() => import(...))` entry | whole-entry Universal | Pending arm exists in both decoded programs and the resolved component remains a distinct content-hashed async bundle. Block fails closed because lazy ownership is outside matrix version 13. |
| `core: 'universal'` | whole-entry Universal | Explicit root-level compatibility opt-out. |
| Development/watch/HMR | Universal | Debug transport and reload behavior take precedence over automatic production compaction. |

For both compact applications the retained module graph excludes the general
`application-selection`, `client-driver`, general `main-renderer`, general
main-thread application selector, main worklets, and their host-command adapter
closures. It retains the Block component core, compiled-program application
controller/store, compact transport, normalized PAPI boundary, and the shared
hook/attempt semantics required by authored behavior. Type names inherited from
the shared versioned IR are not evidence of runtime reachability; the gate
captures Rspack's retained modules and executes the compiled programs.

## Ordinary custom-hook split

The complex application imports a normal `custom-hooks.ts`, rather than hiding
all behavior in `.tsrx`. A marker in its background-owned effect and pure helper
is present in decoded BTS and absent from decoded MTS. The source transform:

- erases effect arguments only for the Lynx main-thread render-only capability;
- follows pure module-local helper chains and removes them when no active code
  reaches them;
- retains helpers shared with setup/render, module initializers, imported
  bindings, worklets, and lazy modules; and
- preserves line count in the surgical plain-module path so downstream source
  positions remain stable.

Focused compiler tests cover both full AST printing and the surgical slot-hook
path. The packed archive consumer proves that the behavior survives published
source resolution, worker serialization, two Rspack layers, optimization, TASM
encoding, and decoding.

## Artifact and scaling evidence

The production rows-0 inventory was measured on Linux 5.15 with Node v22.22.2,
the pinned current toolchain, and gzip level 9:

| Boundary | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Web control bundle | 246,275 | 72,216 | 58,542 |
| Encoded Lynx bundle | 246,673 | 86,109 | 74,684 |
| Decoded MTS script | 82,464 | 25,621 | 22,620 |
| Decoded BTS script | 159,748 | 46,231 | 40,454 |

Against `887042796`, encoded Lynx moves +680 raw / +366 gzip, decoded MTS
+700 raw / +231 gzip, decoded BTS +0 raw / -7 gzip, and the Web control +700
raw / +253 gzip. The cost therefore has not been hidden in BTS. SHA-256 values
are recorded by the inventory receipt; the working-tree receipt itself is not
committed because its dirty bit correctly describes the uncommitted candidate.

The repository additionally checks emitted static topology at 1, 8, 32, 128,
and 256 hosts under a linear 256-byte-per-added-host source ceiling. Complex
templates, repeated keyed components, and native-list rows execute through the
compiled-product JavaScript-host suites. The packed lazy entry produces a
separate async bundle whose marker is verified in either encoded byte order.
These are distinct observations:

- emitted JavaScript source growth;
- gzip/Brotli-compressed decoded scripts;
- complete encoded `.lynx.bundle` bytes; and
- compiled-program behavior in the JavaScript host.

Lynx VM bytecode size, native chunk load latency, and native execution latency
are not exposed by this build-only environment. They are intentionally not
estimated from decoded JavaScript and remain mandatory Android/iOS R11 cells.

## Post-candidate current-head graph requalification

The frozen candidate above remains the input to the original R11 decision. A
newer local product head, `514a62b10`, contains the subsequent R9 cleanup series
and a paired-proof Block feature specialization. For a one-shot production
application, the selector now rebuilds `block-component.ts` against a
structural-only capability module only when every authored module in both Lynx
thread graphs proves that Activity, error/Suspense boundaries, portals, and
transition APIs are absent. Development, incomplete/ineligible graphs, and any
application requiring one of those semantics retain the full runtime.

The same-toolchain rows-0 A/B against clean parent `d4d1e6fec` measured the
current-head change as follows:

| Boundary | Parent raw | Current raw | Raw delta | Parent gzip | Current gzip | gzip delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Web bundle | 270,581 | 263,778 | -6,803 | 79,769 | 77,624 | -2,145 |
| Encoded Lynx bundle | 269,943 | 263,149 | -6,794 | 94,303 | 92,060 | -2,243 |
| Decoded MTS script | 86,495 | 86,495 | 0 | 26,911 | 26,911 | 0 |
| Decoded BTS script | 178,700 | 171,906 | -6,794 | 51,959 | 49,879 | -2,080 |

The MTS SHA-256 is byte-identical across the A/B. Full Lynx tests passed
1,174/1,174 and the full Rspeedy plugin suite passed 115/115, including
structural selection, full-feature retention, packed consumers, and production
bundle decoding. The exact command, product-source digest, Brotli values, and
the stale proportional-owner-budget caveat are recorded in
[`r10-block-feature-specialization.md`](../../../benchmarks/lynx-bundle-size/results/r10-block-feature-specialization.md).

This requalifies the current production graph boundary; it does not promote the
new head to an R11 release candidate without a fresh native campaign.

The post-candidate public compiler contract was also rechecked against the
implementation. Runtime registry normalization and both Lynx presets already
selected `target: 'lynx'`, but the published `octane/compiler` and
`octane/compiler/vite` declarations omitted that member from their closed target
unions. The declarations now share an exported `CompileRendererTarget` type that
includes `lynx`, and a package typetest consumes the target through both public
entry points. The Octane package build reproduced the same union in
`dist/compiler`; this exposes the existing backend to typed integrations and
does not introduce another lowering or change product selection.

## Relationship to upstream #1055

The release candidate follows upstream's natural seams: a shared compiler-owned
IR feeds both threads; target/thread/backend signature participates in caching;
paired ABI/program digests are checked before registration; static creation and
update routing are compiler-produced; effects stay background-owned; and the
normal compact product bypasses Universal host-plan interpretation and host
records.

Octane's branch retains deliberate implementation differences. It uses a
resident compact program when that is smaller than duplicating generated native
functions, keeps Lynx PAPI/transport/list recycling as native owner boundaries,
and selects the product only for an entire proven root. It does not introduce a
React host config, DOM abstraction, or mid-tree interpreter fallback merely to
mirror an unimplemented upstream interface. Upstream issue #1055 was still open
and had no integration contract to target when this report was refreshed.

## #290/#291 handoff and R11 gates

R10 completes the publishable source/build side of #290: two-layer Rspeedy and
Rspack integration, worker-safe backend loading, explicit product selection,
ABI failure behavior, CSS/assets, lazy chunks, dev/HMR configuration, external
tarball consumers, and source-only package exports. Existing #357 default MTS
backend work is reused rather than reimplemented.

The remaining release decision belongs to #291/#383. Before switching the
ordinary default, R11 must freeze comparator commits and workloads, then record
Android and iOS separately for output/identity/events/effects followed by
uninstrumented AB/BA first paint, ready/adoption, first real tap, sparse and
keyed updates, native-list reuse, teardown/GC, wire bytes, and bundle/chunk load.
Failures and DNF cells remain visible. Only after those gates pass may the
default switch and old-path retirement be reviewed as a separate change; Web or
JavaScript-host success is not a substitute.

## Reproduction gates

```bash
pnpm exec tsgo --noEmit -p packages/octane/tsconfig.json
pnpm exec tsgo --noEmit -p packages/rspack-plugin-octane/tsconfig.typecheck.json
pnpm exec tsgo --noEmit -p packages/rspeedy-plugin-octane/tsconfig.typecheck.json
pnpm vitest run --root . --project octane packages/octane/tests/external-hook-slot.test.ts packages/octane/tests/universal-renderer.test.ts
pnpm vitest run --root . --project lynx packages/lynx/tests/main-thread-emit.test.ts packages/lynx/tests/compiled-program-product-application.test.ts
pnpm vitest run --root . --project rspeedy-plugin packages/rspeedy-plugin-octane/tests/build.test.ts packages/rspeedy-plugin-octane/tests/packed-consumer.test.ts
TMPDIR="$PWD/.tmp-r10" OCTANE_INVENTORY_CALIBRATE=1 node benchmarks/lynx-bundle-size/inventory.mjs
```

The final changeset/commit should also pass scoped formatting, `pnpm sync`, and
the repository's supported full test command with sufficient Node heap.

## Local validation receipt

On 2026-09-13 the focused commands above passed: 141 Octane compiler tests, 71
Lynx emitter/product tests, 12 Rspeedy build/packed-consumer tests, the three
package typechecks, scoped formatting, `pnpm sync`, and the production inventory.

The first 8 GiB full-workspace run completed 27,276 tests successfully and
reported 15 failed files after 173 `EMFILE: too many open files` watcher errors.
That run also placed its temporary directory inside the checkout, invalidating
portable-path and external-consumer assertions by construction. After removing
the test-created files and moving temporary work outside the checkout, all 15
reported files passed in project-scoped serial reruns (210 assertions total,
including the full packed consumer). This is recorded as resource-limited full
run plus complete failure-set recovery, not mislabeled as one clean full run.
