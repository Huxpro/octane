---
'@octanejs/lynx': patch
---

Admit `useLinkedState` in compiler-proved Lynx Block applications. Accepted
keyed scopes retain local edits across moves and reconcile changed sources from
their last committed generation, while aborted attempts leave that generation
untouched. The compact first screen now implements both the lean pair and the
compiler-selected getter ABI.
