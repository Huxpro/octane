# Compiled host-ref pruning

- Project/page: `benchmarks/lynx-table/app`, automatic compiled table
- Lever: compiler-proved feature specialization; applied
- Shipped Lynx bundle: 232,593 B → 224,349 B (-8,244 B, -3.54%)
- Web control bundle: 233,029 B → 224,742 B (-8,287 B, -3.56%)
- Baseline: `36b63e38a2480b72e0a0aa4f99ad5b18717c4474`
- Candidate: `9b1d4c585` (rebased commit; content under review)
- Node: `v22.22.2`

Verification build:

```sh
BENCH_CORE=automatic BENCH_DIST_TAG=host-ref-full-baseline node benchmarks/lynx-table/scripts/build-app.mjs
BENCH_CORE=automatic BENCH_DIST_TAG=no-host-refs node benchmarks/lynx-table/scripts/build-app.mjs
```

The compared artifacts are the complete production `main.lynx.bundle` and
`main.web.bundle`; no bytes moved to another chunk. The specialization is enabled
only for one-shot production compiled applications whose paired compiler ledgers
prove every entry is free of authored host refs. Development, watch, general,
incomplete, and host-ref-bearing graphs retain the full implementation.

SHA-256 evidence:

- baseline Web: `cb95cf60052274ac19a333632668a89be561ce518cf18c2f191ada9970e32b7a`
- baseline Lynx: `707ea1eb77be8fe308fd2c75beadbef7f5881790bec75f8a338403fef17fe8a6`
- candidate Web: `ae97df277921564ea731936c90160150787bca32220aaf5c55c4379143287bf9`
- candidate Lynx: `c5e698a4efc30fd6cbd74412395f9176b312c9105c0599c8f3431c80e7cd0234`

This is shipped-byte evidence, not a runtime-performance claim. Runtime acceptance
continues through the paired AB/BA benchmark protocol in issue #291.
