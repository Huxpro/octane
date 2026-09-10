# M3 compact-frame producer copy-on-write drafts

- Issue: #290
- Exact merged base: `new-lynx@e012a2e3b218bb70a508eb09cddef0fd84ab3f17`
- Exact-clean implementation/measurement head:
  `c7d7c27ac45d84163438907c7d8dee6dbfef89b1`

## Result

The command-batch to compact-frame bridge no longer clones every resident
template, instance, host, range order, and value table before preparing a
change. Each preparation records map writes/deletions in a copy-on-write view,
copies only a changed instance's value array and a changed range's order array,
and applies that overlay only at the accepted-ACK boundary.

An unsupported command discards the draft without touching accepted state.
Multiple writes to the same instance or range in one batch reuse the first
detached value/order copy, so the optimization does not turn a many-command
batch into repeated copies of a growing range.

This removes a measured producer-side cost transfer before the frame transport
is enabled. The current product still constructs this bridge only under
profiling, so this is not a shipping/default-path or end-to-end performance
claim.

## Same-window scaling control

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/delta-shadow.mjs \
  --baseline /data00/home/xuan.huang/.codex/worktrees/68ea/octane-frame-base \
  --candidate /data00/home/xuan.huang/.codex/worktrees/68ea/octane \
  --output /data00/home/xuan.huang/.codex/tmp/m3-delta-shadow-cow-c7d7c27ac.json
```

Raw receipt SHA-256:
`e7d0bc5d030b9e5b1de228ceed6ef48511e329ef26508c8e2abab3536bf1b1e7`.
It records clean worktrees, exact heads, Node `v22.22.2`, bundle identities, and
all 900 raw samples. Three fresh-process AB/BA windows per arm used 50 accepted
single-slot SET preparations after committing 1k, 10k, or 50k two-host
instances.

| Resident rows | Base window medians (ms) | Candidate window medians (ms) |
| ---: | --- | --- |
| 1,000 | 0.2554 / 0.2660 / 0.2615 | 0.0075 / 0.0069 / 0.0073 |
| 10,000 | 4.2561 / 4.1175 / 4.0177 | 0.0069 / 0.0072 / 0.0068 |
| 50,000 | 31.8876 / 31.4428 / 29.6969 | 0.0069 / 0.0070 / 0.0069 |

The base scales with resident page size while the candidate stays within
0.0068–0.0075 ms across this range. The candidate is close to the timer and
fresh-process noise floor, so no precise speedup ratio is claimed; the evidence
supports the complexity change, not a user-visible latency conclusion.

The isolated bundled producer closure grows from 35,980 raw / 8,842 gzip /
7,775 Brotli bytes to 38,073 / 9,285 / 8,187: a measured +2,093 raw / +443 gzip /
+412 Brotli byte tax. This cost must be included when the production transport
first retains the producer; it is not hidden behind the current tree-shaken
profiling-only path.

## Verification

- focused delta protocol/shadow/store/frame suites: 82/82;
- full Lynx project: 52 files / 938 tests;
- Lynx source, testing, and typetest TypeScript configurations;
- partial-write decline leaves the accepted snapshot byte-for-byte equivalent;
- exact retry reuses the same template and instance identities; and
- sync, formatting, and diff checks pass.

Production frame negotiation, receiver/controller ownership, compact ACK
publication, build-time capability fallback, external consumers, and Native
timing/memory acceptance remain open.
