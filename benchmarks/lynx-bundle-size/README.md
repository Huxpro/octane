# Lynx preview and IFR bundle-size benchmark

This deterministic, Node-only suite production-builds the same representative
Octane Lynx application in two real Rspeedy/compiler shapes:

- `octane-preview` uses the background renderer plus the main-thread host
  receiver, but the authored application renders only in the background; and
- `octane-ifr` uses `@octanejs/rspeedy-plugin` application mode, so the authored
  first tree is compiled for main and the retained application is compiled for
  background adoption.

The harness decodes each `.lynx.bundle`, confirms its engine and thread graph,
rejects DOM and ReactLynx/React/Preact runtime module markers, and checks a
SHA-256 semantic marker checksum for the visible tree, keyed rows, state-driven
selection, and compiled native tap handler. Preview must contain the complete
authored graph in background;
IFR must additionally contain the matching visible-tree checksum on main while
keeping the background-owned tap update out of that program. Bytes are accepted
only after those checks pass.

The suite reports encoded bundle and decoded main/background program raw, gzip,
and Brotli bytes. Ratio gates bound IFR's encoded-bundle and decoded-main gzip
overhead relative to the background-rendered preview shape, while the harness
requires the decoded background metrics to match exactly.

```bash
node benchmarks/bench.mjs --ratios lynx-bundle-size
```

This is source/build evidence only. Decoding a production artifact does not
execute a Lynx engine and makes no native startup, first-paint, adoption,
latency, memory, or device-lifecycle claim.

## Complete rows-0 inventory

`inventory.mjs` additionally builds the exact rows-0 table fixture used by the
cross-framework runtime benchmark in both Web and Lynx production modes. It
records hashes and raw/gzip/Brotli totals, captures the encoded Lynx artifact's
pre-encode main/background programs, and attributes 100% of final raw bytes by
the production reachable-module owner weights. That proportional raw
attribution is for prioritization; only an isolated production build delta may
be described as gzip ownership.

`inventory-budgets.json` freezes total, thread-section, and owner-slice raw
budgets plus total gzip budgets on the integrated #706/#707 stack. The ledger
keeps #706's accepted size tax and #707's controlled optional-worklet saving
separate because compressed deltas are not additive.

The checked execution report is
[`results/production-inventory.md`](results/production-inventory.md).

## L5 ceiling ablation

`l5-ceiling.mjs` answers a question the budgets cannot: what #58's L5 bullet is
worth. It rebuilds both fixtures above with the plan interpreter, the batch
pipeline, and the recursive validator absent — by exported entry, letting
production tree-shaking compute each closure, so a helper the direct first-screen
path still calls stays and is not counted.

```bash
node benchmarks/lynx-bundle-size/l5-ceiling.mjs
```

It is an operator tool and not a CI gate: it rewrites `packages/lynx/src/core`
so a build can be taken with a target gone, refuses to start unless those sources
are clean, and restores them in a `finally`. Every arm must reproduce the
baseline's semantic checksums or the run fails, and the ablated artifacts are
measurement devices rather than functional runtimes.

The checked execution report is [`results/l5-ceiling.md`](results/l5-ceiling.md).
