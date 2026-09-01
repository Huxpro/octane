---
'@octanejs/lynx': patch
---

Plan a Lynx host's create patch without diffing it against an empty prop bag.
Every host patch a first screen plans is a create, so the diff's previous side —
its names, id, class, inline style, dataset, CSS scope and main-thread ref — is a
constant that the planner was deriving per host. A create now enters the same
comparison body with that side already known.
