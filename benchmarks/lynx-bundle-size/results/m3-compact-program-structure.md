# M3 compact compiled-program structure operations

- Issue: #290
- Merged base: `new-lynx@0aba09ce2d849341ca445c4a254568cdd8ff108e`
- Exact-clean implementation and measurement head:
  `4ed4c7f677b6dce5ae31fd1ce799625f2d1bceb4`

## Result

The compact range-free receiver now applies root-level `MOVE`, `CLEAR`, and
`VIS` frames in the same transaction as `RUN`, `SET`, and `REMOVE`. The complete
event-capable non-host foundation, store, and streaming router measure
**81,417 bytes gzip**, or **1.499x** the frozen 54,323-byte comparator median.
That is **67.5 bytes below** the 81,484.5-byte M3 relative-size gate.

This slice adds the required root structure semantics while removing resident
state: compact handles now address anchors directly, the reverse root-node
`WeakMap` and public root lookup are gone, and a run retains only its listener
offset rather than its event-token array. The emitted setter also owns direct
event writes through negative slots, so visibility restoration does not retain
parsed event tuples or a generic event binder.

The shipping product remains byte-identical to the preceding diagnostic slice
at 159,902 bytes gzip. The replacement is still a nonfunctional linkage arm:
nested range addressing, first-screen adoption, transport and acknowledgement
settlement, controller lifecycle, background metadata, cleanup, and a real
consumer-default cutover remain open. The 67.5-byte margin is not a budget for
those missing semantics, so this is not M3 completion.

## Structure and fault contract

- `MOVE` validates that both handles belong to the root range, mutates the
  native host, then publishes linked-list order. A mutate-then-throw host is
  restored to the prior anchor before the frame is rejected.
- `CLEAR` removes the root range through the same remove journal as individual
  `REMOVE` operations. A later frame failure restores every removed instance in
  order with its original handle and event identity.
- `VIS 0` removes native event bindings before marking the instance hidden;
  `VIS 1` clears the hidden attribute before reinstalling deterministic tokens.
  Both directions restore the prior state on a host failure, and a failed
  restoration faults the store rather than accepting divergent state.
- Event-only programs receive an emitted setter even with no value slots.
  Non-negative setter slots remain value indices; `~eventIndex` is the internal
  direct event route. Unknown negative slots fail closed.
- The frame router accepts only root-range addresses in this slice. Nested
  `UniversalProgramRange.slot` addressing is deliberately rejected instead of
  being misread as a physical node index.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-structure-4ed4c7f67.json
```

Raw receipt SHA-256:
`3630530d12c7c3da84440c7111b4a176c9858ca2d43c3fb0302510e89c75a416`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, an empty receiver-isolation failure list, and all production
core/backend controls passing for every arm. Product linkage probes cannot run
their ablated receiver, so `checksumRan` is false and no runtime semantic,
latency, or memory conclusion is derived from this measurement.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,743 | 159,902 | 134,153 | 105,699 | 53,880 |
| receiver-free | 221,736 | 69,971 | 60,050 | 15,418 | 53,880 |
| reusable non-host foundation | 236,530 | 76,801 | 65,806 | 22,481 | 53,880 |
| structure-capable foundation + store + router | 245,954 | **81,417** | 69,837 | 27,085 | 53,880 |

Every BTS program remains byte-identical at SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`.
The product artifact remains
`20777b1b608affb2e635d906f8c1c1d870b98aaad9603a210a0f74874ad58e49`,
and decoded MTS remains
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`.
The structure arm identities are
`7044c77ffb6038c1d6887f4df707ecf01ee33502dd688faaa97568db84f9734f`
for the complete artifact and
`4126e60ba666f4e455d22bbfdf863970606e848374c3ac5358f3cc8da34ef6df`
for decoded MTS.

## Verification

- focused emitter/store/router/backend-signature suites: 4 files, 95/95 tests;
- full Lynx project: 52 files, 917/917 tests;
- all three Lynx TypeScript configurations pass;
- focused emitter/store/router suites cover direct event writes, successful
  MOVE/CLEAR/VIS, no-op moves and visibility changes, invalid root addresses,
  frame rollback, retry, and mutate-then-throw host failures;
- event-only emission proves the negative event setter without relying on a
  value setter being present;
- all root structure operations retain deterministic instance and listener
  identities across rollback;
- production size comes from exact-clean real builds with unchanged BTS, not a
  source-text estimate.

No Native/Web startup, FCP, first-tap, steady-state latency, memory,
cleanup-cycle, controller, or consumer-default benefit is claimed.
