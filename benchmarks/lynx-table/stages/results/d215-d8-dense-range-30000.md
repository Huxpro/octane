# Main-thread script attribution — Octane (main-thread program, profile build) vs Octane (main-thread program, `d8control` arm, profile build)

- measured: 2026-08-27T16:53:55.479Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 30000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.21 → 2.33

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
| `octane-mts-program-profile` | `app/dist-mtsprogram-rows30000-profile/main.web.bundle` | 542071 | `de5fed57b29cdc6d` | 2026-08-27T16:48:41.170Z |
| `octane-mts-program-d8control-profile` | `app/dist-mtsprogram-d8control-rows30000-profile/main.web.bundle` | 542071 | `f0fe1297628842f4` | 2026-08-27T16:48:37.608Z |

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

| main-thread script | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| renderer pre-passes | 69.2 [62.3–78.7] | 74.7 [65.5–83.1] |
| stage instrument | 72.4 [62.9–73.8] | 67.6 [62.8–75.3] |
| program mount | 3.8 [2–6.7] | 53.6 [46.7–55.1] |
| applier entry and pre-walk | 26.4 [21.2–36.3] | 33.9 [28–36.2] |
| papi facade | 20.6 [16.4–27.9] | 23.1 [19.6–26.6] |
| compiled program create | 2.2 [1.4–2.9] | 14.4 [12.9–17] |
| first-screen entry | 3.5 [2.5–8.1] | 10.2 [8.9–12.1] |
| event bookkeeping | 9.7 [8.4–11.1] | 9.7 [7.2–17.3] |
| first tree capture | — | 0.9 [0.5–1] |
| named total | 210 [198.2–219.7] | 292.1 [266.8–298.6] |
| unnamed by the probe table | 84.4 [74.4–87.5] | 80.4 [73.1–83.9] |
| **main-thread script, all frames** | 294.3 [283.4–294.9] | 371 [350.8–379] |

## The adoption window @30000

What the main-thread script spends after the screen is already painted and
before the tree is the background’s: the background’s description arriving and
being validated, `prepareLynxHostBatch` answering adopt or repair, the apply,
and — on an adoption — the hand-over a message after that. None of it moves a
pixel, so no paint predicate can wait for it and the window above ends before
it starts.

A cell reaches this window only when it carries the framework’s profile record,
which a shipping-shaped build folds away entirely. `—` below is that, not zero:
the cell ended at settled paint and this window does not exist for it. A profile
build is a different build configuration, so these numbers apportion their own
window and compare to another profile cell’s, never to a shipping one’s.

| adoption window | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| batch preparation | 394.6 [371.5–431.3] | 378.4 [361.8–410.8] |
| inbound validation | 306.6 [299–319.8] | 299.3 [294.1–357] |
| handle delta | 130.6 [127.1–142.5] | 148.4 [126.1–159] |
| host record building | 128.8 [115.5–143] | 125.7 [122.5–137.3] |
| adoption apply | 109.6 [108.5–130] | 105.7 [103.2–117.6] |
| main-thread receive | 44.3 [42.9–45.9] | 41 [36.3–44.4] |
| event bookkeeping | 42.6 [38.7–45.7] | 38 [34.9–44.3] |
| first-tree comparator | 40.2 [37.3–44.5] | 34.5 [32.9–38.1] |
| hand-over | 19.9 [16.5–26.1] | 20.4 [16.7–21.8] |
| program index | 3 [2.2–3.3] | 4.1 [2.2–5.2] |
| papi facade | 2.7 [2.1–4.4] | 2.4 [1.6–3.4] |
| program mount | — | 0.6 [0.2–1] |
| named total | 1234.3 [1183.5–1294.3] | 1213.4 [1162.6–1276.5] |
| unnamed by the probe table | 284.9 [250.6–312.2] | 265.8 [256.5–284.3] |
| **main-thread script, all frames** | 1517.8 [1434–1606.5] | 1479.5 [1419.1–1560.8] |

The framework’s own walls for the same three stages, which it measures itself
and this instrument only samples. They are the cross-check: a bucket total far
from its wall is a probe that stopped matching, not a stage that got cheaper.

| framework wall | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `prepareLynxHostBatch` | 919.5 [877.4–983] | 895.5 [884.9–1474.1] |
| `prepared.apply()` | 408.6 [382.6–455.5] | 363.8 [362.5–394.2] |
| hand-over | 0 [0–0.1] | 0 [0–0.1] |
| paint → settled | 4958.5 [4830.2–5538.7] | 5332.7 [4923.1–5680.8] |

- `octane-mts-program-profile`: first tree `adopt`.
- `octane-mts-program-d8control-profile`: first tree `adopt`.

Largest frames the probe table did not name, `octane-mts-program-profile`:

- 100.8 ms at `1:87633` — `e=>{var r;return null!=(r=E.get(e))?r:Q(e)}:e=>{var r,t;if(!_.has(e))return null!=(r=null!=(t=E.get(e))?t:d.records.get(e))?r:Q(e)};var en=z`
- 35.4 ms at `1:88233` — `e=>T.get(e):e=>{var r;return null!=(r=T.get(e))?r:d.generations.get(e)};var eo=(e,r)=>{M&&1===r||T.set(e,r)};var el=e=>{var r,t=[];var n=new`
- 30.8 ms at `1:87774` — `e=>{var r;return null!=(r=E.get(e))?r:er(e)}:e=>{if(!_.has(e)){var r=E.get(e);if(void 0!==r){if(null!==P&&r===d.records.get(e)){var t=rs(r);`

Largest frames the probe table did not name, `octane-mts-program-d8control-profile`:

- 100.3 ms at `1:87633` — `e=>{var r;return null!=(r=E.get(e))?r:Q(e)}:e=>{var r,t;if(!_.has(e))return null!=(r=null!=(t=E.get(e))?t:d.records.get(e))?r:Q(e)};var en=z`
- 41.5 ms at `1:87774` — `e=>{var r;return null!=(r=E.get(e))?r:er(e)}:e=>{if(!_.has(e)){var r=E.get(e);if(void 0!==r){if(null!==P&&r===d.records.get(e)){var t=rs(r);`
- 36.1 ms at `1:88233` — `e=>T.get(e):e=>{var r;return null!=(r=T.get(e))?r:d.generations.get(e)};var eo=(e,r)=>{M&&1===r||T.set(e,r)};var el=e=>{var r,t=[];var n=new`

### Inside the buckets that fold several functions

A bucket is a probe table entry, not a function, and five of the rows above
name more than one. `renderer pre-passes` names 16, so its row says which
file the script is in and nothing about what it is doing there. These are the
same samples keyed by the source each probe was taken from; every bucket below
sums to its own row above, which the report checks rather than assumes. A site
at 0.0 is a function the run never entered, reported rather than dropped so
that a probe which stopped matching looks different from a branch nothing took.

A site is a claim about the source, so each cell also says how many distinct
frame positions its probe actually matched. One is a site whose total is a
single function’s. More is a total shared between frames, and which kind it is
has to be read from the source: two entrances the minifier made to one
function look exactly like two functions a probe was wide enough to reach.
The count does not settle that, and it is printed so the number is not read as
a single function’s cost before it has been.

**renderer pre-passes**

| source site | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `main-renderer.ts renderComponent` | 3 [2.2–3.5] | 3.7 [2.6–4] |
| `main-renderer.ts textNode` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.h` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts universalPlan` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts freezePlanNode` | 0 [0–0.2] | 0 [0–0] |
| `main-renderer.ts renderTemplate` | 15 [13–17.6] | 19.7 [13.3–20.8] |
| `main-renderer.ts recursive prop freeze` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts assignIds` | 7.3 [4.6–9.2] | 7.9 [6.8–8.2] |
| `main-renderer.ts assignProgramIds` | 4.6 [3–5.4] | 5 [2.7–6] |
| `main-renderer.ts collectFirstScreenEvents` | 17.4 [14–27.1] | 20.1 [18.6–22.2] |
| `main-renderer.ts TEMPLATE_ENV.t` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.s` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.a` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts normalizeProps` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts materialize` | 15.6 [12.9–16.7] | 15.9 [12.7–16.7] |
| `main-renderer.ts prop bag builder` | 7.6 [5.5–10.3] | 6.6 [4.3–8.2] |
| **renderer pre-passes, all sites** | 69.2 [62.3–78.7] | 74.7 [65.5–83.1] |

**program mount**

| source site | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `core/host-driver.ts mountProgram` | 3.8 [2–6.7] · 2 frames | 53.3 [46.4–54.6] · 2 frames |
| `core/host-driver.ts mountProgram range members` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts mountProgram event-site lookup` | 0 [0–0] | 0 [0–0] |
| `core/first-screen.ts programRunLastId` | 0 [0–0] | 0.4 [0–0.9] |
| **program mount, all sites** | 3.8 [2–6.7] | 53.6 [46.7–55.1] |

**applier entry and pre-walk**

| source site | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `core/host-driver.ts applyLynxFirstScreenDirect` | 21.3 [16.4–30.2] | 29.6 [22.6–31.5] |
| `core/host-driver.ts firstScreenTreeHasList` | 5 [4.5–6] | 4.7 [4–5.4] |
| **applier entry and pre-walk, all sites** | 26.4 [21.2–36.3] | 33.9 [28–36.2] |

**papi facade**

| source site | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `core/papi.ts papi facade methods` | 1.6 [0.7–6.8] · 2 frames | 1.8 [1.6–4.3] · 2 frames |
| `core/papi.ts createPage` | 19 [15.7–21.9] · 2 frames | 20.7 [18–24.8] |
| **papi facade, all sites** | 20.6 [16.4–27.9] | 23.1 [19.6–26.6] |

**event bookkeeping**

| source site | `octane-mts-program-profile` | `octane-mts-program-d8control-profile` |
|---|---:|---:|
| `core/host-driver.ts nativeEventMap` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodePrevalidatedLynxNativeEventToken` | 9.5 [8.1–11] | 9.7 [7.2–17.3] |
| `core/host-driver.ts installNativeEvent` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts parseLynxNativeEventProp` | 0.2 [0–0.3] | 0 [0–0.2] |
| `core/native-events.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodeCheckedLynxNativeEventToken` | 0 [0–0] | 0 [0–0] |
| **event bookkeeping, all sites** | 9.7 [8.4–11.1] | 9.7 [7.2–17.3] |

### The source at every site the run entered

A site’s name is a claim that its probe matches one named function in one
named file, and nothing in the run checks that claim — a probe is matched
against minified text, so a label naming the wrong function, or naming a file
that does not exist, reads exactly like a correct one. The source at each
frame is what makes the claim checkable, so the record carries it for every
site rather than only for the ones already known to be shared.

For a site over one frame it answers what the frame count cannot: frames
whose text differs are different functions the probe was wide enough to
reach, and the total is shared between them; frames whose text is one
function entered twice are that function after all. For a site at one frame
it is the evidence that the label names what it says it names.

- `octane-mts-program-profile` — `main-renderer.ts renderComponent`, 1 frame
  - 1:15042 — `()=>es(e(r,Y()),null))}finally{T.length=i}}var eo=Object.freeze({h:e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:`
- `octane-mts-program-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:9543 — `(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a cr`
- `octane-mts-program-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:16392 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:21080 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:21147 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var s=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-profile` — `main-renderer.ts collectFirstScreenEvents`, 1 frame
  - 1:22039 — `(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibil`
- `octane-mts-program-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:15913 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===$){var t,n,o,s,d,v=es(e.value,X(e.key));return 1!==v.length?[ea(v,X`
- `octane-mts-program-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:12821 — `(e,r=S,t=!1){var n={};for(var a of e){if("spread"===a[0]){(function(e,r,t){if(null!=r){var n=Object(r);for(var a of Reflect.ownKeys(n))Objec`
- `octane-mts-program-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:189682 — `(e,r)=>{if(q)throw Error("Octane Lynx first-screen root rendered after receiver close.");if("open"!==G)throw Error("Octane Lynx first-screen`
- `octane-mts-program-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:190234 — `(e,r,t){var n;var a=e[eU];if(a.disposed||a.disposing||a.faulted||a.applying)throw eK("first-screen container is not accepting an initial tre`
- `octane-mts-program-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:190502 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-profile` — `emitted main-thread program create`, 4 frames
  - 1:51012 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw eK(`${r} must be a positive safe integer.`)}function eX(e,r){if("string"!=typeof e||0===e.leng`
  - 1:81598 — `(e){var r=ti.get(e);if(void 0!==r)return r;var t=e.events.map(e=>{var r=v(e.type);if(null===r)throw eK(`event ${JSON.stringify(e.type)} is n`
  - 1:199256 — `(e,r,t){var n;var a=t-r;if(a<2)return null;var i=e[r];if(void 0===i)return null;var o=ts(i);if(void 0===o)return null;var l=o.plan;if(void 0`
  - 1:238503 — `(r,o,l,s,d,u,c,v,p,f,h,y,m,g){var b=t(r);e.setClasses(b,"page");var w=n(r);e.setClasses(w,"title");var O=a("Octane UI Benchmark on Lynx · re`
- `octane-mts-program-profile` — `core/papi.ts papi facade methods`, 2 frames
  - 1:165083 — `(e,r){z(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,I,r)},setDataset(`
  - 1:165244 — `(e,r,t,n){T(e,r,t,n)},setId(e,r){R(e,r)},flush(e,r){N(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-profile` — `core/papi.ts createPage`, 2 frames
  - 1:164505 — `(e){var r=performance.now();try{return s(e)}finally{nh(r)}}}),createPage(e,r){var t=performance.now();try{return n(e,r)}finally{nh(t)}},crea`
  - 1:164577 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nh(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-profile` — `core/host-driver.ts mountProgram`, 2 frames
  - 1:194222 — `(r){var n,a,i=p[r];var l=W[i.node];if(void 0===l)throw eK(`first-screen program binds an event on node ${i.node}, which it did not number.`)`
  - 1:195678 — `(r,n,i,l,s)=>{var d,u,c,v=function(r){var n,a,i=f[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, whi`
- `octane-mts-program-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:26118 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function b(e){if("string"!=typeof e)throw y("must be a string.");var r=f.exec`
- `octane-mts-program-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:25284 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=d.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:156650 — `(e){var r;var t=(0,np.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var ny=new Set;function nm(){throw Error("Octa`
- `octane-mts-program-d8control-profile` — `main-renderer.ts renderComponent`, 1 frame
  - 1:15042 — `()=>es(e(r,Y()),null))}finally{T.length=i}}var eo=Object.freeze({h:e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:`
- `octane-mts-program-d8control-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:16392 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-d8control-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:21080 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-d8control-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:21147 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var s=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-d8control-profile` — `main-renderer.ts collectFirstScreenEvents`, 1 frame
  - 1:22039 — `(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibil`
- `octane-mts-program-d8control-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:15913 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===$){var t,n,o,s,d,v=es(e.value,X(e.key));return 1!==v.length?[ea(v,X`
- `octane-mts-program-d8control-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:12821 — `(e,r=S,t=!1){var n={};for(var a of e){if("spread"===a[0]){(function(e,r,t){if(null!=r){var n=Object(r);for(var a of Reflect.ownKeys(n))Objec`
- `octane-mts-program-d8control-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:190234 — `(e,r,t){var n;var a=e[eU];if(a.disposed||a.disposing||a.faulted||a.applying)throw eK("first-screen container is not accepting an initial tre`
- `octane-mts-program-d8control-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:190502 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-d8control-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:189682 — `(e,r)=>{if(q)throw Error("Octane Lynx first-screen root rendered after receiver close.");if("open"!==G)throw Error("Octane Lynx first-screen`
- `octane-mts-program-d8control-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:26118 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function b(e){if("string"!=typeof e)throw y("must be a string.");var r=f.exec`
- `octane-mts-program-d8control-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:25284 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=d.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-d8control-profile` — `emitted main-thread program create`, 7 frames
  - 1:5541 — `()=>!1,Cl:()=>m,GI:()=>o,cQ:()=>l,fT:()=>h,h4:()=>y,j8:()=>O,jm:()=>f,nz:()=>c,o3:()=>i,o7:()=>j,qO:()=>a,vu:()=>p,w7:()=>v,wA:()=>w})},402(`
  - 1:5614 — `()=>c,o3:()=>i,o7:()=>j,qO:()=>a,vu:()=>p,w7:()=>v,wA:()=>w})},402(e,r,t){function n(){var e;var r=globalThis;return null!=(e=r.__OCTANE_LYN`
  - 1:5698 — `(){var e;var r=globalThis;return null!=(e=r.__OCTANE_LYNX_PROF)?e:r.__OCTANE_LYNX_PROF={commits:0,commands:0,emptyCommits:0,bytes:0,selfchec`
  - 1:6424 — `()=>n})},867(e,r,t){var n=t(690);var a=Promise.resolve();var i=Object.freeze({renderer:"lynx",ready:a,render(e,r){if("function"!=typeof e)th`
  - 1:51012 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw eK(`${r} must be a positive safe integer.`)}function eX(e,r){if("string"!=typeof e||0===e.leng`
  - 1:236220 — `(r,o,l,s,d,u){var c,v,p=t(r);var f="string"==typeof o?o:"number"==typeof o&&o?String(o):"";""!==f&&e.setClasses(p,f);var h=n(r);e.setClasses`
  - 1:238503 — `(r,o,l,s,d,u,c,v,p,f,h,y,m,g){var b=t(r);e.setClasses(b,"page");var w=n(r);e.setClasses(w,"title");var O=a("Octane UI Benchmark on Lynx · re`
- `octane-mts-program-d8control-profile` — `core/papi.ts papi facade methods`, 2 frames
  - 1:165083 — `(e,r){z(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,I,r)},setDataset(`
  - 1:165244 — `(e,r,t,n){T(e,r,t,n)},setId(e,r){R(e,r)},flush(e,r){N(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-d8control-profile` — `core/papi.ts createPage`, 1 frame
  - 1:164505 — `(e){var r=performance.now();try{return s(e)}finally{nh(r)}}}),createPage(e,r){var t=performance.now();try{return n(e,r)}finally{nh(t)}},crea`
- `octane-mts-program-d8control-profile` — `core/host-driver.ts mountProgram`, 2 frames
  - 1:195678 — `(r,n,i,l,s)=>{var d,u,c,v=function(r){var n,a,i=f[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, whi`
  - 1:195712 — `(r){var n,a,i=f[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, which it did not number.`);var l=void`
- `octane-mts-program-d8control-profile` — `core/first-screen.ts programRunLastId`, 1 frame
  - 1:1987 — `(e){if(1!==e.count)return e.firstId+(e.count-1)*e.stride+u(e.plan)-1;var r=e.ids[e.ids.length-1];for(var t=e.rangeIds.length-1;t>=0;t--){var`
- `octane-mts-program-d8control-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:156650 — `(e){var r;var t=(0,np.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var ny=new Set;function nm(){throw Error("Octa`
- `octane-mts-program-d8control-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:202586 — `(e,r={}){var t,n=e[eU];if(n.disposed||n.disposing||n.faulted||n.applying)throw eK("first tree can only be captured from a stable accepted ro`

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-profile`
  - 20 ms at 1:164438 — `(e){var r=performance.now();try{return l(e)}finally{nh(r)}},rawText(e){var r=performance.now();try{return s(e)}finally{nh(r)}}}),createPage(`
  - 17.1 ms at 1:236693 — `(r,o,l,s,d,u){var c=0,v=0,p=0,f=0;for(var h=0;h<o;h++){var y,m,g=l[c];var b=s[v];var w=s[v+1];var O=d[p];var $=d[p+1];var j=t(r);var x="stri`
  - 10.3 ms at 1:193131 — `(r,n,i,l)=>{var s=r.plan;var d=r.count;var u=r.programs;var c=r.firstId;var v=r.stride;var p=s.events;var f=p.length;var h=s.ranges.length;v`
- `octane-mts-program-d8control-profile`
  - 22 ms at 1:193085 — `r=>{var n=r.denseSpan;if(null!==n)return void((r,n,i,l)=>{var s=r.plan;var d=r.count;var u=r.programs;var c=r.firstId;var v=r.stride;var p=s`
  - 15.9 ms at 1:164438 — `(e){var r=performance.now();try{return l(e)}finally{nh(r)}},rawText(e){var r=performance.now();try{return s(e)}finally{nh(r)}}}),createPage(`
  - 7.4 ms at 1:164374 — `(e){var r=performance.now();try{return i(e)}finally{nh(r)}},text(e){var r=performance.now();try{return l(e)}finally{nh(r)}},rawText(e){var r`

