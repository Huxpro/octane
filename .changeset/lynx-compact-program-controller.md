---
'@octanejs/lynx': patch
---

Own compact compiled-program frames in one page-local transactional controller.
Accepted frames now settle only after their native writes commit, aborted or
malformed attempts roll back for exact-identity retry, and native disposal can
be retried without publishing incomplete cleanup. A failed rollback faults the
root and retains its ownership journal for terminal cleanup instead of inviting
an unsafe ordinary retry.
