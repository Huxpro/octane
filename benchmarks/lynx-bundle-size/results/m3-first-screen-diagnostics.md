# M3 first-screen production diagnostics

- Issue: #290
- Merged base: `new-lynx@2b80c4bcc6d0c7a67cf6ed3ad5492f6a25671ca1`
- Exact-clean implementation and measurement head:
  `f0363cc4ad49f5bac224acb1f83d4446f269b29f`

## Result

The first-screen evaluator now keeps its detailed development failures while
folding the same production paths to stable `OL486`–`OL489` identifiers. The
event-capable replacement frontier falls from 81,211 to **80,526 bytes gzip**,
or **1.482x** the frozen 54,323-byte comparator median. It is **958.5 bytes**
below the 81,484.5-byte M3 relative-size gate.

The shipping product also falls from 160,511 to **159,902 bytes gzip**. This is
a deletion from the real production path: decoded BTS remains byte-identical at
53,880 gzip, while decoded MTS falls from 106,320 to 105,699 gzip. Refusal
identity, error subclasses, the refusal `code`, suspended-error `cause`, and all
development messages remain unchanged.

This does not make the compact frame the shipping receiver. Structure/range
coverage, first-screen adoption, transport and acknowledgement settlement,
controller lifecycle, background metadata, cleanup, and consumer-default proof
remain open; no runtime latency or memory claim is derived from this linkage
measurement.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-first-screen-diagnostics-f0363cc4a.json
```

Raw receipt SHA-256:
`5e5bdcb09d9c53f2c7174a05852a451f7cb68e2b3f22ab6d4eb3e78a1bb608b2`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, an empty receiver-isolation failure list, and all production
core/backend controls passing for every arm. Product linkage probes cannot
execute their ablated receiver, so `checksumRan` is false and no runtime
semantic or latency claim is attached to them.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,743 | **159,902** | 134,153 | 105,699 | 53,880 |
| receiver-free | 221,736 | 69,971 | 60,050 | 15,418 | 53,880 |
| reusable non-host foundation | 236,530 | 76,801 | 65,806 | 22,481 | 53,880 |
| event-capable foundation + store + router | 244,173 | **80,526** | 69,027 | 26,209 | 53,880 |

Every BTS program retains SHA-256
`0868633b429f4cef4a692342b1142a2ce58ec8447e95045554def9a54374bc37`.
The shipping product's complete artifact SHA-256 is
`20777b1b608affb2e635d906f8c1c1d870b98aaad9603a210a0f74874ad58e49`;
its decoded MTS SHA-256 is
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`.

## Verification

- a production-bundled consumer observes `Error` / `OL486`, `TypeError` /
  `OL487`, and `LynxFirstScreenRefusalError` / `OL488` with the stable refusal
  code;
- package-boundary coverage proves all 489 production identifiers are complete
  and unique;
- development first-screen suites retain detailed messages and refusal
  diagnostics;
- the suspended-without-pending path retains its `cause` while using `OL489` in
  production;
- production size comes from exact-clean real builds with unchanged BTS, not a
  source-text estimate.

No Native/Web startup, FCP, first-tap, steady-state latency, memory,
cleanup-cycle, controller, or default-consumer benefit is claimed.
