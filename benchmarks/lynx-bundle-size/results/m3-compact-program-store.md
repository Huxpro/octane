# M3 compact compiled-program store

Issue: #290  
Merged base: `new-lynx@14fe3eb39ea3a18679b3eb32cb1c4379659766c6`  
Store implementation: `4b9afad92bdcd85bcf0b605bae6dee08d0bda365`  
O(1) range-order self-review fix: `837abbe0870bda99b90b7fd9cc110b2a504bd551`

## Result

The first stateful piece of the replacement receiver fits the dependency
frontier established by #324. The store plus the complete reusable non-host
foundation is **79,951 gzip bytes**, or **1.472x** the contemporary 54,323-byte
comparator median. That leaves **1,533.5 bytes** below the frozen 81,484.5-byte
M3 gate for compact routing and settlement.

This is not a product cutover. The current product does not import the store,
and its complete artifact remains byte-identical at 160,511 gzip bytes. The
frontier arms below deliberately replace the general receiver with linkage
probes, so `checksumRan` is false and no functional or timing claim is made from
their size.

## Owned semantics

The store consumes the real compiler-emitted dense `.run` driver and the
explicit `.set(nodes, valueSlot, value)` primitive. It retains only the resident
plan, created node array, prior scalar values, parent, and O(1) doubly linked
per-parent instance order. Each resident plan binds the PAPI only once. The
store does not retain or interpret a host descriptor.

Every host-changing frame is transactional:

- instance identity and monotonic handles publish only after create and attach;
- SET validates the plan's value-slot kind in O(1), restores the prior value
  when a host setter mutates and throws, and permanently faults if that rollback
  also fails;
- REMOVE restores its exact parent/order even when the host removes first and
  throws afterwards;
- a mixed MOUNT/SET/REMOVE frame rolls back in reverse order, including the
  handle allocator, so the background may retry the same frame and handles;
- disposal rolls back an open frame, removes every retained root, and closes
  the store against later work.

The accepted scope is intentionally narrow: non-empty, range-free programs with
an emitted dense driver; value slots require the generated setter. MOVE,
CLEAR, VIS, range-site addressing, event-token routing, first-screen adoption,
transport dispatch, ACK/reject messages, and the controller/lifecycle shell are
not claimed by this slice.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-papi,receiver-store,receiver-foundation-lite,receiver-foundation-store \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-store-frontier-exact.json
```

The final exact-clean receipt and its SHA-256 are recorded after this report is
committed. Every preliminary arm reproduced the prior product identities and
passed all four production core/backend controls.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 418,005 | 160,511 | 134,730 | 106,320 | 53,880 |
| receiver-free | 223,390 | 70,448 | 60,438 | 15,927 | 53,880 |
| PAPI/page | 226,919 | 72,013 | 61,714 | 17,488 | 53,880 |
| PAPI/page + compact store | 231,883 | 74,454 | 63,860 | 19,986 | 53,880 |
| non-host foundation | 238,884 | 77,483 | 66,399 | 23,202 | 53,880 |
| non-host foundation + compact store | 243,919 | **79,951** | 68,699 | 25,661 | 53,880 |

The isolated store costs 2,441 gzip bytes over the PAPI/page arm. Shared
compression makes the foundation union cost 2,468 bytes over
`receiver-foundation-lite`. Every BTS artifact is byte-identical at SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`,
so no receiver cost moved to the background thread.

The current product identities reproduce #325 exactly:

- complete: `536f12776f15acee80e191e9075f64af830cedf606beebbf04c7d41fed5e640e`;
- BTS: `0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`;
- MTS: `4735539a230bdf15a1bfd980499086751a998ab70fa46fe1e3d6253a57427684`.

## Verification

- generated store integration and injected fault suite: 11/11;
- emitter + store + diagnostic boundary focused suite: 75/75;
- full Lynx project: 51 files, 895/895 tests;
- all three `@octanejs/lynx` TypeScript configurations pass;
- package diagnostic identifiers remain complete and unique through `OL484`;
- `pnpm sync`, scoped formatting, and diff checks pass.

No Native/Web latency, memory, first-paint, update, or cleanup-cycle benefit is
claimed. Those require a real production consumer and remain M3 work.
