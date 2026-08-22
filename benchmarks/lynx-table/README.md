# lynx-table

The unified cross-framework table benchmark for Octane's Lynx renderer: the
krausest-style row table (`app/`, mirrored operation-for-operation from the
Vue Lynx unified benchmark matrix) driven through create / update-every-10th /
select / clear and the update (×50) / select (×30) storms, where every storm
tick runs in its own MessageChannel macrotask so app-layer batching cannot
merge them.

App-layer batching is the only thing that separation rules out. A renderer is
still free to coalesce, and both Octane cells do — see
[What the storm cells actually measure](#what-the-storm-cells-actually-measure),
which is where the storm numbers have to be read from.

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

### Who asks about a mounted node

A second reference target, `eager-selector-model`, measures one thing the
command counts cannot see: how many `nodes-ref` selectors the main thread writes
while mounting the rows. The model is one write per element node mounted — what
the main thread costs if it stamps every node whether or not anything can ever
query it.

| rows | element nodes mounted | selector writes | announced public instances |
| ---: | ---: | ---: | ---: |
| 1,000 | 4,000 | **0** | 0 |
| 10,000 | 40,000 | **0** | 0 |

The zero is the contract, and the last column is why it is correct rather than
lossy. A `nodes-ref` selector exists to answer a public-instance query, and a
commit composed under the negotiated lazy-public-instance capability announces
every host it will query with `ensure-public-instance` — ordered after the
creates in the same commit, so a host that needs a handle still gets its selector
before the batch ends. This app holds no `ref`, no host lifecycle, and no
main-thread callback, so it announces none and pays none.

The commit, not the session, is what carries that promise, and `wireRegime`
records which commits made it. A background that composes a batch before the
main-ready reply granting the capability reaches it names no hosts in that batch
however the session was negotiated, so the main thread installs eagerly for it;
this harness is synchronous end to end, so every one of its commits is composed
after the handshake and announces. What the other order costs is measured
separately, in the first-screen selector harness below.

That makes these numbers the best case, not the average. An app whose rows carry
a ref announces one host per row and pays one write for each, and the ratio rises
to match. What the 0.01 ceiling catches is the regression that used to be here:
installing on every node regardless of who asked, which reads as 1.00x.

The run line prints this as `create=1 (1000r, 0/4000 refs)`. `meta.rows_*` also
records `wireRegime` — the negotiated capabilities, and the acknowledgement,
public-instance, and announcement regime every commit went out under — because an
install count is unreadable without knowing whether the commit announced at all.

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

# wire counts beside the milliseconds: serve the OCTANE_LYNX_PROFILE=1 bundles
OCTANE_LYNX_PROFILE=1 node scripts/build-app.mjs
node web/run-web.mjs --cells octane --counter-build

# "did this regress since commit X": build X's bundle in a worktree and drive
# both through one instrument in one window
node web/run-web.mjs --cells octane --cell-bundle octane-x=/path/to/x/main.web.bundle
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

### The `octane-block` cell (issue #103 B0)

```bash
BENCH_CORE=block node scripts/build-app.mjs               # scoped writes
BENCH_BLOCK_MODE=reconcile BENCH_CORE=block node scripts/build-app.mjs
node web/run-web.mjs --cells octane,octane-block --scales 1000,10000 --reps 5
```

The same application entry, the same page driver, and the same bundle recipe,
built with `pluginOctane({ core: 'block' })` so the issue-#103 Block core drives
background updates instead of the universal one. One bundle carries exactly one
core: `__OCTANE_LYNX_BACKGROUND_CORE__` folds in `app/src/index.ts`, so the
`universal` build carries none of `app/src/block-program.ts` and none of the
Block core behind it. The build flag is therefore the only variable, which is
what makes `octane-block ÷ octane` a same-window A/B rather than a comparison of
two applications that resemble each other.

Four things must travel with any number from this cell:

- **It is an architecture ceiling, not a framework measurement.** The Block core
  has no component layer yet — no hook cells, so a compiled `.tsrx` component has
  no program to be — so the cell is driven by a hand-written block program
  (`app/src/block-program.ts`), exactly as `block-workload.ts` and `prototype/`
  are. `octane` is the second number and neither is quoted without the other.
- **Two drive modes.** `octane-block` writes the slot that changed, by key, the
  way a lowering with per-row reactive cells would. `octane-block-reconcile`
  hands the whole next list to the keyed reconciler, the way `setRows(next)` does
  today. Build both before quoting either: reporting only the first credits the
  Block model with a win that belongs to the scoped write. Structural operations
  (create, swap, remove) are the same in both.
- **The first screen is not comparable.** The main-thread first-screen program is
  the same either way, but the Block core has no adoption story for it: its first
  commit mounts its own tree, main finds a mismatch and repairs, and the painted
  first screen is discarded. FCP for this cell measures that repair rather than
  adoption, so it is not an octane-vs-block comparison of the same path. The
  table operations are: `run-web.mjs` waits for the mount and then `settle()`s
  before the first click, so `create` and everything after it run on a settled
  tree — the block cell simply enters from a repaired tree instead of an adopted
  one.
- **The storm cells and `clear` are not where this cell wins.** Both cores
  coalesce a storm rather than paying per tick, and on `selectStorm` the
  universal one coalesces harder — see
  [What the storm cells actually measure](#what-the-storm-cells-actually-measure)
  for the counts and for why a storm ratio may not be carried between sessions.
  `clear` is the one op where the block cell is consistently the slower of the
  two — 1.27× and 1.24× at 10,000 rows in the two sessions recorded under
  `prototype/results/web-b0-recheck*` — while shipping 20% fewer host commands
  for it (80,000 against 100,000). Measured, unexplained, and open.

`prototype/run-fcp.mjs` picks the cell up automatically once
`app/dist-block-rows<N>/main.web.bundle` exists.

### What the storm cells actually measure

The storms exist so a mutation cell cannot be won by batching: each of the 50
update ticks and 30 select ticks is posted through its own `MessageChannel`
macrotask, so nothing in the app can merge them. That rules out app-layer
batching and nothing else. A renderer may still coalesce — a tick that renders
while a commit is in flight folds into the next commit — and both Octane cells
do, heavily. Measured at 10,000 rows with `--counter-build`
(`prototype/results/web-b0-recheck-counts.*`):

| op | cell | bg commits | of those, empty | host commands |
| --- | --- | ---: | ---: | ---: |
| updateStorm (50 ticks) | `octane` | 7 | 3 | 4,000 |
| updateStorm (50 ticks) | `octane-block` | 3 | 0 | 3,000 |
| selectStorm (30 ticks) | `octane` | 7 | 6 | **2** |
| selectStorm (30 ticks) | `octane-block` | 2 | 0 | **32** |

Read those two `selectStorm` rows before quoting either cell. Thirty ticks reach
the host as **two** commands on the universal core — precisely the difference
between the tree before the storm and the tree after it — so every intermediate
selection renders and none of it is ever spoken. The block core emits eagerly
and supersedes only within the frame it is filling, so it ships 32: one per
distinct host its ticks touched. **The cell that coalesces harder here is
`octane`, not `octane-block`**, and neither cell's storm number is a smaller
job dressed up as a faster one — but the storms are not 30 or 50 discrete
paints for anybody, and a reader who assumes they are will misread every number
in the column.

Two consequences travel with any storm figure:

- **A storm ratio is same-window or it is nothing.** How much coalesces is a
  race between the tick and the commit round-trip, and that race moves with host
  speed and load: `octane`'s `selectStorm` commit count ranged 4–9 inside one
  n=5 session on one host. The B0 window recorded `selectStorm` at 0.83× and a
  later window on a different host recorded 1.31× from unchanged code. Carrying
  a storm ratio between sessions measures the hosts.
- **A cross-framework storm comparison is not equal work.** The reference cells
  are vendored black boxes with no counters, so what they coalesce cannot be
  stated. A storm ratio against one of them compares two unknown coalescing
  regimes, not two speeds at the same job, and should be quoted with that said.

`create`, `update10th`, `select`, and `clear` are one commit each and carry none
of this: they are single state changes and the counts are invariant.

### Measurement honesty rules (non-negotiable)

- No octane-only bespoke workloads: the app mirrors the reference apps'
  workload operation-for-operation, and `web/driver-client.mjs` is the
  byte-identical instrument for every cell.
- Every published number comes from the same instrument that measured the
  references on the same host in the same session.
- A cell that cannot be driven end-to-end is reported "not measured", never as
  a number from a degraded run.
- Cells are interleaved `AB / BA / AB / ...` across repetitions, so host drift
  over the run cannot land on whichever cell went second. The report records
  one-minute/five/fifteen load at both ends of the window; unlike the stage
  harness this instrument records the load rather than gating on it, because it
  also serves the cross-framework chart, and a reader cannot judge a same-window
  ratio without knowing how quiet the window was.
- Deterministic floor counts are reported separately from milliseconds and
  carry across hosts and sessions; their spread must be 0. A count that models
  the architecture is reported beside the count the fixture actually incurred,
  never in place of it.

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
and ends when that same driver sees 10,000 rows. The mutation cells
(`update10th`, `updateStorm`, `select`) share the same boundary and stages, and
end when their own settle predicate resolves; their `bg_replay` window is split
into `bg_prepare` (`UniversalRoot.prepare()` — render, reconcile, host-batch
construction, gated on the transport's replay-window flag so first-screen
preparation stays out) and `bg_replay_other` (the remainder of the window:
event delivery, the handler, scheduling, and the commit hand-off).

1. `bg_replay`: native-event delivery through completion of background render,
   diff, command staging, and plan folding, stopping before outbound self-check.
   In mutation-cell reports this appears as `bg_prepare` + `bg_replay_other`.
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

## 4. First-screen selector harness (`first-screen-selectors.mjs`, on demand)

```bash
node first-screen-selectors.mjs --scales 1000,10000 --reps 2
pnpm bench:first-screen-selectors -- --out prototype/results/first-screen-selectors
```

The gates above measure a first screen whose commit was composed after the
handshake, because this chassis installs its main thread before the first render
and its wire is synchronous. A production Lynx background bundle starts the
other way round: it renders and composes its first batch before the main-ready
reply reaches it. This runner drives the same app, the same chassis, and the
same counters through two arms that differ in one thing — whether the main
thread exists when the background first renders — with the table already
populated at mount so the first commit carries the rows rather than an empty
shell.

| rows | arm | element nodes | selector writes |
| ---: | --- | ---: | ---: |
| 1,000 | before-render | 4,029 | **0** |
| 1,000 | after-render | 4,029 | **0** |
| 10,000 | before-render | 40,029 | **0** |
| 10,000 | after-render | 40,029 | **0** |

Both arms are zero because a background names the hosts it will query from what
it knows while composing, rather than from a reply it has not received, so its
first batch announces like every other. That is what this harness exists to
hold: when the announcement waited on the negotiated capability instead, the
after-render arm read **4,028** and **40,028** — every node but the page.

**These arms describe the background-commit path, not a default production
first screen.** `packages/rspeedy-plugin-octane/src/main-thread-entry.js`
installs the main thread with `firstScreen: true`, so an app built by the plugin
paints its first screen through main-thread direct emission and the background
adopts what was painted. Both of those install a selector on every node by
construction, for reasons recorded at their call sites, and neither consults a
commit's announcement. Measured in Chromium at 10,000 rows, a plugin-default
build reads **40,028** selector attributes whether or not the background
announces — the same number, and the same first paint to within 0.2 ms. The
arms above therefore bound what announcing is worth wherever the background owns
the first commit: a `<list>` topology direct emission declines, a host that does
not enable the first screen, or any commit after the first.

The report records each arm's announcement regime beside its install count,
because the count is unreadable without it: `announced-v1` is the commit
promising it named every host it will query, and `<unannounced>` is a commit
that could not — a peer too old to announce at all.

Everything reported is a count, so no quiet host is needed and no wall clock is
measured; the runner fails if two repetitions of a cell disagree or if an arm
did not paint the rows it claims. `prototype/results/first-screen-selectors.*`
is the committed record.

**What the counts are worth in wall clock: not much, on Web.** `prototype/run-fcp.mjs`
ran the same 10,000-row app in Chromium with the background owning the first
commit, n=5 per arm, AB/BA, fresh page per sample, host at 0.12 load. Removing
all 40,028 selector writes moved median view-attach FCP from **2,134.9 ms to
2,102.2 ms** — about 1.5% — and the arms' ranges overlap: the eager arm's
fastest sample (2,048.7 ms) beat every announcing sample. At this n that is not
a detectable win, which is the honest reading of 40,000 `setAttribute` calls
against a 2.1-second first paint. Announcing is worth doing for the wire
contract and the per-node work it removes, not as a first-paint lever. The same
run also puts the background-commit path **~560 ms behind** main-thread direct
emission at this scale (2,102.2 ms vs 1,540.6 ms), which is the measurement
standing behind the plugin's `firstScreen: true` default. Both figures are
Lynx-for-Web in headless Chromium; native `__SetAttribute` crosses into engine
code and is not measured here. `prototype/results/fcp-10000-selector-announce.*`
is the committed record.

## 5. Specialized-core count harness (`block-counts.mjs`, on demand)

```bash
node block-counts.mjs --scales 1000 --reps 2
pnpm bench:block --out prototype/results/u0-block-core-counts
```

Issue #103 U0 asked what the update path's architectural ceiling is, and
answered with a hand-written op emitter whose "keyed block lookups" column was
derived by hand because no keyed core existed yet. This runner puts the real
`LynxBlockCore` (`packages/lynx/src/core/block-core.ts`) on the real background
transport against the real main-thread receiver — `block-workload.ts` shares
`workload.ts`'s chassis, so only the background core differs — and reports the
counter the core keeps itself.

Two columns run the same core over the same ladder and differ only in which
entry point a state change reaches: **scoped** writes the changed rows' slots by
key, as a compiled block program with per-row reactive slots would; **reconcile**
hands the whole next list to the keyed reconciler, as the app's own
`setRows(next)` does today. Reporting only the first would credit the Block
model with a win that belongs to the scoped write. The runner fails if the two
columns send different wire, if a cell's counts differ between repetitions, or
if the ladder did not paint the tree it should.

The ladder's last two rows, `updateStormOneFrame` and `selectStormOneFrame`,
repeat the two storms with every tick landing in **one** frame rather than its
own. Every other row here — and every row `run.mjs` reports — flushes once per
tick, so a command the core invalidates while the frame is still open cannot
exist in them, let alone be counted. The browser does not run that way: the
app's storm ticks schedule through a `MessageChannel` and land faster than the
renderer commits, and the 10,000-row stage decomposition observed four ticks of
a 1,000-row change inside a single drain. A core that emits eagerly has to be
measured in that column, because it is the only one where its own redundancy is
reachable.

`commands floor` is the second gate axis those rows exist for: what the frame
strictly has to carry, against what it carried. `selectStormOneFrame`'s floor is
zero — the burst ends exactly where it opened — so the commands it does send are
the distinct hosts it touched, which is what superseding a pending command can
reach and no further. That distance is a reported residual, not a failure; the
runner fails only if a frame carries *fewer* commands than its floor, which
would mean it does not state its own outcome.

Everything reported is a count, so no quiet host is needed and no wall clock is
measured. Both columns are ceilings in the same sense the `octane-direct`
prototype is a floor: the block program is hand-written, with no hooks, no
compiler, and no component bodies. `prototype/results/u0-block-core-counts.*`
is the committed record, beside `web-u0-update-ceiling.*`: they are the two
halves of the same #103 U0 gate.

## Claims and non-claims

Command counts and commit bytes are Octane-owned costs and are gated. The
in-process milliseconds and the Lynx-for-Web wall clock are CPU/browser-host
costs — no native paint, layout, adoption, or device claim. Native gates
remain the separate Android/iOS story (`docs/lynx-native-renderer-plan.md`).
