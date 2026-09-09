# M3 general main-thread receiver ceiling

Issue #290 needs a product architecture that clears the complete-artifact
target, not another small reduction inside the existing receiver. The current
L5 batch/interpreter ceiling leaves the product at 127,903 B gzip, still
46,418.5 B above the 81,484.5 B gate. This follow-up measures the larger
boundary: everything production tree-shaking can remove when the paired product
entry no longer retains the general main-thread receiver at all.

## Verdict

Replacing the receiver whole is the first measured MTS boundary with enough
headroom to complete M3:

| arm | complete gzip | delta | ratio | gap/headroom to 81,484.5 B |
| --- | ---: | ---: | ---: | ---: |
| current `block+program` product | 160,511 | — | 2.955× | +79,026.5 |
| general receiver absent | **70,448** | **−90,063** | **1.297×** | **−11,036.5** |

The receiver-free arm is deliberately nonfunctional. Its 11,036.5-byte
headroom is the compressed budget for a specialized product receiver plus any
new support it makes reachable; it is not a prediction that the replacement
will fit. A candidate that exceeds that budget cannot meet #290 even if it
realizes the entire measured deletion.

## Exact protocol and provenance

The exact-clean implementation is
`b5a0149d24adfb35fce992e6feb0f6cf9b9cfa4d`, based on merged
`new-lynx@78aad05b23b3c12c8c54879805b44f1801075efe`. The command was:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver \
  --output /data00/home/xuan.huang/.codex/tmp/m3-general-receiver-ceiling-b5a0149d2.json
```

The checked-in receipt is
[`m3-general-main-thread-receiver-ceiling.json`](m3-general-main-thread-receiver-ceiling.json),
SHA-256
`236af20e7c100e37773f7f680445addc2c79c9c8cae54cc9f5d0fc7924f7eb5c`.
It records `dirty: false`, the exact tool and artifact hashes, Node 22.22.2,
and the current 54,323-byte comparator median from
[`m3-default-path-audit.md`](m3-default-path-audit.md).

The ablation replaces only the body of
`installLynxMainThreadWithValidator` and lets the production tree shaker derive
the unreachable closure. The baseline reproduces #322 byte-for-byte:

- complete `536f12776f15acee80e191e9075f64af830cedf606beebbf04c7d41fed5e640e`;
- BTS `0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`;
- MTS `4735539a230bdf15a1bfd980499086751a998ab70fa46fe1e3d6253a57427684`.

## Thread attribution

| arm | complete raw/gzip/Brotli | BTS raw/gzip/Brotli | MTS raw/gzip/Brotli |
| --- | ---: | ---: | ---: |
| baseline | 418,005 / 160,511 / 134,730 | 187,742 / 53,880 / 46,365 | 227,416 / 106,320 / 87,656 |
| receiver absent | 223,390 / 70,448 / 60,438 | 187,742 / 53,880 / 46,365 | 32,801 / 15,927 / 13,815 |

BTS is byte-identical, so the 90,393-byte decoded-program reduction belongs
entirely to MTS. The complete-artifact saving is 330 bytes smaller because a
compressed container delta is not the sum of independently compressed thread
deltas. The remaining MTS still contains the application, its one compiled
program, process-data bootstrap, and build framing; the control confirms one
program in MTS and zero in BTS.

## Controls and limits

Both arms rebuilt all four `core-switch.mjs` production cells. Every
core/backend isolation control passed, and the baseline exactly reproduced the
accepted #322 identities. Product-only mode cannot execute the intentionally
broken receiver-free runtime, so the receipt records `checksumRan: false`; no
semantic, startup, FCP, update, memory, cleanup, or device claim is made.

This ceiling does not authorize deleting failure settlement, lifecycle,
first-screen adoption/repair, native-event delivery, worklets, native lists,
portals, or any other public semantic row. It authorizes a build-time product
split: a specialized receiver must implement the covered default path inside
the 11,036.5-byte complete-artifact headroom, while unsupported builds retain
the checked general receiver through an explicit fallback or opt-out. Moving
the old receiver to a lazy chunk would not satisfy the complete-artifact gate.

M3 remains open.
