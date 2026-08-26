---
'@octanejs/lynx': patch
---

Compile a range site's text into the main-thread create function when its value
arrives as a string.

A build cannot tell a `@for` from a `{row.label as string}`: the compiler lowers
every dynamic child to the same plan node, so `deriveLynxMainThreadProgram`
answers "every renderable hole is a keyed range", and the text a row shows
arrives over the command path instead of being compiled. Only a value settles
it, and the create function is where the value is.

`emitLynxMainThreadProgram` now accepts the sites the program dropped and emits,
for each one whose host is a text host, a `rawText` append guarded on
`typeof value === 'string'` — the applier's own entry condition for the route it
is compiling, which throws on a non-string value rather than coercing it. Every
other value is left exactly where it was: a hole the renderer fills by key. The
range values are passed after the listeners, so a caller that declares no sites
emits and calls precisely what it did before, and none declares any yet. The
backend signature moves to `lynx-main-thread-program/3`.
