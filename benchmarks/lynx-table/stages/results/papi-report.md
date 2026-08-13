# Element PAPI boundary attribution of the FCP residual

Answers issue #50: split the dominant `layout_flush_residual` of Octane's
startup into a shared Web Core floor and Octane-specific work, with the same
decomposition applied to ReactLynx and a third cell, and give each candidate
owner a measured GO/NO-GO verdict.

Instrument-only. No product packet, renderer, or compiler change is proposed
here, and none is authorized by it.

## Baseline and protocol

- instrument: `stages/papi-run.mjs` over the host-side probe in
  `web/driver-client.mjs` (`papiInstrumentJs`), which wraps the single
  `Object.assign` with which `@lynx-js/web-core` 0.22.2 installs the Element
  PAPI onto the hidden main-thread script realm. The boundary is the host's, so
  the identical instrument measures every cell; no framework is patched.
- **the vendored reference bundles are untouched.** They are driven exactly as
  built (`Huxpro/vue-lynx @ 02376ecd`), no reference was rebuilt, and no bundle
  hash recorded by a featured run changed. A host-side probe needs no
  instrumented reference artifact at all.
- host: 4× Intel(R) Xeon(R) @ 2.10GHz; linux 6.18.5-fc-v20; Node v22.22.2;
  Chromium 141.0.7390.37. Quiet-host preflight passed; no other build, test, or
  benchmark ran in the window.
- n=5 per variant per cell per scale, fresh page per sample, `control` /
  `counts` / `timed` order rotated across repetitions in one window. Scales
  1k/10k/30k. Zero DNF and zero null cells.
- raw samples, per-kind counters, flush traces, spreads, host information, and
  sample order are checked in as `papi-1000.json`, `papi-10000.json`,
  `papi-30000.json`, `papi-scaling.json`, and `papi-predicate-cost.json`. Every
  table below re-renders from them with `node stages/papi-report.mjs`.

### Control overhead

The load-bearing wall-clock numbers come from the `counts` build, which reads
the clock once per window rather than once per host call:

| window | octane | react | vue-vdom |
|---|---:|---:|---:|
| create@1k / 10k / 30k | 0.967× / 1.029× / 0.993× | 1.026× / 1.033× / 0.973× | 0.987× / 1.029× / 0.986× |
| FCP@1k / 10k / 30k | 1.025× / 1.022× / 1.015× | not measured | not measured |

All within the declared 1.05× ceiling. The `timed` build costs 1.05–1.14× and
is used only for host self time and shares, never for a wall-clock claim. Its
counts match the `counts` build exactly for every cell and scale, which is the
control on that cost: a probe that changed what the framework called would show
up here as disagreement.

The startup window is 14–30 ms wide, so its ratios (0.77×–1.31×) are dominated
by ±3 ms of frame noise rather than probe cost; nothing in this report rests on
a startup wall-clock ratio.

## What the instrument sees

Host call counts are exact, carry no clock, and are perfectly linear —
1k → 30k drift is 0.0% for all three cells, and each create emits exactly one
`__FlushElementTree`:

| create@N | octane | react | vue-vdom |
|---|---:|---:|---:|
| host calls per row | **20** | 21 | 25 |
| `__FlushElementTree` | 1 | 1 | 1 |
| host ms per call (timed) | 0.0044 | 0.0039 | 0.0039 |

Octane already issues the fewest host calls per row of the three. The
`__AppendElement`-heavy Octane stream (7/row) trades against ReactLynx's
`__SetAttribute` (3/row) and Vue's `__SetAttribute` + `__SetCSSId` (7/row +
4/row).

Certified create wall-clock deltas against ReactLynx, on the control pages:
**+12.8 ms at 1k, −12.8 ms at 10k, +113.1 ms at 30k** (3.3%). Against Vue:
−11.7 / −200.3 / −895.7 ms. There is no create-side deficit on this host at
these scales for any candidate owner to be authorized against.

## The FCP residual is not a shared-floor problem

The vendored references carry no pre-populated first screen — that is a
build-time define of the app source, and rebuilding a reference would change
the hash the featured runs recorded — so `react`'s and `vue-vdom`'s FCP@N are
reported **not measured**, never substituted. What the vendored artifacts do
support is a projection, `startup + create`, on the control pages:

| cell | projected FCP@10k | direct FCP@10k |
|---|---:|---:|
| octane | 1,242.9 ms | 1,660.5 ms |
| react | 1,244.5 ms | not measured |
| vue-vdom | 1,440.4 ms | not measured |

Octane and ReactLynx are at parity on the composed path — 1,242.9 against
1,244.5 ms, a 0.1% difference. The shared floor is genuinely shared. Octane's
own direct first screen, however, costs **417.6 ms (33.6%) more than its own
composed path** for the same rendered tree, and that excess is the entire
deficit.

## Octane internal control: first-screen path vs create path

Both paths end in the same composed tree, driven by the same driver on the same
bundle family, so no cross-framework difference can enter this comparison. It
is the strongest evidence in this report.

| | 1k | 10k | 30k |
|---|---:|---:|---:|
| composed (startup + create), control | 178.1 ms | 1,242.9 ms | 3,545.7 ms |
| direct FCP@N, control | 211.5 ms | 1,660.5 ms | 5,142.3 ms |
| **excess** | **+33.4 ms (18.8%)** | **+417.6 ms (33.6%)** | **+1,596.6 ms (45.0%)** |
| host calls per row, first screen | 31.2 | 31.0 | 31.0 |
| host calls per row, create | 20 | 20 | 20 |
| `__FlushElementTree` | 2 vs 1 | 2 vs 1 | 2 vs 1 |

The op-mix difference is exactly +11 host calls per row, identical at every
scale: the first-screen path issues `__InsertElementBefore` (7/row) plus
`__GetElementUniqueID` (7/row) plus `__SetAttribute` (4/row) where the create
path issues `__AppendElement` (7/row).

Host time for that op excess, from the timed build:

| segment | 1k | 10k | 30k |
|---|---:|---:|---:|
| `papi_read` (`__GetElementUniqueID`) | +2.0 | +18.4 | +51.8 |
| `papi_props` (`__SetAttribute`) | +2.6 | +23.4 | +95.2 |
| `papi_topology` (insert-before vs append) | −13.9 | −102.6 | −266.1 |
| **net host cost of +11 calls/row** | **−9.3** | **−60.8** | **−119.1** |
| `papi_flush` | +13.1 | +146.1 | +497.5 |
| `start_delay` | −16.0 | −163.4 | −429.3 |
| `papi_create` | −2.6 | −93.6 | −4.1 |

## Verdicts

The gate is a positive, directly observed contribution of at least 10% of the
delta being attributed. Because ReactLynx's FCP@N is not measurable from a
vendored bundle, the FCP delta attributed here is the Octane first-screen
excess above — the same deficit in the form this evidence can observe, and the
substitution is stated rather than hidden.

- **Publication op count — NO-GO.** The count difference is real, large, and
  perfectly linear (+11 host calls per row, +55%), but its measured host cost is
  **negative** at every scale (−9.3 / −60.8 / −119.1 ms): `__InsertElementBefore`
  costs the host less than the `__AppendElement` it replaces, by more than the
  added reads and attributes cost. Against ReactLynx the count is already lower
  (20 vs 21 per row). No experiment that reduces first-screen op count is
  authorized by this evidence.
- **Flush cadence — GO.** The first-screen path calls `__FlushElementTree`
  twice against the create path's once, and that publication costs **+13.1 /
  +146.1 / +497.5 ms** — **27.0% / 28.7% / 27.3%** of the excess measured
  like-for-like on the timed build (48.6 / 508.8 / 1,824.1 ms), well clear of the
  gate and near-constant across a 30× scale range. This is the one owner the
  instrument both isolates and times directly: on the first screen the flush is
  where Web Core appends the whole page into the shadow root, while on the create
  path the page is already attached and the same call costs 0.0–0.1 ms.
- **First-paint scheduling — NO-GO.** The first-screen path reaches its first
  host call in 19.0–19.7 ms at every scale, against 34.9 / 183.1 / 448.3 ms on
  the create path; it is earlier, not later. Against ReactLynx the shell start
  delay is +11.3 to +12.4 ms and owns 69–78% of an 11.6–14.7 ms startup delta,
  so it is a GO at that window — but 19.7 ms is 1.0% of FCP@10k, immaterial as
  an FCP owner.
- **Per-element creation stream shape — NO-GO.** `papi_create` on the
  first-screen path is cheaper than on the create path at every scale
  (−2.6 / −93.6 / −4.1 ms). Against ReactLynx, Octane's host time per call is
  0.0044 vs 0.0039 ms, which clears 10% of the 30k create delta but sits inside
  a certified create delta that is negative at 10k and 3.3% at 30k, so there is
  no deficit for it to own.
- **Off-boundary work — GO, unseparated.** The remainder — framework first-screen
  script plus the browser's own frame after publication — carries **+90.9 /
  +730.4 / +1,852.7 ms**, more than the whole excess on its own, because the
  host-side terms above net out negative. The host exposes no boundary inside it,
  so it is named and left named. Octane's own framework-side instrument
  (`live-*.json`, `stages/run.mjs`) is what applies here: it attributes 7.3% of
  FCP@10k to `plan_interpretation`. Splitting the rest needs a framework-side
  probe on the first-screen path, not another host-side one.

### The driver's own walk is not in these numbers

`papi-predicate-cost.json` records what the two window predicates cost on a
settled tree: `contentCount()` (the FCP predicate, unchanged from
`stages/run.mjs`) takes **54.2 / 720.4 / 2,353.9 ms** at 1k/10k/30k, while
`rowCount()` (the create predicate) takes 0.50 / 5.10 / 29.0 ms. A walk that
large could plausibly own the whole excess, so it is worth stating exactly why
it does not: `x.fcp` samples its timestamp **before** the walk, so the resolving
walk is excluded from FCP by construction — had it been included, FCP@10k would
read about 2,380 ms rather than the observed 1,660.5 ms. `x.arm` samples
**after** its check, so the create window carries its own 5.1 ms walk. The
asymmetry therefore understates the first-screen excess slightly; it cannot
manufacture it.

## Decision

- The FCP gap is **not** a shared Web Core floor problem: Octane and ReactLynx
  are within 0.1% on the composed `startup + create` path at 10k.
- The FCP gap is **not** a publication-op-count problem, and not a wire problem
  (consistent with #47's NO-GO verdicts, reached here from the opposite side of
  the boundary).
- The FCP gap is Octane's **first-screen path costing 18.8% / 33.6% / 45.0%
  more than its own post-mount path** for an identical tree, with
  `__FlushElementTree` publication the single largest directly observed and
  directly timed owner, stable at 27–29% of it across a 30× scale range. The
  rest sits off the host boundary and needs a framework-side probe on the
  first-screen path to split further.
- Native-staging (`elementTemplates`) was expected to be gated by an op-count
  verdict. This evidence does not support that gate: op count is not the owner.
  Any such proposal needs a flush-publication argument instead.

The measurement implementation and these frozen results should land. No product
change is proposed from this issue.
