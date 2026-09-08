# Production host-error arguments

- Date: 2026-09-08
- Issue: #290
- Baseline: `f8e6773efe27454002ac0da78d82358a29b4e711`
- Exact-clean implementation: `d248bd1544f17edc0a000745498005e962941658`
- Exact-clean receipt SHA-256:
  `97b454731e013d8f2df08fa2ebfa76acc0d7dcabc1702142d1453fcd914b8167`
- Product metric: encoded Native `.lynx.bundle` from the rows-0 production fixture
- Change: compile out all 239 full host-error arguments when production already
  emits `Octane Lynx OL099`
- Result: `block+program` 177,748 -> 173,719 gzip bytes (-4,029, -2.267%)
- Thread control: decoded BTS is byte-identical; decoded MTS is -4,195 gzip bytes
- Behavior control: production compact code and development full-message bundle
  assertions pass
- Decision: accepted as one M3 slice; #290 remains open above its 81,484.5-byte
  gate

The complete raw/gzip/Brotli ledger, hashes, rejected closure arm, and
reproduction boundary are recorded in
[`../results/m3-production-host-error-args.md`](../results/m3-production-host-error-args.md).
