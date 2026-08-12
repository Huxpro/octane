# Element PAPI speed-of-light floor @ 10,000 rows

- measured: 2026-08-12T19:39:58.660Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.5-fc-v20; Node v22.22.2
- protocol: fresh page per sample; probe and octane control/profile cells interleave AB/BA in one window; probe phases are outer-timed bare public-PAPI loops in the same main-thread realm
- host load: start 0.31/0.43/0.49 (1/5/15m), end 1.89/0.84/0.63
- repetitions: n=5 per cell

## Bare-PAPI floor (outer-timed, same shape as one table row × N)

Single flush vs chunked (flush every ⌈rows/10⌉ appends, mirroring the ~10
incremental BTS→MTS batches octane applies).

| phase | single median ms | chunked median ms |
|---|---:|---:|
| factoriesMs | 556 | 510.2 |
| propsMs | 57.7 | 63 |
| eventsMs | 24.2 | 23.5 |
| treeMs | 209.8 | 219.2 |
| flushReturnMs | 0.1 | 0 |
| presentMs | 1404 | 1416.3 |
| totalMs | 2183.8 | 2190.1 |
| armToComposedMs | 2193.3 | 2200.2 |

## Octane in the same window

Raw create: control 1145.5 ms, profile 1221.7 ms.

| octane stage | median ms |
|---|---:|
| bg_replay | 153.2 |
| wire_clone_transfer | 3.7 |
| mt_validate | 11.8 |
| mt_expand | 0 |
| mt_prepare | 4.4 |
| papi_element_creation | 561.5 |
| mt_apply_other | 344.3 |
| mt_ack_publication | 0.6 |
| presentation_residual | 145.9 |

## Floor vs Octane

- probe factories (70000 elements): 556 ms vs octane papi_element_creation 561.5 ms
- probe props+events+tree: 291.7 ms vs octane mt_apply_other 344.3 ms
- probe total (arm→composed): 2193.3 ms vs octane create wall 1145.5 ms

## Verdicts

- **papi_element_creation collapsible share: NO-GO.** Floor is 99.0% of the stage; collapsible 5.5 ms = 0.5% of the create wall (owner gate: ≥10%). The factory calls themselves are host cost; only fewer calls change it.
- **mt_apply_other collapsible share: NO-GO.** Floor-equivalent props+events+tree is 84.7% of the stage; collapsible 52.6 ms = 4.6% of the create wall.
- **Flush batching: NO-GO.** Single-flush total 2183.8 ms vs chunked 2190.1 ms.
- Observation: the probe's one-shot foreign-task mutation pays 1404 ms of post-flush presentation versus octane's 145.9 ms message-paced residual; this is renderer scheduling, not octane machinery, and does not enter the stage-floor comparison above.
