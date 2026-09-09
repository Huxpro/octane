# Production Block-component-error arguments

- Date: 2026-09-09
- Issue: #290
- Baseline: `6fda02b3d698c95b133e92e02f06fbc685d0fb86`
- Exact-clean implementation: `62da704a227d071b46b692430d92f048fa3990ff`
- Exact-clean receipt SHA-256:
  `a820d8d61c0e7d115695c879609d8ee617c16ceee3304ad362e8de68cde07755`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile all 22 Block-component diagnostic arguments out of
  production, which now emits only `Octane Lynx OL013`
- Result: `block+program` 169,163 -> 168,203 gzip bytes (-960, -0.567%)
- Thread control: decoded BTS -1,003 gzip; decoded MTS byte-identical
- Behavior control: installed-tarball production exclusion and development
  retention assertions pass, with OL013 remaining background-only
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger and hashes are recorded in
[`../results/m3-production-block-component-error-args.md`](../results/m3-production-block-component-error-args.md).
