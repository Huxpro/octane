# Issue-#163 C0 — MTS-resident block program: first-screen pricing

**Verdict: GO.** A main-thread program emitted from the framework's own plan →
wire lowering lands on the `octane-direct` ceiling at every scale — **+1.7% /
+2.8% / +1.3%** of it at 1k / 10k / 30k — while painting a structurally
identical first screen.

## Session

- date: 2026-08-25 (UTC), one host, one session, no reboot between cells
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; Node v22.22.2; headless Chromium
- 1m load at each run start: 0.32 (1k), 0.35 (10k), 0.34 (30k). The harness
  refuses above 0.5 × 4 CPUs = 2.0; each scale additionally waited for load to
  fall under 0.40 before starting, so no run needed `--allow-busy-host` and none
  is a degraded-run number.
- protocol: `prototype/run-fcp.mjs`, fresh page per sample, cells alternate
  AB/BA within one window, n=5 per cell per scale
- boundary: view attach → first frame satisfying the shared composed-tree
  predicate (`__x.fcp({minContent: rows, idleMs: 300})`)
- all three cells built from this branch's base, `new-lynx` at `88c602a4e`

## First-screen FCP

| rows | `octane` | `octane-direct` | `octane-mts-block` | mts ÷ direct | mts ÷ octane |
|---:|---:|---:|---:|---:|---:|
| 1 000 | 214.6 ms | 130.1 ms | **132.3 ms** | 1.017× (+1.7%) | 0.616× |
| 10 000 | 1 403.1 ms | 868.1 ms | **892.1 ms** | 1.028× (+2.8%) | 0.636× |
| 30 000 | 4 218.7 ms | 2 400.5 ms | **2 432.5 ms** | 1.013× (+1.3%) | 0.577× |

Medians of 5. Observed ranges (min–max):

| rows | `octane` | `octane-direct` | `octane-mts-block` |
|---:|---:|---:|---:|
| 1 000 | 206.8–226.7 | 122.8–139.1 | 126.9–137.7 |
| 10 000 | 1 397.1–1 454.0 | 856.8–936.9 | 856.0–953.0 |
| 30 000 | 4 113.3–4 321.0 | 2 360.1–2 436.9 | 2 303.0–2 482.8 |

The two program cells' ranges overlap at every scale, so no claim is made that
one is faster than the other. What the three scales do agree on is the sign: the
derived program sits a little *above* the hand-written ceiling, by about the
amount the two stated overheads below would predict — one extra `push` per row
and a one-call adapter. Earlier ladders in this session, taken on the previous
base and under varying host load, put the same comparison between −7.3% and
+5.3%; that spread is this harness's noise floor at these scales, and every run
of it stayed inside a few percent.

Raw samples: `../prototype/results/fcp-{1000,10000,30000}-c0.{md,json}`.

## Semantic control — the cells paint the same screen

A first-screen time is only a comparison if the cells painted the same first
screen, and `emit.mjs` refusing by name every prop the applier does not write is
an argument rather than evidence. `tree-check.mjs` supplies the evidence: it
reads back element tag, `class` and text over the settled composed tree, shadow
roots pierced.

| rows | nodes compared | `octane-direct` vs `octane-mts-block` | `octane` vs `octane-mts-block` |
|---:|---:|---|---|
| 1 000 | 19 102 | identical | identical |
| 10 000 | 190 102 | identical | identical |

Stylesheet text is compared separately, because it is provenance rather than
tree: both program cells ship `app/src/app.css` as authored (10 770 bytes,
byte-identical to each other) while `octane` ships the bundler's compiled
`styleInfo` (12 722 bytes). Same page, different bytes.

`prototype/smoke.mjs` additionally drives the cell through every benchmark
operation — create, update10th, select, remove, swap, updateStorm, selectStorm,
clear — and all eight pass, so the program is not merely paintable but drivable.

## The adoption handoff, counted

`run-fcp.mjs` reports `octane-ref` selector attributes per cell. They are the
adoption handoff's per-node selector writes:

| rows | `octane` | `octane-direct` | `octane-mts-block` |
|---:|---:|---:|---:|
| 1 000 | 4 028 | 0 | 0 |
| 10 000 | 40 028 | 0 | 0 |
| 30 000 | 120 028 | 0 | 0 |

This is #163's "adoption inverts" claim as a count rather than a prediction: the
program's keyed slot map is the contract, so there is no capture walk to feed
and nothing to select back.

## What this does and does not establish

Established: emitting the first screen as straight-line main-thread code from
the program the framework already derives costs what a hand-written main-thread
program costs. The provenance of the create functions is the only variable
between the two program cells — same background program, same mount ladder, same
slot-delta applier, same event tokens, same counters, same engine entry points,
same `pageConfig`, same CSS — so this prices the *lowering*, which is what C1
would automate.

Not established, and not claimed:

- **This is a web-harness number, and the web harness is not the motivation.**
  #157 is: of the 11.5 s native create-1k, 10.52 s (91%) is host-driver
  interpreter dispatch and bookkeeping on LepusNG. That bucket is what compiling
  the program into the main-thread script deletes. The ratios above say the
  compiled shape carries no penalty of its own; they do not size the native win.
- **This is not a claim of ReactLynx parity.** Deleting the interpreter does not
  get there by itself: the surviving ~574 ms of PAPI crossings is dominated by a
  single 431 ms `__FlushElementTree`, larger than ReactLynx's entire 194 ms
  pipeline. After C-work the native frontier moves to #162.
- **The background half is a state-owner stub**, as `prototype/README.md` says of
  its own: no hooks, no component bodies, no keyed diff. Whole-operation wall
  clocks understate a full core. The load-bearing comparison here is the
  main-thread first screen, which is the half the stub does not touch.
- **Two overheads are the spike's, not the architecture's**, and were left in
  rather than absorbed: the derived program declares three value slots per row
  where the hand-written cell noticed the id text is write-once and kept two,
  and a row's values arrive through a one-call `createRowFor` adapter. Dropping
  write-once slots is a real C1 optimization this deliberately does not take.

## Reproduce

```bash
cd benchmarks/lynx-table
node scripts/build-app.mjs                             # app/dist, for pageConfig
BENCH_AUTOROWS=<N> node scripts/build-app.mjs          # the octane cell
node prototype/build.mjs --rows 1000,10000,30000       # the octane-direct cell
node mts-block/derive.mjs                              # programs.json
node mts-block/build.mjs --rows 1000,10000,30000       # the octane-mts-block cell
node prototype/smoke.mjs --rows 1000 --bundle ../mts-block/dist/main.web.bundle
node mts-block/tree-check.mjs --rows 1000
node prototype/run-fcp.mjs --rows <N> --reps 5 --out-suffix=-c0 \
  --extra octane-mts-block=$PWD/mts-block/dist-rows<N>/main.web.bundle
```
