---
'@octanejs/lynx': patch
---

Decline a first screen holding a component nothing compiled for the main-thread
renderer, instead of losing the launch to an error.

A synchronous first screen is an optimization over a page the background
renders anyway, so meeting the edge of what the main thread can paint should
cost the optimization and nothing else. Until now it cost the whole attempt:
`renderLynxFirstScreen` threw a plain `Error` for a component carrying no
main-thread identity, the receiver treated it like any other fault, and an
application entitled to its page got neither the fast path nor the page.

The renderer now raises a `LynxFirstScreenRefusalError` for the two shapes it
has nothing compiled for — a component with no renderer identity, and one
carrying another renderer's — and the receiver settles such an attempt as
`skipped` rather than `failed`. That is the same retirement an unadoptable
paint already takes: the source is retired, background readiness is released,
and the page arrives over the command path.

The distinction is a class rather than a message so only the renderer can
assert it, because application code renders inside this pass and an error it
happened to throw with matching text must not buy itself a decline. Every
defect keeps faulting exactly where it did — a `<list>` nested in a `<list>`, a
duplicated `item-key`, a throw out of a component's own setup — since nothing
about the command path makes a wrong page right, and a quiet skip would hide
it. A decline is not quiet either: the refusal is reported as a diagnostic
carrying `OCTANE_LYNX_FIRST_SCREEN_REFUSED`, so a build that stopped painting
its first screen says so and names what ended the attempt.
