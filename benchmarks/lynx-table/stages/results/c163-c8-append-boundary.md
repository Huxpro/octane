# Element PAPI boundary decomposition — Octane vs Octane (main-thread program) vs octane-mts-program-control vs L0 direct-emission prototype

- measured: 2026-08-26T10:58:11.515Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.91/0.72/0.37 (1/5/15m), end 1.04/1.34/1.32
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

| host call | octane | octane-mts-program | octane-mts-program-control | octane-direct |
|---|---:|---:|---:|---:|
| `__AddEvent` | 60,000 | 60,000 | 60,000 | 60,000 |
| `__AppendElement` | 210,000 | 210,000 | 210,000 | 210,000 |
| `__CreateRawText` | 90,000 | 90,000 | 90,000 | 90,000 |
| `__CreateText` | 90,000 | 90,000 | 90,000 | 90,000 |
| `__CreateView` | 30,000 | 30,000 | 30,000 | 30,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 |
| `__SetClasses` | 120,000 | 120,000 | 120,000 | 120,000 |
| **total host calls** | 600,001 | 600,001 | 600,001 | 600,001 |
| **host calls per row** | 20 | 20 | 20 | 20 |

| measure | octane | octane-mts-program | octane-mts-program-control | octane-direct |
|---|---:|---:|---:|---:|
| wall ms, control | 3620.3 | 3641.1 | 3572.3 | 2707.1 |
| wall ms, counts build | 3796.7 | 3867.1 | 3835.1 | 2926.7 |
| wall ms, timed build | 4238.3 | 4191 | 4161.4 | 3352.4 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 |
| start delay ms | 483.1 | 496.2 | 491.7 | 21.6 |
| host op time ms, timed | 2949.1 | 2959.8 | 2935.3 | 2771.3 |
| host ms per call, timed | 0.00492 | 0.00493 | 0.00489 | 0.00462 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 785.2 | 772.5 | 808.7 | 487.7 |
| counts-build overhead | 1.049× | 1.062× | 1.074× | 1.081× |
| timed-build overhead | 1.171× | 1.151× | 1.165× | 1.238× |
| counts agree across builds | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-mts-program | octane-mts-program-control | octane-direct |
|---|---:|---:|---:|---:|
| slice start → paint ms, control | 29.3 | 29 | 30.2 | 8.1 |
| slice start → paint ms, counts | 30.3 | 33.5 | 30 | 10.3 |
| start delay ms | 21.3 | 21.8 | 21.4 | 2.6 |
| host calls | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 |
| host op time ms, timed | 3.4 | 3.2 | 3.1 | 3 |
| off-boundary ms, timed | 3.7 | 3.7 | 4.1 | 3 |
| counts-build overhead | 1.034× | 1.155× | 0.993× | 1.272× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.2 | 19.7–26.9 | 0.4% |
| papi_create | 1897.9 | 1725.6–2148.1 | 33.6% |
| papi_props | 371.1 | 359.1–414.5 | 6.6% |
| papi_events | 125 | 118.5–200 | 2.2% |
| papi_topology | 235.9 | 220.1–257.2 | 4.2% |
| papi_read | 100.8 | 94.7–115.9 | 1.8% |
| papi_flush | 531 | 483.9–652.3 | 9.4% |
| off_boundary | 2290.7 | 2081.6–2461.6 | 40.6% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 20.6 ms. Wall 4823.2 ms control / 5002.1 ms counts / 5644.1 ms timed; overhead 1.037× counts, 1.17× timed.

### `octane-mts-program` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.7 | 20.2–44.9 | 0.5% |
| papi_create | 1804.9 | 1650.8–1992.8 | 44.8% |
| papi_props | 212.1 | 190.5–272.9 | 5.3% |
| papi_events | 112.9 | 101.7–121.6 | 2.8% |
| papi_topology | 215.9 | 204.5–232 | 5.4% |
| papi_read | 0.1 | 0–0.2 | 0.0% |
| papi_flush | 690.8 | 587.3–833.7 | 17.1% |
| off_boundary | 943.1 | 890.8–1033.4 | 23.4% |

Host calls 600,126 (20 per row), 2 `__FlushElementTree`, start delay 22.5 ms. Wall 3377.9 ms control / 3518.4 ms counts / 4032.7 ms timed; overhead 1.042× counts, 1.194× timed.

### `octane-mts-program-control` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 22.5 | 20.9–39 | 0.6% |
| papi_create | 1789.2 | 1633–2027.4 | 44.9% |
| papi_props | 217 | 184–251.8 | 5.4% |
| papi_events | 111.4 | 105.5–139.7 | 2.8% |
| papi_topology | 217.8 | 203.4–240.3 | 5.5% |
| papi_read | 0.1 | 0–0.2 | 0.0% |
| papi_flush | 677.4 | 547.7–768.8 | 17.0% |
| off_boundary | 938.2 | 895.2–1060.6 | 23.5% |

Host calls 600,126 (20 per row), 2 `__FlushElementTree`, start delay 21 ms. Wall 3404.5 ms control / 3522.6 ms counts / 3987.1 ms timed; overhead 1.035× counts, 1.171× timed.

### `octane-direct` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 2.8 | 2.3–6.8 | 0.1% |
| papi_create | 1672.8 | 1613.8–1791 | 54.5% |
| papi_props | 200.7 | 185.5–235.9 | 6.5% |
| papi_events | 89.7 | 84.1–94.4 | 2.9% |
| papi_topology | 176.1 | 164.6–192.1 | 5.7% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 480.8 | 457.4–525.3 | 15.7% |
| off_boundary | 458.4 | 409.8–674.7 | 14.9% |

Host calls 600,127 (20 per row), 2 `__FlushElementTree`, start delay 2.8 ms. Wall 2616 ms control / 2759.4 ms counts / 3067.8 ms timed; overhead 1.055× counts, 1.173× timed.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3649.6 ms on the control pages; its direct pre-populated FCP@30000 is 4823.2 ms — an excess of **1173.6 ms (32.2%)** for the same rendered result. The counts build agrees: 3827 ms composed against 5002.1 ms direct.

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
| start_delay | 22.2 | 476 | -453.8 |
| papi_create | 1897.9 | 1978.2 | -80.3 |
| papi_props | 371.1 | 255.3 | +115.8 |
| papi_events | 125 | 124.8 | +0.2 |
| papi_topology | 235.9 | 590.8 | -354.9 |
| papi_read | 100.8 | 0 | +100.8 |
| papi_flush | 531 | 0.1 | +530.9 |
| off_boundary | 2290.7 | 785.2 | +1505.5 |

### Octane − `octane-mts-program`, create@30000

Certified wall-clock delta: -20.8 ms on the control pages, -70.4 ms on the counts build. The attribution below runs on the timed build, whose delta is 47.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 600001 vs 600001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | -0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -3.9 | -8.2% | NO-GO | 476.0 vs 479.9 ms to the first host call |
| Per-element creation stream shape | -10.7 | -22.6% | NO-GO | 0.0049 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 12.7 | 26.8% | GO | 785.2 vs 772.5 ms off the host boundary |
| **median non-additivity** | 49.2 | 104.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: -3.2 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 874.3% | GO | 195 vs 126 host calls at 0.0254 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 0 | 0.1% | NO-GO | 22.2 vs 22.2 ms to the first host call |
| Per-element creation stream shape | -1.6 | -774.5% | NO-GO | 0.0174 vs 0.0254 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0 | -0.1% | NO-GO | 3.7 vs 3.7 ms off the host boundary |
| **median non-additivity** | 0 | 0.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, create@30000

Certified wall-clock delta: 48 ms on the control pages, -38.4 ms on the counts build. The attribution below runs on the timed build, whose delta is 76.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 600001 vs 600001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -10.8 | -14.0% | NO-GO | 476.0 vs 486.8 ms to the first host call |
| Per-element creation stream shape | 13.8 | 17.9% | GO | 0.0049 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | -23.5 | -30.6% | NO-GO | 785.2 vs 808.7 ms off the host boundary |
| **median non-additivity** | 97.4 | 126.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program-control`, startup

Certified wall-clock delta: 0.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.7 | 130.6% | GO | 195 vs 126 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 1.4 | 107.7% | GO | 22.2 vs 20.8 ms to the first host call |
| Per-element creation stream shape | -1.4 | -107.5% | NO-GO | 0.0174 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.4 | -30.8% | NO-GO | 3.7 vs 4.1 ms off the host boundary |
| **median non-additivity** | 0 | 0.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@30000

Certified wall-clock delta: 913.2 ms on the control pages, 870 ms on the counts build. The attribution below runs on the timed build, whose delta is 885.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 600001 vs 600001 host calls at 0.0046 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 455 | 51.4% | GO | 476.0 vs 21.0 ms to the first host call |
| Per-element creation stream shape | 177.8 | 20.1% | GO | 0.0049 vs 0.0046 ms of host time per call |
| Framework script and browser paint outside the host boundary | 297.5 | 33.6% | GO | 785.2 vs 487.7 ms off the host boundary |
| **median non-additivity** | -44.4 | 5.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 20 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.6 | 7.8% | NO-GO | 195 vs 127 host calls at 0.0236 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.5% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 19.6 | 95.1% | GO | 22.2 vs 2.6 ms to the first host call |
| Per-element creation stream shape | -1.2 | -5.9% | NO-GO | 0.0174 vs 0.0236 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.7 | 3.4% | NO-GO | 3.7 vs 3.0 ms off the host boundary |
| **median non-additivity** | -0.2 | 1.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 30,000 projected | 30,000 direct |
|---|---:|---:|
| octane | 3649.6 | 4823.2 |
| octane-mts-program | 3670.1 | 3377.9 |
| octane-mts-program-control | 3602.5 | 3404.5 |
| octane-direct | 2715.2 | 2616 |

