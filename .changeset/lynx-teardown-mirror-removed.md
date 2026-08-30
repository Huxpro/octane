---
'@octanejs/lynx': patch
---

Stop mirroring the whole record map for a template run's eventual teardown.

A `mount-template-run` whose compact fast path declined used to copy every
accepted record into a second dense store and retain it until the next batch,
so that a later `destroy-run` could be expanded from the run's shape rather
than from the record map. The copy is gone. The two routes it sat between are
now compared directly by a differential test, the record map answers whenever
the dense store cannot, and the certified direct plan is reachable in one more
case than before — its refusal list no longer includes "a mirror is live".
