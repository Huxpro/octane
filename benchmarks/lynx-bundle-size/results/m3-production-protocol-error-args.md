# M3 production protocol-error arguments

Issue: #290

Baseline source: `Huxpro/octane@f3bc8804a8834e6b66aca6a5bddca62c5cfe03b6`

Candidate implementation source:
`Huxpro/octane@cd39e7f24f36b14d4a9505542cbaf9e76444a429`

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
| encoded Native bundle | 454,909 / 173,719 / 144,479 | 441,534 / 170,113 / 141,338 | -13,375 / **-3,606** / -3,141 |
| decoded main program | 250,716 / 115,855 / 95,364 | 244,923 / 113,849 / 93,820 | -5,793 / **-2,006** / -1,544 |
| decoded background program | 201,346 / 57,593 / 49,244 | 193,764 / 55,892 / 47,897 | -7,582 / **-1,701** / -1,347 |

The encoded gzip reduction is 2.076%. The shared protocol becomes smaller in
both programs; neither thread grows, so the result is not a thread transfer.
The candidate encoded bundle SHA-256 is
`ca64e1b614d5c113a1006a7a3124f222d8a294493b6673ae0927c5bbc1cbb705`;
the candidate main/background program SHA-256 values are
`88cd21924c262e0ef39bc5cd76764eba0f43ee2bc20e39202f12d7fafed09692`
and
`77d354c829464d8aab87614676aaf68f26508ec1acef7faca0e4682fe9615150`.

The external baseline and exact-clean candidate receipts have SHA-256
`15dd27869ac9cf25b447c6bcc8309cb88ae52db411daa8e83dc133752e475a32`
and
`5d307707b0c647b8905f54020c2f3800c98574d30d85c499284916c52c321529`.

## Semantic controls

- the production packed consumer excludes a known complete protocol diagnostic
  from both main and background programs;
- the development packed consumer retains that diagnostic in both programs;
- focused protocol validation retains the complete development paths and
  messages; and
- all core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 170,113-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
