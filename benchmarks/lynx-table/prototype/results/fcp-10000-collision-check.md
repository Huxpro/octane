# Mount-create FCP@10000 — octane universal path vs direct-emission prototype

- date: 2026-08-19T07:11:38.553Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.33; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms |
|---|---:|---:|---:|
| octane | 1752.0 | 1701.8–2107.5 | 1752.0 |
| octane-direct | 1102.2 | 1093.9–1260.3 | 1102.2 |
| base | 1798.7 | 1738.8–1815.8 | 1798.7 |

Same-window direct/octane FCP ratio: 0.629×
