# Lynx S3-4 structural retained-heap report

## Provenance and protocol

- Stacked base: S3-2 PR #31 / `f501941d22b6f550cf8709b8235f72339b860db4`.
- Comparison base: PR #22 / bundle
  `1633935a3dd9f6b443be8ce461951f65b28af6b832bda5b5a7963c4dd2e2eaa4`.
- Candidate heap/snapshot bundle:
  `523580543ba19ce7131653b3c478e76d533530b407a7d2b9b543c848118675ca`.
- Raw inputs: `heap-raw.json.gz`, `s3-4-final-heap.json.gz`, and
  `s3-4-snapshot-raw.json.gz`.
- Each scale uses five fresh page/background-worker realms, explicit CDP GC,
  identical 10k table semantics, and post-destroy worker-release observation.
- The census compares the first GC-normalized 10k snapshot from each candidate.
  Snapshots are excluded from Git; their SHA-256 values make the local captures
  independently identifiable.

## Retained slope

| rows | PR #22 median | S3-4 median | reduction |
| ---: | ---: | ---: | ---: |
| 1,000 | 15,642,320 B | **8,353,196 B** | 46.6% |
| 10,000 | 156,943,976 B | **84,115,208 B** | 46.4% |
| 30,000 | 454,085,884 B | **239,676,196 B** | 47.2% |

Ordinary least-squares slope across 1k/10k/30k falls from
`15,075 B/row` to **`7,944 B/row`**, 47.3% lower and comfortably below the
decimal `<=15,000 B/row` stretch gate. Growth remains linear; the 30k point is
2.85x the 10k retained bytes for 3x the rows.

All 15 candidate samples passed row/checksum/selection/identity oracles. Every
sample observed the background worker disappear after view destruction.

## Snapshot census and object-family proof

| capture | snapshot bytes | SHA-256 | nodes | edges | total self size |
| --- | ---: | --- | ---: | ---: | ---: |
| PR #22 @10k | 335,281,372 | `8366665569b01ef52bd4ad9663bf3a11e4c3a2c5121468986930009e4cd32b76` | 3,901,856 | 18,065,459 | 151.12 MiB |
| S3-4 @10k | 194,739,045 | `6c82ee92beac2ef34d3fdf06e1531641101854178c249a220f773c1448b15862` | 2,131,733 | 11,014,684 | 81.69 MiB |

The candidate removes 1,770,123 live heap nodes, 7,050,775 edges, and
69.42 MiB of aggregate self size after GC. The dominant retained families fall
in the same directions as the runtime representation changes:

| family | PR #22 | S3-4 | delta |
| --- | ---: | ---: | ---: |
| arrays | 920,559 / 77.00 MiB | 390,521 / 35.25 MiB | -530,038 / -41.75 MiB |
| objects | 2,291,610 / 59.93 MiB | 1,091,545 / 32.31 MiB | -1,200,065 / -27.62 MiB |
| object-element arrays | 300,191 / 18.42 MiB | 170,185 / 7.83 MiB | -130,006 / -10.59 MiB |
| ordinary arrays | 600,325 / 56.12 MiB | 200,292 / 24.96 MiB | -400,033 / -31.16 MiB |

This is an object-family reduction, not delayed allocation: deterministic 10k
counters simultaneously drop owner drafts `20,001 -> 1`, plan values and
materializations `20,001 -> 10,001`, logical records `90,000 -> 70,000`, and
staged commands `160,000 -> 10,000`. The snapshot was taken while the 10k page
was still live, before clear or destroy.

The analyzer finds exactly one `multiApps` entry, the expected mounted page.
The only `sharedData`/`shareDataSubject` paths point back to that current page;
there is no stale second page. `__OCTANE_PROFILER__` remains an explicit
observer root in both profile captures, so slope conclusions use matched
profile data and S3-2 separately publishes its unprofiled CPU control.

## Non-regression gates

S3-4 is an evidence-only layer over the exact S3-2 runtime commit, so it cannot
move runtime behavior relative to its stacked base. The inherited S3-2 matrix
already establishes:

- BTS create median `451.112 ms` profiled / `432.327 ms` control versus
  `880.891 / 865.4 ms` at #22;
- MTS create `2035.1 ms` versus `2057.6 ms` at #22;
- create wire `10,000` commands / `3,294,620` median bytes;
- clear, update10th, select, and every cold/steady median below #22; and
- exact checksum, survivor identity, event, and storm semantic success.

## Judgment and limits

Judgment: **structural heap stretch achieved; no obvious lifecycle leak**.
This is a same-state high-memory comparison, not an A/B/C leak diagnosis. The
bundled analyzer reports class census and conservative reachability; Chrome
DevTools remains authoritative for exact retained-size dominators. The slope,
live-page capture timing, deterministic representation counters, and large
matching family deltas are sufficient to establish that the reduction is
structural rather than cleanup deferral.
