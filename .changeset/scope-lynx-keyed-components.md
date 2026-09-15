---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Give compiler-lowered Lynx Block components independent semantic hook scopes
for each keyed row. Preserve state, reducers, refs, callbacks, and effects by
key across updates and reorders; publish hook attempts only after the native
host accepts their frame; and dispose departed rows after accepted deletion.
Compiler metadata keeps proven stateless pages and rows on the allocation-free
path, while Rspeedy now admits hooked local-component rows to Block selection.
