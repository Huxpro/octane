# octane-direct — L0 direct-emission prototype (issue #58)

A hand-written rendition of what a `target: 'lynx'` compiler backend would
emit for the lynx-table fixture, used to answer the L0 exit-gate question of
issue #58: are the dominant Lynx costs engine-intrinsic, or caused by the
universal representation? Design and protocol:
`docs/lynx-specialized-target-l0.md`.

- `lepus-root.js` — main-thread program: straight-line Element PAPI create
  functions per template, a dense per-instance slot table, and a typed
  slot-delta applier. No plan interpreter, no command batch, no prop diffing,
  no per-command validation.
- `app-service.js` — background program: owns row state, mirrors
  `app/src/App.lynx.tsrx` operation-for-operation (storms tick one
  MessageChannel macrotask apiece), emits slot deltas via `callLepusMethod`.
  It is a state-owner stub, **not** a hook/reconciler core.
- `build.mjs` — assembles JSON web bundles. `pageConfig` comes from the
  Octane-built bundle's Configurations section and `styleInfo` embeds the same
  `app/src/app.css`, so engine toggles and styles match the octane cell
  exactly.
- `bundle-tools.mjs` — reader for the binary web-bundle container.
- `smoke.mjs` — functional parity check for every benchmark operation; run it
  before any measurement session.
- `run-fcp.mjs` — mount-create FCP ladder, octane `BENCH_AUTOROWS` build vs
  this prototype, fresh page per sample, AB/BA alternation, shared driver.

## Usage

```bash
node ../scripts/build-app.mjs            # or any harness build of app/dist
node build.mjs --rows 10000              # dist/ + dist-rows10000/
node smoke.mjs --rows 1000               # functional parity
node smoke.mjs --fcp --rows 10000 --bundle dist-rows10000/main.web.bundle
node run-fcp.mjs --rows 10000 --reps 5   # FCP A/B (quiet host)
node ../web/run-web.mjs --reps 5 --cells octane,octane-direct,vue-vdom,vue-vapor,react --skip-app-build
```

## Claims and non-claims

This cell is an **architecture floor**. Its background thread does no
component re-render, hook bookkeeping, or keyed diff, so whole-operation wall
clocks understate what a full Octane core would spend by an amount bounded by
the measured `bg_replay` stage of the current path. The load-bearing
comparisons are main-thread-side: first-screen materialization and the
apply-side cost around PAPI calls. All measurement-honesty rules of
`../README.md` apply: same workload operation-for-operation, byte-identical
driver, same-session same-host numbers only, and a cell that cannot be driven
end-to-end is "not measured", never a number from a degraded run.

`dist*/` outputs are generated and gitignored. `results/` holds the committed
session records backing the L0 verdict (each carries its session's host/load
header): the FCP A/B reports, and `stages-10000-l0-session.*`, this session's
same-host copy of the stage decomposition — the canonical cross-session stage
records stay in `../stages/results/`. `web-u0-update-ceiling.*` is the issue-#103
U0 session: octane against this cell over the mutation ops, with the
deterministic floor counts the update-path gate is written against.
