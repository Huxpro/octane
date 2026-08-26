# octane-mts-block — C0 pricing spike (issue #163)

The question C0 exists to answer, before any compiler work is done:

> If the first screen were rendered by straight-line main-thread code emitted
> from the block program the framework already derives — no commands, no plan
> interpretation, no adoption handoff — would it land where the hand-written
> `octane-direct` ceiling lands?

GO for C1 requires **within a few percent of `octane-direct`** at 1k/10k/30k.

## Why this is not just `octane-direct` again

`prototype/lepus-root.js` is the `octane-direct` cell: a main-thread program
written **by hand for this one fixture**. It bounds the architecture, but it
cannot say what a backend would emit, because a person who has the fixture in
front of them makes choices a compiler does not get to make.

This cell closes that gap from the other side. Its create functions are
generated from the program the framework's own plan → wire lowering produces for
`app/src/App.lynx.tsrx` — the same lowering
`packages/lynx/src/core/block-component.ts` uses, the one
`packages/octane/tests/lynx-block-template-lowering.test.ts` pins against the
hand-written program. Nothing about the fixture is consulted while emitting.

Everything else is `octane-direct`, unchanged: the same background program
(`prototype/app-service.js`, unforked), the same mount ladder, the same
slot-delta applier, the same event tokens, the same counters, the same engine
entry points, the same `pageConfig` and the same `app/src/app.css`. The
provenance of the main-thread create functions is the single variable.

## Pipeline

```bash
node ../scripts/build-app.mjs           # app/dist, for pageConfig
node derive.mjs                         # programs.json — the framework's lowering
node build.mjs --rows 1000,10000,30000  # dist/ + dist-rows{N}/
node ../prototype/smoke.mjs --rows 1000 --bundle ../mts-block/dist/main.web.bundle  # path is relative to prototype/
node tree-check.mjs --rows 1000                # the semantic control
node ../prototype/run-fcp.mjs --rows 10000 --reps 5 --out-suffix=-c0 \
  --extra octane-mts-block=$PWD/dist-rows10000/main.web.bundle
```

- `derive.mjs` compiles the app, takes its two module-level plans, and lowers
  them. Which hole is the keyed `@for` is not decidable from a plan — a
  renderable hole is one node whatever it holds — so it invokes each component
  once and asks the same `isRangeValue` question `block-component.ts` asks.
- `emit.mjs` turns a prepared program into straight-line code. It writes only
  what the Lynx template-run applier writes (`id`, `class`, and a `#text`'s
  content at creation) and **refuses by name** anything else, because a silently
  unwritten prop would paint a different tree and quietly invalidate the
  comparison this cell exists to make.
- `build.mjs` splices the generated functions into `runtime.js` and assembles
  the web bundle. `lepus-root.generated.js` is written beside the bundles so the
  emitted program is reviewable without decoding one.
- `tree-check.mjs` is the semantic control. A first-screen time compares two
  cells only if they painted the same first screen, so it reads the settled
  composed tree of all three cells — element tag, `class`, text, shadow roots
  pierced — and fails on the first divergence. Stylesheet text is compared
  separately: both program cells ship `app/src/app.css` as authored while
  `octane` ships the bundler's compiled `styleInfo`, which is provenance rather
  than tree.

`dist*/` is generated and ignored. `programs.json` and
`lepus-root.generated.js` are generated **and committed**, because they are what
this spike asks to be read: the first is the lowering's own output, the second
is the main-thread program under test. `node build.mjs` overwrites both.

## Result

`results/c0-first-screen.md` — **GO**, at +1.7% / +2.8% / +1.3% of
`octane-direct` at 1k / 10k / 30k, on structurally identical trees.

## Claims and non-claims

This is a **pricing spike, not product code**. Nothing here ships, nothing in
`packages/` imports it, and no part of it is a renderer: the background half is
a state-owner stub with no hooks, no component bodies and no keyed diff, exactly
as `prototype/README.md` says of its own. Whole-operation wall clocks therefore
understate what a full Octane core would spend, and the load-bearing comparison
is the main-thread first screen.

Two differences from `octane-direct` are the spike's own overhead rather than
the architecture's, and are stated rather than absorbed:

- The derived program declares **three** value slots per row (class, id text,
  label text). The hand-written cell keeps **two**, having noticed the id text
  is written once and never addressed again. So this cell performs one extra
  `push` per row on the first screen and maintains one extra array on remove
  and swap. Dropping write-once slots is a real C1 optimization; leaving it out
  of C0 keeps the derived cell honest rather than flattering.
- A row's values arrive through a one-call adapter (`createRowFor`), which is
  the work a compiled component body would do.

All measurement-honesty rules of `../README.md` apply: same workload
operation-for-operation, byte-identical driver, same-session same-host numbers
only, and a cell that cannot be driven end to end is "not measured", never a
number from a degraded run.
