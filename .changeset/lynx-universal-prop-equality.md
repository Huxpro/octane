---
'@octanejs/lynx': patch
'octane': patch
---

Stop re-sending an unchanged Lynx worklet on every render.

A row that binds a `main-thread:` prop used to take a full-prop-bag `update` on
every commit, whether or not anything about it changed: `bindThreadFunction`
returns a fresh tagged function each render, and the core's prop diff falls back
to identity for a value it cannot read. An unchanged three-row list emitted
three updates per render where the same list without the prop emitted none. It
now emits none either way.

- `octane` universal core: `updates` capability gains an optional
  `same(name, previous, next)`, the renderer's answer for a prop whose value
  shape only it can decode. The core consults it after its own definition of
  equal has already said "changed", so a renderer can widen equality and never
  narrow it — implementing it can only remove update commands, and a driver that
  supplies none keeps today's behaviour exactly. The obligation it carries is
  that "equal" must mean the renderer's own applier would have made no change
  from the suppressed update.
- `@octanejs/lynx`: both drivers answer for `main-thread:` props through
  `sameLynxMainThreadPropValue`, the same decode-then-compare
  `planLynxHostPropPatch` already performs, so a suppressed update is one the
  applier would have turned into an empty patch. A malformed descriptor is still
  the applier's to report: decoding failure declines to call the values equal
  and ships the update that raises it.
