# Mount-create FCP@10000 — octane vs octane-direct vs octane-mts-program vs octane-block-program

- date: 2026-08-26T11:27:23.659Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.92; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=15 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms | selector attrs | first frame rows/selectors |
|---|---:|---:|---:|---:|---:|
| octane | 1603.3 | 1476.5–1741.6 | 1603.3 | 40028 | 10000/40028 |
| octane-direct | 1034.7 | 969.5–1134.5 | 1034.7 | 0 | 10000/0 |
| octane-mts-program | 1256.4 | 1148.5–1350.3 | 1256.4 | 0 | 10000/0 |
| octane-block-program | 1249.0 | 1165.0–1463.9 | 1249.0 | 0 | 10000/0 |

Same-window direct/octane FCP ratio: 0.645×
