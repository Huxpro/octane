# Octane on Lynx — #103 U0 re-run on the real specialized core

Counts, not milliseconds. Deterministic for this app and this interaction,
so they carry across hosts and sessions; no wall clock is measured here.
Both columns run the real `LynxBlockCore` on the real background transport
against the real main-thread receiver — the same chassis `run.mjs` uses for
the `octane-lynx` column. Only the entry point the state change reaches
differs:

- **scoped** — what a compiled block program with per-row reactive slots
  would do: write the changed rows' slots by key.
- **reconcile** — what the app's own `setRows(next)` does today: hand the
  whole next list to the keyed reconciler.

`lookups` is the core's own `blockLookups` counter: blocks visited to
service the operation. `floor` is the semantic lower bound — what a change
of that size strictly implies. `swap` has no floor because this slice has
no scoped move, so a structural reorder goes through the keyed reconciler
in both columns; that gap is named rather than scored.

- reps: 2 (counts must be identical across them; a difference is a defect, not noise)
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz, node v22.22.2
- storm ticks: update 50, select 30

## 1,000 rows

| op | commits | commands | wire bytes | lookups (scoped) | lookups (reconcile) | floor |
|---|---:|---:|---:|---:|---:|---:|
| create | 1 | 1 | 33,598 | **0** | 0 | 0 |
| update10th | 1 | 100 | 7,036 | **100** | 1,000 | 100 |
| select | 1 | 2 | 225 | **2** | 1,000 | 2 |
| swap | 1 | 2 | 218 | **1,000** | 1,000 | — |
| updateStorm | 50 | 5,000 | 279,544 | **5,000** | 50,000 | 5,000 |
| selectStorm | 30 | 60 | 6,918 | **60** | 30,000 | 60 |

Both columns painted 1,000 rows over 7,042 host elements and sent byte-identical wire at every op: the drive mode changes what it costs to produce a frame, never the frame.

## 10,000 rows

| op | commits | commands | wire bytes | lookups (scoped) | lookups (reconcile) | floor |
|---|---:|---:|---:|---:|---:|---:|
| create | 1 | 1 | 338,059 | **0** | 0 | 0 |
| update10th | 1 | 1,000 | 70,273 | **1,000** | 10,000 | 1,000 |
| select | 1 | 2 | 225 | **2** | 10,000 | 2 |
| swap | 1 | 2 | 218 | **10,000** | 10,000 | — |
| updateStorm | 50 | 50,000 | 2,789,294 | **50,000** | 500,000 | 50,000 |
| selectStorm | 30 | 60 | 6,954 | **60** | 300,000 | 60 |

Both columns painted 10,000 rows over 70,042 host elements and sent byte-identical wire at every op: the drive mode changes what it costs to produce a frame, never the frame.

