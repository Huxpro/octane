# Mount-create FCP@10000 — octane vs octane-direct vs base

- date: 2026-08-24T11:50:28.288Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 0.33; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=15 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 1816.6 | 1693.3–2048.5 | 1816.6 | 40028 |
| octane-direct | 1124.7 | 1022.2–1220.0 | 1124.7 | 0 |
| base | 1830.5 | 1765.6–1966.2 | 1830.5 | 40028 |

Same-window direct/octane FCP ratio: 0.619×
