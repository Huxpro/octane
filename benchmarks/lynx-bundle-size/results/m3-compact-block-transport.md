# M3 compact Block transport adapter

- Issue: #290
- Merged base: `new-lynx@c144f4f171e9c449e532c56eeef2e85814e03039`
- Exact-clean implementation and measurement head:
  `0b2d6aa1815a2c131d3c9281f6a2d709249484c4`

## Result

Compiler-proven program addresses now survive the compiled Block component and
produce `mount-program-run` commands. A new background adapter lowers only
fully addressed scalar Block batches through the transactional delta shadow
and the compact compiled-program ContextProxy channel. Unsupported batches are
refused before they cross the thread boundary; the existing general transport
remains the product path until the root selector and fallback land.

The adapter publishes the delta shadow, Block listener journal, and accepted
root identity only at acknowledgement. It preserves an already accepted
listener while a later acknowledgement is pending, holds a newly installed
native listener for the one acknowledgement it can race, leaves a rejected
draft unpublished for exact-identity retry, forwards cancellation before
readiness, and drops ownership after disposal.

This slice deliberately does **not** select the adapter from the generated
application entry. The production inventory confirms
`compiled-program-block-transport.ts` is absent from every current arm and the
reachable module counts remain 47 background / 50 main. Therefore the byte
deltas below price only the now-shipping Block address propagation and
validation; they are not a compact-transport latency or size win.

## Same-window production control

Command, run once in an exact detached base worktree and once at the clean
implementation head:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
OCTANE_CORE_SWITCH_OUTPUT=/absolute/path/to/receipt.json \
node benchmarks/lynx-bundle-size/core-switch.mjs
```

All four real Rspeedy production arms passed their one-core-only, backend
isolation, program-presence, and thread-ownership controls in both runs.

| Default `block+program` artifact | Base | Candidate | Delta |
| --- | ---: | ---: | ---: |
| complete bundle gzip | 160,177 | 160,304 | +127 B |
| decoded BTS gzip | 54,126 | 54,263 | +137 B |
| decoded MTS gzip | 105,730 | 105,730 | 0 B |

The descriptor Block arm moved from 159,801 to 159,934 bytes gzip (+133 B),
and the plain Block arm from 158,748 to 158,887 bytes gzip (+139 B). The MTS is
byte-identical in every corresponding arm. The universal control moved -22
bytes gzip because the harness pins a source-derived build digest and the
reachable source changed; no universal-core behavior changed. The addressed
default's exact candidate identities are:

- bundle SHA-256:
  `f928018aaa160cdd2a9d5db0d47c627ae791dc5d5f89111f4b71460ab8ea0414`;
- BTS SHA-256:
  `5f20b0580d5c2011e1e3bd19087c9d40c302f1f51f3e7316af49559184f9015e`;
- MTS SHA-256:
  `59144f94ca942701c331b02aa3be65abd3bcfae2bddd4235de8b155a3b9f07db`.

Raw receipts:

- base:
  `/data00/home/xuan.huang/.codex/tmp/m3-block-adapter-base-c144f4f17.json`,
  SHA-256
  `13f8d69dc5af871d0a9047af797e788d83dcfae1b93fc1457d35ec209447bed1`;
- candidate:
  `/data00/home/xuan.huang/.codex/tmp/m3-block-adapter-candidate-0b2d6aa18.json`,
  SHA-256
  `16f70d2f577bf2d5216dcdf02cfda80b075356a55d8eee4245a838171e1a5901`.

Both receipts record clean trees, Node `v22.22.2`, an empty harness diff, and
empty control-failure lists.

## Verification and remaining boundary

- compiler-address propagation crosses the real checked background protocol
  and resident-program resolver;
- focused Block component and compact-adapter suites pass 55/55 tests;
- the full Lynx project passes 55 files / 958 tests;
- full repository typecheck and synchronization pass; and
- OL494 is unique and the production diagnostic sequence remains contiguous.

No production runtime claim is made here. Generated receiver installation,
root-level negotiated selection, the explicit general fallback, first-screen
ownership transfer, external-consumer proof, and Native same-window acceptance
remain required before #290 can close.
