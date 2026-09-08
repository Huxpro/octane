# Production protocol-error arguments

- Date: 2026-09-08
- Issue: #290
- Baseline: `f3bc8804a8834e6b66aca6a5bddca62c5cfe03b6`
- Exact-clean implementation: `cd39e7f24f36b14d4a9505542cbaf9e76444a429`
- Exact-clean receipt SHA-256:
  `5d307707b0c647b8905f54020c2f3800c98574d30d85c499284916c52c321529`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile all 162 transport-validator labels, messages, and field names
  out of production, which already emits `Octane Lynx OL174`
- Result: `block+program` 173,719 -> 170,113 gzip bytes (-3,606, -2.076%)
- Thread control: decoded BTS -1,701 gzip; decoded MTS -2,006 gzip; neither grows
- Behavior control: production exclusion and development retention assertions
  pass in both thread programs
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger and hashes are recorded in
[`../results/m3-production-protocol-error-args.md`](../results/m3-production-protocol-error-args.md).
