# Issue #284 — resident scalar-layout evidence

## Provenance

- baseline source: `Huxpro/octane:new-lynx@dc42bdd513d58b026c576f76a013231cdbff8e09`
- candidate source: this change, based exactly on that baseline
- default production candidate Lynx bundle: 553,323 bytes,
	`a8361d1ed3f8c5aeeb8a2db2b212a0e3c207f9e6eeda1aa892dc054a39eb1654`
- default production baseline Lynx bundle: 552,689 bytes,
  `29aae0c7f33e2723057d7d16d896a40464be82b4be7b3c7825a32b626d2d4e92`
- default production candidate Web bundle: 570,447 bytes,
  `80d366af53ab1154f236a7e51abd6d7da2af2a81981ca818a57e5049301b78a9`
- default production baseline Web bundle: 569,473 bytes,
  `49ad18826ccbceedfe4d630e14eaa61e91f489c5c36df6eba4fd8397addcab16`

The default candidate is 634 Lynx bytes / 974 Web bytes larger because it also
contains the consumer compatibility fix for addressed runs after first-screen
adoption. This is reported as a cost, not hidden behind gzip or attributed to a
later bundle milestone.

## Uninstrumented production headline

Lynx for Web drove both immutable default-production bundles in one window,
AB/BA by repetition, at 1,000 rows and `n=7` per cell. The host was a 32-core
Intel Xeon Platinum 8336C; load moved from 0.27/0.54/0.71 to 0.44/0.56/0.71.

| create | median | 95% CI | raw samples (ms) |
| --- | ---: | ---: | --- |
| candidate | 126.1 ms | ±1.2 ms | 130.4, 127.5, 126.1, 126.0, 126.5, 126.1, 125.0 |
| baseline | 138.8 ms | ±4.0 ms | 141.0, 153.4, 136.9, 140.3, 138.1, 136.3, 138.8 |

The same-window median ratio is **0.909×**, a **9.1% create reduction** with
zero DNF. The other operations completed as semantic guards, but this change
does not claim their noisy timing differences. Full generated statistics and
raw arrays are in `issue284-web-production-abba-1000.json`.

## Native mechanism and cost attribution

The production graph was rebuilt with the build-only issue-194 attribution
probe, preserving production compilation while wrapping the native input,
Element PAPI, transport acknowledgement, and two-frame completion boundaries.
Both cells ran on the same leased `aries_10` / Android 10 / Lynx SDK 4.0 device,
with DevTool disabled, a cold Explorer launch per sample, battery at or below
35°C and thermal status 0, and AB/BA ordering. All 10 samples were accepted on
their first attempt; there were no invalid attempts or DNF.

| 1k native create median (`n=5`) | candidate | baseline | ratio |
| --- | ---: | ---: | ---: |
| native tap → second native frame | 5,367 ms | 9,001 ms | 0.596× |
| native tap → transport ACK | 5,335 ms | 8,971 ms | 0.595× |
| accepted main-thread commit wall/apply | 5,040 ms | 8,684 ms | 0.580× |
| measured PAPI create self-time | 58 ms | 101 ms | 0.574× |

Every candidate sample carried exactly one `mount-program-run`; every baseline
sample carried exactly one `mount-template-run`. The candidate acknowledged
4,000 hosts, created zero raw-text hosts, and performed 4,000 appends. The
baseline acknowledged 6,000 hosts, created 2,000 raw-text hosts, and performed
6,000 appends. Both created the same 1,000 row views and 3,000 text elements,
reached the same validated 1,000-row application state, and used one command.
The main→background ACK payload was 182 bytes in both cells; no transport-byte
benefit is claimed from that reverse-direction boundary.

The attribution bundles are identified in
`issue284-native-abba-1000.json` as:

- candidate: 571,700 bytes,
  `9b47c368c67939c056622b58bc44b40c28f09c352a09a8d487eb18419885d223`
- baseline: 571,063 bytes,
  `ec83ec4666f2e6535980467b4ad4968fa2eb986033a92576cfd5e9a9a7513372`

These profiled milliseconds explain the mechanism and are not substituted for
the uninstrumented Web headline. The raw native receipt retains all samples,
thermal snapshots, bundle identities, PAPI deltas, command ops, validated
pre/post state, and frame timestamps.

## Coverage and fallback

The real row is eligible only because both dynamic text children are proved
scalar: the compiler proves the unshadowed intrinsic `String(id)`, and the
authored `label as string` carries the existing source-level proof. A shadowed
binding named `String`, an unproved renderable label, or any range-bearing child
continues to omit the resident address and sends `mount-template-run` with its
descriptor. No static program ID is used for variable arity.

Compiler tests assert the real eligible row, the ordinary range-bearing
fallback, and shadowed-`String` safety. The post-first-screen integration test
starts from an actual program-painted/adopted tree, crosses the compact-ACK
threshold with an eight-instance addressed run, then covers update, insertion,
keyed removal/reorder, event dispatch, and unmount cleanup. Existing addressed
program tests retain the independent malformed address/layout/digest rejection
coverage; the compiler still refuses addresses whenever ranges make producer
and resident arity differ.
