# Lynx table bundle optimization log

| Optimization | `main.lynx.bundle` before | After | Delta | Mechanism | Commit |
| --- | ---: | ---: | ---: | --- | --- |
| Compiler-proved host-ref pruning | 232,593 B | 224,349 B | -8,244 B (-3.54%) | Fail-closed paired-ledger feature specialization | `9b1d4c585` |
| **Cumulative** | **232,593 B** | **224,349 B** | **-8,244 B (-3.54%)** |  |  |

## Investigated but not shipped

| Lever | Measured delta | Outcome |
| --- | ---: | --- |
| Conditionally omit `setRefSelector` from the PAPI object | Lynx -10 B; Web +27 B; combined +17 B | Rejected: total bytes regressed and the optional public shape added complexity. |
