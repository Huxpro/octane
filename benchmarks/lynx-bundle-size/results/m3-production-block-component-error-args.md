# M3 production Block-component-error arguments

Issue: #290

Baseline source: `Huxpro/octane@6fda02b3d698c95b133e92e02f06fbc685d0fb86`

Candidate implementation source:
`Huxpro/octane@62da704a227d071b46b692430d92f048fa3990ff`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production Block-component-error arguments**

The Block component lowerer already had the compact `Octane Lynx OL013`
identifier, but production appended the complete refusal reason and remedy, and
all 22 `refuse` callers constructed their diagnostic arguments eagerly. The
accepted implementation guards both the final message and every call-site
argument with the existing `__OCTANE_LYNX_DEVELOPMENT__` production constant.
Development retains the named component, complete reason, and actionable
remedy; production emits only `Octane Lynx OL013`.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
baseline and with only this mechanism changed. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 438,405 / 169,163 / 140,475 | 435,573 / 168,203 / 139,904 | -2,832 / **-960** / -571 |
| decoded main program | 243,297 / 113,341 / 93,482 | 243,297 / 113,341 / 93,482 | 0 / **0** / 0 |
| decoded background program | 192,261 / 55,476 / 47,599 | 189,429 / 54,473 / 46,807 | -2,832 / **-1,003** / -792 |

The encoded gzip reduction is 0.567%. The Block component lowerer belongs only
to the background program: the candidate main program remains byte-identical,
including SHA-256, while the background program becomes smaller. The result is
therefore neither a main-thread transfer nor a cost hidden behind a different
compression boundary. The candidate encoded bundle SHA-256 is
`ac0fedee0877442c15fe28f3a56e8cd86ef4b9c58b5cf65688192d5fa4710996`;
the candidate main/background program SHA-256 values are
`033b7d2a1e3f511c8e279b863887d277f54866b283713886cc5b386ef0f44550`
and
`f6123c469ee3a6ecd6f26af349523db597723077299c00ef08f88acf352fe073`.

The external baseline and exact-clean candidate receipts have SHA-256
`1f70cddfc9730b374d910104f12062f0e87d77f0c7534c135b8d333321aeaf39`
and
`a820d8d61c0e7d115695c879609d8ee617c16ceee3304ad362e8de68cde07755`.

## Semantic controls

- an AST audit covers all 22 `refuse` calls and confirms every complete reason
  is guarded at its call site;
- the production Native bundle retains `Octane Lynx OL013` while excluding a
  known complete reason and the remedy from the decoded background program;
- the development bundle built from installed package archives retains the
  complete reason and remedy in the background program;
- neither production nor development places the Block-only diagnostic in the
  main program; and
- all Lynx and core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 168,203-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
