# Lynx table bundle optimization log

| Optimization | `main.lynx.bundle` before | After | Delta | Mechanism | Commit |
| --- | ---: | ---: | ---: | --- | --- |
| Compiler-proved host-ref pruning | 232,593 B | 224,349 B | -8,244 B (-3.54%) | Fail-closed paired-ledger feature specialization | `9b1d4c585` |
| Compiler-proved public-handle residue pruning | 224,349 B | 223,438 B | -911 B (-0.41%) | Leaf NodesRef constant plus no-thread store specialization | `20687b7bf` |
| **Cumulative** | **232,593 B** | **223,438 B** | **-9,155 B (-3.94%)** |  |  |

## Investigated but not shipped

| Lever | Measured delta | Outcome |
| --- | ---: | --- |
| Conditionally omit `setRefSelector` from the PAPI object | Lynx -10 B; Web +27 B; combined +17 B | Rejected: total bytes regressed and the optional public shape added complexity. |
| Wrap the background worklet factory in the no-thread flag | Web/Lynx byte-identical | Rejected: no shipped output change; reverted. |
| Skip the no-thread product receiver's unavailable/replaceable worklet registry | Lynx -706 B; Web -317 B beyond the retained arm | Rejected: adjacent FCP0 direction worsened (receiver-inclusive GM 1.009 in matched n=15 AB/BA; 1.027 across four windows), so the extra byte reduction did not pass the no-regression gate. |
