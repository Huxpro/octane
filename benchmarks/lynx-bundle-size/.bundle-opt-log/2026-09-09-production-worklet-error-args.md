# Production worklet-error arguments

- Date: 2026-09-09
- Issue: #290
- Baseline: `1a6a2acfbb493e12867eebf1faf64d1bbb3e84c3`
- Exact-clean implementation: `d6bb1e56ef6ac17b167ad019c86fa35935ec9f6f`
- Exact-clean receipt SHA-256:
  `4889b77936507321e468da5f8df7242a2c4780209c5bfe45dc76d40e85e1af04`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile both arguments of all 39 worklet-validator failures out of
  production, which already emits `Octane Lynx OL273`
- Result: `block+program` 168,203 -> 167,587 gzip bytes (-616, -0.366%)
- Thread control: decoded BTS -278 gzip; decoded MTS -343 gzip; neither grows
- Behavior control: production exclusion and installed-tarball development
  retention assertions pass in both thread programs
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger and hashes are recorded in
[`../results/m3-production-worklet-error-args.md`](../results/m3-production-worklet-error-args.md).
