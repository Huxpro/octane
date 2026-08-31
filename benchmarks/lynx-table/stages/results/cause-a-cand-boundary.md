# Element PAPI boundary decomposition — Octane

- measured: 2026-08-30T09:48:30.581Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.45/1.21/1.97 (1/5/15m), end 1.22/1.27/1.93
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

## 10,000 rows

### Host call counts and flush cadence — create@10000

| host call | octane |
|---|---:|
| `__AddEvent` | 20,000 |
| `__AppendElement` | 60,000 |
| `__CreateRawText` | 20,000 |
| `__CreateText` | 30,000 |
| `__CreateView` | 10,000 |
| `__FlushElementTree` | 1 |
| `__SetAttribute` | 10,000 |
| `__SetClasses` | 40,000 |
| **total host calls** | 190,001 |
| **host calls per row** | 19 |

| measure | octane |
|---|---:|
| wall ms, control | 984.1 |
| wall ms, counts build | 1033.1 |
| wall ms, timed build | 1156.2 |
| `__FlushElementTree` calls | 1 |
| start delay ms | 154.2 |
| host op time ms, timed | 708.6 |
| host ms per call, timed | 0.00373 |
| flush time ms, timed | 0.1 |
| off-boundary ms, timed | 279.2 |
| counts-build overhead | 1.05× |
| timed-build overhead | 1.175× |
| counts agree across builds | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane |
|---|---:|
| slice start → paint ms, control | 29.4 |
| slice start → paint ms, counts | 31.5 |
| start delay ms | 21.9 |
| host calls | 169 |
| `__FlushElementTree` calls | 2 |
| host op time ms, timed | 2.4 |
| off-boundary ms, timed | 6.1 |
| counts-build overhead | 1.071× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.2 | 18.6–23.7 | 1.6% |
| papi_create | 422 | 377.3–438.9 | 31.0% |
| papi_props | 118.6 | 116.8–141.4 | 8.7% |
| papi_events | 36.1 | 33.1–38.8 | 2.7% |
| papi_topology | 55.2 | 52.3–60.5 | 4.1% |
| papi_read | 19.9 | 15.9–22 | 1.5% |
| papi_flush | 147 | 138.6–155.6 | 10.8% |
| off_boundary | 550.1 | 514.7–608.4 | 40.4% |

Host calls 290,169 (29.02 per row), 2 `__FlushElementTree`, start delay 20.8 ms. Wall 1236.7 ms control / 1278.1 ms counts / 1361.5 ms timed; overhead 1.033× counts, 1.101× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1013.5 ms on the control pages; its direct pre-populated FCP@10000 is 1236.7 ms — an excess of **223.2 ms (22.0%)** for the same rendered result. The counts build agrees: 1064.6 ms composed against 1278.1 ms direct.

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
| start_delay | 21.2 | 150.5 | -129.3 |
| papi_create | 422 | 448.4 | -26.4 |
| papi_props | 118.6 | 85.6 | +33 |
| papi_events | 36.1 | 33 | +3.1 |
| papi_topology | 55.2 | 141.6 | -86.4 |
| papi_read | 19.9 | 0 | +19.9 |
| papi_flush | 147 | 0.1 | +146.9 |
| off_boundary | 550.1 | 279.2 | +270.9 |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 10,000 projected | 10,000 direct |
|---|---:|---:|
| octane | 1013.5 | 1236.7 |

