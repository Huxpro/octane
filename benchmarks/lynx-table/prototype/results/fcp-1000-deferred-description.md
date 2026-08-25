# Mount-create FCP@1000 — octane vs octane-direct vs octane-base

- date: 2026-08-24T00:43:53.962Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.83; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=11 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs |
|---|---:|---:|---:|---:|
| octane | 207.6 | 197.7–222.2 | 207.6 | 4028 |
| octane-direct | 126.6 | 113.8–153.0 | 126.6 | 0 |
| octane-base | 208.1 | 199.9–234.9 | 208.1 | 4028 |

Same-window direct/octane FCP ratio: 0.610×
