# M3 production protocol-error arguments

Issue: #290

Baseline source: `Huxpro/octane@f3bc8804a8834e6b66aca6a5bddca62c5cfe03b6`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production protocol-error arguments**

The shared transport validator already returned the compact `Octane Lynx OL174`
code in production, but its 162 `fail` callers still constructed labels,
messages, and field names before making the call. The accepted implementation
gates those arguments with the existing `__OCTANE_LYNX_DEVELOPMENT__` production
constant. Development keeps the complete path and message; production does not
evaluate or encode them.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
baseline and with only this mechanism changed. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 454,909 / 173,719 / 144,479 | 441,534 / 170,108 / 141,293 | -13,375 / **-3,611** / -3,186 |
| decoded main program | 250,716 / 115,855 / 95,364 | 244,923 / 113,849 / 93,820 | -5,793 / **-2,006** / -1,544 |
| decoded background program | 201,346 / 57,593 / 49,244 | 193,764 / 55,888 / 47,864 | -7,582 / **-1,705** / -1,380 |

The encoded gzip reduction is 2.079%. The shared protocol becomes smaller in
both programs; neither thread grows, so the result is not a thread transfer.
The candidate encoded bundle SHA-256 is
`424ab8ab777003c67b26f762dca837ea3b713ec8bb25f54a098e2a6ab45dca34`;
the candidate main/background program SHA-256 values are
`88cd21924c262e0ef39bc5cd76764eba0f43ee2bc20e39202f12d7fafed09692`
and
`99e6d4fc8614e80191bb80f8de9213deb88791a35ba4ecf7504bef980e8df7a7`.

The external baseline and working-tree candidate receipts have SHA-256
`15dd27869ac9cf25b447c6bcc8309cb88ae52db411daa8e83dc133752e475a32`
and
`270f1722d8d5e4eb0308cbfe6a92af07c567b007cba3d463af8403bdf3dc6402`.

## Semantic controls

- the production packed consumer excludes a known complete protocol diagnostic
  from both main and background programs;
- the development packed consumer retains that diagnostic in both programs;
- focused protocol validation retains the complete development paths and
  messages; and
- all core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 170,108-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
