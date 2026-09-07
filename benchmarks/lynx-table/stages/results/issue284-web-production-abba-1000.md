# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-09-07T05:03:13.411Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz (medians of n=7, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.27/0.54/0.71, end 0.44/0.56/0.71 (1/5/15m over 32 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | issue284-candidate | issue284-base |
|---|---|---|
| create | 126 ±1 | 139 ±4 |
| update10th | 29 ±1 | 33 ±3 |
| select | 19 ±0 | 18 ±1 |
| updateStorm | 78 ±6 | 92 ±6 |
| selectStorm | 18 ±2 | 16 ±4 |
| clear | 23 ±1 | 25 ±1 |
