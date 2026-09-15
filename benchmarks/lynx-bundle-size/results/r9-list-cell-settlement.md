# R9 native-list cell-settlement bundle tradeoff

Measured 2026-09-14 with `benchmarks/lynx-bundle-size/run.mjs`. The baseline was
detached commit `b19308af4`; the candidate was its adjacent working tree with
instance-indexed cell settlement. Both worktrees used the same lockfile and
toolchain. The harness completed decoded-artifact and semantic-checksum controls
before reaching the pre-existing size-budget failure.

| artifact | section | raw B | gzip B | Brotli B |
| --- | --- | ---: | ---: | ---: |
| preview | full bundle | 545,340 → 545,414 (+74) | 188,942 → 188,982 (+40) | 157,244 → 157,387 (+143) |
| preview | MTS | 230,905 → 230,944 (+39) | 101,820 → 101,831 (+11) | 84,076 → 83,988 (−88) |
| preview | BTS | 313,695 → 313,730 (+35) | 87,060 → 87,072 (+12) | 73,482 → 73,543 (+61) |
| IFR | full bundle | 537,125 → 537,199 (+74) | 191,475 → 191,492 (+17) | 160,005 → 159,880 (−125) |
| IFR | MTS | 222,690 → 222,729 (+39) | 104,301 → 104,311 (+10) | 85,938 → 86,128 (+190) |
| IFR | BTS | 313,695 → 313,730 (+35) | 87,060 → 87,072 (+12) | 73,482 → 73,543 (+61) |

The accepted-delta finalizer no longer allocates `new Map(next.map(...))`, array
snapshots of attached/retained cells, or one flattened pool array. It resolves
cell handles through the store's existing authoritative instance table and
swaps the pooled table before re-partitioning. A 1,000-row control with one
materialized cell records one settlement lookup for a metadata commit, zero for
a non-metadata commit, and zero during a prepared frame that rolls back.

This is a decoded production-bundle and deterministic-work receipt, not native
timing or memory evidence. The checked budget was already red in the baseline:
preview MTS gzip was 101,820 B against an 82,070 B ceiling; the candidate was
101,831 B. R9/R11 still require the wider bundle debt and LepusNG/device create,
ready, interaction, clear, memory, and GC gates to be resolved separately.
