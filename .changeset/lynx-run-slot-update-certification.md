---
'@octanejs/lynx': patch
---

Keep a mounted template run eligible for direct teardown after its props change.

A `mount-template-run` earns a certified single-command teardown by staying the
run it was declared as. Any write into its dense record store used to spend that
certification, so one `update` anywhere in the table sent the next clear through
the per-host expansion for every row. A write that replaces a host's props and
leaves its node, type, parent, children, events and handle alone changes nothing
the teardown reads, and no longer disqualifies the run.
