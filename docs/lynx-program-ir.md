# Lynx compiler program IR and ABI

Status: implementation contract for issue #373. This is an internal compiler
and runtime boundary, not a published application API.

Octane compiles every eligible `.lynx.tsrx` host template into two independent
artifacts from one compiler-owned `LynxProgramIR`:

- the background-thread (BTS) module owns component execution, hooks, slot
  values, events, keyed ranges, and Block-core updates;
- the main-thread (MTS) module owns the resident create function and applies
  create/run/set operations to Lynx native elements.

Neither artifact derives the other's representation at runtime. An ordinary
production application first compiles conservatively so the paired graph can
prove complete Block coverage. The build then rebuilds only the proved
background source modules with the compiler-program renderer, alongside the
compact-product core/owner specialization. Unsupported, development,
and watch graphs retain the Universal renderer. An explicit `core: 'block'`
selects the same compiler output immediately and fails the build instead of
silently embedding a Universal plan.

## Shared IR

`packages/lynx/src/compiler/ir.ts` defines version 1:

| field | owner | meaning |
| --- | --- | --- |
| `version` | compiler | incompatible shared-IR version gate |
| `wire` | compiler | static host nodes, parents, props, and event sites |
| `values` | compiler | authored slot to resident positional-value map |
| `events` | compiler | authored slot to event-site map |
| `ranges` | compiler | structural keyed-range slot and parent-node map |
| `addressable` | compiler | whether both outputs can name the same program |

The compiler derives this object once per plan and caches the answer. Both
emissions therefore share eligibility, site order, and address allocation even
when Rspeedy compiles them in either order or in separate workers.

## Program address and ABI

Every emitted program is named by `(module, index, digest)`:

- `module` is the normalized `.lynx.tsrx` module id;
- `index` is the stable plan position inside that module;
- `digest` covers the lowered program identity.

The background definition and main-thread program both carry program ABI
version `1`. `packages/lynx/src/core/program-abi.ts` is the single runtime
constant. BTS adoption (`lynxProgram`) and MTS registration reject a different
version before mounting or registering the program.

`wire`, `values`, `events`, and `ranges` are immutable module-scope metadata.
Only the value array and `lynxProgramValue(program, slotValues)` wrapper are
allocated for a component render. Block consumes the emitted wire and maps
directly; it does not construct a `UniversalPlan`, call
`compiledUniversalTemplateProgram`, or prepare a host plan at runtime.

## One source, two outputs

For an authored component such as:

```tsx
function Card({ id, label, onPick }) @{
  <view id={id} bindtap={onPick}>
    <text>{label as string}</text>
  </view>
}
```

the outputs are conceptually:

```ts
// BTS: component/hook owner
const card = lynxProgram('lynx', {
  version: 1,
  address: { module: 'src/Card.lynx.tsrx', index: 0, digest: '…' },
  wire: { nodes: [/* static view/text shape */], events: [/* tap site */] },
  values: [/* id and label slot bindings */],
  events: [/* onPick slot binding */],
  ranges: [],
});
return lynxProgramValue(card, [id, onPick, label]);

// MTS: native create/run/set owner
const card = {
  kind: 'program',
  version: 1,
  address: { module: 'src/Card.lynx.tsrx', index: 0, digest: '…' },
  bind(papi) { /* straight-line native create function */ },
  run(/* … */) { /* create an addressed instance */ },
  set(/* … */) { /* update a compiled slot */ },
};
```

The snippets describe ownership, not stable generated spelling. Exact output
is pinned by `lynx-main-thread-program.test.ts` and the Rspeedy build tests.

## Semantic ownership

The existing Octane compiler front-end remains authoritative for source order,
explicit and inferred hook dependencies, conditional hook slots, and plain
custom-hook expansion. The shared IR begins after those decisions. Values and
event expressions are emitted in authored evaluation order on BTS; MTS receives
only their positional site maps and never executes component logic.

The first Block tranche supports compiler-addressable host-root templates,
scalar/text/property/event slots, and keyed ranges whose row programs have no
nested ranges. Component boundaries, conditional renderable holes, spreads or
host operations the Lynx program emitter cannot represent, non-host roots, and
nested row ranges are owned by later roadmap issues. The Universal preset keeps
supporting them.

Automatic production selection is deliberately two-pass: the first-pass
Universal-shaped output supplies coverage and semantic facts, while a
module-scoped Rspack compiler specialization rebuilds only a graph already
proved Block-compatible. Selecting `core: 'block'` is the explicit assertion
of the same surface, so an unsupported owner is a source-attributed build error
rather than a Universal runtime fallback.

DOM, the generic Universal renderer, and other Universal hosts such as Valdi
do not enable `compiler-program-ir` and retain their existing output.
