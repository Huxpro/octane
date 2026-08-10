---
'octane': patch
---

Attach plan-instance provenance to staged universal host batches for async transports that declare the new `planInstantiation` capability. Each accepted, fully-new, visible, plan-rooted host subtree carries its plan, slot values, pre-order host IDs, and staged listeners, so a transport can re-encode the subtree as one wire instruction. A predicate can reject a plan before staging walks its subtree; transports that do not opt in see unchanged batches.
