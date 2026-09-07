# Lynx 10,000-row stage decomposition

- measured: 2026-09-07T16:59:13.764Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2; Chromium 149.0.7827.55
- protocol: fresh page per operation sample (each mutation cell re-creates its own table first); control/profile order alternates AB/BA; one vue-vdom pass over create/replace/append/update10th/updateStorm/select follows each pair; no other benchmark process ran in this window
- host load: start 1.13/0.68/0.71 (1/5/15m), end 2.06/1.66/1.11
- repetitions: n=5 per A/B cell

## FCP@10000

Attribution starts when the shared browser hook assigns the hidden main-thread iframe Blob script URL, before load/parse/evaluation, and ends when the shared composed-tree observer first sees all 10,000 rows. The framework's current render, publish, capture, and announce phases are directly timed. Nested plan, command-stage, and PAPI-create intervals are subtracted from their enclosing phases. `presentation_predicate_residual` is the exclusive remainder through Web Core presentation, style/layout, and observer-frame delay.

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| mt_slice_eval | 26.9 | 26.8–28.1 | 2.4% |
| plan_interpretation | 56.6 | 56.3–59.3 | 5.0% |
| first_screen_render_other | 14.2 | 14–16.3 | 1.3% |
| first_screen_command_staging | 0 | 0–0 | 0.0% |
| papi_element_creation | 362.5 | 327.6–389 | 31.9% |
| first_screen_publish_other | 569.7 | 562.4–591.9 | 50.2% |
| first_screen_capture | 24.1 | 23–41.4 | 2.1% |
| first_screen_announce | 0 | 0–0.1 | 0.0% |
| presentation_predicate_residual | 82.9 | 70.2–87.4 | 7.3% |

Raw view-attach FCP: profile 1162.2 ms (1152.5–1194.1), control 1146.9 ms; same-window profile/control 1.013×.

## create@10000

Attribution starts at the shared pointerdown boundary and ends when the shared composed-tree observer sees 10,000 rows. All named intervals are directly observed and exclusive; `presentation_residual` is the wall-clock remainder through final composed-tree presentation.

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| bg_prepare | 165.3 | 159.6–175.3 | 16.3% |
| bg_replay_other | 4.6 | 4.5–5.5 | 0.5% |
| wire_clone_transfer | 0.8 | 0.7–0.9 | 0.1% |
| mt_validate | 1 | 0.9–1.2 | 0.1% |
| mt_expand | 0 | 0–0.1 | 0.0% |
| mt_prepare | 4.7 | 4.3–5.7 | 0.5% |
| papi_element_creation | 354.7 | 348.9–359.2 | 34.9% |
| mt_apply_other | 362.1 | 359.7–367 | 35.6% |
| mt_ack_publication | 0.6 | 0.4–0.7 | 0.1% |
| presentation_residual | 119 | 118–121 | 11.7% |

Raw create: profile 1015.8 ms (1012.2–1023.4), control 997.6 ms, vue-vdom 1422.2 ms; same-window profile/control 1.018×, profile/vue-vdom 0.714×.
Wire: MTS→BTS 11,102 B / 15 messages; BTS→MTS 408,391 B / 20 messages.
Background work: 10,000 row-body renders over 1 replay drains, reconciling 20,028 child blueprints, producing 69 host commands (144.9 per command).

## replace@1k

| segment | median ms | share |
|---|---:|---:|
| bg_prepare | 26.8 | 12.7% |
| bg_replay_other | 0.3 | 0.1% |
| wire_clone_transfer | 0.1 | 0.0% |
| mt_validate | 0.2 | 0.1% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 42.4 | 20.2% |
| papi_element_creation | 32.6 | 15.5% |
| mt_apply_other | 60.1 | 28.6% |
| mt_ack_publication | 21.8 | 10.4% |
| presentation_residual | 25.7 | 12.2% |

Raw replace: profile 210.4 ms, control 207.6 ms, vue-vdom 179.8 ms. Wire: MTS→BTS 1,328,955 B / 39 messages; BTS→MTS 41,202 B / 2 messages.
Background work: 1,000 row-body renders over 1 replay drains, reconciling 2,028 child blueprints, producing 2 host commands (500 per command).

## append@1k

| segment | median ms | share |
|---|---:|---:|
| bg_prepare | 31.7 | 22.2% |
| bg_replay_other | 0.3 | 0.2% |
| wire_clone_transfer | 0.1 | 0.1% |
| mt_validate | 0.3 | 0.2% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 11.1 | 7.8% |
| papi_element_creation | 34.1 | 23.8% |
| mt_apply_other | 46.5 | 32.5% |
| mt_ack_publication | 0.9 | 0.6% |
| presentation_residual | 16.6 | 11.6% |

Raw append: profile 143.1 ms, control 139.5 ms, vue-vdom 159.9 ms. Wire: MTS→BTS 1,213 B / 5 messages; BTS→MTS 41,329 B / 3 messages.
Background work: 3,000 row-body renders over 1 replay drains, reconciling 3,028 child blueprints, producing 1 host commands (3000 per command).

## update10th@10k

| segment | median ms | share |
|---|---:|---:|
| bg_prepare | 72.7 | 41.5% |
| bg_replay_other | 0.5 | 0.3% |
| wire_clone_transfer | 0.2 | 0.1% |
| mt_validate | 1 | 0.6% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 10.6 | 6.1% |
| papi_element_creation | 0 | 0.0% |
| mt_apply_other | 11.5 | 6.6% |
| mt_ack_publication | 7.4 | 4.2% |
| presentation_residual | 70.6 | 40.3% |

Raw update10th: profile 175 ms, control 176 ms, vue-vdom 127.4 ms. Wire: MTS→BTS 285,925 B / 10 messages; BTS→MTS 105,248 B / 3 messages.
Background work: 1,000 row-body renders over 1 replay drains, reconciling 11,028 child blueprints, producing 1,000 host commands (1 per command).

## updateStorm@10k

| segment | median ms | share |
|---|---:|---:|
| bg_prepare | 72.5 | 13.1% |
| bg_replay_other | 0.9 | 0.2% |
| wire_clone_transfer | 0.7 | 0.1% |
| mt_validate | 2.3 | 0.4% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 27.6 | 5.0% |
| papi_element_creation | 0 | 0.0% |
| mt_apply_other | 37 | 6.7% |
| mt_ack_publication | 25.2 | 4.6% |
| presentation_residual | 387.5 | 70.2% |

Raw updateStorm: profile 551.7 ms, control 539.8 ms, vue-vdom 1648.6 ms. Wire: MTS→BTS 1,142,743 B / 37 messages; BTS→MTS 364,284 B / 12 messages.
Background work: 4,000 row-body renders over 1 replay drains, reconciling 11,028 child blueprints, producing 4,000 host commands (1 per command).

## select@10k

| segment | median ms | share |
|---|---:|---:|
| bg_prepare | 52.5 | 72.3% |
| bg_replay_other | 0.2 | 0.3% |
| wire_clone_transfer | 0 | 0.0% |
| mt_validate | 0 | 0.0% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 0.2 | 0.3% |
| papi_element_creation | 0 | 0.0% |
| mt_apply_other | 0.2 | 0.3% |
| mt_ack_publication | 0.2 | 0.3% |
| presentation_residual | 18.5 | 25.5% |

Raw select: profile 72.6 ms, control 75.3 ms, vue-vdom 60.6 ms. Wire: MTS→BTS 1,019 B / 3 messages; BTS→MTS 362 B / 1 messages.
Background work: 1 row-body renders over 1 replay drains, reconciling 10,029 child blueprints, producing 1 host commands (1 per command).

## Verdicts

- **#66 A4/A5 delta-encoding candidate (pure-mutation cells): NO-GO.** mt_prepare plus clone/transfer is update10th 6.2% (mt_prepare 10.6 ms of 175 ms), select 0.3% (mt_prepare 0.2 ms of 72.6 ms). The gate is 10% in every pure-mutation cell, because a typed delta plus slot dispatch can only remove host prop-patch planning and wire cost; it cannot touch PAPI apply.
- **#66 Phase 2 re-aim: background update-drain owner: GO.** bg_prepare is update10th 41.5% with 1,000 row-body renders and 11,028 reconciled child blueprints for 1,000 host commands, select 72.3% with 1 row-body renders and 10,029 reconciled child blueprints for 1 host commands. The gate is 10% in every cell named here. Both counts are deterministic for this app and interaction, and they disagree: row renders already track the change while reconciled blueprints track the list, so where the drain owns the frame the remaining cost is traversal rather than render breadth. The blueprint count is the number a candidate has to move.
- **#47 wire/encoding candidate: NO-GO.** clone/transfer is 0.1% of create, 0.0% of replace, and 0.1% of append; it does not clear the 10% owner gate.
- **#47 measured CPU owner: SPLIT.** PAPI creation plus remaining host apply is 70.6% of create. This is a host materialization owner, not evidence for changing the wire representation.
- **#47 acknowledgement-only candidate: NO-GO for issue acceptance.** ACK/publication is 0.1% of create, 10.4% of replace, and 0.6% of append; even a complete removal cannot meet the required 15% in all three cells or the 50% total-wire gate.
