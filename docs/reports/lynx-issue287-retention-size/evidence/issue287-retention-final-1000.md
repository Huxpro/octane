# Compact adoption forced-GC lifecycle — 1,000 rows

Commit `7d9b6707d5e36d3e6440971d464e5d11192f9fa8`; 5 fresh pages; Chromium 149.0.7827.55.

| phase | used heap median (range) | live runs | live hosts | promoted hosts |
| --- | ---: | ---: | ---: | ---: |
| fresh | 1.88 MiB (1.88–1.89) | n/a | n/a | n/a |
| handOver | 7.99 MiB (7.99–8.02) | 1 | 4000 | 0 |
| sparseUpdate | 8.01 MiB (8.00–8.03) | 1 | 3999 | 1 |
| unmount | 7.93 MiB (7.93–7.96) | 0 | 0 | 1 |
| close | 4.68 MiB (4.68–4.68) | 0 | 0 | 1 |
