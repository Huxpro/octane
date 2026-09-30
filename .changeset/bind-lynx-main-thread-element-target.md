---
'@octanejs/lynx': patch
---

Bind `MainThread.Element` refs to the main-thread global passed to
`installLynxMainThread({ target })`, and flush each global's element tree
independently.
