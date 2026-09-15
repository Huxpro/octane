# R10 Block feature specialization

Date: 2026-09-15 UTC

This receipt measures the ordinary `benchmarks/lynx-table/app` product graph at `BENCH_AUTOROWS=0`. The control is clean commit `d4d1e6fecc1684669708ec89264b253ad601e867`; the candidate changes only the Block component feature-selection implementation and its Rspeedy proof seam. Candidate product-source diff SHA-256 (`packages/lynx/src` plus `packages/rspeedy-plugin-octane/src`) is `b2e1136825f1ffcab555e4ade1c5eb5376587d6fdc9e02a1e94193a14f5bcba7`.

Both arms used Node `v22.22.2`, pnpm `11.15.1`, the same checkout and lockfile, production mode, and the inventory harness's fixed gzip/brotli settings. The commands differed only in output/source labels:

```bash
TMPDIR=/tmp OCTANE_INVENTORY_CALIBRATE=1 \
  OCTANE_INVENTORY_SOURCE=current-head \
  OCTANE_INVENTORY_OUTPUT=/tmp/octane-r10-current-head-inventory.json \
  BENCH_JSON=/tmp/octane-r10-current-head-bench.json \
  node benchmarks/lynx-bundle-size/inventory.mjs

TMPDIR=/tmp OCTANE_INVENTORY_CALIBRATE=1 \
  OCTANE_INVENTORY_SOURCE=structural-unwrapped \
  OCTANE_INVENTORY_OUTPUT=/tmp/octane-r10-structural-unwrapped-inventory.json \
  BENCH_JSON=/tmp/octane-r10-structural-unwrapped-bench.json \
  node benchmarks/lynx-bundle-size/inventory.mjs
```

| Artifact | Control raw | Candidate raw | Delta raw | Control gzip | Candidate gzip | Delta gzip | Delta brotli |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Web bundle | 270,581 | 263,778 | -6,803 | 79,769 | 77,624 | -2,145 | -1,738 |
| Lynx bundle | 269,943 | 263,149 | -6,794 | 94,303 | 92,060 | -2,243 | -1,791 |
| Lynx main thread | 86,495 | 86,495 | 0 | 26,911 | 26,911 | 0 | 0 |
| Lynx background thread | 178,700 | 171,906 | -6,794 | 51,959 | 49,879 | -2,080 | -1,812 |

The main-thread bytes and SHA-256 remain exactly identical (`9fe02a46b904b4aba89090e8c8511fc008af491171f5d5077f72514ebe7ba5ad`). The candidate graph resolves `block-component-features.structural.ts`; the paired compiler facts prove that every authored entry omits Activity, `@try`/Suspense boundaries, portals, `startTransition`, `useDeferredValue`, and `useTransition`. Development, incomplete/ineligible, and feature-using graphs retain the full source-safe module.

This is a graph-pruning result, not a budget recalibration. The frozen proportional owner limits predate even the clean R10 control (for example, its `lynx-runtime-other` attribution already exceeds the checked budget), so this change does not widen them or claim that the old owner gate is newly green.

The result qualifies the production artifact boundary only. It does not replace Android/iOS startup, interaction, memory, GC/no-JIT, ABBA, or native-list evidence; those remain blocked until qualified devices are available.
