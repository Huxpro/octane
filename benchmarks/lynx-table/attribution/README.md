# Lynx S3 attribution harness

This harness replays the byte-identical table app and page-side driver against
the exact stack declared in `targets.mjs`. Historical runtime/compiler sources
are exported from Git objects into ignored work directories; the current
toolchain builds every cell, and `build-matrix.mjs` records both source and
bundle SHA-256 provenance.

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

Run the matrix on an otherwise quiet host:

```bash
pnpm bench:lynx-attribution:build
pnpm bench:lynx-attribution:run
pnpm bench:lynx-attribution:analyze
pnpm bench:lynx-attribution:test
```

Gzip-compressed raw JSON and the generated summary/report are committed under `results/`.
Heap snapshots and built bundles are deliberately ignored; snapshot file
hashes and analyzer digests belong in the report so captures remain auditable
without putting multi-gigabyte artifacts in Git.
