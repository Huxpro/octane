---
'@octanejs/lynx': patch
---

Refuse a main-thread/background event collision on the direct first-screen path
before touching the Element PAPI, as the staged path already does during
prepare. A host carrying both `main-thread:bindtap` and a background `bindtap`
listener previously painted, with the background token silently superseding the
main-thread handler on the same native channel — and whether the mistake was
reported at all depended on whether an unrelated part of the page used a native
`<list>`.
