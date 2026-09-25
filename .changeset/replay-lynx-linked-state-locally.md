---
'octane': patch
'@octanejs/lynx': patch
---

Replay compiler-proved Lynx Block binding groups for local `useLinkedState`
edits instead of re-entering the owning component. Getter-backed linked-state
cells now project and publish their queued local edits through the host-neutral
hook scope. Caller-driven source changes still use the complete component
transaction so linked-state reconciliation, keyed identity, rejection, and
acknowledgement semantics remain unchanged.
