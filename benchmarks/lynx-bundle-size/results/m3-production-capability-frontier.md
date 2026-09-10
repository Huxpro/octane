# M3 production capability frontier

- Issue: #290
- Merged base: `new-lynx@c79396470e72ec08e8f36d2fd3b2e30b30d148c8`
- Exact-clean harness and measurement head:
  `a96642d34c2ba3a5d15b55551d7a7b8516dcf45f`

## Question

The nested-range-capable compact receiver closure was reported at 81,479 bytes
gzip, only 5.5 bytes below M3's frozen 81,484.5-byte gate. That frontier did not
make the application program emit the generated `.set` methods which compact
SET requires, so it understated the real producer. This run first prices that
code in the application graph, then measures two exact, non-additive closures a
specialized build could remove: the optional main-thread worklet registry seam,
and the general compiled first-screen evaluator.

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
| foundation + compact frame, receiver closure only | 245,345 | 81,479 | 69,958 | 27,070 | 53,952 | +5.5 |
| compact frame + **real generated slot setters** | 246,121 | **81,675** | 70,167 | 27,263 | 53,952 | **-190.5** |
| receiver closure without worklet seam | 243,797 | 80,921 | 69,475 | 26,500 | 53,952 | +563.5 |
| no worklet seam + generated slot setters | 244,573 | **81,119** | 69,569 | 26,697 | 53,952 | **+365.5** |
| receiver closure without first-screen evaluator | 238,033 | 78,120 | 67,036 | 23,614 | 53,952 | +3,364.5 |
| no first-screen evaluator + generated slot setters | 238,809 | **78,324** | 67,277 | 23,821 | 53,952 | **+3,160.5** |

The real slot-setter producer adds 776 raw / 196 gzip / 209 Brotli bytes to the
full compact-frame union, turning the former 5.5-byte pass into a 190.5-byte
failure. Removing the worklet seam from the producer-complete union recovers
1,548 raw / 556 gzip / 598 Brotli bytes. Replacing the current first-screen
evaluator recovers 7,312 raw / 3,351 gzip / 2,890 Brotli bytes. These union
deltas, rather than sums of separately compressed boundaries, are the available
budget.

Every arm's decoded BTS is byte-identical at 187,882 raw / 53,952 gzip / 46,411
Brotli with SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
Every four-arm core/backend isolation control passed, and
`receiverIsolationFailures` is empty.

## Decision

A receiver-only frontier is not an admissible M3 size result. With the generated
slot writers required by compact SET, the full-capability candidate already
fails the gate by 190.5 bytes before controller, acknowledgement, fallback, and
lifecycle code exist.

A no-worklet specialization is useful but insufficient by itself: 365.5 bytes
cannot credibly contain the remaining controller and settlement lifecycle. It
also cannot become the universal default because authored worklets are public
semantics.

The first-screen boundary is the viable repayment target. A compiled-program
bootstrap may spend up to 3,160.5 bytes on the remaining receiver lifecycle
while retaining the relative bundle gate. It must replace the evaluator on the
same production path rather than wrap it, and unsupported components must be
selected into a full-capability product at build time; shipping both receivers
in one artifact does not satisfy the gate.

That is still an upper bound, not the final budget: the benchmark's structural
top-level program does not yet emit the constant-stride `.run` consumed by the
nested-range compact store. Its production bytes must be measured before a
shipping cutover can pass the gate.

## Evidence and non-claims

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-frame,receiver-foundation-frame-no-worklets,receiver-foundation-frame-no-render,receiver-foundation-frame-producer-slots,receiver-foundation-frame-no-worklets-producer-slots,receiver-foundation-frame-no-render-producer-slots \
  --output /absolute/path/to/m3-production-capability-frontier.json
```

Exact-clean raw receipt SHA-256:
`34254049c5c2ef35c04e29583dc5ad2757c02556e6bffa331e9164c2c33497e8`.
The receipt records `dirty: false`, tool SHA-256
`459c1dda4f39c47fd27056876667c782eb3a605f49fa2d87280a186762da9101`,
all production controls passing, and empty checksum/isolation failure arrays.

Product-only ablations cannot execute their receiver, so `checksumRan` is
false. No correctness, startup, FCP, tap, update, memory, cleanup, Native, or Web
performance claim is derived from these numbers. They only price production
reachability and establish which boundary can fund the next implementation.
