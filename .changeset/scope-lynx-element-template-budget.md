---
'@octanejs/lynx': patch
---

Scope the Element Template native budget to Android and reserve whole runs up front.

The resident-node cap, the intermediate `triggerLayout` barrier, and the synchronous first-screen bound exist to protect Android's JNI global- and weak-reference tables. They now apply only when the main thread reports `SystemInfo.platform` as Android, matching the general receiver's painted-element ceiling. On iOS and other engines an Element Template application can render past 10,240 rows and a large first screen paints synchronously. The removed-template recycle pool stays on every platform, because Lynx 4.1 also leaks a dropped template instance on iOS.

On Android, a template run now reserves every row it cannot take from the pool before any native call. A run that would exceed the resident bound is rejected with `OL512` before it creates, inserts, or lays out a partial table.
