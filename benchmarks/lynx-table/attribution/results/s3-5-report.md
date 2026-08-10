# Lynx S3-5 teardown and storm-constant report

## Provenance and protocol

- Stacked base: S3-4 PR #32 /
  `ae7e5d72e0765fc12613f235d36ebab96ddec929`.
- Comparison base: PR #22 / bundle
  `1633935a3dd9f6b443be8ce461951f65b28af6b832bda5b5a7963c4dd2e2eaa4`.
- Candidate bundle:
  `523580543ba19ce7131653b3c478e76d533530b407a7d2b9b543c848118675ca`,
  unchanged from S3-4 and the final S3-2 runtime.
- Raw pre inputs: `heap-raw.json.gz`, `cold-raw.json.gz`, and
  `storm-raw.json.gz`; raw post input: `s3-5-final.json.gz`.
- The post run used five fresh page/background-worker realms for heap and each
  cold operation, plus five storm repetitions. The uncompressed post JSON is
  identified by SHA-256
  `3bac004728b40fdf7728a77550b5f4f5b8d0ebd73c8991cc89c7a60124f512a8`.
- Heap samples use explicit CDP GC. All samples retain their semantic,
  presentation, wire, survivor-identity, and worker-release observations.

## Split teardown cost at 10k

| boundary | median | min--max | meaning |
| --- | ---: | ---: | --- |
| UI clear | 738.1 ms | 715.8--748.8 ms | `Clear` event through an observable zero-row table |
| synchronous view destroy | 1.5 ms | 1.3--1.8 ms | synchronous `removeView()` call after clear settles |
| background-worker release | 7.3 ms | 6.5--9.5 ms | page close through disappearance of the worker target |

The boundaries are deliberately separate. `removeView()` destroys the Lynx
view but does not own the page's background worker, so worker release begins at
page close rather than being hidden inside UI clear or mislabeled as view
destruction. All five worker targets disappeared within the measured interval.

The cleared worker retained a median `22,652,592 B` above its pre-table
baseline, reported separately from time-to-clear. The live 10k table retained
`84,114,800 B`, effectively identical to S3-4's `84,115,208 B` (-0.0005%).

## Deterministic storms

| operation | wall median | commits | changed rows | wire commits | wire commands | semantic |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| update, 5 delivered states | 142.7 ms | **5 (5--5)** | **500 (500--500)** | **5 (5--5)** | **500 (500--500)** | pass |
| select, 2 delivered states | 43.4 ms | **2 (2--2)** | **3 (3--3)** | **2 (2--2)** | **3 (3--3)** | pass |

Each update click now waits for its exact label suffix before the next click;
each select waits for the exact selected row. This measures the same five
update and two select states on every repetition instead of asking a 50/30-tick
producer to race transport backpressure. The previous producer rate made
delivered commit count nondeterministic without changing the final table.

Relative to #22's semantically matched envelope, update improves from
`150.3 ms` while locking its former `5--6` commits to exactly five. Select is
`+0.7%` from `43.1 ms`, within the 5% envelope. Every repetition preserves the
exact changed-row and wire-command floors, row/checksum/selection oracle,
survivor host identity, and successful delegated events.

## Cold and steady envelope

| operation | #22 first / steady | S3-5 first / steady | worst delta vs #22 | semantic |
| --- | ---: | ---: | ---: | --- |
| swap | 84.7 / 71.7 ms | **76.6 / 65.0 ms** | -9.3% | pass |
| replace | 392.2 / 335.6 ms | **336.9 / 292.4 ms** | -12.9% | pass |
| create | 328.3 / 255.2 ms | **286.6 / 226.5 ms** | -11.2% | pass |
| clear | 76.4 / 60.2 ms | **73.6 / 59.5 ms** | -1.1% | pass |
| select | 32.3 / 21.4 ms | **19.7 / 21.9 ms** | +2.3% | pass |
| update10th | 42.1 / 30.5 ms | **32.0 / 25.7 ms** | -15.9% | pass |

All first and steady medians remain inside the reference envelope; none
regresses more than 5%. Update10th keeps exactly one commit, 100 changed rows,
and 100 wire commands per sample. Select keeps one commit and the exact one- or
two-row floor implied by whether a previous selection exists.

## Pareto gates

| metric @10k | PR #22 | S3-5 | delta |
| --- | ---: | ---: | ---: |
| create wall | 2755.1 ms | **2331.7 ms** | -15.4% |
| retained heap | 156,943,976 B | **84,114,800 B** | -46.4% |
| create wire commands | 10,000 | **10,000** | 0.0% |
| create wire bytes | 3,297,829 B | **3,294,694 B** | -0.1% |

The candidate bundle hash is identical to S3-4, so this final layer changes the
measurement contract rather than runtime output. Together with the formal
samples above, it introduces no create, retained-heap, wire-byte, cold, or
steady-state regression.

## Judgment

Judgment: **S3-5 passes**. Teardown ownership is reported at three explicit
boundaries, update/select storm counts are exact across every repetition, and
the final stack preserves all performance and semantic gates.
