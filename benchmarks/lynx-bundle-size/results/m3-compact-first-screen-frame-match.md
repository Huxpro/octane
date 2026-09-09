# M3 compact first-screen frame matching

- Issue: #290
- Merged base: `new-lynx@1e161b23350b1884e8e70f87f2e2ce58ef7807f5`
- Exact-clean implementation and measurement head:
  `b3d6af08ebde1a81534d8e6a7b20812b41e84a1d`

## Result

The compact frame router can now consume an ordered run-level proof retained
from the accepted first screen. Before giving the existing nodes to the store,
it requires the frame's freshly defined build address to resolve to the same
resident plan, the run count and selected scalar table to match, and the run to
append at the root site. The store then checks node arity and the transactional
listener cursor while publishing compact handles.

Adoption performs no create, insert, remove, or event write. Later SET and
visibility operations use the compact handles while event restoration retains
the first screen's distinct logical IDs and listener identities. Any address,
plan, count, value, listener, or trailing-proof disagreement rolls back the
whole frame: speculative template/handle/listener state disappears while the
painted tree remains attached for an exact retry or the future repair path.

A first-screen adoption frame must DEFINE its templates in that same initial
transaction. Reusing an existing template ID provides no address proof, and a
second address cannot alias the ID even when a resolver happens to return the
same plan object. This preserves the build address as part of the proof rather
than treating plan object equality as a substitute.

This slice does not yet transfer the source first-tree container or select the
compact receiver in the shipping controller. The linkage harness cannot execute
an ablated receiver, so no startup, update, memory, or cleanup-cycle improvement
is claimed.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-frame-first-screen-match-b3d6af08e.json
```

Raw receipt SHA-256:
`6f1bd842a7a62029e968287a3262fbc637df41b9ed0013ea394f90d7551f32ad`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, a clean source tree, an empty receiver-isolation failure list,
and all production core/backend controls passing. `checksumRan` is false in
this nonfunctional linkage harness, so the bytes are not semantic or runtime
evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,883 | 159,979 | 134,076 | 105,699 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,670 | 76,875 | 65,840 | 22,481 | 53,952 |
| frame-matched first-screen frontier | 245,820 | **81,481** | 69,898 | 27,063 | 53,952 |

The final frontier is **1.499936x** the frozen 54,323-byte comparator median,
**3.5 bytes below** the 81,484.5-byte M3 gate. Relative to the preceding
first-screen store slice, frame matching costs 129 raw / 50 gzip / 27 Brotli
bytes in the complete artifact and 57 gzip bytes in decoded MTS. Decoded BTS
remains byte-identical across all arms at SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
The current-product MTS also remains byte-identical at SHA-256
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`.
The frontier artifact SHA-256 is
`ea610e69fb3d81a6b9caa6ec32b45e706e7a7ada6ccd75fe02c0a4afef2f9080`.

The first exact-clean implementation at `b6eaecc08a59bbeb16a0fa6d9c176c1ee574cc06`
and the hardened final head above produced that same frontier artifact. The
second head additionally rejects template-address aliasing and selected-table
arity drift, so the stable artifact does not hide a cost transfer to BTS or a
different build arm.

## Verification and remaining work

Independent tests prove zero host writes during frame adoption, later SET/VIS,
logical-ID/compact-handle event identity, divergent address/value refusal,
same-template address-alias refusal, rollback after a fully adopted run when a
trailing proof is present, and exact retry with the same DEFINE and handles.
The focused store/router suite passes 38/38; the full Lynx project passes 52
files / 934 tests, and all three Lynx TypeScript configurations pass.

Source first-tree ownership transfer, nested range application,
transport/ACK/controller integration, fallback and terminal cleanup, external
consumer proof, and the default-build Native timing/memory matrix remain open.
With only 3.5 gzip bytes of headroom, the next shipping slice must replace or
repay old receiver code rather than accumulating another parallel mechanism.
