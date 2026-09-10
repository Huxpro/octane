# M3 compact compiled-program wire

- Issue: #290
- Merged base: `new-lynx@b60570baf7d8c0fe890c01441e57b0fa1ddc11ba`
- Exact-clean implementation and measurement head:
  `c3fb1980982fc7dfe232a5774c779cea5429a8f6`

## Result

Compact v2 program frames now have an isolated, versioned ContextProxy channel
on both threads. Every crossing is a framed string, while the small outer
envelope is an internal scalar array and therefore avoids the general value
codec's recursive prepare/restore walk. The main receiver withholds its
correlated ready reply until authored modules have registered resident programs
and the host has installed PageConfig.

The executable background half settles exact root versions as `ack` then
`complete`, permits a rejected identity to retry, carries a racing abort before
its frame, and retries disposal without publishing incomplete native cleanup.
The main half routes those settlements through the page-local controller landed
in #342, so it never creates the general host container or overlaps native node
ownership.

With the complete generated slot-setter/structural-run producer and the general
first-screen evaluator absent, the actual compact main receiver frontier is
**81,445 bytes gzip = 1.4993x** the frozen 54,323-byte comparator median. It is
**39.5 bytes below** the 81,484.5-byte M3 gate. Outer framing, readiness, and
routing add 904 raw / 345 gzip / 369 Brotli bytes over the controller-only arm.

## Exact production frontier

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip | Headroom to gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current product | 417,301 | 160,178 | 134,237 | 105,730 | 54,128 | -78,693.5 |
| complete producer + controller, no evaluator | 246,403 | 81,100 | 69,412 | 26,401 | 54,128 | +384.5 |
| complete producer + compact main receiver | 247,307 | **81,445** | 69,781 | 26,716 | 54,128 | **+39.5** |

Decoded BTS is byte-identical in all arms at 188,359 raw / 54,128 gzip /
46,573 Brotli with SHA-256
`5761ed537a4b6d6155e14577cb4bf63bc2cdb1e247ee28c45ea7701690aad1f6`.
All production core/backend controls pass and the receiver-isolation failure
list is empty.

## Observable contract

The focused host-oracle suite observes:

- a ready request arriving during receiver installation does not release until
  both program registration and PageConfig gates have opened;
- an accepted RUN crosses only as strings, publishes one acknowledgement, then
  completes with the expected Element PAPI tree;
- a malformed trailing opcode rolls the whole frame back and the same root
  version succeeds on retry;
- an abort delivered ahead of an already-sent frame creates a receiver
  tombstone, rejects without native output, and preserves exact-identity retry;
- a payload beyond the proven 32,000-character ContextProxy envelope is split,
  delivered as ordered string frames, and applied only after reassembly; and
- a failed native cleanup yields `dispose-retry`; the background resends and
  resolves only after the page owns no nodes.

The repository-wide transport-conformance gate now counts both compact send and
receive sites. It proves every send loops over the common frame splitter and
every `event.data` read enters the frame materializer before the compact array
decoder. The compact scalar domain also rejects `NaN` and infinities before
JSON can silently rewrite them to `null`.

## Scope and non-claims

The L5 arm replaces only the general **main-thread** receiver. The compact
background transport is independently executable in the focused suite, but is
not yet selected by `root.ts`; the product arm therefore retains today's BTS
byte-for-byte and does not price the later background cutover. Likewise, the arm
does not install the compact receiver from Rspeedy's generated product entry or
execute an authored checksum, so `checksumRan:false` is expected.

This is a production-reachability budget and a host-oracle protocol proof, not
a shipping/default-path, FCP, update, memory, Web, or Native performance claim.
The 39.5-byte margin must not be treated as spare capacity: product entry,
first-screen replacement, static fallback, external-consumer proof, and the
background graph switch remain open.

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-controller-producer-complete,receiver-compiled-program-producer-complete \
  --output /absolute/path/to/m3-compact-wire.json
```

Exact-clean raw receipt:
`/data00/home/xuan.huang/.codex/tmp/m3-compact-wire-c3fb19809.json`.
SHA-256:
`6a760e5e26fcb0f5855d5f343278c6ad16405e70b35242544fa0b1dd55c0990b`.
