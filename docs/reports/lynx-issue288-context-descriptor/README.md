# Lynx issue #288: sparse deep-context component rows

## Verdict

This slice removes the remaining whole-list key/body/descriptor enumeration
when an ancestor context update reaches only a small subset of a stable keyed
component list. At 30,000 rows with one context consumer behind 32 memoized
component layers, the production changed-context median falls from 163.059 ms
to 2.951 ms (-98.2%, 55.3x). The candidate remains approximately constant from
1,000 through 30,000 rows while preserving the same one commit, two commands,
reachable-host checksum, and painted `dark` leaf as the baseline.

This is a focused #288 slice, not the issue's final native acceptance. The
benchmark uses the production Universal background runtime and asynchronous
Lynx transport with fake Element PAPI. It does not include native layout,
display, or real cross-thread scheduling.

## Revisions and protocol

- Baseline: `2cca2572ef1f90133f709cb2b6ac0d63b9e5f34b`, the exact source content of
  merged PR #303 (context-independent memo owner retention).
- Candidate: `a8b7ac10335bfc78d4a863e8575a465baeebe6ae`.
- Both arms compile the same candidate ReactLynx fixture with the same
  candidate compiler and Lynx transport/PAPI chassis. Only the Octane runtime
  source revision differs.
- Production bundles are minified and have compiler/runtime profiling disabled.
- Each timing cell is warmed and then measured with a fresh mounted root in a
  mirrored ABBA/BAAB order. Row size and changed/unchanged order rotate. There
  are ten timing samples per arm and cell.
- Memory uses five fresh child processes per revision under `--expose-gc` and
  measures the 30,000-row mount and update.

The complete metadata, hashes, raw sorted timing arrays, deterministic oracles,
owner profile, and memory samples are checked in at
[`issue288-production-deep-context-descriptor.json`](../../../benchmarks/lynx-table/stages/results/issue288-production-deep-context-descriptor.json).

## Compiler proof and runtime index

The production compiler emits a stable-row dependency witness only when the
keyed body is a single immutable local component (including a local component
wrapped by the real `memo` import) and every dynamic prop is one direct
identifier. The item and index are covered by exact iterable identity; other
identifiers become `Object.is` dependencies. Member reads, getter-capable item
reads, calls, compound expressions, spreads, live/imported components,
development, HMR, profiling, and `autoMemo: false` retain the ordinary path.

After a complete render is accepted, the Universal owner stores a sparse
context-to-row index. It stores entries only for rows that actually read a
context: the other 29,999 rows in this fixture receive no persistent key-map
entry and no empty context-read map. On a provider update with the same iterable
and dependencies, the runtime resolves affected rows from that index and
replays their committed memoized component descriptors. It does not iterate the
source, invoke the key closure, invoke the list body, or materialize unrelated
row descriptors.

The sparse attempt is accepted only if owner identity, host topology, visibility,
component revisions, and the zero-feature/effect/boundary/transition gates stay
valid. It stages one ordinary sync or async host batch and publishes host props,
hooks, context versions, and the refreshed sparse index only after transport
acceptance.

## Deterministic semantic boundary

The transport regression mounts three stable rows with one nested context
consumer. Its changed-context update observes exactly:

| observable | result |
| --- | ---: |
| keyed-list key calls | 0 |
| keyed-list body calls | 0 |
| outer row component bodies | 0 |
| context consumer bodies | 1 |
| host commands | 1 |

The same test rejects the async transport batch, proves that the committed host
and descriptor remain on the previous value, and then accepts another sparse
update without a list scan. Replacing the iterable forces three key and three
body calls and preserves all host identities.

Additional development and production regressions prove the conservative
fallbacks:

- a context-dependent host type change is discovered before transport and
  retries the complete keyed list exactly once;
- a sparse row that suspends publishes nothing while pending and rebuilds from
  the complete list after wake-up;
- effect-owning rows never acquire the sparse descriptor, keep their mounted
  effects across a context update, and clean up exactly once on unmount;
- opaque compiler expressions emit no stable-row proof.

Transitions, replay episodes, active boundaries, hidden content, refs, events,
lifecycles, local callbacks, renderer regions, bridge roots, pending owner
updates, and structural changes all retain the complete transaction path.

## Production CPU and protocol result

Changed-provider elapsed time (milliseconds, lower is better):

| rows | baseline median | candidate median | reduction | speedup | candidate min–max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 7.766 | 3.357 | 56.8% | 2.31x | 2.615–9.073 |
| 10,000 | 57.172 | 3.261 | 94.3% | 17.53x | 2.754–13.847 |
| 30,000 | 163.059 | 2.951 | 98.2% | 55.25x | 2.755–6.969 |

Every changed sample in both arms records one authored leaf render, one host
commit, two host commands, the expected `context-leaf dark` class, and the same
row-count-specific host checksum. Every unchanged control records zero authored
bodies, commits, and commands. Candidate unchanged medians are 0.012, 0.017,
and 0.022 ms at 1k, 10k, and 30k.

The profiling compiler deliberately disables this production proof, just as it
does for keyed selection. Its owner profile therefore remains an attribution
control rather than evidence of sparse list access: both arms show one page
attempt, one outer row attempt, 33 layer attempts, one consumer attempt, and one
leaf attempt. The exact key/body access law comes from the direct runtime
regression above; the production end-to-end scaling comes from the unprofiled
ABBA result.

## Allocation, retained memory, and bundle debt

At 30,000 rows:

| forced-GC ledger | baseline median | candidate median | delta |
| --- | ---: | ---: | ---: |
| mount heap | 198,771,528 B | 199,559,056 B | +787,528 B (+0.40%) |
| transient update | 30,836,424 B | 9,890,432 B | -20,945,992 B (-67.9%) |
| post-GC update over mount | +13,992,360 B | -223,584 B | -14,215,944 B |

The small mount increase is reported rather than hidden. It covers the list
owner and the one actual context-consumer index entry; the implementation does
not retain an all-row duplicate key table. The large transient and post-GC
improvements match removal of whole-list descriptor reconstruction.

The production benchmark bundle grows from 735,990 B raw / 165,807 B gzip to
751,517 B / 168,966 B: +15,527 B raw (+2.11%) and +3,159 B gzip (+1.91%). Because
the compiler, fixture, and Lynx chassis are shared, this is the Universal
runtime cost of this slice. It is explicit M2 bundle debt for #288/#291 to weigh
against the 55x 30k context update and must not be treated as free.

## Verification and remaining gates

- Nine focused Universal/compiler files pass 491 assertions, including
  transport, scheduling, state, renderer, and event-scope coverage in both
  development and production configurations.
- The changed source files pass scoped typecheck; repository-wide `pnpm
  typecheck` passes all 294 workspace projects.
- Changed-file formatting, `git diff --check`, and `pnpm sync` pass with no
  generated drift.
- A repository-wide local `pnpm test` run reached 25,017 passing assertions
  before the host's shared temp volume and watcher limit produced
  `ENOSPC`/`EMFILE` cascades. After isolating TMPDIR and removing verified orphan
  preview servers, the only early failure that still reproduces under full-suite
  load is the unrelated CLI analyze test's 5-second timeout; that file passes
  8/8 alone and the other initially timed-out waypoint file passes 1/1 alone.
  Exact-current-head CI remains the clean-room full-suite authority and must be
  green before merge.

This result closes the remaining production O(N) deep-context descriptor scan
for the compiler-proved stable-row shape. Issue #288 still requires the native
tap-to-frame, real cross-thread/LepusNG, and global Lynx memory gates before its
issue-level acceptance can be claimed.
