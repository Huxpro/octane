---
'@octanejs/lynx': patch
---

Admit compiler-proved `useImperativeHandle` calls in Lynx Block applications.
Imperative handles remain background-owned layout effects: host acknowledgement
publishes replacements, rejected drafts retain the accepted handle, Activity
visibility disconnects and reconnects it, and disposal clears it. Both
main-thread renderers now expose the same render-only hook ABI without creating
or publishing a handle during the first screen.
