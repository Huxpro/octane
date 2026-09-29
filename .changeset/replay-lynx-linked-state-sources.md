---
'octane': patch
---

Keep a Lynx Block component on its render path when a `useLinkedState` source
reads component state or a value derived from it. A state-only replay no longer
leaves the linked value on its previous source.
