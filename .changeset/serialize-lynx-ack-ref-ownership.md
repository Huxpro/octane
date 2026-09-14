---
'@octanejs/lynx': patch
---

Keep state-driven host-ref changes on the serialized Lynx Block render path while
an older native frame awaits acknowledgement. Compiler scalar replay continues
to overlap safe value and event computation, but no longer commits hook state
without publishing the corresponding ref ownership change.
