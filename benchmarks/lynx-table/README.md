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

# wire and background-work counts beside the milliseconds: serve the
# OCTANE_LYNX_PROFILE=1 bundles
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

### The `octane-block` cells (issue #103 B0, issue #135 item 1b)

```bash
BENCH_CORE=block node scripts/build-app.mjs               # scoped writes
BENCH_BLOCK_MODE=reconcile BENCH_CORE=block node scripts/build-app.mjs
BENCH_BLOCK_MODE=derived BENCH_CORE=block node scripts/build-app.mjs
node web/run-web.mjs --cells octane,octane-block,octane-block-reconcile,octane-block-derived \
  --scales 1000,10000 --reps 5
```

The same application entry, the same page driver, and the same bundle recipe,
built with `pluginOctane({ core: 'block' })` so the issue-#103 Block core drives
background updates instead of the universal one. One bundle carries exactly one
core: `__BENCH_CORE__` and `__BENCH_BLOCK_MODE__` fold in `app/src/index.ts`, so
the `universal` build carries none of `app/src/block-program.ts` and none of the
Block core behind it — and the `derived` build carries the Block core without
`block-program.ts`. The build flags are therefore the only variable, which is
what makes `octane-block* ÷ octane` a same-window A/B rather than a comparison
of two applications that resemble each other.

Four things must travel with any number from these cells:

- **Two of the three are architecture ceilings, not framework measurements.**
  `octane-block` and `octane-block-reconcile` are driven by a hand-written block
  program (`app/src/block-program.ts`), exactly as `block-workload.ts` and
  `prototype/` are. `octane-block-derived` is not: it runs the compiled `App`
  itself, lowered onto the same core by the framework, with the hand-written
  program folded out of the bundle. That is the cell to quote for what Octane on
  the Block core costs; the other two say what the update path *could* cost for
  a page shaped like this one. `octane` is the fourth number and none is quoted
  without it.
- **Three drive modes, and which ceiling the derived one is read against
  depends on the op.** `octane-block` writes the slot that changed, by key, the
  way a lowering with per-row reactive cells does. `octane-block-reconcile`
  hands the whole next list to the keyed reconciler, the way `setRows(next)`
  did before the lowering scoped it. Build both before quoting either:
  reporting only the first credits the Block model with a win that belongs to
  the scoped write. Structural operations (create, swap, remove) are the same in
  both. **`octane-block-derived` belongs beside `scoped` for a change that moves
  no key, and beside `reconcile` for one that does.** The app's state still
  lives in a cell the page owns, so a write still re-renders the page — but the
  lowering no longer hands the whole list back for it: a row whose component and
  props are unchanged is not re-rendered, and a render that mounted, removed,
  and moved nothing writes only the rows it called, by key. What the lowering
  costs over a program that was told which row to write is the gap between those
  two cells in one window, and the background-work counts below are where that
  gap is visible at all.
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

### The `octane-mts-program` cell (issue #163 C4b)

```bash
BENCH_MTS_PROGRAM=1 node scripts/build-app.mjs                       # web A/B cell
BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=10000 node scripts/build-app.mjs  # FCP ladder cell
node web/run-web.mjs --cells octane,octane-mts-program --scales 1000,10000 --reps 7
node prototype/run-fcp.mjs --rows 10000 --reps 7
```

The same application entry, the same core, the same page driver and the same
bundle recipe, built with issue-#163's main-thread program backend so the
main-thread chunk's eligible templates lower to straight-line create functions
driving the Element PAPI, instead of the descriptions an interpreter walks node
by node. `app/src/App.lynx.tsrx` lowers to two programs — `Row` and `App` — so
the first screen this cell paints is compiled code the whole way down.

The flag is orthogonal to `BENCH_CORE`: it moves the main-thread chunk and
leaves the background one alone. Measured on this application across the backend
switch, the background chunk is **byte-identical** (285,413 bytes, sha256
`9b5e9e5df496…`) and the main-thread chunk moves by 700 bytes
(216,547 → 217,247). That is what makes `octane-mts-program ÷ octane` an A/B
of the first-screen encoding and nothing else, and it is why an update-band
difference between the two cells would be a finding rather than a build
artefact: after adoption both cells run the same background code over the same
wire.

Four things must travel with any number from this cell:

- **It adopts; it does not repair.** Unlike the `octane-block` cells above, whose
  painted first screen is discarded, this one is taken over.
  `prototype/adoption-probe.mjs` is the instrument: it tags every row element at
  the first painted frame and counts how many tags are still attached four
  seconds later, because a repair builds different elements and would keep none
  of them. Both cells keep all of them at both scales measured — 1,000/1,000
  at 1,000 rows and 10,000/10,000 at 10,000. FCP for this cell is therefore an adoption number and
  reads against `octane`'s directly, which is exactly what the block cell's does
  not.
- **The settled `selector attrs` column reads the wrong moment for this cell,
  which is why the ladder reports a first-frame regime beside it.** A compiled
  program installs no `nodes-ref` selector at all, and whatever the adopting
  commit decides afterwards lands on top of that — so a settled count can report
  the interpreted regime for a page the interpreter never touched. At 10,000 and
  30,000 rows it is a stable 0; at 1,000 it reads 4,028 or 0 across otherwise
  identical repetitions. Asked at the first painted frame instead, before any
  peer exists to adopt anything, the cell is `1000/0` and `10000/0` in every
  repetition at every scale — which is what says the program painted. Whatever
  installs the 1,000-row selectors therefore lands after the first frame, does
  not move FCP, and never exceeds what the `octane` cell has already paid before
  its own first frame (4,028 at 1,000 rows, 40,028 at 10,000). Which commit
  installs them, and why the same page decides differently at two scales, is
  open; §4 has the two paths that install eagerly and why.
- **A compiled program's `ranges` key is not a probe for anything that ships the
  Lynx main renderer, this build included.** `packages/lynx/src/core/main-renderer.ts`
  carries the identifier into every main-thread chunk whether or not a program
  was compiled, so searching for it here separates nothing. The same is true on
  the small fixture `../lynx-bundle-size/core-switch.mjs` compiles, where the
  probe used to work and where measuring it found `ranges` three times in all
  three arms; that harness now probes the preamble `emitMainThreadProgram`
  writes instead. What identifies this cell's first screen is the first-frame
  selector regime above, and what says the backend switched at all is the byte
  comparison.
- **The ceiling is not reached, and this cell is not it.** `octane-direct` is the
  hand-written L0 prototype: the same page emitted by code written for this one
  application, with no framework between the entry point and the PAPI. It is the
  floor a compiled program is aiming at, not a cell Octane ships. Against it this
  cell measures 1.37× at 1,000 rows, 1.23× at 10,000 and 1.38× at 30,000 — closing 42%, 54% and 51% of the `octane`-to-ceiling gap,
  and no more than that. Issue #163's oracle asks for 5%.

On the table operations the two cells are the same page: every op's band
overlaps its `octane` band in the same window, at both scales, n=7 — which is
what #148's corollary asks of a landed slice. Two of the twelve are marginal and
in the same direction as an earlier session's, `create` and `update10th` at
10,000 rows, with the program cell 1.6% and 4.8% slower at the median. Both
overlap, and the mechanism that would have explained them is ruled out: after
one create at 10,000 rows the two cells hold the same 28 `nodes-ref` selectors,
so the difference is not per-node selector work carried over from how each cell
was adopted. `prototype/results/web-c163-c4b-update-bands.*` is the committed
record.

`prototype/run-fcp.mjs` picks the cell up automatically once
`app/dist-mtsprogram-rows<N>/main.web.bundle` exists, the same way it picks up
the block cell. §1's wire-cost gates take no cell from this build and want none:
the wire is the background's, and the background chunk is the half that does not
move.

### The `octane-block-program` cell (issue #163 C5)

Both build switches on at once, which is the configuration oracle clause 1
names — "block-core FCP within 5% of the `octane-direct` ceiling cell":

```bash
BENCH_CORE=block BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=10000 node scripts/build-app.mjs
```

`prototype/run-fcp.mjs` picks it up from
`app/dist-block-mtsprogram-rows<N>/main.web.bundle` on the same terms as the
other two: built, it is a cell; absent, it is not one.

It exists because the clause names the core and the attribution ladder measures
the backend, and those had never been the same cell. At 10,000 rows over n=15
in one window they are indistinguishable — 1189.7 ms against
`octane-mts-program`'s 1191.3 ms, with the block cell ahead in 109 of 225
pairwise comparisons, which is the 50% that means "no difference". That is the
orthogonality claim measured rather than asserted: the backend owns the first
screen and the core it is paired with does not move the boundary.
`prototype/results/fcp-10000c5-clause1-10000-n15.*` is the committed record.

#### Clause 1, re-priced at all three scales (issue #163, after C8)

C8 established that the emitted append order is not what the compiled first
screen is paying for, and it changed nothing that ships. So this re-prices the
oracle rather than re-testing it, on the harness whose protocol line is the
clause's own words — one window per scale, cells alternating AB/BA, n=15:

```bash
for n in 1000 10000 30000; do
	node prototype/run-fcp.mjs --rows $n --reps 15 --out-suffix=-c163-c8-clause1
done
```

`prototype/results/fcp-{1000,10000,30000}-c163-c8-clause1.*`. Medians with the
observed range, and the share of the distance from `octane` to the ceiling that
the compiled first screen closes:

| rows | `octane` | `octane-mts-program` | `octane-block-program` | `octane-direct` | clause 1 | gap closed |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 238.7 [228–268] | 189.1 [181–215] | 186.0 [174–205] | 143.2 [134–218] | **1.299×** | 55.2% |
| 10,000 | 1603.3 [1477–1742] | 1256.4 [1149–1350] | 1249.0 [1165–1464] | 1034.7 [970–1135] | **1.207×** | 62.3% |
| 30,000 | 4955.0 [4745–5366] | 3537.9 [3345–3780] | 3545.2 [3338–3748] | 2703.5 [2561–2939] | **1.311×** | 62.6% |

**Clause 1 asks for ≤1.05× and is not met at any scale.** The excess over the
ceiling is +42.8 ms, +214.3 ms and +841.7 ms. At 10,000 and 30,000 rows the
clause cell's fifteen samples are **disjoint** from the ceiling cell's, so the
shortfall is established rather than inferred; at 1,000 they overlap, because
the ceiling cell has a long upper tail there (134–218) and 42.8 ms is inside it.

**The core behind the program still costs nothing at the boundary**, now at three
scales rather than one. `octane-block-program` and `octane-mts-program` overlap
at every scale, the block cell holds the lower sample in 10, 7 and 10 of 15
paired repetitions — a coin flip each time — and the median paired differences
are −1.9, +10.0 and −103.2 ms with no consistent sign. So clause 1's verdict does
not depend on which background core the first screen is paired with, which is
what makes the two cells interchangeable in every table above.

The 30,000-row window opened at a 1m load of 1.69 against the harness's own 2.0
refusal threshold, higher than the 0.51 and 0.92 of the other two. Every cell in
that window paid it, and the harness certifies within-window differences only, so
the ratios stand; the absolute walls from it should not be compared with another
window's.

### Background work, and why no other column can see it

A `--counter-build` session also reports, per operation, what the background
thread actually did to produce the paint:

- **row bodies** — how many times the app's `Row` component body ran, counted
  by the app itself (`app/src/App.lynx.tsrx`).
- **block visits** — how many blocks the Block core looked up
  (`packages/lynx/src/core/block-core.ts`, published on the realm under the
  same build flag).

A cell publishes a counter or it does not, and the report drops a column rather
than filling it with a zero: the `octane` cell has no Block core, and the two
hand-written cells have no component body — which is the same fact as their
being ceilings. The derived cell publishes both, which is what makes it the
cell to read.

These exist because they are the only columns that separate two cores that
paint the same tree for different amounts of work. A core that re-renders every
row and then discovers that one of them changed sends exactly what a core that
re-rendered one row sends: same commit, same command, same bytes. The wire
counts come out identical, the milliseconds differ by whatever the host allows,
and the work that actually differs appears nowhere else.

`create`, `update10th`, `select`, and `clear` are single state changes, so both
counts are invariants for this app and interaction and carry across hosts and
sessions; the report prints "rows changed" beside them and their spread must be
0. That column is read against a body count directly and against a visit count
with one offset: `create` and `clear` mount and destroy rather than revisit, so
a keyed core looks nothing up for either and the visit floor there is 0 rather
than the table — the same thing `block-counts.mjs` says of its own `create`
row. The storms are not invariants, for the reason their commit counts are not:
two ticks that land before the scheduler flushes are answered by one render,
exactly as two renders that land before a commit flushes ride in one commit. A
storm's counts are therefore a property of the run, and the report prints the
observed range rather than a model of it.

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

## 6. Element PAPI boundary instrument (`stages/papi-run.mjs`, informational)

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

### Observation contract (host boundary)

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

Every harness that writes into a checked-in `results/` directory writes its JSON
through `scripts/evidence.mjs`, which formats the record under the repository's
own Prettier configuration before it reaches disk. `pnpm format:check` is a CI
gate and it covers these directories, but `JSON.stringify` and Prettier disagree
about short arrays, so a record written the plain way lands already failing that
gate for every branch above it. Formatting at the write is the fix #118 named and
left with this harness; the checked-in shape is unchanged, because the writer
hands Prettier the expanded form and Prettier reflows only the arrays.

Both accept `--label`, which stems every output basename. A run over a different
cell set writes beside the checked-in baseline rather than over it, and the
report re-renders from whichever stem it is pointed at:

```bash
node stages/papi-run.mjs --cells octane,octane-profile --label papi-firstscreen
node stages/papi-report.mjs --label papi-firstscreen
```

### Splitting `off_boundary` — which first-screen phase owns it

`off_boundary` is a remainder for every cell, and on a profile-built cell it
splits further. `@octanejs/lynx` publishes which first-screen phase is
running — `render`, `publish`, `capture`, `announce` — and the boundary probe
attributes each host call to the phase that issued it, so a phase's own
off-boundary time is its wall span minus the host time observed inside it. What
no phase claims is the **residue**: web-core's own script between host calls,
plus the browser's style, layout, paint, and observer frame.

The dependency runs one way: the framework publishes a marker and never reads
the probe. `render` crosses the boundary not at all, so its whole span is
framework script by construction rather than by subtraction. The marker is
gated on `__OCTANE_LYNX_PROFILE__` and folds out of a shipping bundle, so the
split needs a separately built `<cell>-profile` cell — which is a different
configuration, so it is excluded from every cross-cell delta and no ratio is
taken between it and its shipping counterpart. The report prints both builds'
first-screen walls from the same window instead, so the transfer is judged on
measured agreement. A profile cell is paired with the shipping cell whose id it
suffixes, so a run may carry several: `octane-mts-program-profile` licenses
`octane-mts-program`'s split, never `octane`'s.

The analyzer refuses rather than clamps: a counts-only split, a phase observing
more host time than it lasted, phases claiming more than `off_boundary` holds, a
marker still open at the window's end, an unknown phase name, a window in which
no first screen ran, and a run in which only some samples carried a split.

### The `octane-mts-program` and `octane-direct` cells (issue #163)

```bash
node stages/papi-run.mjs --reps 5 --scales 1000,10000 \
	--cells octane,octane-mts-program,octane-direct --label c163-attr
```

§4's ladder prices issue-#163's compiled main-thread program against the
hand-written L0 prototype and reports a first screen still 1.24–1.38× the
prototype's. What that residue is made of is a question the ladder cannot
answer and this instrument can, so both cells live here too. Both carry a
click-driven shell and a pre-populated ladder variant, so both windows are
measured for both rather than one being borrowed from the other, and
`prototype/build.mjs` copies its pageConfig and styleInfo from the octane
bundle, so the main-thread/background program pair is the only variable
between them.

The answer is in the host call counts, and it is specific
(`results/c163-attr-boundary.md`, FCP@10,000, one counts sample per cell):

| host call | `octane` | `+program` | `octane-direct` |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 70,042 | 20,001 | 1 |
| `__SetAttribute` | 40,028 | 0 | 0 |
| every other kind | identical | identical | identical |
| **total** | **310,195** | **220,126** | **200,127** |

The interpreted first screen crosses the boundary 11.01 times per row more than
the prototype. The compiled program removes **9.00 of those 11.01** — every
`__SetAttribute`, which is the `octane-ref` selector regime §4 reports at the
first painted frame, plus five of the seven per-row identity reads — and leaves
exactly **2.00 per row**, all of them `__GetElementUniqueID`. Those are
first-tree capture reading each event-bound node's native ID so the background
can address it (`packages/lynx/src/core/host-driver.ts:4210`), and the row
carries exactly two event bindings, which is why the number is two.

**Crossings are not where the remaining gap is.** At 10,000 rows the residual
283 ms between `+program` and the prototype divides as roughly 73%
`off_boundary`, 6% `start_delay`, and 15% host time inside the boundary; at
1,000 rows the same three are roughly 56%, 34% and 13%, because `start_delay`
is a fixed ~18 ms of main-thread chunk evaluation that amortises. `papi_flush`
is 137.5 ms against the prototype's 139.4 ms — the compiled first screen is
already at the publication floor. So the residue is dominated by framework
script *above* the boundary, and the 20,000 identity reads are worth about 8 ms
of it. Which phase owns the rest is the next section.

### Which first-screen phase owns the program's remaining time (issue #163)

```bash
node stages/papi-run.mjs --reps 5 --scales 1000,10000 \
	--cells octane,octane-profile,octane-mts-program,octane-mts-program-profile,octane-direct \
	--label c163-phase
```

`octane-mts-program-profile` is the profile build of the compiled-program cell,
so §6's phase split reads on it as well. Its wall agrees with the shipping
program's to +4.1% at 10,000 rows and +2.5% at 1,000, which is the licence for
reading its split as the shipping build's.

`results/c163-phase-boundary.md`, off-boundary ms at FCP@10,000, median over 5
reps with the observed range beside it:

| first-screen phase | `octane` | `+program` |
|---|---:|---:|
| `render` | 75.0 [71.6–77.9] | 51.5 [49.2–54.4] |
| `publish` | 381.1 [345.6–408.3] | 259.5 [232.4–277.6] |
| `capture` | 87.6 [77.5–89.6] | 19.2 [17.8–19.6] |
| `announce` | 0.0 | 0.0 |
| **framework script** | **543.7 [510.2–563.8]** | **333.5 [302.1–346.5]** |
| residue | 78.6 [74.0–83.9] | 98.0 [96.6–104.4] |

Every one of those ranges is disjoint from its neighbour, including the last:
the program takes **39% off Octane's own first-screen script**, and its residue
is **19 ms worse**, which is a real move in the wrong direction rather than
noise and is open. At 1,000 rows only `publish`, `capture` and the framework
total separate; `render` and the residue overlap and are not established there.

The phase that matters is `publish`, which holds **78% of what the compiled
program still spends above the boundary**. Inside it the program issues 200,124
host calls — the same traffic the hand-written prototype makes for its entire
run — for 820 ms of host time against the prototype's 829 ms. **The crossings
are at parity; the script around them is not.** Decomposing the same window
against the prototype, 274 ms of the program's 286 ms of timed excess is named:
+17 ms `start_delay`, +64 ms host time (entirely the 20,000 excess identity
reads), and +193 ms `off_boundary`.

Two consequences for issue #163's oracle, both of which cost less than they look
worth:

- `capture` is now priced whole. §6's crossing count valued its 20,000 identity
  reads at ~8 ms, which was the host-boundary cost alone; the phase carries
  19.2 ms of Octane's own loop on top, so emptying it is worth ~24 ms at 10,000
  rows, not ~8 ms.
- Reaching the oracle's 1.05× at 10,000 rows means shedding 207 ms of the 249 ms
  by which the program's control wall exceeds the prototype's. Framework script,
  at 333.5 ms, is the only bucket large enough to hold that: `start_delay` and
  the excess host time together are 81 ms, under 40% of what must go, and the
  residue is neither Octane's to remove nor moving the right way. So the target
  is arithmetically reachable and only along one road. That is not a tuning
  distance. It is a question about what Octane's main-thread script does during
  `publish` while making exactly the calls a hand-written emitter makes, and
  that is the next slice.

### What the compiled program's own text painting moved, and what it did not (issue #163 C6)

The section above was measured before C5 taught the program to compile a range
site's text. Re-running the same split on the C5 build re-prices every phase, and
adds 30,000 rows so that a scaling question can be asked at all:

```bash
node stages/papi-run.mjs --reps 5 --scales 1000,10000,30000 \
	--cells octane,octane-profile,octane-mts-program,octane-mts-program-profile,octane-direct \
	--label c163-c6-phase
```

`octane-mts-program` is the backend cell — the universal core with the
main-thread program — and clause 1 names the block core. The two are
indistinguishable in the same window (1189.7 ms against 1191.3 ms at 10,000
rows, §"The `octane-block-program` cell"), which is what licenses reading this
ladder as the block core's.

`results/c163-c6-phase-boundary.md`, off-boundary ms in the profile cells' own
FCP windows, median over 5 reps:

| first-screen phase | 1,000 | 10,000 | 30,000 | 10k → 30k |
|---|---:|---:|---:|---:|
| `render` | 9.2 | 43.9 | 90.0 | 2.05× |
| `publish` | 25.1 | 240.4 | 660.4 | 2.75× |
| `capture` | 0.8 | 6.8 | 25.0 | 3.68× |
| `announce` | 0.0 | 0.0 | 0.0 | — |
| **framework script** | **35.3** | **292.5** | **796.5** | **2.72×** |
| residue | 17.5 | 119.1 | 339.1 | 2.85× |

`publish` was 259.5 ms at 10,000 rows before C5 and is 240.4 now; the framework
total was 333.5 and is 292.5. Against the `octane` cell measured in the same
window (626.1 ms of framework script at 10,000, 1864.9 at 30,000) the compiled
program is running at 47% and 43% of Octane's own first-screen script.

Read the last column, though, and `publish` is the wrong place to keep looking.
Every phase grows **slower than the row count** — 2.72× for 3× the rows on the
framework total. Whatever is keeping this cell off the ceiling is not the script
the split measures.

#### The excess is superlinear and the script is not

Subtracting the `octane-direct` ceiling cell from the compiled program's own
shipping cell, in the same window and at the same three scales:

| segment | @1,000 | @10,000 | @30,000 | 10k → 30k |
|---|---:|---:|---:|---:|
| `start_delay` | +16.8 | +18.8 | +19.1 | flat |
| `papi_create` | +2.6 | +55.5 | +119.5 | 2.15× |
| `papi_props` | −0.8 | −2.0 | +14.7 | — |
| `papi_events` | +0.9 | +7.1 | +25.9 | 3.65× |
| `papi_topology` | +1.9 | +12.5 | +41.1 | 3.29× |
| `papi_read` | +0.1 | +0.1 | +0.1 | flat |
| `papi_flush` | −2.9 | +38.8 | +220.2 | **5.67×** |
| `off_boundary` | +25.1 | +150.5 | +684.5 | **4.55×** |
| **total excess** | **+43.7** | **+281.3** | **+1125.1** | **4.00×** |

The total excess grows 4.00× for 3× the rows while the framework script inside it
grows 2.72×. Those cannot both be true of a cell whose distance from the ceiling
is framework script, so the term that decides clause 1 at scale is one of the two
in bold — and one of them is host time, not Octane's script at all.

The two bold multipliers are the softest numbers in this section: both are
differences of 30,000-row medians, and §"How firm this is" below shows the
30,000-row run is too noisy at n=5 to carry them. The sign of each is what this
table establishes; the growth rates are what the next slice measures.

`start_delay` is the one term that is flat, and at 1,000 rows it is 38% of the
whole excess: 20.3 ms against the prototype's 3.5 ms, which is the Octane bundle
evaluating and installing before its first host call. It is a fixed cost that no
row-count work can reach, and it is why this harness reads 1.41× at 1,000 rows
where the shipping-page A/B reads far closer — the two windows begin in different
places, and §"Measurement honesty rules" forbids trading one for the other.

#### `papi_flush` costs more for an identical call sequence

`papi_flush` is web-core's own synchronous publication, entered twice per window
in every cell. It is not a place framework script can hide, and the counts build
says the traffic reaching it is the same everywhere: `results/c163-c6-phase-scaling.json`
records 20.0001 ops per row and `flushConstant: true` for all five cells at all
three scales, drift 4.8e-05. Yet at 30,000 rows:

| cell | `papi_flush` median | range | host calls in window |
|---|---:|---|---:|
| `octane` | 633.6 | 628.3–672.6 | 930,195 |
| `octane-mts-program` | 779.6 | 660.9–870.9 | 600,126 |
| `octane-direct` | 559.4 | 549.6–657.5 | 600,127 |

The compiled program makes a third fewer host calls than `octane` across the
window and pays 146 ms more inside the flush; against the prototype it makes the
same calls and pays 220 ms more. At 1,000 rows the same comparison runs the other
way — 16.6 ms against the prototype's 19.5 — so this is not a constant the
program carries, it is something that turns on with size.

"The same calls" is exact rather than approximate, and the record says so per
kind rather than per row. Against the prototype the compiled program's call
multiset at 30,000 rows differs by **exactly one call**:

| host call | `octane` | `+program` | `octane-direct` |
|---|---:|---:|---:|
| `__CreatePage` | 1 | 1 | 1 |
| `__CreateView` | 30,015 | 30,015 | 30,015 |
| `__CreateText` | 90,013 | 90,013 | 90,013 |
| `__CreateRawText` | 90,013 | 90,013 | 90,013 |
| `__AppendElement` | 210,041 | 210,041 | 210,041 |
| `__SetClasses` | 120,028 | 120,028 | 120,028 |
| `__AddEvent` | 60,012 | 60,012 | 60,012 |
| `__SetAttribute` | 120,028 | — | — |
| `__GetElementUniqueID` | 210,042 | 1 | 1 |
| `__SetCSSId` | — | — | 1 |
| `__FlushElementTree` | 2 | 2 | 2 |

Neither single-kind difference explains the ordering. The prototype is the only
cell that declares a CSS scope, and it is the cheapest — but `octane` declares
none either and is still cheaper than the program. `octane` is the only cell
writing 120,028 attributes, which is work the others do not do, and it is still
cheaper than the program. What is left is the order the identical calls arrive
in, which is where the next slice looks.

Both flushes are recorded separately, and the second one is 0.1 ms in every cell
at every scale: all of the cost is the first flush, and it publishes the same
composed tree in all three cells. So this is not a question of how the two
flushes divide the tree between them.

#### How firm this is

Firmer at 10,000 rows than at 30,000, which is the opposite of convenient,
because 30,000 is where the superlinear claim lives.

| scale | `+program` flush 0, n=5 | `octane-direct` flush 0, n=5 |
|---|---|---|
| 10,000 | 223.0 · 225.9 · **230.3** · 244.7 · 259.2 | 184.2 · 188.5 · **191.5** · 191.6 · 203.7 |
| 30,000 | 660.8 · 719.6 · **779.5** · 854.8 · 870.9 | 549.5 · 557.9 · **559.4** · 606.3 · 657.5 |

At 10,000 rows the two distributions are cleanly separated: 19.3 ms between the
program's lowest sample and the prototype's highest, on spreads of 16% and 10% of
their medians. The program's flush also separates from `octane`'s there
(183.0–213.9), by 9.1 ms.

At 30,000 rows they separate by **3.3 ms**, on spreads of 27% and 19%. That is
disjoint as measured and it is not a result. It is also not specific to the
flush: at that scale the program cell's whole page is noisy — 15.5% spread on the
timed wall, 21.2% outside the flush — against `octane`'s 6.8%. So the 5.67×
growth in the excess is **not established**, and neither is the 220 ms itself at
30,000 rows. What is established is the direction, and the 10,000-row gap.

The next section settles it: at n=15 the 30,000-row separation is real and
larger than this run said, and the growth rates this run reported are not.

#### Caveat on the 10,000-row split

Reading a profile cell's split as the shipping cell's requires the two walls to
agree, which the report prints per cell. At 1,000 and 30,000 rows the compiled
program's profile build is +6.6% and +6.1% over its shipping build, in line with
the +4.1% §"Which first-screen phase owns the program's remaining time" records.
At 10,000 rows it is **+11.0%** — 1304.9 ms against 1175.1 ms. The 10,000-row
phase rows above are still the best split available for that scale, but they
carry more of the probe than the rows either side of them, and any figure taken
from them inherits that.

### Settling the 30,000-row flush, and what it costs (issue #163 C7)

The section above could not tell a 220 ms structural cost from a noisy run, so it
was re-measured at n=15 on the same three cells and **the same bundles** —
`--skip-build`, so the bytes are byte-for-byte C6's and only the sample count
changes:

```bash
node stages/papi-run.mjs --reps 15 --scales 30000 \
	--cells octane,octane-mts-program,octane-direct --label c163-c7-flush --skip-build
```

`results/c163-c7-flush-30000.json`. First-flush self time, every sample, sorted:

| cell | n=15 `papi_flush` samples (ms) | median |
|---|---|---:|
| `octane-direct` | 532 · 549 · 551 · 560 · 561 · 565 · 577 · **585** · 586 · 587 · 597 · 610 · 613 · 621 · 627 | 585.0 |
| `octane` | 561 · 582 · 590 · 599 · 613 · 616 · 630 · **631** · 631 · 640 · 642 · 642 · 653 · 680 · 725 | 631.4 |
| `octane-mts-program` | 662 · 689 · 790 · 837 · 839 · 843 · 844 · **861** · 890 · 892 · 904 · 904 · 910 · 919 · 1051 | 861.0 |

Against the ceiling cell the two distributions do not touch: **every one of the
program's fifteen samples is above every one of the prototype's fifteen**, 662.3
against 627.0 at the boundary. The median difference is **+276.0 ms, a factor of
1.472×**, on a call multiset that differs by exactly one call.

So the finding survives, and it is larger than the n=5 run said (+220 ms, 1.394×)
rather than smaller. Against `octane` the program is +229.7 ms at the median but
the ranges do overlap at the tails, so that comparison is strong and not
disjoint.

#### The excess at 30,000 rows, with the firm terms marked

The same window re-prices every group, and n=15 is enough to say which
differences are real. Program minus ceiling, medians, ranges beside them:

| segment | `octane` | `+program` | `octane-direct` | excess | firm? |
|---|---:|---:|---:|---:|---|
| `start_delay` | 22.5 | 22.0 [20–28] | 3.9 [3–11] | +18.1 | **disjoint** |
| `papi_create` | 2088.6 | 1776.3 [1585–2101] | 1743.2 [1590–1910] | +33.1 | overlaps |
| `papi_props` | 389.2 | 208.8 [169–247] | 211.9 [179–274] | −3.1 | overlaps |
| `papi_events` | 125.3 | 113.3 [93–136] | 91.2 [79–103] | +22.1 | overlaps |
| `papi_topology` | 219.7 | 191.9 [171–226] | 157.8 [144–174] | +34.1 | overlaps |
| `papi_read` | 76.3 | 0.1 | 0.0 | +0.1 | — |
| `papi_flush` | 631.4 | 861.0 [662–1051] | 585.0 [532–627] | **+276.0** | **disjoint** |
| `off_boundary` | 2107.8 | 1049.0 [1014–1227] | 449.6 [413–654] | **+599.4** | **disjoint** |
| **total** | | | | **+979.8** | |

Two groups hold **89% of the excess**, and both are established rather than
inferred. Everything else overlaps at n=15 and should not be spent against —
`papi_create`, which the n=5 run priced at +119.5 ms, is +33.1 here on ranges
that overlap almost completely.

That also means the total is not +1125.1 ms as C6 reported but +979.8 in this
window, and no growth rate should be carried across the two runs: they are
different windows and the absolute walls moved (the ceiling cell's control FCP is
2733.1 ms here against 2632.9 there). What each run measures is the *within-window*
difference between cells, which is the only comparison the harness certifies.

#### What is left to explain: the order the identical calls arrive in

`off_boundary` is mostly the program's own script, which §"What the compiled
program's own text painting moved" already prices and which is falling. The
`papi_flush` excess is not script at all, and it is now the largest single thing
that no amount of script work can reach.

The three cells append in two different orders, and this is readable in the
sources rather than inferred from timings:

- **`octane-direct`** (`prototype/lepus-root.js`) is strictly child-first. Every
  node is fully populated before it is appended to its parent, and the row joins
  the live parent last.
- **`octane`** is child-first too. `host-driver.ts`'s first-screen walk queues a
  node's attach before its children so that it pops after them — the comment
  there says exactly that — and a leaf, having no children, attaches immediately.
- **`+program`** is parent-first. `emit-main-thread-program.ts` emits a flat
  index-ordered loop, `append(n<parent>, n<index>)` for every node in program
  order, so a row's `col-remove` joins the row *before* its own raw text joins
  `col-remove`. The compiled range texts are appended after all of that.

The two child-first cells are the two cheap ones (585.0 and 631.4) and the
parent-first cell is the expensive one (861.0). `octane`'s +46 ms over the
prototype is the one gap this does not have to explain: it makes 330,000 more
host calls across the window and writes 120,028 attributes the others do not.

One version of this hypothesis is already dead. The row itself attaches to the
live tree only after the create function returns, so no append in any cell lands
on a node that is already in the page — whatever the order costs, it is not
live-tree invalidation.

The emitter's order is deliberate and its comment says why: it "performs the
dense applier's work in the dense applier's order." So a reordering slice has to
answer that comment rather than quietly change the loop, and
`main-thread-emit.test.ts` pins the append *count* and that the compiled text
lands behind everything its host already holds — both of which a child-first
order preserves.

The test is an A/B of the emitted order alone: same call multiset, same composed
tree, same bundle everywhere else. That is the next slice, and it is a
measurement before it is a mechanism. It ran, and the section below is its
answer.

### The append order is not the cause (issue #163 C8)

The hypothesis above is **dead**. Emitting the appends child-first does not move
the flush, and what small movement there is runs the wrong way.

Testing it needs two bundles that differ in the emitted order and in nothing
else, in one window. `BENCH_DIST_TAG` changes where a build lands and nothing
about what it contains, so one configuration can be built twice from two working
trees and both bundles exist side by side; `--control-dist <tag>` registers
`octane-mts-program-control` against the tagged dist for one run and does not
exist without the flag.

```bash
# control arm: the shipping parent-first emitter, into app/dist-mtsprogram-c7-*
for n in 0 1000 10000 30000; do
	BENCH_DIST_TAG=c7 BENCH_MTS_PROGRAM=1 BENCH_AUTOROWS=$n node scripts/build-app.mjs
done
# …then the emitter changed to child-first, and the treatment arm was built
# untagged into app/dist-mtsprogram-* from the same tree.

node stages/papi-run.mjs --reps 15 --scales 30000 \
	--cells octane,octane-mts-program,octane-mts-program-control,octane-direct \
	--control-dist c7 --label c163-c8-append --skip-build
```

The two bundles are the same size and differ only where they should. Every one
of the row's six appends is present in both, in the same multiset, with sibling
order preserved; only the sequence moves:

| arm | emitted appends for one row |
|---|---|
| control, parent-first | `i(v,h)`, `i(v,y)`, `i(v,m)`, `i(m,g)`, `…i(h,u=a(d))`, `…i(y,p=a(c))` |
| treatment, child-first | `…i(h,u=a(d))`, `i(v,h)`, `…i(y,p=a(c))`, `i(v,y)`, `i(m,g)`, `i(v,m)` |

`results/c163-c8-append-30000.json`. First-flush self time, every sample,
sorted:

| cell | n=15 `papi_flush` samples (ms) | median |
|---|---|---:|
| `octane-direct` | 457 · 462 · 466 · 474 · 475 · 475 · 475 · **481** · 482 · 494 · 503 · 507 · 509 · 521 · 525 | 480.8 |
| `octane` | 484 · 486 · 502 · 513 · 513 · 514 · 521 · **531** · 534 · 534 · 541 · 548 · 551 · 567 · 652 | 531.0 |
| `+program`, parent-first | 548 · 567 · 574 · 579 · 583 · 633 · 667 · **677** · 682 · 692 · 693 · 701 · 704 · 728 · 769 | 677.4 |
| `+program`, child-first | 587 · 589 · 637 · 667 · 673 · 675 · 682 · **691** · 697 · 702 · 718 · 721 · 729 · 784 · 834 | 690.8 |

The two program arms are indistinguishable and the reordered one is nominally
worse. Their ranges overlap over almost their whole length, the child-first arm
has the **lower** flush in **6 of 15** paired repetitions, and the median of the
paired differences is **+14.9 ms against** the reordering. On the uninstrumented
control pages the wall goes the other way by a similarly unspendable margin —
3377.9 ms child-first against 3404.5 ms parent-first, lower in 8 of 15, median
paired difference −20.2 ms, ranges [3213–4374] against [3160–4127].

What the same window does establish, firmly, is that the flush excess is real
and is not the order. Both program arms are **disjoint** from the ceiling cell:
the lower of their fifteen samples is 587.3 and 547.7 against the prototype's
highest at 525.3. Parent-first is +196.6 ms (1.409×) and child-first +210.0 ms
(1.437×) over `octane-direct`'s 480.8. As with C7, no growth rate carries across
windows — the absolute walls moved again (the ceiling cell's control FCP is
2616.0 ms here against 2733.1 there) — and only the within-window difference
between cells is certified.

So the emitter keeps the flat parent-first loop, its doc comment keeps saying
that the backend "performs the dense applier's work in the dense applier's
order", and nothing about the reordering is carried.

**What this does not refute.** The program and the prototype differ on *two*
assembly axes, not one, and this window varies only the second:

- **creation order** — the prototype creates each row's nodes in document order,
  interleaved with its links; the program's emitted node loop creates every node
  of the row first, grouped by program index, and links afterwards.
- **append order** — parent-first against child-first, which is what C8 varied
  and what it just found innocent.

The remaining axis is creation order, and `dom-attach-floor.mjs` is the cheap
instrument for it: it builds this exact tree with no framework in the page, so a
2×2 of the two axes there prices whatever the platform charges for assembly
shape without a compiler change. That control also bounds how much of the flush
this family of hypotheses can reach at all — the floor prices only the
platform's own publishing `appendChild`, already 30.3% of `papi_flush` at 30,000
rows, and leaves web-core's own walk inside `__FlushElementTree` untested.

Clause 1 in this window, for the record: **1.301×** at 30,000 rows for the
shipping parent-first program against the ceiling cell (1.291× for the reordered
arm, 1.844× for `octane`). The oracle asks for ≤1.05×.

### The publication floor — `dom-attach-floor.mjs`

A speed-of-light control with no framework in the page at all. `__AppendElement`
is `parent.appendChild(child)` and the first flush publishes with
`rootDom.appendChild(page)` on a shadow root, so the question of what a detached
first screen costs to attach is a question for the browser, not for Octane or
web-core. Five arms build the identical tree with the tag names, per-row shape,
attributes, class names, and scoped stylesheet `createElementAPI.js` produces,
and differ only in where and when it is attached:

| arm | what it does |
|---|---|
| `build` | every node created and linked within its row, nothing ever attached — the allocation floor every other arm also pays |
| `live-incremental` | rows created and appended one at a time into a container already in the document — the post-mount shape |
| `live-bulk` | rows created and appended one at a time into a detached container, then one `appendChild` publishes the tree — the first-screen shape |
| `split-incremental` | every row built first, then all of them appended into an attached container |
| `split-bulk` | every row built first, then all of them appended into a detached container, then one `appendChild` publishes it |

Every arm runs against **two element kinds**, in one window, because the harness
page has `x-view`, `x-text`, and `raw-text` registered — `@lynx-js/web-elements`
defines all three — so web-core publishes a tree of upgraded custom elements and
the insertion runs one reaction per node inside itself.

| kind | what it measures |
|---|---|
| `inert` | the floor for inserting plain DOM nodes of this shape |
| `upgraded` | the same, plus the platform running one custom-element reaction per node — what web-core actually triggers |

The `upgraded` kind decides, since it is the one the harness page holds, and
`upgraded` minus `inert` is the platform's price for dispatching a reaction:
the callbacks are empty on purpose, so what the difference isolates is the
dispatch and not what web-elements does inside one. Each sample asserts its own
registration state in the page and the runner rejects a cell that ran the wrong
kind, because the claim this control got wrong the first time was exactly a
registration claim read from sources instead of from the running page.

```bash
node stages/dom-attach-floor.mjs --reps 5 --scales 1000,10000,30000
```

The two pairs answer the same question at different costs. `live-*` interleaves
creation and attachment exactly as the command stream does, so it carries no
deviation and its whole loop is comparable to `papi_topology` — plus
`papi_flush` on the bulk side. It cannot separate insertion from creation
without a clock read per append, so its rate is the loop. `split-*` buys a
separable `attachMs` by building first and attaching second, which the command
stream never does; it localizes whatever the live pair finds and never overturns
it.

The verdict reads **command cost** — the calls the stream makes — and holds the
browser's frame beside it rather than folding it in, because the rate this
control exists to explain is `papi_topology (+ papi_flush)` self time, which is
time inside `appendChild` and contains no style, layout, or paint. The frame is
measured with a forced layout read on the next animation frame, so it lays out
the whole tree; first contentful paint does not require that, which makes it an
upper bound rather than a transfer. The reading registered before the run —
command plus frame — is printed at the end so the substitution can be checked.

One registered prediction is decided: incremental flat within the 10% gate, bulk
rising past it, with the bulk arm's rise tested by a signed trend rather than by
drift alone, so a rate that *falls* across the range cannot be scored as rising.
Beside it the report prints the same prediction as one number per scale — bulk
cost over incremental cost — because a platform that charges the same for an
attached and a detached container has not reproduced the split whatever either
drift does. The verdict refuses to decide a run that measured fewer than two
scales, because a drift needs two points and reporting its absence as a failed
flatness test would publish a verdict for a run that tested nothing.
`dom-attach-analyze.mjs` holds every one of those decisions as pure functions so
the claim it generates is tested without spending a measurement window.

The prediction was refuted on both pairs and both readings: the platform charges
the same per node whichever shape it is handed, so it does not reproduce the
first-screen-versus-post-mount split. What the run does settle is how much of
publication the platform owns. Comparing one call against two — `live-bulk`'s
attach span is exactly the `rootDom.appendChild(page)` that `__FlushElementTree`
performs, and `papi_flush` is two calls in the whole first-screen window — the
platform is **33.2% / 37.1% / 30.3%** of `papi_flush` at 1k/10k/30k against the
same window's `upgraded` cells, where the `inert` cells alone would say 9.6% /
8.7% / 8.1%. Read wider, as `papi_topology + papi_flush` against the control's
insertion span, the platform is 24.5% / 26.7% / 24.1% of Octane's first-screen
insertion rate; that reading is the same order but carries the per-call
instrument overhead the flush comparison does not.

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

## 7. Main-thread script attribution (`stages/mts-profile.mjs`, on demand)

```bash
node stages/mts-profile.mjs --rows 10000
node stages/mts-profile.mjs --rows 1000 --reps 3 --cells octane,octane-mts-program
```

§6 prices the first screen either side of the host boundary and says which
first-screen phase owns the part above it. It cannot say which *function* does,
and issue #163 needs that: a compiled main-thread program issues the same host
calls the hand-written prototype issues, for the same host time, and is still
well short of it — so the cost is Octane's own script, and the question is
which part of it.

This samples that script directly. Chromium's CPU profiler runs while a
pre-populated bundle paints, and only frames belonging to the hidden
main-thread realm's Blob script are folded: the page realm runs the harness's
own paint predicate, which is measurement rather than framework and would swamp
everything. Frames are named by the string literals in the code — diagnostics,
wire-format property names, public identifier prefixes — because a production
bundle is minified and a mangled name says nothing. `mts-profile-buckets.mjs`
holds the probe table and every probe cites the source it came from.

**These milliseconds are not §6's.** A sampling profiler perturbs the page it
measures, and this run carries no uninstrumented control beside it. What is
reportable is the shape: which function owns the script, and how the cells
compare on one axis. Wall clocks come from `papi-run.mjs`.

### Reading past a frame names the wrong function

The probe window is 160 characters from a frame's own position, and that number
is calibrated rather than chosen. The closest pair of neighbouring functions in
the measured bundle — the applier's `visit` and `mountProgram` — sit 258
characters apart, so a wider window lets the first match the second's
diagnostic. At 420 characters it did: the run credited every `visit` sample to
a program mount, and the cell carrying no compiled program at all reported the
largest program-mount cost in the run. A bucket table that reads past its frame
produces a complete-looking report of the wrong thing, which is why
`stages/mts-profile.test.mjs` pins the spacing rather than any bucket's name.

### What the compiled program still pays for, at three scales (issue #163 C9)

Self time inside the main-thread realm, five profiled first screens per cell
per scale, taken twice — two independent windows over one build of every cell,
whose digests each record carries
(`results/c163-c9-script{,-b}-{1000,10000,30000}.md`).

**Read the shares, not the milliseconds.** Between the two series — same
bundles, same host, minutes apart — a cell’s whole script moves by up to 9%,
while no bucket’s share of it moves by more than 3.6 points. A share is
therefore a claim this instrument can carry and an absolute delta of under about
a tenth is not. Milliseconds below are series A’s, quoted to size the table
rather than to be differenced against another run.

| main-thread script @30,000 | `octane` | `+program` | `octane-direct` |
|---|---:|---:|---:|
| **program mount** | — | 185.5 [182.7–202.5] | — |
| renderer pre-passes | 159.6 [149.0–173.5] | 64.0 [63.8–68.6] | — |
| event bookkeeping | 56.3 [49.7–65.6] | 36.1 [33.6–48.2] | — |
| applier entry and pre-walk | 115.0 [104.2–118.2] | 31.9 [25.9–34.8] | — |
| applier walk | 460.0 [400.3–477.6] | 24.2 [20.2–25.6] | — |
| first tree capture | 128.4 [125.3–137.9] | 23.4 [20.9–29.4] | — |
| **the compiled program itself** | — | 22.8 [18.5–28.7] | — |
| first-screen entry | 33.5 [26.8–35.7] | 4.9 [4.0–6.7] | — |
| host record building | 265.5 [248.5–279.6] | 3.2 [1.4–3.7] | — |
| element factory dispatch | 10.7 [9.0–14.4] | 0.0 [0.0–0.2] | — |
| unnamed by the probe table | 71.0 [57.7–78.0] | 22.2 [20.1–25.5] | 28.4 [26.4–31.0] |
| **all frames** | **1317.2** | **424.1** | **28.4** |

The prototype has no framework rows by construction: it runs no Octane code, so
no probe can name it and its whole script is unnamed. At 1,000 and 10,000 rows
the three cells read 62.7 / 24.7 / 3.1 and 456.8 / 164.7 / 11.4 ms.

#### Which of it amortizes, and which of it is a per-row tax

Each bucket as a share of what the program cell spends, and the exponent that
fits the 30× range — `1.00` is exactly linear in rows, below it the cost
amortizes. Both windows, `A / B`:

| bucket | share @1k | @10k | @30k | exponent |
|---|---:|---:|---:|---:|
| **event bookkeeping** | 4.3 / 4.4% | 10.1 / 9.9% | 8.5 / 8.3% | **1.04 / 1.02** |
| **program mount** | 24.5 / 22.3% | 40.6 / 37.1% | 43.7 / 45.2% | **1.01 / 1.05** |
| **first tree capture** | 3.8 / 2.9% | 4.6 / 4.4% | 5.5 / 6.4% | **0.95 / 1.07** |
| applier walk | 4.3 / 7.0% | 5.8 / 5.4% | 5.7 / 5.0% | 0.92 / 0.74 |
| applier entry and pre-walk | 9.3 / 9.0% | 10.9 / 12.8% | 7.5 / 7.9% | 0.77 / 0.80 |
| compiled program create | 7.7 / 8.4% | 5.8 / 6.3% | 5.4 / 4.7% | 0.73 / 0.67 |
| renderer pre-passes | 26.4 / 24.1% | 15.3 / 15.5% | 15.1 / 14.7% | 0.67 / 0.69 |
| first-screen entry | 2.8 / 2.6% | 1.2 / 1.2% | 1.2 / 1.3% | 0.57 / 0.64 |
| **all frames** | 100% | 100% | 100% | 0.84 / 0.84 |

`element factory dispatch` and `host record building` carry no exponent: their
1,000-row cost rounds to zero in at least one series, which is itself the
finding about them — both are under 1% of the program cell at 30,000 rows. The
frames the probe table did not name are 5.2 / 5.1% at 30,000 rows and amortize.

Three things follow.

- **The compiled program’s own code is about 5% of what the program cell spends.**
  Straight-line emitted code costs within a few milliseconds of a
  hand-written emitter at every scale, and it amortizes. Nothing in issue
  #163’s remaining gap is the compiled program.
- **The program mount is now the largest single bucket, and its share grows**
  with the workload: 23% at 1,000 rows, 39% at 10,000, 44% at 30,000.
  The bucket is `mountProgram` self time, which issues no host call at all —
  the painting is the row above it. It is the framework’s per-row bookkeeping
  around a program, growing with the program’s reach rather than shrinking.
- **Exactly three buckets fail to amortize** — the mount, event bookkeeping and
  first-tree capture — and together they are 59% of the program cell’s script
  at 30,000 rows. Everything the compiled program actually removed amortizes at
  0.57–0.92. What is left is not a diffuse per-node cost to shave; it is three
  named per-row taxes. One of them has already been attacked once: first-tree
  capture was moved past the paint, and what survives that is still linear.

#### Why the earlier reading moved

An earlier version of this section read the same instrument at 10,000 rows and
concluded that no single bucket dominated, the largest being the program mount
at 24%. That record (`results/mts-profile-10000.md`) is a true reading of a
build three `packages/lynx` commits older than this one, and it is what the
conclusion was true of. Against the current head, at the same 10,000 rows:

| bucket | then | now (A / B) |
|---|---:|---:|
| program mount | 23.8% | 40.6 / 37.1% |
| applier walk | 15.8% | 5.8 / 5.4% |
| host record building | 11.4% | 0.3 / 0.2% |
| first tree capture | 5.5% | 4.6 / 4.4% |
| event bookkeeping | 5.9% | 10.1 / 9.9% |

Those three commits moved a program’s text painting into the program and took
the first-tree token index off the paint path. They did what they were for —
`applier walk` and `host record building` all but leave the program cell — and
the mount is what is left holding the per-row cost. The shares are the
comparable quantity across two builds measured on different days; the
milliseconds are not, which is the whole reason this section is written in
shares.

The failure that produced the earlier draft of this section is worth naming,
because nothing on disk caught it: the 1,000- and 10,000-row points were read
from records taken before those three commits and the 30,000-row point after,
and the series showed `host record building` getting *cheaper* as the workload
tripled. That is why every record here now names the bundle it measured.

The split still agrees with §6’s phase attribution taken independently: the
buckets inside `publish` sum to 4.9× those inside `render` in series A
and 5.0× in series B, and capture is small in both. Two instruments, one
conclusion.

### What the per-row event journal costs (issue #163 C10)

The C9 split says three buckets fail to amortize. This ablation prices one of
them. The treatment arm deletes the whole per-row event-journal loop in
`mountProgram` — the parse, the `nativeEventMap` write and the frozen tuple —
which makes it wrong on purpose: nothing would be left for terminal cleanup to
clear. It is a ceiling on what that loop is worth, not a candidate, and it was
never committed. Control and treatment are the same source but for that loop,
built into two dists and measured in one window
(`results/c163-c10-armE-30000.md`).

| main-thread script @30,000 | control | loop ablated | delta |
|---|---:|---:|---:|
| program mount | 199.2 [192.4–207.1] | 184.5 [170.0–196.0] | -14.8 |
| renderer pre-passes | 64.9 [60.6–71.5] | 67.0 [61.7–72.0] | +2.1 |
| event bookkeeping | 38.7 [34.3–42.2] | 7.2 [6.1–9.8] | -31.5 |
| applier entry and pre-walk | 33.2 [24.9–36.1] | 32.4 [27.7–35.2] | -0.7 |
| applier walk | 25.4 [23.5–30.2] | 21.5 [19.6–27.0] | -4.0 |
| compiled program create | 23.7 [19.4–29.9] | 19.6 [16.6–21.7] | -4.1 |
| first tree capture | 23.0 [21.0–30.6] | 21.3 [20.7–23.6] | -1.7 |
| first-screen entry | 5.6 [4.4–8.4] | 5.2 [5.1–8.2] | -0.4 |
| host record building | 2.4 [1.4–3.6] | 2.3 [1.5–2.9] | -0.1 |
| element factory dispatch | 0.2 [0.0–0.2] | 0.0 [0.0–0.2] | -0.2 |
| unnamed by the probe table | 21.3 [18.3–26.2] | 22.3 [19.5–26.3] | +1.0 |
| **all frames** | 437.4 [429.4–461.0] | 390.4 [370.0–395.6] | -47.0 |

Three things follow, and the third is why no patch went with this record.

- **The loop is worth 47.0 ms of the cell's 437.4 ms script, 11%.** The two
  arms' whole-script ranges do not overlap, which at this instrument's window-
  to-window spread is the weakest claim worth making and this one clears it.
- **It is `event bookkeeping`, not the mount.** 31.5 of the 47.0 ms land in that
  bucket, 82% of everything it holds in this cell — the loop *is* that bucket.
  `program mount` moves 14.8 ms with overlapping ranges, so this ablation does
  not explain the mount, and the mount's 199 ms stays unattributed. The buckets
  are frames, and a callee's self time belongs to the callee.
- **There is no constant to hoist.** The reading that motivated the ablation was
  that `parseLynxNativeEventProp` re-derives a per-plan constant once per row.
  It does, and it costs almost nothing: the parser memoizes on the prop name, so
  a repeat call is a `typeof`, a `charCodeAt` and a map lookup. What the loop
  actually spends is a fresh `Map` per event-bearing node per row plus a frozen
  three-field tuple per site, and that is retained state — terminal cleanup
  reads exactly those tuples to know what to clear. It is reachable only by
  changing how the registration is retained, which is a design slice with
  cleanup, adoption and the ownership equality to satisfy, not a constant to
  lift out of a loop.

### What the program mount is actually spending, at 30,000 rows (issue #163 C11)

C9 named `program mount` the largest single bucket in the program cell, and the
one whose share grows with the row count; C10 ablated the per-row event journal
and moved it 14.8 ms with overlapping ranges, which left it unexplained. This
ladder explains it. Four builds of the same app ran in one window — control,
and three arms each deleting one thing from `mountProgram` — because two
records of identical bundles disagree by up to 9% on the whole-script median,
which is larger than the rungs being separated
(`results/c163-c11-mount-30000.md`).

Every arm is wrong on purpose and none was committed. Two of them delete a
journal the container cross-checks and stub the check that would have caught
it, which is exactly what makes them ceilings rather than candidates: the
ownership equality counts both journals against each other, so removing either
one deletes a check rather than a cost.

| arm | what it deletes from the shipping source |
|---|---|
| `mountctl` | nothing — byte-identical to the shipping `+mts-program` build |
| `mountj` | both ownership journals: `ownedNodes.add` **and** `programNodes.set`, for every program node and every painted range text |
| `mountl` | only `programNodes.set`, keeping `ownedNodes.add` — so `mountj` minus `mountl` is the ownership `Set` alone |
| `mountk` | the per-site token preparation: the `eventsByHost` lookup and the linear `.find` over that host's announced listeners |

| main-thread script @30,000 | control | `mountj` | `mountl` | `mountk` |
|---|---:|---:|---:|---:|
| program mount | 196.9 [178.9–211.0] | 87.7 [82.3–90.6] | 140.0 [138.3–145.8] | 130.9 [126.7–151.1] |
| renderer pre-passes | 63.0 [58.7–73.8] | 66.3 [64.9–74.9] | 66.1 [62.4–69.1] | 68.8 [66.5–75.6] |
| event bookkeeping | 37.9 [34.7–41.9] | 36.5 [32.5–38.5] | 35.5 [34.9–39.5] | 0.0 [0.0–0.0] |
| applier entry and pre-walk | 30.9 [29.3–33.2] | 30.8 [24.7–37.2] | 33.4 [32.1–35.3] | 31.3 [29.3–39.7] |
| first tree capture | 26.1 [21.1–29.1] | 0.0 [0.0–0.0] | 0.0 [0.0–0.0] | 21.7 [21.1–41.4] |
| applier walk | 22.3 [21.3–25.9] | 21.9 [19.4–25.6] | 22.6 [19.8–27.8] | 20.8 [19.7–27.3] |
| compiled program create | 20.5 [17.5–26.4] | 23.1 [18.4–25.0] | 24.9 [20.7–26.2] | 13.0 [10.1–14.2] |
| first-screen entry | 4.6 [3.5–6.1] | 5.0 [3.9–6.1] | 5.9 [3.6–6.8] | 5.3 [4.9–7.1] |
| host record building | 2.6 [2.3–3.8] | 2.1 [1.6–3.0] | 2.8 [1.6–3.4] | 2.0 [1.7–3.6] |
| element factory dispatch | 0.0 [0.0–0.2] | 0.0 [0.0–0.2] | 0.0 [0.0–0.2] | 0.0 [0.0–0.2] |
| unnamed by the probe table | 21.8 [21.4–23.7] | 22.7 [20.4–24.7] | 23.2 [22.2–24.1] | 23.7 [19.7–24.5] |
| **all frames** | **421.5 [406.5–452.5]** | **299.3 [282.8–310.9]** | **356.3 [347.2–361.9]** | **313.9 [307.4–362.8]** |

The arms all read a few milliseconds high in buckets they do not touch —
`renderer pre-passes` moves +3.3 to +5.8 — so the whole-script delta is smaller
than the sum of the buckets each arm aimed at. The aimed-at buckets are the
attribution; the whole-script delta is the value.

#### What the mount's 196.9 ms is

| part of `mountProgram` | ms @30,000 | share of the bucket | per operation |
|---|---:|---:|---|
| the ID map, `programNodes.set` | 56.9 | 29% | 0.27 µs × 210,000 writes |
| the ownership `Set`, `ownedNodes.add` | 52.3 | 27% | 0.25 µs × 210,000 writes |
| the per-site token lookup | 66.0 | 34% | 1.10 µs × 60,000 sites — an upper bound; C13 splits it |
| everything else it does | 21.7 | 11% | the argument array, the validations, the attach frame |

The benchmark's `Row` compiles to a plan of 5 nodes, 2 event sites and 2 keyed
ranges, so a mount writes 5+2 entries into each journal per row — 210,000 into
each at this scale, into structures that end the first screen holding that
many. Read that way the two halves cost the same per write, 0.27 µs against
0.25 µs, which is what a hash insert costs and not what a loop costs.

Four things follow.

- **The mount is attributed.** The journals account for 109.2 ms and the token
  lookup for 66.0 ms of the bucket's 196.9 ms — 89% of it. Every one of those
  three arms has a `program mount` range disjoint from control's.
- **The largest single cost on this first screen is a journal, and it is an
  invariant.** Deleting both halves takes 122.2 ms off the cell's 421.5 ms
  script, 29%, with disjoint whole-script ranges — and none of it is for sale.
  `host-driver.ts` checks `ownedNodes.size` against `records.size -
  logicalNodes.size + programNodes.size` precisely because the two journals are
  written from one loop and can only be trusted against each other. Collapsing
  either deletes the check. What the number is for is bounding a
  *representation* change, which is a different question and one this ladder
  does not answer.
- **The first tree capture is a second copy of the same map.** `first tree
  capture` falls from 26.1 ms to 0.0 in both arms that empty `programNodes`,
  and the only thing in that function proportional to the program is `new
  Map(state.programNodes)` — 210,000 entries copied so the capture survives the
  container clearing its own map. The two arms also stub that function's
  ownership equality and its page-root resolution, which are a size comparison
  and a loop over the page's single root. The copy is 26.1 ms, 0.12 µs an
  entry.
- **Events cost 107.6 ms end to end, 26% of the script** — 66.0 in the mount
  preparing tokens, 37.9 in `event bookkeeping` encoding and journalling them,
  and 7.5 in `compiled program create` — the `setEvent` calls the program stops
  making, plus the `.find` predicate that the hoisted shape credits to that
  bucket, which this arm is the only one to bound. C10 priced the journal half
  at 47.0 ms in its own window; this window prices the whole of it.

The token lookup is the one part of the mount with no invariant behind it. This
section first read its cost as the predicate `([type]) => type === site.type`,
which allocates a closure per site per row and destructures each candidate entry
through the iterator protocol, and proposed an explicit indexed loop as the
candidate. **That reading was wrong.** C12 below built exactly that candidate and
measured it against a control at n=15 in one window: it moves the mount by
+3.8 ms and the whole script by −9.0 ms, neither disjoint from control. What the
66.0 ms in the table actually holds is measured there, along with the reason the
row is an upper bound rather than a cost.

#### The probe this ladder broke, and what that says about the instrument

`mountk`'s first run reported `program mount` at 0.0 ms with 154 ms of new
`unmatched`. The bucket had not moved; its probe had. Frames are named by the
string literals near their entry, and the minifier decides how near: when the
per-site loop body closes over its site it is hoisted into a helper at the
function's start, which puts the event message 82 characters in, and when the
ablation removed that closure the hoist went with it and the message landed
1051 characters in — past the 160-character window the table can afford without
neighbouring functions reaching each other.

So the probe table's own claim, that a probe stops matching only when its
message changes, was too strong: a probe also stops matching when minification
moves the function's entry away from it. `program mount` now carries a second
entry probe, and both name the mount frame whose unnamed callee is the compiled
create, so the bucket survives either shape. The defect was visible at all
because `unmatched` is reported rather than folded away — the run that found it
is kept at `results/c163-c11-probe-defect-30000.md`.

### What the mount's event-site lookup is, and what it is not (issue #163 C12)

C11 named the per-site token lookup as 66.0 ms of the mount at 30,000 rows and
said what it thought that cost was: a predicate closing over its site and
destructuring each candidate. **That reading was wrong**, and this is the
window that says so. Four arms, 15 readings each, one window
(`results/c163-c12-lookup-30000.md`). `**` marks a delta whose 95% interval on
the mean is disjoint from control's; everything else is inside the window.

| arm | what it changes |
|---|---|
| `mountctl` | nothing — the shipping `+mts-program` build, digest `381fe0ab988a479c` |
| `mountk` | the whole lookup and encode: every site's token becomes a literal `undefined` (C11's arm K, rebuilt to the same digest) |
| `mountn` | keeps the lookup, answers with a constant token — so this is the encode alone |
| `mountfix` | the candidate C11 proposed: the `.find` predicate replaced by an indexed loop, everything else unchanged |

| main-thread script @30,000 | control | `mountk` | `mountn` | `mountfix` |
|---|---:|---:|---:|---:|
| program mount | 204.5 [177.7–230.7] | 139.9 [113.7–155.2] | 182.2 [165.9–203.7] | 206.9 [184.5–247.5] |
| renderer pre-passes | 70.0 [58.8–88.8] | 70.3 [56.8–86.3] | 67.4 [58.5–79.0] | 66.5 [56.7–82.0] |
| event bookkeeping | 39.4 [33.0–50.2] | 0.0 [0.0–0.0] | 35.6 [28.4–43.2] | 42.0 [35.0–50.0] |
| applier entry and pre-walk | 33.3 [25.3–41.9] | 33.1 [25.0–42.5] | 32.6 [25.1–34.1] | 32.0 [26.9–38.3] |
| applier walk | 25.1 [20.8–27.6] | 22.9 [18.3–26.1] | 23.2 [19.7–28.4] | 26.6 [23.0–29.4] |
| first tree capture | 24.5 [21.0–36.1] | 27.2 [21.0–38.0] | 24.6 [21.2–39.4] | 29.3 [23.4–44.4] |
| compiled program create | 24.4 [21.9–30.2] | 13.6 [11.8–17.2] | 16.5 [15.1–21.5] | 19.0 [15.0–23.1] |
| first-screen entry | 5.5 [3.7–27.1] | 5.7 [3.0–9.3] | 6.0 [3.2–9.5] | 5.8 [3.4–8.4] |
| host record building | 2.8 [1.1–3.5] | 2.6 [1.6–3.4] | 2.1 [1.4–3.6] | 2.6 [1.6–4.0] |
| element factory dispatch | 0.0 [0.0–0.2] | 0.0 [0.0–0.2] | 0.2 [0.0–0.2] | 0.0 [0.0–0.2] |
| unnamed by the probe table | 25.5 [21.6–33.6] | 25.5 [20.0–29.2] | 22.4 [17.4–27.7] | 21.7 [19.1–28.2] |
| **all frames** | **457.0 [420.2–509.2]** | **344.4 [292.0–391.4]** | **422.1 [378.8–448.5]** | **451.5 [416.4–530.4]** |

| mean delta vs control | `mountk` | `mountn` | `mountfix` |
|---|---:|---:|---:|
| program mount | **-65.1** | **-21.9** | +3.8 |
| event bookkeeping | **-39.9** | -4.4 | +1.6 |
| compiled program create | **-11.4** | **-8.0** | **-6.4** |
| all frames | **-123.2** | **-48.9** | -9.0 |

Three things follow, and the third is the reason no patch went with this record.

- **The predicate is not the cost.** `mountfix` moves the mount by +3.8 ms and
  the whole script by -9.0 ms, neither disjoint from control. It does exactly
  what it was designed to do — the minified output confirms the closure and the
  hoisted per-site helper are both gone — and nothing leaves the script. The
  change was reverted; only the tests it came with were kept, because the gap
  they close is real whatever the milliseconds say.
- **The token string is 21.9 ms of the mount**, and it is charged to the
  mount's own frame. `mountn` keeps the lookup and answers with a constant, and
  the mount drops that much with a disjoint interval — while `event
  bookkeeping`, where the encoder's own frame lives, drops only 4.4 ms and
  stays inside the window. Most of what minting a token costs is therefore
  charged to the caller: the shape of an inlined callee, which this instrument
  can show but cannot prove. 60,000 tokens per first screen, each a fresh
  string of a prefix and five numbers.
- **An ablation that folds to a constant removes more than the code it deleted,
  and C11's 66.0 ms is an upper bound because of it.** `mountk` makes every
  token a compile-time `undefined`, which lets the compiler thin out what reads
  them downstream as well; `mountn` and `mountfix` change code without changing
  what is known about it. Against `mountctl` the three arms take 65.1 and 21.9
  ms out of the mount and put 3.8 back, and the first of those is the only one
  that cannot be read as the cost of the lines it removed.

So of the 65.1 ms `mountk` takes out of the mount, 21.9 is minting the token,
none of it is the predicate, and the remainder is the `eventsByHost` lookup
together with whatever the constant let the compiler fold — which this ladder
cannot separate. C13 below is the arm that does: it answers with a value the
compiler cannot see through, and splits the remainder into 38.0 ms of lookup and
5.2 ms of fold.

`compiled program create` falls in all three arms — by 11.4, 8.0 and 6.4 ms,
each disjoint from control — and only two of the three have an account.
`mountk`'s is the program doing less: it installs no events at all.
`mountfix`'s is the bookkeeping artifact C11's probe note predicted: in the
shape where the minifier hoists the per-site loop body, that helper's unnamed
callee is the `.find` predicate rather than a create, so the predicate's own
time sits in this bucket until an arm removes the hoist — a naming error worth
6.4 ms rather than a cost. `mountn`'s has neither account: it keeps the hoist
and still installs an event per site, and it is recorded here unexplained
rather than folded into one of the other two.

### The lookup is 38 ms, and the fold hazard is now a number (issue #163 C13)

C12 left one thing unseparated. Arm K takes 65.1 ms out of the mount by
answering every site with a compile-time `undefined`, which removes the
`eventsByHost` lookup, the token encode, **and** whatever the compiler could then
delete downstream. C12 priced the encode alone at 21.9 ms with a constant token.
What was left — the lookup, plus the fold — was one number.

`mountp` is the arm that splits it. It keeps the encode fully live: `hostId`
still varies per site, the listener id and priority still come off the envelope
at runtime, so all four `assertPositiveSafeInteger` calls, the priority check
and the concatenation run exactly as they ship. It replaces only
`eventsByHost.get(hostId)?.find(([type]) => type === site.type)` with an indexed
read of a two-element array collected from the envelope in O(1). The index is
`hostId & 1`, so it still depends on the site's own host and the
`announced === undefined` branch cannot hoist out of the loop; the array holds
real descriptors the compiler cannot see, so nothing about the token folds.
`eventsByHost` is still built and still read by the two consumers outside this
loop, so the envelope-time cost is identical in both arms.

Two arms, 15 readings each, one window
(`results/c163-c13-lookup-30000.md`). `**` marks a delta whose 95% interval on
the mean is disjoint from control's.

| main-thread script @30,000 | control | `mountp` | mean delta |
|---|---:|---:|---:|
| program mount | 208.9 [183.7–238.7] | 167.0 [150.9–194.2] | **−38.0** |
| renderer pre-passes | 67.2 [60.8–94.7] | 66.4 [55.6–77.8] | −4.7 |
| event bookkeeping | 39.4 [33.4–50.0] | 40.4 [32.7–48.7] | +1.4 |
| applier entry and pre-walk | 34.1 [27.8–43.8] | 31.4 [25.7–39.3] | −2.6 |
| applier walk | 23.9 [17.7–26.8] | 25.8 [21.6–36.4] | +2.5 |
| first tree capture | 22.5 [21.0–46.0] | 30.6 [20.7–44.1] | +5.4 |
| compiled program create | 24.0 [20.9–28.1] | 18.2 [15.0–23.6] | **−5.4** |
| first-screen entry | 5.4 [3.9–8.4] | 5.2 [2.8–8.3] | −0.2 |
| host record building | 2.1 [1.0–3.7] | 2.5 [1.8–3.9] | +0.4 |
| unnamed by the probe table | 22.9 [17.9–26.4] | 23.3 [19.7–27.6] | −0.1 |
| **all frames** | **455.9 [401.6–536.9]** | **410.8 [376.9–450.0]** | **−41.4** |

**`event bookkeeping` does not move** — +1.4 ms, well inside the window — and
that is the arm's own control. Arm K drove that bucket to exactly 0.0 because
its constant let the compiler delete the install path; this arm mints and
installs 60,000 real tokens, so the bucket stays. Whatever `mountp` takes out of
the mount is the lookup and nothing downstream of it.

**The lookup is 38.0 ms of the mount**, disjoint, and 41.4 ms leaves the script.
That is 0.63 µs a site across 60,000 sites, which for a number-keyed `Map`
holding 60,000 entries is a cache miss and an entry-array dereference rather
than a loop. C12 already established the `.find` predicate is not in it.

#### The two halves that cannot fold, against the one that can

| | mount | all frames |
|---|---:|---:|
| the encode alone (`mountn`, C12) | 21.9 | 48.9 |
| the lookup alone (`mountp`, this window) | 38.0 | 41.4 |
| **the two together** | **59.9** | **90.2** |
| both at once, with the fold (`mountk`) | 65.1 | 123.2 |

The two arms that cannot fold sum to 59.9 ms of the mount against arm K's 65.1,
which closes 92% of it. They are measurements of the same two lines from
different windows, so the agreement is itself the check, and the 5.2 ms that does
not close is the fold. On the whole script the same arithmetic leaves 32.9 ms
unaccounted while arm K's `event bookkeeping` drop is 39.9 — so what arm K
removed beyond these two lines is approximately the install path its constant
deleted. **C12 named the hazard; this is its size.** An ablation whose
replacement folds to a constant over-stated this one by ~5 ms on the frame it
targeted and by ~33 ms on the script.

#### What this licenses, and what it does not

`mountp` is **not** a candidate. It answers each site from a two-element table
instead of from its own host's announcement, so a site's token can name a
listener the renderer never passed it — which nothing in a first screen notices
and everything after one would. What the arm establishes is a ceiling: a correct
removal of this lookup is worth up to 38.0 ms of the mount at 30,000 rows, and
no patch has yet delivered any of it.

The lookup exists because the envelope announces listeners **per host** —
`{id, type, listener}` — while the program declares its event sites **per
site**, `{slot, node, type}`. The mount joins the two on `(hostId, type)`,
60,000 times, and the join is an index rather than a check: it decides which
listener a site installs, not whether the render is well-formed. Nothing about
it cross-checks two journals the way the ownership equality does, so removing it
deletes no invariant — which is precisely what makes it the first thing on this
frame worth designing against. Whether the renderer can announce in site order,
and what that costs on the wire and in the background, is the next slice's
question rather than this one's.

Before the window opened, the mount probe was confirmed to be within reach in
both bundles — the minifier's per-site hoist is absent in `mountp`, exactly the
shape C11's second probe was added for — and the check is kept at
`results/c163-c13-probecheck-30000.md`. `unnamed` is 23.1 and 23.0 ms in the two
arms, so no bucket quietly stopped matching.

## Claims and non-claims

Command counts and commit bytes are Octane-owned costs and are gated. The
in-process milliseconds and the Lynx-for-Web wall clock are CPU/browser-host
costs — no native paint, layout, adoption, or device claim. Native gates
remain the separate Android/iOS story (`docs/lynx-native-renderer-plan.md`).
