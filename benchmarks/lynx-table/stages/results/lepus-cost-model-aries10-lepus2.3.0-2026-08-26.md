# LepusNG cost model — Aries 10 / LepusNG 2.3.0

Issue: [#196](https://github.com/Huxpro/octane/issues/196). Protocol: [#194](https://github.com/Huxpro/octane/issues/194).

## Result

M1 produced a device primitive table, but M2 closed the validation gate. The frozen Q2 1k emitted-program prediction was 7.757 ms; the protocol-valid device median was 150 ms (94.83% relative absolute error, target ≤25%). Ordering was correct: program was faster than the interpreted template (338 ms).

The 10k observer-instrumented attempt and 30k crossing-surrogate attempt timed out and are checked in as invalid records. C8 remains calculated-only. Consequently the M2 gate is **closed** and no M3 row is marked validated.

## Setup and protocol

- Device: aries_10, Android 10, arm64-v8a.
- Engine stamp: LepusNG 2.3.0; app-bundle engine 3.9; Lynx SDK 4.0.
- DevTool disabled, n=5, AB/BA order, pre/post load + thermal + battery captured, medians and full samples stored per window.
- Device windows are separate records; no totals are formed across windows. Invalid and overlapping attempts are not spendable.
- V8 context-only: V8 host globals are JavaScript mocks, not Lynx Element PAPI FFI. This run is never used for device decisions or M2 predictions.

## M1 primitive deltas

Positive values mean candidate minus control. V8 is context only and is not substituted for device values.

| Case | Group | LepusNG ns/op | V8 context ns/op | fit RMSE ms | Status |
| --- | --- | ---: | ---: | ---: | --- |
| `empty_loop` | dispatch | 33.22 | 0.48 | 0.45 | measured |
| `call_0_args` | dispatch | 103.34 | -0.19 | 0.73 | measured |
| `call_3_args` | dispatch | 146.78 | -0.22 | 0.65 | measured |
| `call_8_args` | dispatch | 226.47 | -0.31 | 0.44 | measured |
| `property_method_vs_local_binding` | dispatch | 0.14 | -0.02 | 0.75 | resolution-limited |
| `host_papi_vs_lepus_call` | dispatch | 5.63 | 154.74 | 0.57 | resolution-limited |
| `closure_read_vs_local` | environment | 1.15 | 0.06 | 0.72 | resolution-limited |
| `global_read_vs_local` | environment | 22.47 | 149.54 | 0.82 | measured |
| `property_load_vs_local` | property | 31.03 | -0.41 | 0.68 | measured |
| `property_store_vs_local` | property | 18.16 | -0.07 | 0.68 | measured |
| `array_index_load_vs_local` | property | 33.22 | -0.36 | 0.84 | measured |
| `array_index_store_vs_local` | property | 18.26 | 1.57 | 0.58 | measured |
| `property_load_2_shapes_vs_1` | shape | -1.29 | 0.42 | 0.68 | resolution-limited |
| `property_load_8_shapes_vs_1` | shape | 0.14 | 0.39 | 0.77 | resolution-limited |
| `object_literal_vs_scalar` | allocation | 332.24 | -0.10 | 0.61 | measured |
| `array_literal_vs_scalar` | allocation | 305.18 | -1.14 | 0.74 | measured |
| `closure_allocation_vs_scalar` | allocation | 1058.16 | 13.02 | 0.91 | measured |
| `template_literal_vs_concat` | string | 94.33 | -4.32 | 0.88 | measured |
| `string_host_crossing_vs_stays` | string | 989.46 | 198.82 | 1.06 | measured |
| `switch_vs_if_4` | branch | 15.83 | 0.18 | 0.73 | measured |
| `table_vs_if_4` | branch | -8.90 | -1.23 | 0.56 | measured |
| `switch_vs_if_16` | branch | 5.63 | -0.12 | 0.47 | measured |
| `table_vs_if_16` | branch | -133.43 | -0.93 | 0.64 | measured |
| `switch_vs_if_64` | branch | -12.63 | 0.08 | 0.62 | measured |
| `table_vs_if_64` | branch | -599.34 | -0.96 | 0.47 | measured |

## M2 frozen prediction and backtest

| Rows | Predicted program ms | Actual program median ms | Program error | Predicted template floor ms | Actual template median ms | Actual order | Status |
| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1,000 | 7.757 | 150 | 94.83% | 8.206 | 338 | program-faster | measured |
| 10,000 | 77.565 | — | — | 82.062 | — | — | invalid-timeout |
| 30,000 | 232.695 | — | — | 246.186 | — | — | invalid-timeout |

The valid 1k program boundary executes the real emitted program against an M1-matched crossing surrogate: numeric factory/append calls use `getUniqueId`, string calls use `setAttribute` on one detached sentinel, and no per-call clock is read. The template boundary ends after outer `renderPlanNode` and before paint. Both arms log then throw a sentinel, excluding paint/flush.

Parse/eval remains unobservable with DevTool disabled because native evaluates bytecode before an in-bundle clock can start; launch wall mixes native load/layout and is not reported as script self time. The frozen inventory also attributed 20 whole-cell host crossings per row, while the emitted row-shaped program exposed 15.121 surrogate crossings per row and 5,041 program nodes at 1k. The 94.83% miss therefore refutes the absolute model rather than being patched after observation.

C8 has equal M1 primitive multisets and a frozen predicted script delta of 0 ms. With no completed device window, this is structural consistency only; flush/layout effects remain outside the model.

## M3 compiler guide

| Guide | Evidence | Finding |
| --- | --- | --- |
| absolute emitted-program model | refuted | The 1k prediction missed the protocol-valid surrogate median by 94.83%. |
| whole-tree unrolling | refuted | The frozen inventory assumed 20 whole-cell crossings per row; the emitted row-shaped program exposed 15.121 surrogate crossings per row and 5,041 program nodes at 1k. |
| row-shape function plus tight loop | calculated | The current emitted implementation is already row-shaped, but the failed absolute backtest prevents a performance claim. |
| slot dispatch | calculated | Table lookup beat if/else by 8.90, 133.43, and 599.34 ns/op at 4, 16, and 64 slots; switch crossed from +15.83/+5.63 to -12.63 ns/op. These are M1 deltas, not an end-to-end compiler win. |
| string construction and crossing | calculated | Template literals cost +94.33 ns/op versus concat, while crossing a string cost +989.46 ns/op; prefer passing through existing strings when semantics permit. |
| property hoisting | calculated | Generic property load measured +31.03 ns/op, but method-vs-local was only +0.14 ns/op and resolution-limited, so there is no evidence to pay code-size cost for blanket hoisting. |
| C8 append ordering | calculated | Both variants have the same M1 primitive multiset, predicting 0 ms script delta. Any observed difference is assigned to flush/layout, outside this script model; no C8 device window was completed. |

## Records

- `benchmarks/lynx-table/stages/results/lepus-cost-m1-dispatch-property-aries10-2026-08-26.json` (SHA-256 `55245c6ba9af99328839482b7ad1cd8ac54c4e71221b9dbcf356daeff6fc36c5`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m1-allocation-string-branch-aries10-2026-08-26.json` (SHA-256 `9ba413e391c140563503278012ceab6378de4d528dd80efcd76ff622193d9b4a`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m1-v8-context-2026-08-26.json` (SHA-256 `dbbda2b7cffec0fa4cf456757885ed938dc67c74b38dd8af222e3c5a740bc9ce`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m2-prediction-2026-08-26.json` (SHA-256 `fdcfc45276d1e0668b73322a3d17cf581992e7d5941498e087ff562ad284e43a`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m2-actual-q2-aries10-2026-08-26.json` (SHA-256 `ae525c56783d5f2b3a8b59632d98dda81af87fe2e1e462b6e6b2f2fab2edc16d`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m2-invalid-observer-timeout-10000-aries10-2026-08-26.json` (SHA-256 `742bf9b30f790d4f5019be844e4d562e8e13132d6e098c4fb088c92a62d7d670`)
- `benchmarks/lynx-table/stages/results/lepus-cost-m2-invalid-crossing-timeout-30000-aries10-2026-08-26.json` (SHA-256 `94e4a693ddd99c0684ac78a329ac2a3a4674e5d05ba43cc6f3f4d1a04ef8171a`)
