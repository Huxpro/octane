# Lynx issue #288, slice 1: compiler-proved keyed selection

## Verdict

This slice removes the remaining whole-range enumeration for the narrow,
common selection shape already present in the table benchmark:

```tsrx
@for (const row of rows; key row.id) {
	<Row row={row} isSelected={selected === row.id} onSelect={select} />
}
```

The production universal compiler now records that `selected` reaches the row
only through a strict comparison with its key. Once the Block lowering has
validated and retained the initial rows, a render with the same iterable and
the same other captured values reaches the previous and next selected rows by
key. It does not materialize the iterable, call the key function, build a
replacement retained map, or call the range body for unrelated rows.

The deterministic access law changes from `N` range-body calls to `K`: no
selection to one key calls one row, moving selection calls two rows, and an
unchanged selection calls none. Host commands and Block lookups remain the
existing `1 / 2 / 0`, so no work moved across the wire or onto the main thread.

The uninstrumented Lynx-for-Web A/B is neutral within noise, including the
30,000-row amplification run. This is therefore a scoped-work/complexity win,
not a latency claim. The shipping bundle grows by 1,674 Web bytes and 1,678
Lynx bytes (529 / 564 bytes under gzip), so #288 remains open for the wider
external-store, context, async, and native latency gates.

## Owner correction

The Phase-0 universal-core attribution reproduced the historical owner: at
10,000 rows, `select` spent 52.5 ms / 72.3% in `bg_prepare`, rendered one Row,
visited 10,029 child blueprints, and emitted one host command. `update10th`
spent 72.7 ms / 41.5% in `bg_prepare`, rendered 1,000 Rows, visited 11,028
blueprints, and emitted 1,000 commands.

That is not the current Block-derived path. Before this change, Block-derived
already rendered only one Row and performed one keyed Block lookup for the
first selection, but `renderRange` still materialized all items, called every
key function and range render closure, and shallow-compared every row's props.
The existing counters did not expose that enumeration. The callback-counting
regression test added here observes exactly this remaining owner rather than
repeating #103's already-landed Block lookup work.

The formal universal attribution is retained in
`benchmarks/lynx-table/stages/results/issue288-owner-baseline-10000.md`; its
decision-bearing machine-readable fields are in the adjacent
`issue288-owner-baseline-10000-summary.json`.

## Compiler proof and fallback

The proof reuses the shape and safety rules of the DOM compiler's established
keyed-selection specialization and narrows them for component-owned universal
rows. It is emitted only for production compilation when all of these hold:

- the keyed body is the sole component row already accepted by
  `templateProgramForComponent`;
- the component is a same-module function or immutable function-valued `const`
  whose binding is not reassigned or shadowed;
- the explicit key is one direct, noncomputed item property;
- exactly one outer identifier is compared with that same item property using
  `===`, and that identifier appears nowhere else in the row props;
- the item itself is directly forwarded through a named prop, so the existing
  retained props supply the old/new item without adding per-row state;
- every other outer capture is passed as a bare prop value, so its current
  value is a complete dependency witness. An index-dependent prop is allowed:
  retained rows carry their last committed order and structural fallbacks
  refresh it before another sparse selection can run.

HMR, development, compiler profiling, `autoMemo: false`, spreads, refs,
explicit row keys, duplicate/prototype-sensitive props, calls, outer member
reads (including getter-capable reads), imported/live or reassigned component
bindings, non-forwarded items, key mismatches, and extra
selection captures emit no proof. The old full-range path remains byte-for-byte
the semantic fallback.

At runtime the fast path additionally requires:

- the exact iterable identity from the last applied render;
- an established retained row/key table from a successful full render;
- `Object.is` equality for every non-selection capture;
- the same retained component identity for each row reached by key.

A rows replacement, update-every-tenth operation, reorder, handler change,
store/context fanout, or opaque render therefore takes the full path. All rows
are still produced before any host write; a throwing old/new Row leaves the
last applied range intact.

## Deterministic scale gate

The regression drives 100 stable rows through the public Block component
lowering and counts the authored range closure, Row body, Block lookups, and
host commands around each render:

| operation | range calls | Row bodies | Block lookups | host commands |
| --- | ---: | ---: | ---: | ---: |
| select none → 25 | 1 | 1 | 1 | 1 |
| select 25 → 75 | 2 | 2 | 2 | 2 |
| select 75 → 25 | 2 | 2 | 2 | 2 |
| select 25 → 25 | 0 | 0 | 0 | 0 |

Both two-row transitions evaluate row 25 before row 75, including the reverse
selection transition, and receive committed indices 24 and 74. This preserves
the full range's list-order execution boundary while avoiding its scan.

Changing the non-selection handler visits all 5 fixture rows. Replacing and
reordering the rows array also visits all 5, after which a selection on that
same reordered array again visits only the two affected keys. These are exact
counts rather than timings, and the same assertions hold independently of
host speed.

The fast path retains one numeric order index per already-retained component
row, but no second item reference or key map. It allocates one constant-size
sparse result and at most two replacement retained records per selection, so
update-time work and allocation scale with touched keys rather than list
length. A full rows update or reorder legitimately remains O(N) and refreshes
the retained order, as required by #288. Native production memory remains an
open issue-level gate rather than being inferred from this layout.

## Shipping wall-clock A/B

Both arms are production `core: 'block'`, `derived` builds of the same table
application. The baseline bundle came from the preceding #287 head and the
candidate from this working tree. `web/run-web.mjs --cell-bundle` served both
unmodified bundles in one Chromium window, alternated their order AB/BA, drove
the same buttons and composed-tree predicates, and recorded zero DNF.

### 1,000 and 10,000 rows, n=5 per arm

| scale | operation | baseline median ±95% CI | candidate median ±95% CI |
| ---: | --- | ---: | ---: |
| 1k | create | 105 ±2 ms | 107 ±1 ms |
| 1k | update10th | 15 ±2 ms | 17 ±1 ms |
| 1k | select | 19 ±1 ms | 20 ±0 ms |
| 10k | create | 888 ±24 ms | 894 ±19 ms |
| 10k | update10th | 118 ±17 ms | 119 ±4 ms |
| 10k | select | 32 ±3 ms | 30 ±4 ms |

Host load moved from 2.60/2.68/3.45 to 1.77/2.42/3.31 over 32 CPUs. The
intervals overlap; selection differs by +1 ms at 1k and -2 ms at 10k. Raw
arrays and the zero-DNF record are in
`evidence/web-production-abba-1000-10000.json`.

### 30,000 rows, n=7 per arm

| operation | baseline median (min–max) | candidate median (min–max) |
| --- | ---: | ---: |
| create | 2,484.9 (2,385.7–2,619.8) ms | 2,447.4 (2,347.6–2,523.0) ms |
| update10th | 462.7 (428.7–471.9) ms | 453.6 (438.2–501.0) ms |
| select | 73.5 (70.1–272.5) ms | 73.6 (68.8–281.5) ms |
| clear | 2,132.6 (2,115.8–2,222.5) ms | 2,139.5 (2,072.7–2,277.0) ms |

Host load moved from 0.55/0.59/0.82 to 2.29/1.95/1.36 over 32 CPUs. The
selection medians differ by +0.1 ms while both ranges contain large scheduler
outliers. Update/select storm durations are intentionally excluded from the
verdict because faster background progress changes how their macrotasks fold
into commits; the harness already classifies those counts and walls as
interleaving-dependent rather than invariants.

The complete 30k raw timing arrays, metadata, and zero-DNF record are in
`evidence/web-production-abba-30000.json`.

## Bundle ledger

All bundles are uninstrumented production builds. The gzip column uses
`gzip -9`; neither form is substituted for wall-clock work.

| target | baseline bytes / SHA-256 | candidate bytes / SHA-256 | delta | gzip delta |
| --- | --- | --- | ---: | ---: |
| Web | 467,049 / `0856da73fa4b9dc5e50c135e3349368b5f5ac0809e75cf092f0c795b315ffc05` | 468,723 / `22aa994b6ac7f04b05fb0a5c74727f0383c5ad735eeaa8589c00016ab132e67e` | +1,674 (+0.36%) | +529 (+0.40%) |
| Lynx | 449,623 / `2ea5a61f74354f35b6cf3d3ef573bbf6a890a882f90a76033516400162e7136c` | 451,301 / `c39b5a4bff62149cff83aeb1eaa37cce65e8ac28fe7b65fa255c3d1614d70d7f` | +1,678 (+0.37%) | +564 (+0.33%) |

This is explicit debt for later #288 slices. No benchmark-only runtime branch
or per-row retained field is hidden from the ledger.

## Verification and remaining gates

Focused verification at the measured source state:

- universal compiler, renderer-boundary, and Block component tests: 133/133 passing;
- scoped Octane/Lynx and repository-wide typecheck: passing;
- `pnpm sync`: current with no generated drift;
- changed-file formatting and `git diff --check`: passing.

The repository-wide Vitest pass completed all 2,453 files and all 26,930
non-skipped assertions (one existing skip). That host initially exhausted its
128 per-user inotify instances because eight orphaned Vite preview processes
from prior test sessions were still alive; Vitest therefore reported unhandled
`EMFILE` watcher errors even though every assertion passed. After terminating
only those verified orphan previews, the three browser projects named by the
watcher errors passed 12/12 with zero unhandled errors. Current-head CI remains
the clean-room full-run authority.

A deliberate mutation control that removed the exact-iterable guard made the
rows-replacement fallback assertion fail; restoring the guard returned the
focused suite to green. This slice does not close #288. Remaining issue-level
acceptance includes external-store selector and deep-context fanout ownership,
async/suspense/transition/rejection storms, native tap-to-frame p50/p95 and
production CPU/memory, and a final bundle-debt decision against the whole M2
result.
