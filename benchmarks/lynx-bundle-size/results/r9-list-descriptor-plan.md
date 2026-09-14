# R9 native-list descriptor-plan bundle tradeoff

Measured 2026-09-14 with `benchmarks/lynx-bundle-size/run.mjs`. The baseline was
detached commit `cf14c07a2`; the candidate was its adjacent working tree with
per-template native-list descriptor plans. Both worktrees used the same lockfile
and toolchain. The harness completed decoded-artifact and semantic-checksum
controls before reaching the pre-existing size-budget failure.

| artifact | section | raw B | gzip B | Brotli B |
| --- | --- | ---: | ---: | ---: |
| preview | full bundle | 545,151 → 545,340 (+189) | 188,906 → 188,942 (+36) | 157,315 → 157,244 (−71) |
| preview | MTS | 230,792 → 230,905 (+113) | 101,784 → 101,820 (+36) | 84,013 → 84,076 (+63) |
| preview | BTS | 313,619 → 313,695 (+76) | 87,046 → 87,060 (+14) | 73,514 → 73,482 (−32) |
| IFR | full bundle | 536,932 → 537,125 (+193) | 191,404 → 191,475 (+71) | 159,823 → 160,005 (+182) |
| IFR | MTS | 222,573 → 222,690 (+117) | 104,238 → 104,301 (+63) | 86,081 → 85,938 (−143) |
| IFR | BTS | 313,619 → 313,695 (+76) | 87,046 → 87,060 (+14) | 73,514 → 73,482 (−32) |

The resident store now selects the four native-list metadata fields once per
template. A 1,000-row deterministic control with dynamic `item-key`, dynamic
text, and an unrelated dynamic root `class` records one descriptor-plan build,
1,000 descriptor builds, and 1,000 metadata value reads. Updating only `class`
records no additional descriptor build, value read, or native-list publication;
updating one `item-key` records one of each row-scoped operation.

This is a decoded production-bundle and deterministic-work receipt, not native
timing or memory evidence. The checked budget was already red in the baseline:
preview MTS gzip was 101,784 B against an 82,070 B ceiling; the candidate was
101,820 B. R9/R11 still require the wider bundle debt and LepusNG/device create,
ready, interaction, clear, memory, and GC gates to be resolved separately.
