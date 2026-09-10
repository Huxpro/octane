# M3 compact program ownership controller

- Issue: #290
- Merged base: `new-lynx@1d7a49195326922d208e28fb69334fe3bcf890e8`
- Exact-clean implementation and measurement head:
  `0b04d054e84f54cc4479f29dc560ce8dd3796a1f`

## Result

The compact compiled-program path now has an executable page-local ownership
controller rather than a bare frame/store linkage estimate. It preserves one
store across accepted versions, publishes `ack` followed by `complete` only
after the whole frame commits, rolls malformed or synchronously aborted frames
back for an exact-identity retry, and withholds disposal acknowledgement until
native cleanup succeeds. A response failure after acceptance faults the
controller without rolling already-accepted native state back.
If rollback itself cannot restore the native tree, the controller emits a
fault and retains the ownership journal for retryable terminal cleanup rather
than issuing a reject that would invite an unsafe ordinary retry.

With the complete generated producer and the general first-screen evaluator
absent, the controller frontier is **81,101 bytes gzip**, or **1.493x** the
frozen 54,323-byte comparator median. It is **383.5 bytes below** the 81,484.5
M3 gate. The executable settlement controller adds 3,435 raw / 1,602 gzip /
1,478 Brotli bytes over the bare frame/store frontier in the same build window.

## Exact production frontier

| Arm | Complete raw | Complete gzip | Complete Brotli | MTS gzip | BTS gzip | Headroom to gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| current product | 417,301 | 160,179 | 134,212 | 105,730 | 54,128 | -78,694.5 |
| complete producer + bare frame/store, no evaluator | 242,968 | 79,499 | 67,934 | 24,798 | 54,128 | +1,985.5 |
| complete producer + ownership controller, no evaluator | 246,403 | **81,101** | 69,412 | 26,401 | 54,128 | **+383.5** |

The decoded BTS is byte-identical across all three arms at 188,359 raw /
54,128 gzip / 46,617 Brotli with SHA-256
`28efbe0a9af3b725db5bde4281f7736f9b4a31c973cf87506343c8fc6de21415`.
All four production core/backend controls pass in every arm, and the receiver
isolation failure list is empty.

## Ownership and settlement observations

The regression executes the real emitted slot-setter program against Element
PAPI rather than a DOM or a descriptor mock. It independently observes:

- one store surviving an accepted RUN and later SET, with native output and
  `ack`/`complete` order checked;
- whole-frame rollback on a malformed trailing opcode and success when the same
  identity is retried;
- a ContextProxy-style abort re-entering during synchronous native insertion,
  caught by the new pre-commit boundary before any frame state is published;
- retryable native disposal, idempotent disposal acknowledgement, and refusal
  to remount a disposed root; and
- rollback-cleanup failure becoming a fault whose surviving native ownership is
  removed by terminal-dispose retries; and
- retained accepted native state when acknowledgement delivery itself throws.

The controller intentionally sits below outer ContextProxy decoding and schema
validation. It does not create the general host container, so compact program
nodes have one native owner rather than overlapping general and compact
journals.

## Evidence and non-claims

Reproduction:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline,receiver-foundation-frame-no-render-producer-complete,receiver-foundation-controller-producer-complete \
  --output /absolute/path/to/m3-compact-controller.json
```

Exact-clean raw receipt SHA-256:
`5b52a9053bd7f718a02680e24f2d03c3a16dd9cce6c7d668fb8d26c7f3f1c96a`.
The receipt records `dirty: false`, Node v22.22.2, tool SHA-256
`99a0f81a52f9688ddf6cd80c541a7851e8be6a14006f47cb4697979fc15c1c31`,
all production controls passing, and an empty receiver-isolation failure list.

The product arm still replaces the general receiver with nonfunctional linkage
and therefore records `checksumRan:false`. This proves production reachability
cost for the executable controller and separately proves its state machine in
host-oracle tests; it does not prove a shipping default, outer framing,
first-screen replacement, FCP, update, memory, Web, or Native performance.
