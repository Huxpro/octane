---
'octane': patch
---

Keep same-component Universal retries sparse after an asynchronous transport rejects before acknowledgement.

Updates that arrive behind the rejected batch now rebase through their already queued urgent pass without an extra empty transaction. When no later update exists, the accepted root is rescheduled without disabling proven subtree retention; component identity changes still use the complete-root fallback.
