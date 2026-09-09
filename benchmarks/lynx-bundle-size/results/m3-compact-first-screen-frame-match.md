# M3 compact first-screen proof streaming

- Issue: #290
- Merged base: `new-lynx@1e161b23350b1884e8e70f87f2e2ce58ef7807f5`
- Exact-clean implementation and measurement head:
  `70b3d4e8baede08b694e2193bacb946c50a29db6`

## Result

The compact store can now be constructed with a resolver for an accepted
first-screen program seed keyed by compact `firstHandle`. The shipping
controller will build that resolver from the existing
`compareProgramAdoptionRuns` result, which already proves build address,
layout, count, listener identity, and selected scalar values. The streaming
frame router remains the single RUN decoder: its ordinary `mount` call asks the
store for the proof associated with that exact handle, and the store's shared
allocation-free executor adopts the retained member-major nodes instead of
painting them again.

This placement is deliberate. Repeating the address/value comparator inside
the frame duplicated an accepted proof and exceeded the frozen bundle gate.
Keeping the proof resolver at store construction makes adoption a receiver
policy rather than a second RUN path, so every frame operation retains the
existing decode, transaction, and rollback boundary. Handle-keyed lookup is
also retry-idempotent: a rejected or later-malformed frame asks for the same
proof again without an external iterator or a second journal cursor.

The seed supplies only main-local physical identity: first logical host ID,
stride, listener ID, and nodes. The store still validates frame handles/count,
scalar slot kinds, node arity, listener cursor, supported range scope, and host
mutations. A missing seed takes the ordinary paint path; a supplied proof for a
non-append RUN rejects. Any later malformed opcode rolls back
DEFINE/handles/listeners and releases speculative store ownership without
removing the painted tree; the exact frame can retry.

This slice does not yet connect `compareProgramAdoptionRuns` to the store
constructor, nor transfer the source first-tree container in the shipping
controller. The linkage harness cannot execute an ablated receiver, so no
startup, update, memory, or cleanup-cycle improvement is claimed.

## Measurement correction and failed controls

The first recorded 81,481-byte result at
`b3d6af08ebde1a81534d8e6a7b20812b41e84a1d` was invalid as linkage evidence:
the synthetic frontier called the frame with four arguments, so production
tree-shaking removed the optional adoption branch. Receipt SHA-256
`6f1bd842a7a62029e968287a3262fbc637df41b9ed0013ea394f90d7551f32ad`
is retained only as evidence of that harness blind spot and is not used below.

After the harness made the adoption path genuinely reachable, the duplicate
frame comparator measured **81,753 gzip**, 268.5 bytes over the gate, at
`ae1b3fa1eca904bd0555b4f3c8e9789ba0d1280c` (receipt SHA-256
`2dd1ff886d1fc1d5c4e36e873f71f19a20bb24def701d93e6465f5ebcd7f8ae6`).
Replacing it with a callback over the unique existing comparator still measured
81,563 gzip, 78.5 bytes over, at
`80f7d3ec6ebcc2c942df9978625c0889854b238b` (receipt SHA-256
`bc6b9492dd582d95eb3879b76b250cdcafcd0b47e8666ba25866478ab5d4698f`).
Neither failed frontier is counted as progress.

Moving the source to store construction removes the frame's parallel RUN
branch. A readonly sequential seed array with a separately snapshotted cursor
then measured **81,529 gzip**, 44.5 bytes over the gate, at
`6b644b58ab140e4e4ea3e515ef4391775c79f12c` (receipt SHA-256
`04bb7d8f48310ef2ad867915dea66fd42d0471960f675465516a5e52eaf1971f`).
Rewinding that cursor from adopted journal entries retained the same complete
gzip result at `c83ab8f527ec41cac05ebae64b1184d16332e31e` (receipt SHA-256
`639f50b5a5f2a15300fabf6b9ce10b00b2b8b997287d404a31bef8254e5fba18`).
Both cursor variants fail the gate and are not counted as progress. Keying the
resolver by immutable compact identity removes that lifecycle state; the final
result below is the first true-linkage, retry-safe implementation that passes.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-store-first-screen-resolver-70b3d4e8b.json
```

Raw receipt SHA-256:
`0bb062421bc3b64ac8b7c841d11819e3e4060cbd78a578db486e9b3a89cf9c9b`.
It records tool SHA-256
`efedeee99d650bee69eb0e0a30d6af8ac4ee49c8356e52334d13b260c256d010`,
Node `v22.22.2`, a clean source tree, an empty receiver-isolation failure list,
and all production core/backend controls passing. `checksumRan` is false in
this nonfunctional linkage harness, so the bytes are not semantic or runtime
evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,883 | 159,979 | 134,076 | 105,699 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,670 | 76,875 | 65,840 | 22,481 | 53,952 |
| store-resolved first-screen frontier | 245,769 | **81,456** | 69,962 | 27,036 | 53,952 |

The final frontier is **1.499475x** the frozen 54,323-byte comparator median,
**28.5 bytes below** the 81,484.5-byte M3 gate. Relative to the preceding
first-screen adoption slice, the true-linkage proof resolver costs 78 raw / 25
gzip / 91 Brotli bytes in the complete artifact and 30 gzip bytes in decoded
MTS.
Decoded BTS remains byte-identical across all arms at SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
The current-product MTS remains byte-identical at SHA-256
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`.
The frontier artifact SHA-256 is
`ec26878ed289a4cc94774505ed1650762145b86e601fd8a0d6d8e90ad1bfc6c1`.

## Verification and remaining work

Independent tests prove zero host writes through an ordinary frame RUN backed
by the store seed resolver, later SET/VIS, logical-ID/compact-handle event
identity, resolver miss restoring ordinary paint, listener mismatch refusal,
rollback after a fully adopted run when a later opcode is malformed, and exact
handle-keyed retry with the same DEFINE and handles. The focused store/router
suite passes 38/38; final full-project counts are recorded on the PR and issue.

Shipping-controller proof-source construction and source first-tree ownership
transfer, nested range application, transport/ACK/fallback/cleanup, external
consumer proof, and the default-build Native timing/memory matrix remain open.
Only 28.5 gzip bytes remain, so the next shipping slice must replace or repay
old receiver code rather than accumulating another parallel mechanism.
