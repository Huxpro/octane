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

`inventory-budgets.json` freezes total, thread-section, and owner-slice raw
budgets plus total gzip budgets on the integrated #706/#707 stack. The ledger
keeps #706's accepted size tax and #707's controlled optional-worklet saving
separate because compressed deltas are not additive.

The checked execution report is
[`results/production-inventory.md`](results/production-inventory.md).

## L5 ceiling ablation

`l5-ceiling.mjs` answers a question the budgets cannot: what #58's L5 bullet is
worth. It rebuilds both fixtures above with the plan interpreter, the batch
pipeline, and the recursive validator absent — by exported entry, letting
production tree-shaking compute each closure, so a helper the direct first-screen
path still calls stays and is not counted.

```bash
node benchmarks/lynx-bundle-size/l5-ceiling.mjs
```

It is an operator tool and not a CI gate: it rewrites `packages/lynx/src/core`
so a build can be taken with a target gone, refuses to start unless those sources
are clean, and restores them in a `finally`. Every arm must reproduce the
baseline's semantic checksums or the run fails, and the ablated artifacts are
measurement devices rather than functional runtimes.

The checked execution report is [`results/l5-ceiling.md`](results/l5-ceiling.md).

## Core switch and main-thread program

`node benchmarks/lynx-bundle-size/core-switch.mjs` builds the same fixture three
times through the real production pipeline and reports what each half of the
bundle weighs under the two independent switches that decide it: the background
core (`pluginOctane({ core })`, issue #103 B0) and the main-thread program
backend (`pluginOctane({ mainThreadProgramBackend })`, issue #163 C1d). The arms
are `universal`, `block`, and `block+program` — the last sharing a core with the
second, so anything separating them is the backend's.

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
