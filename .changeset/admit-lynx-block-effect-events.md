---
'octane': patch
'@octanejs/lynx': patch
---

Activate `useEffectEvent` cells when a host-neutral hook scope commits, retain the
last accepted body across aborted drafts, and deactivate wrappers on disposal.

Compiler-proved Lynx Block applications now admit Effect Events. The compact
main-thread first screen installs a render-only placeholder without executing
the background callback, while ACK controls the live Block event body.
