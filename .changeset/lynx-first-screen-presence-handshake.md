---
'@octanejs/lynx': patch
---

The `main-ready` reply no longer carries the whole painted first screen to say
that one was painted.

The background needs one bit out of that reply: a first screen exists here, so
the first background batch must preserve its IDs. `transport.ts` computed
exactly that — `message.firstTree !== undefined` — and nothing in the package
ever read a node out of the snapshot it tested. Below this the only way to state
the fact was to attach the description, so the reply was O(painted tree): a
30,000-row page shipped a ~37 MB structured clone that was then validated node
by node on receipt, to carry a boolean.

The reply now carries `firstTreePainted: 1`, published only to a background
whose readiness request was tagged at the new
`LYNX_FIRST_TREE_PRESENCE_READY_REQUEST_BASE`. That is the same shape every
other optional reply key uses, and for the same reason: a peer below the rung
validates against an exact key set and would reject a key it has never heard of.
A peer below the rung is still sent the snapshot, because presence *is* the key
for it — sending the bit alone would tell it no first screen happened at all.
The two spellings are mutually exclusive, so a receiver never has to decide
which one wins.

The main thread's own cost goes with it. The description is built on first read,
and the presence path never reads it, so a first screen that hands off this way
never allocates a description of itself either.

Same handoff, same adoption, same preserved node identity — the reply is now a
constant few hundred bytes instead of growing with the page.
