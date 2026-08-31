# Element PAPI boundary decomposition — Octane vs react-first-screen

- measured: 2026-08-30T11:22:42.896Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.77/0.64/1.02 (1/5/15m), end 2.05/1.12/1.12
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

| host call | octane | react-first-screen |
|---|---:|---:|
| `__AddEvent` | 2,000 | 2,000 |
| `__AppendElement` | 6,000 | 6,000 |
| `__CreateRawText` | 2,000 | 2,000 |
| `__CreateText` | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 |
| `__SetAttribute` | 1,000 | 3,000 |
| `__SetClasses` | 4,000 | 4,000 |
| **total host calls** | 19,001 | 21,001 |
| **host calls per row** | 19 | 21 |

| measure | octane | react-first-screen |
|---|---:|---:|
| wall ms, control | 120.7 | 119.6 |
| wall ms, counts build | 127.1 | 116.8 |
| wall ms, timed build | 124.8 | 119.1 |
| `__FlushElementTree` calls | 1 | 1 |
| start delay ms | 31 | 28.3 |
| host op time ms, timed | 74 | 76.7 |
| host ms per call, timed | 0.00389 | 0.00365 |
| flush time ms, timed | 0.1 | 0 |
| off-boundary ms, timed | 21.4 | 23.4 |
| counts-build overhead | 1.053× | 0.977× |
| timed-build overhead | 1.034× | 0.996× |
| counts agree across builds | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react-first-screen |
|---|---:|---:|
| slice start → paint ms, control | 30.3 | 14.4 |
| slice start → paint ms, counts | 31.3 | 14.4 |
| start delay ms | 19.6 | 7 |
| host calls | 169 | 114 |
| `__FlushElementTree` calls | 2 | 1 |
| host op time ms, timed | 2.6 | 2.8 |
| off-boundary ms, timed | 7.1 | 1 |
| counts-build overhead | 1.033× | 1× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 18.4 | 17.2–21.1 | 9.8% |
| papi_create | 48.8 | 44.9–54.3 | 26.0% |
| papi_props | 13.7 | 13.1–17.3 | 7.3% |
| papi_events | 6.9 | 5.5–8.2 | 3.7% |
| papi_topology | 6.8 | 5–7.6 | 3.6% |
| papi_read | 2.5 | 1.3–2.7 | 1.3% |
| papi_flush | 17.1 | 14.6–18.4 | 9.1% |
| off_boundary | 70.1 | 61.1–72.1 | 37.4% |

Host calls 29,169 (29.17 per row), 2 `__FlushElementTree`, start delay 17.3 ms. Wall 161.3 ms control / 162 ms counts / 187.5 ms timed; overhead 1.004× counts, 1.162× timed.

### `react-first-screen` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 7.4 | 6.8–8.5 | 6.0% |
| papi_create | 47.7 | 43.8–49.4 | 38.9% |
| papi_props | 15.9 | 14.4–19.2 | 13.0% |
| papi_events | 5.1 | 4.5–5.7 | 4.2% |
| papi_topology | 4.7 | 3.8–5.5 | 3.8% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_other | 0.3 | 0.2–0.3 | 0.2% |
| papi_flush | 13.1 | 12.9–14.2 | 10.7% |
| off_boundary | 26.5 | 22.5–29.4 | 21.6% |

Host calls 21,114 (21.11 per row), 1 `__FlushElementTree`, start delay 7.1 ms. Wall 104.1 ms control / 96.6 ms counts / 122.7 ms timed; overhead 0.928× counts, 1.179× timed.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 151 ms on the control pages; its direct pre-populated FCP@1000 is 161.3 ms — an excess of **10.3 ms (6.8%)** for the same rendered result. The counts build agrees: 158.4 ms composed against 162 ms direct.

The first-screen path issues 29.17 host calls per row against the create path's 19, and flushes 2 times against 1. The excess is 9,999 calls, 10 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 6,029 | 0 | +6,029 |
| `__SetAttribute` | 5,041 | 1,000 | +4,041 |
| `__AppendElement` | 6,028 | 6,000 | +28 |
| `__SetClasses` | 4,028 | 4,000 | +28 |
| `__CreateView` | 1,015 | 1,000 | +15 |
| `__CreateText` | 3,013 | 3,000 | +13 |
| `__AddEvent` | 2,012 | 2,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__CreateRawText` | 2,000 | 2,000 | 0 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 18.4 | 27.6 | -9.2 |
| papi_create | 48.8 | 45.1 | +3.7 |
| papi_props | 13.7 | 9.1 | +4.6 |
| papi_events | 6.9 | 5.7 | +1.2 |
| papi_topology | 6.8 | 14.1 | -7.3 |
| papi_read | 2.5 | 0 | +2.5 |
| papi_flush | 17.1 | 0.1 | +17 |
| off_boundary | 70.1 | 21.4 | +48.7 |

### Octane − `react-first-screen`, create@1000

Certified wall-clock delta: 1.1 ms on the control pages, 10.3 ms on the counts build. The attribution below runs on the timed build, whose delta is 5.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -7.3 | -128.1% | NO-GO | 19001 vs 21001 host calls at 0.0037 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.8% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2.1 | 36.8% | GO | 27.6 vs 25.5 ms to the first host call |
| Per-element creation stream shape | 4.6 | 80.8% | GO | 0.0039 vs 0.0037 ms of host time per call |
| Framework script and browser paint outside the host boundary | -2 | -35.1% | NO-GO | 21.4 vs 23.4 ms off the host boundary |
| **median non-additivity** | 8.2 | 143.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 16.9 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 6.9% | NO-GO | 169 vs 114 host calls at 0.0246 ms/op (reference rate) |
| Flush cadence | -0.1 | -0.5% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 13.4 | 68.4% | GO | 20.4 vs 7.0 ms to the first host call |
| Per-element creation stream shape | -1.6 | -7.9% | NO-GO | 0.0154 vs 0.0246 ms of host time per call |
| Framework script and browser paint outside the host boundary | 6.1 | 31.1% | GO | 7.1 vs 1.0 ms off the host boundary |
| **median non-additivity** | 0.4 | 2.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | react-first-screen |
|---|---:|---:|
| `__AddEvent` | 20,000 | 20,000 |
| `__AppendElement` | 60,000 | 60,000 |
| `__CreateRawText` | 20,000 | 20,000 |
| `__CreateText` | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 |
| `__SetAttribute` | 10,000 | 30,000 |
| `__SetClasses` | 40,000 | 40,000 |
| **total host calls** | 190,001 | 210,001 |
| **host calls per row** | 19 | 21 |

| measure | octane | react-first-screen |
|---|---:|---:|
| wall ms, control | 951.5 | 975.9 |
| wall ms, counts build | 1046.7 | 1022.2 |
| wall ms, timed build | 1096.7 | 1199.6 |
| `__FlushElementTree` calls | 1 | 1 |
| start delay ms | 150.6 | 195.3 |
| host op time ms, timed | 706.8 | 771.9 |
| host ms per call, timed | 0.00372 | 0.00368 |
| flush time ms, timed | 0 | 0.1 |
| off-boundary ms, timed | 253.3 | 222.4 |
| counts-build overhead | 1.1× | 1.047× |
| timed-build overhead | 1.153× | 1.229× |
| counts agree across builds | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | react-first-screen |
|---|---:|---:|
| slice start → paint ms, control | 26.9 | 12.4 |
| slice start → paint ms, counts | 29.8 | 17.3 |
| start delay ms | 18.8 | 7.5 |
| host calls | 169 | 114 |
| `__FlushElementTree` calls | 2 | 1 |
| host op time ms, timed | 3 | 3 |
| off-boundary ms, timed | 9 | 1.4 |
| counts-build overhead | 1.108× | 1.395× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 17.8 | 17.5–19.2 | 1.3% |
| papi_create | 445.6 | 414.6–508.5 | 32.7% |
| papi_props | 125.4 | 112.5–135.7 | 9.2% |
| papi_events | 37.5 | 36.4–40.5 | 2.8% |
| papi_topology | 54.6 | 53.4–58.3 | 4.0% |
| papi_read | 17.5 | 16.5–22 | 1.3% |
| papi_flush | 136.7 | 129.5–153.8 | 10.0% |
| off_boundary | 517.9 | 505–528.5 | 38.0% |

Host calls 290,169 (29.02 per row), 2 `__FlushElementTree`, start delay 20.3 ms. Wall 1152.2 ms control / 1256.8 ms counts / 1361.9 ms timed; overhead 1.091× counts, 1.182× timed.

### `react-first-screen` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 11.7 | 10.3–12 | 1.3% |
| papi_create | 367.2 | 337.5–420.1 | 39.4% |
| papi_props | 118.8 | 112.1–155.7 | 12.7% |
| papi_events | 29.3 | 22.7–31.8 | 3.1% |
| papi_topology | 36.9 | 33–44.6 | 4.0% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_other | 1.2 | 1–1.2 | 0.1% |
| papi_flush | 172.1 | 134.3–176.4 | 18.4% |
| off_boundary | 215.1 | 198.5–219.2 | 23.1% |

Host calls 210,114 (21.01 per row), 1 `__FlushElementTree`, start delay 11.6 ms. Wall 799.4 ms control / 856.6 ms counts / 933.1 ms timed; overhead 1.072× counts, 1.167× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 978.4 ms on the control pages; its direct pre-populated FCP@10000 is 1152.2 ms — an excess of **173.8 ms (17.8%)** for the same rendered result. The counts build agrees: 1076.5 ms composed against 1256.8 ms direct.

The first-screen path issues 29.02 host calls per row against the create path's 19, and flushes 2 times against 1. The excess is 99,999 calls, 10 per row.

| host call | first screen | create | delta |
|---|---:|---:|---:|
| `__GetElementUniqueID` | 60,029 | 0 | +60,029 |
| `__SetAttribute` | 50,041 | 10,000 | +40,041 |
| `__AppendElement` | 60,028 | 60,000 | +28 |
| `__SetClasses` | 40,028 | 40,000 | +28 |
| `__CreateView` | 10,015 | 10,000 | +15 |
| `__CreateText` | 30,013 | 30,000 | +13 |
| `__AddEvent` | 20,012 | 20,000 | +12 |
| `__CreatePage` | 1 | 0 | +1 |
| `__FlushElementTree` | 2 | 1 | +1 |
| `__CreateRawText` | 20,000 | 20,000 | 0 |

| segment | first screen ms | create ms | delta ms |
|---|---:|---:|---:|
| start_delay | 17.8 | 154 | -136.2 |
| papi_create | 445.6 | 441.1 | +4.5 |
| papi_props | 125.4 | 83.5 | +41.9 |
| papi_events | 37.5 | 33.6 | +3.9 |
| papi_topology | 54.6 | 148.6 | -94 |
| papi_read | 17.5 | 0 | +17.5 |
| papi_flush | 136.7 | 0 | +136.7 |
| off_boundary | 517.9 | 253.3 | +264.6 |

### Octane − `react-first-screen`, create@10000

Certified wall-clock delta: -24.4 ms on the control pages, 24.5 ms on the counts build. The attribution below runs on the timed build, whose delta is -102.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | -73.5 | n/a | NO-GO | 190001 vs 210001 host calls at 0.0037 ms/op (reference rate) |
| Flush cadence | -0.1 | n/a | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -40.4 | n/a | NO-GO | 154.0 vs 194.4 ms to the first host call |
| Per-element creation stream shape | 8.4 | n/a | NO-GO | 0.0037 vs 0.0037 ms of host time per call |
| Framework script and browser paint outside the host boundary | 30.9 | n/a | NO-GO | 253.3 vs 222.4 ms off the host boundary |
| **median non-additivity** | -28.2 | 27.4% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `react-first-screen`, startup

Certified wall-clock delta: 12.5 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.4 | 7.7% | NO-GO | 169 vs 114 host calls at 0.0263 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 1 __FlushElementTree calls |
| First-paint scheduling | 11.3 | 59.8% | GO | 18.3 vs 7.0 ms to the first host call |
| Per-element creation stream shape | -1.4 | -7.7% | NO-GO | 0.0178 vs 0.0263 ms of host time per call |
| Framework script and browser paint outside the host boundary | 7.6 | 40.2% | GO | 9.0 vs 1.4 ms off the host boundary |
| **median non-additivity** | 0 | 0.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 151 | 978.4 | 161.3 | 1152.2 |
| react-first-screen | 134 | 988.3 | 104.1 | 799.4 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 19 | 19 | 0.0% | yes |
| react-first-screen | 21 | 21 | 0.0% | yes |

