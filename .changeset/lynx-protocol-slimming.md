---
'@octanejs/lynx': patch
'octane': patch
---

Protocol slimming (lynx-perf #7): transport protocol version 2. The background
derives every acknowledgement handle delta locally from the batch it sent —
creates, recreates, and destroys from command transitions, generations by
main's exact staged-bump rules, list-ancestry flips from a topology mirror —
so production acknowledgements carry only version identity, the adoption flag,
and fault information; development acknowledgements keep a full handle payload
as a cross-check that must match the derivation. Main merges the completion
into the acknowledgement (`complete: true`) whenever no post-acknowledgement
work is pending, collapsing the common commit tail from three messages to two,
and a value-identical re-render (zero commands) settles on the background
without crossing the wire at all once a first batch has been accepted. The
versioned wire, fault paths, effects-after-accept ordering, first-screen
adoption, and pacing credit are unchanged.
