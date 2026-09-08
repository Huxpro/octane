# M3 production host-error arguments

Issue: #290

Baseline source: `Huxpro/octane@f8e6773efe27454002ac0da78d82358a29b4e711`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production host-error arguments**

`hostError` already returned the compact `Octane Lynx OL099` code in production,
but its 239 callers still constructed full diagnostic strings before making the
call. The accepted implementation gates each argument with the existing
`__OCTANE_LYNX_DEVELOPMENT__` production constant. Development keeps the full
messages; production does not evaluate or encode them.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
baseline and with only this mechanism changed. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 468,260 / 177,748 / 148,167 | 454,909 / 173,719 / 144,479 | -13,351 / **-4,029** / -3,688 |
| decoded main program | 264,067 / 120,050 / 98,985 | 250,716 / 115,855 / 95,364 | -13,351 / **-4,195** / -3,621 |
| decoded background program | 201,346 / 57,593 / 49,244 | 201,346 / 57,593 / 49,244 | byte-identical |

The encoded gzip reduction is 2.267%. The byte-identical background program
shows that the reduction is not a thread transfer. The candidate encoded bundle
SHA-256 is
`ceb10e6fd757db5e8746a14ea0b64a97271b13e9414764c9cccad8acc987158f`;
the candidate main/background program SHA-256 values are
`4dfd1bd5f26e39be8c17f3b599b8c342a832dc5e106f486836f8f4028dfc7a5b`
and
`9e0fa649f5062e38de0e7b28a63095f5bf87869c470b6d488be731e801394027`.

The external baseline and candidate receipts have SHA-256
`980ca87baa7e2ac35108218c1cb5e48b5572d285034a27c955d9a059010389d4`
and
`ba588d08638178f6424064245ddc3c2ea79da4321f09f38fb5ae2a48a1f8c7ea`.

## Rejected alternative

Wrapping every message in a lazy closure increased the encoded
`block+program` result to 180,157 gzip bytes, 2,409 bytes above the baseline.
The closure bytecode cost more than the strings it removed, so that arm was
rejected rather than presented as an optimization.

## Semantic controls

- the production packed consumer contains `Octane Lynx OL099` and excludes a
  known full host diagnostic;
- the development packed consumer retains that full diagnostic;
- all core/backend isolation controls pass; and
- the full Lynx project test suite remains the release gate.

This slice does not satisfy M3 by itself. The resulting 173,719-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
