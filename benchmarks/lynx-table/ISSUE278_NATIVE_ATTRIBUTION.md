# Issue #278 — Native create attribution

- Octane: `7ae87beebb4b5c240b01659d35d9636f8036d24b`
- driver: `4c69193c7ff63db5a2f4c1ec31138b3c4b4ea1d9`
- device cohort: `8537de9593a9a77f`; one Explorer lifecycle per sample
- real path: `mount-template-run`; scalar capability: `mount-program-run`

## Qualification and overhead

| arm | wall median ms | min–max ms |
|---|---:|---:|
| controlChecked | 9507 | 9454–9554 |
| timelineChecked | 9496 | 9440–9534 |
| timedChecked | 9451 | 9442–9522 |

Paired overhead: timeline/control 0.999×; timed/control 0.999×; ±5% gate **passed**. Paired timed MTS-apply/control-wall share: 96.4%.

## Scale sweep

| rows | wall ms | MTS apply ms | apply share | validate checked/trusted ms | prepare ms | BTS encode ms | wire bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 9507 | 9175 | 0.965 | 6/0 | 20 | 7 | 33779 |
| 2000 | 35937 | 35281 | 0.982 | 12/0 | 39 | 15 | 67728 |
| 3000 | 79454 | 78465 | 0.988 | 17/0 | 57 | 21 | 101799 |

Scaling exponents over 1k/2k/3k: wall 1.931, MTS apply 1.952, MTS prepare 0.954, BTS encode 1.011, wire bytes 1.004.

## Floors and controls

At 1k, MTS apply is 7.264× the detached PAPI floor. Bridge is 0× the same-size echo floor at 1 ms clock resolution. BTS/MTS VM calibration is 154.602×/257.486× Node V8.

Real commits used flags=0 in 15/15 checked samples; receiver restore max 0 ms. No-restore verdict: **verified**.

Validation-tier paired wall ratios are 1000: 0.999×, 2000: 1×, 3000: 0.996×.

## Attribution verdict

**verified: mtsApply.** It accounts for 96.4% of the 1k shipping-control wall and scales with exponent 1.952. This report changes no sequence and authorizes no optimization by itself.

Create@5k completed at 220150 ms checked and 221224 ms trusted (0.995×). It is recorded only as a capacity boundary, not as an improvement.

## Shipping-control trace

The lossless trace spans 10183.187 ms from Issue278::create-start [slice id: 7077] to Issue278::commit-ack [slice id: 288103].

LepusClosureEventListener::Invoke [slice id: 7110] occupies 9888.838 ms and has 8448.904 ms aggregate self time. FiberFlushElementTree [slice id: 111655] is 870.21 ms; TemplateAssembler::RequestLayout [slice id: 250824] is 272.37 ms. This independently localizes the owner to main-thread Lepus event application, not transport or codec.

The trace uses the shipping-control bundle but requires host debug tracing. Its duration is attribution evidence only and is not used as a benchmark point or speedup claim.

## Runtime-switch control

The host advertises `enable_v8`, but all 3 daemon/direct attempts failed and read back `false`, including with debug mode enabled. The final device state was restored. Runtime-paired attribution is therefore **unavailable**, and no runtime label was inferred.
