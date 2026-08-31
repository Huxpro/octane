# Element PAPI boundary decomposition — Octane vs ReactLynx vs react-first-screen

- measured: 2026-08-30T11:15:15.548Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.15/0.42/1.16 (1/5/15m), end 1.64/1.11/1.28
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
| wall ms, control | 128.3 | 121.8 | 123.5 |
| wall ms, counts build | 135 | 127.4 | 127.4 |
| wall ms, timed build | 147 | 138.7 | 132.3 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 29.4 | 28.2 | 28.2 |
| host op time ms, timed | 85.9 | 85.2 | 81.5 |
| host ms per call, timed | 0.00429 | 0.00406 | 0.00388 |
| flush time ms, timed | 0.1 | 0 | 0 |
| off-boundary ms, timed | 32 | 23.4 | 23.4 |
| counts-build overhead | 1.052× | 1.046× | 1.032× |
| timed-build overhead | 1.146× | 1.139× | 1.071× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 27 | 11.3 | 13.3 |
| slice start → paint ms, counts | 28.1 | 11.8 | 16.4 |
| start delay ms | 20.7 | 7.1 | 6.1 |
| host calls | 195 | 114 | 114 |
| `__FlushElementTree` calls | 2 | 1 | 1 |
| host op time ms, timed | 2.7 | 2.5 | 2.8 |
| off-boundary ms, timed | 6.7 | 3.5 | 7.1 |
| counts-build overhead | 1.041× | 1.044× | 1.233× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.6 | 17.8–20.9 | 10.7% |
| papi_create | 52.3 | 49.4–60.1 | 28.5% |
| papi_props | 10.8 | 9.9–14.6 | 5.9% |
| papi_events | 6.4 | 6.3–10.9 | 3.5% |
| papi_topology | 6.9 | 6.5–9.4 | 3.8% |
| papi_read | 2.4 | 2–2.5 | 1.3% |
| papi_flush | 16.3 | 10.6–20.1 | 8.9% |
| off_boundary | 70.6 | 64.7–75.9 | 38.5% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 20.4 ms. Wall 170 ms control / 181 ms counts / 183.6 ms timed; overhead 1.065× counts, 1.08× timed.

FCP@1000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

### `react-first-screen` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 7.9 | 7.3–13.3 | 6.3% |
| papi_create | 46 | 40.6–50.6 | 36.9% |
| papi_props | 15.4 | 14.9–18.2 | 12.4% |
| papi_events | 5.3 | 3.6–8.1 | 4.3% |
| papi_topology | 4.1 | 3.7–5.6 | 3.3% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_other | 0.2 | 0.1–0.3 | 0.2% |
| papi_flush | 12.2 | 11.4–14.4 | 9.8% |
| off_boundary | 26.7 | 23–30.5 | 21.4% |

Host calls 21,114 (21.11 per row), 1 `__FlushElementTree`, start delay 7.2 ms. Wall 107.1 ms control / 112.1 ms counts / 124.5 ms timed; overhead 1.047× counts, 1.162× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 155.3 ms on the control pages; its direct pre-populated FCP@1000 is 170 ms — an excess of **14.7 ms (9.5%)** for the same rendered result. The counts build agrees: 163.1 ms composed against 181 ms direct.

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
| start_delay | 19.6 | 29.7 | -10.1 |
| papi_create | 52.3 | 54.9 | -2.6 |
| papi_props | 10.8 | 7.7 | +3.1 |
| papi_events | 6.4 | 5.9 | +0.5 |
| papi_topology | 6.9 | 17.4 | -10.5 |
| papi_read | 2.4 | 0 | +2.4 |
| papi_flush | 16.3 | 0.1 | +16.2 |
| off_boundary | 70.6 | 32 | +38.6 |

### Octane − `react`, create@1000

Certified wall-clock delta: 6.5 ms on the control pages, 7.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 8.3 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -4.1 | -48.9% | NO-GO | 20001 vs 21001 host calls at 0.0041 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.2% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2.4 | 28.9% | GO | 29.7 vs 27.3 ms to the first host call |
| Per-element creation stream shape | 4.8 | 57.3% | GO | 0.0043 vs 0.0041 ms of host time per call |
| Framework script and browser paint outside the host boundary | 8.6 | 103.6% | GO | 32.0 vs 23.4 ms off the host boundary |
| **median non-additivity** | -3.5 | 42.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 16.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.8 | 10.0% | GO | 195 vs 114 host calls at 0.0219 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 13.4 | 75.7% | GO | 19.8 vs 6.4 ms to the first host call |
| Per-element creation stream shape | -1.6 | -8.9% | NO-GO | 0.0138 vs 0.0219 ms of host time per call |
| Framework script and browser paint outside the host boundary | 3.2 | 18.1% | GO | 6.7 vs 3.5 ms off the host boundary |
| **median non-additivity** | 0.9 | 5.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, create@1000

Certified wall-clock delta: 4.8 ms on the control pages, 7.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 14.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -3.9 | -26.4% | NO-GO | 20001 vs 21001 host calls at 0.0039 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.7% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2.2 | 15.0% | GO | 29.7 vs 27.5 ms to the first host call |
| Per-element creation stream shape | 8.3 | 56.3% | GO | 0.0043 vs 0.0039 ms of host time per call |
| Framework script and browser paint outside the host boundary | 8.6 | 58.5% | GO | 32.0 vs 23.4 ms off the host boundary |
| **median non-additivity** | -0.6 | 4.1% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 11.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2 | 14.8% | GO | 195 vs 114 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.7% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 12.4 | 92.5% | GO | 19.8 vs 7.4 ms to the first host call |
| Per-element creation stream shape | -2.1 | -15.6% | NO-GO | 0.0138 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.4 | -3.0% | NO-GO | 6.7 vs 7.1 ms off the host boundary |
| **median non-additivity** | 1.6 | 11.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

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
| wall ms, control | 1043 | 994.8 | 990.9 |
| wall ms, counts build | 1050.7 | 1012.3 | 1117.2 |
| wall ms, timed build | 1164.9 | 1180.7 | 1148.5 |
| `__FlushElementTree` calls | 1 | 1 | 1 |
| start delay ms | 161.6 | 197.1 | 204.7 |
| host op time ms, timed | 777.3 | 739.1 | 755.2 |
| host ms per call, timed | 0.00389 | 0.00352 | 0.0036 |
| flush time ms, timed | 0 | 0.1 | 0.1 |
| off-boundary ms, timed | 261.5 | 203 | 191.8 |
| counts-build overhead | 1.007× | 1.018× | 1.127× |
| timed-build overhead | 1.117× | 1.187× | 1.159× |
| counts agree across builds | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react | react-first-screen |
|---|---:|---:|---:|
| slice start → paint ms, control | 29.2 | 20 | 19.7 |
| slice start → paint ms, counts | 29 | 14.6 | 17.9 |
| start delay ms | 19.9 | 6.2 | 7.2 |
| host calls | 195 | 114 | 114 |
| `__FlushElementTree` calls | 2 | 1 | 1 |
| host op time ms, timed | 2.5 | 2.8 | 2.8 |
| off-boundary ms, timed | 3.4 | 7.5 | 3.9 |
| counts-build overhead | 0.993× | 0.73× | 0.909× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20 | 16.7–23.6 | 1.4% |
| papi_create | 479.2 | 465.3–532.2 | 34.5% |
| papi_props | 98 | 89.8–127.7 | 7.0% |
| papi_events | 37.2 | 33.8–55.5 | 2.7% |
| papi_topology | 61.7 | 59–68.1 | 4.4% |
| papi_read | 20.7 | 17.5–26.3 | 1.5% |
| papi_flush | 158.3 | 143.5–160.6 | 11.4% |
| off_boundary | 530 | 494.3–587.7 | 38.1% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.3 ms. Wall 1252.6 ms control / 1322.3 ms counts / 1390.1 ms timed; overhead 1.056× counts, 1.11× timed.

FCP@10000 for `react`: **not measured** — the vendored ReactLynx bundle is a fixed black-box artifact, and a pre-populated first screen is a build-time define of the app source; rebuilding the reference would change the bundle hash the featured runs recorded.

### `react-first-screen` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 12 | 10.7–14.3 | 1.2% |
| papi_create | 408.1 | 387–429.8 | 39.3% |
| papi_props | 141.1 | 138.6–151.2 | 13.6% |
| papi_events | 28 | 26.8–29.7 | 2.7% |
| papi_topology | 39.1 | 32.1–44 | 3.8% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_other | 1.1 | 1.1–1.2 | 0.1% |
| papi_flush | 175.6 | 149.6–207 | 16.9% |
| off_boundary | 238.6 | 207.9–275.3 | 23.0% |

Host calls 210,114 (21.01 per row), 1 `__FlushElementTree`, start delay 13.1 ms. Wall 862.6 ms control / 915.7 ms counts / 1038.3 ms timed; overhead 1.062× counts, 1.204× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1072.2 ms on the control pages; its direct pre-populated FCP@10000 is 1252.6 ms — an excess of **180.4 ms (16.8%)** for the same rendered result. The counts build agrees: 1079.7 ms composed against 1322.3 ms direct.

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
| start_delay | 20 | 158.2 | -138.2 |
| papi_create | 479.2 | 516.7 | -37.5 |
| papi_props | 98 | 68.2 | +29.8 |
| papi_events | 37.2 | 34.3 | +2.9 |
| papi_topology | 61.7 | 158.1 | -96.4 |
| papi_read | 20.7 | 0 | +20.7 |
| papi_flush | 158.3 | 0 | +158.3 |
| off_boundary | 530 | 261.5 | +268.5 |

### Octane − `react`, create@10000

Certified wall-clock delta: 48.2 ms on the control pages, 38.4 ms on the counts build. The attribution below runs on the timed build, whose delta is -15.8 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -35.2 | n/a | NO-GO | 200001 vs 210001 host calls at 0.0035 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -45.2 | n/a | NO-GO | 158.2 vs 203.4 ms to the first host call |
| Per-element creation stream shape | 73.4 | n/a | NO-GO | 0.0039 vs 0.0035 ms of host time per call |
| Framework script and browser paint outside the host boundary | 58.5 | n/a | NO-GO | 261.5 vs 203.0 ms off the host boundary |
| **median non-additivity** | -67.2 | 425.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react`, startup

Certified wall-clock delta: 14.4 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2 | 21.9% | GO | 195 vs 114 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | 0.2 | 2.2% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 14.5 | 159.3% | GO | 20.5 vs 6.0 ms to the first host call |
| Per-element creation stream shape | -2.3 | -25.2% | NO-GO | 0.0128 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | -4.1 | -45.1% | NO-GO | 3.4 vs 7.5 ms off the host boundary |
| **median non-additivity** | -1.2 | 13.2% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, create@10000

Certified wall-clock delta: 52.1 ms on the control pages, -66.5 ms on the counts build. The attribution below runs on the timed build, whose delta is 16.4 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -36 | -219.3% | NO-GO | 200001 vs 210001 host calls at 0.0036 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.6% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -39.9 | -243.3% | NO-GO | 158.2 vs 198.1 ms to the first host call |
| Per-element creation stream shape | 58.1 | 354.0% | GO | 0.0039 vs 0.0036 ms of host time per call |
| Framework script and browser paint outside the host boundary | 69.7 | 425.0% | GO | 261.5 vs 191.8 ms off the host boundary |
| **median non-additivity** | -35.4 | 215.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 11.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 2 | 14.6% | GO | 195 vs 114 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | 0.2 | 1.5% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 13.2 | 97.1% | GO | 20.5 vs 7.3 ms to the first host call |
| Per-element creation stream shape | -2.3 | -16.8% | NO-GO | 0.0128 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.5 | -3.7% | NO-GO | 3.4 vs 3.9 ms off the host boundary |
| **median non-additivity** | 1 | 7.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 155.3 | 1072.2 | 170 | 1252.6 |
| react | 133.1 | 1014.8 | not measured | not measured |
| react-first-screen | 136.8 | 1010.6 | 107.1 | 862.6 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| react | 21 | 21 | 0.0% | yes |
| react-first-screen | 21 | 21 | 0.0% | yes |

