---
'@octanejs/lynx': patch
---

Keep Lynx Block transport flushes open for renders scheduled by accepted effects
and serialize teardown with the render queue. Updates arriving after an unmount
request can no longer overtake teardown or publish a speculative host frame.
