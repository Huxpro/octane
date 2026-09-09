# M3 compact compiled-program events

- Issue: #290
- Merged base: `new-lynx@99bf399c12ef01c2c654aa92a75b17bb4eb1a288`
- Exact-clean implementation and measurement head:
  `4799e25e713e4996120c88e765310c0c32343142`

## Result

The compact store now mounts event-bearing, range-free compiled programs without
adding an event payload to the version-2 RUN frame. Together with the streaming
router and complete reusable non-host foundation, the production linkage arm is
**81,211 bytes gzip**, or **1.495x** the frozen 54,323-byte comparator median.
It is **273.5 bytes** below the 81,484.5-byte M3 relative-size gate.

This is a net reduction while adding required semantics. The prior range- and
event-free frontier was 81,467 gzip. Event support before production diagnostic
folding measured 81,894 gzip (+427); guarding the compact store/router's
validation diagnostics behind the existing production flag recovers 683 gzip,
leaving the event-capable result 256 gzip below the prior frontier. Development
messages and the production `OL484`/`OL485` identifiers are unchanged.

The shipping product still does not import this replacement and remains exactly
160,511 gzip. Range sites, MOVE/CLEAR/VIS, first-screen adoption, transport and
ACK settlement, controller lifecycle, background compact-handle metadata, and
external-consumer/default-path proof remain open. The 273.5-byte margin is not
enough for them, so this result is not M3 completion.

## Event identity contract

The existing Block producer already reserves listener IDs densely for every
compiled event site, including a conditional site whose current handler is
null. The compact receiver mirrors that contract:

- both threads start listener allocation at 1 and advance by
  `plan.events.length * count` for every accepted RUN;
- the instance handle is the native token's stale-event identity. A compiled
  instance has fixed structure and only the whole instance can be removed, so
  an event host cannot outlive or leave independently of that handle;
- generation is 1 because version-2 handles are monotonic and never reused;
- the resident plan supplies each site's priority and emitted driver position;
- an aborted frame restores both instance and listener allocation before retry;
- incoherent event slot/node/priority metadata rejects before the plan is bound
  or any host operation runs.

The emitted `.run` driver receives one token per site and performs the existing
conditional `setEvent` call. A null conditional handler still has a derivable
listener ID but no live background binding, so delivery is rejected as unknown,
matching the independent Block-root contract. The handler closure itself never
crosses the wire.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-event-frontier-4799e25e7.json
```

Final raw receipt SHA-256:
`49a7e7c143b41e7ddd93e0081fc6b873d519046c91be7302239e56b6e2ff1c97`.
The pre-folding control receipt is SHA-256
`2c8c7f56124b7d057a8edd8f08be94ad55427ba491bbb397a12f8ff6be5cc901`
at exact-clean head `e0026705dc645f1888bdb219de9971e5dafa9606`.

Both receipts record tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, an empty receiver-isolation failure list, and all four
production core/backend controls passing for every arm. Product linkage probes
cannot execute their ablated receiver, so `checksumRan` is false and no runtime
semantic or latency claim is derived from them.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 418,005 | 160,511 | 134,730 | 106,320 | 53,880 |
| receiver-free | 223,390 | 70,448 | 60,438 | 15,927 | 53,880 |
| event-capable foundation + store + router | 246,527 | **81,211** | 69,722 | 26,928 | 53,880 |

Every BTS program is byte-identical at 187,742 raw / 53,880 gzip and SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`,
so the MTS reduction did not transfer cost to the background thread. The current
product reproduces the prior exact identities: complete
`536f12776f15acee80e191e9075f64af830cedf606beebbf04c7d41fed5e640e`,
BTS `0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`,
and MTS `4735539a230bdf15a1bfd980499086751a998ab70fa46fe1e3d6253a57427684`.

## Verification

- emitted-driver store/router focused suite: 25/25;
- full Lynx project: 52 files, 910/910 tests;
- event tokens independently decoded for root, instance, generation, listener,
  and priority across a dense run, rollback/retry, remove, and later mount;
- malformed event metadata is rejected before driver binding or host mutation;
- all three Lynx TypeScript configurations pass;
- all existing store rollback, terminal cleanup, SET, REMOVE, and frame
  transaction assertions remain green;
- production diagnostic folding is measured from real production bundles, not
  inferred from source text.

No Native/Web startup, FCP, first-tap, steady-state latency, memory,
cleanup-cycle, controller, or consumer-default benefit is claimed. Those require
a shipping consumer and remain M3 work.
