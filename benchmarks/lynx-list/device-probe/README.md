# Issue 195 native-list boundary probe

This throwaway probe measures Octane's `componentAtIndex`,
`componentAtIndexes`, and `enqueueComponent` callbacks on a native Lynx list.
It does not change package or production source. The probe is checked in on
`perf/lynx-list-boundary-probe-195` at the `origin/new-lynx` baseline
`7cfe364ec0159ba099f99e17f799cdfe90b547b4`.

## Fixture and measurement boundary

- 10,000 keyed rows, one reuse identifier, 92 px estimated row height.
- Each row has one `list-item`, three `view`/`text` containers, and four text
  elements. The initial materialization makes 11 element PAPI calls per row
  after raw-text nodes are included.
- The loader instruments the normalized Element PAPI only in this probe build.
  Package sources remain byte-for-byte unchanged.
- `Date.now` is the only timer exposed in this Explorer/LepusNG build, so every
  recorded duration has 1 ms resolution.
- `elementCrossingMs` is the wall inside non-flush public Element PAPI calls. It
  includes both the JS-to-native crossing and the synchronous native element
  operation; this device surface cannot separate them.
- `flushTriggerMs` is wall inside `__FlushElementTree`. It is not a claim about
  all later native layout work.
- `frameworkMs` is callback wall minus those two PAPI buckets, clamped at zero.

## Device protocol

The run follows the [issue 194 protocol](https://github.com/Huxpro/octane/issues/194#protocol-all-four):

- ByteDance `aries_10`, Android 10, Explorer 1.0, Lynx/LepusNG 4.0, QuickJS;
- DevTool disabled before measured windows; the same connector call read
  `enable_devtool=false` before disconnecting;
- four warm-up gestures, then `AB / BA / AB / BA / AB`;
- thermal guard before every formal gesture (`Thermal Status == 0`, battery
  temperature at most 40 °C); every retained window was 35 °C/status 0;
- one JSON file per idle-delimited window; PAPI counters reset at the boundary,
  so `callsBefore` is identical and no total crosses windows;
- two complete formal AB/BA blocks (20 windows total); medians are reported
  only for the exact same-work fling class: 56
  materializations, 56 recycles, and the identical 112/224/56
  `GetUniqueID`/`SetAttribute`/`Flush` multiset (n=6). The other 14 fling
  windows remain checked in but are excluded explicitly.

The sustained fling is a 100 ms ADB swipe followed by a 6 second settle.
Direction ranges overlap and n is below 15, so no A-vs-B claim is spendable.

## Reproduction

Build the bundle from this directory:

```bash
node build.mjs
```

Serve `dist/main.lynx.bundle`, reverse that port to a leased device, load it in
Explorer, disable DevTool, then run each arm:

```bash
node run-device.mjs <serial> fling /tmp/issue195-fling-1.json
node run-device.mjs <serial> fling /tmp/issue195-fling-2.json
node analyze.mjs /tmp/issue195-fling-1.json /tmp/issue195-fling-2.json
```

The measured bundle SHA-256 is
`e36b1c8eddde3dd200e8234ddb221f1bf84a56c21ebbd80ca2cde5b6a394185a`
(504,772 bytes). `results/2026-08-26-aries10-summary.json` contains medians
and every sample used by each median; the neighboring files retain each raw
window independently.
