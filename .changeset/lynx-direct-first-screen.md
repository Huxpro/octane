---
'@octanejs/lynx': patch
---

The synchronous first screen now materializes through direct Element PAPI
emission (`applyLynxFirstScreenDirect`): the rendered record tree applies
without command staging, cloned record maps, or operation replay, while the
container state stays indistinguishable from the staged batch path — adoption
capture, mismatch repair, buffered-event replay, and deterministic listener
ids are unchanged, and native-list trees keep the staged path. Same-window
mount-create FCP@10k on the reference harness improved 0.865× (−240 ms);
session records under `benchmarks/lynx-table/prototype/results/`.
