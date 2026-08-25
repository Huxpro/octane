# Mount-create FCP@10000 — octane vs octane-direct vs octane-base

- date: 2026-08-24T00:35:11.427Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 1.11; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=11 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 1331.6 | 1277.5–1452.9 | 1331.6 | 40028 |
| octane-direct | 888.9 | 811.0–958.0 | 888.9 | 0 |
| octane-base | 1389.7 | 1341.9–1432.1 | 1389.7 | 40028 |

Same-window direct/octane FCP ratio: 0.668×
