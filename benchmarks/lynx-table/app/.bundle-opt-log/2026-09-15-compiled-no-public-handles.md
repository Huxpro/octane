# Compiled no-public-handle residue pruning

- Project/page: `benchmarks/lynx-table/app`, automatic compiled table
- Lever: reuse the paired no-thread-function/no-host-ref compiler proofs; applied
- Shipped Lynx bundle: 224,349 B → 223,438 B (-911 B, -0.41%)
- Web control bundle: 224,742 B → 223,891 B (-851 B, -0.38%)
- Baseline: `74e69ba860763dcfb02a673f0d28a8c67cf4f845`
- Candidate: `20687b7bf` on `huxcx/m4-no-public-handles-291`
- Node: `v22.22.2`

Verification build:

```sh
BENCH_CORE=automatic BENCH_DIST_TAG=no-public-handles node benchmarks/lynx-table/scripts/build-app.mjs
```

An analysis-only named-module/de-concatenated build traced the residual main-thread
NodesRef edge to `compiled-program-native-owner.ts` → `papi.ts` →
`nodes-ref.ts`, where PAPI consumed only the reserved attribute constant. Moving
that constant into a leaf module lets both threads discard the full NodesRef
implementation whenever the existing host-ref proof selects the no-host-ref
product.

The same no-thread-function proof now reaches the compiled store and prevents
worklet-slot probing in a proved no-thread-function product. Full or unproved
builds retain the existing worklet and NodesRef paths.

SHA-256 evidence:

- baseline Web: `ae97df277921564ea731936c90160150787bca32220aaf5c55c4379143287bf9`
- baseline Lynx: `c5e698a4efc30fd6cbd74412395f9176b312c9105c0599c8f3431c80e7cd0234`
- candidate Web: `1a2f535f7224cad884b6e36c79a1445b5ad9d3132a588f57ba9faa53bab65354`
- candidate Lynx: `5f623b7e501b36873e34d545b5305e65070a2f52eb3ca5964ac3b32948ff6543`

These are complete production artifacts; no bytes moved to another chunk. This
is shipped-byte evidence, not a runtime-performance or #291 acceptance claim.

## Investigated but not shipped

Conditionally wrapping the background worklet factory behind the same static
feature flag produced byte-identical Web and Lynx artifacts. The added branch
and non-null assertion therefore had no measured output benefit and were
reverted.

Skipping the unavailable/replaceable worklet registry in the product receiver
would have reduced the candidate to 222,732 B Lynx and 223,574 B Web. It was
rejected after adjacent Web startup attribution: the retained leaf+store arm
was neutral (paired AB/BA FCP0 median-ratio GM 0.992, n=15 per entry/window),
while the receiver-inclusive arm was 1.009 in its matched n=15 pair and 1.027
across all four independent adjacent windows. Those dirty diagnostic windows
are not #291 acceptance evidence; they are a fail-closed optimization gate.
