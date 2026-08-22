---
'@octanejs/lynx': patch
---

Render a compiled component on the Block core.

A bundle built with `core: 'block'` previously refused every compiled
component: the Block core has no hook cells, so a component had no program to
be, and the only producer of a block program was a hand-written fixture. A
hand-written program is an architecture floor rather than a framework
measurement, which is what made the flag hard to trust.

A component that carries no program is now derived from what it renders. Its
body is a plan reference plus a flat slot array, the plan lowers to a wire
template program through the published `octane/universal/template-program`
lowering, and the slot values become the block's values. A re-render is a slot
diff against what the block already holds, so the update stays proportional to
the change; event handlers rebind per render without touching the wire. A
program attached with `withLynxBlockProgram` still wins, so a component that
says what it is on the Block core is never second-guessed.

A setup that calls a hook or declares an effect is refused by name rather than
half-rendered, because a bundle that silently rendered nothing would be worse
than one that says which piece it lacks: it needs a render attempt the Block
core does not stand up yet. The diagnostic names the component and the remedy.

`LynxBlockRoot` now exposes its `transportRoot`, the identity namespace every
handle it sends is stamped with.
