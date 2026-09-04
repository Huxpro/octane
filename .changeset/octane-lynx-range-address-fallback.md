---
'octane': patch
---

Keep range-bearing Lynx main-thread programs on described background mounts.

A compiled create function may decide at runtime that an unproved child range
currently contains text. The background lowers that text into its mount
descriptor, while the resident main-thread wire leaves the range to the create
function. Those two paths paint the same tree but have different node and value
arities, so the fixed resident wire can only be addressed when the compiled
program is range-free. Range-bearing plans now retain their descriptor instead
of sending an address that the main thread must reject.
