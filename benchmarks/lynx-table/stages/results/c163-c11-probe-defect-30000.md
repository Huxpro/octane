# Main-thread script attribution — Octane (main-thread program, `mountctl` arm) vs Octane (main-thread program, `mountj` arm) vs Octane (main-thread program, `mountk` arm)

- measured: 2026-08-26T13:02:59.828Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 30000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.42 → 1.45

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
| `octane-mts-program-mountctl` | `app/dist-mtsprogram-mountctl-rows30000/main.web.bundle` | 520098 | `381fe0ab988a479c` | 2026-08-26T12:59:08.523Z |
| `octane-mts-program-mountj` | `app/dist-mtsprogram-mountj-rows30000/main.web.bundle` | 519607 | `aa075dafc8472ae9` | 2026-08-26T12:57:47.267Z |
| `octane-mts-program-mountk` | `app/dist-mtsprogram-mountk-rows30000/main.web.bundle` | 519930 | `9ae041cfb022339e` | 2026-08-26T12:58:35.063Z |

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

## Self time by framework function @30000

| main-thread script | `octane-mts-program-mountctl` | `octane-mts-program-mountj` | `octane-mts-program-mountk` |
|---|---:|---:|---:|
| program mount | 200.8 [191–210.1] | 89.1 [83–122.7] | 0 [0–0] |
| renderer pre-passes | 68.4 [58.9–79] | 68.8 [60–71.7] | 66.3 [61.7–87.2] |
| event bookkeeping | 39.8 [33.6–45.1] | 35.6 [33.4–40.6] | 0 [0–0] |
| applier entry and pre-walk | 32.7 [26.2–37.7] | 30.2 [25–31.5] | 34.7 [28.5–41.2] |
| applier walk | 25.4 [19.4–26.5] | 22.2 [21.5–23.7] | 25.2 [22.7–29.6] |
| compiled program create | 23.9 [23–25.8] | 24.3 [22.4–26.8] | 0 [0–0] |
| first tree capture | 22.1 [21.4–30.8] | 0 [0–0.2] | 23 [21.8–45.7] |
| first-screen entry | 5.8 [5.1–6.6] | 5.7 [3.7–6.9] | 4.8 [4–5] |
| host record building | 2.5 [1.6–4.3] | 1.7 [1.3–3.1] | 2.3 [1.2–3.9] |
| element factory dispatch | 0 [0–0.2] | 0 [0–0.2] | 0 [0–0.2] |
| named total | 420.7 [394.1–439.9] | 277 [262.8–310.9] | 168.3 [143.8–180.4] |
| unnamed by the probe table | 24.7 [20.6–29.7] | 23 [19.3–24.8] | 179 [165.1–196.6] |
| **main-thread script, all frames** | 445.4 [420–464.6] | 296.3 [287.6–335] | 346 [308.9–377] |

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-mountctl`
  - 5.9 ms at 1:230117 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
  - 3.7 ms at 1:228629 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 2.6 ms at 1:228287 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(3e4);let L=new `
- `octane-mts-program-mountj`
  - 6 ms at 1:229626 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
  - 3.9 ms at 1:228138 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 2.4 ms at 1:227796 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(3e4);let L=new `
- `octane-mts-program-mountk`
  - 144.1 ms at 1:186213 — `(r,t,n,i)=>{var o,l,s,d=r.plan;var c=r.ids;var u=r.values;if(void 0===d||void 0===c||void 0===u)throw eK("first-screen program node carries `
  - 10.8 ms at 1:224102 — `(r,o,l,s,d,c){var u,p,v=t(r);var f="string"==typeof o?o:"number"==typeof o&&o?String(o):"";""!==f&&e.setClasses(v,f);var h=n(r);e.setClasses`
  - 4.7 ms at 1:228119 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(3e4);let L=new `

