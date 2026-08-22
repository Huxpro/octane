# Octane on Lynx — #103 B0 re-measurement on `new-lynx` tip (62b2631a)

Session record for the forensics on the two clusters where a public-runner
table disagreed with the B0 record (`web-b0-block-cell.md`): create/clear
reading far worse, and the select/selectStorm cells reading far better.

This is the same protocol B0 used — same-window, fresh page per sample, cells
interleaved AB/BA, n=5, quiet host at the start of the window, default
(non-profiler) bundles, `octane` and `octane-block` at 1,000 and 10,000 rows —
run against tip instead of B0's commit. `clear` is measured here for the first
time; it runs last, after every op B0 measured, so each earlier op sees the
tree it saw before `clear` existed and the two sessions stay comparable.

**create reproduces B0's band.** 0.90× at 10,000 rows against B0's recorded
0.88×, and 0.81× at 1,000 against B0's 0.91×. Nothing in the create cluster
survives a same-window measurement.

**`clear` is the one cell where the block core is slower**, 1.27× at 10,000
rows and 1.08× at 1,000 — reproduced at 1.24×/1.19× in the counter-build
session (`web-b0-recheck-counts.md`). That is not a regression on `new-lynx`:
the cross-commit control (`web-b0-recheck-crosscommit.md`) shows the universal
cell's own `clear` unchanged since B0. It is a standing property of the block
cell that had no prior record, because the harness could not measure `clear`
until this session.

**The storm cells moved and the counts say why.** `selectStorm` reads 1.31×
here against B0's 0.83×. It is a coalescing race, not a speed: see
`web-b0-recheck-counts.md` and the README's "What the storm cells actually
measure". Absolute ms are host-bound; only same-window ratios are claimed, and
for the storm cells not even those travel between sessions.

# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-22T20:28:28.926Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz (medians of n=5, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.45/0.93/0.94, end 1.29/1.07/0.98 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block |
|---|---|---|
| create | 218 ±9 | 177 ±15 |
| update10th | 37 ±4 | 23 ±4 |
| select | 29 ±1 | 11 ±5 |
| updateStorm | 111 ±6 | 39 ±14 |
| selectStorm | 30 ±5 | 20 ±4 |
| clear | 112 ±7 | 120 ±4 |

### octane-block ÷ octane (1,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 218 | 177 | 0.81× |
| update10th | 37 | 23 | 0.63× |
| select | 29 | 11 | 0.39× |
| updateStorm | 111 | 39 | 0.35× |
| selectStorm | 30 | 20 | 0.68× |
| clear | 112 | 120 | 1.08× |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-block |
|---|---|---|
| create | 1730 ±71 | 1550 ±56 |
| update10th | 249 ±4 | 181 ±10 |
| select | 118 ±3 | 105 ±24 |
| updateStorm | 1012 ±28 | 688 ±102 |
| selectStorm | 189 ±19 | 247 ±38 |
| clear | 923 ±62 | 1168 ±28 |

### octane-block ÷ octane (10,000 rows, same window)

| op | octane | octane-block | ratio |
|---|---:|---:|---:|
| create | 1730 | 1550 | 0.90× |
| update10th | 249 | 181 | 0.73× |
| select | 118 | 105 | 0.89× |
| updateStorm | 1012 | 688 | 0.68× |
| selectStorm | 189 | 247 | 1.31× |
| clear | 923 | 1168 | 1.27× |
