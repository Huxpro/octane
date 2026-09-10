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
profiling, so this is not a default-path CPU or end-to-end performance claim;
the production graph does retain part of the closure, and its byte tax is
accounted below.

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
first constructs the producer.

The exact product-linkage receipt at documentation head
`58cd28e876857553173c1f54d92b9528ff2f5904` is
`/data00/home/xuan.huang/.codex/tmp/m3-delta-shadow-linkage-58cd28e87.json`,
SHA-256
`1379720dfcbfec3705d8e4ec92e01f37a34ebcaadf1895ef70ef0d4c893a7fac`.
Against #340's exact base receipt, the ordinary block+program artifact grows
165 gzip bytes and decoded BTS grows 154 gzip bytes; decoded MTS stays
byte-identical. With the complete generated SET/structural-RUN producer, the
compact frame frontier is 82,779 gzip. Removing the general evaluator reaches
**79,491 gzip = 1.463x**, leaving **1,993.5 bytes** beneath the frozen
81,484.5-byte gate after paying this producer tax. Every arm keeps BTS
byte-identical within the new window at 54,128 gzip.

That product harness reports `checksumRan:false`: it proves linkage and budget
ownership only, not executable receiver semantics or runtime speed.

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
