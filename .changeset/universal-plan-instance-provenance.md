---
'octane': patch
---

Attach plan-instance provenance to staged universal host batches for async transports that declare the new `planInstantiation` capability. Each fully-new, visible, plan-rooted host subtree carries its plan, slot values, pre-order host IDs, and staged listeners, so a transport can re-encode the subtree's commands as one wire instruction. Transports that do not opt in see byte-identical batches.
