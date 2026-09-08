---
'@octanejs/lynx': patch
'octane': patch
---

Execute eligible incremental Lynx program runs through their resident straight-line driver.

Addressed append runs now bind the compiled program already registered in the main-thread realm
and paint the complete dense range with one `run` call. Runs without an executable driver retain
the existing descriptor interpreter. The driver publishes each created node immediately so a
mid-paint native failure remains fully owned and terminal cleanup can release the created prefix.
