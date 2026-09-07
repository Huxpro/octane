# Lynx issue #277: post-frame first-tree capture

## Verdict

The target-device hypothesis is verified. On a row-bearing 1k production page,
Octane now schedules first-tree capture through the main-thread-script ambient
`requestAnimationFrame`, then posts a zero-delay timer. The device trace proves
that capture begins after both the first matching `DoFrame` and FMP, and the
device timeline ordinal proves that announce follows capture even when the
1 ms epoch clock gives them the same timestamp.

This change relocates capture; it does not claim to eliminate its CPU cost. The
uninstrumented 1k FCP result is neutral within run-to-run noise. At 8k, FCP is
1.7% lower, but the post-frame work remains owed before ready and is the next
adoption target rather than a CPU saving attributed to this patch. Both 10k
cells hit the same Explorer JNI global-reference capacity limit, so that DNF is
reported as a capacity boundary and contributes no performance win.

## Revisions and controls

- baseline: `new-lynx@8c9aeeb038423b326bd55cb961197aaf34f57a85`
- implementation: `b09750edc2b1f86ea726946fe1f07e0fccc24026`
- final evidence head: `96a2ef765260b0f3ee28a546a302fac7383eeac7`
- target: `aries_10`, Android 10, Explorer 1.0, Lynx 3.9
- production app path: compiled MTS program with the #284 resident-scalar row
  layout; every accepted profile sample reports `resident-scalar-text`
- headline bundles: production, uninstrumented, with only the device-required
  table-app `MessageChannel` fallback applied identically to both cells
- sampling: cold Explorer launch per sample, DevTool disabled by a separate
  background-only preflight, thermal status 0 and battery at most 35.0 C
- order: A/B/B/A repeating, five accepted samples per cell; all 1k and 8k
  samples completed on their first attempt

The final harness-only commit does not enter uninstrumented bundles. Rebuilding
the 1k and 8k candidate bundles at the final head reproduced the exact hashes
recorded at the implementation commit.

## Uninstrumented FCP

`loadToFirstScreenMs` is the #280 `loadBundle` lifecycle boundary. Values are
milliseconds.

| scale | cell | exact bundle SHA-256 | raw samples | median | candidate / baseline |
| ---: | --- | --- | --- | ---: | ---: |
| 1k | baseline | `8e4b6170d717acc94c89d1884a725d488f3cde6cd01726fdd9b98ca8fa2fca7a` | 778, 784, 790, 796, 772 | 784 | — |
| 1k | candidate | `5e7e36aa439b11e28157e8e47ba7f887252e4b76e768004cbdff88b94f449ec7` | 780, 806, 768, 792, 804 | 792 | 1.010x (+8 ms) |
| 8k | baseline | `77a1422cdee544a38b0b573060279b6019bcc5d7ecb0d285a911694c03b54cef` | 16,585, 16,186, 16,920, 16,760, 15,498 | 16,585 | — |
| 8k | candidate | `199f3cbf51aabf48533356a94452f1416edd830fccf5f696870706b053932fca` | 16,772, 16,439, 16,086, 16,303, 15,842 | 16,303 | 0.983x (-282 ms) |

The 1k intervals overlap almost completely. The 8k intervals also overlap, so
the median movement is directionally consistent with moving the row-scale walk
after FMP but is not presented as a throughput or CPU reduction.

## Profile AB/BA and ready cost

The final 1k profile window completed 10/10 on the first attempt. Its FCP median
was 995 ms for both cells. Baseline ready was observed 12, 12, 12, 13, and
13 ms after FMP (median 12 ms); candidate ready was observed 48, 50, 51, 49,
and 49 ms after FMP (median 49 ms). The longer paint-to-ready interval is the
visible cost of waiting for the frame and timer rather than hidden work removal.

Every candidate sample recorded the exact ordinal sequence
`schedule=1 -> capture=2 -> announce=3`. Schedule-to-capture was 44, 46, 46,
45, and 44 ms. Bundle identities:

- baseline profile:
  `eda00c9b946d20b674d6bb92f1124f6a7797267e082582719db9c446cadc84c5`
  (573,254 bytes)
- candidate profile:
  `8f7efdfba9d54384bcef6fdc353f5c910f17e80aa2edd841104f9ee6ffe6b834`
  (573,874 bytes)

The 620-byte profile delta belongs only to the build-time evidence timeline;
shipping bundles do not contain it. The production bundle delta is 249 bytes.

## Perfetto ordering proof

The final candidate trace is 4,736,295 bytes with SHA-256
`bd27de15e7181e397ec45a4a9827dc425ff836fb49aee2afed85d62d3198e763`.
Perfetto BOOTTIME was aligned to the build probe's epoch milliseconds through
the trace's `REALTIME` clock snapshot. Because the relevant margins exceed the
probe's 1 ms resolution, the strict cross-clock order is unambiguous.

| phase | realtime ms | duration / gap | evidence |
| --- | ---: | ---: | --- |
| `paintingUiOperationExecuteEnd` [slice id: 234178] | 1788764206659.2275 | — | direct UI publication finished |
| build marker: schedule ordinal 1 | 1788764206706 | +46.7725 ms | product requested the default rung |
| `AnimationFrameTaskHandler::RequestAnimationFrame` [slice id: 246375] | 1788764206706.7607 | 0.0017 ms | same request in the native trace |
| `AnimationFrameTaskHandler::DoFrame` [slice id: 246447] | 1788764206716.5850 | 0.1035 ms | first frame after the request; ends at 1788764206716.6887 |
| adjacent `AnimationFrameTaskHandler::DoFrame` [slice id: 246454] | 1788764206716.6895 | 0.1265 ms | also ends 78.184 ms before capture |
| **[GAP: paint plus posted timer]** | — | **78.3113 ms from first DoFrame end to capture** | includes `FirstMeaningfulPaint` [slice id: 252581] at 1788764206776.7120 |
| build marker: capture ordinal 2 | 1788764206795 | +18.2880 ms after FMP | after both observed frame slices |
| build marker: announce ordinal 3 | 1788764206795 | same 1 ms clock tick | ordinal establishes capture-before-announce |
| `Client.onFirstScreen` [slice id: 252658] | 1788764206797.6550 | +2.6550 ms after capture | ready reached the client |

The resulting order is:

`publish < RAF request < first DoFrame end < FMP < capture < announce < client ready`

## Correctness and fallback coverage

Source tests pin the queue, not wall-clock guesses:

- publish queues exactly one RAF; RAF queues exactly one timer; only the timer
  captures and announces;
- missing RAF or timer declines deferral and captures inline;
- a synchronous RAF throw takes the existing diagnostic plus inline fallback;
- an inner timer throw reports and captures immediately in the RAF callback so
  the page cannot remain painted but unannounced;
- a reader in the RAF-to-timer gap consumes the capture exactly once;
- the existing #273 fences retain their tap, snapshot, inbound commit,
  sync-ready, second-render, unmount, and close coverage.

## 10k capacity boundary

The exact-head capacity run intentionally accepted terminal outcomes. Baseline
and candidate both crashed before FCP with the same ART error:
`global reference table overflow (max=51200)`. The ART summaries are identical
at the dominant classes: 30,026 `PaintingContext$a` references and 20,442
`m7.w` references. Load-to-crash was 23,163 ms for baseline and 21,685 ms for
candidate. These are capacity observations, not successful samples, and no
ratio or win is derived from them.

## Raw evidence

- `fcp-1k-abba.json`: uninstrumented 1k AB/BA window
- `fcp-8k-abba.json`: uninstrumented 8k AB/BA window
- `ready-1k-profile-abba.json`: exact-head profile window, shape validation,
  timeline epochs and ordinals
- `candidate-1k-profile.pftrace`: final Perfetto trace
- `candidate-1k-profile-events.json`: complete trace event-name census
- `candidate-1k-order.json`: clock-aligned ordering query with slice IDs
- `candidate-1k-trace-timeline.json`: extracted cross-clock calculation and
  gate verdicts
- `capacity-10k-ab.json`: both terminal 10k capacity outcomes and ART dumps
