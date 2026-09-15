---
'@octanejs/tanstack-start': patch
---

Resolve the route generator's default temporary directory from the project root so atomic route-tree writes also work when the project is on a different filesystem from the Octane workspace.
