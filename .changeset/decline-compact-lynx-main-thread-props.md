---
'@octanejs/rspeedy-plugin': patch
---

Keep Lynx applications that author `main-thread:*` props or `main-thread:ref`
on the general application instead of the compact compiled-program product. The
compact client has no main-thread host-prop lane, so these applications
previously failed their production build or their first mount on device.
