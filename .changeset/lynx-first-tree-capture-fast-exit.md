---
'@octanejs/lynx': patch
---

Capture the first tree without per-record scratch work. Four things happened once
per node, on pages that can hold tens of thousands: a whole prop patch was
planned only to read back which main-thread events and refs the node expects, an
empty event table was spread and sorted into an array that stayed empty, an empty
child list was copied and frozen, and a `Set`/`Map` pair was allocated to track
cycles while cloning the props. A root with no main-thread props at all cannot
expect a main-thread binding, unscoped raw `#text` records carry a string value
and nothing else, and the clone scratch can be owned by the capture and cleared
per record. Every assertion the capture made still runs, including the one that
no unexpected main-thread ref is mounted.
