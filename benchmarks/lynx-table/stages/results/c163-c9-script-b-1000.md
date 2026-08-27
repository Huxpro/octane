# Main-thread script attribution — Octane vs Octane (main-thread program) vs L0 direct-emission prototype

- measured: 2026-08-26T12:26:41.036Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 1000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.37 → 0.83

## Which build this measured

`digest` names the bytes: two records that agree on it for a cell measured the
same code, which is what an A/B at one scale needs in order to be an A/B.
Across scales the bundles differ by construction — the row count is compiled
in — so what makes several records one series is instead that every bundle was
built from one revision, and `built` is what answers that. A bundle older than
the last commit under `packages/` measured a stale build, and reading it beside
a fresh one turns a version difference into an apparent workload effect.

| cell | bundle | bytes | digest | built |
|---|---|---:|---|---|
| `octane` | `app/dist-rows1000/main.web.bundle` | 518125 | `07f90c6e912dfbcf` | 2026-08-26T12:01:42.819Z |
| `octane-mts-program` | `app/dist-mtsprogram-rows1000/main.web.bundle` | 520098 | `8b873351c53e8ab3` | 2026-08-26T11:19:41.410Z |
| `octane-direct` | `prototype/dist-rows1000/main.web.bundle` | 20560 | `21444cfc4e712669` | 2026-08-26T12:13:05.166Z |

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
| host record building | 15 [13–19.9] | 0 [0–0.6] | 0 [0–0] |
| applier walk | 13.3 [10.6–16.3] | 1.9 [0.9–2.3] | 0 [0–0] |
| renderer pre-passes | 12.2 [11.5–14] | 6.4 [5.9–7.2] | 0 [0–0] |
| applier entry and pre-walk | 6 [5.8–6.6] | 2.4 [2.2–2.6] | 0 [0–0] |
| program mount | 0 [0–0] | 5.9 [4.1–7.2] | 0 [0–0] |
| first tree capture | 4.2 [3.3–4.7] | 0.8 [0.7–1.2] | 0 [0–0] |
| first-screen entry | 3.6 [1.9–4.7] | 0.7 [0.3–0.8] | 0 [0–0] |
| event bookkeeping | 2.4 [1.4–3.1] | 1.2 [0.5–1.7] | 0 [0–0] |
| compiled program create | 0 [0–0] | 2.2 [1.6–3] | 0 [0–0] |
| element factory dispatch | 1.1 [1–1.9] | 0 [0–0.2] | 0 [0–0] |
| named total | 59.1 [52.8–64.4] | 22 [19–23.1] | 0 [0–0] |
| unnamed by the probe table | 8.5 [6.9–10.3] | 4.2 [3.3–4.4] | 3.2 [2.2–4.9] |
| **main-thread script, all frames** | 67.8 [61.9–72.9] | 26.5 [23.2–27.3] | 3.2 [2.2–4.9] |

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane`
  - 1.3 ms at 1:9713 — `(e){var r=X.exec(e);if(null===r)return null;var t=r[1];return Z.has(t)?"discrete":H.has(t)?"continuous":"default"}var Q=new Map;var ee=[];fu`
  - 0.9 ms at 1:9270 — `(){return{renderer:"lynx",readContext:eh,insertionEffect(){},layoutEffect(){},effect(){}}}function K(e){return"string"==typeof e||"number"==`
  - 0.9 ms at 1:223813 — `(e,r)=>{let t=e.h("view");e.p(t,"class",r[0]);let n=e.h("text");return e.p(n,"class","col-id"),e.s(n,r[1]),e.a(t,n),n=e.h("text"),e.p(n,"cla`
- `octane-mts-program`
  - 0.7 ms at 1:10067 — `(e,r){var t=U(e);if(t!==S&&"lynx"!==t.id)throw new n.qO("Lynx first-screen rendering requires a compiled Lynx component.");var a=R(T());var `
  - 0.6 ms at 1:228629 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 0.4 ms at 1:228287 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(1e3);let L=new `
- `octane-direct`
  - 1.3 ms at 72:19 — `(id, label, selected) {`
  - 1.2 ms at 182:25 — `(count) {`
  - 0.4 ms at 276:34 — `() {`

