# Mount-create FCP@30000 — octane vs octane-direct vs octane-mts-program vs octane-block-program

- date: 2026-08-26T11:41:42.117Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 1.69; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=15 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs | first frame rows/selectors |
|---|---:|---:|---:|---:|---:|
| octane | 4955.0 | 4744.7–5366.2 | 4955.0 | 120028 | 30000/120028 |
| octane-direct | 2703.5 | 2561.3–2938.5 | 2703.5 | 0 | 30000/0 |
| octane-mts-program | 3537.9 | 3345.4–3779.9 | 3537.9 | 0 | 30000/0 |
| octane-block-program | 3545.2 | 3338.1–3747.9 | 3545.2 | 0 | 30000/0 |

Same-window direct/octane FCP ratio: 0.546×
