# Touch-to-first-changed-frame report (#197)

## Result

On the tested device, T3 reaches the responding frame at the platform floor
for all three shapes. T2 is about one frame behind: its p50 gap from T3 is
11.08–15.47 ms and its p99 gap is 13.16–15.08 ms. Sustained native scrolling
does not create a new tail regime; the same one-frame separation remains.

This is a reference-topology study, not a framework parity or ranking result.
In particular, frozen ReactLynx T1 reports engine 3.2 while T0/T2/T3 report
engine 3.9.

## Protocol and records

- Device: real Lynx Sandbox aries_10, Android 10/API 29, Explorer 1.0.
- Octane base: origin/new-lynx at 07115d67d.
- DevTool off; zero CDP connections; cold launch per retained sample.
- Start/end: battery 35.0°C, thermal status 0.
- Schedule: eight T0,T1,T2,T3 / T3,T2,T1,T0 pairs per shape/load;
  384 retained samples, n=16 in every cell.
- Load: native scroll-view.autoScroll, 120 px/s.
- Shared boundary: MTS capture touchstart to the first RAF whose
  shape-specific predicate observes the changed frame.
- Input timestamp: Lynx native event Unix-epoch milliseconds.
- Changed-frame timestamp: RAF Android-uptime milliseconds.
- Conversion: 64 device-side pairs of
  System.currentTimeMillis()/SystemClock.uptimeMillis() at both ends,
  linearly interpolated by input epoch. Selected brackets were 0 ms; boot-epoch
  drift was 1 ms. No script clock was used.

The immutable window is
[results/issue197-aries10-formal-20260827.json](results/issue197-aries10-formal-20260827.json)
(SHA-256
190a6bd6efde9aac124c3fec292ed8e74b6ac59670ffa97587a893ab02c4b053).
The generated analysis
[results/issue197-aries10-formal-20260827-analysis.json](results/issue197-aries10-formal-20260827-analysis.json)
contains every sorted 16-value distribution, not only percentiles.

The injector occasionally produced no Lynx touch event. Those attempts had
neither a sample nor a 120-VSYNC observer failure, so the whole cold launch was
discarded and retried with a unique URL; they were never treated as latency.
There were 51 discarded attempts: T0=16, T1=15, T2=11, T3=9. Every retained
sample records its attempt count; no retained sample needed more than a second
attempt.

## L1 matrix

Milliseconds; Type-7 quantiles. Full arrays are in the analysis JSON.

| Topology | Shape | Load | n | min | p50 | p90 | p99 | max |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| T0 | local-toggle | idle | 16 | 5.06 | 11.64 | 17.02 | 17.07 | 17.08 |
| T0 | local-toggle | sustained-scroll | 16 | 3.22 | 12.79 | 17.26 | 17.29 | 17.29 |
| T0 | cross-component | idle | 16 | 3.39 | 9.94 | 16.46 | 17.21 | 17.34 |
| T0 | cross-component | sustained-scroll | 16 | 3.50 | 13.54 | 15.07 | 15.61 | 15.62 |
| T0 | structural-delete | idle | 16 | 2.67 | 9.25 | 14.69 | 15.66 | 15.82 |
| T0 | structural-delete | sustained-scroll | 16 | 1.84 | 7.43 | 11.97 | 14.54 | 14.82 |
| T1 | local-toggle | idle | 16 | 12.10 | 15.53 | 25.14 | 27.63 | 28.07 |
| T1 | local-toggle | sustained-scroll | 16 | 10.32 | 18.81 | 27.20 | 28.24 | 28.26 |
| T1 | cross-component | idle | 16 | 9.41 | 20.39 | 23.89 | 26.04 | 26.34 |
| T1 | cross-component | sustained-scroll | 16 | 13.54 | 21.55 | 26.55 | 29.14 | 29.58 |
| T1 | structural-delete | idle | 16 | 14.78 | 22.30 | 28.19 | 28.70 | 28.70 |
| T1 | structural-delete | sustained-scroll | 16 | 11.98 | 19.83 | 24.93 | 26.80 | 26.94 |
| T2 | local-toggle | idle | 16 | 13.03 | 26.56 | 29.57 | 30.08 | 30.09 |
| T2 | local-toggle | sustained-scroll | 16 | 16.23 | 22.28 | 29.77 | 31.88 | 32.17 |
| T2 | cross-component | idle | 16 | 13.46 | 23.87 | 29.44 | 30.21 | 30.34 |
| T2 | cross-component | sustained-scroll | 16 | 13.55 | 25.03 | 31.12 | 32.40 | 32.53 |
| T2 | structural-delete | idle | 16 | 14.77 | 25.74 | 30.77 | 30.81 | 30.82 |
| T2 | structural-delete | sustained-scroll | 16 | 16.83 | 24.40 | 29.92 | 30.79 | 30.93 |
| T3 | local-toggle | idle | 16 | 2.15 | 11.52 | 14.09 | 15.81 | 16.11 |
| T3 | local-toggle | sustained-scroll | 16 | 5.17 | 11.20 | 15.31 | 17.09 | 17.23 |
| T3 | cross-component | idle | 16 | 1.35 | 9.36 | 15.38 | 17.05 | 17.33 |
| T3 | cross-component | sustained-scroll | 16 | 6.52 | 12.52 | 16.06 | 17.46 | 17.63 |
| T3 | structural-delete | idle | 16 | 2.66 | 10.27 | 15.20 | 15.73 | 15.74 |
| T3 | structural-delete | sustained-scroll | 16 | 3.87 | 12.42 | 14.97 | 15.72 | 15.85 |

The frame ordinal is the clearest summary: T0 and T3 changed on RAF #1 in
96/96 samples each. T2 changed on RAF #2 in 74/96 samples; T1 did so in 59/96.

For the local shape specifically:

| Load | T2−T3 p50 | T2−T3 p99 | T3−T0 p50 | T3−T0 p99 |
| --- | ---: | ---: | ---: | ---: |
| idle | 15.04 | 14.27 | -0.12 | -1.26 |
| sustained-scroll | 11.08 | 14.79 | -1.59 | -0.20 |

## L2 attribution

The source and native logs establish the shipped ordering, but the requested
per-stage p50/p99 milliseconds are not observable under #194's protocol on
this image:

- T1: platform event -> engine delivery to BTS -> handler/state/render/commit
  on BTS -> patch to MTS -> apply -> layout/paint.
- T2: platform event -> lynxCoreInject.tt.publishEvent directly to the
  Octane BTS receiver -> handler/state/render -> encoded commit to MTS ->
  decode/validate/prepare/apply -> layout/paint.

The second point corrects #197's premise: the real shipped ordinary T2 event
does not first resolve through resolveLynxHostNativeEvent on MTS. That method
is the source/test bridge; the native Explorer path publishes the opaque token
straight to BTS.

A DevTool-off Android atrace pilot captured 35,812,536 bytes of
input/gfx/view/sched activity and clock-sync markers, and the profile bundle
completed its interaction, but it contained zero Issue197, OctaneLynx, or
ReactLynx marks. The device's native Perfetto service disconnected, and its
track-event attempt produced zero bytes. Lynx profile marks and ReactLynx's
built-in commit/patch slices require engine profile recording; the available
recorder enables DevTool/debug profiling, which violates the accepted protocol
and changes the measured system.

The evidence is retained in
[results/issue197-aries10-l2-observability-20260827.json](results/issue197-aries10-l2-observability-20260827.json).
No Date.now, performance.now, console subtraction, or DevTool-on substitute is
reported as L2 attribution. Therefore L2 has an explicit observability stop
gate rather than invented stage durations.

## L3 decision

**Yes: MTS-resident interaction state is worth designing.**

This judgment is limited to whether design work is justified. T3 sits at the
T0 floor for the local shape while T2 is about one frame behind at both p50 and
p99, including under sustained scroll. The result does not start or prescribe
that design.
