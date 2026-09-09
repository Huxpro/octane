# Current product L5 ceiling

Issue #290 requires the eventual default product artifact, not one decoded
thread in isolation, to fit within 1.5× the contemporary ReactLynx/Vue
comparator median. The old L5 report measured historical universal-default
fixtures against a 51,228-byte median. This report re-runs the same
exported-entry ablations on the current compiler-derived `block+program`
candidate product arm and the current 54,323-byte median. It does not flip the
default.

## Verdict

The two L5 deletions remain valuable but cannot close M3:

| arm | complete artifact gzip | delta | comparator ratio | gap to 81,484.5 B |
| --- | ---: | ---: | ---: | ---: |
| baseline | 167,252 | — | 3.079× | +85,767.5 |
| recursive validator absent | 151,447 | −15,805 | 2.788× | +69,962.5 |
| plan interpreter + batch pipeline absent | 134,982 | −32,270 | 2.485× | +53,497.5 |
| both absent | **118,728** | **−48,524** | **2.186×** | **+37,243.5** |

Even the impossible best case—both mechanisms deleted with no replacement
bytes—remains 37,243.5 gzip bytes above the gate. Therefore neither a shallow
validator split nor the direct-applier cutover can finish #290 alone. The
remaining architecture must also make a substantial part of the universal
component ABI and/or general main-thread host closure unreachable from the
default product graph.

## Exact protocol and provenance

The implementation commit is
`4e0bc07ed17394c38439649f53a9692e734852a9`, based on merged
`new-lynx@dbe683311e8c5279922cc3f2adfcf568f832b5b0`. The exact-clean command was:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,validator,batch,both \
  --output /data00/home/xuan.huang/.codex/tmp/m3-product-l5-ceiling-exact-4e0bc07ed.json
```

The checked-in raw receipt is
[`m3-product-l5-ceiling.json`](m3-product-l5-ceiling.json), SHA-256
`892da042164c9641a0b9d7e84d51945d9b799cc642be655154aa7881d98df9a2`.
It records `dirty: false`, Node 22.22.2, the exact tool hash, every artifact
hash, and the comparator source. The comparator median and 81,484.5-byte target
come from [`m3-default-path-audit.md`](m3-default-path-audit.md).

Each ablation stubs one exported entry and lets the production tree shaker
compute the actual transitive closure:

| arm | exported entries made unreachable |
| --- | --- |
| validator | `selfCheckLynxBackgroundInboundMessage`, `validateLynxBackgroundOutboundMessage`, `validateLynxBackgroundInboundMessage` |
| batch | `prepareLynxHostBatch` |
| both | all four entries above |

This is deliberately an upper bound. A shipping trusted validator must retain
versioned envelope checks, failure settlement, and development diagnostics. A
shipping direct executor must retain every semantic fallback until Block covers
it. Their realizable savings are smaller than these deletion arms.

## Complete artifact

| arm | raw | gzip | Brotli | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| baseline | 432,847 | 167,252 | 139,232 | `9359d11a5c4f…` |
| validator | 386,780 | 151,447 | 127,021 | `6bacef35879a…` |
| batch | 365,431 | 134,982 | 113,954 | `570f36c335dd…` |
| both | 318,833 | 118,728 | 101,614 | `fd154c8c41d2…` |

The baseline identities exactly reproduce #320's accepted product evidence:

- bundle `9359d11a5c4f3fc81ae7acbc5da89bda13af49e1158804ff22e855ecb6c8cb56`;
- BTS `b2737fe05d2f52d3dfe6632a3669d1f1e0052677812e1bac222129992189e022`;
- MTS `dfb37de6a2f52e262f41a0dba1b43db1bb3d28b5b889d05f60fcb4459aad9a17`.

The combined gzip saving is 449 bytes larger than the two individual savings
added together: 15,805 + 32,270 = 48,075, versus 48,524 measured together.
Compressed deltas are not additive; the `both` artifact is the only valid
combined number.

## Thread attribution

| arm | BTS raw/gzip/Brotli | BTS delta gzip | MTS raw/gzip/Brotli | MTS delta gzip |
| --- | ---: | ---: | ---: | ---: |
| baseline | 187,625 / 53,873 / 46,259 | — | 242,375 / 112,998 / 92,959 | — |
| validator | 163,138 / 47,645 / 41,240 | −6,228 | 220,795 / 103,659 / 85,923 | −9,339 |
| batch | 187,625 / 53,873 / 46,259 | **0** | 174,959 / 80,821 / 67,387 | −32,177 |
| both | 163,138 / 47,645 / 41,240 | −6,228 | 152,848 / 71,007 / 60,142 | −41,991 |

The batch arm leaves BTS byte-identical, so its closure is main-thread-only.
The validator closure is genuinely shared and shrinks both programs. Neither
arm transfers bytes to the other thread.

The `both` MTS gzip number is below the complete-artifact target, but comparing
one decoded program to a complete comparator bundle would repeat the old scope
error. The complete `both` artifact remains 2.186× the median.

## Controls and limits

For every ablation, `core-switch.mjs` rebuilt all four production arms:
`universal`, `block`, `block+program-descriptor`, and `block+program`. All
core/backend isolation controls passed each time, every selected product arm
contained one compiled main-thread program and zero background programs, and
the baseline reproduced the accepted hashes above.

Product-only mode does not execute the deliberately broken ablated runtimes, so
the receipt says `checksumRan: false`. That is not hidden as a pass. The
historical default harness was separately rerun on this implementation and its
executable semantic checksums still matched between baseline and `both` while
reproducing the prior fixture numbers. The product numbers are nevertheless
ceilings, not functional candidates.

No wall-clock, native startup, first-paint, adoption, update, memory, cleanup,
or device claim is made here. Nothing was deleted from product code.

## What this authorizes

1. A production shallow-validation split has a 15,805-byte absolute ceiling.
   It is worth implementing only with checked opt-in, full development
   validation, external lifecycle validation, and version/failure settlement
   preserved.
2. The batch/interpreter closure has a 32,270-byte ceiling, but it cannot be
   removed until native lists, fallback/adoption, portals, fault handling, and
   every public semantic row have a non-staged executor.
3. Both together still leave 37,243.5 bytes of mandatory reduction. The next
   architecture decision must therefore target another emitted closure rather
   than extend the diagnostic-string sequence.

M3 remains open.
