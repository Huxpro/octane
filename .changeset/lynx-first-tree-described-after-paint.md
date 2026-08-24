---
'@octanejs/lynx': patch
---

Describe a captured first tree after the first paint, not before it.

Capturing the first tree runs after the page is already published to the host,
so everything capture does sits between the tree reaching the DOM and the
browser painting it. Most of that is not validation, it is allocation: turning
the captured tree into the clone-safe description the background clones when it
adopts. Nothing before adoption reads that description, so it now builds on
first read.

What stays eager is what the contracts need. Validation and the native-ID read,
because a host that cannot be captured has to fault the synchronous first
screen while its caller still holds the source to retry cleanup against. The
event token map, because a tap on the painted tree resolves through it long
before the background adopts. The logical-row map, because the ownership
equality capture ends with counts it. And the native-list journal, because
adoption re-reads each list's recycling epoch to detect traffic between capture
and adoption, which has to be the epoch capture saw.

The description reads only fields a captured record retains, and the capture's
own root children and accepted version are read at capture rather than from the
builder. A first tree therefore still answers with the tree it captured while
unmount cleanup retries and after its owner has been disposed. Releasing a
first tree now drops the builder — that is what stops a finished tree retaining
the page it described — so a tree released before anything read it refuses to
describe itself instead of answering from a container that no longer exists.
