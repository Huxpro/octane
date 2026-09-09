# M3 Block range-slot provenance

- Issue: #290
- Merged base: `new-lynx@f72282bdfab2eb1a8f2cb6c5e57eaa14367a9c22`
- Exact-clean implementation and measurement head:
  `55eb8ce40a64393355785d5efbffe77e9e95ea99`

## Result

The compiled Block producer now passes the compiler plan slot into each keyed
range site. Nested `mount-template-run` and `move` commands retain that slot in
the same producer-local metadata introduced for the universal core; a legacy
hand-written `openForSlot(block, node)` call remains valid and supplies no
proof. No command-wire field was added.

`TABLE_PLAN` is the discriminating integration fixture: its keyed range is plan
slot 0 below physical host node 2. The emitted run and reorder move both report
slot 0, proving the producer did not substitute the node index. A sparse slot 7
also survives a rejected attempt and retry, while the old two-argument API
continues to report `undefined`.

The implementation repays its producer cost on the keyed hot path rather than
moving it to the main thread. Initial fill constructs its desired-key set in
one native operation. Reconcile reuses that set for departures instead of
allocating and filling a second matched-block set. The LIS predecessor buffer
is also reused as its stable-position bitmap, removing a second allocation.
These transformations preserve the final tree and survivor identity contract;
they do not change which physical survivors the LIS may choose to move.

This is producer infrastructure, not a receiver cutover. It does not seed the
compact store from the first screen, apply range frames in the shipping
controller, or change the default transport, so no latency or memory benefit is
claimed from the linkage measurement below.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-block-range-provenance-55eb8ce40.json
```

Raw receipt SHA-256:
`8b6d770b5efbd9a6777551a2cfd11fba8610e59a2ed790e74d277f3a87361838`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, a clean implementation tree, an empty receiver-isolation
failure list, and all production core/backend controls passing. This product
linkage harness cannot execute its ablated receiver, so `checksumRan` is false
and the bytes are not semantic or runtime evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,883 | 159,975 | 134,074 | 105,699 | 53,948 |
| receiver-free | 221,876 | 70,046 | 60,072 | 15,418 | 53,948 |
| reusable non-host foundation | 236,670 | 76,871 | 65,809 | 22,481 | 53,948 |
| range-ready foundation + store + router | 246,094 | **81,483** | 69,905 | 27,085 | 53,948 |

The complete range-ready frontier is **1.500x** the frozen 54,323-byte
comparator median and **1.5 bytes below** the 81,484.5-byte M3 gate. MTS remains
byte-identical to the preceding range-ready slice at SHA-256
`4126e60ba666f4e455d22bbfdf863970606e848374c3ac5358f3cc8da34ef6df`.
The exact product, BTS, and frontier artifact identities are respectively
`5e6496c2bc4ee5c6f1ca3464724a2a47ce992c737a57a2b6f0396743169920ed`,
`f7b52aaf6ba2cf2c64786796f6eb022ab929bf5537cc659f72eee7ca28c8e867`,
and `5c5478b853d955f9ec08818ca6cb3b51016020583c4a7ac20ea4ad96d27bf61c`.

## Verification

- compiled component plus Block core/differential suites: 4 files, 91/91 tests;
- full Lynx project after the final implementation: 52 files, 923/923 tests;
- full Lynx source, testing, and typetest typecheck;
- generated slot 0 is distinguished from physical host node 2;
- sparse slot 7 tags RUN and MOVE before encoding and survives abort/retry;
- old hand-written sites remain untagged rather than guessing provenance;
- keyed fill and reconcile retain duplicate-key diagnostics and painted-tree
  differential coverage after removing redundant successful-path work; and
- the production frontier keeps BTS isolated and MTS byte-identical across all
  receiver arms.

First-screen compact-store adoption, resident range validation, transport/ACK
settlement, controller lifecycle, cleanup, external-consumer fallback, and the
default-build Native performance acceptance remain open.
