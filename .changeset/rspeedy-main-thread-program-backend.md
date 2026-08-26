---
'@octanejs/rspeedy-plugin': patch
---

Add the opt-in `mainThreadProgramBackend` plugin option. When set, the
compiler's `target: 'lynx'` backend emits each lowered host template program as
straight-line main-thread source compiled into the MTS chunk, so a first screen
is painted by compiled code instead of interpreted commands. Leaving the option
unset builds exactly what today's plugin builds.
