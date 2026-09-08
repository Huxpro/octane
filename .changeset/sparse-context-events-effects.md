---
'octane': patch
---

Keep compiler-proved sparse Universal context updates on the direct row path when stable effects and native event handlers are present.

Event closures retain their accepted listener IDs and publish only after transport acknowledgement, while unchanged mounted effects preserve their lifecycle. Unsupported event shape changes, effect changes, structural work, and rejected commits retain the complete fallback and rollback behavior.
