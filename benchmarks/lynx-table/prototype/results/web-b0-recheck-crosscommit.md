# Octane on Lynx — universal cell, B0's commit vs `new-lynx` tip, one window

The control the create/clear question actually needs. `octane-block ÷ octane`
reproducing B0's band shows the two cells still stand in the same relation, but
it cannot see a regression that moved both cells together. This session drives
the *same cell* — the universal `octane` build — from two commits in one
window: tip `62b2631a` against `4cbf4ff8`, the commit that recorded B0, 106
commits earlier.

The comparison is clean at the source level: `git diff 4cbf4ff8..62b2631a` over
`benchmarks/lynx-table/app` touches only `block-program.ts`, which the universal
build folds out entirely (`__BENCH_CORE__` in `app/src/index.ts`).
The universal cell's application sources are byte-identical at both commits, and
both bundles are driven by tip's single `web/driver-client.mjs`, so the
framework is the only variable. The older bundle was built from a worktree at
that commit and injected with `--cell-bundle`.

**No regression.** create is 1.02× at 10,000 rows and 0.97× at 1,000 — tip is
marginally faster at 10k, marginally slower at 1k, both inside the session
spread. `clear` is 1.04× and 0.99×. Every op at 10,000 rows lands within 5%.
An earlier n=5 pass in a noisier window put `clear` at 0.89×; n=7 and n=9
passes both put it at 1.04×, so that dip was the instrument, not the code.

**What this rules in.** The same bundle whose create@10k the B0 record has at
1,234 ms measures ~1,741 ms in this window. Dividing a number measured here by
a number recorded there yields ≈1.4× for a build that has not changed — which
is the size of the create anomaly being investigated. A ratio whose numerator
and denominator come from different sessions measures the two hosts, not the
two builds.

# Octane on Lynx — unified table benchmark (Lynx for Web)

- date: 2026-08-22T20:32:26.073Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.80GHz (medians of n=7, cells interleaved AB/BA per repetition; absolute ms are host-bound, ratios are the portable claim)
- host load: start 0.47/0.87/0.92, end 1.80/1.41/1.13 (1/5/15m over 4 CPUs)
- references: https://github.com/Huxpro/vue-lynx @ 02376ecd1cd62d3797ff1de1209d82dc2f9d91d9

## 1,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-b0 |
|---|---|---|
| create | 202 ±7 | 196 ±4 |
| update10th | 36 ±3 | 35 ±3 |
| select | 31 ±3 | 27 ±5 |
| updateStorm | 103 ±13 | 117 ±11 |
| selectStorm | 27 ±4 | 27 ±4 |
| clear | 98 ±2 | 97 ±5 |

### octane-b0 ÷ octane (1,000 rows, same window)

| op | octane | octane-b0 | ratio |
|---|---:|---:|---:|
| create | 202 | 196 | 0.97× |
| update10th | 36 | 35 | 0.96× |
| select | 31 | 27 | 0.88× |
| updateStorm | 103 | 117 | 1.14× |
| selectStorm | 27 | 27 | 1.00× |
| clear | 98 | 97 | 0.99× |

## 10,000 rows (median ms; ×vs vue-vdom)

| op | octane | octane-b0 |
|---|---|---|
| create | 1714 ±29 | 1741 ±54 |
| update10th | 260 ±11 | 260 ±14 |
| select | 119 ±5 | 126 ±7 |
| updateStorm | 1032 ±49 | 999 ±55 |
| selectStorm | 210 ±14 | 210 ±23 |
| clear | 903 ±47 | 941 ±50 |

### octane-b0 ÷ octane (10,000 rows, same window)

| op | octane | octane-b0 | ratio |
|---|---:|---:|---:|
| create | 1714 | 1741 | 1.02× |
| update10th | 260 | 260 | 1.00× |
| select | 119 | 126 | 1.05× |
| updateStorm | 1032 | 999 | 0.97× |
| selectStorm | 210 | 210 | 1.00× |
| clear | 903 | 941 | 1.04× |
