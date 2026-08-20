---
'@octanejs/lynx': patch
---

Build the first-screen command batch only when something reads it. The
synchronous first screen materializes through direct Element PAPI emission,
which needs the rendered node tree and the background listeners the renderer
assigned — never the command batch — and yet every render eagerly allocated and
froze one `create` per host plus one `insert` per placement first. At 10,000
fixture rows that is over 140,000 command objects the direct path walks past.
`renderLynxFirstScreen` now hands the applier an envelope carrying just those
listeners, and exposes `batch` as a cached lazy property built from the same
bindings, so the native-list fallback and callers that read the batch as a value
are unchanged while the path that never reads it stops paying for it.
