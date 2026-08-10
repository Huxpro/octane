---
'@octanejs/lynx': patch
---

Fold creation bursts into `instantiate(planId, …)` wire commands. The main thread announces each registered plan's content-derived ID and canonical form, and the background folds only an exact match into one command that main expands before the existing Element PAPI path. Protocol version stays 1: an older or skewed main thread announces nothing and continues receiving per-node commands. The 10k-row creation benchmark drops from 16 commands per row to 1.
