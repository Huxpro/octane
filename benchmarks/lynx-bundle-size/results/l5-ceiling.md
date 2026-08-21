# What the L5 main-thread repayment is worth

Issue #58's L5 bullet asks for the accepted bundle trade to be repaid by
"deleting the plan interpreter, batch pipeline, and recursive validator from the
main-thread bundle", and issue #66 §6 makes that a cutover gate against ≤1.5× the
reference median. The
[L5 re-audit](https://github.com/Huxpro/octane/pull/114) established that the
gate is missed — 1.585× on the fixture whose budgets are the checked gate — and
that none of the three is deletable yet. What no milestone has said is **how much
the deletion is worth**, which is the one number the cutover decision needs and
does not have.

This measures it. It is a ceiling, not a forecast, and it deletes nothing.

## Protocol

`l5-ceiling.mjs` builds the same two production artifacts the suite already
builds, once per arm, with one target's whole transitive closure absent:

| arm | what is removed | how |
|---|---|---|
| baseline | nothing | — |
| recursive validator | `validateLynxBackgroundOutboundMessage`, `validateLynxBackgroundInboundMessage`, `selfCheckLynxBackgroundInboundMessage` and the `assert*` tree only they reach | the three exported entries return their argument |
| plan interpreter + batch pipeline | `prepareLynxHostBatch` and every helper only it reaches | the exported entry throws |
| both | both of the above | both |

Removal is by **exported entry**, and production tree-shaking computes the
closure. That is what makes the number honest in the direction that matters: a
helper the direct first-screen path still calls stays in the bundle and is not
counted against the repayment. The tool refuses to start unless
`packages/lynx/src/core` is clean and restores it in a `finally`, so no arm can
survive its own run.

Both metrics are deterministic bytes, not wall clock, so they are exact and do
not depend on host quiet. Measured on the tip of the #103 U4 stack,
`feat/lynx-universal-prop-equality` `cfae829`, one host, one session.

### Why this is a ceiling and not a forecast

Each arm deletes its target outright; the shipping change replaces it.

- #66 §3's exit gate keeps **header checks** on delta traffic. This arm keeps
  none, so it also collects the type narrowing and the diagnostics a
  header-checking replacement would keep.
- `prepareLynxHostBatch` stays reachable while the staged path is the direct
  applier's fallback — today every native-`<list>` page — and while the
  universal path remains the transition core per #103 §4. This arm removes it
  unconditionally.

So the repayment collects **less** than what follows. The question the number
answers is whether the gate's gap is small against the prize, and it is.

### The control

An ablation may delete machinery, never application. Every arm reproduces the
baseline's IFR main-thread visible-tree checksum and background-program semantic
checksum exactly (`4898497c…` / `29f4920e…`); the tool fails the run if one
moves. The batch arm leaves the background program **byte-identical** on both
fixtures, which is the independent evidence that `prepareLynxHostBatch` is
main-thread-only code. And the baseline reproduces byte-for-byte across repeated
runs, so every delta below is signal.

## The gated fixture (`App.lynx.tsrx`, `run.mjs`)

| arm | preview main gzip | Δ | ratio | IFR main gzip | Δ | ratio |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 81,068 | — | 1.582× | 86,793 | — | 1.694× |
| recursive validator | 73,000 | −8,068 (−9.95%) | 1.425× | 77,818 | −8,975 (−10.34%) | 1.519× |
| plan interpreter + batch pipeline | 55,139 | −25,929 (−31.98%) | **1.076×** | 59,739 | −27,054 (−31.17%) | 1.166× |
| both | **46,411** | **−34,657 (−42.75%)** | **0.906×** | **50,298** | **−36,495 (−42.05%)** | **0.982×** |

Raw bytes move the same way: preview main raw 195,319 → 171,658 → 134,433 →
110,167 B.

## The rows-0 fixture (`lynx-table` app, `inventory.mjs`)

| arm | main raw | main gzip | Δ gzip | ratio | background raw |
|---|---:|---:|---:|---:|---:|
| baseline | 212,290 | 60,683 | — | 1.185× | 279,760 |
| recursive validator | 185,007 | 53,376 | −7,307 (−12.04%) | 1.042× | 252,310 |
| plan interpreter + batch pipeline | 143,926 | 40,657 | −20,026 (−33.00%) | 0.794× | 279,760 (=) |
| both | 116,332 | 33,178 | −27,505 (−45.32%) | 0.648× | 252,310 |

The re-audit found these two fixtures disagreeing about the gate — 1.585× against
1.187× — because they are different applications. **They do not disagree about
the repayment.** Both put it at roughly two fifths of the main-thread program,
and both land under the median once it is collected.

## Against #58's ≤1.5× target

The reference median is 51,228 B Lynx gzip, so the target is 76,842 B. It is a
recorded constant carried from [`production-inventory.md`](production-inventory.md),
not something this repository rebuilds; every ratio above inherits that.

| arm | gap to 76,842 on preview main |
|---|---:|
| baseline | **4,226 B over** |
| recursive validator | 3,842 B under |
| plan interpreter + batch pipeline | 21,703 B under |
| both | 30,431 B under |

**The gate's gap is 4,226 B and the repayment's ceiling is 34,657 B — a
repayment that collects an eighth of what is on the table still closes it.** On
the IFR arm the gap is 9,951 B and the validator alone falls 976 B short, so that
arm needs the batch pipeline; the batch pipeline alone clears both.

Two things this does **not** say:

- It does not close the **complete-artifact** ratio, which is the one #58's
  motivation quotes and the only one that compares like with like, since 51,228 B
  is itself a complete-artifact median. On rows-0 that ratio walks 3.214× →
  2.906× → 2.685× → 2.361× across the four arms. L5 is a main-thread gate; the
  artifact gate is a different, larger question, and the full repayment moves it
  by a quarter.
- It does not license reading the two halves separately and adding them.
  Compressed deltas are not additive, and here they are slightly **super**-additive:
  8,068 + 25,929 = 33,997 B against 34,657 B measured together on preview main,
  and 7,307 + 20,026 = 27,333 B against 27,505 B on rows-0. Each half opens
  removals in the other.

## What this authorizes

Nothing yet — this is measurement. It removes one unknown from the cutover
decision that [#115](https://github.com/Huxpro/octane/pull/115) handed to the
owner: the L5 repayment named in #58 is worth 42.7% of the Lynx main-thread
program, the ≤1.5× target is 12.2% of that, and either half clears the preview
arm on its own. Whether to spend the deletions is still the owner's call, and it
still depends on the native evidence #66 §6 says this container cannot produce.

The deletions themselves stay blocked where the re-audit left them: the staged
batch path is still the direct applier's fallback for native `<list>` pages, and
every inbound message is still revalidated. #103's U3b — native lists on the
block core — is the gate on the first, and it is a deferred GO awaiting the
owner.

The two halves are blocked differently, and the difference matters for how much
of each is collectible. The **send** side is already development-only:
`selfCheckLynxBackgroundInboundMessage` and its outbound sibling walk a message
under `LYNX_DEVELOPMENT` and return it untouched in production. The **receive**
side is not: `main-thread.ts` calls `validateLynxBackgroundOutboundMessage` on
every message a production main thread is handed, and its failure path is
load-bearing — it recovers the sender's identity and settles a pending
`call-background` rather than only reporting. So the validator half is not one
deletion but a scoped replacement: #66 §3 asks for header checks **on delta
traffic**, keeping that recovery. This arm keeps neither, which is why its
8,068 B is the loosest of the three bounds here. The batch half is the opposite —
its blocker is coverage, not posture, and once the specialized core covers every
page there is nothing left in `prepareLynxHostBatch` for a Lynx main thread to
call.

## Scope

Source and build evidence only. Decoding a production artifact executes no Lynx
engine and makes no native startup, first-paint, adoption, latency, memory, or
device-lifecycle claim. The ablated builds are measurement devices; they are not
functional Lynx runtimes and were never run.
