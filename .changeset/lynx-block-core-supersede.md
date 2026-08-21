---
'@octanejs/lynx': patch
---

The Lynx Block core now supersedes a stale `update` instead of appending beside
it. A frame that writes the same host more than once — every tick of a storm
writing the same label slot, say — carried one command per write, and an
`update` states the node's complete next props, so all but the last were dead
payload. The frame is now proportional to the hosts that changed rather than to
the writes that changed them, and it stays ordered against the frame's own
structural work because the replacement keeps the original command's position.

Measured in product on `benchmarks/lynx-table` at 10,000 rows, one update storm
of 50 ticks: 50,000 commands and 2,783,466 wire bytes become 3,000 and 166,892,
against the universal core's 4,000 and 223,602 in the same interaction.
