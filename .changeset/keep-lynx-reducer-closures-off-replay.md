---
'octane': patch
---

Keep a Lynx Block component on its render path when a `useReducer` reducer reads
component state or a value derived from it. A state-only replay no longer leaves
the next dispatch reducing with the previous render's reducer.
