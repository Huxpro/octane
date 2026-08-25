# Main-thread script attribution — Octane vs Octane (main-thread program) vs L0 direct-emission prototype

- measured: 2026-08-25T22:53:15.559Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 10000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0 → 1.02

## What this is, and is not

Self time inside the hidden main-thread realm only. The page realm runs the
harness's own paint predicate, which is measurement rather than framework, and
is excluded. Frames are named by the string literals in the code, because a
production bundle is minified and a mangled name says nothing; the probe table
is `stages/mts-profile-buckets.mjs`, and every probe cites the source it came
from.

**These milliseconds are not the boundary instrument’s.** A sampling profiler
perturbs the page it measures and this run carries no uninstrumented control.
What is reportable here is the shape — which function owns the script, and how
the cells compare on one axis. Wall clocks come from `stages/papi-run.mjs`.

## Self time by framework function @10000

| main-thread script | `octane` | `octane-mts-program` | `octane-direct` |
|---|---:|---:|---:|
| applier walk | 113.7 [109.6–117.9] | 35.7 [33.3–41.6] | 0 [0–0] |
| host record building | 95.5 [93–98.8] | 25.8 [20.8–29.9] | 0 [0–0] |
| renderer pre-passes | 58.4 [56.9–61.3] | 37 [34.3–45.7] | 0 [0–0] |
| program mount | 0 [0–0] | 53.8 [49.3–55.8] | 0 [0–0] |
| first tree capture | 45 [42.3–49.2] | 12.4 [11.1–13.3] | 0 [0–0] |
| applier entry and pre-walk | 44.6 [38.7–49] | 19.8 [19.1–24.4] | 0 [0–0] |
| first-screen entry | 18.2 [16–18.4] | 3.8 [3.1–4.1] | 0 [0–0] |
| event bookkeeping | 17 [15.6–19.9] | 13.3 [12.3–15.9] | 0 [0–0] |
| compiled program create | 0 [0–0] | 6.9 [5.8–7.2] | 0 [0–0] |
| element factory dispatch | 5.5 [2.8–6.2] | 0.7 [0.6–1.7] | 0 [0–0] |
| named total | 398.8 [383.9–410.7] | 211.1 [205.4–225.9] | 0 [0–0] |
| unnamed by the probe table | 24 [20.8–27.5] | 13.5 [10.5–15.2] | 10.3 [7.6–13.3] |
| **main-thread script, all frames** | 420.1 [407.1–436.6] | 226.3 [218.9–238] | 10.3 [7.6–13.3] |

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane`
  - 3 ms at 1:9473 — `(e){var r=X.exec(e);if(null===r)return null;var t=r[1];return Z.has(t)?"discrete":H.has(t)?"continuous":"default"}var Q=new Map;var ee=[];fu`
  - 1.9 ms at 1:226639 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
  - 1.9 ms at 1:157789 — `(e,r){L(e,z,r)},setDataset(e,r){N(e,r)},setEvent(e,r,t,n){_(e,r,t,n)},setId(e,r){T(e,r)},flush(e,r){R(e,r)}},Object.getOwnPropertyDescriptor`
- `octane-mts-program`
  - 3.4 ms at 1:9762 — `(e,r=null){return{kind:"range",key:r,id:0,children:e}}function en(e,r){var t=U(e);if(t!==S&&"lynx"!==t.id)throw new n.qO("Lynx first-screen `
  - 2.4 ms at 1:226992 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 2.3 ms at 1:228480 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
- `octane-direct`
  - 6.2 ms at 72:19 — `(id, label, selected) {`
  - 3.8 ms at 276:34 — `() {`
  - 1.9 ms at 182:25 — `(count) {`

