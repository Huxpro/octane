# lynx-table

The unified cross-framework table benchmark for Octane's Lynx renderer: the
krausest-style row table (`app/`, mirrored operation-for-operation from the
Vue Lynx unified benchmark matrix) driven through create / update-every-10th /
select and the update (×50) / select (×30) storms, where every storm tick runs
in its own MessageChannel macrotask so app-layer batching cannot merge them.

It has two halves with different claims:

## 1. Deterministic wire-cost gates (`run.mjs`, CI-gated)

```bash
node run.mjs [iterations]          # LYNX_TABLE_SCALES=1000,10000 by default
```

Builds the app plus the real dual-thread path (background root, async
transport, main-thread receiver, host driver) with the Octane compiler, drives
the ops through real native tap tokens over an in-process ContextProxy pair,
and reports per-operation **command counts**, **serialized commit bytes**, and
**Row component render counts**
from the `__OCTANE_LYNX_PROFILE__` counters (`@octanejs/lynx`'s permanent,
build-flag-gated wire profiler — `globalThis.__OCTANE_LYNX_PROF` on each
thread). Counts are deterministic for a fixed app and interaction sequence, so
they carry ratio guards in `../baselines/ratios.json` against the
`changed-rows-model` target — the commands and component renders a change of
that size strictly implies. Creating any number of component-owned rows must
emit one shared-template run. Selection allows two Row body executions;
update-every-10th allows `ceil(rows / 10)`. The Row counter is compiled out of
normal browser and production builds. These gates keep wire payload and render
breadth proportional to change size, not tree size. The suite runs from the
root runner:

```bash
node benchmarks/bench.mjs --only lynx-table --ratios
```

Because the in-process ContextProxy is synchronous, acknowledgements return
immediately and the storm gates see one commit per tick; the asynchronous
"renders while a commit is in flight coalesce into the next commit" contract
is pinned separately in `packages/octane/tests/universal-transport.test.ts`.
This harness starts directly on the background renderer; production
first-screen adoption and the subsequent capability handoff are covered by the
Lynx first-screen integration tests and the real-browser harness below.

## 2. Lynx-for-Web wall-clock harness (`web/run-web.mjs`, informational)

```bash
node web/run-web.mjs               # octane + all vendored references
node web/run-web.mjs --scales 1000,10000,30000 --reps 3 --cells octane,vue-vdom
```

Builds the app's `main.web.bundle` with the repo's own Rspeedy toolchain
(`scripts/build-app.mjs`), serves it and the vendored reference bundles into a
`<lynx-view>` (`@lynx-js/web-core` + headless Chromium via Playwright), drives
real clicks, waits for shadow-piercing composed-DOM predicates, and emits a
markdown report (`results/web.md`) with medians of n≥3 (fresh page per
rep) plus ratios versus the `vue-vdom` cell. Absolute milliseconds are
host-bound; the ratios are the portable claim — the report prints both.

### Reference cells

`reference/{vdom-ifr-et,vapor-ifr,react}/main.web.bundle` are vendored
black-box fixtures: ReactLynx (`@lynx-js/react`), the Vue vdom top config
(`vdom +b +ifr`, legacy id `vdom-ifr-et`), and the Vue vapor top config
(`vapor +b +ifr`, legacy id `vapor-ifr`), built once from Huxpro/vue-lynx
branch `claude/lynx-implementation-review-n2r0ie`:

```bash
pnpm install && pnpm --filter "vue-lynx..." build \
  && cd packages/benchmark \
  && node harness/build-unified.mjs --only=vdom-ifr-et,vapor-ifr,react
```

then only the `.web.bundle` files are copied here. `reference/manifest.json`
records the source commit. If a reference bundle is absent the harness prints
"not measured" for that cell and continues — it never substitutes a number
from a degraded run.

### Measurement honesty rules (non-negotiable)

- No octane-only bespoke workloads: the app mirrors the reference apps'
  workload operation-for-operation, and `web/driver-client.mjs` is the
  byte-identical instrument for every cell.
- Every published number comes from the same instrument that measured the
  references on the same host in the same session.
- A cell that cannot be driven end-to-end is reported "not measured", never as
  a number from a degraded run.

## 3. Stage-decomposition instrument (`stages/run.mjs`, informational)

```bash
node stages/run.mjs --smoke --rows 1000 --allow-busy-host
node stages/run.mjs --reps 5
```

The reportable command builds control and `__OCTANE_LYNX_PROFILE__` variants,
requires `n >= 5`, opens a fresh page for every sample, alternates control and
profile order `AB / BA / AB / ...` in one host window, and runs one vendored
`vue-vdom` create sample after each pair. It records CPU/OS/Node/Chromium, host
load at both ends, medians, min-max spread, raw milliseconds, shares, and
same-window ratios. Do not run other builds, tests, browsers, or benchmark
processes during that window. The default quiet-host preflight rejects a
one-minute load average above `0.5 * logical CPUs`; `--allow-busy-host` exists
only for non-reportable smoke/debug runs or an explicitly disclosed exception.

The reusable analyzer and protocol tests are:

```bash
node --test stages/*.test.mjs
```

### Observation contract

Every directly timed interval is exclusive. The analyzer rejects a sample when
direct intervals exceed its wall clock instead of normalizing or guessing.

**FCP@10k** starts when the shared browser init hook assigns the hidden
main-thread iframe's Blob script URL (before browser load/parse/evaluation) and
ends at the first animation-frame observation where the shared composed-tree
driver sees all 10,000 rows:

1. `mt_slice_eval`: Blob script assignment through the first `root.render()`
   call, including browser load, parse, and evaluation.
2. `plan_interpretation`: time inside first-screen `renderPlanNode` walks.
3. `papi_element_creation`: time inside Element PAPI page/element/list creation
   calls.
4. `layout_flush_residual`: the exclusive wall-clock remainder. Web Core does
   not expose a stable boundary separating PAPI prop/insertion work,
   `__FlushElementTree`, DOM publication, style/layout, and observer-frame
   delay, so those costs remain named and visible rather than guessed apart.

Raw view-attach FCP is also reported for control/profile overhead and same-run
comparison, but decode/fetch before slice evaluation is outside the four-stage
attribution.

**create@10k** starts at the byte-identical page driver's `pointerdown` boundary
and ends when that same driver sees 10,000 rows:

1. `bg_replay`: native-event delivery through completion of background render,
   diff, command staging, and plan folding, stopping before outbound self-check.
2. `wire_clone_transfer`: the existing ContextProxy `dispatchEvent` interval.
3. `mt_expand`: main-thread wire-shape preparation before host preparation.
   Historical plan-wire samples measure `instantiate` expansion; rebased
   template-program samples measure incremental-run capability validation and
   freezing under the same archived profile field.
4. `papi_element_creation`: time inside Element PAPI page/element/list creation
   calls.
5. `layout_flush_residual`: the exclusive wall-clock remainder, including
   event delivery before replay, validation/prepare, non-create PAPI work,
   flush/layout, scheduling, and observer-frame delay.

Snapshots are collected from the real hidden main-thread iframe and background
worker, copied as numeric own properties, and parsed without prototype or
`instanceof` checks. The profiler extends the existing
`__OCTANE_LYNX_PROFILE__` record; its runtime branches are absent when the
define is false, and `stages/analyze.test.mjs` gates that production fold
boundary with byte-equal bundled output against a control entry.

Downstream verdicts use a declared direct-share gate: `GO` requires a directly
observed target segment (or target segment sum) to contribute at least 10% of
the operation's median attribution. Residual time never authorizes a step.

## 4. Element PAPI boundary instrument (`stages/papi-run.mjs`, informational)

```bash
node stages/papi-run.mjs --smoke --scales 1000 --allow-busy-host
node stages/papi-run.mjs --reps 5 --scales 1000,10000,30000
```

Section 3 decomposes Octane from inside Octane, so its segments stop at the
Element PAPI call and everything past that — prop and insertion work,
`__FlushElementTree`, Web Core DOM publication, style/layout, observer delay —
lands in one `layout_flush_residual`. That residual cannot be compared against
a framework whose internals are not instrumented, which is what an FCP question
about ReactLynx needs.

This harness measures the other side of the same call. `@lynx-js/web-core` runs
the main-thread script in a hidden same-origin iframe realm and installs every
Element PAPI entry point onto that realm's global object with a single
`Object.assign` issued from the page. `papiInstrumentJs` in
`web/driver-client.mjs` wraps that one assignment, so the probe observes the
**host boundary** rather than a framework: the identical instrument applies to
Octane, ReactLynx, and the Vue cells by construction. No framework is patched,
no reference bundle is rebuilt, and the vendored bundles keep the hashes the
featured runs recorded.

Three page variants run interleaved in one host window, rotating position
across repetitions so no variant sits at a fixed place in the sequence:

- `control` — no probe; the wall clock the other two are measured against.
- `counts` — host call counts, flush cadence, and start delay, with no per-call
  clock read, so its wall clock stays representative.
- `timed` — adds the per-call brackets that exclusive host time needs.

Counts and cadence are read from the `counts` build and host self time from the
`timed` build. Both builds count identically by construction, and the report
prints that agreement per cell as the control on the timed build's cost: if a
1.0× pass and a costlier pass disagree on what the framework called, the timed
shares describe a different workload and the numbers do not stand.

### Observation contract

Each timed window obeys one identity:

```
wall = start_delay + Σ host-group self time + off_boundary
```

`start_delay` is the observed gap from the window's start boundary to the first
host call. Host groups (`papi_create`, `papi_props`, `papi_events`,
`papi_topology`, `papi_read`, `papi_flush`, and `papi_other` for an entry point
this repo has not classified) are directly observed and exclusive: a host call
re-entered through a framework callback is counted once, never twice.
`off_boundary` is the named exclusive remainder — framework script, the
browser's own style/layout/paint and observer-frame delay, and the timed
probe's own bookkeeping — because the host exposes no boundary separating
those. `__FlushElementTree` self time covers only the synchronous publication
Web Core performs inside it.

Two windows are measured per page load, both through the byte-identical page
driver: **startup**, from the main-thread slice start to the first composed
paint of the app shell, and **create@N**, from `pointerdown` to all N rows in
the composed tree. Octane additionally carries the pre-populated auto-rows
bundles, so its **FCP@N** is measured directly; a pre-populated first screen is
a build-time define of the app source, so the vendored references have no such
variant and are reported "not measured" rather than substituted from another
window.

A single host call is far below the browser's clock granularity, which the
report records: only per-kind aggregates over many calls carry meaning, and no
per-call latency is claimed.

Measurement and reporting are separate. `papi-run.mjs` writes the evidence
(`results/papi-<rows>.json`, raw samples included); `papi-report.mjs` renders
`results/papi-boundary.md` from it and can be re-run over the checked-in JSON,
so a wording or attribution change never costs another measurement window:

```bash
node stages/papi-report.mjs
```

`papi-predicate-cost.mjs` records what the two window predicates themselves cost
on a settled tree at each scale. The FCP predicate is the expensive composed-tree
walk, so that bound belongs beside the report rather than in a reader's head —
`x.fcp` samples its timestamp before the walk and `x.arm` samples after its
check, which the recorded numbers let anyone verify.

Delta attribution runs Octane against each reference and splits the gap into
five directly observed owners — publication op count, flush cadence,
first-paint scheduling, per-element stream shape, and off-boundary work. The
count and rate owners come from an exact split,

```
Δ(host op time) = (Δcalls × reference ms/op) + (subject calls × Δ ms/op)
```

so "the subject issues more host calls" and "the subject's calls cost more
each" never collapse into one lump. The same 10%-of-delta gate applies: a
candidate owner is authorized only by a positive directly observed
contribution, and the report prints the certified control and counts-build
deltas beside the timed one.

## Claims and non-claims

Command counts and commit bytes are Octane-owned costs and are gated. The
in-process milliseconds and the Lynx-for-Web wall clock are CPU/browser-host
costs — no native paint, layout, adoption, or device claim. Native gates
remain the separate Android/iOS story (`docs/lynx-native-renderer-plan.md`).
