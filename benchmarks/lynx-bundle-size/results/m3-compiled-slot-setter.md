# M3 compiled value-slot setter

Issue: #290

Baseline source: `Huxpro/octane@fff2785bf3a2fae9f7abb96723f188ca72e2dcfa`

Candidate implementation source:
`Huxpro/octane@866d42a26e93a83f3972bbeb77362d82a41331a4`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **accept the opt-in compiled value-slot setter primitive**

The Block background core already identifies one changed value slot. The
general receiver expands that answer into a complete prop bag, maps the host,
plans a generic prop diff, and then reaches the same Element PAPI write. The
accepted compiler primitive can instead attach
`create.set(nodes, slot, value)` to a proved main-thread program. The generated
switch addresses the wire value slot directly and preserves the dense scalar
route's class aliasing, clearing, string conversion, folded-text, raw-text, and
native-list attribute semantics.

This slice does not enable the primitive in a product build. A receiver must
first own header/slot-kind validation, instance/node retention, lifecycle, and
fault settlement. `slotUpdates` is therefore explicit and defaults off; a
program with no value slots also emits no empty setter.

## Controlled production result

An exact-clean four-arm `core-switch.mjs` run at the implementation commit
reproduced the merged baseline byte-for-byte. All receipt controls passed.

| `block+program` boundary | baseline raw / gzip / Brotli | candidate raw / gzip / Brotli | identity |
| --- | ---: | ---: | --- |
| encoded Native bundle | 418,005 / 160,511 / 134,730 | 418,005 / 160,511 / 134,730 | `536f12776f15acee80e191e9075f64af830cedf606beebbf04c7d41fed5e640e` |
| decoded background program | 187,742 / 53,880 / 46,365 | 187,742 / 53,880 / 46,365 | `0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37` |
| decoded main program | 227,416 / 106,320 / 87,656 | 227,416 / 106,320 / 87,656 | `4735539a230bdf15a1bfd980499086751a998ab70fa46fe1e3d6253a57427684` |

The exact-clean candidate receipt has SHA-256
`6958cca1eca29819aab68dce3b56831b5a2654521c89bd56402866df1099f189`.
It records `dirty:false`, the exact candidate SHA, Node 22.22.2, target SDK 3.9,
and the complete reachable-module ledger. The baseline identities are the
`block+program` arm already checked by #324; equality at all three artifact
boundaries proves this compiler-only primitive moved no cost to either thread.

## Semantic controls

- default and explicit-false emission are byte-identical;
- a range-bearing program gains the setter without incorrectly gaining the
  dense-run driver;
- a generated setter and the general applier leave the same physical tree for
  class, shadowed `class`, id clearing, folded text clearing, and raw-text
  replacement;
- independent node assertions pin each of those observable results;
- every scalar native-list attribute is updated through its own slot and can be
  withdrawn with a null PAPI write; and
- an unknown slot returns `false` without touching a node, leaving rejection to
  the future compact receiver's frame boundary.

The focused emitter/signature suite passes 63/63, the full Lynx project passes
50 files / 884 tests, all three Lynx TypeScript configurations pass, and the
backend cache signature is advanced to `lynx-main-thread-program/14` with its
source digest pinned.

No wall-clock, native startup, first-paint, update, memory, or cleanup claim is
made: no production consumer calls the new primitive yet. When a compact
receiver enables it, that PR must measure unique-shape, repeated-component, and
lazy-chunk growth rather than treating emitted code as free. M3 remains open at
160,511 gzip bytes against the 81,484.5-byte relative gate.
