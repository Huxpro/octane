# M3 production host-prop-error arguments

Issue: #290

Baseline source: `Huxpro/octane@effbdad98be55026fc0374e0cadfd589b4c681e8`

Candidate implementation source:
`Huxpro/octane@b834c4ba4fcd14297b46bf7fd3acf90b119544d6`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production host-prop-error arguments**

The host-prop validator already returned the compact `Octane Lynx OL100` code
in production, but its 26 `propError` callers still constructed complete
messages before making the call. The accepted implementation guards those
arguments with the existing `__OCTANE_LYNX_DEVELOPMENT__` production constant.
Development keeps the complete messages; production neither evaluates nor
encodes them.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
baseline and with only this mechanism changed. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 441,534 / 170,113 / 141,338 | 438,405 / 169,163 / 140,475 | -3,129 / **-950** / -863 |
| decoded main program | 244,923 / 113,849 / 93,820 | 243,297 / 113,341 / 93,482 | -1,626 / **-508** / -338 |
| decoded background program | 193,764 / 55,892 / 47,897 | 192,261 / 55,476 / 47,599 | -1,503 / **-416** / -298 |

The encoded gzip reduction is 0.558%. The shared host-prop validator becomes
smaller in both programs; neither thread grows, so the result is not a thread
transfer. The candidate encoded bundle SHA-256 is
`a7e72433f7a8e853e94f11ac5fc31d192ae176f34078389c59ced488e490c3cc`;
the candidate main/background program SHA-256 values are
`033b7d2a1e3f511c8e279b863887d277f54866b283713886cc5b386ef0f44550`
and
`72cef7ff8e1283d6bb1ef31ba4505c69a8a92e40d7dc232cbfe1a1f3b04ba39c`.

The external baseline and exact-clean candidate receipts have SHA-256
`bc97febf4e97ad42b8ccca0991b89e55f319043adae57da09308157ec37c843d`
and
`1a37dd4003d874c675fa0843f2312d32da10fa2d5c5c8d7eca8ee7960d498aa1`.

## Semantic controls

- the production Native build retains `Octane Lynx OL100` while excluding a
  known complete host-prop diagnostic from both thread programs;
- the development packed consumer retains that complete diagnostic in both
  programs;
- the Lynx host-prop and classification suites retain complete development
  messages and rejection behavior; and
- all core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 169,163-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
