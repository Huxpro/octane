# Result windows

Store one immutable JSON file per measurement window. A file must contain the
device, OS, per-topology Lynx/Lepus versions, DevTool state, bundle hashes,
load control, Android platform-clock calibration, exact AB/BA schedule fields,
and every raw timestamp pair.

Do not combine totals or percentile inputs across files. Generate a per-window
distribution with:

```bash
node benchmarks/lynx-touch-frame/analyze.mjs results/<window>.json
```
