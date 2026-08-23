---
'octane': patch
---

Let a renderer outside the universal root run hooks, through
`createUniversalHookScope`.

`useState` and its neighbours reach their cell through two pieces of module
state — the render attempt and the owner the claim controller resolves — and
only `UniversalRootImpl` sets them. So a renderer in this family that owns its
own commit protocol, such as the Lynx Block core, could not call a compiled
component's setup at all, even though the hook functions are already linked
into its bundle by the application module that calls them. Its only routes were
to reimplement the cells, which is where two cores start disagreeing about what
a hook means, or to carry a root it exists to avoid carrying.

`octane/universal/native` now exports `createUniversalHookScope({ renderer,
scheduleRender })`, which hands back a `render`/`commit`/`abort`/`dispose`
scope holding one component's cells. `render(setup)` runs the setup with those
cells installed and settles a render-phase update inside the same attempt, the
way the universal core does, capped the same way; `commit` publishes the draft
and drains exactly the updates that render consumed; `abort` leaves the
committed cells alone. An update raised by a committed setter calls
`scheduleRender` instead, so when the next render happens stays the caller's
decision.

The scope stands up cells and nothing else: no effects, no context chain, no
reconciler. It is the same code path the root takes, not a second copy of it,
which is the point.
