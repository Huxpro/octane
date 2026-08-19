---
'@octanejs/lynx': patch
---

Gate first-screen event emission on resolved visibility, matching the
background. A host inside a hidden `<Activity>` announced a listener from the
main thread and none from the background, so the two batches disagreed by
exactly that command and the first screen could never be adopted: it repainted
from scratch on every launch and the taps buffered in between were dropped. A
hidden tab, a collapsed drawer, and a pre-rendered off-screen route are all
this shape.
