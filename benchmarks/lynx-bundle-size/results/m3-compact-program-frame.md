# M3 compact compiled-program frame router

- Issue: #290
- Merged base: `new-lynx@42602341852dcee58950abcdb4997917e99b5a4a`
- Exact-clean implementation and measurement head:
  `10d0ddcffda80751fa249408fcdb36d9376bc753`

## Result

The streaming v2 RUN/SET/REMOVE router plus the complete reusable non-host
foundation produces an **81,467-byte gzip** artifact, or **1.500x** the frozen
54,323-byte comparator median. It remains **17.5 bytes** below the 81,484.5-byte
M3 relative-size gate.

That margin is evidence about this narrow primitive, not M3 completion. The
shipping product does not import the router and remains 160,511 gzip bytes.
Range sites, events, MOVE/CLEAR/VIS, first-screen adoption, transport dispatch,
ACK/reject settlement, controller lifecycle, and cleanup still have to fit.
Seventeen and a half bytes cannot contain that work, so a completed replacement
must additionally specialize or delete parts of the current non-host
foundation. No fallback to the old receiver is counted as a solution.

## Owned semantics

The router consumes the existing version-2 slot-delta envelope directly:

- it walks the flat frame once without allocating decoded operation objects;
- RUN resolves one resident compiler plan, validates the exact dense value
  arity, and invokes the emitted `.run(count)` driver once;
- the store slices and retains the RUN value segment once, avoiding the former
  decoder's per-operation object and value-slice allocation;
- SET addresses one compiler value slot, while REMOVE consumes a dense instance
  run;
- a root-level instance address may anchor RUN before an existing root;
- an unknown template, malformed later frame, invalid root sentinel, wrong
  arity, range/event-bearing plan, or unsupported CLEAR/MOVE/VIS opcode rejects
  with no fallback;
- one store transaction covers the entire envelope, so a later malformed frame
  reverses earlier accepted host mutations before the caller may retry.

The router intentionally accepts only the root range site `{ instance: 1,
slot: 0 }` and range- and event-free compiled plans. The existing delta protocol
remains the format authority; this slice adds a narrow execution path rather
than a second wire vocabulary.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-papi,receiver-store,receiver-frame,receiver-foundation-lite,receiver-foundation-store,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-frame-frontier-10d0ddcff.json
```

Raw receipt SHA-256:
`0d38778b59298325258df8947f60aa1e2f4f4e087ce328bc0f4a426e4dd93169`.
The receipt records `dirty: false`, tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, an empty receiver-isolation failure list, and all four
production core/backend controls passing for every arm. Product linkage probes
cannot execute their ablated receiver, so `checksumRan` is false and no runtime
semantic or latency claim is derived from them.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 418,005 | 160,511 | 134,730 | 106,320 | 53,880 |
| receiver-free | 223,390 | 70,448 | 60,438 | 15,927 | 53,880 |
| PAPI/page | 226,919 | 72,013 | 61,714 | 17,488 | 53,880 |
| PAPI/page + compact store | 233,342 | 75,177 | 64,514 | 20,739 | 53,880 |
| PAPI/page + store + frame router | 235,207 | 76,030 | 65,193 | 21,586 | 53,880 |
| non-host foundation | 238,884 | 77,483 | 66,399 | 23,202 | 53,880 |
| non-host foundation + compact store | 245,386 | 80,623 | 69,229 | 26,342 | 53,880 |
| non-host foundation + store + frame router | 247,273 | **81,467** | 69,812 | 27,186 | 53,880 |

The isolated router costs 853 gzip bytes over the PAPI/page + store arm. Shared
compression makes its foundation-union increment 844 bytes. Every BTS program
is byte-identical at 187,742 raw / 53,880 gzip and SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`,
so the apparent MTS reduction did not move receiver cost to the background.

The current product reproduces the #326 identities exactly:

- complete:
  `536f12776f15acee80e191e9075f64af830cedf606beebbf04c7d41fed5e640e`;
- BTS: `0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`;
- MTS: `4735539a230bdf15a1bfd980499086751a998ab70fa46fe1e3d6253a57427684`.

## Verification

- router/store/package-boundary focused suite: 25/25;
- full Lynx project: 52 files, 907/907 tests;
- all three `@octanejs/lynx` TypeScript configurations pass;
- package diagnostic identifiers remain complete and unique through `OL485`;
- production frontier: eight arms, with all four core/backend controls passing
  per arm;
- scoped formatting, `pnpm sync`, and diff checks pass.

No Native/Web startup, FCP, steady-state latency, memory, cleanup-cycle, or
consumer-coverage benefit is claimed. Those require a shipping consumer and
remain M3 work.
