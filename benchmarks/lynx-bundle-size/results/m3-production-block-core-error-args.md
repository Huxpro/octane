# M3 production Block-core-error arguments

Issue: #290

Baseline source: `Huxpro/octane@b56836b1e81278f16cf2c89de94349ceb7026126`

Candidate implementation source:
`Huxpro/octane@47aa0958830ec6f60974aedd5cf4087d44230212`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept compile-time removal of production Block-core-error arguments**

The specialized Block core already returned the compact `Octane Lynx OL015`
identifier in production, but its 15 `fail` callers still constructed their
diagnostic argument before making the call. The accepted implementation guards
every argument with the existing `__OCTANE_LYNX_DEVELOPMENT__` production
constant. Development keeps every complete error; production neither evaluates
nor encodes those arguments.

## Controlled production result

The same `core-switch.mjs` window built the exact rows-0 application at the
accepted #319 baseline and with only this mechanism changed. All receipt
controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | delta |
| --- | ---: | ---: | ---: |
| encoded Native bundle | 433,605 / 167,587 / 139,270 | 432,847 / 167,252 / 139,232 | -758 / **-335** / -38 |
| decoded background program | 188,383 / 54,195 / 46,576 | 187,625 / 53,873 / 46,259 | -758 / **-322** / -317 |
| decoded main program | 242,375 / 112,998 / 92,959 | 242,375 / 112,998 / 92,959 | byte-identical |

The encoded gzip reduction is 0.200%. `block-core.ts` belongs only to the
background Block core, and the decoded main program remains byte-identical with
SHA-256
`dfb37de6a2f52e262f41a0dba1b43db1bb3d28b5b889d05f60fcb4459aad9a17`,
so this is not a thread-cost transfer. The candidate encoded bundle SHA-256 is
`9359d11a5c4f3fc81ae7acbc5da89bda13af49e1158804ff22e855ecb6c8cb56`;
the candidate background program SHA-256 is
`b2737fe05d2f52d3dfe6632a3669d1f1e0052677812e1bac222129992189e022`.

The accepted #319 baseline receipt and exact-clean candidate receipt have
SHA-256
`4889b77936507321e468da5f8df7242a2c4780209c5bfe45dc76d40e85e1af04`
and
`fddeef232298c5d194e1626e14a9919ff470189303de2c8469a37f65c2751065`.
The baseline receipt names #319's exact implementation commit; its artifact and
decoded-program hashes are byte-identical to merge commit `b56836b1e`.

## Semantic controls

- an AST audit covers all 15 `fail` calls and confirms the diagnostic argument
  is guarded at every call site;
- an installed-package production Block build retains `Octane Lynx OL015`
  while excluding the known `a template needs at least one host node` message;
- an installed-package development Block build retains that complete
  diagnostic;
- both builds independently assert that OL015 remains background-only; and
- all core/backend isolation controls pass.

This slice does not satisfy M3 by itself. The resulting 167,252-byte gzip
artifact remains above #290's 81,484.5-byte relative gate, so the product
default and the issue state remain unchanged.
