---
'@octanejs/lynx': patch
---

Fall back to ordinary public-handle acknowledgements when a client container
still owns a live compact segment. This preserves every unmaterialized host in
the existing segment while allowing compact acknowledgements to resume after
that segment is fully retired.
