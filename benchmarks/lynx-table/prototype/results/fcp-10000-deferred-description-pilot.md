# Mount-create FCP@10000 — octane vs octane-direct vs octane-base

- date: 2026-08-24T00:32:40.671Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 1.32; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 1340.3 | 1328.8–1382.3 | 1340.3 | 40028 |
| octane-direct | 870.9 | 826.7–1057.0 | 870.9 | 0 |
| octane-base | 1397.3 | 1345.0–1414.0 | 1397.3 | 40028 |

Same-window direct/octane FCP ratio: 0.650×
