# Element PAPI boundary decomposition — Octane vs Octane (main-thread program) vs L0 direct-emission prototype

- measured: 2026-08-26T06:49:29.976Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.06/0.28/0.69 (1/5/15m), end 1.43/1.55/1.50
- repetitions: n=15 per variant per cell; variants: control, counts, timed
- protocol: fresh page per sample; control/counts/timed order rotates across repetitions in one host window; startup and create are measured in the same page load; the probe is host-side, so every variant runs the same framework bundle
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9; the vendored bundles are used as built, and the probe changes no bundle byte

## Observation contract

The probe wraps the single `Object.assign` with which `@lynx-js/web-core` installs the Element PAPI onto the hidden main-thread script realm, so it observes the host boundary rather than any framework. Every cell is measured by that identical instrument, and no bundle — including the vendored ReactLynx and Vue references — is modified or rebuilt.

Each timed window obeys one identity:

```
wall = start_delay + Σ host-group self time + off_boundary
```

`start_delay` is the observed gap from the window's start boundary to the first host call. Each host group is directly observed and exclusive: a host call re-entered through a framework callback is counted once. `off_boundary` is the named exclusive remainder — framework script, the browser's own style, layout, paint, and observer-frame delay, and the timed probe's own bookkeeping — because the host exposes no boundary separating those. `__FlushElementTree` self time covers the synchronous publication Web Core performs inside it; the browser's layout and paint that follow it stay in `off_boundary`.

Host call counts, flush cadence, and start delay are read from the counts build, whose wall clock carries no per-call clock reads. The timed build supplies host self time. Both builds count identically by construction, and the agreement is reported per cell as the control on the timed build's cost.

Two window predicates differ and the difference is not corrected away: the create window resolves on a shallow scan of the row container, while the FCP window resolves on the composed-tree content count `stages/run.mjs` already uses. The FCP predicate is the more expensive walk, so an FCP window carries up to one polling frame of that walk that a create window does not. Host call counts are exact and carry no such term.

## 30,000 rows

### Host call counts and flush cadence — create@30000

| host call | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| `__AddEvent` | 60,000 | 60,000 | 60,000 |
| `__AppendElement` | 210,000 | 210,000 | 210,000 |
| `__CreateRawText` | 90,000 | 90,000 | 90,000 |
| `__CreateText` | 90,000 | 90,000 | 90,000 |
| `__CreateView` | 30,000 | 30,000 | 30,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetClasses` | 120,000 | 120,000 | 120,000 |
| **total host calls** | 600,001 | 600,001 | 600,001 |
| **host calls per row** | 20 | 20 | 20 |

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| wall ms, control | 3752.1 | 3890.1 | 2813.7 |
| wall ms, counts build | 3867 | 3974.1 | 3012.5 |
| wall ms, timed build | 4303.3 | 4359.9 | 3445.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 480.1 | 491.5 | 22.6 |
| host op time ms, timed | 2983.7 | 2963.5 | 2870.6 |
| host ms per call, timed | 0.00497 | 0.00494 | 0.00478 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 900.3 | 868.4 | 500.4 |
| counts-build overhead | 1.031× | 1.022× | 1.071× |
| timed-build overhead | 1.147× | 1.121× | 1.225× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-direct |
|---|---:|---:|---:|
| slice start → paint ms, control | 32.5 | 30.7 | 13.6 |
| slice start → paint ms, counts | 31.8 | 29.1 | 17.1 |
| start delay ms | 21.8 | 22 | 3.6 |
| host calls | 195 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 |
| host op time ms, timed | 3.4 | 3.2 | 3.5 |
| off-boundary ms, timed | 5.2 | 3.2 | 1.3 |
| counts-build overhead | 0.978× | 0.948× | 1.257× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.5 | 19.7–30.8 | 0.4% |
| papi_create | 2088.6 | 1787.7–2409.2 | 36.8% |
| papi_props | 389.2 | 352.8–525.6 | 6.9% |
| papi_events | 125.3 | 104.3–140.7 | 2.2% |
| papi_topology | 219.7 | 208.9–244.3 | 3.9% |
| papi_read | 76.3 | 66.7–90.1 | 1.3% |
| papi_flush | 631.4 | 561.5–725 | 11.1% |
| off_boundary | 2107.8 | 1932.6–2456.3 | 37.1% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 21.6 ms. Wall 4809.6 ms control / 5005.3 ms counts / 5674.6 ms timed; overhead 1.041× counts, 1.18× timed.

### `octane-mts-program` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22 | 20.2–27.7 | 0.5% |
| papi_create | 1776.3 | 1584.8–2100.8 | 41.8% |
| papi_props | 208.8 | 169–247.4 | 4.9% |
| papi_events | 113.3 | 93.3–136.1 | 2.7% |
| papi_topology | 191.9 | 171.2–225.6 | 4.5% |
| papi_read | 0.1 | 0–0.2 | 0.0% |
| papi_flush | 861 | 662.4–1050.9 | 20.3% |
| off_boundary | 1049 | 1013.7–1227 | 24.7% |

Host calls 600,126 (20 per row), 2 `__FlushElementTree`, start delay 21.9 ms. Wall 3600.4 ms control / 3836.1 ms counts / 4245.9 ms timed; overhead 1.065× counts, 1.179× timed.

### `octane-direct` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 3.9 | 3.3–10.6 | 0.1% |
| papi_create | 1743.2 | 1590.5–1909.5 | 53.0% |
| papi_props | 211.9 | 179.4–274.3 | 6.4% |
| papi_events | 91.2 | 79.5–102.9 | 2.8% |
| papi_topology | 157.8 | 144.4–174.3 | 4.8% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 585 | 532–627 | 17.8% |
| off_boundary | 449.6 | 412.7–653.9 | 13.7% |

Host calls 600,127 (20 per row), 2 `__FlushElementTree`, start delay 3.5 ms. Wall 2733.1 ms control / 2925.2 ms counts / 3291.7 ms timed; overhead 1.07× counts, 1.204× timed.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3784.6 ms on the control pages; its direct pre-populated FCP@30000 is 4809.6 ms — an excess of **1025 ms (27.1%)** for the same rendered result. The counts build agrees: 3898.8 ms composed against 5005.3 ms direct.

The first-screen path issues 31.01 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 329,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 210,042 | 0 | +210,042 |
| `__SetAttribute` | 120,028 | 0 | +120,028 |
| `__AppendElement` | 210,041 | 210,000 | +41 |
| `__SetClasses` | 120,028 | 120,000 | +28 |
| `__CreateView` | 30,015 | 30,000 | +15 |
| `__CreateRawText` | 90,013 | 90,000 | +13 |
| `__CreateText` | 90,013 | 90,000 | +13 |
| `__AddEvent` | 60,012 | 60,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 22.5 | 492.8 | -470.3 |
| papi_create | 2088.6 | 2049.1 | +39.5 |
| papi_props | 389.2 | 236.5 | +152.7 |
| papi_events | 125.3 | 118.4 | +6.9 |
| papi_topology | 219.7 | 579.7 | -360 |
| papi_read | 76.3 | 0 | +76.3 |
| papi_flush | 631.4 | 0.1 | +631.3 |
| off_boundary | 2107.8 | 900.3 | +1207.5 |

### Octane − `octane-mts-program`, create@30000

Certified wall-clock delta: -138 ms on the control pages, -107.1 ms on the counts build. The attribution below runs on the timed build, whose delta is -56.6 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | n/a | NO-GO | 600001 vs 600001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -6 | n/a | NO-GO | 492.8 vs 498.8 ms to the first host call |
| Per-element creation stream shape | 20.2 | n/a | NO-GO | 0.0050 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 31.9 | n/a | NO-GO | 900.3 vs 868.4 ms off the host boundary |
| **median non-additivity** | -102.7 | 181.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: 2.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 92.2% | GO | 195 vs 126 host calls at 0.0254 ms/op (reference rate) |
| Flush cadence | 0.1 | 5.3% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0.5 | 26.3% | GO | 22.3 vs 21.8 ms to the first host call |
| Per-element creation stream shape | -1.6 | -81.7% | NO-GO | 0.0174 vs 0.0254 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2 | 105.2% | GO | 5.2 vs 3.2 ms off the host boundary |
| **median non-additivity** | -0.9 | 47.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@30000

Certified wall-clock delta: 938.4 ms on the control pages, 854.5 ms on the counts build. The attribution below runs on the timed build, whose delta is 857.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 600001 vs 600001 host calls at 0.0048 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 470.3 | 54.8% | GO | 492.8 vs 22.5 ms to the first host call |
| Per-element creation stream shape | 113.1 | 13.2% | GO | 0.0050 vs 0.0048 ms of host time per call |
| Framework script and browser paint outside the host boundary | 399.9 | 46.6% | GO | 900.3 vs 500.4 ms off the host boundary |
| **median non-additivity** | -125.4 | 14.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 14.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.9 | 7.8% | NO-GO | 195 vs 127 host calls at 0.0276 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.4% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 18.9 | 79.1% | GO | 22.3 vs 3.4 ms to the first host call |
| Per-element creation stream shape | -2 | -8.3% | NO-GO | 0.0174 vs 0.0276 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.9 | 16.3% | GO | 5.2 vs 1.3 ms off the host boundary |
| **median non-additivity** | 1.1 | 4.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 30,000 projected | 30,000 direct |
|---|---:|---:|
| octane | 3784.6 | 4809.6 |
| octane-mts-program | 3920.8 | 3600.4 |
| octane-direct | 2827.3 | 2733.1 |

