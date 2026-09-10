# M3 compact nested-range routing

- Issue: #290
- Merged base: `new-lynx@9ff8a9a95e233870aff934a57e14fad6a49f7b68`
- Exact-clean implementation and measurement head:
  `a8085da6e3ea3f0c4ead1af131332479ca8c2a3d`

## Result

The compact frame router can now resolve a non-root parent from the resident
program instance and the compiler's range slot. Nested RUN and CLEAR use that
physical parent directly; MOVE additionally proves that both the instance and
its anchor belong to the addressed range. SET and VIS continue to address the
instance itself. Root operations retain the reserved `(instance 1, slot 0)`
address.

The store retains one output stride of `plan.nodes + plan.ranges.length`, while
range lookup maps the compiler slot back to the plan's physical parent node.
Structural plans are checked in development for unique non-painted range slots
and valid node ownership. Removing a parent whose range still owns children
rejects transactionally; CLEAR removes the children first, and terminal
disposal walks the globally monotonic instance order in reverse so descendants
are cleaned before their owners.

Malformed or cross-range work cannot publish a partial topology. Tests cover
two child instances under sparse compiler slot 7, later SET, nested MOVE,
cross-range refusal, nested CLEAR rollback after a later malformed opcode,
parent-removal refusal, and child-before-parent disposal.

This is receiver infrastructure, not a product cutover. The current compiler
still declines addressed main-thread programs with structural ranges, and the
shipping receiver does not yet construct this compact store/router. The test
therefore supplies the same constant-stride `run` ABI that a later eligible
producer must prove. No startup, update, memory, or cleanup-cycle improvement
is claimed here.

## Exact production linkage

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-store,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-nested-ranges-a8085da6e.json
```

Raw receipt SHA-256:
`d72c24802cafa2063db0b4dd9d63164defc1633b15ad5f111206670e9ae3921b`.
It records a clean source tree, Node `v22.22.2`, tool SHA-256
`efedeee99d650bee69eb0e0a30d6af8ac4ee49c8356e52334d13b260c256d010`,
an empty receiver-isolation failure list, and all production core/backend
controls passing.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,354 | 159,785 | 133,976 | 105,512 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,141 | 76,750 | 65,673 | 22,354 | 53,952 |
| foundation + compact store | 243,963 | 80,802 | 69,274 | 26,375 | 53,952 |
| foundation + compact frame | 245,345 | **81,479** | 69,958 | 27,070 | 53,952 |

Relative to the exact PAPI-repaid base, this mechanism adds 122 gzip bytes to
the compact-frame frontier. The result is **1.499899x** the frozen 54,323-byte
comparator median and **5.5 bytes below** the 81,484.5-byte M3 gate. The current
product arm is byte-identical because this receiver is not selected by the
shipping product. Decoded BTS stays byte-identical across all arms at SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.

The product linkage harness reports `checksumRan:false`; these numbers prove
only that the complete reusable mechanism remains reachable within the frozen
bundle budget. Behavioral evidence comes from the compact store/router tests,
not from this ablated linkage harness.

## Remaining work

A later slice must make an eligible real compiler producer emit/prove a
constant-stride structural run, connect the shipping receiver and first-screen
ownership transfer, retain fallback and ACK/abort cleanup, and then measure the
default Native path. External-consumer cutover and the complete M3 semantic,
timing, and memory matrices remain open.
