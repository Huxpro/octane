# Touch-to-first-changed-frame device study (#197)

This directory is the reproducible artifact for
[Huxpro/octane#197](https://github.com/Huxpro/octane/issues/197). It measures the
interaction axis only; it is not a framework parity or ranking benchmark.

## Fixed matrix

- Topologies: `T0`, `T1`, `T2`, `T3`.
- Shapes: `local-toggle`, `cross-component`, `structural-delete`.
- Loads: `idle`, `sustained-scroll`.
- Formal L1 sample count: 16 per cell (384 interactions total).
- Order inside each shape/load block: eight paired passes of
  `T0,T1,T2,T3` followed by `T3,T2,T1,T0`. Each topology therefore appears
  once in the forward and once in the reverse half of every pair.

`schedule.mjs` emits this order. The result validator rejects missing cells,
sample counts below 15, an unpaired order, mixed measurement windows, missing
per-record device/engine metadata, and timing derived from a script clock.

`collect.mjs` turns that schedule into a per-step execution plan with the exact
bundle path and SHA-256. Every step reloads its bundle before the touch, so the
tree and work are reset even at the `T3`/`T3` turn between a forward and reverse
pass. Its state machine consumes one `ISSUE197_SAMPLE` logcat record per step
and rejects missing, duplicate, out-of-order, malformed, or observer-failure
records. The final window file is created with exclusive-create semantics.

## Timing boundary

The measurement observer is an MTS capture handler on `touchstart`:

1. It retains the input event's platform-provided `event.timestamp`.
2. It requests platform animation frames and tests the shape-specific visual
   predicate at each callback.
3. The first callback whose predicate observes the response supplies the
   changed frame's platform VSYNC timestamp.
4. Only after that boundary is closed does it send the record to BTS/logcat.

The event timestamp is Unix-epoch milliseconds and the RAF timestamp is
Android-uptime milliseconds. The runner samples
`System.currentTimeMillis()` and `SystemClock.uptimeMillis()` back-to-back
64 times at both ends of the window, chooses the smallest-bracket pair, and
linearly interpolates its boot-epoch offset for each input. The recorded
duration is `changedVsyncUptime - (inputEpoch - bootEpoch)`. `Date.now()`,
`performance.now()`, and other script clocks are forbidden. Every sample
retains both raw timestamps, the selected calibration, the normalized input
uptime, and the resulting duration.

The shape predicates are:

- `local-toggle`: the target row's computed background color changes.
- `cross-component`: the remote counter's computed background color changes
  in the same commit that changes its displayed integer.
- `structural-delete`: the target row is absent from the MTS selector tree.

Sampling at a VSYNC callback avoids mistaking an earlier tree/property write
for a presented frame. The observer itself is identical across topology
implementations and reports only after the changed frame.

## Load control

The interaction panel is fixed. A separate, identically rendered
`scroll-view` occupies the lower part of the page. In the loaded condition its
native `autoScroll` UI method runs at the rate recorded in every result. This
keeps a platform scroll active while preserving a stable target coordinate.
The idle condition renders the same tree with auto-scroll stopped.

## L2 attribution

L1 uses production-mode, non-profile bundles. L2 was attempted as a separate
window using profile variants for the two shipped framework topologies (`T1`
and `T2`). Stage boundaries called `lynx.performance.profileMark`; accepted
timestamps could only come from the platform trace collector, not script reads.
The intended stages were:

`input dispatch -> MTS handler -> crossing -> BTS compute -> crossing -> apply -> layout/paint`.

Profiler variants and their results must never be mixed into L1. On the
accepted Android 10 image, DevTool-off system tracing did not expose Lynx
profile marks and the native Perfetto service was unavailable. The L2
observability record therefore retains that stop gate; no script-clock or
DevTool-on substitute is mixed into the result.

## Files

- `fixtures/`: the three cross-topology fixture contracts and implementations.
- `raw-t0/`: the framework-free hand-written Lepus/PAPI floor bundles.
- `schedule.mjs`: formal AB/BA schedule generator.
- `collect.mjs`: bundle-hashed plan and strict logcat ingestion state machine.
- `analyze.mjs`: validation and distribution report generator.
- `l2/`: the attempted platform trace configuration and observability stop gate.
- `results/`: one immutable JSON file per measurement window.
- `report.md`: L1, L2, and the L3 “worth designing?” decision after device data
  exists.

No numerical result should be added to `report.md` until its raw window file
passes `node analyze.mjs <result.json>`.

## Rebuilding

The ReactLynx fixture is an intentionally isolated workspace because #197 pins
the shipped T1 toolchain. Install it with
`pnpm --dir benchmarks/lynx-touch-frame/react install --frozen-lockfile`, then
run its `build` or `typecheck` script with the desired `BENCH_LOAD` and
`BENCH_PROFILE` environment values. `BENCH_PROFILE=1` writes only to the
`L2-T1-*` directories.

Octane builds use `octane/lynx.config.mjs`; `BENCH_TOPOLOGY` is `T2` or `T3`,
and profile builds are accepted only for T2. The strict T0 floor is produced by
`node raw-t0/build.mjs`. Generated `dist/` directories are ignored; collection
plans hash the exact bundle bytes used by a device window.
