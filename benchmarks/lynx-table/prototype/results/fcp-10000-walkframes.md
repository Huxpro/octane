# Mount-create FCP@10000 — octane vs octane-direct vs base

- date: 2026-08-24T11:41:48.515Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 0.46; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 1864.0 | 1727.8–2032.5 | 1864.0 | 40028 |
| octane-direct | 1086.5 | 1044.8–1461.0 | 1086.5 | 0 |
| base | 1873.6 | 1772.6–2073.8 | 1873.6 | 40028 |

Same-window direct/octane FCP ratio: 0.583×
