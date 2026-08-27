# Main-thread script attribution — Octane (main-thread program, profile build) vs Octane (main-thread program, `d3control` arm, profile build)

- measured: 2026-08-27T14:49:10.262Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2
- 30000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.19 → 3.4

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
| `octane-mts-program-profile` | `app/dist-mtsprogram-rows30000-profile/main.web.bundle` | 536099 | `2beb23cc01cedbf2` | 2026-08-27T14:45:13.352Z |
| `octane-mts-program-d3control-profile` | `app/dist-mtsprogram-d3control-rows30000-profile/main.web.bundle` | 534811 | `98477facf48ecb50` | 2026-08-27T14:44:24.592Z |

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

| main-thread script | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| stage instrument | 69.9 [65.8–80.4] | 74.8 [62.3–79.7] |
| renderer pre-passes | 74.3 [62.6–80] | 71.3 [64.7–81.1] |
| program mount | 55.7 [49.1–56.9] | 63.1 [54.4–66.6] |
| event bookkeeping | 11.7 [10–13.8] | 47.3 [46.2–54.5] |
| applier entry and pre-walk | 34.6 [33.7–39.7] | 35.8 [35.2–38.3] |
| applier walk | 23.2 [22–25.6] | 26.5 [22.7–30.4] |
| papi facade | 23.4 [20.4–25.8] | 23.2 [17.9–24.9] |
| compiled program create | 18.3 [14.7–19.5] | 16.4 [12.6–18.6] |
| first-screen entry | 8.9 [6.6–10.3] | 8.4 [7.7–10.1] |
| first tree capture | 0.9 [0.6–2.8] | 0.9 [0.7–1.2] |
| named total | 320.3 [300.8–340.1] | 369.7 [336.2–394.2] |
| unnamed by the probe table | 52.8 [51.4–57] | 55.4 [49.5–61.5] |
| **main-thread script, all frames** | 371.7 [355.3–397.1] | 425.1 [386.4–452.5] |

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

| adoption window | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| batch preparation | 405.1 [393.2–439.4] | 374.2 [349.6–402.2] |
| inbound validation | 315.1 [299–324.2] | 297.7 [288.1–317.5] |
| handle delta | 138 [124.1–144] | 132.2 [124.4–135.4] |
| host record building | 137.9 [109.3–145.1] | 122.5 [111.9–129.3] |
| adoption apply | 107.6 [98.7–137.8] | 97.6 [96.4–103.1] |
| first-tree comparator | 34.9 [29.4–44.5] | 66.2 [65.4–69.2] |
| event bookkeeping | 47.6 [38.4–53.3] | 38.6 [37.6–47.2] |
| main-thread receive | 39.5 [37–51.1] | 40.5 [35.6–41.1] |
| deferred event journal | 19.1 [18.8–27.8] | — |
| hand-over | 17.9 [15.9–18.8] | 17.6 [15–21.3] |
| program index | 11.8 [11.2–15.2] | 10.6 [9–13] |
| papi facade | 3.1 [2.7–8.6] | 3 [1.9–3.9] |
| program mount | 0.6 [0–1.2] | 0.4 [0.2–0.7] |
| named total | 1276.9 [1249.7–1352.7] | 1215.7 [1158.9–1230.7] |
| unnamed by the probe table | 255.5 [211.5–274.7] | 231.8 [224.6–246.5] |
| **main-thread script, all frames** | 1543.7 [1470–1627.3] | 1461.4 [1389.1–1462.5] |

The framework’s own walls for the same three stages, which it measures itself
and this instrument only samples. They are the cross-check: a bucket total far
from its wall is a probe that stopped matching, not a stage that got cheaper.

| framework wall | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `prepareLynxHostBatch` | 987.7 [869.6–1035.6] | 912.7 [902.1–1574] |
| `prepared.apply()` | 378.9 [369.4–1026.2] | 347.4 [319.4–355] |
| hand-over | 0.1 [0–0.2] | 0 [0–0.1] |
| paint → settled | 5208.2 [5025.3–5351] | 5277 [4962.6–5970.3] |

- `octane-mts-program-profile`: first tree `adopt`.
- `octane-mts-program-d3control-profile`: first tree `adopt`.

Largest frames the probe table did not name, `octane-mts-program-profile`:

- 103.7 ms at `1:85857` — `e=>{var r;return null!=(r=E.get(e))?r:Q(e)}:e=>{var r,t;if(!_.has(e))return null!=(r=null!=(t=E.get(e))?t:d.records.get(e))?r:Q(e)};var en=z`
- 34.1 ms at `1:86457` — `e=>T.get(e):e=>{var r;return null!=(r=T.get(e))?r:d.generations.get(e)};var eo=(e,r)=>{M&&1===r||T.set(e,r)};var el=e=>{var r,t=[];var n=new`
- 26.4 ms at `1:23119` — `(e){var r=Object.getPrototypeOf(e);return null===r||null===Object.getPrototypeOf(r)}function n(e){return e&&"u">typeof Symbol&&e.constructor`

Largest frames the probe table did not name, `octane-mts-program-d3control-profile`:

- 100.9 ms at `1:84720` — `e=>{var r;return null!=(r=E.get(e))?r:Q(e)}:e=>{var r,t;if(!_.has(e))return null!=(r=null!=(t=E.get(e))?t:d.records.get(e))?r:Q(e)};var en=z`
- 31.5 ms at `1:85320` — `e=>T.get(e):e=>{var r;return null!=(r=T.get(e))?r:d.generations.get(e)};var eo=(e,r)=>{M&&1===r||T.set(e,r)};var el=e=>{var r,t=[];var n=new`
- 29.1 ms at `1:84861` — `e=>{var r;return null!=(r=E.get(e))?r:er(e)}:e=>{if(!_.has(e)){var r=E.get(e);if(void 0!==r){if(null!==P&&r===d.records.get(e)){var t=rl(r);`

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

| source site | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `main-renderer.ts renderComponent` | 2.7 [2.2–3.2] | 2.3 [1.3–6.3] |
| `main-renderer.ts textNode` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.h` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts universalPlan` | 0 [0–0.2] | 0 [0–0] |
| `main-renderer.ts freezePlanNode` | 0 [0–0.2] | 0 [0–0] |
| `main-renderer.ts renderTemplate` | 15.7 [12.1–18.9] | 16.1 [11.8–17.4] |
| `main-renderer.ts recursive prop freeze` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts assignIds` | 5.4 [4.5–9.1] | 6.6 [4.6–7.8] |
| `main-renderer.ts assignProgramIds` | 5.4 [5.3–7.1] | 4.6 [2.4–7.2] |
| `main-renderer.ts collectFirstScreenEvents` | 22.1 [15.9–23.7] | 21.3 [19–24.2] |
| `main-renderer.ts TEMPLATE_ENV.t` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.s` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.a` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts normalizeProps` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts materialize` | 15.2 [13.4–22.5] | 17.6 [11–18.8] |
| `main-renderer.ts prop bag builder` | 5.3 [4–6.7] | 5 [3.4–6.4] |
| **renderer pre-passes, all sites** | 74.3 [62.6–80] | 71.3 [64.7–81.1] |

**program mount**

| source site | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `core/host-driver.ts mountProgram` | 55.4 [48.4–56.4] · 2 frames | 62.9 [53.9–66.2] · 2 frames |
| `core/host-driver.ts mountProgram range members` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts mountProgram event-site lookup` | 0 [0–0] | 0 [0–0] |
| `core/first-screen.ts programRunLastId` | 0.5 [0.2–0.8] | 0.4 [0.2–1] |
| **program mount, all sites** | 55.7 [49.1–56.9] | 63.1 [54.4–66.6] |

**event bookkeeping**

| source site | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `core/host-driver.ts nativeEventMap` | 0 [0–0] | 31.2 [27.7–34.2] |
| `core/native-events.ts encodePrevalidatedLynxNativeEventToken` | 11.7 [10–13.6] | 13.3 [12.1–14.7] |
| `core/host-driver.ts installNativeEvent` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts parseLynxNativeEventProp` | 0 [0–0.2] | 5.1 [3.9–5.8] |
| `core/native-events.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodeCheckedLynxNativeEventToken` | 0 [0–0] | 0 [0–0] |
| **event bookkeeping, all sites** | 11.7 [10–13.8] | 47.3 [46.2–54.5] |

**applier entry and pre-walk**

| source site | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `core/host-driver.ts applyLynxFirstScreenDirect` | 28.9 [28.4–30.7] | 30.9 [27.3–31.9] |
| `core/host-driver.ts firstScreenTreeHasList` | 5.6 [4.9–9] | 6.3 [4.8–7.9] |
| **applier entry and pre-walk, all sites** | 34.6 [33.7–39.7] | 35.8 [35.2–38.3] |

**papi facade**

| source site | `octane-mts-program-profile` | `octane-mts-program-d3control-profile` |
|---|---:|---:|
| `core/papi.ts papi facade methods` | 2.7 [1.9–4] · 2 frames | 1.6 [1.3–2.1] · 2 frames |
| `core/papi.ts createPage` | 20.7 [18.5–21.9] · 2 frames | 21.6 [16.5–22.7] · 2 frames |
| **papi facade, all sites** | 23.4 [20.4–25.8] | 23.2 [17.9–24.9] |

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
  - 1:13531 — `()=>es(e(r,Y()),null))}finally{T.length=i}}var eo=Object.freeze({h:e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:`
- `octane-mts-program-profile` — `main-renderer.ts universalPlan`, 1 frame
  - 1:7964 — `(e,r){return M(e),Object.freeze({$$kind:d,renderer:e,root:function e(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArr`
- `octane-mts-program-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:8032 — `(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a cr`
- `octane-mts-program-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:14881 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:19569 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:19636 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var s=0;var d=r.plan.nodes+n.length;for(var c=0;c<`
- `octane-mts-program-profile` — `main-renderer.ts collectFirstScreenEvents`, 1 frame
  - 1:20528 — `(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibil`
- `octane-mts-program-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:14402 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===$){var t,n,o,s,d,p=es(e.value,X(e.key));return 1!==p.length?[ea(p,X`
- `octane-mts-program-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:11310 — `(e,r=S,t=!1){var n={};for(var a of e){if("spread"===a[0]){(function(e,r,t){if(null!=r){var n=Object(r);for(var a of Reflect.ownKeys(n))Objec`
- `octane-mts-program-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:188373 — `(e,r,t){var n;var a=e[eU];if(a.disposed||a.disposing||a.faulted||a.applying)throw eK("first-screen container is not accepting an initial tre`
- `octane-mts-program-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:188641 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:187821 — `(e,r)=>{if(q)throw Error("Octane Lynx first-screen root rendered after receiver close.");if("open"!==G)throw Error("Octane Lynx first-screen`
- `octane-mts-program-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:24607 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function b(e){if("string"!=typeof e)throw y("must be a string.");var r=f.exec`
- `octane-mts-program-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:23773 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=d.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-profile` — `core/papi.ts papi facade methods`, 2 frames
  - 1:163222 — `(e,r){z(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,I,r)},setDataset(`
  - 1:163383 — `(e,r,t,n){T(e,r,t,n)},setId(e,r){N(e,r)},flush(e,r){R(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-profile` — `core/papi.ts createPage`, 2 frames
  - 1:162644 — `(e){var r=performance.now();try{return s(e)}finally{nv(r)}}}),createPage(e,r){var t=performance.now();try{return n(e,r)}finally{nv(t)}},crea`
  - 1:162716 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nv(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-profile` — `emitted main-thread program create`, 5 frames
  - 1:4103 — `()=>s,o3:()=>i,o7:()=>g,qO:()=>a,vu:()=>c,w7:()=>d,wA:()=>h})},402(e,r,t){function n(){var e;var r=globalThis;return null!=(e=r.__OCTANE_LYN`
  - 1:4187 — `(){var e;var r=globalThis;return null!=(e=r.__OCTANE_LYNX_PROF)?e:r.__OCTANE_LYNX_PROF={commits:0,commands:0,emptyCommits:0,bytes:0,selfchec`
  - 1:49501 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw eK(`${r} must be a positive safe integer.`)}function eX(e,r){if("string"!=typeof e||0===e.leng`
  - 1:230882 — `(r,o,l,s,d,c){var u,p,v=t(r);var f="string"==typeof o?o:"number"==typeof o&&o?String(o):"";""!==f&&e.setClasses(v,f);var h=n(r);e.setClasses`
  - 1:232531 — `(r,o,l,s,d,c,u,p,v,f,h,y,m,g){var b=t(r);e.setClasses(b,"page");var w=n(r);e.setClasses(w,"title");var O=a("Octane UI Benchmark on Lynx · re`
- `octane-mts-program-profile` — `core/host-driver.ts mountProgram`, 2 frames
  - 1:191467 — `(r,n,i,l,s)=>{var d,c,u,p=function(r){var n,a,i=f[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, whi`
  - 1:191501 — `(r){var n,a,i=f[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, which it did not number.`);var l=void`
- `octane-mts-program-profile` — `core/first-screen.ts programRunLastId`, 1 frame
  - 1:1516 — `(e){var r=e.ids[e.ids.length-1];for(var t=e.rangeIds.length-1;t>=0;t--){var n=e.rangeIds[t];if(void 0!==n)return n>r?n:r}return r}function d`
- `octane-mts-program-profile` — `core/host-driver.ts visit and pushChildren`, 2 frames
  - 1:191002 — `(e,r,t,n,a,i)=>{for(var o=e.children.length-1;o>=0;o--)$.push({node:e.children[o],papiNode:null,listRecord:null,parentRecord:r,parentId:t,ph`
  - 1:191209 — `r=>{var{node:n,parentRecord:i,parentId:l,physicalParent:s,parentVisible:d,insideList:c}=r;if(null===n){var u=r.listRecord;if(null!==u)return`
- `octane-mts-program-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:154789 — `(e){var r;var t=(0,nu.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nf=new Set;function nh(){throw Error("Octa`
- `octane-mts-program-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:197244 — `(e,r={}){var t,n=e[eU];if(n.disposed||n.disposing||n.faulted||n.applying)throw eK("first tree can only be captured from a stable accepted ro`
- `octane-mts-program-d3control-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:153238 — `(e){var r;var t=(0,ns.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nu=new Set;function np(){throw Error("Octa`
- `octane-mts-program-d3control-profile` — `main-renderer.ts renderComponent`, 1 frame
  - 1:12954 — `()=>es(e(r,Y()),null))}finally{T.length=i}}var eo=Object.freeze({h:e=>({kind:"host",key:null,id:0,type:e,props:{},events:new Map,visibility:`
- `octane-mts-program-d3control-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:14304 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-d3control-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:18992 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-d3control-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:19059 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var l=0;var s=0;var d=r.plan.nodes+n.length;for(var c=0;c<`
- `octane-mts-program-d3control-profile` — `main-renderer.ts collectFirstScreenEvents`, 1 frame
  - 1:19951 — `(r,t,n,a){var i=0;for(var o of r){if("program"===o.kind){for(var l of(i+=o.plan.nodes,o.texts))void 0!==l&&i++;var s=t&&"hidden"!==o.visibil`
- `octane-mts-program-d3control-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:13825 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===$){var t,n,o,s,d,p=es(e.value,X(e.key));return 1!==p.length?[ea(p,X`
- `octane-mts-program-d3control-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:10733 — `(e,r=S,t=!1){var n={};for(var a of e){if("spread"===a[0]){(function(e,r,t){if(null!=r){var n=Object(r);for(var a of Reflect.ownKeys(n))Objec`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:186837 — `(e,r,t){var n;var a=e[eU];if(a.disposed||a.disposing||a.faulted||a.applying)throw eK("first-screen container is not accepting an initial tre`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:187105 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-d3control-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:186285 — `(e,r)=>{if(F)throw Error("Octane Lynx first-screen root rendered after receiver close.");if("open"!==Y)throw Error("Octane Lynx first-screen`
- `octane-mts-program-d3control-profile` — `core/papi.ts papi facade methods`, 2 frames
  - 1:161671 — `(e,r){z(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,I,r)},setDataset(`
  - 1:161832 — `(e,r,t,n){T(e,r,t,n)},setId(e,r){N(e,r)},flush(e,r){R(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-d3control-profile` — `core/papi.ts createPage`, 2 frames
  - 1:161093 — `(e){var r=performance.now();try{return s(e)}finally{nc(r)}}}),createPage(e,r){var t=performance.now();try{return n(e,r)}finally{nc(t)}},crea`
  - 1:161165 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nc(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts nativeEventMap`, 1 frame
  - 1:62705 — `(e,r){var t=e.nativeEvents.get(r);return void 0===t&&(t=new Map,e.nativeEvents.set(r,t)),t}function rk(e){if(void 0===e.worklets)throw eK("m`
- `octane-mts-program-d3control-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:24030 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function b(e){if("string"!=typeof e)throw y("must be a string.");var r=f.exec`
- `octane-mts-program-d3control-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:23196 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=d.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts mountProgram`, 2 frames
  - 1:189931 — `(r,n,i,l,s)=>{var d,c,u,v=function(r){var n,a,i=h[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, whi`
  - 1:189965 — `(r){var n,a,i=h[r.node];if(void 0===i)throw eK(`first-screen program binds an event on node ${r.node}, which it did not number.`);var l=void`
- `octane-mts-program-d3control-profile` — `core/first-screen.ts programRunLastId`, 1 frame
  - 1:1516 — `(e){var r=e.ids[e.ids.length-1];for(var t=e.rangeIds.length-1;t>=0;t--){var n=e.rangeIds[t];if(void 0!==n)return n>r?n:r}return r}function d`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts visit and pushChildren`, 2 frames
  - 1:189466 — `(e,r,t,n,a,i)=>{for(var o=e.children.length-1;o>=0;o--)j.push({node:e.children[o],papiNode:null,listRecord:null,parentRecord:r,parentId:t,ph`
  - 1:189673 — `r=>{var{node:n,parentRecord:i,parentId:l,physicalParent:s,parentVisible:d,insideList:c}=r;if(null===n){var u=r.listRecord;if(null!==u)return`
- `octane-mts-program-d3control-profile` — `emitted main-thread program create`, 5 frames
  - 1:3544 — `()=>s,o3:()=>i,o7:()=>f,qO:()=>a,wA:()=>u})},402(e,r,t){function n(){var e;var r=globalThis;return null!=(e=r.__OCTANE_LYNX_PROF)?e:r.__OCTA`
  - 1:4336 — `()=>n})},867(e,r,t){var n=t(690);var a=Promise.resolve();var i=Object.freeze({renderer:"lynx",ready:a,render(e,r){if("function"!=typeof e)th`
  - 1:48924 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw eK(`${r} must be a positive safe integer.`)}function eX(e,r){if("string"!=typeof e||0===e.leng`
  - 1:229594 — `(r,o,l,s,d,c){var u,p,v=t(r);var f="string"==typeof o?o:"number"==typeof o&&o?String(o):"";""!==f&&e.setClasses(v,f);var h=n(r);e.setClasses`
  - 1:231243 — `(r,o,l,s,d,c,u,p,v,f,h,y,m,g){var b=t(r);e.setClasses(b,"page");var w=n(r);e.setClasses(w,"title");var O=a("Octane UI Benchmark on Lynx · re`
- `octane-mts-program-d3control-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:195950 — `(e,r={}){var t,n=e[eU];if(n.disposed||n.disposing||n.faulted||n.applying)throw eK("first tree can only be captured from a stable accepted ro`

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-profile`
  - 21.7 ms at 1:162577 — `(e){var r=performance.now();try{return l(e)}finally{nv(r)}},rawText(e){var r=performance.now();try{return s(e)}finally{nv(r)}}}),createPage(`
  - 9.6 ms at 1:162513 — `(e){var r=performance.now();try{return i(e)}finally{nv(r)}},text(e){var r=performance.now();try{return l(e)}finally{nv(r)}},rawText(e){var r`
  - 4.6 ms at 1:236820 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`
- `octane-mts-program-d3control-profile`
  - 20 ms at 1:161026 — `(e){var r=performance.now();try{return l(e)}finally{nc(r)}},rawText(e){var r=performance.now();try{return s(e)}finally{nc(r)}}}),createPage(`
  - 7.4 ms at 1:160962 — `(e){var r=performance.now();try{return i(e)}finally{nc(r)}},text(e){var r=performance.now();try{return l(e)}finally{nc(r)}},rawText(e){var r`
  - 6.4 ms at 1:235532 — `(e,t)=>(0,r.Zz)(z,[(0,r.DT)("lynx",R,(0,r.uc)([["set","row",e],["set","isSelected",n===e.id],["set","onSelect",A],["set","onRemove",C]]))]))`

