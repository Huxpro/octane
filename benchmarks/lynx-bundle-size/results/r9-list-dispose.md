# R9 native-list disposal bundle control

Measured 2026-09-14 with `benchmarks/lynx-bundle-size/run.mjs`. The baseline was
commit `d3cff75a4`; the candidate was its adjacent working tree with compact
terminal list disposal. Both used the same lockfile and toolchain. The harness
completed decoded-artifact and semantic-checksum controls before reaching the
pre-existing size-budget failure.

| artifact | section | raw B | gzip B | Brotli B |
| --- | --- | ---: | ---: | ---: |
| preview | full bundle | 545,414 → 545,414 (0) | 188,982 → 188,982 (0) | 157,387 → 157,387 (0) |
| preview | MTS | 230,944 → 230,944 (0) | 101,831 → 101,831 (0) | 83,988 → 83,988 (0) |
| preview | BTS | 313,730 → 313,730 (0) | 87,072 → 87,072 (0) | 73,543 → 73,543 (0) |
| IFR | full bundle | 537,199 → 537,199 (0) | 191,492 → 191,492 (0) | 159,880 → 159,880 (0) |
| IFR | MTS | 222,729 → 222,729 (0) | 104,311 → 104,311 (0) | 86,128 → 86,128 (0) |
| IFR | BTS | 313,730 → 313,730 (0) | 87,072 → 87,072 (0) | 73,543 → 73,543 (0) |

The source-level ownership path now shares disabled native-list callbacks and
the immutable empty item table, directly iterates the deletable cell map, and
creates error arrays only after a cleanup failure. Existing fault injection
proves that a mutate-then-throw removal does not skip later cells and that only
the failed owner remains for a subsequent `dispose()` retry.

This is a decoded production-bundle and deterministic-lifecycle receipt, not
native timing or memory evidence. The checked budget was already red and stays
unchanged: preview MTS gzip is 101,831 B against an 82,070 B ceiling. R9/R11
still require the wider bundle debt and LepusNG/device create, ready,
interaction, clear, memory, and GC gates to be resolved separately.
