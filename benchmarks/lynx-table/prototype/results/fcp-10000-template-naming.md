# Mount-create FCP@10000 — octane universal path vs direct-emission prototype

- date: 2026-08-19T07:40:26.357Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; load at start 0.28; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=5 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms |
|---|---:|---:|---:|
| octane | 1584.6 | 1524.0–1607.3 | 1584.6 |
| octane-direct | 975.5 | 958.7–990.3 | 975.5 |
| base | 1604.1 | 1547.5–1687.4 | 1604.1 |

Same-window direct/octane FCP ratio: 0.616×
