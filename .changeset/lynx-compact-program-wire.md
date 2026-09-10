---
'@octanejs/lynx': patch
---

Add an isolated, versioned ContextProxy transport for compact compiled-program
frames. Main-thread readiness now waits for both resident program registration
and native PageConfig, while frame acknowledgement, rejection, retry, abort,
fault, and disposal settlements remain correlated to the exact root version.
