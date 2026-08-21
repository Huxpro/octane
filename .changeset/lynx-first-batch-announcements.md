---
'@octanejs/lynx': patch
'octane': patch
---

Announce the hosts a batch will query from what the background knows while
composing, so a root's first commit can name them too. The announcement used to
wait on the negotiated lazy-public-instance capability, which a background does
not have when it composes its first batch — that batch is built before the
main-ready reply reaches it. So the largest tree a root ever mounts, its whole
first screen, installed a `nodes-ref` selector on every element node whether or
not anything could ever query it: 4,028 writes for a 1,000-row screen, 40,028 for
10,000.

A driver now declares `publicInstanceAnnouncements` as a static capability rather
than reading a negotiated one, and `commit.announces` travels on every Lynx
commit, so the main thread installs on request from the first commit onward. The
capability the session negotiates keeps its own job: deciding whether a commit
may defer its handle deltas. First-screen direct emission and first-tree adoption
still install eagerly by construction, for the identity reasons recorded at those
call sites.
