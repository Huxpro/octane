# M3 production worklet-error arguments

Issue: #290

Baseline source: `Huxpro/octane@1a6a2acfbb493e12867eebf1faf64d1bbb3e84c3`

Candidate implementation source:
`Huxpro/octane@d6bb1e56ef6ac17b167ad019c86fa35935ec9f6f`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production worklet-error arguments**

The shared worklet validator already returned the compact `Octane Lynx OL273`
identifier in production, but its 39 `fail` callers still constructed both the
diagnostic label and message before making the call. The accepted
implementation guards both arguments with the existing
`__OCTANE_LYNX_DEVELOPMENT__` production constant. Development keeps every
complete error; production neither evaluates nor encodes those arguments.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
baseline and with only this mechanism changed. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 435,573 / 168,203 / 139,904 | 433,605 / 167,587 / 139,270 | -1,968 / **-616** / -634 |
| decoded main program | 243,297 / 113,341 / 93,482 | 242,375 / 112,998 / 92,959 | -922 / **-343** / -523 |
| decoded background program | 189,429 / 54,473 / 46,807 | 188,383 / 54,195 / 46,576 | -1,046 / **-278** / -231 |

The encoded gzip reduction is 0.366%. `worklets.ts` is shared by both Lynx
programs, and both programs become smaller; neither grows, so this is not a
thread-cost transfer. The candidate encoded bundle SHA-256 is
`16ebdb58c23e97ad4b81f23b4929fb6c6a2358aa5726ab84737a8b6350a4b9c5`;
the candidate main/background program SHA-256 values are
`dfb37de6a2f52e262f41a0dba1b43db1bb3d28b5b889d05f60fcb4459aad9a17`
and
`de0db0781b5b7991020d65219b97a5a164086878a2b3601a64049d90d7d9df99`.

The external baseline and exact-clean candidate receipts have SHA-256
`7ef5a227bc60bd71c01bee0f22129cd31e5b86caf79b33cec175a4f043e31de1`
and
`4889b77936507321e468da5f8df7242a2c4780209c5bfe45dc76d40e85e1af04`.

## Semantic controls

- an AST audit covers all 39 `fail` calls and confirms both diagnostic
  arguments are guarded at every call site;
- production Native builds retain `Octane Lynx OL273` while excluding the
  known `main-thread worklet implementation` label from both programs;
- development builds from installed package archives retain that complete
  diagnostic in both programs;
- the full worklet behavior suite retains clone-safety, registry lifetime,
  cross-thread call, cancellation, and reload rejection behavior; and
- all core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 167,587-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
