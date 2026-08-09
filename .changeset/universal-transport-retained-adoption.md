---
'octane': patch
---

Transported universal roots now adopt committed component subtrees whose component, props, and consumed contexts are unchanged instead of re-rendering them, matching the retained-subtree behavior local drivers already had. Adoption keeps React memo semantics — no render, no effect churn, stable host identity and listeners — while updates, context changes, and keyed reorders land exactly as before; on the dual-thread Lynx table benchmark a point select now renders 2 rows instead of the whole table.
