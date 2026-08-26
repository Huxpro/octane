---
'@octanejs/lynx': patch
---

Lynx validation is now a policy rather than a fixed cost. `createLynxRoot` and
`installLynxMainThread` take `validation: 'checked' | 'trusted'`, defaulting to
`checked`, and a spelling neither implements is refused rather than quietly
falling back — a typo that resolved to `checked` would look like it worked, and
one that resolved to `trusted` would drop validation nobody asked to drop.

`checked` walks a message against the schema. `trusted` says the two threads
ship together and the sender is this same package, so a production build checks
the envelope — protocol, renderer, root, version, discriminant, arity — and
declines the per-command, per-prop walk beneath it. A development build runs the
full `checked` walk under either mode, so drift fails loudly where it is
introduced rather than silently where it is deployed. Neither mode changes what
happens after validation: the compact completion acknowledgement, backpressure,
lifetime, and fault handling are identical, which is asserted by running the
same mount, update and teardown through both and comparing the whole protocol
trace.

The integrity walk that refused hostile prototypes, symbol fields, accessors,
non-enumerable properties, sparse arrays and cycles is gone from the receive
boundary. It existed to survive a value built on the other thread that could
answer the validator one way and the host driver another, and since the
transport owns encoding every message reaching a validator is `JSON.parse`
output, which can express none of those things. A check whose failing branch
cannot be reached is not a weaker check — it is a claim about where safety comes
from that is no longer true. Safety comes from the boundary; what remains is
schema. One walk does keep a bound: the sender's own development self-check runs
before the transport encodes, where a live object graph can still be cyclic, so
it stops at the same depth the encoder does and names the path rather than
exhausting the stack.
