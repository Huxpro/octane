---
'@octanejs/lynx': patch
---

Prepare compact Lynx program frames with copy-on-write map and value drafts.
A scalar update now touches only its changed instance instead of cloning every
resident template, host, instance, range order, and value table before ACK.
