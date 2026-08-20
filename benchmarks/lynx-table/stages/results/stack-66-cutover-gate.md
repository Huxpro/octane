# L5 cutover gate, judged on the unmerged issue-#66 stack

Issue #58's L5 milestone ends with a cutover: flip `lynxRendererRules` to the
specialized target and mark the universal Lynx path deprecated. It gates that
flip on three clauses — create wall-clock at 10k rows materially below the
recorded 1,201 ms with PAPI-stage dominance reduced; main-thread gzip
meaningfully toward the ~51 KB median; no wire-floor regressions.

This report judges those three clauses on the tree the #66 execution actually
produced, and returns a verdict. It is issue #66 Phase D, steps D2 and D3. The
bundle clause is answered by
[`stack-66-reaudit.md`](../../../lynx-bundle-size/results/stack-66-reaudit.md)
and restated here; the other two are measured here.

**Verdict: NO-GO.** One clause of three passes. Details in §6.

## 1. Arms

- **base** — `origin/new-lynx` `5d61724`, the integration base for the whole
  stack.
- **head** — `perf/lynx-direct-first-screen-lists` `566700e`, the stack tip
  (Phase 1 delta protocol v2 → #103 U2b block core → Phase B → Phase C).

Same container, same Chromium 141.0.7390.37, same Node v22.22.2, 4× Xeon
2.80 GHz. The two stage runs are eight minutes apart in one window: head at
`17:43:28Z` (host load 1.53/0.97/1.11 at start), base at `17:51:40Z`
(0.47/0.59/0.90).

## 2. What is comparable across the arms, and what is not

The stack changes the benchmark harness as well as the runtime, so this has to
be said before any number is read.

**Comparable.** The outer wall-clock endpoints are identical on both arms:
create is pointerdown → composed-tree observer sees 10,000 rows, FCP is
main-thread iframe Blob assignment → observer sees all rows. The
`papi_element_creation` and `mt_apply_other` timers are untouched across the
stack — the only edit to the `papi.ts` instrumentation patch is publishing a
replay-window flag (`benchReplayWindow`), which adds no timer and moves no
boundary. Wire byte and message counters are deterministic.

**Not comparable.** The stack splits the background stage: base reports one
`bg_replay`, head reports `bg_prepare` + `bg_replay_other`. Compare those as a
sum or not at all. The base harness also has no `update10th`, `select`, or
`updateStorm` stage — those cells were added by this stack — so the only
same-protocol stage cells are create, replace, append, and FCP.

**Not available.** The 1,201.5 ms figure the gate names comes from
[`live-report.md`](live-report.md), measured on a different host (Chromium
`149.0.7827.55`) and at the pre-correction background boundary. Absolute
milliseconds are host-bound, so that number cannot be compared to anything
measured here. The same-window base arm exists precisely to replace it.

**Calibration.** The vendored `vue-vdom` reference bundle is byte-identical in
both windows and changes with neither arm, so its own movement bounds what this
protocol can resolve: create@10k 2,320.9 ms (base window) against 2,242.1 ms
(head window) — **3.4% of drift on an invariant**. In the web sweep the same
role is played by `react`, whose ratio moved 0.86× → 0.81×, about 6%. Treat
cross-window deltas below those bounds as unresolved.

## 3. Stage decomposition at 10,000 rows

### create@10k

| segment | base `5d61724` | head `566700e` |
|---|---:|---:|
| background replay (`bg_replay`; head: `bg_prepare` + `bg_replay_other`) | 234.5 ms (12.0%) | 224.9 ms (11.4%) |
| `wire_clone_transfer` | 3.7 ms (0.2%) | 5.6 ms (0.3%) |
| `mt_validate` | 16.6 ms (0.9%) | 17.5 ms (0.9%) |
| `mt_expand` | 0 ms (0.0%) | 0 ms (0.0%) |
| `mt_prepare` | 6.7 ms (0.3%) | 6.7 ms (0.3%) |
| `papi_element_creation` | 935.9 ms (48.0%) | 1,028.7 ms (52.0%) |
| `mt_apply_other` | 569.0 ms (29.2%) | 501.4 ms (25.4%) |
| `mt_ack_publication` | 0.7 ms (0.0%) | 0.8 ms (0.0%) |
| `presentation_residual` | 195.5 ms (10.0%) | 213.8 ms (10.8%) |
| **PAPI-stage dominance** (creation + other apply) | **77.2%** | **77.4%** |
| profiled wall | 1,949.1 ms | 1,977.9 ms |
| **control wall (production bundle)** | **1,825.5 ms** | **1,901.8 ms** |
| `vue-vdom` in the same window | 2,320.9 ms | 2,242.1 ms |

Dominance did not fall. It moved 77.2% → 77.4%, which is inside the noise of
either arm, and the split inside it changed rather than the total: +92.8 ms of
PAPI element creation against −67.6 ms of other host apply. Neither timer moved
across the stack, so that shift is real work relocating, not re-attribution —
but it nets to +25 ms, in the wrong direction.

Create wall-clock did not fall either. Control is +4.2% on the head, profiled
+1.5%. The n=5 control distributions overlap heavily (base
1,740.7–1,955.2 ms, head 1,692.4–1,995.1 ms), so a single arm pair does not
separate them; §5 shows the direction is nonetheless consistent.

### FCP@10k — the one cell that moved

| segment | base | head | Δ |
|---|---:|---:|---:|
| `mt_slice_eval` | 26.7 ms (1.0%) | 26.3 ms (1.1%) | −1.5% |
| `plan_interpretation` | 117.0 ms (4.4%) | 77.9 ms (3.2%) | **−33.4%** |
| `papi_element_creation` | 940.1 ms (35.2%) | 882.1 ms (36.6%) | −6.2% |
| `layout_flush_residual` | 1,570.8 ms (58.8%) | 1,396.5 ms (58.0%) | −11.1% |
| profiled wall | 2,715.2 ms | 2,444.0 ms | −10.0% |
| **control wall** | **2,577.6 ms** | **2,382.5 ms** | **−7.6%** |

Every segment fell and the total fell by more than the invariant's 3.4% drift
bound. This is what Phase B and Phase C were aimed at, and it is the stack's
clearest measured win.

It is also the cell where #58's L3 exit gate wanted `plan_interpretation`
*eliminated*, not reduced. At 77.9 ms and 3.2% it is neither gone nor
negligible: the direct applier bypasses the plan interpreter for the trees it
accepts, and the interpreter still ships and still runs.

## 4. Parity against the vendored references

Full web sweep, `web/run-web.mjs --reps 5`, references pinned at
`Huxpro/vue-lynx@02376ecd`. Ratios are same-window against `vue-vdom`, which is
the portable claim; absolute milliseconds are not comparable between the arms.

10,000 rows, `octane` cell, ×vs `vue-vdom` (lower is better):

| op | base | head | branch-independent control (`react`) |
|---|---:|---:|---:|
| create | 0.85× | 0.81× | 0.86× → 0.81× |
| update10th | 1.33× | 1.27× | 1.29× → 1.22× |
| select | 0.98× | 0.97× | 1.32× → 1.39× |
| updateStorm | 0.32× | 0.36× | 1.94× → 2.06× |
| selectStorm | 0.12× | 0.18× | 1.70× → 1.79× |

Read this table with two corrections and it says almost nothing changed.

The `react` column moves 0.86× → 0.81× on create with no code changing on
either side of it, which is the ~6% drift bound from §2; create, update10th,
and select all sit inside it. And the base arm could not interleave its cells —
cell interleaving was added *by this stack* — so the base ratios carry an
ordering bias the head ratios do not.

`selectStorm` reads as a 50% regression and is not one: §5 re-measured that cell
directly.

## 5. The mutation cells carry a small, consistent excess

`selectStorm@10k` looked like a +34% regression in the single-pass sweep, so it
was re-measured properly: six alternating passes on the `octane` cell alone,
three AB (head first) and three BA (base first), each pass a median of five
repetitions.

| op @10k | base median | head median | head/base |
|---|---:|---:|---:|
| create | 1,807.9 ms | 1,865.1 ms | 1.032 |
| update10th | 256.9 ms | 267.8 ms | 1.042 |
| select | 134.7 ms | 130.7 ms | 0.970 |
| **selectStorm** | **193.6 ms** | **193.1 ms** | **0.997** |
| updateStorm | 1,000.4 ms | 1,076.2 ms | 1.076 |

`selectStorm` is settled: 0.997, no difference. The apparent regression was
window noise, and the branch-independent cells in that same sweep moved as much
or more.

What the re-measurement did surface is smaller and more durable. On create,
update10th, and updateStorm the head is a few percent above the base **in both
orderings** — head-first and base-first alike — so it is not an ordering
artifact. Per-pass create: AB head 1814/1903/1945 against base 1814/1821/1802;
BA base 1854/1757/1733 against head 1892/1815/1839. The stage decomposition
agrees independently at +4.2% control.

Two same-window protocols agreeing on direction is more than noise and less than
a demonstrated regression. **The mechanism is not a logic change on the mutation
path — the diff rules that out.** The stack edits nine source files:

| file | reaches a mutation cell? |
|---|---|
| `core/block-core.ts`, `core/block-root.ts` | no — new, behind a per-root flag |
| `core/delta-protocol.ts`, `core/delta-shadow.ts` | no — profiling-only, constructed only under `LYNX_PROFILE` |
| `main-renderer.ts`, `core/first-screen.ts` | no — first-screen render only |
| `main-thread.ts` | no — the direct-applier call site |
| `core/host-driver.ts` | no — every hunk lands in `applyLynxFirstScreenDirect`, `captureLynxFirstTree`, `compareFirstTree`, `transferFirstTree`, the native-list constructors, or the once-per-root `firstTreeAction === 'adopt'` branch of `prepareLynxHostBatch` |
| `compiler/compile-universal.js` | no — one slot kind flips `'c'` → `'r'`; `slots` is read only by `main-renderer.ts`, which validates and copies it and branches on neither value |

Nothing a mutation cell executes after adoption was edited. That leaves two
candidates, and this report claims neither:

1. **The bigger main-thread bundle.** The stack adds +4,202 B raw / +1,721 B
   gzip to the main program, and every mutation cell runs inside it. Parse cost,
   code layout, and JIT behaviour all move with bundle size. If this is the
   mechanism, the excess is the trade the bundle re-audit already priced in
   bytes, seen in milliseconds — not a defect.
2. **Slow drift the AB/BA design does not control.** Alternation controls
   ordering within a window; it does not control a host trending over an
   afternoon, and both protocols ran on the same container in the same
   afternoon.

Separating them needs a dedicated session. The first is directly testable: pad
the base bundle with dead bytes to the head's size and re-run the AB/BA sweep.

## 6. The gate, clause by clause

> create wall-clock at 10k rows materially below the current 1,201 ms with
> PAPI-stage dominance reduced

**FAIL.** The 1,201 ms figure is not comparable — different host, different
background boundary — so the clause is judged against the same-window base.
Control create is 1,825.5 ms on the base and 1,901.8 ms on the head: not below,
and §5 puts the direction consistently the wrong way. Dominance is 77.2% → 77.4%:
not reduced.

> main-thread gzip meaningfully toward the ~51 KB median (propose ≤1.5× as the
> target)

**FAIL on the gated fixture.** 1.585× on `lynx-bundle-size`, widened from 1.552×
on the base; 1.187× on the rows-0 `lynx-table` app, which meets it. #58 does not
say which fixture answers the clause, and the two disagree because they are
different applications. The stack's own cost is +1,721 B main gzip (+2.17%), all
of it first-screen work; #103's block core costs the main thread zero bytes.
Full derivation in
[`stack-66-reaudit.md`](../../../lynx-bundle-size/results/stack-66-reaudit.md).

> no wire-floor regressions

**PASS.** `node benchmarks/bench.mjs --only lynx-table --ratios` prints
byte-identical counters on both arms and passes on both — 24 of 299 guards
checked, no guard breached, at 1k and 10k:

```
rows= 1000  create=1 (1000r)  update10th=100 (100r)  select=2 (225B, 2r)  swap=2 (368B, 0r)  updateStorm=50c/5000 (5000r)  selectStorm=30c/60 (60r)
rows=10000  create=1 (10000r) update10th=1000 (1000r) select=2 (225B, 2r)  swap=2 (368B, 0r)  updateStorm=50c/50000 (50000r) selectStorm=30c/60 (60r)
```

The stage arm agrees: create@10k carries 19,610 B / 15 messages MTS→BTS and
347,217 B / 10 messages BTS→MTS on the base, against 19,606 B / 15 and
347,227 B / 10 on the head. Four bytes out and ten bytes in, at identical
message counts, is below any floor this gate could mean.

### Verdict

**NO-GO on flipping `lynxRendererRules` and deprecating the universal Lynx
path.** One clause of three passes, and the one the milestone leads with — the
create path — is the one with no movement to show.

This is not a verdict on the stack. Phase B and Phase C did what they set out to
do, and the FCP table in §3 is the proof: −7.6% control, with plan interpretation
down a third. The mismatch is that **#58's L5 gate is written about the create
path, and #66 Phases B–C were executed against the first-screen path.** Those
are different code paths on this app: create is a button-driven background render
through the staged batch, and the first screen is the direct applier. Work on one
does not move the other, and the evidence here shows it did not.

The consequence for planning is that the gate is not close and will not be closed
by more first-screen work. §3 says where it would be closed instead: PAPI element
creation plus other host apply is 77% of create and has been at every measurement
since `live-report.md`. That is a host-materialization owner. Until a milestone
takes it, the cutover clause about create wall-clock cannot move.

## 7. Handoff: what a native-engine measurement would need

Everything above is Lynx-for-Web. No claim here is a native claim, and this
section is a specification of work not done, not a claim to have scoped it. It
belongs to whoever owns the native runner.

1. **A native arm of the stage decomposition.** The instrumentation patches
   `packages/lynx/src/core/papi.ts` in-tree and reads `performance.now()` in the
   web host. A native runner needs its own attribution at the same four
   boundaries — slice evaluation, plan interpretation, PAPI element creation,
   flush residual — or the FCP table above has no native counterpart.
2. **A native first-paint number for the native-list page.** The 70.4 → 29.5 ms
   figures for the 1,000-row `<list>` first screen come from a vitest harness
   that hands the background's commit over immediately. A real device pays a
   bundle load and a cold render on another thread first, so those figures are a
   lower bound on the improvement and not a device measurement.
3. **`componentAtIndex` behaviour under a real platform list.** Rows of a native
   `<list>` are never attached; the platform materializes them. Everything this
   stack proved about native lists was proved against the fake Element PAPI and
   Lynx-for-Web. Recycling, scroll, and reuse identity are unmeasured here.
4. **A device bundle budget.** The frozen budgets are red on `new-lynx` already
   (see the re-audit), so the byte gate needs a deliberate recalibration on a
   chosen tree before it can report a native regression.

## 8. Scope and honesty

Medians of n=5 per cell unless stated otherwise; fresh page per sample; AB/BA
alternation; quiet-host preflight enforced by the runner (1-minute load per CPU
below 0.5 at start on both arms). Absolute milliseconds are host-bound and are
not comparable to any other session or host, including `live-report.md`. Only
same-window ratios and same-window arm pairs are claimed. Every cell reported
here was driven end to end; nothing is estimated.

Raw samples for both arms are the `live-10000.json` payloads produced by
`node benchmarks/lynx-table/stages/run.mjs --rows 10000`; the tracked
`live-10000.json` in this directory is the stack's own recording and was
restored after both runs.
