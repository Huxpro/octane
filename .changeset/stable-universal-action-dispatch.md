---
'octane': patch
'@octanejs/lynx': patch
'@octanejs/rspeedy-plugin': patch
---

Match the DOM runtime's `useActionState` contract on Universal hosts and Lynx
Block scopes. The dispatcher keeps one identity for the hook's lifetime, queued
work runs the action from the last accepted render, each action runs in a
transition so its result, pending edge, and optimistic updates settle together,
and a failed action routes to the nearest Universal catch arm before falling
back to the host's uncaught-error channel.

A Lynx Block transition promoted while an earlier transition awaits host
acceptance now keeps its own render instead of being discarded when the
earlier one is accepted. The Rspeedy selector keeps `useActionState` pages on
the transition-capable Block component runtime.
