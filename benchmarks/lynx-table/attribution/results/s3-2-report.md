# Lynx S3-2 BTS materialization report

## Provenance

- Parent: PR #22 (`perf/lynx-stage-decomposition`), measured by the S3-0 harness as
  `880.891 ms` median background-thread active time for create@10k.
- Stacked base: PR #25 / `219bd0782a7fd027edbca2b2e1066b4bde62c14e`.
- Candidate profile bundle SHA-256:
  `c8d7ba5b934a635c3fb8f37bd8c7078088ef4d97c44db01747b6282535833d4a`.
- Candidate control bundle SHA-256:
  `1711e6b7ed81c81544b465a9a252c7982e4fa6d6c4841605d7b67588a5adc619`.
- Raw inputs: `s3-2-final.json.gz` and `s3-2-control-cpu.json.gz`.
- Protocol: fresh page/background worker per CPU repetition; five ordered CPU
  repetitions; five fresh cold realms with first sample retained; deterministic
  five-tick update/select storms; identical row/checksum/selection/identity
  oracles in every sample.

## Change

- Compiler-proven keyed component rows defer empty directive/component owners,
  while hook access, nested components, conditional hooks, and getter-triggered
  hooks lazily restore the full owner boundary.
- Unchanged ownerless component rows carry a lightweight committed retention
  marker, so keyed moves preserve host identity and updates do not re-execute all
  10k rows.
- Pure mounts use linear reconciliation and placement planning while keeping
  blueprint, draft, and committed records isolated across replay attempts.
- Transport-approved plan instances stage only one root marker and provenance;
  Lynx folds it directly to `instantiate` and derives acknowledgement topology
  without rebuilding the per-host command stream.
- Empty hook/owner/draft collections are allocated lazily, and owner-free plan
  materialization avoids per-node identity-path arrays.

## Create @ 10k

| metric | PR #22 | S3-2 profile | S3-2 control |
| --- | ---: | ---: | ---: |
| wall median | 2784.6 ms | 2372.2 ms | 2456.1 ms |
| BTS active median | 880.891 ms | **451.112 ms** | 432.327 ms |
| MTS active median | 2057.6 ms | 2035.1 ms | 2073.9 ms |
| owner drafts | 20,001 | **1** | 1 |
| plan values/materializations | 20,001 / 20,001 | 10,001 / 10,001 | 10,001 / 10,001 |
| staged commands | 160,000 | **10,000** | 10,000 |
| frozen command objects | 160,002 | **10,002** | 10,002 |
| owner materialization | 266.1 ms | **125.3 ms** | 127.1 ms |
| transaction staging | 396.4 ms | **160.1 ms** | 165.1 ms |
| plan folding | 58.4 ms | **19.1 ms** | 20.5 ms |

Profile BTS samples: `476.731, 454.198, 440.212, 451.112, 437.674 ms`.
The profile/control delta is `+4.3%`; both independently pass the `<=500 ms`
acceptance threshold. The unprofiled control is `1.46x` the selected Vue VDOM
BTS reference (`296.5 ms`) and therefore also passes the `<=1.5x` reference
gate; the instrumented candidate is `1.52x` and is disclosed as observer cost.

## Adjacent workload gates

| operation | first median | steady median | PR #22 first | semantic |
| --- | ---: | ---: | ---: | --- |
| swap | 78.2 ms | 70.0 ms | 84.7 ms | pass |
| replace | 341.5 ms | 300.5 ms | 392.2 ms | pass |
| create | 281.0 ms | 224.6 ms | 328.3 ms | pass |
| clear | 70.6 ms | 57.0 ms | 76.4 ms | pass |
| select | 19.0 ms | 24.5 ms | 32.3 ms | pass |
| update10th | 29.3 ms | 24.9 ms | 42.1 ms | pass |

| storm | PR #22 median | S3-2 median | semantic |
| --- | ---: | ---: | --- |
| updateStorm | 150.3 ms | **105.1 ms** | pass |
| selectStorm | 43.1 ms | **38.0 ms** | pass |

Every CPU sample produced 10,000 rows with the expected checksum, selection,
first/last IDs, and survivor identity checksum. Every cold/storm sample passed
its presentation, wire, and survivor oracle. Update storm retained the inherited
5--6 commit envelope (500--600 changed rows/commands); making that count exact is
the separately stacked S3-5 task.

## Pareto gates

- Retained heap medians were `8,353,196`, `84,115,208`, and `239,676,196`
  bytes at 1k/10k/30k, a linear `7,977 B/row` slope versus #22's
  `15,075 B/row` (47.1% lower). Every destroyed worker was released.
- Create wire remained proportional at 10,000 commands / 3,294,620 median
  bytes versus #22's 160,000 commands, while MTS active time improved by 1.1%.
- All adjacent cold/steady operation medians improved against #22; none moved
  by the allowed +5% regression budget.

The formal heap raw input is kept for the immediately stacked S3-4 evidence PR,
so this PR remains the S3-2 CPU implementation unit.
