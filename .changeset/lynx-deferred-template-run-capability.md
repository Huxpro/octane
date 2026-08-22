---
'@octanejs/lynx': patch
'octane': patch
---

A deferred `mount-template-run` is now negotiated before it can be sent.

`deferred` landed as a wire field with no way for a background to know whether
its peer could read it. A main thread built before that field validates a
`mount-template-run` against an exact key set, so a background that sent
`deferred` to one would fault the root on a command the peer otherwise
understands completely — which is why nothing was allowed to emit it.

The reply now carries `deferredTemplateRuns: 1`, published only to a background
whose readiness request was tagged at the new
`LYNX_DEFERRED_TEMPLATE_RUN_READY_REQUEST_BASE`. That is the same shape the
`templateRuns` grant uses and for the same reason: the probe is how a background
says which capability keys it can already read, so a peer that predates this one
never sees the new key at all. The grant requires `templateRuns`, because
deferral is a property of a run.

The main thread now also rejects a deferred run from a session it never granted
one to, rather than accepting it on the driver's own terms. `octane`'s
`UniversalHostCapabilities` gains `deferredTemplateProgramRuns` so a renderer
can state that it has such runs, and the Lynx host driver claims it.

Still nothing emits `deferred`, so no existing peer's behavior changes.
