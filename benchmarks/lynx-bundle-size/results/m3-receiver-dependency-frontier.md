# M3 general-receiver dependency frontier

Date: 2026-09-09

Issue: #290

Exact-clean implementation: `636c81f3714e1821c4175891bbb0ddc1971233d8`

Checked receipt: [`m3-receiver-dependency-frontier.json`](m3-receiver-dependency-frontier.json)

Checked receipt SHA-256: `9c6e22f93e900059aef65d1f0556f7a2994d4c9732e89329297800d8cd81eeba`

## Question

#323 established that deleting `installLynxMainThreadWithValidator` and its
closure leaves a 70,448-byte complete gzip artifact. The relative gate is
81,484.5 bytes, so a specialized receiver and every newly reachable dependency
have 11,036.5 bytes of total headroom. This run asks which existing MTS
boundaries fit inside that budget before a replacement is designed.

Each arm replaces only the exported general receiver body, then retains one
named dependency boundary through a live call. The real production Rspack build
and LepusNG encoder decide the transitive closure and compression. The two union
arms measure shared code once; individual deltas must not be added.

## Exact production result

| arm | complete gzip | over receiver-free | headroom to gate | decoded MTS gzip |
| --- | ---: | ---: | ---: | ---: |
| current product | 160,511 | +90,063 | -79,026.5 | 106,320 |
| receiver-free | 70,448 | 0 | +11,036.5 | 15,927 |
| PAPI + page | 72,013 | +1,565 | +9,471.5 | 17,488 |
| optional worklet seam | 71,007 | +559 | +10,477.5 | 16,514 |
| paired string transport | 71,786 | +1,338 | +9,698.5 | 17,254 |
| compiled first-screen evaluator | 74,262 | +3,814 | +7,222.5 | 19,871 |
| general host container | 74,585 | +4,137 | +6,899.5 | 20,119 |
| general direct first-screen applier | 95,248 | +24,800 | **-13,763.5** | 40,875 |
| non-host foundation union | 77,483 | +7,035 | +4,001.5 | 23,202 |
| foundation + general host container | 80,045 | +9,597 | +1,439.5 | 25,758 |

Every arm's decoded BTS is byte-identical at 187,742 raw / 53,880 gzip /
46,365 Brotli with SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`.
Every arm emitted one MTS program and zero BTS programs, and every four-cell
core/backend isolation control passed.

The baseline and receiver-free raw/gzip/Brotli sizes and artifact identities
reproduce #323 byte for byte. The receipt additionally records all complete,
BTS, and MTS raw/gzip/Brotli sizes and SHA-256 identities, the exact retained
exports, target headroom, and an empty `receiverIsolationFailures` control.

## Decision

The existing direct first-screen applier cannot be part of the specialized
product receiver: by itself it exceeds the complete product gate by 13,763.5
bytes before routing, acknowledgement, events, lifecycle, adoption, updates, or
a controller exist. That closure has to be replaced by a compact compiled
program/slot applier rather than moved or wrapped.

Reusing the general host container is also not a viable completed design. It
technically keeps this deliberately nonfunctional union 1,439.5 bytes below the
gate, but that remainder would have to contain every missing receiver behavior
listed above. The next implementation must own compact instance/node state
alongside its applier instead of inheriting the general command-host state.

The existing non-host boundaries remain candidates for reuse: normalized PAPI,
the current compiled first-screen evaluator, paired string transport, and the
optional worklet seam together leave 4,001.5 bytes. This is a budget, not a
forecast. A shipping candidate still has to prove the full #290 semantic matrix
and may force one of those boundaries to be specialized too.

## Scope and non-claims

These are intentionally nonfunctional linkage probes. Product mode cannot run
their receiver, so `checksumRan` is false. No correctness, startup, FCP, tap,
update, memory, cleanup, or device-performance claim is made. The result only
answers production reachability and compressed cost; it does not permit a
fallback chunk containing the old receiver because the complete artifact gate
would still count it.

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-papi,receiver-container,receiver-direct,receiver-render,receiver-transport,receiver-worklets,receiver-foundation-lite,receiver-foundation \
  --output /absolute/path/to/m3-receiver-dependency-frontier.json
```
