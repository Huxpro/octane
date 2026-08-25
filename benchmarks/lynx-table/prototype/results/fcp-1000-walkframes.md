# Mount-create FCP@1000 — octane vs octane-direct vs base

- date: 2026-08-24T11:40:33.302Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 0.26; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 290.9 | 250.8–306.6 | 290.9 | 4028 |
| octane-direct | 167.9 | 157.4–174.3 | 167.9 | 0 |
| base | 283.9 | 267.1–308.9 | 283.9 | 4028 |

Same-window direct/octane FCP ratio: 0.577×
