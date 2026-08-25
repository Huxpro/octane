---
'@octanejs/lynx': patch
---

Adopt a first screen a compiled main-thread program painted, without describing
what it painted.

The background thread already numbers every host of its own render, and the
program object is emitted only into the main-thread layer, so the background
describes the same component from an ordinary template regardless. What it
cannot supply is the physical node behind each ID. Main supplies exactly that
and nothing else: the mount keeps the node each of the program's IDs took, and
adoption resolves the background's description against that map wherever a
record would have been read.

So the handoff inverts rather than widens. `captureLynxFirstTree` walks the
records it has, which for a program are only the keyed ranges' members — it
reads back no node the program made, writes no nodes-ref selector for one, and
builds no description of the program's subtree. Nothing new crosses a thread:
the map is main-local, like the native-list journal beside it.

Three populations now account for every owned node exactly once — described
hosts by their record, unmaterialized native list rows by the logical map, and a
program's hosts by the ID map. Both the capture's ownership equality and the
comparator's host counts stay equalities rather than softening to bounds, so an
actually-untracked node still cannot hide, and a background that describes one
host too many is a mismatch rather than a host adopted against nothing.
