# Mount-create FCP@30000 — octane vs octane-direct vs octane-base

- date: 2026-08-24T00:42:55.945Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 1.75; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=9 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 3981.7 | 3876.8–4164.4 | 3981.7 | 120028 |
| octane-direct | 2372.9 | 2276.6–2510.8 | 2372.9 | 0 |
| octane-base | 4175.9 | 4056.3–4485.0 | 4175.9 | 120028 |

Same-window direct/octane FCP ratio: 0.596×
