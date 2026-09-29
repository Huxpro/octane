# Issue #291 — Element Template native lifecycle

Commit `0b5d86842d6df1c2a214f19460b52e9f28016dfb` fixes a deterministic
Android process abort in the Lynx 4.1 Element Template owner.

## Failure boundary

The exact-head ordinary owner completed all 79 actions in the 20-cycle
create/clear/recreate protocol. The pre-fix Element Template owner failed twice
at action 35, the eighteenth 1,000-row create. Android ART reported a full
51,200-entry JNI weak-global table containing 51,149 unique
`com.lynx.tasm.behavior.shadow.text.TextShadowNode` entries, then raised
`SIGABRT`. The count explains the boundary: the 17 completed creates each added
3,000 text shadow nodes and remove did not release them.

Octane's previous logical census returned handles, ranges, listeners, and
active host references to baseline after every clear. That evidence was true
but incomplete: it could not see detached native Template nodes retained by
the SDK.

## Fix

The Element Template store now keeps committed removals in a pool keyed by the
exact compiled plan. A later logical mount reuses one detached native handle
and rewrites every value, event-token, and visibility slot before insertion.
New Octane handle and listener identities therefore do not inherit stale native
state. Transaction rollback restores removed instances or returns newly
detached instances to the same pool.

The native budget no longer treats a successful detach as destruction. The
build-only lifecycle census exposes both active and recycled handles and host
references, and the protocol requires a fixed plateau:

- initial: 1 active handle, 28 active host references, empty pool;
- populated: 1,001 active handles, 4,028 active host references, empty pool;
- cleared: 1 active handle, 28 active host references, 1,000 recycled handles
  representing 4,000 host references;
- every create consumes the pool and every clear restores exactly the same
  pool, so active plus recycled host references remain 4,028 after first use.

The runner also stops correctness/memory cells immediately after a fatal marker
is captured. It still rejects the sample; the change only avoids waiting for a
deadline after the process has already died.

## Native acceptance

Two successive fixed builds completed 79/79 actions on the same leased Android
device with DevTool disabled. The final build exposed the pool fields and
passed the strengthened census. Its SHA-256 was reproduced byte-for-byte after
the fix was committed, binding the device observation to `0b5d86842` even
though the runner itself started from the preceding checkout.

The sanitized machine-readable record is
[`evidence/android-element-template-recycling-20cycles.json`](evidence/android-element-template-recycling-20cycles.json).
The raw report is deliberately not checked in because it contains the Sandbox
serial, local paths, URLs, and per-action timestamps.

This is a lifecycle correctness and bounded-allocation result, not a process
memory, latency, or instantaneous-peak result. The formal M0 paired
peak/settled/after-clear campaign remains open.

## Verification

- Element Template tests: 26/26 passed.
- Native protocol/instrument tests: 9/9 passed.
- Scoped Lynx typecheck passed.
- HMR failures seen under the full high-concurrency run passed 70/70 in
  isolation.
- TanStack generator/Rsbuild failures caused by a cross-filesystem temporary
  rename passed 3/3 with a same-filesystem `TMPDIR`.
- `pnpm sync`, scoped Prettier, and `git diff --check` passed.
- The full root run did not finish green: after the environmental HMR timeouts
  and TanStack `EXDEV` failures, its Vitest coordinator exhausted a roughly
  4 GiB heap and aborted. The focused and isolated reruns above are the usable
  results from that attempt.

