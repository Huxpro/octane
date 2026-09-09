# Production host-prop-error arguments

- Date: 2026-09-08
- Issue: #290
- Baseline: `effbdad98be55026fc0374e0cadfd589b4c681e8`
- Exact-clean implementation: `b834c4ba4fcd14297b46bf7fd3acf90b119544d6`
- Exact-clean receipt SHA-256:
  `1a37dd4003d874c675fa0843f2312d32da10fa2d5c5c8d7eca8ee7960d498aa1`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile all 26 host-prop diagnostic arguments out of production,
  which already emits `Octane Lynx OL100`
- Result: `block+program` 170,113 -> 169,163 gzip bytes (-950, -0.558%)
- Thread control: decoded BTS -416 gzip; decoded MTS -508 gzip; neither grows
- Behavior control: production exclusion and development retention assertions
  pass in both thread programs
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger and hashes are recorded in
[`../results/m3-production-host-prop-error-args.md`](../results/m3-production-host-prop-error-args.md).
