# M3 compact first-screen program adoption

- Issue: #290
- Merged base: `new-lynx@f001e85e7aac1b1c35b11af244128fa3ad6c108c`
- Exact-clean implementation and measurement head:
  `8530ed669f8ed675449fd85b12b239dce2d86d40`

## Result

The compact store can now take ownership of an accepted, range-free resident
program run that the direct first-screen path already painted. Adoption aliases
the existing member-major node table and retains the frame's selected scalar
values; it does not create, attach, remove, or rewrite a host. A successful
commit transfers teardown ownership to the store, while rollback drops the
speculative handles and listener cursor without removing the first-screen tree,
so the ordinary adoption path can retain or retry it.

Compact instance handles are not first-screen logical host IDs. The store keeps
the accepted run's `firstId` and `stride` beside its eventful value table, so a
later hide/show reconstructs the exact event token the first screen installed
instead of silently replacing its stale-event identity with a compact handle.
The listener seed is explicit and transactional: a run whose first listener
does not equal the compact cursor rejects before ownership publishes.

This is not the shipping receiver yet. The current product does not call the
adoption entry point, and the linkage harness cannot execute an ablated
receiver. No startup, update, memory, or cleanup-cycle improvement is claimed.

## Failed first implementation

The first exact-clean implementation at
`88d73c93314d1c50aee9bb27d105c6720f19b3a6` returned a prepared object from a
shared validator for every RUN. That moved an allocation onto the compact paint
path and measured **81,743 gzip**, 258.5 bytes over the 81,484.5-byte gate. Its
receipt SHA-256 is
`bea8b567c258166cde82d7208278c2993e41c19b5a31d797d2a6bf1a6a88d058`.
It is retained as a failed control, not counted as progress.

The final implementation uses one allocation-free mount/adopt executor. It
performs no row-scale PAPI inspection during adoption: attachment and layout
were already established by the direct first-screen mount and the addressed
manifest comparison. Compiler-emitted event-layout diagnostics still run once
per plan in development, while production trusts the build-proven resident
plan and keeps all wire values, handles, arities, listener identity, range
scope, and host mutations checked. These changes recover 312 gzip bytes from
the failed implementation.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-first-screen-seed-8530ed669.json
```

Raw receipt SHA-256:
`83cb7b78886654f866f943143a057a2c1e893328580331b69c6454e95a95a992`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, a clean source tree, an empty receiver-isolation failure list,
and all production core/backend controls passing. The product linkage harness
cannot execute its ablated receiver, so `checksumRan` is false and the bytes
are not semantic or runtime evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,883 | 159,979 | 134,076 | 105,699 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,670 | 76,875 | 65,840 | 22,481 | 53,952 |
| first-screen-adoptable foundation + store + router | 245,691 | **81,431** | 69,871 | 27,006 | 53,952 |

The final frontier is **1.499x** the frozen 54,323-byte comparator median and
**53.5 bytes below** the M3 gate. BTS is byte-identical in all four arms at
SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
The baseline MTS is also unchanged from the preceding slice at SHA-256
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`.
The exact frontier artifact identity is
`b72c400b910fb041147b838e297dd8e9cdcba9ac17f9acd9757338786ad257f4`.

## Verification and remaining work

The focused store/router suite proves that adoption performs no host writes,
publishes dense handles, applies later scalar updates, preserves non-equal
logical-host/compact-handle event identities across hide/show, rolls back
without removing the first-screen tree, retries the same handles/listeners,
rejects listener and node-arity disagreement, and removes adopted roots after a
committed disposal. Full Lynx and current-head CI results are recorded on the
PR and issue.

Frame-to-first-tree matching, nested range ownership/application,
transport/ACK/controller integration, fallback and terminal cleanup across the
shipping lifecycle, external-consumer proof, and the default-build Native
timing/memory matrix remain open.
