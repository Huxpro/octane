# Lynx 10,000-row stage decomposition

- measured: 2026-08-18T11:48:22.145Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.5-fc-v20; Node v22.22.2; Chromium 141.0.7390.37
- protocol: fresh page per operation sample; control/profile order alternates AB/BA; one vue-vdom create/replace/append triplet follows each pair; no other benchmark process ran in this window
- host load: start 0.28/0.22/0.23 (1/5/15m), end 1.42/0.64/0.38
- repetitions: n=5 per A/B cell

## FCP@10000

Attribution starts when the shared browser hook assigns the hidden main-thread iframe Blob script URL, before load/parse/evaluation, and ends when the shared composed-tree observer first sees all 10,000 rows. `layout_flush_residual` is the exclusive remainder after directly observed slice evaluation, plan interpretation, and PAPI element creation; it includes PAPI prop/insertion work, `__FlushElementTree`, Web Core DOM publication, style/layout, and observer-frame delay because the host exposes no stable boundary between those costs.

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| mt_slice_eval | 18.7 | 18.5–22.6 | 1.1% |
| plan_interpretation | 111.5 | 106.4–117 | 6.8% |
| papi_element_creation | 476.6 | 435.1–530 | 28.9% |
| layout_flush_residual | 1010.1 | 960.8–1084 | 61.3% |

Raw view-attach FCP: profile 1681.4 ms (1591.3–1727.1), control 1590.4 ms; same-window profile/control 1.057×.

## create@10000

Attribution starts at the shared pointerdown boundary and ends when the shared composed-tree observer sees 10,000 rows. All named intervals are directly observed and exclusive; `presentation_residual` is the wall-clock remainder through final composed-tree presentation.

| segment | median ms | min–max ms | share |
|---|---:|---:|---:|
| bg_replay | 138.7 | 136.9–158.1 | 11.9% |
| wire_clone_transfer | 4 | 3.5–4.9 | 0.3% |
| mt_validate | 11.2 | 10.9–12.6 | 1.0% |
| mt_expand | 0 | 0–0.1 | 0.0% |
| mt_prepare | 4.2 | 4.1–5.4 | 0.4% |
| papi_element_creation | 582.9 | 547.8–618.4 | 50.0% |
| mt_apply_other | 290.3 | 282.9–317.3 | 24.9% |
| mt_ack_publication | 0.8 | 0.6–1.1 | 0.1% |
| presentation_residual | 141.6 | 101.2–153.3 | 12.1% |

Raw create: profile 1165.9 ms (1125–1232.3), control 1105.2 ms, vue-vdom 1351.3 ms; same-window profile/control 1.055×, profile/vue-vdom 0.863×.
Wire: MTS→BTS 19,599 B / 15 messages; BTS→MTS 347,190 B / 10 messages.

## replace@1k

| segment | median ms | share |
|---|---:|---:|
| bg_replay | 36.8 | 12.1% |
| wire_clone_transfer | 2.4 | 0.8% |
| mt_validate | 7.8 | 2.6% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 55.5 | 18.3% |
| papi_element_creation | 52.5 | 17.3% |
| mt_apply_other | 80.7 | 26.6% |
| mt_ack_publication | 33.9 | 11.2% |
| presentation_residual | 42.2 | 13.9% |

Raw replace: profile 303.4 ms, control 299.8 ms, vue-vdom 166 ms. Wire: MTS→BTS 1,999,043 B / 4 messages; BTS→MTS 376,436 B / 1 messages.

## append@1k

| segment | median ms | share |
|---|---:|---:|
| bg_replay | 25 | 14.7% |
| wire_clone_transfer | 0.3 | 0.2% |
| mt_validate | 1 | 0.6% |
| mt_expand | 0 | 0.0% |
| mt_prepare | 14.6 | 8.6% |
| papi_element_creation | 46.2 | 27.1% |
| mt_apply_other | 37.8 | 22.2% |
| mt_ack_publication | 27.2 | 16.0% |
| presentation_residual | 19.9 | 11.7% |

Raw append: profile 170.2 ms, control 167.1 ms, vue-vdom 134.7 ms. Wire: MTS→BTS 1,713,065 B / 4 messages; BTS→MTS 34,956 B / 1 messages.

## Verdicts

- **#47 wire/encoding candidate: NO-GO.** clone/transfer is 0.3% of create, 0.8% of replace, and 0.2% of append; it does not clear the 10% owner gate.
- **#47 measured CPU owner: SPLIT.** PAPI creation plus remaining host apply is 74.9% of create. This is a host materialization owner, not evidence for changing the wire representation.
- **#47 acknowledgement-only candidate: NO-GO for issue acceptance.** ACK/publication is 0.1% of create, 11.2% of replace, and 16.0% of append; even a complete removal cannot meet the required 15% in all three cells or the 50% total-wire gate.

