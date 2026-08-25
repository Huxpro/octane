# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-25T20:30:19.665Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz (medians of n=7, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.38/0.76/0.88, end 1.75/1.08/0.98 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-mts-program |
|---|---|---|
| create | 136 ±3 | 136 ±1 |
| update10th | 22 ±1 | 23 ±1 |
| select | 20 ±2 | 21 ±1 |
| updateStorm | 79 ±9 | 81 ±8 |
| selectStorm | 22 ±4 | 19 ±4 |
| clear | 63 ±2 | 61 ±2 |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-mts-program |
|---|---|---|
| create | 1124 ±21 | 1142 ±10 |
| update10th | 125 ±4 | 131 ±4 |
| select | 64 ±5 | 64 ±2 |
| updateStorm | 472 ±17 | 468 ±24 |
| selectStorm | 99 ±10 | 93 ±8 |
| clear | 548 ±8 | 546 ±16 |
