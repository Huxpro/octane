# Octane on Lynx — #103 storm wire counts (`new-lynx` tip 62b2631a)

Counts for the question the storm milliseconds cannot answer: are the two cells
doing equivalent work? The hypothesis under test was that `octane-block`'s
`write()` supersede lets a storm's intermediate states skip the wire while the
`octane` cell pays for each — which would make its storm numbers a smaller job
rather than a faster one.

**The counts refute it, in the opposite direction.** Over a 30-tick select
storm at 10,000 rows the `octane` cell puts **2** host commands on the wire and
`octane-block` puts **32**. The universal core is the one that collapses the
storm hardest; the block cell ships sixteen times more of the work, and the
same-window ratio is 0.85×, not a 25× win.

What each cell does with the same driver script:

- **Neither ships one commit per tick.** 50 update ticks become 7 background
  commits (`octane`) or 3 (`octane-block`); 30 select ticks become 7 or 2. The
  driver cannot be what merged them — every tick is posted through its own
  `MessageChannel` macrotask — so both cores coalesce renderer-side.
- **`octane` coalesces to the net change, and dispatches empty commits.** Of its
  7 select-storm commits, 6 carry no host command at all; the one that does
  carries 2 — exactly the difference between the tree before the storm and after
  it (the previously selected row loses `danger`, row 0 gains it). All 30
  intermediate selections render and none reaches the host. `clear` is the same
  shape: 7 commits, 6 empty, one carrying all 100,000 commands — a single batch
  with empty commits around it, not a batch split into chunks.
- **`octane-block` emits eagerly and never dispatches an empty commit.** Its 32
  select-storm commands are the distinct hosts its ticks touched, which is what
  in-frame supersede can reach and no further — the residual `block-counts.mjs`
  names for `selectStormOneFrame`, now observed in a browser.
- **On `updateStorm` both carry the net change per commit** (1,000 rows at 10k
  scale); the block cell ships fewer copies of it because it flushed fewer
  times.

Neither cell is mislabeled and no driver script needs correcting. What does
need saying is that a storm's wall clock is a function of how many ticks landed
inside each in-flight window — a race between the tick and the commit
round-trip that moves with host speed and load. `octane`'s select-storm commit
count ranged 4–9 within this one n=5 session. A storm ratio is therefore
readable only against a same-window control, and never across sessions; the
README's "What the storm cells actually measure" is the standing form of that.

The octane cells here were served from `OCTANE_LYNX_PROFILE=1` bundles, which
carry the profiler's branches. The counts are the result; the milliseconds in
this file are not the shipping configuration and belong beside
`web-b0-recheck.md`, which is.

# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-22T20:25:09.561Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz (medians of n=5, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.40/0.94/0.91, end 1.73/1.23/1.02 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9
- **counter build**: the octane cells were served from `OCTANE_LYNX_PROFILE=1` bundles, which carry the wire profiler's branches. The wire-count tables below are the result of this run; the milliseconds are not the shipping configuration and must not be quoted beside a default-build session.

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block |
|---|---|---|
| create | 244 ±13 | 201 ±11 |
| update10th | 37 ±5 | 18 ±4 |
| select | 28 ±1 | 12 ±1 |
| updateStorm | 132 ±11 | 41 ±14 |
| selectStorm | 22 ±8 | 22 ±5 |
| clear | 106 ±14 | 126 ±6 |

### octane-block ÷ octane (1,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 244 | 201 | 0.82× |
| update10th | 37 | 18 | 0.49× |
| select | 28 | 12 | 0.42× |
| updateStorm | 132 | 41 | 0.31× |
| selectStorm | 22 | 22 | 0.99× |
| clear | 106 | 126 | 1.19× |

### octane — wire counts (1,000 rows)

Commits dispatched by the background renderer and applied by the main thread, and the host commands they carried, per operation. "Of those, empty" is how many dispatched commits carried no host command at all, which is what separates a large batch split into chunks from a render pass that found nothing to say. These are counts rather than milliseconds, but unlike the floor counts above they are **not** invariants: a tick that renders while a commit is in flight folds into the next commit, so the count depends on how ticks and flushes interleaved on this host. The observed range is printed for that reason and must not be read as noise. The two ends are read across a live boundary, so bg and mt commit counts may differ by one where a commit crossed it; the command totals are what the two ends must agree on.

| op | bg commits | of those, empty | mt commits | bg commands | mt commands |
|---|---:|---:|---:|---:|---:|
| create | 1 | 0 | 1 | 1 | 1 |
| update10th | 1 | 0 | 1 | 100 | 100 |
| select | 1 | 0 | 1 | 1 | 1 |
| updateStorm | 9 (8–11) | 4 (3–4) | 7 (7–10) | 500 (500–700) | 500 (500–700) |
| selectStorm | 8 (5–9) | 7 (4–7) | 7 (5–9) | 2 (2–4) | 2 (2–4) |
| clear | 8 (7–12) | 7 (6–11) | 7 (6–8) | 10,000 | 10,000 |

### octane-block — wire counts (1,000 rows)

Commits dispatched by the background renderer and applied by the main thread, and the host commands they carried, per operation. "Of those, empty" is how many dispatched commits carried no host command at all, which is what separates a large batch split into chunks from a render pass that found nothing to say. These are counts rather than milliseconds, but unlike the floor counts above they are **not** invariants: a tick that renders while a commit is in flight folds into the next commit, so the count depends on how ticks and flushes interleaved on this host. The observed range is printed for that reason and must not be read as noise. The two ends are read across a live boundary, so bg and mt commit counts may differ by one where a commit crossed it; the command totals are what the two ends must agree on.

| op | bg commits | of those, empty | mt commits | bg commands | mt commands |
|---|---:|---:|---:|---:|---:|
| create | 1 | 0 | 1 | 1 | 1 |
| update10th | 1 | 0 | 1 | 100 | 100 |
| select | 1 | 0 | 1 | 1 | 1 |
| updateStorm | 3 (3–4) | 0 | 3 (3–4) | 300 (300–400) | 300 (300–400) |
| selectStorm | 2 | 0 | 2 | 32 | 32 |
| clear | 1 | 0 | 1 | 8,000 | 8,000 |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block |
|---|---|---|
| create | 1821 ±53 | 1619 ±50 |
| update10th | 257 ±10 | 180 ±6 |
| select | 115 ±8 | 89 ±12 |
| updateStorm | 987 ±50 | 701 ±105 |
| selectStorm | 202 ±15 | 173 ±39 |
| clear | 910 ±53 | 1132 ±89 |

### octane-block ÷ octane (10,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 1821 | 1619 | 0.89× |
| update10th | 257 | 180 | 0.70× |
| select | 115 | 89 | 0.78× |
| updateStorm | 987 | 701 | 0.71× |
| selectStorm | 202 | 173 | 0.85× |
| clear | 910 | 1132 | 1.24× |

### octane — wire counts (10,000 rows)

Commits dispatched by the background renderer and applied by the main thread, and the host commands they carried, per operation. "Of those, empty" is how many dispatched commits carried no host command at all, which is what separates a large batch split into chunks from a render pass that found nothing to say. These are counts rather than milliseconds, but unlike the floor counts above they are **not** invariants: a tick that renders while a commit is in flight folds into the next commit, so the count depends on how ticks and flushes interleaved on this host. The observed range is printed for that reason and must not be read as noise. The two ends are read across a live boundary, so bg and mt commit counts may differ by one where a commit crossed it; the command totals are what the two ends must agree on.

| op | bg commits | of those, empty | mt commits | bg commands | mt commands |
|---|---:|---:|---:|---:|---:|
| create | 1 | 0 | 1 | 1 | 1 |
| update10th | 1 | 0 | 1 | 1,000 | 1,000 |
| select | 1 | 0 | 1 | 1 | 1 |
| updateStorm | 7 (7–8) | 3 (3–4) | 6 (6–7) | 4,000 | 4,000 |
| selectStorm | 7 (4–9) | 6 (3–8) | 6 (4–9) | 2 | 2 |
| clear | 7 (5–7) | 6 (4–6) | 6 (5–8) | 100,000 | 100,000 |

### octane-block — wire counts (10,000 rows)

Commits dispatched by the background renderer and applied by the main thread, and the host commands they carried, per operation. "Of those, empty" is how many dispatched commits carried no host command at all, which is what separates a large batch split into chunks from a render pass that found nothing to say. These are counts rather than milliseconds, but unlike the floor counts above they are **not** invariants: a tick that renders while a commit is in flight folds into the next commit, so the count depends on how ticks and flushes interleaved on this host. The observed range is printed for that reason and must not be read as noise. The two ends are read across a live boundary, so bg and mt commit counts may differ by one where a commit crossed it; the command totals are what the two ends must agree on.

| op | bg commits | of those, empty | mt commits | bg commands | mt commands |
|---|---:|---:|---:|---:|---:|
| create | 1 | 0 | 1 | 1 | 1 |
| update10th | 1 | 0 | 1 | 1,000 | 1,000 |
| select | 1 | 0 | 1 | 1 | 1 |
| updateStorm | 3 (2–3) | 0 | 3 (2–3) | 3,000 (2,000–3,000) | 3,000 (2,000–3,000) |
| selectStorm | 2 | 0 | 2 | 32 | 32 |
| clear | 1 | 0 | 1 | 80,000 | 80,000 |
