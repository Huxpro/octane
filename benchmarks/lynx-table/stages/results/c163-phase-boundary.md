# Element PAPI boundary decomposition — Octane vs Octane (profile build) vs Octane (main-thread program) vs Octane (main-thread program, profile build) vs L0 direct-emission prototype

- measured: 2026-08-25T21:48:01.194Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 1.83/1.86/1.72 (1/5/15m), end 1.50/1.66/1.70
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

| host call | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| `__AddEvent` | 2,000 | 2,000 | 2,000 | 2,000 | 2,000 |
| `__AppendElement` | 7,000 | 7,000 | 7,000 | 7,000 | 7,000 |
| `__CreateRawText` | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 |
| `__CreateText` | 3,000 | 3,000 | 3,000 | 3,000 | 3,000 |
| `__CreateView` | 1,000 | 1,000 | 1,000 | 1,000 | 1,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 | 1 |
| `__SetClasses` | 4,000 | 4,000 | 4,000 | 4,000 | 4,000 |
| **total host calls** | 20,001 | 20,001 | 20,001 | 20,001 | 20,001 |
| **host calls per row** | 20 | 20 | 20 | 20 | 20 |

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| wall ms, control | 133.8 | 143.1 | 136.1 | 141.7 | 98.5 |
| wall ms, counts build | 142 | 145.8 | 144.6 | 147.3 | 109.1 |
| wall ms, timed build | 159.2 | 162.5 | 159.2 | 162.5 | 115.3 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 | 1 |
| start delay ms | 32.9 | 32.3 | 31.9 | 32.5 | 3.3 |
| host op time ms, timed | 93.2 | 92.6 | 97.2 | 91.9 | 98.7 |
| host ms per call, timed | 0.00466 | 0.00463 | 0.00486 | 0.00459 | 0.00493 |
| flush time ms, timed | 0 | 0.1 | 0 | 0 | 0 |
| off-boundary ms, timed | 30.2 | 34.6 | 30.5 | 41.4 | 18 |
| counts-build overhead | 1.061× | 1.019× | 1.062× | 1.04× | 1.108× |
| timed-build overhead | 1.19× | 1.136× | 1.17× | 1.147× | 1.171× |
| counts agree across builds | yes | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| slice start → paint ms, control | 28.3 | 27.6 | 27.7 | 33.8 | 10.1 |
| slice start → paint ms, counts | 27.4 | 30.2 | 31.7 | 31.7 | 8.7 |
| start delay ms | 19.6 | 20.5 | 20.6 | 20.9 | 2.5 |
| host calls | 195 | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 | 2 |
| host op time ms, timed | 3.2 | 2.9 | 2.7 | 2.5 | 2.8 |
| off-boundary ms, timed | 7.3 | 3.7 | 1.9 | 5 | 1.6 |
| counts-build overhead | 0.968× | 1.094× | 1.144× | 0.938× | 0.861× |

### `octane` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.3 | 19.2–22.5 | 9.7% |
| papi_create | 66.5 | 60.2–68.6 | 31.7% |
| papi_props | 13.1 | 12.4–16.2 | 6.2% |
| papi_events | 7.3 | 6.1–8.2 | 3.5% |
| papi_topology | 6.9 | 6.6–8.5 | 3.3% |
| papi_read | 3.1 | 3–4.3 | 1.5% |
| papi_flush | 17.2 | 16.4–18.3 | 8.2% |
| off_boundary | 73.5 | 68.5–75.4 | 35.0% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 20.6 ms. Wall 177.2 ms control / 186.4 ms counts / 209.9 ms timed; overhead 1.052× counts, 1.185× timed.

### `octane-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.1 | 19.7–22 | 9.5% |
| papi_create | 66.3 | 59.8–67.4 | 31.3% |
| papi_props | 11.7 | 9.1–14.3 | 5.5% |
| papi_events | 6.1 | 5.7–7.7 | 2.9% |
| papi_topology | 6.7 | 5.5–6.9 | 3.2% |
| papi_read | 2.2 | 1.9–2.7 | 1.0% |
| papi_flush | 17.1 | 16.3–19.1 | 8.1% |
| off_boundary | 78.8 | 75.9–82.2 | 37.2% |

Host calls 31,195 (31.2 per row), 2 `__FlushElementTree`, start delay 19.4 ms. Wall 183.5 ms control / 189 ms counts / 211.9 ms timed; overhead 1.03× counts, 1.155× timed.

### `octane-mts-program` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.7 | 19.5–27.1 | 11.6% |
| papi_create | 60.3 | 57.9–69.7 | 35.6% |
| papi_props | 8.8 | 8–9.4 | 5.2% |
| papi_events | 7.3 | 6.2–8.3 | 4.3% |
| papi_topology | 7.3 | 6.1–7.9 | 4.3% |
| papi_read | 0.9 | 0.6–1.2 | 0.5% |
| papi_flush | 13.4 | 12.9–15.9 | 7.9% |
| off_boundary | 51.5 | 46.1–58.3 | 30.4% |

Host calls 22,126 (22.13 per row), 2 `__FlushElementTree`, start delay 20.1 ms. Wall 149 ms control / 153.6 ms counts / 169.6 ms timed; overhead 1.031× counts, 1.138× timed.

### `octane-mts-program-profile` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20 | 19.6–22.2 | 11.8% |
| papi_create | 56.7 | 55.4–60.3 | 33.6% |
| papi_props | 7.2 | 6.5–9 | 4.3% |
| papi_events | 6.4 | 5.4–7 | 3.8% |
| papi_topology | 6.3 | 5.5–6.5 | 3.7% |
| papi_read | 0.9 | 0.4–1.3 | 0.5% |
| papi_flush | 13.3 | 12.8–13.8 | 7.9% |
| off_boundary | 58 | 52.6–63.8 | 34.3% |

Host calls 22,126 (22.13 per row), 2 `__FlushElementTree`, start delay 20.7 ms. Wall 152.7 ms control / 160.4 ms counts / 169 ms timed; overhead 1.05× counts, 1.107× timed.

### `octane-direct` FCP@1000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 2.4 | 2.2–2.6 | 2.1% |
| papi_create | 57.7 | 55.1–62.6 | 50.3% |
| papi_props | 6.8 | 6–10.5 | 5.9% |
| papi_events | 7.3 | 6.5–8.1 | 6.4% |
| papi_topology | 6.2 | 5.1–7.2 | 5.4% |
| papi_read | 0 | 0–0 | 0.0% |
| papi_flush | 15.4 | 15.1–15.6 | 13.4% |
| off_boundary | 16.8 | 15.4–17.3 | 14.6% |

Host calls 20,127 (20.13 per row), 2 `__FlushElementTree`, start delay 2.6 ms. Wall 98.6 ms control / 107.9 ms counts / 114.7 ms timed; overhead 1.094× counts, 1.163× timed.

### `octane` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 183.5 ms against that shipping cell's 177.2 ms in the same window — +6.3 ms, +3.6%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 14.4 |
| publish | 24,152 | 109.5 | 44.8 |
| capture | 7,041 | 2.2 | 6.3 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 66.5 |
| **residue — web-core script and the browser frame** | — | — | 11.9 |

Off-boundary in the profiled cell's own timed FCP window is 78.8 ms, against 73.5 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### `octane-mts-program` first-screen phase split @1000 — what off-boundary time is Octane's

Measured on `octane-mts-program-profile`, the profile build of `octane-mts-program`. Its first-screen wall on the uninstrumented control pages is 152.7 ms against that shipping cell's 149 ms in the same window — +3.7 ms, +2.5%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 9.9 |
| publish | 20,124 | 89.5 | 30.7 |
| capture | 2,000 | 0.8 | 3 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 44 |
| **residue — web-core script and the browser frame** | — | — | 14.3 |

Off-boundary in the profiled cell's own timed FCP window is 58 ms, against 51.5 ms in `octane-mts-program`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @1000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 162.1 ms on the control pages; its direct pre-populated FCP@1000 is 177.2 ms — an excess of **15.1 ms (9.3%)** for the same rendered result. The counts build agrees: 169.4 ms composed against 186.4 ms direct.

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
| start_delay | 20.3 | 32.1 | -11.8 |
| papi_create | 66.5 | 60.5 | +6 |
| papi_props | 13.1 | 8.9 | +4.2 |
| papi_events | 7.3 | 5.8 | +1.5 |
| papi_topology | 6.9 | 18 | -11.1 |
| papi_read | 3.1 | 0 | +3.1 |
| papi_flush | 17.2 | 0 | +17.2 |
| off_boundary | 73.5 | 30.2 | +43.3 |

### Octane − `octane-mts-program`, create@1000

Certified wall-clock delta: -2.3 ms on the control pages, -2.6 ms on the counts build. The attribution below runs on the timed build, whose delta is 0 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 20001 vs 20001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | -0.3 | -4030464000.0% | NO-GO | 32.1 vs 32.4 ms to the first host call |
| Per-element creation stream shape | -4 | -53687091600.0% | NO-GO | 0.0047 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | -0.3 | -4025222100.0% | NO-GO | 30.2 vs 30.5 ms off the host boundary |
| **median non-additivity** | 4.6 | 61742777800.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: -4.3 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.5 | 25.5% | GO | 195 vs 126 host calls at 0.0214 ms/op (reference rate) |
| Flush cadence | 0.1 | 1.7% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | -0.1 | -1.7% | NO-GO | 19.9 vs 20.0 ms to the first host call |
| Per-element creation stream shape | -1 | -16.9% | NO-GO | 0.0164 vs 0.0214 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.4 | 93.1% | GO | 7.3 vs 1.9 ms off the host boundary |
| **median non-additivity** | -0.1 | 1.7% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@1000

Certified wall-clock delta: 35.3 ms on the control pages, 32.9 ms on the counts build. The attribution below runs on the timed build, whose delta is 43.9 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 20001 vs 20001 host calls at 0.0049 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 29.5 | 67.2% | GO | 32.1 vs 2.6 ms to the first host call |
| Per-element creation stream shape | -5.5 | -12.5% | NO-GO | 0.0047 vs 0.0049 ms of host time per call |
| Framework script and browser paint outside the host boundary | 12.2 | 27.8% | GO | 30.2 vs 18.0 ms off the host boundary |
| **median non-additivity** | 7.7 | 17.5% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 18.7 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.5 | 6.5% | NO-GO | 195 vs 127 host calls at 0.0220 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 17.4 | 75.0% | GO | 19.9 vs 2.5 ms to the first host call |
| Per-element creation stream shape | -1.1 | -4.7% | NO-GO | 0.0164 vs 0.0220 ms of host time per call |
| Framework script and browser paint outside the host boundary | 5.7 | 24.6% | GO | 7.3 vs 1.6 ms off the host boundary |
| **median non-additivity** | -0.3 | 1.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| `__AddEvent` | 20,000 | 20,000 | 20,000 | 20,000 | 20,000 |
| `__AppendElement` | 70,000 | 70,000 | 70,000 | 70,000 | 70,000 |
| `__CreateRawText` | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| `__CreateText` | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| `__CreateView` | 10,000 | 10,000 | 10,000 | 10,000 | 10,000 |
| `__FlushElementTree` | 1 | 1 | 1 | 1 | 1 |
| `__SetClasses` | 40,000 | 40,000 | 40,000 | 40,000 | 40,000 |
| **total host calls** | 200,001 | 200,001 | 200,001 | 200,001 | 200,001 |
| **host calls per row** | 20 | 20 | 20 | 20 | 20 |

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| wall ms, control | 1133.9 | 1193.5 | 1150.1 | 1252.7 | 889.6 |
| wall ms, counts build | 1181.9 | 1232.8 | 1195.3 | 1209.7 | 941.7 |
| wall ms, timed build | 1344.8 | 1307.3 | 1334.3 | 1315.6 | 1060.1 |
| `__FlushElementTree` calls | 1 | 1 | 1 | 1 | 1 |
| start delay ms | 165.5 | 173.3 | 167.8 | 171.9 | 9 |
| host op time ms, timed | 921.2 | 835.5 | 891.8 | 851.5 | 885.3 |
| host ms per call, timed | 0.00461 | 0.00418 | 0.00446 | 0.00426 | 0.00443 |
| flush time ms, timed | 0.1 | 0.1 | 0.1 | 0 | 0 |
| off-boundary ms, timed | 238.5 | 284.1 | 255.8 | 303.1 | 177.6 |
| counts-build overhead | 1.042× | 1.033× | 1.039× | 0.966× | 1.059× |
| timed-build overhead | 1.186× | 1.095× | 1.16× | 1.05× | 1.192× |
| counts agree across builds | yes | yes | yes | yes | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane | octane-profile | octane-mts-program | octane-mts-program-profile | octane-direct |
|---|---:|---:|---:|---:|---:|
| slice start → paint ms, control | 30.5 | 26.2 | 31.9 | 26.7 | 11.6 |
| slice start → paint ms, counts | 26.8 | 27.6 | 30.4 | 30 | 13.7 |
| start delay ms | 20 | 19.7 | 19.5 | 19.7 | 2.4 |
| host calls | 195 | 195 | 126 | 126 | 127 |
| `__FlushElementTree` calls | 2 | 2 | 2 | 2 | 2 |
| host op time ms, timed | 2.8 | 3.1 | 2.7 | 2.7 | 2.9 |
| off-boundary ms, timed | 3.5 | 3.6 | 1.9 | 6.3 | 4.7 |
| counts-build overhead | 0.879× | 1.053× | 0.953× | 1.124× | 1.181× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.8 | 18.9–20.1 | 1.2% |
| papi_create | 577.9 | 550–594 | 36.0% |
| papi_props | 114.9 | 110.1–117.8 | 7.1% |
| papi_events | 41.7 | 39.6–43.9 | 2.6% |
| papi_topology | 77.6 | 73.8–78.3 | 4.8% |
| papi_read | 30.7 | 27.9–32.3 | 1.9% |
| papi_flush | 149.3 | 111.8–153.8 | 9.3% |
| off_boundary | 600 | 577.8–613.7 | 37.3% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.6 ms. Wall 1304 ms control / 1381 ms counts / 1607.1 ms timed; overhead 1.059× counts, 1.232× timed.

### `octane-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.3 | 19.9–22.8 | 1.3% |
| papi_create | 546.7 | 538.9–569.6 | 35.4% |
| papi_props | 93.4 | 89.4–99.7 | 6.1% |
| papi_events | 37.9 | 33.4–39.8 | 2.5% |
| papi_topology | 60.9 | 59.2–65.3 | 3.9% |
| papi_read | 18.6 | 17–37.3 | 1.2% |
| papi_flush | 139.8 | 112.1–148.7 | 9.1% |
| off_boundary | 617.7 | 587.6–647.7 | 40.0% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.9 ms. Wall 1382.5 ms control / 1367.4 ms counts / 1543.4 ms timed; overhead 0.989× counts, 1.116× timed.

### `octane-mts-program` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 19.5 | 19.3–20 | 1.5% |
| papi_create | 567.7 | 552.9–597.4 | 44.2% |
| papi_props | 69.2 | 65.8–85.7 | 5.4% |
| papi_events | 38.2 | 35.3–40.1 | 3.0% |
| papi_topology | 68.3 | 61.6–72.5 | 5.3% |
| papi_read | 8.7 | 7.4–10.8 | 0.7% |
| papi_flush | 140.3 | 132.6–145.8 | 10.9% |
| off_boundary | 368.3 | 347.2–403.9 | 28.6% |

Host calls 220,126 (22.01 per row), 2 `__FlushElementTree`, start delay 19.4 ms. Wall 1097.9 ms control / 1147.6 ms counts / 1285.8 ms timed; overhead 1.045× counts, 1.171× timed.

### `octane-mts-program-profile` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 20.2 | 19.7–20.7 | 1.6% |
| papi_create | 534.2 | 524.3–579.2 | 41.7% |
| papi_props | 58.6 | 55.8–64.9 | 4.6% |
| papi_events | 34.3 | 30.8–40.4 | 2.7% |
| papi_topology | 54 | 51.7–56.6 | 4.2% |
| papi_read | 5.1 | 3.9–6.2 | 0.4% |
| papi_flush | 135.1 | 128.5–148.6 | 10.6% |
| off_boundary | 437.9 | 398.7–447.9 | 34.2% |

Host calls 220,126 (22.01 per row), 2 `__FlushElementTree`, start delay 19.8 ms. Wall 1142.9 ms control / 1166.9 ms counts / 1280.4 ms timed; overhead 1.021× counts, 1.12× timed.

### `octane-direct` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 2.3 | 2.3–2.6 | 0.2% |
| papi_create | 530.9 | 505.4–559.4 | 53.1% |
| papi_props | 68.1 | 66.7–75.2 | 6.8% |
| papi_events | 32.9 | 31.8–34.1 | 3.3% |
| papi_topology | 56.4 | 56.1–58.5 | 5.6% |
| papi_read | 0 | 0–0.1 | 0.0% |
| papi_flush | 140.4 | 124.1–166 | 14.0% |
| off_boundary | 175 | 156.9–188.4 | 17.5% |

Host calls 200,127 (20.01 per row), 2 `__FlushElementTree`, start delay 2.4 ms. Wall 848.8 ms control / 897.3 ms counts / 999.9 ms timed; overhead 1.057× counts, 1.178× timed.

### `octane` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-profile`, the profile build of `octane`. Its first-screen wall on the uninstrumented control pages is 1382.5 ms against that shipping cell's 1304 ms in the same window — +78.5 ms, +6.0%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 75 |
| publish | 240,152 | 878 | 381.1 |
| capture | 70,041 | 18.5 | 87.6 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 543.7 |
| **residue — web-core script and the browser frame** | — | — | 78.6 |

Off-boundary in the profiled cell's own timed FCP window is 617.7 ms, against 600 ms in `octane`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### `octane-mts-program` first-screen phase split @10000 — what off-boundary time is Octane's

Measured on `octane-mts-program-profile`, the profile build of `octane-mts-program`. Its first-screen wall on the uninstrumented control pages is 1142.9 ms against that shipping cell's 1097.9 ms in the same window — +45 ms, +4.1%. That side-by-side is the whole licence for reading the split as the shipping build's; the two builds are never divided into a ratio. Any residual probe cost lands inside Octane's own phases, so it over-attributes to the framework and under-attributes to the residue.

| first-screen phase | host calls | host self ms | off-boundary ms |
|---|---:|---:|---:|
| render | 0 | 0 | 51.5 |
| publish | 200,124 | 820.1 | 259.5 |
| capture | 20,000 | 5.1 | 19.2 |
| announce | 0 | 0 | 0 |
| **Octane first-screen script** | — | — | 333.5 |
| **residue — web-core script and the browser frame** | — | — | 98 |

Off-boundary in the profiled cell's own timed FCP window is 437.9 ms, against 368.3 ms in `octane-mts-program`'s. Only the residue row is outside Octane's reach; the phase rows above it are what a first-screen slice can still attack.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1164.4 ms on the control pages; its direct pre-populated FCP@10000 is 1304 ms — an excess of **139.6 ms (12.0%)** for the same rendered result. The counts build agrees: 1208.7 ms composed against 1381 ms direct.

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
| start_delay | 19.8 | 170.3 | -150.5 |
| papi_create | 577.9 | 616.4 | -38.5 |
| papi_props | 114.9 | 78.6 | +36.3 |
| papi_events | 41.7 | 40.8 | +0.9 |
| papi_topology | 77.6 | 185.4 | -107.8 |
| papi_read | 30.7 | 0 | +30.7 |
| papi_flush | 149.3 | 0.1 | +149.2 |
| off_boundary | 600 | 238.5 | +361.5 |

### Octane − `octane-mts-program`, create@10000

Certified wall-clock delta: -16.2 ms on the control pages, -13.4 ms on the counts build. The attribution below runs on the timed build, whose delta is 10.5 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 200001 vs 200001 host calls at 0.0045 ms/op (reference rate) |
| Flush cadence | 0 | -0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 2.5 | 23.8% | GO | 170.3 vs 167.8 ms to the first host call |
| Per-element creation stream shape | 29.4 | 280.0% | GO | 0.0046 vs 0.0045 ms of host time per call |
| Framework script and browser paint outside the host boundary | -17.3 | -164.8% | NO-GO | 238.5 vs 255.8 ms off the host boundary |
| **median non-additivity** | -4.1 | 39.0% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-mts-program`, startup

Certified wall-clock delta: -3.6 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.5 | 26.4% | GO | 195 vs 126 host calls at 0.0214 ms/op (reference rate) |
| Flush cadence | -0.1 | -1.8% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 2.4 | 42.9% | GO | 22.5 vs 20.1 ms to the first host call |
| Per-element creation stream shape | -1.4 | -24.6% | NO-GO | 0.0144 vs 0.0214 ms of host time per call |
| Framework script and browser paint outside the host boundary | 1.6 | 28.6% | GO | 3.5 vs 1.9 ms off the host boundary |
| **median non-additivity** | 1.6 | 28.6% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, create@10000

Certified wall-clock delta: 244.3 ms on the control pages, 240.2 ms on the counts build. The attribution below runs on the timed build, whose delta is 284.7 ms; a candidate owner is authorized only by a positive directly observed contribution of at least 10% of it. A near-zero or negative certified delta means there is no deficit at this scale to authorize anything against, whatever the shares below read.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 0 | 0.0% | NO-GO | 200001 vs 200001 host calls at 0.0044 ms/op (reference rate) |
| Flush cadence | 0.1 | 0.0% | NO-GO | 1 vs 1 __FlushElementTree calls |
| First-paint scheduling | 161.4 | 56.7% | GO | 170.3 vs 8.9 ms to the first host call |
| Per-element creation stream shape | 35.9 | 12.6% | GO | 0.0046 vs 0.0044 ms of host time per call |
| Framework script and browser paint outside the host boundary | 60.9 | 21.4% | GO | 238.5 vs 177.6 ms off the host boundary |
| **median non-additivity** | 26.4 | 9.3% | — | the identity is exact per sample; each owner above is a median of its own sample |

### Octane − `octane-direct`, startup

Certified wall-clock delta: 13.1 ms on the counts build.

| candidate owner | delta ms | share of delta | verdict | directly observed |
|---|---:|---:|---|---|
| Publication op count | 1.6 | 7.6% | NO-GO | 195 vs 127 host calls at 0.0228 ms/op (reference rate) |
| Flush cadence | 0 | 0.0% | NO-GO | 2 vs 2 __FlushElementTree calls |
| First-paint scheduling | 19.8 | 97.5% | GO | 22.5 vs 2.7 ms to the first host call |
| Per-element creation stream shape | -1.7 | -8.1% | NO-GO | 0.0144 vs 0.0228 ms of host time per call |
| Framework script and browser paint outside the host boundary | -1.2 | -5.9% | NO-GO | 3.5 vs 4.7 ms off the host boundary |
| **median non-additivity** | 1.8 | 8.9% | — | the identity is exact per sample; each owner above is a median of its own sample |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 1,000 projected | 10,000 projected | 1,000 direct | 10,000 direct |
|---|---:|---:|---:|---:|
| octane | 162.1 | 1164.4 | 177.2 | 1304 |
| octane-profile | 170.7 | 1219.7 | 183.5 | 1382.5 |
| octane-mts-program | 163.8 | 1182 | 149 | 1097.9 |
| octane-mts-program-profile | 175.5 | 1279.4 | 152.7 | 1142.9 |
| octane-direct | 108.6 | 901.2 | 98.6 | 848.8 |

## Scaling

| cell | 1,000 ops/row | 10,000 ops/row | drift | flush count constant |
|---|---:|---:|---:|---|
| octane | 20 | 20 | 0.0% | yes |
| octane-profile | 20 | 20 | 0.0% | yes |
| octane-mts-program | 20 | 20 | 0.0% | yes |
| octane-mts-program-profile | 20 | 20 | 0.0% | yes |
| octane-direct | 20 | 20 | 0.0% | yes |

