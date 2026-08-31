# Ablating the MTS descriptor walk out of a steady-state create

#246 §7 names the test that gets to kill E1 before it is built:

> What would falsify E1 before it is built: an ablation that stubs the MTS
> descriptor walk out of a steady-state create and shows the create cell
> unmoved. That is cheaper than the ABI work and should run first. If the walk
> is not where the time is, E1 does not deserve the byte-identity promise it
> spends.

This file records how that ablation is produced, what makes it a fair stub, and
the one trap that will otherwise hand you a false positive.

## The stub has to be work-preserving at the host boundary

§7 is explicit that E1 **does not reduce host calls**. A compact
`mount-template-run` row is 20 PAPI calls that no amount of addressing removes.
What E1 removes is *interpretation*: the per-node walk over
`program.shape.types`, `program.props`, `program.bindings`,
`program.dynamicRoutes` and `program.patches` that stands between the descriptor
and the call.

So a stub that also removes host calls is not measuring E1's budget line, it is
inflating it. The arm must issue byte-for-byte the same host calls with the same
arguments in the same order, and only the interpretation may go. The harness
checks this for you: `papi-run.mjs` reports per-cell host-call counts and a
`counts agree across builds` column, and both must be identical between the
control cell and the ablation cell.

## The stub has to be at least as generous as E1

The falsifier is only decisive in one direction. If a stub that removes *less*
than E1 would shows nothing, E1 survives; the stub was too weak. If a stub that
removes *at least as much* as E1 could shows nothing, E1 is dead.

So the arm resolves the descriptor tables **once per node**, ahead of the row
loop, into flat per-node slots, and the row loop then issues host calls straight
from those slots. That is strictly more than E1 buys: E1 still has to address a
node before it can act on it, and this arm has already paid that off entirely.

Two arms bracket the answer:

| arm | tag | what it removes | what it keeps |
|---|---|---|---|
| conservative | `e1abl` | the descriptor walk, resolved once per node | `applyProps` for nodes the fast slots cannot describe |
| aggressive | `e1abl2` | the walk *and* the constant creation patches, so `applyProps` is never reached | nothing |

The aggressive arm carries a `fallbackProps` counter that increments wherever it
still has to call `applyProps`. The arm reports its own coverage rather than
asserting it; a run with `fallbackProps > 0` is not a full ablation and its
delta is a lower bound.

## Building the arms

`stages/e1-ablation-source.mjs` patches `packages/lynx/src/core/host-driver.ts`
on disk for exactly one `rspeedy build` and restores it afterwards, the same
build-time source-patching shape `stages/instrument-source.mjs` uses. Both arms
and the control carry the census helper, so the arms differ from the control
*only* by the stub.

```bash
cd benchmarks/lynx-table
node stages/e1-ablation-build.mjs --scales 1000,10000                          # control
node stages/e1-ablation-build.mjs --scales 1000,10000 --ablate --tag e1abl     # arm 1
node stages/e1-ablation-build.mjs --scales 1000,10000 --ablate --aggressive --tag e1abl2  # arm 2
```

The census is published on the main-thread realm as `__OCTANE_E1_PATHS` and is
read through `applyMainRealmProbe`. Read it before trusting a delta: it says
which applier actually served the run.

```
denseRuns 1  denseRows 1000  denseHosts 6000  slowRuns 0  ablatedRuns 1  fallbackProps 0
```

`papi-run.mjs` accepts one control tag per window, so each arm needs its own
window:

```bash
node stages/papi-run.mjs --reps 11 --skip-build --scales 1000,10000 \
  --cells octane,octane-mts-program,octane-mts-program-control \
  --control-dist e1abl2 --label c246-e1abl2
```

Note the cell naming: `--control-dist <tag>` routes `dist-mtsprogram<tag>` into
the cell *named* `octane-mts-program-control`. That cell holds the **ablation**.
The control is `octane-mts-program`. The `octane` cell is a bystander that
carries the census and no stub, and it is worth keeping in the window as a drift
witness.

## The trap: read the control build, not the instrumented builds

Each cell is measured in three builds — `control` (no probe), `counts` (host-call
counting) and `timed` (host-op timing). The `timed` build brackets each of
190,001 host calls with a `performance.now()` pair and costs about 21% on top of
the wall.

The ablation's apparent win **grows with probe weight**, which is the signature
of an artifact rather than of removed work:

| build | @10k mean delta | perm p |
|---|---:|---:|
| control (no probe) | −2.2 ms (−0.20%) | 0.932 |
| counts | −28.7 ms (−2.37%) | 0.084 |
| timed | −66.8 ms (−4.83%) | 0.002 |

Work the arm removes is a fixed quantity; it cannot know how heavily the probe
is instrumenting. A delta that scales with the probe is coupled to the probe.

The per-stage split settles it. Of the aggressive arm's −51.9 ms median in the
`timed` build at 10k, **−18.7 ms lands inside the `papi_*` host buckets and
−6.4 ms in `start_delay`** — buckets that time identical host calls with
identical arguments, which this arm provably cannot change. Only −17.3 ms lands
in `off_boundary`, the one bucket the walk lives in, against an `off_boundary`
spread of 91.2 ms. At 1,000 rows the same decomposition runs the other way
(+5.6 ms inside the host buckets, −2.8 ms in `off_boundary`, +9.1 ms total).

Movement that is not localized to the bucket the removed code occupies, and that
flips sign between scales, is drift. The un-probed `control` build is the
arbiter, and its host-call counts are certified identical against the `counts`
build.

## Result recorded by this procedure

Control cell `octane-mts-program`, ablation cell `octane-mts-program-control`,
`control` build, create window:

| arm | reps | scale | control | ablation | delta | perm p | 95% CI |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 `e1abl` | 5 | 1,000 | 138.9 | 137.6 | −0.90% | 0.762 | [−6.2%, +4.0%] |
| 1 `e1abl` | 5 | 10,000 | 1141.5 | 1130.1 | −1.59% | 0.516 | [−5.7%, +2.4%] |
| 2 `e1abl2` | 11 | 1,000 | 137.2 | 139.4 | +2.73% | 0.290 | [−1.6%, +7.6%] |
| 2 `e1abl2` | 11 | 10,000 | 1127.1 | 1127.3 | −0.20% | 0.932 | [−4.4%, +4.0%] |

Medians in ms; delta, p and CI are on the means. Host calls identical throughout:
19,001 at 1,000 rows and 190,001 at 10,000 rows, 19 per row, `counts agree`
`yes` for every cell in both windows.

The create cell does not move. What the windows can bound is the walk's share of
that cell: at 10,000 rows with 11 repetitions, under 4% at 95%, with a point
estimate of 0.2%.
