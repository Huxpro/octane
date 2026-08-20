# Mount-create FCP@10000 — octane universal path vs direct-emission prototype

- date: 2026-08-20T10:16:35.834Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz; load at start 0.49; Node v22.22.2
- protocol: fresh page per sample; cells alternate AB/BA; n=30 per cell
- boundary: view attach → first frame with the shared composed-tree predicate

| cell | median fcp ms | min–max | median settled ms |
|---|---:|---:|---:|
| octane | 2599.1 | 2307.2–2783.0 | 2599.1 |
| octane-direct | 1534.0 | 1407.2–1898.6 | 1534.0 |
| octane-baseline | 2751.6 | 2519.4–3098.2 | 2751.6 |

Same-window direct/octane FCP ratio: 0.590×
