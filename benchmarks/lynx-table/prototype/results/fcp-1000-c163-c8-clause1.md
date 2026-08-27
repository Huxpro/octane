# Mount-create FCP@1000 — octane vs octane-direct vs octane-mts-program vs octane-block-program

- date: 2026-08-26T11:22:27.897Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.51; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=15 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs | first frame rows/selectors |
|---|---:|---:|---:|---:|---:|
| octane | 238.7 | 228.3–267.6 | 238.7 | 4028 | 1000/4028 |
| octane-direct | 143.2 | 134.2–218.1 | 143.2 | 0 | 1000/0 |
| octane-mts-program | 189.1 | 181.0–215.2 | 189.1 | 0 | 1000/0 |
| octane-block-program | 186.0 | 173.5–205.4 | 186.0 | 0 | 1000/0 |

Same-window direct/octane FCP ratio: 0.600×
