# Octane on Lynx — #103 B0 in-product A/B (universal core vs the Block core)

Session record for issue #103 B0: the first measurement of the Block background
core driving a real application behind a production main thread, against the
universal core, from the same `app/src/index.ts` with only the build flag
changed. Taken after the block core learned to supersede a stale `update`
(`perf(lynx): supersede a stale block-core update instead of appending beside
it`); the pre-fix window read `updateStorm` at 1.27x, and that regression is
what the fix removed.

`octane-block` writes scoped slots, the way a lowering with per-row reactive
cells would write. `octane-block-reconcile` hands the whole next list to the
keyed reconciler every tick, the way `setRows(next)` does today. Neither may be
quoted without the other: the scoped mode is an architecture ceiling, not a
framework measurement.

Absolute ms are host-bound. Only the same-window `÷ octane` ratios are claimed.

# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-21T07:55:04.087Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz (medians of n=5, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.54/1.44/2.04, end 1.82/1.57/2.03 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block | octane-block-reconcile |
|---|---|---|---|
| create | 144 ±4 | 130 ±15 | 115 ±5 |
| update10th | 21 ±1 | 24 ±3 | 20 ±5 |
| select | 23 ±2 | 8 ±5 | 19 ±6 |
| updateStorm | 81 ±6 | 33 ±2 | 66 ±4 |
| selectStorm | 20 ±3 | 25 ±2 | 37 ±4 |

### octane-block ÷ octane (1,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 144 | 130 | 0.91× |
| update10th | 21 | 24 | 1.15× |
| select | 23 | 8 | 0.34× |
| updateStorm | 81 | 33 | 0.41× |
| selectStorm | 20 | 25 | 1.22× |

### octane-block-reconcile ÷ octane (1,000 rows, same window)

| op | octane | octane-block-reconcile | ratio |
|---|---:|---:|---:|
| create | 144 | 115 | 0.80× |
| update10th | 21 | 20 | 0.92× |
| select | 23 | 19 | 0.85× |
| updateStorm | 81 | 66 | 0.81× |
| selectStorm | 20 | 37 | 1.84× |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block | octane-block-reconcile |
|---|---|---|---|
| create | 1234 ±50 | 1087 ±29 | 1039 ±12 |
| update10th | 173 ±7 | 100 ±5 | 118 ±5 |
| select | 79 ±7 | 44 ±2 | 57 ±5 |
| updateStorm | 582 ±26 | 325 ±48 | 623 ±41 |
| selectStorm | 108 ±4 | 89 ±16 | 215 ±19 |

### octane-block ÷ octane (10,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 1234 | 1087 | 0.88× |
| update10th | 173 | 100 | 0.57× |
| select | 79 | 44 | 0.55× |
| updateStorm | 582 | 325 | 0.56× |
| selectStorm | 108 | 89 | 0.83× |

### octane-block-reconcile ÷ octane (10,000 rows, same window)

| op | octane | octane-block-reconcile | ratio |
|---|---:|---:|---:|
| create | 1234 | 1039 | 0.84× |
| update10th | 173 | 118 | 0.68× |
| select | 79 | 57 | 0.72× |
| updateStorm | 582 | 623 | 1.07× |
| selectStorm | 108 | 215 | 1.99× |
