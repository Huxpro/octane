# Element PAPI boundary decomposition — Octane vs ReactLynx vs Vue vdom+IFR+ET

- measured: 2026-08-24T02:30:36.707Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.60/1.01/1.20 (1/5/15m), end 1.14/1.37/1.41
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

`off_boundary` is a remainder for every cell, and on a profile-built Octane cell it splits further. The framework publishes which first-screen phase is running — render, publish, capture, announce — and the probe attributes each host call to the phase that issued it, so a phase's own off-boundary time is its wall span minus the host time observed inside it. What no phase claims is the residue: web-core's own script between host calls, plus the browser's style, layout, paint, and observer frame. The dependency runs one way — the framework publishes a marker and never reads the probe — and `render` crosses the boundary not at all, so its whole span is framework script by construction rather than by subtraction. The marker is compiled out of a shipping bundle, so the split is measured on a separate profile-built cell and no ratio is ever taken across the two builds.

The residue is an upper bound on the platform's share rather than a measurement of it, though a tight one. Framework script before the first host call is `start_delay`, a separate term of the identity, so the bundle's own evaluation and most of the install are already excluded. What can still land in the residue is framework script inside the window but outside the four phases: whatever the entry does after the first screen returns, and any install work that follows the first host call. That is the flattering direction for Octane and the conservative one for a floor claim — a control built against this residue must beat a number that may still hold a little framework cost the split did not measure.

Host call counts, flush cadence, and start delay are read from the counts build, whose wall clock carries no per-call clock reads. The timed build supplies host self time. Both builds count identically by construction, and the agreement is reported per cell as the control on the timed build's cost.

Two window predicates differ and the difference is not corrected away: the create window resolves on a shallow scan of the row container, while the FCP window resolves on the composed-tree content count `stages/run.mjs` already uses. The FCP predicate is the more expensive walk, so an FCP window carries up to one polling frame of that walk that a create window does not. Host call counts are exact and carry no such term.

## 1,000 rows

### Host call counts and flush cadence — create@1000

| host call | octane | octane-profile |
|---|---:|---:|
| `__AddEvent` | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 7,000 |
| `__CreateRawText` | 3,000 | 3,000 |
| `__CreateText` | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 |
| `__SetClasses` | 4,000 | 4,000 |
| **total host calls** | 20,001 | 20,001 |
| **host calls per row** | 20 | 20 |

| measure | octane | octane-profile |
|---|---:|---:|
| wall ms, control | 136.7 | 139.8 |
| wall ms, counts build | 138.3 | 148 |
| wall ms, timed build | 158.1 | 162.2 |
| `__FlushElementTree` calls | 1 | 1 |
| start delay ms | 32.5 | 34.1 |
| host op time ms, timed | 91 | 89.4 |
| host ms per call, timed | 0.00455 | 0.00447 |
| flush time ms, timed | 0.1 | 0 |
| off-boundary ms, timed | 29.3 | 36.6 |
| counts-build overhead | 1.012× | 1.059× |
| timed-build overhead | 1.157× | 1.16× |
| counts agree across builds | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile |
|---|---:|---:|
| slice start → paint ms, control | 27.1 | 27.5 |
| slice start → paint ms, counts | 25.4 | 26.4 |
| start delay ms | 18.4 | 19 |
| host calls | 195 | 195 |
| `__FlushElementTree` calls | 2 | 2 |
| host op time ms, timed | 3.3 | 2.9 |
| off-boundary ms, timed | 7.8 | 7.3 |
| counts-build overhead | 0.937× | 0.96× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.4 | 17.6–19.7 | 8.7% |
| papi_create | 71.7 | 59.5–79.4 | 32.2% |
| papi_props | 13.5 | 12.1–16.4 | 6.1% |
| papi_events | 8.2 | 6.4–8.4 | 3.7% |
| papi_topology | 8.3 | 6.4–14.1 | 3.7% |
| papi_read | 3.4 | 3–5.7 | 1.5% |
| papi_flush | 12.9 | 11.1–17.6 | 5.8% |
| off_boundary | 85.3 | 78.3–114.1 | 38.3% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19.1 ms. Wall 183.7 ms control / 197.4 ms counts / 222.7 ms timed; overhead 1.075× counts, 1.212× timed.

### `octane-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.9 | 18.6–23.7 | 9.5% |
| papi_create | 64.8 | 58.1–66.9 | 30.9% |
| papi_props | 9.7 | 9.2–14.1 | 4.6% |
| papi_events | 6.2 | 5.1–8.4 | 3.0% |
| papi_topology | 6.8 | 5.5–7.1 | 3.2% |
| papi_read | 2.8 | 1.7–3 | 1.3% |
| papi_flush | 11.8 | 10.6–14.3 | 5.6% |
| off_boundary | 91.4 | 85.5–93.2 | 43.6% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19 ms. Wall 183.9 ms control / 196 ms counts / 209.6 ms timed; overhead 1.066× counts, 1.14× timed.

### Octane first-screen phase split @1000 — what off-boundary time is Octane's

Measured on the profile-built cell. Its first-screen wall on the uninstrumented control pages is 183.9 ms against the shipping cell's 183.7 ms in the same window — +0.2 ms, +0.1%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 13.4 |
| publish | 24,152 | 98.8 | 50.7 |
| capture | 7,041 | 2.8 | 11.1 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 78.4 |
| **residue — web-core script and the browser frame** | — | — | 12.4 |

Off-boundary in the profiled cell's own timed FCP window is 91.4 ms, against 85.3 ms in the shipping cell's. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 163.8 ms on the control pages; its direct pre-populated FCP@1000 is 183.7 ms — an excess of **19.9 ms (12.1%)** for the same rendered result. The counts build agrees: 163.7 ms composed against 197.4 ms direct.

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
| start_delay | 19.4 | 36.2 | -16.8 |
| papi_create | 71.7 | 59.7 | +12 |
| papi_props | 13.5 | 7.4 | +6.1 |
| papi_events | 8.2 | 5.9 | +2.3 |
| papi_topology | 8.3 | 18 | -9.7 |
| papi_read | 3.4 | 0 | +3.4 |
| papi_flush | 12.9 | 0.1 | +12.8 |
| off_boundary | 85.3 | 29.3 | +56 |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-profile |
|---|---:|---:|
| `__AddEvent` | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 70,000 |
| `__CreateRawText` | 30,000 | 30,000 |
| `__CreateText` | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 |
| `__SetClasses` | 40,000 | 40,000 |
| **total host calls** | 200,001 | 200,001 |
| **host calls per row** | 20 | 20 |

| measure | octane | octane-profile |
|---|---:|---:|
| wall ms, control | 1193.6 | 1194 |
| wall ms, counts build | 1203 | 1259.4 |
| wall ms, timed build | 1402.2 | 1438.1 |
| `__FlushElementTree` calls | 1 | 1 |
| start delay ms | 165.9 | 175.1 |
| host op time ms, timed | 945.3 | 933.4 |
| host ms per call, timed | 0.00473 | 0.00467 |
| flush time ms, timed | 0.1 | 0.1 |
| off-boundary ms, timed | 261.4 | 309.8 |
| counts-build overhead | 1.008× | 1.055× |
| timed-build overhead | 1.175× | 1.204× |
| counts agree across builds | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile |
|---|---:|---:|
| slice start → paint ms, control | 28.7 | 27.5 |
| slice start → paint ms, counts | 27.1 | 32 |
| start delay ms | 19.7 | 20.1 |
| host calls | 195 | 195 |
| `__FlushElementTree` calls | 2 | 2 |
| host op time ms, timed | 3.2 | 3.6 |
| off-boundary ms, timed | 5.5 | 6.8 |
| counts-build overhead | 0.944× | 1.164× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.8 | 17.8–22 | 1.1% |
| papi_create | 591.1 | 573.2–656.9 | 34.3% |
| papi_props | 117.3 | 111.6–123.1 | 6.8% |
| papi_events | 45.3 | 39.7–62.4 | 2.6% |
| papi_topology | 79.3 | 75.9–81.6 | 4.6% |
| papi_read | 29 | 28.1–33.6 | 1.7% |
| papi_flush | 126.8 | 107.9–145.6 | 7.3% |
| off_boundary | 689.6 | 673.5–727.1 | 40.0% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.6 ms. Wall 1403.9 ms control / 1464.5 ms counts / 1725.2 ms timed; overhead 1.043× counts, 1.229× timed.

### `octane-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20 | 19.3–20.4 | 1.2% |
| papi_create | 540.1 | 502.5–601.7 | 32.3% |
| papi_props | 95.2 | 90.5–100.1 | 5.7% |
| papi_events | 38.7 | 36.8–43.9 | 2.3% |
| papi_topology | 61.5 | 58.6–64 | 3.7% |
| papi_read | 22.1 | 20.8–41.2 | 1.3% |
| papi_flush | 123 | 116.3–133.5 | 7.4% |
| off_boundary | 762.7 | 699.9–774.3 | 45.6% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.8 ms. Wall 1440.3 ms control / 1520.6 ms counts / 1672.4 ms timed; overhead 1.056× counts, 1.161× timed.

### Octane first-screen phase split @10000 — what off-boundary time is Octane's

Measured on the profile-built cell. Its first-screen wall on the uninstrumented control pages is 1440.3 ms against the shipping cell's 1403.9 ms in the same window — +36.4 ms, +2.6%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 75.2 |
| publish | 240,152 | 862.7 | 446.1 |
| capture | 70,041 | 22 | 156.7 |
| announce | 0 | 0 | 0.1 |
| **Octane first-screen script** | — | — | 680.2 |
| **residue — web-core script and the browser frame** | — | — | 80.4 |

Off-boundary in the profiled cell's own timed FCP window is 762.7 ms, against 689.6 ms in the shipping cell's. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1222.3 ms on the control pages; its direct pre-populated FCP@10000 is 1403.9 ms — an excess of **181.6 ms (14.9%)** for the same rendered result. The counts build agrees: 1230.1 ms composed against 1464.5 ms direct.

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
| start_delay | 19.8 | 171.2 | -151.4 |
| papi_create | 591.1 | 635 | -43.9 |
| papi_props | 117.3 | 82.6 | +34.7 |
| papi_events | 45.3 | 40 | +5.3 |
| papi_topology | 79.3 | 187.7 | -108.4 |
| papi_read | 29 | 0 | +29 |
| papi_flush | 126.8 | 0.1 | +126.7 |
| off_boundary | 689.6 | 261.4 | +428.2 |

## 30,000 rows

### Host call counts and flush cadence — create@30000

| host call | octane | octane-profile |
|---|---:|---:|
| `__AddEvent` | 60,000 | 60,000 |
| `__AppendElement` | 210,000 | 210,000 |
| `__CreateRawText` | 90,000 | 90,000 |
| `__CreateText` | 90,000 | 90,000 |
| `__CreateView` | 30,000 | 30,000 |
| `__FlushElementTree` | 1 | 1 |
| `__SetClasses` | 120,000 | 120,000 |
| **total host calls** | 600,001 | 600,001 |
| **host calls per row** | 20 | 20 |

| measure | octane | octane-profile |
|---|---:|---:|
| wall ms, control | 3263 | 3493.2 |
| wall ms, counts build | 3393 | 3464.4 |
| wall ms, timed build | 3732.9 | 3800 |
| `__FlushElementTree` calls | 1 | 1 |
| start delay ms | 427.7 | 456.6 |
| host op time ms, timed | 2650.7 | 2538 |
| host ms per call, timed | 0.00442 | 0.00423 |
| flush time ms, timed | 0.1 | 0 |
| off-boundary ms, timed | 690.2 | 841.7 |
| counts-build overhead | 1.04× | 0.992× |
| timed-build overhead | 1.144× | 1.088× |
| counts agree across builds | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile |
|---|---:|---:|
| slice start → paint ms, control | 28.2 | 26.9 |
| slice start → paint ms, counts | 30.3 | 27.4 |
| start delay ms | 20.2 | 19.6 |
| host calls | 195 | 195 |
| `__FlushElementTree` calls | 2 | 2 |
| host op time ms, timed | 3.2 | 3.3 |
| off-boundary ms, timed | 3.8 | 3.5 |
| counts-build overhead | 1.074× | 1.019× |

### `octane` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.3 | 17.5–23.8 | 0.4% |
| papi_create | 1786.1 | 1620.7–1956 | 36.0% |
| papi_props | 337.2 | 330.9–499.5 | 6.8% |
| papi_events | 115.1 | 103.7–116.6 | 2.3% |
| papi_topology | 229.3 | 218.7–233.6 | 4.6% |
| papi_read | 90.2 | 89.8–95.8 | 1.8% |
| papi_flush | 475.9 | 445.3–495.1 | 9.6% |
| off_boundary | 1894.1 | 1882.9–2135.6 | 38.2% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 19.1 ms. Wall 4155.7 ms control / 4398.6 ms counts / 4957.2 ms timed; overhead 1.058× counts, 1.193× timed.

### `octane-profile` FCP@30000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.8 | 18.9–23.9 | 0.4% |
| papi_create | 1825.4 | 1707.1–1882.3 | 36.5% |
| papi_props | 306.2 | 291.9–314.7 | 6.1% |
| papi_events | 102.9 | 100.7–126.3 | 2.1% |
| papi_topology | 186.1 | 181.3–189.4 | 3.7% |
| papi_read | 62.3 | 59.1–64.3 | 1.2% |
| papi_flush | 467.7 | 438.2–493.9 | 9.3% |
| off_boundary | 2085.1 | 2010.6–2162.3 | 41.6% |

Host calls 930,195 (31.01 per row), 2 `__FlushElementTree`, start delay 18.8 ms. Wall 4498.9 ms control / 4494.7 ms counts / 5006.6 ms timed; overhead 0.999× counts, 1.113× timed.

### Octane first-screen phase split @30000 — what off-boundary time is Octane's

Measured on the profile-built cell. Its first-screen wall on the uninstrumented control pages is 4498.9 ms against the shipping cell's 4155.7 ms in the same window — +343.2 ms, +8.3%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 173 |
| publish | 720,152 | 2912.5 | 1271.8 |
| capture | 210,041 | 62.2 | 432.7 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 1861.1 |
| **residue — web-core script and the browser frame** | — | — | 236.4 |

Off-boundary in the profiled cell's own timed FCP window is 2085.1 ms, against 1894.1 ms in the shipping cell's. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @30000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 3291.2 ms on the control pages; its direct pre-populated FCP@30000 is 4155.7 ms — an excess of **864.5 ms (26.3%)** for the same rendered result. The counts build agrees: 3423.3 ms composed against 4398.6 ms direct.

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
| start_delay | 19.3 | 422.2 | -402.9 |
| papi_create | 1786.1 | 1759.7 | +26.4 |
| papi_props | 337.2 | 243.2 | +94 |
| papi_events | 115.1 | 105.7 | +9.4 |
| papi_topology | 229.3 | 542.1 | -312.8 |
| papi_read | 90.2 | 0 | +90.2 |
| papi_flush | 475.9 | 0.1 | +475.8 |
| off_boundary | 1894.1 | 690.2 | +1203.9 |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 30,000 projected | 1,000 direct | 10,000 direct | 30,000 direct |
|---|---:|---:|---:|---:|---:|---:|
| octane | 163.8 | 1222.3 | 3291.2 | 183.7 | 1403.9 | 4155.7 |
| octane-profile | 167.3 | 1221.5 | 3520.1 | 183.9 | 1440.3 | 4498.9 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | 30,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---:|---|
| octane | 20 | 20 | 20 | 0.0% | yes |
| octane-profile | 20 | 20 | 20 | 0.0% | yes |

