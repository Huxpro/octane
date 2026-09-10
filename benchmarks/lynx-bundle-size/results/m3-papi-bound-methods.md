# M3 bound Element PAPI methods

- Issue: #290
- Merged base: `new-lynx@6fbf031e2260343c5996f5092923743ad8c346bc`
- Exact-clean implementation and measurement head:
  `7a933c7ba2e84c55f06a16e439f5ba9c62d869ce`

## Result

`requireFunction` already binds every required Element PAPI function to the
injected Lynx main-thread global. The normalized adapter nevertheless retained
another same-signature JavaScript method around fourteen of those bound
functions. This change publishes the bound functions directly for page/id,
replacement, attribute/style/dataset/event/id, and flush operations. The
custom element factory, nullable-before normalization, parent fallback,
identity fallback, child check, and ref-selector behavior remain unchanged.

This removes one JavaScript call layer from each affected successful host
operation. No DOM behavior is assumed: the functions remain Lynx Element PAPI
functions bound to the native main-thread target. Function `name`/`length` are
not part of the internal normalized PAPI contract.

## Exact production linkage

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-store,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-papi-bound-methods-7a933c7ba.json
```

Raw receipt SHA-256:
`82d6dfdef7bd673e40054268f6d8e78f36cfdf3dcd40ccb2a972cca7d14c041c`.
It records a clean source tree, Node `v22.22.2`, tool SHA-256
`efedeee99d650bee69eb0e0a30d6af8ac4ee49c8356e52334d13b260c256d010`,
an empty receiver-isolation failure list, and all production core/backend
controls passing.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,354 | 159,785 | 133,976 | 105,512 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,141 | 76,750 | 65,673 | 22,354 | 53,952 |
| foundation + compact store | 243,728 | 80,640 | 69,107 | 26,216 | 53,952 |
| foundation + compact frame | 245,240 | **81,357** | 69,808 | 26,932 | 53,952 |

Against the exact merged base, the current product drops 529 raw / 194 gzip /
100 Brotli bytes, all in decoded MTS; the receiver-free arm remains exactly
70,050 gzip. The compact-frame frontier drops 529 raw / 99 gzip / 154 Brotli
bytes to **1.497695x** the frozen 54,323-byte comparator median, leaving 127.5
gzip bytes below the 81,484.5-byte M3 gate. Decoded BTS stays byte-identical
across all arms at SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.

The product linkage harness reports `checksumRan:false`; these numbers prove
production reachability and bundle repayment only. They are not startup,
update, memory, or cleanup-cycle timing claims. Behavioral coverage comes from
the Element PAPI, host driver, list recycling, main renderer, painted ceiling,
compact store, and compact frame suites.
