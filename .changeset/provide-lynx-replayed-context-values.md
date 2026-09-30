---
'octane': patch
---

Keep a Lynx Block component on its render path when a context provider's value
reads replayable state. A state-only replay no longer repaints the provider's
children against the previous context value.
