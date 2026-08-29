# L2 platform-trace attribution

L2 was attempted as a separate, profile-only window for shipped `T1` and `T2`
with DevTool off. The intended boundaries used trace-collector timestamps only;
no `Date.now()`, `performance.now()`, or console subtraction was accepted.

The Android atrace pilot captured platform input/gfx/view/sched activity and
clock-sync markers while the instrumented fixture completed a real interaction,
but it contained none of the Lynx, ReactLynx, or temporary Octane marks. A
native Perfetto attempt then disconnected from the device trace service; its
track-event output was empty. Lynx profile marks and ReactLynx commit/patch
slices require engine profile recording on this image, while the available
recorder enables DevTool/debug profiling and therefore violates #194.

Consequently no stage durations are emitted. The exact attempt metadata,
checksums, marker counts, and protocol stop reason are retained in
`results/issue197-aries10-l2-observability-20260827.json`. The temporary Octane
trace instrumentation was reverted; `perfetto-platform.pbtxt` is the platform
configuration used by the failed native Perfetto attempt.
