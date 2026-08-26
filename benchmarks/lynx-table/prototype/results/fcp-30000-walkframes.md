# Mount-create FCP@30000 — octane vs octane-direct vs base

- date: 2026-08-24T11:45:26.892Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 1.48; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 5340.6 | 5171.7–5766.3 | 5340.6 | 120028 |
| octane-direct | 2950.7 | 2898.8–3046.0 | 2950.7 | 0 |
| base | 5681.1 | 5308.5–6136.5 | 5681.1 | 120028 |

Same-window direct/octane FCP ratio: 0.553×
