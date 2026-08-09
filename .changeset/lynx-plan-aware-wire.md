---
'@octanejs/lynx': patch
---

Fold creation bursts into `instantiate(planId, …)` wire commands. Both Lynx bundles compile the same `.tsrx`, so structurally identical plans exist on both threads as module constants; the main thread announces the content-derived IDs of its registered plans in the ready reply (and incrementally for lazily loaded chunks), and the background re-encodes each provable plan instance — its creates, listeners, and inserts — as a single command that the main thread expands back into identical per-node commands before the untouched Element PAPI apply path runs. Protocol version stays 1: this is a negotiated capability, and a main thread that announces nothing (older build, HMR skew, hash collision) receives per-node commands exactly as before. On the 10k-row creation benchmark this collapses ~16 commands per row into 1.
