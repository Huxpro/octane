---
'@octanejs/lynx': patch
---

Decline a page that would cross Android's painted-element ceiling instead of
painting it into a process abort.

Lynx on Android charges one JNI global reference per painted element and its
table holds `max=51200`; crossing it aborts the process with a SIGABRT that
carries no JavaScript cause, so a page that paints too much dies without saying
why. The host driver now takes a `paintedElementCeiling`, projects what a first
screen or a commit would paint before painting any of it, and refuses over the
line with a diagnostic that names the count, the ceiling, and `<list>` as the
answer. `installLynxMainThread` derives the default from `SystemInfo.platform`:
Android gets the ceiling, every other engine — iOS, Lynx-for-Web, an engine that
reports nothing — gets none, and `paintedElementCeiling: null` turns it off.

A declared native-list row is not painted and is not counted, so the `<list>`
the diagnostic recommends is not itself refused.
