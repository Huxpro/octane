# M3 resident program-run driver

This slice compares the exact `new-lynx` parent at
`72eceb9e90303b0b6ee73492e548e5e042061523` with the resident-driver candidate.
Both arms are production, profile-disabled `BENCH_MTS_PROGRAM=1` bundles. The
candidate changes the main-thread application of an eligible addressed append
run; the background workload and wire command stay unchanged.

## Native Android

The Native window used the shared `create@1000` workload and the
`native-input-handler-to-second-native-frame` boundary, with five samples per
arm in alternating AB/BA order. Explorer was recycled every five pages and all
ten pages passed the thermal gate, loaded their pinned bytes, reached the
transport ACK, and observed two native animation frames.

| arm | raw milliseconds | median |
| --- | --- | ---: |
| exact parent | 1240, 1201, 1276, 1186, 1185 | 1201 ms |
| resident driver | 1074, 1189, 1163, 1193, 1095 | 1163 ms |

The candidate is **0.968x** the exact parent (-3.2%). The record pins Lynx
Explorer 4.1.0 (`6ae29787...`), bundle bytes and SHA-256, the lease receipt,
device cohort `5457eed1ab5de2ff`, per-page thermal readings, served-input
receipts, and the complete raw samples in
`m3-resident-driver-native-ab.json`.

## Lynx for Web

The informational JIT window used the same production bundles, n=5 per cell,
and one interleaved host window. Candidate / exact-parent create medians were:

| rows | exact parent | resident driver | ratio |
| ---: | ---: | ---: | ---: |
| 1,000 | 128.7 ms | 121.0 ms | 0.940x |
| 3,000 | 318.4 ms | 306.3 ms | 0.962x |
| 5,000 | 529.5 ms | 496.9 ms | 0.938x |
| 10,000 | 970.1 ms | 944.8 ms | 0.974x |

`m3-resident-driver-web-ab.json` retains every raw operation sample, host load,
bundle identity, and semantic/DNF output. Web is supporting evidence only; the
Native window above decides the LepusNG claim.

## Cost and mechanism gates

The candidate Native bundle is 581,279 raw / 206,018 gzip bytes versus 579,658
raw / 205,182 gzip for the exact parent: +1,621 raw / +836 gzip. The gain is not
reported as free size.

The current-source four-arm core-switch receipt is retained in
`m3-resident-driver-core-switch.json`. Its controls pass, but the smallest
production program arm still decodes to 57,568 background-gzip + 119,104
main-gzip = **176,672 bytes**, versus the #290 50%-of-upstream gate of
81,484.5 bytes. This slice therefore advances Native create CPU only; it does
not satisfy or close the bundle-size architecture gate.

The executable-path integration test registers the real emitted row program,
requires exactly one bind and one `run` call for three addressed rows, and
compares the complete tree, handles, and event identity with the descriptor
arm. A mutate-then-throw event fault proves that a driver failure retains the
created prefix and that terminal disposal removes both the installed listener
and the page root without cleanup errors.
Profile builds also count driver calls, rows, and eligible descriptor
fallbacks; these counters fold out when `__OCTANE_LYNX_PROFILE__` is false.
