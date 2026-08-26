# Main-thread script attribution — Octane (main-thread program, `mountctl` arm) vs Octane (main-thread program, `mountp` arm)

- measured: 2026-08-26T14:49:29.976Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 30000 rows, 1 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.34 → 1.06

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
| `octane-mts-program-mountctl` | `app/dist-mtsprogram-mountctl-rows30000/main.web.bundle` | 520098 | `381fe0ab988a479c` | 2026-08-26T14:48:14.695Z |
| `octane-mts-program-mountp` | `app/dist-mtsprogram-mountp-rows30000/main.web.bundle` | 520105 | `8ca814c451147936` | 2026-08-26T14:48:05.423Z |

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

| main-thread script | `octane-mts-program-mountctl` | `octane-mts-program-mountp` |
|---|---:|---:|
| program mount | 229.7 [229.7–229.7] | 185.8 [185.8–185.8] |
| renderer pre-passes | 76 [76–76] | 80.1 [80.1–80.1] |
| event bookkeeping | 49.4 [49.4–49.4] | 46.4 [46.4–46.4] |
| applier entry and pre-walk | 39.2 [39.2–39.2] | 39.7 [39.7–39.7] |
| applier walk | 26.5 [26.5–26.5] | 32.9 [32.9–32.9] |
| first tree capture | 22.1 [22.1–22.1] | 32.1 [32.1–32.1] |
| compiled program create | 30.8 [30.8–30.8] | 23 [23–23] |
| first-screen entry | 7.5 [7.5–7.5] | 5.8 [5.8–5.8] |
| host record building | 3.3 [3.3–3.3] | 2.8 [2.8–2.8] |
| named total | 484.4 [484.4–484.4] | 448.6 [448.6–448.6] |
| unnamed by the probe table | 25.2 [25.2–25.2] | 24.4 [24.4–24.4] |
| **main-thread script, all frames** | 509.6 [509.6–509.6] | 472.9 [472.9–472.9] |

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-mountctl`
  - 5.5 ms at 1:230117 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
  - 5.2 ms at 1:228629 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 2.6 ms at 1:228287 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(3e4);let L=new `
- `octane-mts-program-mountp`
  - 5.6 ms at 1:230124 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
  - 3.6 ms at 1:228636 — `(e){return(0,r.Zz)(S,["row"+(e.isSelected?" danger":""),String(e.row.id),r.N5,e.row.label,r.N5])},{module:"@octanejs/lynx/main-renderer"});l`
  - 2.8 ms at 1:228294 — `(e=1e3){var r=[];for(var t=0;t<e;t++)r.push({id:n++,label:i[t%i.length]+" "+o[7*t%o.length]+" "+l[13*t%l.length]});return r}(3e4);let L=new `

