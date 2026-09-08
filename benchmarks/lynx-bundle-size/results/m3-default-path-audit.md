# M3 product-default path audit

Issue: #290

Baseline source: `Huxpro/octane@47c50db72a5ead917f145af259b2993cc4c97b0f`

Audited harness-input diff SHA-256: `637330070584d938ea0a82c2ce28663ffb83e3abc38cfda31ba627f38b31d72f`

Fixture: `benchmarks/lynx-table/app`, `BENCH_AUTOROWS=0`, production Native build

Decision: **audit only; keep the universal core as the product default**

This report separates three boundaries that must not be substituted for one
another:

1. the encoded production `.lynx.bundle`;
2. the decoded main/background LepusNG programs carried by that bundle; and
3. the Rspack production compilation graph, split by complete incoming Lynx
   layer sets.

The machine-readable receipts are
[`m3-default-path-inventory.json`](m3-default-path-inventory.json) and
[`m3-default-path-core-switch.json`](m3-default-path-core-switch.json). Every
artifact/program row includes raw, gzip, Brotli, and SHA-256. The module lists
include source identifier, incoming layers, thread/shared classification,
chunks, and (for the controlled
switch) per-runtime used exports. A module remaining reachable in the
compilation graph is not counted as emitted compressed ownership unless a
controlled production artifact delta proves it.

## Reproduction

```sh
TMPDIR=/absolute/tmp/on-a-large-volume \
	OCTANE_AUDIT_BASE=47c50db72a5ead917f145af259b2993cc4c97b0f \
	OCTANE_INVENTORY_CALIBRATE=1 \
  OCTANE_INVENTORY_SOURCE='Huxpro/octane@47c50db72a5ead917f145af259b2993cc4c97b0f+issue-290-audit' \
  OCTANE_INVENTORY_OUTPUT="$PWD/benchmarks/lynx-bundle-size/results/m3-default-path-inventory.json" \
  node benchmarks/lynx-bundle-size/inventory.mjs

TMPDIR=/absolute/tmp/on-a-large-volume \
	OCTANE_AUDIT_BASE=47c50db72a5ead917f145af259b2993cc4c97b0f \
	OCTANE_CORE_SWITCH_OUTPUT="$PWD/benchmarks/lynx-bundle-size/results/m3-default-path-core-switch.json" \
  node benchmarks/lynx-bundle-size/core-switch.mjs
```

The inventory explicitly defines `__BENCH_CORE__='universal'` and
`__BENCH_BLOCK_MODE__='derived'`. Without those production constants, the
benchmark entry retained the hand-authored Block ceiling arm beside the normal
application even though users do not select it. That invalid mixed build was
608,459 raw / 171,354 gzip bytes on Web and 591,040 / 209,053 on Native; it is
not used below.

## Current product-default inventory

| artifact | raw | gzip | Brotli | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| Web bundle | 595,680 | 167,785 | 126,361 | `5bdbd9df2e34d2bc363f3bdd31c051c1f176f9ec0263eec03abb8174521b6649` |
| Native bundle | 578,193 | 204,036 | 170,926 | `fe6c6c1c937497844ee2e49017973a4c29460717ea38b8728c7250fa4403aeb7` |
| decoded main program | 275,564 | 80,510 | 67,427 | `28a44fae91d6cb1e37605faeeea99ab1fd995408309e0c75e04e45e34a3593aa` |
| decoded background program | 315,925 | 86,979 | 73,477 | `0b5fc403f110638efe1581569458d89e329d478522ada800b53d8aab9289c927` |

Both Web and Native compilation graphs contain 42 main-thread modules /
2,107,744 source bytes, 45 background modules / 2,474,764 source bytes, and one
707-byte shared CSS module. Both receipts have zero unassigned modules. The
shared classification uses all incoming Lynx layers, avoiding the unstable
answer produced when a multi-thread asset is assigned to whichever issuer
Rspack discovers first. These are source-reachability weights, not decoded
program size and not an estimate of device evaluation time.

## Controlled core/backend switch

All four arms compile the same rows-0 application through the production
pipeline. `block+program-descriptor` disables positional addressing so that the
main-thread code-generator delta is isolated; `block+program` uses the product
backend default, which changes both threads.

### Encoded Native bundle

| arm | raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| universal | 578,193 | 204,032 | 170,455 |
| block | 459,107 | 173,610 | 144,636 |
| block+program-descriptor | 460,204 | 174,617 | 145,508 |
| block+program | 460,620 | 174,756 | 145,507 |

### Decoded programs

| arm | background raw / gzip / Brotli | main raw / gzip / Brotli |
| --- | ---: | ---: |
| universal | 316,290 / 87,120 / 73,531 | 259,056 / 117,152 / 96,756 |
| block | 197,204 / 56,168 / 48,092 | 259,056 / 117,152 / 96,756 |
| block+program-descriptor | 197,204 / 56,168 / 48,092 | 260,153 / 118,150 / 97,583 |
| block+program | 197,271 / 56,213 / 48,099 | 260,502 / 118,268 / 97,495 |

The controlled observations are:

- Block minus universal on the decoded background program: **-119,086 raw,
  -30,952 gzip, -25,439 Brotli bytes**. The decoded main program is
  byte-identical, so the core switch did not shift this cost to MTS.
- Compiled-program codegen in descriptor mode: **+1,097 raw, +998 gzip, +827
  Brotli bytes on MTS**, with a byte-identical BTS program.
- Product-default positional addressing: **+67 raw / +45 gzip on BTS and +349
  raw / +118 gzip on MTS** relative to descriptor-mode codegen. Reporting this
  as a main-only backend cost would hide the real cross-thread change.

Every control in the receipt passes: exactly one core survives; the core switch
leaves MTS byte-identical; descriptor-mode codegen changes only MTS; and
positional addressing demonstrably changes both programs.

## Contemporary comparator gate

The frozen rows-0 cohort comes from
`Huxpro/lynx-js-framework-benchmark@d693679ed90d3197ad1db217b048c684d9b07cb9`.
It uses unpatched production artifacts built at exact producer commits; the
entry receipts carry dependency locks, build-driver hashes, and bundle hashes.

| comparator | raw | gzip | Brotli | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| ReactLynx default | 108,557 | 45,215 | 39,891 | `ce353c37184b1ab80d7ed2b04aa060d4718cc997842fec03155d17c5e8f09eea` |
| ReactLynx + Element Template | 99,466 | 39,953 | 35,151 | `8404ad378726eb97cf1c127c3e581410228048d98821044cfc52143192224419` |
| Vue VDOM default | 124,815 | 50,897 | 44,806 | `ce5c87723cd3183882fc87dedb708da0529132f8430b847c6638586d805b501a` |
| Vue VDOM + IFR + ET | 277,660 | 119,505 | 104,175 | `e14f202830132ac1d39edc4b36d72070d3e57441222c8b169604a01f288097f9` |
| Vue Vapor default | 148,160 | 57,749 | 51,073 | `95ec399e0a7f1821eddcb4cc316b6f157b61c65f1128ed848ae4ed12b854d196` |
| Vue Vapor + IFR | 308,874 | 134,731 | 115,891 | `976daa914360822a43a69ac6bfe0bf6b2f9c480d0ecab9d4e7ff69e35757598e` |

The six-comparator gzip median is `(50,897 + 57,749) / 2 = 54,323` bytes; the
issue's 1.5x gate is therefore **81,484.5 bytes**. The current Octane cohort
artifact is 578,085 raw / **203,994 gzip** / 170,482 Brotli bytes
(`24be53d3ab5b5d2fc08ecd9f8def91f34da11d32e0490ea544181e9c8e52b5a0`):
**3.755x the median**. Even the controlled `block+program` artifact is 174,756
gzip bytes: **3.217x the median**. It does not pass the gate.

## Public semantic coverage matrix

“Proven” means an independent user-observable assertion exists on that exact
path; differential equality alone is not counted. “Gap” does not imply the
universal implementation lacks the feature—it means the specialized Block
candidate cannot yet replace it as a product default without losing behavior.

| public behavior | universal product path | Block candidate | cutover result |
| --- | --- | --- | --- |
| state/reducer tuple, `getState`, conditional hook slots | proven by `background-root.test.ts` and `block-component.test.ts` | proven for state/getState and skipped slots | covered subset |
| refs and native events | proven, including ACK publication and cleanup | proven for root/range handlers; selector-store ownership proven | covered subset |
| effects and cleanup | proven, including list recycling | **explicitly refused** by `block-component.test.ts` | **blocking gap** |
| context | proven with updates and portals | **explicitly refused** by `block-component.test.ts` | **blocking gap** |
| Suspense / lazy pending / Activity | proven by `milestone-8-integration.test.ts` and `main-renderer.test.ts` | no Block-component proof | **blocking gap** |
| same-root portals and target reordering | proven by `background-root.test.ts` and host-driver tests | no Block-component proof | **blocking gap** |
| main-thread worklets | proven independently and in Block differential fixtures | proven for keyed rows, live captures, and scoped updates | covered |
| native lists and recycling | proven for logical state/effects, lazy cells, refs/events, faults, and cleanup | deferred template rows are proven; arbitrary Block-component coverage is incomplete | **blocking scope gap** |
| error / reject / abort / terminal cleanup | proven before and after host acceptance | range refusal is transactional; full component fault/abort surface not proven | **blocking scope gap** |
| first screen / direct apply / adoption / repair | proven for normal hosts, programs, native lists, faults, and teardown | Block commit behind an adopted first screen is proven | covered subset |
| keyed reorder / insert / remove / retained identity | independently asserted and differentially compared | proven for compiled ranges | covered |
| HMR / code splitting / external published consumer fallback | universal production build and lazy bundles are covered elsewhere | not audited for a default cutover | **blocking product gap** |

## Decision and next owner work

The specialized core is a real BTS reduction, but neither acceptance dimension
is satisfied: the package remains far above the relative size gate, and the
candidate default has public semantic gaps. This audit therefore does **not**
change `pluginOctane` defaults and does not claim runtime speed from compressed
bytes.

The next optimization PRs must attack the remaining product graph without
moving code between threads, emitting code unbounded in host/shape count, or
dropping fallback semantics. A later cutover PR must rerun this exact ledger,
close every blocking matrix row with independent assertions, package an
external consumer with HMR/lazy/fallback coverage, and then run the M3 Native
cold/ready/first-tap/steady-state matrix on the default build.
