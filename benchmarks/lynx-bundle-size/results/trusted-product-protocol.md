# Paired production protocol specialization

Issue #290's product build owns both Lynx protocol peers. This slice uses that
same-build fact to keep recursive validation in development and in every public
receiver while making it unreachable from the generated production main-thread
program. It is a shipping implementation, not an ablation.

## Verdict

The exact product artifact falls from 167,252 to 160,511 gzip bytes:

| measure | merged baseline | candidate | delta |
| --- | ---: | ---: | ---: |
| complete artifact raw | 432,847 | 418,005 | -14,842 |
| complete artifact gzip | 167,252 | **160,511** | **-6,741 (-4.03%)** |
| complete artifact Brotli | 139,232 | 134,730 | -4,502 |
| decoded BTS gzip | 53,873 | 53,880 | +7 |
| decoded MTS gzip | 112,998 | **106,320** | **-6,678** |

The main-thread reduction is not hidden by moving the closure into the
background program: BTS grows by 7 gzip bytes while MTS shrinks by 6,678. The
complete-artifact gzip delta is the authoritative result because compressed
thread deltas are not additive.

Against the current 54,323-byte ReactLynx/Vue comparator median, the ratio
improves from 3.079x to 2.955x. The artifact remains 79,026.5 bytes above the
81,484.5-byte M3 gate, so #290 remains open.

## Shipping boundary

The public `installLynxMainThread()` API still defaults to `checked` and still
accepts the documented checked/trusted selection. `createLynxRoot()` is
unchanged and checked by default. Development, HMR, explicit main-thread-only
builds, and external consumers continue through that public checked entry.

Only the generated `isProd` two-layer application entry selects the paired
receiver. It retains protocol version, renderer, root/version identity,
message discriminant, exact message keys, batch envelope, command-array shape,
call arity, failure settlement, and lifecycle routing. It omits the recursive
command/property/capture walk and the send-side self-check whose other peer was
emitted from the same package graph. The shared receiver implementation is
otherwise byte-for-byte the prior implementation apart from injected inbound
and outbound validation functions and associated types.

Build tests assert that the production MTS graph contains the paired entry and
shared implementation, excludes the public wrapper, and keeps the application
root/universal core out of MTS. Development selects the checked entry. The Lynx
validation policy test also proves that the paired validator accepts a malformed
deep command while still rejecting a malformed protocol envelope.

## Exact protocol and provenance

The exact-clean implementation is
`d6a91d8d4aa4f983892c4a0dc8be61d5d3fc2208`, based on merged
`new-lynx@7c3ae4542e618d7709a97de8f1eebc4ce82cf86a`. The command was:

```bash
TMPDIR=/data00/home/xuan.huang/.codex/tmp \
node benchmarks/lynx-bundle-size/l5-ceiling.mjs \
  --harness product \
  --arms baseline \
  --output /data00/home/xuan.huang/.codex/tmp/m3-trusted-product-protocol-d6a91d8d4.json
```

The checked-in raw receipt is
[`m3-trusted-product-protocol.json`](m3-trusted-product-protocol.json), SHA-256
`e3ea64a42b7cf88d2d9673f24dda469069c2bff9f715fd79cc5561a34469c041`.
It records `dirty: false`, Node 22.22.2, tool and artifact hashes, one compiled
main-thread program, zero background programs, and passing product-core
isolation controls. Its merged baseline is the exact baseline arm in
[`m3-product-l5-ceiling.json`](m3-product-l5-ceiling.json) at implementation
commit `4e0bc07ed17394c38439649f53a9692e734852a9`.

Product-only mode reports `checksumRan: false`; that limitation is preserved in
the receipt. Functional evidence instead comes from all 880 Lynx tests, all 71
Rspeedy-plugin tests, the Lynx package's three typecheck configurations, and
the focused source typecheck. No native startup, first-paint, update, memory,
cleanup, or wall-clock claim is made by this bundle-only slice.

The earlier absolute validator-deletion ceiling was 15,805 gzip bytes. This
shipping result is deliberately smaller because it preserves the routing and
failure semantics above. The remaining M3 work must target another emitted
closure rather than describe this partial result as the final gate.
