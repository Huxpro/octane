# Main-thread script attribution — Octane vs Octane (main-thread program) vs L0 direct-emission prototype

- measured: 2026-08-25T22:53:27.353Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 1000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 1.02 → 1.09

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

## Self time by framework function @1000

| main-thread script | `octane` | `octane-mts-program` | `octane-direct` |
|---|---:|---:|---:|
| host record building | 12.9 [10.9–14.6] | 3.1 [1.4–4.3] | 0 [0–0] |
| renderer pre-passes | 11.3 [10.5–12.5] | 7.6 [7.1–11.6] | 0 [0–0] |
| applier walk | 10.8 [9.6–12.8] | 3.8 [2.4–5.4] | 0 [0–0] |
| applier entry and pre-walk | 6.1 [5.8–6.9] | 3.3 [2.4–4.5] | 0 [0–0] |
| program mount | 0 [0–0] | 4.5 [3.3–6.2] | 0 [0–0] |
| first tree capture | 3.4 [3–4.2] | 1.8 [1.5–2.1] | 0 [0–0] |
| first-screen entry | 3.1 [1.6–4.3] | 1.6 [1–1.7] | 0 [0–0] |
| event bookkeeping | 1.9 [1.8–2.4] | 1.4 [0.3–1.6] | 0 [0–0] |
| compiled program create | 0 [0–0] | 1.5 [1.1–1.9] | 0 [0–0] |
| element factory dispatch | 1 [0.7–1.3] | 0.2 [0–0.2] | 0 [0–0] |
| named total | 50.9 [48.4–54.1] | 28.8 [26.4–31.7] | 0 [0–0] |
| unnamed by the probe table | 12.6 [7.6–15.1] | 6.1 [6–8.4] | 4 [1.6–4.9] |
| **main-thread script, all frames** | 63.1 [60.9–67.9] | 35.6 [33.5–37.7] | 4 [1.6–4.9] |

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane`
  - 4.9 ms at 1:74786 — `(r,t){if(null===r||"object"!=typeof r)return r;if(t.active.has(r))throw eZ("first-tree props cannot contain cycles.");var n=t.clones.get(r);`
  - 2.5 ms at 1:74729 — `(e,r){return r.active.clear(),r.clones.clear(),function e(r,t){if(null===r||"object"!=typeof r)return r;if(t.active.has(r))throw eZ("first-t`
  - 0.7 ms at 1:193873 — `()=>{var t;return Object.freeze({format:1,renderer:eF,root:e.root,version:F,plan:null!=(t=r.plan)?t:null,roots:D,nodes:Object.freeze(i.map(e`
- `octane-mts-program`
  - 1.2 ms at 1:74786 — `(r,t){if(null===r||"object"!=typeof r)return r;if(t.active.has(r))throw eZ("first-tree props cannot contain cycles.");var n=t.clones.get(r);`
  - 1.1 ms at 1:74729 — `(e,r){return r.active.clear(),r.clones.clear(),function e(r,t){if(null===r||"object"!=typeof r)return r;if(t.active.has(r))throw eZ("first-t`
  - 0.7 ms at 1:228480 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
- `octane-direct`
  - 2.5 ms at 182:25 — `(count) {`
  - 0.9 ms at 72:19 — `(id, label, selected) {`
  - 0.6 ms at 276:34 — `() {`

