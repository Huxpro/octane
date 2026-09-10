# M3 shipping-controller first-screen adoption source

- Issue: #290
- Exact merged base: `new-lynx@db0175cdd60d449a331ec794fa268f21a143aa1a`
- Exact-clean implementation/measurement head: `526ce30c139001c56cef2c937d637e72ee1cfc6c`

## Result

The compact receiver and ownership controller can now construct their one
page-local store with the listener cursor and handle-keyed first-screen proofs
that earlier compact-store slices had left at the test boundary. An adopted
eventful program run keeps the already-painted node objects and native event
token, performs no second attachment, publishes compact ownership only at frame
commit, and removes those same native nodes on acknowledged disposal.

The source is one readonly pair because its members are inseparable: the seed's
first listener must equal the store cursor. Passing two independent optional
fields created an invalid configuration surface and cost more production bytes.
The source is handed to the controller once, at construction, so there is no
new per-opcode or per-slot lookup. The store still resolves a seed only for a
RUN's existing handle-keyed mount boundary.

Receiver readiness now uses one four-state gate instead of a parallel boolean,
and receiver/controller error normalization is shared. Both changes preserve
the existing correlated-ready and diagnostic behavior while repaying most of
the adoption linkage cost.

## Exact production linkage

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-controller-producer-complete,receiver-compiled-program-producer-complete \
  --output /data00/home/xuan.huang/.codex/tmp/m3-adoption-controller-526ce30c1.json
```

| exact-clean source | complete compact receiver gzip | decoded MTS gzip | decoded BTS gzip | headroom to 81,484.5 B gate |
| --- | ---: | ---: | ---: | ---: |
| base `db0175cdd` | 81,583 | 26,716 | 54,263 | -98.5 B |
| candidate `526ce30c1` | 81,608 | 26,739 | 54,263 | -123.5 B |

The final mechanism costs **25 gzip bytes** in the complete production union
and 23 gzip bytes in decoded MTS. Decoded BTS is byte-identical. The
controller-only union moves from 81,235 to 81,256 gzip (+21 B). All four
core/backend controls pass and receiver-isolation failures are empty.

The exact base receipt is
`/data00/home/xuan.huang/.codex/tmp/m3-adoption-controller-base-db0175cdd.json`
(SHA-256
`391037fbb4d2b9df179916c945db08a959ce795ef6f888ad3b2dff30ff4ef902`).
The candidate receipt is
`/data00/home/xuan.huang/.codex/tmp/m3-adoption-controller-526ce30c1.json`
(SHA-256
`f455084bc944b0ab67616b1951cb0706f2e74ef40b3d0cd6017d89faa5df9acc`).

This is a **NO-GO as a complete product-size result**: #344's address
propagation had already moved the compact frontier 98.5 B over the frozen gate,
and the necessary adoption source leaves it 123.5 B over. The gate is not
rounded or relaxed. The next product slice must repay at least that deficit in
the generated receiver/entry union before any default cutover.

The linkage harness deliberately records `checksumRan:false`; it cannot execute
the ablated receiver. These bytes are production reachability and cost
attribution, not startup, FCP, interaction, memory, or default-path evidence.

## Failed cost shapes retained as controls

The first exact-clean form used two independent option fields and measured
81,638 gzip at `2eecce45f13dc4f5c4eeed1b64bc780ab0959063`
(receipt SHA-256
`7de026d81bfff8d96258a32a1fc8346e85ec30c983bc0db26e3775463e67eb5d`).
Coupling them in the options object measured 81,648 gzip at
`73e6efbe9f04e186abefb2cdc382d8ea7acce1cb`
(receipt SHA-256
`3b73db0a88a213f4b0a9834b4aee0b05332803f2854093d946172892d2a82756`).
Neither failed shape is counted as progress.

## Correctness gates

Independent tests paint a real emitted eventful program before controller
creation, then assert zero adoption attachments, original node identity and
event-token identity, ACK/complete settlement, and disposal of the adopted
native root. A second test crosses the actual framed ContextProxy receiver and
proves the same zero-repaint ownership transfer. Existing malformed-frame,
abort, response-fault, rollback-fault, exact-retry, and retryable-disposal tests
remain unchanged.

The remaining #290 work is the source proof builder/ownership transfer from the
shipping first-screen path, generated-entry installation, statically selected
general fallback, external consumer/HMR/lazy proof, size repayment/default
cutover, and same-window Web/Native timing and memory acceptance.
