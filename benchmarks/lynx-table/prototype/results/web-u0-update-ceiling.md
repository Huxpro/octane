# Octane on Lynx — #103 U0 update-path ceiling (octane vs the direct-emission floor)

Session record for issue #103 U0. Only the two cells the ceiling question needs
were driven, so the `×vs vue-vdom` column is absent by construction rather than
omitted from a degraded run. Counts are deterministic and portable; medians are
host-bound and only the same-window ratio is claimed.


- date: 2026-08-20T03:19:58.232Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz (medians of n=5, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 1.28/2.35/3.00, end 1.41/2.11/2.85 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-direct |
|---|---|---|
| create | 206 ±15 | 158 ±10 |
| update10th | 32 ±4 | 20 ±5 |
| select | 31 ±5 | 17 ±1 |
| updateStorm | 108 ±11 | 104 ±14 |
| selectStorm | 26 ±4 | 27 ±7 |

### octane-direct — deterministic floor counts (1,000 rows)

Counts, not milliseconds: deterministic for this app and interaction, so they carry across hosts and sessions where the medians above do not. "Row regions visited" and "slot writes" are main-thread; "keyed block lookups" is what a keyed core touches on the background thread and "background row scans" is what this stub actually touched, which is larger wherever the stub keeps state in an array instead of a key map. Spread is the summed median-to-extreme range over all four columns and must be 0.

| op | row regions visited | slot writes | keyed block lookups | background row scans | spread |
|---|---:|---:|---:|---:|---:|
| create | 1,000 | 2,000 | 0 | 0 | 0 |
| update10th | 100 | 100 | 100 | 100 | 0 |
| select | 1 | 1 | 1 | 2 | 0 |
| updateStorm | 5,000 | 5,000 | 5,000 | 5,000 | 0 |
| selectStorm | 60 | 60 | 60 | 28,451 | 0 |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-direct |
|---|---|---|
| create | 1896 ±49 | 1426 ±65 |
| update10th | 273 ±10 | 162 ±17 |
| select | 143 ±19 | 118 ±38 |
| updateStorm | 1083 ±72 | 1220 ±370 |
| selectStorm | 208 ±53 | 189 ±17 |

### octane-direct — deterministic floor counts (10,000 rows)

Counts, not milliseconds: deterministic for this app and interaction, so they carry across hosts and sessions where the medians above do not. "Row regions visited" and "slot writes" are main-thread; "keyed block lookups" is what a keyed core touches on the background thread and "background row scans" is what this stub actually touched, which is larger wherever the stub keeps state in an array instead of a key map. Spread is the summed median-to-extreme range over all four columns and must be 0.

| op | row regions visited | slot writes | keyed block lookups | background row scans | spread |
|---|---:|---:|---:|---:|---:|
| create | 10,000 | 20,000 | 0 | 0 | 0 |
| update10th | 1,000 | 1,000 | 1,000 | 1,000 | 0 |
| select | 1 | 1 | 1 | 2 | 0 |
| updateStorm | 50,000 | 50,000 | 50,000 | 50,000 | 0 |
| selectStorm | 60 | 60 | 60 | 84,451 | 0 |
