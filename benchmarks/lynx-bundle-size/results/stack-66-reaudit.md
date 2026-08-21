# L5 bundle re-audit on the unmerged issue-#66 stack

Issue #58's L5 cutover gate asks for "main-thread gzip meaningfully toward the
~51 KB median (propose ≤1.5× as the target)". Issue #66 §6 records the note that
#95 already repaid #63's module-level gzip trade, so this milestone should
**re-verify rather than re-pay**. This is that re-verification.

It is not the report next to it. [`production-inventory.md`](production-inventory.md)
is the frozen baseline taken on upstream `ffadd397`, and its numbers and budgets
stand as recorded. This one measures the tree the #66 execution actually
produced, against the branch that tree is stacked on.

## Protocol

Two arms, same host, same session, same commands:

- **base** — `origin/new-lynx` `5d61724`, the integration base for the whole #66
  stack.
- **head** — `perf/lynx-direct-first-screen-lists` `566700e`, the tip of the
  unmerged stack (Phase 1 delta protocol v2 → #103 U2b block core → Phase B →
  Phase C).

Both metrics are deterministic bytes, not wall clock, so they are exact and do
not depend on host quiet. `run.mjs` builds the `App.lynx.tsrx` fixture in the
preview and IFR shapes; `inventory.mjs` builds the rows-0 `lynx-table` app in
Lynx and Web production modes. The inventory arm ran with
`OCTANE_INVENTORY_CALIBRATE=1`, which skips the frozen-budget gates so the whole
metric set is collected instead of aborting on the first breach; no budget was
edited to obtain any number here.

## The frozen budgets are already red on the base

Every frozen budget except one is breached on `origin/new-lynx`, before a single
commit of this stack. They were calibrated on upstream `ffadd397`, and
`new-lynx` has moved since.

| gate | budget | base `new-lynx` | head `566700e` |
|---|---:|---:|---:|
| preview main gzip | 77,286 | 79,491 ✗ | 81,212 ✗ |
| IFR main gzip | 82,274 | 85,106 ✗ | 87,016 ✗ |
| preview background raw (must equal) | 272,504 | 277,052 ✗ | 278,520 ✗ |
| rows-0 web raw | 485,345 | 489,394 ✗ | 493,596 ✗ |
| rows-0 web gzip | 132,334 | 134,200 ✗ | 135,495 ✗ |
| rows-0 lynx raw | 474,618 | 479,350 ✗ | 483,375 ✗ |
| rows-0 lynx gzip | 159,077 | 161,888 ✗ | 163,744 ✗ |
| rows-0 lynx main raw | 203,712 | 208,894 ✗ | 213,096 ✗ |
| rows-0 lynx main gzip | 57,563 | 59,494 ✗ | 60,783 ✗ |
| rows-0 lynx background raw | 277,505 | 276,387 ✓ | 276,387 ✓ |
| rows-0 lynx background gzip | 74,381 | 74,414 ✗ | 74,418 ✗ |

`node benchmarks/bench.mjs --ratios lynx-bundle-size` therefore fails on the base
and on the head, and it fails first on `preview main gzip` in both. Re-freezing
the budgets is a deliberate act on a chosen tree, so this audit deliberately does
not do it from a feature branch; what it can do is say exactly how much of the
breach each side owns, which is the table below.

## What the stack costs, increment by increment

`run.mjs` on seven cut points of the same stack. Every figure is deterministic
and exact.

| arm | commit | preview main gzip | Δ base | step | IFR main gzip | background raw |
|---|---|---:|---:|---:|---:|---:|
| base `new-lynx` | `5d61724` | 79,491 | — | — | 85,106 | 277,052 |
| #103 U2b block core | `af33496` | 79,491 | +0 | **+0** | 85,105 | 278,520 |
| Phase B end | `fbccb04` | 79,794 | +303 | +303 | 85,442 | 278,520 |
| C1 decline (#110) | `5ac4c9b` | 80,108 | +617 | +314 | 85,828 | 278,520 |
| C2a binding (#111) | `6e52ff8` | 80,161 | +670 | +53 | 85,864 | 278,520 |
| C2b adoption (#112) | `f34bea7` | 80,682 | +1,191 | +521 | 86,412 | 278,520 |
| C3 direct lists (#113) | `566700e` | 81,212 | **+1,721** | +530 | 87,016 | 278,520 |

Two things fall out of the shape of that ladder.

**The specialized background core costs the main thread nothing.** #103's block
core moves preview main gzip by 0 bytes and IFR main gzip by −1. Its whole
footprint lands where it belongs, on the background program: +1,468 B raw, once,
and flat from there. A per-root flag that ships a second core did not tax the
thread it does not run on.

**Every byte of main-thread growth is first-screen work.** +1,721 B gzip
(+2.17%) across Phase B and Phase C. The largest single step is C3 at +530 B,
which buys the 1,000-row native-list first screen going from 42.5 ms to 29.5 ms;
C2b at +521 B is what made that page adoptable at all, taking it from 70.4 ms.
C1 is the one step that reads oddly at +314 B: it added a pre-check walk that
C2b then deleted, and C2b still grew, because what replaced it is the adoption
journal for rows that were never painted.

## Where the bytes went

The rows-0 inventory attributes each artifact's raw total by production
reachable-module weight. The **reachable** column is the direct measure — how
much transformed module source each owner contributes — and it is the honest one
to read for growth. The attributed-artifact column is a proportional
prioritization ledger, exactly as `production-inventory.md` says: an owner can
appear to shrink there purely because another grew, and none of it may be
converted into a gzip claim.

| owner | reachable raw, base | head | Δ |
|---|---:|---:|---:|
| main-thread build/runtime wrapper | 561,480 | 582,902 | +21,422 |
| host driver / PAPI | 235,177 | 256,576 | +21,399 |
| first screen / adoption | 193,733 | 201,015 | +7,282 |
| other Lynx runtime | 227,939 | 234,272 | +6,333 |
| compiler-emitted app/background program | 874,572 | 880,790 | +6,218 |
| every other owner | — | — | 0 |
| total | 3,006,209 | 3,068,863 | +62,654 |

The first two rows move almost identically because they are largely the same
code seen twice: the main-thread build wrapper is where `host-driver.ts` lands
after layering, so a change there is counted in both slices. The compiler row is
real and belongs to the stack too — Phase 1 changed range-site marking and the
delta protocol encoding.

Both artifacts' raw totals grew by the same 4,202 B, and the entire Lynx-side
growth is on main:

| section | base | head | Δ |
|---|---:|---:|---:|
| rows-0 lynx main raw | 208,894 | 213,096 | +4,202 |
| rows-0 lynx background raw | 276,387 | 276,387 | **0** |

## Against #58's ≤1.5× target

The reference median is 51,228 B Lynx gzip, carried from the pre-stack
cross-framework run recorded in `production-inventory.md`. It is a **constant,
not a reproducible measurement**: only the three references' `.web.bundle`
fixtures are vendored (`benchmarks/lynx-table/reference/`), the median was taken
over five Lynx-mode configs, and nothing in this repository rebuilds them. Every
ratio below inherits that.

| what is compared | base | head | ratio, head |
|---|---:|---:|---:|
| `App.lynx.tsrx` preview main gzip | 79,491 | 81,212 | **1.585×** |
| `App.lynx.tsrx` IFR main gzip | 85,106 | 87,016 | **1.699×** |
| rows-0 lynx main gzip | 59,494 | 60,783 | **1.187×** |
| rows-0 lynx complete artifact gzip | 161,888 | 163,744 | 3.196× |

**The gate's verdict depends on which fixture answers it, and #58 does not say.**
On the `lynx-bundle-size` fixture — the one whose budgets are the checked gate —
main-thread gzip is 1.585× and the target is missed, having been missed at
1.552× on the base too. On the rows-0 `lynx-table` app it is 1.187× and the
target is met with room. The two disagree because the fixtures are different
applications, not because either measurement is wrong.

The complete-artifact row is the number #58's motivation section quotes as
"3.11× the competition"; it is 3.196× here, and it is the only one of the four
that compares like with like, since 51,228 B is itself a complete-artifact
median.

## What this milestone concludes

1. **The #63 trade is not what is outstanding.** #95 repaid it and nothing in
   this stack re-incurs it; the ladder shows the compiler-side arm at +0 on main
   gzip. The re-verification asked for by #66 §6 holds.
2. **The ≤1.5× target is not met on the gated fixture, and was not met before
   this stack.** The stack widens the miss from 1.552× to 1.585×. Closing it
   needs what #58's L5 bullet actually names — deleting the plan interpreter,
   the batch pipeline, and the recursive validator from the main-thread bundle —
   and none of those three is deletable yet: the staged batch path is still the
   fallback the direct applier needs, and `validateLynxBackgroundInboundMessage`
   still runs on every inbound message.
3. **The stack's own cost is +1,721 B main gzip (+2.17%), all of it first
   screen, and it is a trade with a measured other side** — a 1,000-row
   native-list page appearing at 29.5 ms instead of 70.4 ms. Whether to take it
   is the owner's call; this report exists so the call is made on the exact
   number.
4. **The frozen budgets need a deliberate recalibration on a chosen tree.** They
   are red on `new-lynx` today, which makes the gate unable to report a
   regression. That recalibration is not done here, from a feature branch,
   because re-freezing on the branch that grew the number would launder the
   growth into the baseline.

## Scope

Source and build evidence only. Decoding a production artifact executes no Lynx
engine and makes no native startup, first-paint, adoption, latency, memory, or
device-lifecycle claim.
