---
'octane': patch
'@octanejs/lynx': patch
---

The compiler accepts `target: 'lynx'` (renderer config v5): the universal
front-end and descriptor ABI stay unchanged, but eligible host-only templates
lower to straight-line create functions with a per-slot kind table
(`docs/lynx-specialized-target-l0.md` §3.2–§3.3) instead of interpreted plan
JSON, and ineligible plans keep the plan encoding unchanged. The Lynx
main-thread renderer switches to the new target and executes template create
programs through a first-screen env that produces the exact same host batch —
ids, listener ids, props, events, visibility — as plan interpretation, so
background adoption identity is untouched. The background renderer stays on
`target: 'universal'`; the generic universal core rejects template plans
loudly instead of misinterpreting them.
