---
'octane': patch
'@octanejs/lynx': patch
---

Queue host-neutral `useActionState` dispatches sequentially, thread each
completed result into the next action, keep pending state active until the queue
drains, and preserve later work after a reported action error.

Compiler-proved Lynx Block applications now admit `useActionState`. Both
main-thread renderers expose a render-only initial-state preview while the
background Block scope owns action execution, pending state, and ACK-gated UI
publication.
