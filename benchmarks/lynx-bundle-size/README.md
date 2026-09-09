# Lynx preview and IFR bundle-size benchmark

This deterministic, Node-only suite production-builds the same representative
Octane Lynx application in two real Rspeedy/compiler shapes:

- `octane-preview` uses the background renderer plus the main-thread host
  receiver, but the authored application renders only in the background; and
- `octane-ifr` uses `@octanejs/rspeedy-plugin` application mode, so the authored
  first tree is compiled for main and the retained application is compiled for
  background adoption.

The harness decodes each `.lynx.bundle`, confirms its engine and thread graph,
rejects DOM and ReactLynx/React/Preact runtime module markers, and checks a
SHA-256 semantic marker checksum for the visible tree, keyed rows, state-driven
selection, and compiled native tap handler. Preview must contain the complete
authored graph in background;
IFR must additionally contain the matching visible-tree checksum on main while
keeping the background-owned tap update out of that program. Bytes are accepted
only after those checks pass.

The suite reports encoded bundle and decoded main/background program raw, gzip,
and Brotli bytes. Ratio gates bound IFR's encoded-bundle and decoded-main gzip
overhead relative to the background-rendered preview shape, while the harness
requires the decoded background metrics to match exactly.

```bash
node benchmarks/bench.mjs --ratios lynx-bundle-size
```

This is source/build evidence only. Decoding a production artifact does not
execute a Lynx engine and makes no native startup, first-paint, adoption,
latency, memory, or device-lifecycle claim.

## Complete rows-0 inventory

`inventory.mjs` additionally builds the exact rows-0 table fixture used by the
cross-framework runtime benchmark in both Web and Lynx production modes. It
records hashes and raw/gzip/Brotli totals, captures the encoded Lynx artifact's
pre-encode main/background programs, and attributes 100% of final raw bytes by
the production reachable-module owner weights. That proportional raw
attribution is for prioritization; only an isolated production build delta may
be described as gzip ownership.

The machine-readable inventory also preserves the complete module list grouped
by the full set of incoming Lynx layers: main, background, genuinely `shared`,
and a fail-visible `unassigned` group. This avoids assigning a shared CSS or
asset module to whichever thread Rspack happened to discover first, and a byte
reduction cannot be explained by silently moving source reachability to the
other thread. These are compilation-graph weights; decoded program bytes in the
same receipt remain the device-evaluated artifact boundary.

`inventory-budgets.json` freezes total, thread-section, and owner-slice raw
budgets plus total gzip budgets on the issue #57 first-screen template-range
candidate over exact base `dcf94cfc8`, which includes the merged dense-clear
teardown. The ledger keeps the older #706/#707 entries, pre-existing mainline
drift, and the candidate's controlled size tax separate because compressed
deltas are not additive.

The checked execution report is
[`results/production-inventory.md`](results/production-inventory.md).

## L5 ceiling ablation

`l5-ceiling.mjs` answers questions the budgets cannot: what #58's L5 bullet is
worth, and what compressed budget remains for a specialized M3 main-thread
receiver. It rebuilds the production fixture with the plan interpreter, the
batch pipeline, the recursive validator, or the general receiver absent — by
exported entry, letting production tree-shaking compute each closure, so a
helper another path still calls stays and is not counted.

```bash
node benchmarks/lynx-bundle-size/l5-ceiling.mjs
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --output /absolute/path/to/l5-product.json
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver \
  --output /absolute/path/to/receiver-ceiling.json
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-papi,receiver-store,receiver-frame,receiver-container,receiver-direct,receiver-render,receiver-transport,receiver-worklets,receiver-foundation-lite,receiver-foundation-store,receiver-foundation-frame,receiver-foundation \
  --output /absolute/path/to/receiver-frontier.json
```

It is an operator tool and not a CI gate: it rewrites `packages/lynx/src` so a
build can be taken with a target gone, refuses to start unless those sources are
clean, snapshots their exact bytes, and restores them in a `finally`. Every
arm must reproduce the baseline's semantic checksums or the run fails, and the
ablated artifacts are measurement devices rather than functional runtimes.

The `product` harness runs `core-switch.mjs`'s full four-arm isolation controls
for every ablation and records the current `block+program` complete artifact,
decoded BTS, and decoded MTS independently, including raw/gzip/Brotli sizes and
SHA-256 identities. Product-only mode cannot execute the ablated runtime, so its
receipt says explicitly that the semantic-checksum control did not run; the
default harness retains that executable checksum control for the historical
fixtures.

The `receiver-*` frontier arms start from the receiver-free ceiling and retain
one existing product dependency boundary at a time: normalized Element PAPI and
page creation, the general host container, its direct first-screen applier, the
compiled first-screen evaluator, paired string transport, or the optional
worklet seam. `receiver-store` prices the transactional compact program store
over the PAPI floor, while `receiver-foundation-store` measures its compressed
union with the complete non-host foundation. The corresponding `*-frame` arms
add the streaming v2 RUN/SET/REMOVE router and its store closure, including
deterministic native event tokens for eventful resident programs. They are
intentionally nonfunctional linkage probes. Their delta
over `receiver` is the exact production tree-shaken cost of reusing that
boundary in a replacement; it is not additive across arms and says nothing
about a newly written implementation with a different closure. The
`receiver-foundation-lite` arm measures the union without the general host
container; `receiver-foundation` adds that container. Both exclude the direct
applier, so shared code is compressed once rather than added from the individual
deltas.

The checked execution reports are [`results/l5-ceiling.md`](results/l5-ceiling.md)
and
[`results/m3-general-main-thread-receiver-ceiling.md`](results/m3-general-main-thread-receiver-ceiling.md).
The exact existing-boundary replacement budget is recorded in
[`results/m3-receiver-dependency-frontier.md`](results/m3-receiver-dependency-frontier.md).
The compiler primitive for the replacement's direct value-slot writes, with a
byte-identical default-product control, is recorded in
[`results/m3-compiled-slot-setter.md`](results/m3-compiled-slot-setter.md).
The transactional compact instance state and its exact foundation-union price
are recorded in
[`results/m3-compact-program-store.md`](results/m3-compact-program-store.md).
The streaming v2 RUN/SET/REMOVE router and its exact foundation-union price are
recorded in
[`results/m3-compact-program-frame.md`](results/m3-compact-program-frame.md).
The event-slot identity contract, production diagnostic repayment, and updated
event-capable frontier are recorded in
[`results/m3-compact-program-events.md`](results/m3-compact-program-events.md).

## Core switch and main-thread program

`node benchmarks/lynx-bundle-size/core-switch.mjs` builds the exact rows-0 table
fixture from the cross-framework benchmark four times through the real
production pipeline and reports what each half of the bundle weighs under the
switches that decide it: the background
core (`pluginOctane({ core })`, issue #103 B0) and the main-thread program
backend (`pluginOctane({ mainThreadProgramBackend })`, issue #163 C1d). The arms
are `universal`, `block`, `block+program-descriptor`, and `block+program`. The
third disables positional addressing to isolate main-thread codegen; the fourth
uses the product default, where supplying the backend also replaces background
descriptors with checked addresses. All Block arms use the
compiler-derived application path; the hand-authored Block ceiling program is
excluded from this product-default comparison.

The report has three non-interchangeable byte ledgers: the encoded production
`.lynx.bundle`, the decoded main/background LepusNG programs actually carried by
that bundle, and the pre-encoding Rspack reachable-module graph split by Lynx
layer. Every artifact/program row includes raw, gzip, Brotli, and SHA-256. The
module ledger records source identifiers, sizes, chunks, and Rspack used exports;
it intentionally does not turn those source weights into compressed ownership.
In particular, modules can remain in the compilation graph after final
tree-shaking has removed their runtime closure, so the decoded-program identity
and core controls remain the publication boundary.

Set `OCTANE_CORE_SWITCH_OUTPUT=/absolute/path/to/receipt.json` to retain the full
machine-readable receipt, including the exact source state and complete
main/background module lists. The output path should stay outside the repository
for a clean exact-head run.

The M3 product-default audit, comparator gate, and public semantic coverage
matrix are checked in at
[`results/m3-default-path-audit.md`](results/m3-default-path-audit.md). Its
machine-readable receipts use calibration mode to observe current head without
rewriting or weakening the older frozen inventory budgets.

Focused production-size rounds are indexed in
[`./.bundle-opt-log/SUMMARY.md`](./.bundle-opt-log/SUMMARY.md). The host-error
argument slice has a complete controlled ledger at
[`results/m3-production-host-error-args.md`](results/m3-production-host-error-args.md),
and the shared protocol-error slice is recorded at
[`results/m3-production-protocol-error-args.md`](results/m3-production-protocol-error-args.md).
The host-prop-error slice is recorded at
[`results/m3-production-host-prop-error-args.md`](results/m3-production-host-prop-error-args.md).
The background-only Block-component-error slice is recorded at
[`results/m3-production-block-component-error-args.md`](results/m3-production-block-component-error-args.md).
The shared worklet-error slice is recorded at
[`results/m3-production-worklet-error-args.md`](results/m3-production-worklet-error-args.md).
The background-only Block-core-error slice is recorded at
[`results/m3-production-block-core-error-args.md`](results/m3-production-block-core-error-args.md).

It is a control before it is a measurement. A branch on a constant the bundler
declines to fold ships both cores and still passes every unit test, so the run
fails if either core's strings survive in the other's bundle or if a core is
missing its own strings (stale probes). The plan constructors a compiled `.tsrx`
component calls are reported separately, because they belong to the application
module rather than to a core and are reachable under either flag.

The two switches are orthogonal, and the run asserts that rather than assuming
it. Across the **core** switch the main-thread program must be byte-identical:
that is what makes the core a background-only concern, and it is the claim the
digest pinning below exists to make checkable. Across the **backend** the
relationship inverts — the main-thread program must move, or the third arm is
silently measuring the second and reporting a flattering zero, while the
background program must not move at all, which is #163's promise that the half
of the bundle the backend does not own does not shift underneath it.

The backend arm carries its own probe, and the run counts it rather than testing
for it. The main-thread script is LepusNG rather than JavaScript text, so the
emitted create function's identifiers are gone by the time the harness reads it;
what survives is the constant pool. The probe is the `TypeError` message
`emitMainThreadProgram` writes into every program's preamble, guarding the host's
intrinsic element factories — so the minifier keeps it, and it lands once per
emitted program. The reported counts are `0`, `0`, `1`.

It is counted because the probe this replaced was not counted and rotted
silently. `ranges` — the wire program's key for the keyed holes its caller opens
rather than paints — separated the backends until the Lynx main renderer began
shipping its own runtime into every main-thread chunk, which carries the key
whether or not anything compiled a program. Measured, `ranges` now appears three
times in all three arms' main-thread chunk and ten times in both block arms'
*background* chunk, so a presence test read `yes` everywhere and the run failed
on its own specificity control. A count would have shown that as three where zero
was expected, which is why the column reports one.

The lesson is in which module the probe comes from, not in the string: a probe
taken from a *consumer* of programs fails this way as soon as that consumer
learns to mount one. This one is taken from the emitter, which is the only thing
that writes a program into a bundle. It fails by name if the preamble is
reworded, on the same staleness contract as the core probes, and the run also
asserts the count is zero in every background chunk — #163's split puts compiled
programs in the main-thread chunk and nowhere else.

Loading the backend at all needs one thing this harness owns. Octane publishes
every importable module as authored, so `@octanejs/lynx`'s backend is TypeScript.
Node strips the types by itself, but it does not rewrite a relative `./x.js`
specifier to the `./x.ts` beside it, so an unaided `import()` fails on the
backend's first internal import. `ts-source-resolution.mjs` registers that one
fallback and nothing else — it is a measurement device, not a build tool; a real
Lynx build hands the backend over from a config whose own loader understands
TypeScript.

The byte-identity check across the core switch needs the build digest pinned to
survive. Lynx's debug-metadata plugin prepends a per-chunk release digest to each
chunk's source before the minifier runs, and the digest moves whenever the bundle
moves — so across the switch the two main-thread programs reach the minifier as
text differing in forty characters. The mangler orders its identifier alphabet by character
frequency over that text, and the rarest characters sit close enough together
that a digest carrying seven `4`s against one carrying two reverses `4` and `6`,
renaming three identifiers. Normalizing the digest in the decoded output cannot
undo a naming decision already made, so the harness pins it in the source
instead, between the plugin's banner stage and minification, and fails by name
if an unpinned digest survives.
