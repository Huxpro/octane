---
'@octanejs/lynx': patch
---

Retain event listeners for compiler-proven unchanged keyed Block rows across
structural list updates. The component path now rebinds only changed and newly
mounted rows after reconciliation while moved survivors keep their listener
identity and departed rows are still released.
