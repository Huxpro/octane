# S3 heap snapshot census and delta analysis

All captures use one live 10k-row page after explicit CDP GC. The raw snapshots
are intentionally excluded from Git; these hashes identify the archived local
captures and `snapshots-raw.json` records their byte sizes and runner metadata.

| head | bytes | SHA-256 | total self size |
| --- | ---: | --- | ---: |
| main | 298,367,082 | `b1d6c3ad75470a9ce837359d7ccf1b71206c091a52d4bae34252a757e0df31b5` | 136.62 MiB |
| pr-12 | 311,634,696 | `7e33ac0e455fb3b11d490f532de314ad12487c76431b5eb73c3eefe8ff045310` | 142.00 MiB |
| pr-14 | 335,290,934 | `bf3c055bd2d0c78198dbafe42b0bad75e6b8177e48c2e2443d0078e7bd8bc6f9` | 151.11 MiB |
| pr-22 | 335,281,372 | `8366665569b01ef52bd4ad9663bf3a11e4c3a2c5121468986930009e4cd32b76` | 151.12 MiB |

The bundled Lynx heap analyzer finds one live `multiApps` entry in every
capture, as expected for the mounted page. There is no stale second page and
the runner separately proves that the worker target disappears after each
sample. The `sharedDataSubject` paths are the current page's normal
registration, not a cross-page leak.

## Dominant census at pr-22

| family | count | self size | share |
| --- | ---: | ---: | ---: |
| arrays | 920,559 | 77.00 MiB | 51.0% |
| objects | 2,291,610 | 59.93 MiB | 39.7% |
| concatenated strings | 430,476 | 8.21 MiB | 5.4% |
| strings | 100,476 | 2.06 MiB | 1.4% |

The attribution bundle's `__OCTANE_PROFILER__` is a visible observer root
(reachable upper bound 9.83 MiB), so the report also includes unprofiled
main/pr-22 controls. Structural conclusions use the control slope; the full
stack profile matrix is used only to identify relative steps and object work.

## Material slope steps

- `main → pr-12`: +5.38 MiB at 10k. The class delta is dominated by 40,002
  object-element arrays (+2.52 MiB), 70,013 objects (+1.95 MiB), 40,006 Array
  objects (+625 KiB), and 20,012 contexts (+391 KiB). This matches the
  plan-aware wire's retained plan/value materialization families.
- `pr-12 → pr-14`: +9.11 MiB at 10k. The dominant additions are 420,278
  concatenated strings (+8.02 MiB), 70,042 arrays (+5.91 MiB), 70,042 objects
  (+2.40 MiB), and 70,041 Sets (+1.07 MiB). Source correlation points to the
  protocol-slimming topology mirror introduced between those heads (one
  topology entry and child set per accepted host plus ancestry bookkeeping).
- `pr-14 → pr-22`: no material change (snapshot totals differ by 0.01 MiB and
  the formal slope is unchanged).

The diffs were produced by the bundled `lynx-js-heap-snapshot-analysis`
analyzer rather than a repository-local heap parser.
