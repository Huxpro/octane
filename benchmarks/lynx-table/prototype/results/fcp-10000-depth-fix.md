# Mount-create FCP@10000 — octane universal path vs direct-emission prototype

- date: 2026-08-19T06:38:31.277Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.34; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms |
|---|---:|---:|---:|
| octane | 1557.1 | 1510.2–1725.2 | 1557.1 |
| octane-direct | 1038.0 | 952.9–1242.7 | 1038.0 |
| base | 1694.6 | 1464.6–1728.1 | 1694.6 |

Same-window direct/octane FCP ratio: 0.667×
