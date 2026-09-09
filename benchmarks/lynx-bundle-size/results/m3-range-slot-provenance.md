# M3 compiler range-slot provenance

- Issue: #290
- Merged base: `new-lynx@e6cc3ea6d9a93c375a04e509d06aa8d35d8f3f88`
- Exact-clean implementation and measurement head:
  `eb6484da54645f97b806c8349e11b2487a140b68`

## Result

The background producer now retains the real compiler slot that owns every
eligible program root. Adjacent runs and first-screen manifests combine only
when their parent, program, anchor, and range slot all agree. Producer-local
`WeakMap` metadata follows a manifest when it is promoted to an addressed run,
and the profiling delta encoder declines a nested command with no such proof
instead of substituting the parent host's physical node index.

The delta shadow now keeps order independently per `(parent host, range slot)`.
Nested append, anchored insertion, and move use the compiler slot on the wire;
an anchor from a sibling range is rejected without publishing speculative
state. Abort/retry keeps the last accepted slot ownership. The command wire has
no new field, and ordinary logical records gain no property: only eligible
hosts and the short-lived commands that name them enter sparse `WeakMap`s.

This is producer/profiling infrastructure, not a product receiver cutover. It
does not seed the compact store from the first screen or change the default
transport/controller path, so no latency or memory benefit is claimed.

## Exact production frontier

Command:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver,receiver-foundation-lite,receiver-foundation-frame \
  --output /data00/home/xuan.huang/.codex/tmp/m3-range-slot-eb6484da5.json
```

Raw receipt SHA-256:
`f54250af98cfdfd3e046fc8b279c00b10622deb909ebb50bf51568cfd4f25886`.
It records tool SHA-256
`fc2e796b0b178b4a2899648d5071fdab1c270c7e9d9cc0fe62f68eb610e160b2`,
Node `v22.22.2`, a clean source tree, an empty receiver-isolation failure list,
and all production core/backend controls passing. The product linkage harness
cannot execute its ablated receiver, so `checksumRan` is false and the bytes are
not semantic or runtime evidence.

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| current product | 415,867 | 159,937 | 134,234 | 105,699 | 53,917 |
| receiver-free | 221,860 | 70,011 | 59,962 | 15,418 | 53,917 |
| reusable non-host foundation | 236,654 | 76,832 | 65,841 | 22,481 | 53,917 |
| range-ready foundation + store + router | 246,078 | **81,447** | 69,871 | 27,085 | 53,917 |

The complete range-ready frontier is **1.499x** the frozen 54,323-byte
comparator median and **37.5 bytes below** the 81,484.5-byte M3 gate. MTS remains
byte-identical to the preceding structure slice at SHA-256
`4126e60ba666f4e455d22bbfdf863970606e848374c3ac5358f3cc8da34ef6df`.
The exact product, BTS, and frontier artifact identities are respectively
`f0211477fc7a765fc02ce1fd314e4188c82d59064389f56c5e2f043615186df4`,
`f93bd6e249a476452d97c040d61134167f2c54c4bf9db668ce3f524ba093f8e5`,
and `c3a2d09af4fbe99b247ec934f7dc379c2224696771c027a287777cdb0b68b49e`.

## Verification

- focused universal producer plus Lynx delta suites: 3 projects, 29/29 tests;
- source typecheck covers the five changed implementation/test files;
- two different holes on one physical parent stay as two runs with slots 3 and
  7, while rows from one hole still combine;
- later keyed moves retain slot ownership across abort and retry;
- nested RUN/MOVE use slot 7 even though the physical parent is node 0;
- same-slot anchored insertion succeeds, while an anchor from slot 9 rejects;
- a nested first-screen manifest is automatically tagged with slot 5, and
  promotion retains the same producer-local slot;
- the two affected universal tests pass in both Octane dev/prod projects
  (4 files, 238/238 tests), and the isolated HMR rerun passes in both projects
  (2 files, 70/70 tests) after the all-core run hit only that test's 5-second
  timeout in each mode (898/900 files and 15,395/15,397 non-skipped tests
  passed in the original full invocation).

First-screen compact-store adoption, resident range validation, transport/ACK
settlement, controller lifecycle, cleanup, external-consumer fallback, and
default-build Native performance acceptance remain open.
