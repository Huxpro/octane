---
'@octanejs/lynx': patch
---

Stop describing listener detaches on hosts a teardown destroys in the same
commit. Clearing a template run used to spend one Element PAPI call per row plus
one per listener on that row, because the expansion journalled every unbind on
its way to destroying the host that owned it. Only the root removal is
observable: native dispatch already refuses a token whose record was deleted,
whose generation moved on, or whose host is no longer root-connected, and a
destroy does all three. The certified direct teardown plan has always skipped
these unbinds; every other teardown route now behaves the same way, so a clear
costs one host call per row regardless of how many listeners each row carries.
Main-thread worklet registrations are still released explicitly, and any native
list topology keeps the explicit unbind because a list recycles elements the
driver does not own.
