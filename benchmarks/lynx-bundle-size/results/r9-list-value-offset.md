# R9 native-list value-offset bundle tradeoff

Measured 2026-09-14 with `benchmarks/lynx-bundle-size/run.mjs`. The baseline was
detached commit `0d53d58ea` with the already-required Rspeedy default backend
identity synchronized from `/31` to that commit's `/32`; the candidate was the
adjacent working tree with the resident-driver value-offset capability and
backend `/33`. Both worktrees used the same lockfile and toolchain. The harness
completed its decoded-artifact and semantic-checksum controls before reaching
the pre-existing size-budget failure.

| artifact | section | raw B | gzip B | Brotli B |
| --- | --- | ---: | ---: | ---: |
| preview | full bundle | 545,089 → 545,151 (+62) | 188,879 → 188,906 (+27) | 157,435 → 157,315 (−120) |
| preview | MTS | 230,759 → 230,792 (+33) | 101,770 → 101,784 (+14) | 84,053 → 84,013 (−40) |
| preview | BTS | 313,590 → 313,619 (+29) | 87,036 → 87,046 (+10) | 73,383 → 73,514 (+131) |
| IFR | full bundle | 536,870 → 536,932 (+62) | 191,380 → 191,404 (+24) | 159,805 → 159,823 (+18) |
| IFR | MTS | 222,540 → 222,573 (+33) | 104,225 → 104,238 (+13) | 86,011 → 86,081 (+70) |
| IFR | BTS | 313,590 → 313,619 (+29) | 87,036 → 87,046 (+10) | 73,383 → 73,514 (+131) |

The emitted capability removes one cell-scoped values slice for each fresh
fixed-shape list cell without main-thread worklet rewriting. Eventless cells
also reuse immutable empty event/range tables. `listProgramCellValueCopies`
measures the remaining compatibility/worklet path: a fresh nonzero-index row
using the generated driver records zero copies, while the same row through a
driver without the capability records one and paints the same native shape.

This is a production bundle and deterministic-allocation receipt, not native
timing or memory evidence. The checked benchmark budget was already red in the
baseline: preview MTS gzip was 101,770 B against an 82,070 B ceiling; the
candidate was 101,784 B. R9/R11 therefore still require the wider bundle debt
and LepusNG/device create, ready, interaction, clear, memory, and GC gates to be
resolved separately.
