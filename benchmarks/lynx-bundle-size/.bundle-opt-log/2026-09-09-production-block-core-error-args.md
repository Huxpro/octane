# Production Block-core-error arguments

- Date: 2026-09-09
- Issue: #290
- Baseline: `b56836b1e81278f16cf2c89de94349ceb7026126`
- Exact-clean implementation: `47aa0958830ec6f60974aedd5cf4087d44230212`
- Exact-clean receipt SHA-256:
  `fddeef232298c5d194e1626e14a9919ff470189303de2c8469a37f65c2751065`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile the argument of all 15 Block-core failures out of production,
  which already emits `Octane Lynx OL015`
- Result: `block+program` 167,587 -> 167,252 gzip bytes (-335, -0.200%)
- Thread control: decoded BTS -322 gzip; decoded MTS byte-identical
- Behavior control: production exclusion and installed-tarball development
  retention assertions pass on the background program; OL015 remains absent
  from MTS
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger and hashes are recorded in
[`../results/m3-production-block-core-error-args.md`](../results/m3-production-block-core-error-args.md).
