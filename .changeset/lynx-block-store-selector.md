---
'@octanejs/lynx': patch
---

Run page-level external-store selectors on the Lynx Block core.

The Block component hook scope now supports layout effects at the background
core's accepted-host boundary, which lets `useSyncExternalStore` establish one
page subscription without adding an owner per keyed row. A compiler-certified
selection over a stable list therefore revisits only the old and new row keys;
an unchanged selected snapshot schedules no render or transport frame.

Insertion and passive effects, row hooks, and context reads remain explicit
refusals until their distinct lifecycle or owner models exist.
