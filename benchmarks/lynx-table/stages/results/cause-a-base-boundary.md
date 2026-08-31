# Element PAPI boundary decomposition — Octane

- measured: 2026-08-30T09:52:16.591Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v22; Node v22.22.2; Chromium 141.0.7390.37; @lynx-js/web-core 0.22.2
- host clock granularity: 0.1 ms; a single host call is far below it, so only per-kind aggregates over many calls carry meaning
- host load: start 0.54/0.94/1.71 (1/5/15m), end 1.83/1.30/1.77
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
| `__AppendElement` | 70,000 |
| `__CreateRawText` | 30,000 |
| `__CreateText` | 30,000 |
| `__CreateView` | 10,000 |
| `__FlushElementTree` | 1 |
| `__SetClasses` | 40,000 |
| **total host calls** | 200,001 |
| **host calls per row** | 20 |

| measure | octane |
|---|---:|
| wall ms, control | 1009.2 |
| wall ms, counts build | 1057.5 |
| wall ms, timed build | 1150 |
| `__FlushElementTree` calls | 1 |
| start delay ms | 155.5 |
| host op time ms, timed | 753.2 |
| host ms per call, timed | 0.00377 |
| flush time ms, timed | 0.1 |
| off-boundary ms, timed | 256.5 |
| counts-build overhead | 1.048× |
| timed-build overhead | 1.14× |
| counts agree across builds | yes |

### Startup to first composed paint — app shell, no rows

| measure | octane |
|---|---:|
| slice start → paint ms, control | 27.9 |
| slice start → paint ms, counts | 28.9 |
| start delay ms | 20.1 |
| host calls | 195 |
| `__FlushElementTree` calls | 2 |
| host op time ms, timed | 2.7 |
| off-boundary ms, timed | 3.4 |
| counts-build overhead | 1.036× |

### `octane` FCP@10000 — pre-populated first screen, slice start → all rows painted

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| start_delay | 21.8 | 19.3–24.8 | 1.5% |
| papi_create | 500.5 | 458.1–529.1 | 34.4% |
| papi_props | 102.1 | 94–131.1 | 7.0% |
| papi_events | 35.4 | 32.6–63.5 | 2.4% |
| papi_topology | 61.8 | 57.9–67.3 | 4.2% |
| papi_read | 24 | 23.2–31 | 1.6% |
| papi_flush | 167.2 | 143.8–188 | 11.5% |
| off_boundary | 532.2 | 510.7–575.9 | 36.6% |

Host calls 310,195 (31.02 per row), 2 `__FlushElementTree`, start delay 19.7 ms. Wall 1254.6 ms control / 1304.3 ms counts / 1455.5 ms timed; overhead 1.04× counts, 1.16× timed.

### Octane internal control — first-screen path vs create path @10000

Both paths end in the same composed tree, measured by the same driver on the same bundle family, so no cross-framework difference can enter this comparison. Composing Octane's own shell startup and create windows gives 1037.1 ms on the control pages; its direct pre-populated FCP@10000 is 1254.6 ms — an excess of **217.5 ms (21.0%)** for the same rendered result. The counts build agrees: 1086.4 ms composed against 1304.3 ms direct.

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
| start_delay | 21.8 | 158.9 | -137.1 |
| papi_create | 500.5 | 507.1 | -6.6 |
| papi_props | 102.1 | 58.2 | +43.9 |
| papi_events | 35.4 | 34.5 | +0.9 |
| papi_topology | 61.8 | 153.4 | -91.6 |
| papi_read | 24 | 0 | +24 |
| papi_flush | 167.2 | 0.1 | +167.1 |
| off_boundary | 532.2 | 256.5 | +275.7 |

## Projected FCP@N

The vendored references carry no pre-populated first screen, so their FCP@N can only be projected as `startup + create` on the control pages. Octane carries both values, and its projection error is the honest bound on how far that composition sits from a real first screen.

| cell | 10,000 projected | 10,000 direct |
|---|---:|---:|
| octane | 1037.1 | 1254.6 |

