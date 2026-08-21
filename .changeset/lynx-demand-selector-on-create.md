---
'@octanejs/lynx': patch
---

Install a `nodes-ref` selector only for hosts the peer announced, on every mount
path rather than only on native `<list>` cells. A peer that negotiated lazy
public instances names every host it will query, so an ordinary create, a
recreate, and a template run in a later commit now answer that announcement
instead of stamping every element node they mount. Mounting 1,000 table rows
drops from 4,000 selector writes to 0; a peer that announces nothing keeps the
eager install, because for it an uninstalled selector is a ref that addresses
nothing.
