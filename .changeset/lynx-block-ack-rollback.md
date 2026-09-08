---
'@octanejs/lynx': patch
---

Roll back Lynx Block renders that the native host rejects before acknowledgement.

The Block core now journals changed values, keyed-range structure, listeners,
derived-component caches, and hook drafts until the matching host ACK. A rejected
mount, update, or unmount can be retried from the last accepted tree without
skipping host work, publishing an effect, disposing a live scope, or exposing a
new handler to an old native event.
Updates acknowledged before a later host fault remain published, matching the
transport's existing acceptance boundary. Hand-written Block programs that mutate
then call `context.commit()` use the same journal between commits.
