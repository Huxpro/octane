---
'@octanejs/lynx': patch
---

Answer the renderer's host-update classification without building the prop
patch. `updates.classify` ran the full semantic diff on every updated host and
kept one boolean, on both the background client driver and the main-thread host
driver, while the main thread rebuilt the same patch from the same props a
moment later. The dedicated classifier keeps every validation and the exact
recreate verdict and skips the construction.
