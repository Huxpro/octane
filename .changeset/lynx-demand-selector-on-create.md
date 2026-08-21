---
'@octanejs/lynx': patch
---

Install a `nodes-ref` selector only for hosts a commit announced, on every mount
path rather than only on native `<list>` cells. A commit composed under the
negotiated lazy-public-instance capability names every host it will query, so an
ordinary create, a recreate, and a template run in a later commit now answer that
announcement instead of stamping every element node they mount. Mounting 1,000
table rows drops from 4,000 selector writes to 0; a commit that announces nothing
keeps the eager install, because for it an uninstalled selector is a ref that
addresses nothing.

Commits carry that promise themselves, in a new `commit.announces` field. A
background composes its first batch before the main-ready reply granting the
capability reaches it, so that batch names none of its hosts however the session
was negotiated — a root whose first commit held a `ref` used to lose it with no
error on either side. Deferred handle deltas (`commit.instances`) are now decided
from the same compose-time capability rather than re-read at dispatch, so the two
halves can no longer disagree.
