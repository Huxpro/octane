# M3 production capability frontier

- Issue: #290
- Merged base: `new-lynx@c79396470e72ec08e8f36d2fd3b2e30b30d148c8`
- Exact-clean harness and measurement head:
  `f01b7288b31ebb66f7de8d8b6eb11a89262dbbb9`

## Question

The nested-range-capable compact foundation is 81,479 bytes gzip, only 5.5
bytes below M3's frozen 81,484.5-byte gate. Controller, acknowledgement,
fallback, and lifecycle code cannot fit in that remainder. This run measures
two exact, non-additive production closures which a specialized build could
remove: the optional main-thread worklet registry seam, and the general
compiled first-screen evaluator.

These are capability-cut hypotheses, not product candidates. Every arm replaces
the general receiver with a deliberately nonfunctional linkage body and lets
the real production Rspack build and LepusNG encoder compute the closure. A
shipping cut may use one only after compilation proves the capability absent or
replaces it with an independently verified implementation.

## Exact production result

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip | Headroom to gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current product | 415,354 | 159,785 | 133,976 | 105,512 | 53,952 | -78,300.5 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 | +11,434.5 |
| reusable non-host foundation | 236,141 | 76,750 | 65,673 | 22,354 | 53,952 | +4,734.5 |
| foundation without worklet seam | 234,593 | 76,208 | 65,170 | 21,802 | 53,952 | +5,276.5 |
| foundation without first-screen evaluator | 228,829 | 73,367 | 62,748 | 18,793 | 53,952 | +8,117.5 |
| foundation + compact frame | 245,345 | **81,479** | 69,958 | 27,070 | 53,952 | **+5.5** |
| compact frame without worklet seam | 243,797 | **80,921** | 69,475 | 26,500 | 53,952 | **+563.5** |
| compact frame without first-screen evaluator | 238,033 | **78,120** | 67,036 | 23,614 | 53,952 | **+3,364.5** |

Removing the worklet seam from the complete compact-frame union recovers 1,548
raw / 558 gzip / 483 Brotli bytes. Replacing the current first-screen evaluator
recovers 7,312 raw / 3,359 gzip / 2,922 Brotli bytes. These union deltas, rather
than sums of separately compressed boundaries, are the available budget.

Every arm's decoded BTS is byte-identical at 187,882 raw / 53,952 gzip / 46,411
Brotli with SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
Every four-arm core/backend isolation control passed, and
`receiverIsolationFailures` is empty.

## Decision

A no-worklet specialization is useful but insufficient by itself: 563.5 bytes
cannot credibly contain the remaining controller and settlement lifecycle. It
also cannot become the universal default because authored worklets are public
semantics.

The first-screen boundary is the viable repayment target. A compiled-program
bootstrap may spend up to 3,364.5 bytes on the remaining receiver lifecycle
while retaining the relative bundle gate. It must replace the evaluator on the
same production path rather than wrap it, and unsupported components must be
selected into a full-capability product at build time; shipping both receivers
in one artifact does not satisfy the gate.

## Evidence and non-claims

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-no-worklets,receiver-foundation-no-render,receiver-foundation-frame,receiver-foundation-frame-no-worklets,receiver-foundation-frame-no-render \
  --output /absolute/path/to/m3-production-capability-frontier.json
```

Exact-clean raw receipt SHA-256:
`090209beb1984a98549776b4c323485aee6135a589e9206283494a55929afae8`.
The receipt records `dirty: false`, tool SHA-256
`29b06fcb738ca88ff7c6e01987ee0188f7969484f257d669edbc502d4b537dd9`,
all production controls passing, and empty checksum/isolation failure arrays.

Product-only ablations cannot execute their receiver, so `checksumRan` is
false. No correctness, startup, FCP, tap, update, memory, cleanup, Native, or Web
performance claim is derived from these numbers. They only price production
reachability and establish which boundary can fund the next implementation.
