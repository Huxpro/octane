---
'@octanejs/lynx': patch
---

Admit `useId` in compiler-proved Lynx Block applications. Retained keyed row
scopes keep their opaque ID through moves, recreated rows receive a fresh scope,
and the compact main-thread first screen now emits the deterministic ID namespace
used by the complete main-thread renderer before the background Block frame takes
ownership.
