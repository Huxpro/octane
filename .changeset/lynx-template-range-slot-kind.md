---
'octane': patch
---

Emit a distinct slot kind for renderable holes in `target: 'lynx'` templates.
A hole whose members are instantiated and removed is now `r` rather than sharing
the content kind, so an operation can be dispatched to a slot from the compiled
table alone. Only the emitted metadata changes; rendering is unaffected.
