# Mount-create FCP@30000 — octane vs octane-direct vs base

- date: 2026-08-24T12:01:22.030Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 1.22; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=15 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 5506.5 | 5026.9–5784.4 | 5506.5 | 120028 |
| octane-direct | 3032.9 | 2773.8–3267.4 | 3032.9 | 0 |
| base | 5555.6 | 5144.6–6824.4 | 5555.6 | 120028 |

Same-window direct/octane FCP ratio: 0.551×
