# Mount-create FCP@10000 — octane vs octane-direct vs octane-eager vs octane-bg-announce vs octane-bg-eager

- date: 2026-08-21T18:06:11.847Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.12; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 1540.6 | 1468.4–1606.5 | 1540.6 | 40028 |
| octane-direct | 947.6 | 927.9–1010.0 | 947.6 | 0 |
| octane-eager | 1540.8 | 1438.7–1598.5 | 1540.8 | 40028 |
| octane-bg-announce | 2102.2 | 2089.0–2130.4 | 2102.2 | 0 |
| octane-bg-eager | 2134.9 | 2048.7–2253.2 | 2134.9 | 40028 |

Same-window direct/octane FCP ratio: 0.615×
