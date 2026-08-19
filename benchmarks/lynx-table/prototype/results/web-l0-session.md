# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-18T11:56:24.007Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz (medians of n=5; absolute ms are host-bound, ratios are the portable claim)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-direct | vue-vdom | vue-vapor | react |
|---|---|---|---|---|---|
| create | 127 ±3 (0.80×) | 106 ±6 (0.67×) | 158 ±5 | 165 ±7 (1.04×) | 129 ±3 (0.82×) |
| update10th | 29 ±2 (1.16×) | 19 ±2 (0.78×) | 25 ±5 | 18 ±5 (0.71×) | 26 ±2 (1.04×) |
| select | 28 ±1 (1.04×) | 10 ±7 (0.38×) | 27 ±1 | 28 ±6 (1.01×) | 27 ±6 (1.00×) |
| updateStorm | 70 ±3 (0.47×) | 57 ±11 (0.38×) | 150 ±6 | 44 ±7 (0.29×) | 437 ±26 (2.91×) |
| selectStorm | 24 ±5 (0.38×) | 16 ±4 (0.24×) | 65 ±5 | 16 ±2 (0.25×) | 167 ±8 (2.57×) |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-direct | vue-vdom | vue-vapor | react |
|---|---|---|---|---|---|
| create | 1082 ±11 (0.80×) | 862 ±13 (0.64×) | 1350 ±28 | 1407 ±17 (1.04×) | 1107 ±29 (0.82×) |
| update10th | 146 ±9 (1.34×) | 82 ±7 (0.75×) | 109 ±7 | 70 ±5 (0.64×) | 156 ±10 (1.43×) |
| select | 75 ±6 (1.15×) | 44 ±8 (0.67×) | 65 ±3 | 35 ±5 (0.53×) | 94 ±4 (1.44×) |
| updateStorm | 539 ±23 (0.32×) | 572 ±35 (0.34×) | 1668 ±103 | 808 ±22 (0.48×) | 3766 ±278 (2.26×) |
| selectStorm | 103 ±12 (0.15×) | 91 ±24 (0.13×) | 708 ±36 | 129 ±29 (0.18×) | 1851 ±356 (2.62×) |
