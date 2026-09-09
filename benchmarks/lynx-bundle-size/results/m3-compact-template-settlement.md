# M3 compact template settlement

- Issue: #290
- Merged base: `new-lynx@cbe716f4a174f08b3c19d635bc4cf3c964c33e2b`
- Exact-clean implementation and measurement head:
  `1a9648aca924a96ba0c98f62e94e31684c4c9429`

## Result

The profiling delta producer no longer assigns a compact template number from
module-evaluation or object-discovery order. It accepts only a build-addressed
`mount-program-run`, keys the address by `(module, index)`, and emits one v2
`DEFINE` frame before the first `RUN` that uses the new page-local number.
Later frames carry the number only. Inline descriptor runs decline instead of
silently entering an identity scheme the isolated main-thread graph cannot
reconstruct.

The streaming main-thread router validates the definition, resolves the
address through the resident-program registry boundary, and publishes the
number and plan in the same store transaction as the first run. Template IDs
must be contiguous. Reusing an ID for the same resident plan is idempotent;
aliasing it to another plan or skipping an ID rejects. A malformed frame drops
the newly defined suffix together with its hosts, instance handles, listeners,
and value writes, so an exact retry can repeat the same definitions and
handles.

This is still compact-receiver infrastructure. The shipping controller does
not route product frames through this store, so this evidence makes no
latency, memory, first-paint, or default-path claim.

## Production diagnostic repayment

The first implementation measured 81,757 gzip at exact-clean head
`c73f95ee601540c3e86d07e9ec46d122ae324467`, 272.5 bytes above the frozen
gate. Its raw receipt SHA-256 is
`4562c76618268904add0b29c347cc672bbf626776f3ea7acc93142920a9ffcda`.
That result is a failed control, not progress.

The final implementation retains the same validation branches, error classes,
aggregate causes, and detailed development messages. Production folds the
store's aggregate host-fault descriptions and the frame validators' label
arguments under the existing `OL484` and `OL485` identifiers. Inspecting the
actual decoded LepusNG constant pool identified those label arguments as the
remaining ownership; gating them there recovered 401 gzip bytes from the
failed first implementation. Small structural simplifications reuse the
store's root lookup and avoid a repeated range lookup without weakening a
host-fault boundary.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-compact-template-settlement-1a9648aca.json
```

Raw receipt SHA-256:
`23d391287ffb5246ce53bd20b522bad77dfb3f66ea78ac33b0befac6d9890e6a`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, a clean implementation tree, an empty receiver-isolation
failure list, and all production core/backend controls passing. This product
linkage harness cannot execute its ablated receiver, so `checksumRan` is false
and the bytes are not semantic or runtime evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,883 | 159,979 | 134,076 | 105,699 | 53,952 |
| receiver-free | 221,876 | 70,050 | 60,031 | 15,418 | 53,952 |
| reusable non-host foundation | 236,670 | 76,875 | 65,840 | 22,481 | 53,952 |
| template-settled foundation + store + router | 245,601 | **81,356** | 69,790 | 26,939 | 53,952 |

The complete template-settled frontier is **1.498x** the frozen 54,323-byte
comparator median and **128.5 bytes below** the 81,484.5-byte M3 gate. It is
127 gzip bytes smaller than the preceding 81,483-byte range-ready frontier
while adding template settlement. Every arm keeps BTS byte-identical within
this measurement window at SHA-256
`5962e4aa7e07d5d9380fc5929e5db074124e8503db4fa3f0969816e01124e6c1`.

The current product's decoded MTS remains byte-identical to the preceding
slice at SHA-256
`2be4534b071ac0ef5414fbef36aca7ce551040011d54a85778f79c414412f867`;
the complete artifact and frontier identities are respectively
`5f56d713c51380c140c1639e10c4c7a1b19c65be0100ddff908956e861c7e9a3`
and
`4745dd61cf77bf9c93ff47b26bc0889ea48c384d120152e6b8b465e2c5b1ced2`.

## Verification

- focused protocol, producer shadow, store, and streaming-frame suites: 75/75;
- full Lynx project: 52 files, 929/929 tests;
- Lynx source, testing, and typetest TypeScript configurations;
- package diagnostic identifiers remain complete and unique through `OL489`;
- two isolated addresses receive distinct IDs and one definition each;
- abort before commit re-announces the same definition on retry;
- a definition plus later malformed opcode rolls back template, host, handle,
  listener, and order state before accepting the exact frame; and
- duplicate same-plan settlement is idempotent while aliasing and sparse IDs
  fail closed.

First-screen resident seeding, nested range application, transport/ACK and
controller lifecycle integration, fallback/cleanup, external-consumer proof,
and the default-build Native performance acceptance remain open.
