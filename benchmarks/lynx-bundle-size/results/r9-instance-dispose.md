# R9 instance-disposal bundle control

Measured 2026-09-14 with `benchmarks/lynx-bundle-size/run.mjs`. The baseline was
commit `d879b7043`; the candidate was its adjacent working tree with scalar
instance-handle disposal. Both used the same lockfile and toolchain. The harness
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

The store now snapshots only live numeric handles, then resolves each instance
from the authoritative map while disposing in reverse order. A 1,000-instance
dense-run control verifies the removal sequence from handle 1,000 down to 1 and
an empty host tree afterward. This removes N transient map-entry pair arrays
without adding long-lived links to every instance.

This is a decoded production-bundle and deterministic-lifecycle receipt, not
native timing or memory evidence. The checked budget remains red and unchanged:
preview MTS gzip is 101,831 B against an 82,070 B ceiling. R9/R11 still require
the wider bundle debt and LepusNG/device create, ready, interaction, clear,
memory, and GC gates to be resolved separately.
