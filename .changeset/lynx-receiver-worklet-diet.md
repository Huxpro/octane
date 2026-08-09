---
'@octanejs/lynx': patch
---

The main-thread receiver now reaches the worklet runtime through a lazy bridge
provided by `main-renderer`'s thread-function entry points, so a production
main-thread bundle that compiles no worklet features sheds the entire worklet
registry and call-bridge machinery (~2.5 kB gzip per slice). Worklet-addressed
messages and host dispatches arriving at a no-worklet bundle report cleanly
instead of resolving. The `lynx-bundle-size` benchmark now gates gzip bytes
per slice against frozen budgets.
