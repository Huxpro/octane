# Lynx attribution harness

This harness builds explicitly named Git revisions, runs the same table app and
page-side driver against every target, and records full source and bundle
provenance. It has no built-in branch names or commit SHAs, so it can compare an
individual PR with its immediate parent or measure a longer stack in order.

## Build and run

Build and capture an uninstrumented control first:

```bash
pnpm bench:lynx-attribution:build -- --targets parent=HEAD^,candidate=HEAD
pnpm bench:lynx-attribution:run -- --modes heap,cpu,cold --output control.json
```

Then build and capture the profiled cells. `--profile` enables the permanent
wire counters; `--instrument` temporarily adds the deeper allocation and stage
counters while compiling each exported source tree.

```bash
pnpm bench:lynx-attribution:build -- --targets parent=HEAD^,candidate=HEAD --instrument --profile
pnpm bench:lynx-attribution:run -- --output profile.json
```

Generate a comparison report from both captures:

```bash
pnpm bench:lynx-attribution:analyze -- \
  --baseline parent --candidate candidate \
  benchmarks/lynx-table/attribution/results/control.json \
  benchmarks/lynx-table/attribution/results/profile.json
```

For an end-to-end wiring check, add `--smoke --allow-busy-host` to the run and
reduce `--scales`; smoke mode defaults to one repetition and two cold samples.
Without `--smoke`, the runner rejects fewer than five repetitions.

`workspace=HEAD` is the default build target. Target labels must be unique and
are preserved in the requested order. Vendored `vue-vdom`, `vue-vapor`, and
`react` cells can be added explicitly to a run with `--targets`; omit `storm`
when references are selected because they do not expose Octane wire counters.

## Protocol

- Heap: fresh page and background worker per sample, explicit
  `HeapProfiler.collectGarbage`, 1k/10k/30k live rows, five ordered samples,
  cleanup census, and worker-release validation.
- CPU: simultaneous background-thread and main-thread CDP profiles around a
  10k create, plus deterministic counters and non-overlapping duration stages.
- Cold path: five fresh realms per operation; sample 1 remains cold and samples
  2–5 remain in their original order as steady state.
- Semantics: every sample records row/checksum/selection/identity controls;
  mutation observers and wire counters record presentation and commit work.
- References: the vendored ReactLynx, Vue VDOM, and Vue Vapor bundles use the
  same host, driver, workload, and oracle. Their source provenance is in
  `../reference/manifest.json`.

Run on an otherwise quiet host. Reportable captures use at least five
repetitions; `--allow-busy-host` is only for smoke/debug runs and must be
disclosed if its output is cited. Raw captures, generated reports, heap
snapshots, and built bundles are ignored. Publish the relevant report tables,
exact commands, Git SHAs, bundle hashes, host metadata, and sample spread in the
PR body instead of committing machine-specific results.
