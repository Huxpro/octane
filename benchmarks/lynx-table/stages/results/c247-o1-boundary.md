# Element PAPI boundary decomposition — Octane vs ReactLynx vs react-first-screen

- measured: 2026-08-30T11:30:47.451Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.66/0.66/0.91 (1/5/15m), end 1.46/1.18/1.07
- repetitions: n=5 per variant per cell; variants: control, counts, timed
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

## 1,000 rows

### Host call counts and flush cadence — create@1000

| host call | octane | react | react-first-screen |
|---|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 6,000 | 6,000 |
| `__CreateRawText` | 3,000 | 2,000 | 2,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 3,000 | 3,000 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 21,001 | 21,001 |
| **host calls per row** | 20 | 21 | 21 |

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| wall ms, control | 123 | 115.7 | 122 |
| wall ms, counts build | 126.9 | 117.3 | 120.8 |
| wall ms, timed build | 146.1 | 138.1 | 132.1 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 30.6 | 28.1 | 31.3 |
| host op time ms, timed | 82 | 80.4 | 79 |
| host ms per call, timed | 0.0041 | 0.00383 | 0.00376 |
| flush time ms, timed | 0 | 0.1 | 0 |
| off-boundary ms, timed | 28.3 | 28.5 | 25.5 |
| counts-build overhead | 1.032× | 1.014× | 0.99× |
| timed-build overhead | 1.188× | 1.194× | 1.083× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 27.5 | 14.2 | 17.8 |
| slice start → paint ms, counts | 26.7 | 10.7 | 12.3 |
| start delay ms | 19.7 | 6 | 7.2 |
| host calls | 195 | 114 | 114 |
| `__FlushElementTree` calls | 2 | 1 | 1 |
| host op time ms, timed | 2.9 | 2.9 | 3.1 |
| off-boundary ms, timed | 3.3 | 5.5 | 3.1 |
| counts-build overhead | 0.971× | 0.754× | 0.691× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.4 | 20.6–23.2 | 10.9% |
| papi_create | 56.3 | 49.1–67 | 28.6% |
| papi_props | 11.4 | 10.6–12.3 | 5.8% |
| papi_events | 6.2 | 6–8.6 | 3.2% |
| papi_topology | 7.1 | 5.8–8.2 | 3.6% |
| papi_read | 2.5 | 2.3–3.2 | 1.3% |
| papi_flush | 16.9 | 15.3–19.8 | 8.6% |
| off_boundary | 74.6 | 63.1–78.4 | 37.9% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 20.9 ms. Wall 163.7 ms control / 162.5 ms counts / 196.7 ms timed; overhead 0.993× counts, 1.202× timed.

FCP@1000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

### `react-first-screen` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 7.5 | 6.3–13.8 | 6.7% |
| papi_create | 42.2 | 37.4–44.5 | 37.4% |
| papi_props | 19.5 | 12.2–20.6 | 17.3% |
| papi_events | 5.6 | 4.2–7.1 | 5.0% |
| papi_topology | 4.5 | 3.4–5.3 | 4.0% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_other | 0.2 | 0.2–0.3 | 0.2% |
| papi_flush | 12.6 | 12–14.1 | 11.2% |
| off_boundary | 28.3 | 23.4–34.8 | 25.1% |

Host calls 21,114 (21.11 per row), 1 `__FlushElementTree`, start delay 7.9 ms. Wall 103.9 ms control / 111.8 ms counts / 112.7 ms timed; overhead 1.076× counts, 1.085× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 150.5 ms on the control pages; its direct pre-populated FCP@1000 is 163.7 ms — an excess of **13.2 ms (8.8%)** for the same rendered result. The counts build agrees: 153.6 ms composed against 162.5 ms direct.

The first-screen path issues 31.2 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 10,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 7,042 | 0 | +7,042 |
| `__SetAttribute` | 4,028 | 0 | +4,028 |
| `__AppendElement` | 7,041 | 7,000 | +41 |
| `__SetClasses` | 4,028 | 4,000 | +28 |
| `__CreateView` | 1,015 | 1,000 | +15 |
| `__CreateRawText` | 3,013 | 3,000 | +13 |
| `__CreateText` | 3,013 | 3,000 | +13 |
| `__AddEvent` | 2,012 | 2,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 21.4 | 31.2 | -9.8 |
| papi_create | 56.3 | 51.9 | +4.4 |
| papi_props | 11.4 | 7.3 | +4.1 |
| papi_events | 6.2 | 5.7 | +0.5 |
| papi_topology | 7.1 | 17.1 | -10 |
| papi_read | 2.5 | 0 | +2.5 |
| papi_flush | 16.9 | 0 | +16.9 |
| off_boundary | 74.6 | 28.3 | +46.3 |

### Octane − `react`, create@1000

Certified wall-clock delta: 7.3 ms on the control pages, 9.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 8 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -3.8 | -47.9% | NO-GO | 20001 vs 21001 host calls at 0.0038 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.2% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2.8 | 35.0% | GO | 31.2 vs 28.4 ms to the first host call |
| Per-element creation stream shape | 5.4 | 67.9% | GO | 0.0041 vs 0.0038 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.2 | -2.5% | NO-GO | 28.3 vs 28.5 ms off the host boundary |
| **median non-additivity** | 3.9 | 48.8% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 16 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.1 | 20.4% | GO | 195 vs 114 host calls at 0.0254 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.4 | 122.8% | GO | 19.1 vs 6.7 ms to the first host call |
| Per-element creation stream shape | -2.1 | -20.4% | NO-GO | 0.0149 vs 0.0254 ms of host time per call |
| Framework script and browser paint outside the host boundary | -2.2 | -21.8% | NO-GO | 3.3 vs 5.5 ms off the host boundary |
| **median non-additivity** | -0.2 | 2.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, create@1000

Certified wall-clock delta: 1 ms on the control pages, 6.1 ms on the counts build. The attribution below runs on the timed build, whose delta is 14 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -3.8 | -26.9% | NO-GO | 20001 vs 21001 host calls at 0.0038 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 4.4 | 31.4% | GO | 31.2 vs 26.8 ms to the first host call |
| Per-element creation stream shape | 6.8 | 48.3% | GO | 0.0041 vs 0.0038 ms of host time per call |
| Framework script and browser paint outside the host boundary | 2.8 | 20.0% | GO | 28.3 vs 25.5 ms off the host boundary |
| **median non-additivity** | 3.8 | 27.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 14.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2.2 | 20.2% | GO | 195 vs 114 host calls at 0.0272 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.2 | 111.9% | GO | 19.1 vs 6.9 ms to the first host call |
| Per-element creation stream shape | -2.4 | -22.0% | NO-GO | 0.0149 vs 0.0272 ms of host time per call |
| Framework script and browser paint outside the host boundary | 0.2 | 1.8% | NO-GO | 3.3 vs 3.1 ms off the host boundary |
| **median non-additivity** | -1.3 | 11.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@1000

Certified wall-clock delta: 59.8 ms on the control pages, 50.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 84 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 34.4 | 40.9% | GO | 31195 vs 21114 host calls at 0.0034 ms/op (reference rate) |
| Flush cadence | 4.3 | 5.1% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 13.9 | 16.5% | GO | 21.4 vs 7.5 ms to the first host call |
| Per-element creation stream shape | -22.9 | -27.2% | NO-GO | 0.0027 vs 0.0034 ms of host time per call |
| Framework script and browser paint outside the host boundary | 46.3 | 55.1% | GO | 74.6 vs 28.3 ms off the host boundary |
| **median non-additivity** | 8 | 9.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | react | react-first-screen |
|---|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 60,000 | 60,000 |
| `__CreateRawText` | 30,000 | 20,000 | 20,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 |
| `__SetAttribute` | 0 | 30,000 | 30,000 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 210,001 | 210,001 |
| **host calls per row** | 20 | 21 | 21 |

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| wall ms, control | 951.3 | 1017 | 1013.8 |
| wall ms, counts build | 1038.8 | 1066.4 | 1115.4 |
| wall ms, timed build | 1109.6 | 1175 | 1157.9 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 149.7 | 201.6 | 207.7 |
| host op time ms, timed | 698.4 | 741.7 | 731.8 |
| host ms per call, timed | 0.00349 | 0.00353 | 0.00348 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 |
| off-boundary ms, timed | 249 | 203.6 | 207.9 |
| counts-build overhead | 1.092× | 1.049× | 1.1× |
| timed-build overhead | 1.166× | 1.155× | 1.142× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 27.9 | 19.1 | 12.2 |
| slice start → paint ms, counts | 26.8 | 13.5 | 14.7 |
| start delay ms | 20.3 | 6.4 | 6.4 |
| host calls | 195 | 114 | 114 |
| `__FlushElementTree` calls | 2 | 1 | 1 |
| host op time ms, timed | 2.4 | 2.4 | 2.6 |
| off-boundary ms, timed | 7.5 | 1.2 | 0.9 |
| counts-build overhead | 0.961× | 0.707× | 1.205× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.2 | 19.6–23.3 | 1.5% |
| papi_create | 491.6 | 483.2–528.3 | 34.0% |
| papi_props | 96.7 | 90–123.6 | 6.7% |
| papi_events | 38.3 | 33.9–76.1 | 2.7% |
| papi_topology | 63 | 55.8–69.6 | 4.4% |
| papi_read | 20.6 | 17.2–24.1 | 1.4% |
| papi_flush | 154.7 | 121.5–164.1 | 10.7% |
| off_boundary | 521.2 | 491.1–554.9 | 36.1% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 20.9 ms. Wall 1231.2 ms control / 1298.7 ms counts / 1444.8 ms timed; overhead 1.055× counts, 1.173× timed.

FCP@10000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

### `react-first-screen` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 11.8 | 10.2–12.5 | 1.2% |
| papi_create | 374.4 | 361.2–377.4 | 38.7% |
| papi_props | 129.9 | 118.8–137.3 | 13.4% |
| papi_events | 25.6 | 24–27 | 2.6% |
| papi_topology | 39.8 | 35.6–41.2 | 4.1% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_other | 1.1 | 1–1.1 | 0.1% |
| papi_flush | 167.1 | 134.3–182.8 | 17.3% |
| off_boundary | 222.7 | 210.4–249.8 | 23.0% |

Host calls 210,114 (21.01 per row), 1 `__FlushElementTree`, start delay 11.8 ms. Wall 872.7 ms control / 912 ms counts / 968.4 ms timed; overhead 1.045× counts, 1.11× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 979.2 ms on the control pages; its direct pre-populated FCP@10000 is 1231.2 ms — an excess of **252 ms (25.7%)** for the same rendered result. The counts build agrees: 1065.6 ms composed against 1298.7 ms direct.

The first-screen path issues 31.02 host calls per row against the create path's 20, and flushes 2 times against 1. The excess is 109,999 calls, 11 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 70,042 | 0 | +70,042 |
| `__SetAttribute` | 40,028 | 0 | +40,028 |
| `__AppendElement` | 70,041 | 70,000 | +41 |
| `__SetClasses` | 40,028 | 40,000 | +28 |
| `__CreateView` | 10,015 | 10,000 | +15 |
| `__CreateRawText` | 30,013 | 30,000 | +13 |
| `__CreateText` | 30,013 | 30,000 | +13 |
| `__AddEvent` | 20,012 | 20,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 21.2 | 156.2 | -135 |
| papi_create | 491.6 | 467.5 | +24.1 |
| papi_props | 96.7 | 56.2 | +40.5 |
| papi_events | 38.3 | 32.5 | +5.8 |
| papi_topology | 63 | 142.2 | -79.2 |
| papi_read | 20.6 | 0 | +20.6 |
| papi_flush | 154.7 | 0.1 | +154.6 |
| off_boundary | 521.2 | 249 | +272.2 |

### Octane − `react`, create@10000

Certified wall-clock delta: -65.7 ms on the control pages, -27.6 ms on the counts build. The attribution below runs on the timed build, whose delta is -65.4 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -35.3 | n/a | NO-GO | 200001 vs 210001 host calls at 0.0035 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -38.9 | n/a | NO-GO | 156.2 vs 195.1 ms to the first host call |
| Per-element creation stream shape | -8 | n/a | NO-GO | 0.0035 vs 0.0035 ms of host time per call |
| Framework script and browser paint outside the host boundary | 45.4 | n/a | NO-GO | 249.0 vs 203.6 ms off the host boundary |
| **median non-additivity** | -28.6 | 43.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 13.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.7 | 9.5% | NO-GO | 195 vs 114 host calls at 0.0211 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.5 | 69.4% | GO | 19.1 vs 6.6 ms to the first host call |
| Per-element creation stream shape | -1.7 | -9.5% | NO-GO | 0.0123 vs 0.0211 ms of host time per call |
| Framework script and browser paint outside the host boundary | 6.3 | 35.0% | GO | 7.5 vs 1.2 ms off the host boundary |
| **median non-additivity** | -0.8 | 4.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, create@10000

Certified wall-clock delta: -62.5 ms on the control pages, -76.6 ms on the counts build. The attribution below runs on the timed build, whose delta is -48.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -34.8 | n/a | NO-GO | 200001 vs 210001 host calls at 0.0035 ms/op (reference rate) |
| Flush cadence | 0 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -48.8 | n/a | NO-GO | 156.2 vs 205.0 ms to the first host call |
| Per-element creation stream shape | 1.4 | n/a | NO-GO | 0.0035 vs 0.0035 ms of host time per call |
| Framework script and browser paint outside the host boundary | 41.1 | n/a | NO-GO | 249.0 vs 207.9 ms off the host boundary |
| **median non-additivity** | -7.2 | 14.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 12.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 11.9% | GO | 195 vs 114 host calls at 0.0228 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.6 | 81.3% | GO | 19.1 vs 6.5 ms to the first host call |
| Per-element creation stream shape | -2 | -13.2% | NO-GO | 0.0123 vs 0.0228 ms of host time per call |
| Framework script and browser paint outside the host boundary | 6.6 | 42.6% | GO | 7.5 vs 0.9 ms off the host boundary |
| **median non-additivity** | -3.5 | 22.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, FCP@10000

Certified wall-clock delta: 358.5 ms on the control pages, 386.7 ms on the counts build. The attribution below runs on the timed build, whose delta is 476.4 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 271.9 | 57.1% | GO | 310195 vs 210114 host calls at 0.0027 ms/op (reference rate) |
| Flush cadence | -12.4 | -2.6% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 9.4 | 2.0% | NO-GO | 21.2 vs 11.8 ms to the first host call |
| Per-element creation stream shape | -132.5 | -27.8% | NO-GO | 0.0023 vs 0.0027 ms of host time per call |
| Framework script and browser paint outside the host boundary | 298.5 | 62.7% | GO | 521.2 vs 222.7 ms off the host boundary |
| **median non-additivity** | 41.5 | 8.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 150.5 | 979.2 | 163.7 | 1231.2 |
| react | 129.9 | 1036.1 | not measured | not measured |
| react-first-screen | 139.8 | 1026 | 103.9 | 872.7 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| react | 21 | 21 | 0.0% | yes |
| react-first-screen | 21 | 21 | 0.0% | yes |

