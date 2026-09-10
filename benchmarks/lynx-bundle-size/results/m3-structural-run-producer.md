# M3 structural physical-run producer

- Issue: #290
- Merged base: `new-lynx@2f07b6fa67b2e7ed9385f7447e0a2e0ca8a12f62`
- Exact-clean implementation and measurement head:
  `f0959e0525db23e9cb0eeea0823e179dbd9e8b6b`

## Result

The real compiler can now emit the constant-physical-stride `.run` consumed by
the compact store for programs with structural ranges. The benchmark's
top-level program therefore carries both generated capabilities the candidate
receiver requires: direct slot setters and a structural run driver.

That producer-complete frontier is **82,404 bytes gzip**, or **1.517x** the
frozen 54,323-byte comparator median. It is **919.5 bytes above** the 81,484.5
M3 gate before controller, acknowledgement, fallback, or lifecycle code exists.
The previous 81,479-byte receiver-only linkage result is not a product pass.

## Exact production frontier

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip | Headroom to gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current product | 415,354 | 159,785 | 133,976 | 105,512 | 53,952 | -78,300.5 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 | +11,434.5 |
| compact receiver closure, no producer features | 245,345 | 81,479 | 69,958 | 27,070 | 53,952 | +5.5 |
| receiver + generated slot setters | 246,121 | 81,675 | 70,167 | 27,263 | 53,952 | -190.5 |
| receiver + complete generated producer | 248,295 | **82,404** | 70,579 | 27,997 | 53,952 | **-919.5** |
| complete producer without worklet seam | 246,747 | **81,851** | 70,217 | 27,423 | 53,952 | **-366.5** |
| complete producer without general first-screen evaluator | 240,983 | **79,073** | 67,632 | 24,560 | 53,952 | **+2,411.5** |

The generated structural driver adds 2,174 raw / 729 gzip / 412 Brotli bytes
over the slot-setter-complete arm. The no-worklet hypothesis no longer fits the
gate at all. Replacing the general first-screen evaluator is now a necessary
condition, not merely the largest available optimization.

Every arm's decoded BTS is byte-identical at 187,882 raw / 53,952 gzip / 46,411
Brotli with SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.
All four production core/backend controls pass for every arm, and the receiver
isolation failure list is empty.

## Compiler and runtime contract

`structuralRuns: true` is explicit. Omitted or false retains the historical
source byte-for-byte and keeps `denseRun: false` for an open range. The emission
reports `runDriver: true` separately: logical host IDs may have variable stride,
while each physical output still occupies exactly `nodes + ranges.length`
entries. The compact store addresses instances by handles and child parents by
`(instance, compiler range slot)`, so it does not derive either from logical-ID
arithmetic.

The generated loop publishes every node into the caller-owned output table at
creation time, writes `undefined` for an open structural range, and preserves
the create function's event, prop, append, and painted-text order. The
regression compares two physical-stride instances against two ordinary create
calls and asserts the open/painted range outputs independently. The nested frame
suite now binds this real emitted driver; its former test-only create-loop shim
is deleted.

## Evidence and non-claims

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-frame,receiver-foundation-frame-producer-slots,receiver-foundation-frame-producer-complete,receiver-foundation-frame-no-worklets-producer-complete,receiver-foundation-frame-no-render-producer-complete \
  --output /absolute/path/to/m3-structural-run-producer.json
```

Exact-clean raw receipt SHA-256:
`f1511305ae201e9415fb0c263273b5c8d6c4274c1563af8babc19cfa0e6584cf`.
The receipt records `dirty: false`, Node v22.22.2, tool SHA-256
`4c9a94e487c71219405addd012f89d19e4f23bfc4febaa52d4f3fb9a66f4c14d`,
the exact feature list per arm, all production controls passing, and empty
checksum/isolation failure arrays.

The production arms still replace the receiver with nonfunctional linkage
bodies, so `checksumRan:false`. The result proves generated-code behavior in the
host oracle and prices its real production reachability; it makes no shipping,
default-path, FCP, update, memory, Web, or Native performance claim.
