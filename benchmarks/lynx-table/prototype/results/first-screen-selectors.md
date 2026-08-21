# Octane on Lynx — what a first screen costs in `nodes-ref` selectors

Counts, not milliseconds. Both arms run the same app, the same chassis, and
the same counters, and differ in one thing: whether the main thread exists
when the background first renders.

- **before-render** — the handshake completes before the first commit is
  composed. This is the order `run.mjs` measures.
- **after-render** — the background composes its first batch before the
  main-ready reply reaches it, which is the order a production Lynx bundle
  starts in.

`installs` is `nodes-ref` selector writes at the Element PAPI;
`selectable` is the element nodes mounted, which is what an eager main
thread would write one selector for each of. `announces` is the per-commit
promise that the batch names every host it will query — only a commit that
makes it may have its hosts skipped.

- reps: 2 (counts must be identical across them)
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz, node v22.22.2

| rows | arm | selectable | installs | commits | announcement regime |
| ---: | --- | ---: | ---: | ---: | --- |
| 1,000 | before-render | 4,029 | 0 | 1 | `announced-v1` ×1 |
| 1,000 | after-render | 4,029 | 0 | 1 | `announced-v1` ×1 |
| 10,000 | before-render | 40,029 | 0 | 1 | `announced-v1` ×1 |
| 10,000 | after-render | 40,029 | 0 | 1 | `announced-v1` ×1 |

