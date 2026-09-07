# Main-thread script attribution — Octane (main-thread program, `base287compact` arm, profile build) vs Octane (main-thread program, `cand287head` arm, profile build)

- measured: 2026-09-07T12:23:47.026Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2
- 10000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 1.68 → 1.93

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
| `octane-mts-program-base287compact-profile` | `app/dist-mtsprogram-base287compact-rows10000-profile/main.web.bundle` | 596356 | `476971b4e9728b81` | 2026-09-07T10:44:19.542Z |
| `octane-mts-program-cand287head-profile` | `app/dist-mtsprogram-cand287head-rows10000-profile/main.web.bundle` | 608530 | `673fcc563ef3259a` | 2026-09-07T12:21:28.668Z |

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

| main-thread script | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| applier entry and pre-walk | 19.8 [12.3–21.2] | 13.2 [12.6–13.4] |
| stage instrument | 12.9 [10.8–15.1] | 14 [11.2–15.7] |
| renderer pre-passes | 11.5 [9.3–12.3] | 10.3 [8.7–12.6] |
| first-screen entry | 2.7 [2.4–3.6] | 2 [1.7–4] |
| program mount | 2.4 [1.4–2.5] | 2.4 [2.2–3] |
| papi facade | 1.6 [1.6–2.1] | 1.6 [1.4–2.1] |
| applier walk | 1.1 [0.5–1.4] | 1.4 [0.8–1.4] |
| event bookkeeping | 1.3 [0.9–1.4] | 0.5 [0.3–1.1] |
| compiled program create | 1.1 [0.2–1.5] | 0.9 [0.6–1.3] |
| first tree capture | 0 [0–0.2] | 0 [0–0.2] |
| inbound validation | — | 0 [0–0.2] |
| named total | 53.3 [42.7–55.7] | 46.5 [45.6–48.2] |
| unnamed by the probe table | 50.7 [49.8–55.3] | 47.4 [39.2–52.3] |
| unnamed share | 48.7% [47.3%–54.8%] | 50.5% [46.2%–52%] |
| **main-thread script, all frames** | 104 [94.5–107.3] | 93.9 [84.8–100.5] |

## The adoption window @10000

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

| adoption window | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| batch preparation | 69.3 [68.1–85.1] | 47.3 [42.6–49.7] |
| host record building | 65.7 [61.9–70.3] | 6.3 [5.4–6.5] |
| inbound validation | 63.5 [62–70.9] | 6.3 [6.2–6.8] |
| handle delta | 20.7 [20.4–23.2] | 7.1 [6–7.8] |
| adoption apply | 15.2 [14.2–15.4] | 10.4 [8.7–11.3] |
| first-tree comparator | 14.3 [12–15.8] | 0.2 [0–0.3] |
| main-thread receive | 13.9 [12.1–19.1] | 5.8 [4.9–6.2] |
| event bookkeeping | 13 [11.1–17.1] | 0 [0–0.2] |
| hand-over | 7.5 [4.9–12.5] | 0.2 [0–0.3] |
| papi facade | 1.4 [1.1–1.9] | — |
| program index | 0.5 [0.3–1] | 1.1 [0.3–1.1] |
| program mount | 0 [0–0.1] | — |
| named total | 280.9 [278–313.5] | 84.5 [79.5–86.2] |
| unnamed by the probe table | 159.9 [151.8–168.7] | 54.8 [49.9–58.6] |
| unnamed share | 35.4% [35%–36.5%] | 40.6% [37.1%–40.9%] |
| **main-thread script, all frames** | 437.9 [431.4–482.3] | 135 [134.3–143.4] |

The framework’s own walls for the same three stages, which it measures itself
and this instrument only samples. They are the cross-check: a bucket total far
from its wall is a probe that stopped matching, not a stage that got cheaper.

| framework wall | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `prepareLynxHostBatch` | 238.2 [231.6–271.8] | 99.4 [98.6–107.1] |
| `prepared.apply()` | 93.8 [90.6–114.2] | 38 [35.2–41.1] |
| hand-over | 0 [0–0.1] | 0 [0–0.1] |
| program manifest runs | 1 [1–1] | 1 [1–1] |
| program manifest matches | 1 [1–1] | 1 [1–1] |
| background program compactions | — | 1 [1–1] |
| legacy program-node comparisons | — | 28 [28–28] |
| paint → settled | 1047.9 [1026.1–1091.2] | 477.1 [456.7–487.1] |

- `octane-mts-program-base287compact-profile`: first tree `adopt`.
- `octane-mts-program-cand287head-profile`: first tree `adopt`.

Largest frames the probe table did not name, `octane-mts-program-base287compact-profile`:

- 39.8 ms at `1:165238` — `(e,r){var t={escaped:!1,seen:tS?new Map:null,aliases:0};var n=function e(r,t,n,a=0){switch(typeof r){case"string":if(0!==r.charCodeAt(0))ret`
- 35.5 ms at `1:165310` — `(r,t,n,a=0){switch(typeof r){case"string":if(0!==r.charCodeAt(0))return r;return n.escaped=!0,"\0"+r;case"number":if(Number.isFinite(r))retu`
- 16 ms at `1:106082` — `e=>{var r;return null!=(r=N.get(e))?r:ei(e)}:e=>{var r,t;if(!M.has(e))return null!=(r=null!=(t=N.get(e))?t:l.records.get(e))?r:ei(e)};var ed`

Largest frames the probe table did not name, `octane-mts-program-cand287head-profile`:

- 18.6 ms at `1:122665` — `(e){var r={attributes:rt.attributes,mainThreadEvents:rt.mainThreadEvents,requiresRecreate:!1};var t=e.id;null!=t&&(r.id=Object.freeze({value`
- 10.5 ms at `1:106179` — `e=>{var r;return null!=(r=A.get(e))?r:en(e)}:e=>{var r,t;if(!N.has(e))return null!=(r=null!=(t=A.get(e))?t:i.records.get(e))?r:en(e)};var es`
- 4.9 ms at `1:149710` — `(t){if("aborted"!==tG&&"applied"!==tG){if("faulted"===tG)throw a;if("prepared"===tG){if(i.disposed||i.disposing)throw e1("cannot apply a bat`

### Inside the buckets that fold several functions

A bucket is a probe table entry, not a function, and seven of the rows above
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

**applier entry and pre-walk**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/host-driver.ts applyLynxFirstScreenDirect` | 15.6 [8–16.4] | 8.8 [7–9.3] |
| `core/host-driver.ts firstScreenTreeHasList` | 4.5 [4.2–4.8] | 4.3 [4.1–5.6] |
| **applier entry and pre-walk, all sites** | 19.8 [12.3–21.2] | 13.2 [12.6–13.4] |

**renderer pre-passes**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `main-renderer.ts renderComponent` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts textNode` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.h` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts universalPlan` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts freezePlanNode` | 0 [0–0.2] | 0 [0–0.2] |
| `main-renderer.ts renderTemplate` | 3.2 [1.4–3.5] | 2.7 [1.9–4.2] |
| `main-renderer.ts recursive prop freeze` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts assignIds` | 1.9 [1.9–2.1] | 1.9 [1.4–3] |
| `main-renderer.ts assignProgramIds` | 1.3 [0.9–2.3] | 1.3 [0.3–1.6] |
| `main-renderer.ts collectFirstScreenEvents` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.t` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.s` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.a` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts normalizeProps` | 0 [0–0.2] | 0 [0–0] |
| `main-renderer.ts materialize` | 4.1 [3.7–4.7] | 3.3 [2.7–5.2] |
| `main-renderer.ts prop bag builder` | 0.5 [0.3–0.8] | 0.9 [0–1.1] |
| **renderer pre-passes, all sites** | 11.5 [9.3–12.3] | 10.3 [8.7–12.6] |

**program mount**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/host-driver.ts mountProgram` | 2.4 [1.4–2.5] · 2 frames | 2.4 [2.2–3] · 3 frames |
| `core/host-driver.ts mountProgram range members` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts mountProgram event-site lookup` | 0 [0–0] | 0 [0–0] |
| `core/first-screen.ts programRunLastId` | 0 [0–0] | 0 [0–0] |
| **program mount, all sites** | 2.4 [1.4–2.5] | 2.4 [2.2–3] |

**papi facade**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/papi.ts papi facade methods` | 1.6 [1.4–2.1] · 3 frames | 1.4 [1.4–2.1] · 3 frames |
| `core/papi.ts createPage` | 0 [0–0.2] | 0 [0–0.2] |
| **papi facade, all sites** | 1.6 [1.6–2.1] | 1.6 [1.4–2.1] |

**applier walk**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/host-driver.ts pushChildren` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts visit` | 1.1 [0.5–1.4] | 1.4 [0.8–1.4] |
| **applier walk, all sites** | 1.1 [0.5–1.4] | 1.4 [0.8–1.4] |

**event bookkeeping**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/host-driver.ts nativeEventMap` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodePrevalidatedLynxNativeEventToken` | 1.1 [0.8–1.3] | 0.5 [0.3–0.9] |
| `core/host-driver.ts installNativeEvent` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts parseLynxNativeEventProp` | 0.2 [0–0.4] | 0 [0–0.2] |
| `core/native-events.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodeCheckedLynxNativeEventToken` | 0 [0–0] | 0 [0–0] |
| **event bookkeeping, all sites** | 1.3 [0.9–1.4] | 0.5 [0.3–1.1] |

**inbound validation**

| source site | `octane-mts-program-base287compact-profile` | `octane-mts-program-cand287head-profile` |
|---|---:|---:|
| `core/protocol.ts assertBatch` | — | 0 [0–0] |
| `core/protocol.ts record and the assertBatch command loop` | — | 0 [0–0] |
| `core/protocol.ts exactKeys` | — | 0 [0–0] |
| `core/protocol.ts assertProps` | — | 0 [0–0] |
| `core/protocol.ts assertPositiveSafeInteger` | — | 0 [0–0] |
| `core/protocol.ts fail` | — | 0 [0–0.2] |
| **inbound validation, all sites** | — | 0 [0–0.2] |

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

- `octane-mts-program-base287compact-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:12134 — `(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a cr`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:20635 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:30420 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:30487 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var s=0;var l=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts normalizeProps`, 1 frame
  - 1:17010 — `(e){return(null==e?void 0:e.$$kind)===g?e:G(null==e?[]:[["spread",e]])}function K(e,r,t=null,n=L){J(e);var a=Y(t);return{$$kind:m,renderer:e`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:20153 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===k){var t,n,a,i,o,u=eh(e.value,er(e.key));return 1!==u.length?[ec(u,`
- `octane-mts-program-base287compact-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:16335 — `(e,r=P,t=!1,n=!1){if(n)return{$$kind:g,props:Object.freeze(e),key:null,hasKey:!1,hasChildren:!1};var a={};for(var i of e){if("spread"===i[0]`
- `octane-mts-program-base287compact-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:228011 — `(e,r,t,a){var i;var o=e[eZ];if(o.disposed||o.disposing||o.faulted||o.applying)throw e1("first-screen container is not accepting an initial t`
- `octane-mts-program-base287compact-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:228281 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-base287compact-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:227361 — `(e,r,t)=>{if(V)throw Error("Octane Lynx first-screen root rendered after receiver close.");if(ep(),"open"!==Q)throw Error("Octane Lynx first`
- `octane-mts-program-base287compact-profile` — `core/host-driver.ts mountProgram`, 2 frames
  - 1:232453 — `(r){var n,a,i=f[r];var o=G[i.node];if(void 0===o)throw e1(`first-screen program binds an event on node ${i.node}, which it did not number.`)`
  - 1:234043 — `(r,a,i,s,d)=>{var u,c,v,p=function(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, whi`
- `octane-mts-program-base287compact-profile` — `core/host-driver.ts visit`, 1 frame
  - 1:231167 — `r=>{var a=r.denseSpan;if(null!==a)return void((r,n,a,i)=>{var s,d=r.plan;var u=r.count;var c=r.programs;var v=r.firstId;var p=r.stride;var f`
- `octane-mts-program-base287compact-profile` — `core/papi.ts papi facade methods`, 3 frames
  - 1:195504 — `(e,r){S(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,z,r)},setDataset(`
  - 1:195585 — `(e,r,t){L(e,r,t)},setRefSelector(e,r){L(e,z,r)},setDataset(e,r){T(e,r)},setEvent(e,r,t,n){A(e,r,t,n)},setId(e,r){R(e,r)},flush(e,r){_(e,r)}}`
  - 1:195665 — `(e,r,t,n){A(e,r,t,n)},setId(e,r){R(e,r)},flush(e,r){_(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-base287compact-profile` — `core/papi.ts createPage`, 1 frame
  - 1:195009 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nC(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-base287compact-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:186611 — `(e){var r;var t=(0,eY.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nM=new Set;function nq(){throw Error("Octa`
- `octane-mts-program-base287compact-profile` — `emitted main-thread program create`, 3 frames
  - 1:62721 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw e1(`${r} must be a positive safe integer.`)}function e7(e,r){if("string"!=typeof e||0===e.leng`
  - 1:238046 — `(e,r,t){var a;var i=t-r;if(i<2)return null;var o=e[r];if(void 0===o)return null;var s=tm(o);if(void 0===s)return null;var l=s.plan;if(void 0`
  - 1:275478 — `(r,i,o,s,l,d,u,c,v,p,f,h,y,m){var g=t(r);e.setClasses(g,"page");var b=n(r);e.setAttribute(b,"text","Octane UI Benchmark on Lynx · ready"),e.`
- `octane-mts-program-base287compact-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:36930 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function w(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec`
- `octane-mts-program-base287compact-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:36096 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=u.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-base287compact-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:222586 — `(e,r={}){var t,n=e[eZ];if(n.disposed||n.disposing||n.faulted||n.applying)throw e1("first tree can only be captured from a stable accepted ro`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:12238 — `(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a cr`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:20739 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:30524 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:30591 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var s=0;var l=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:20257 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===k){var t,n,a,i,o,u=eh(e.value,er(e.key));return 1!==u.length?[ec(u,`
- `octane-mts-program-cand287head-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:16439 — `(e,r=P,t=!1,n=!1){if(n)return{$$kind:g,props:Object.freeze(e),key:null,hasKey:!1,hasChildren:!1};var a={};for(var i of e){if("spread"===i[0]`
- `octane-mts-program-cand287head-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:230273 — `(e,r,t,a){var i;var o=e[eZ];if(o.disposed||o.disposing||o.faulted||o.applying)throw e1("first-screen container is not accepting an initial t`
- `octane-mts-program-cand287head-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:230543 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-cand287head-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:229623 — `(e,r,t)=>{if(V)throw Error("Octane Lynx first-screen root rendered after receiver close.");if(ep(),"open"!==Q)throw Error("Octane Lynx first`
- `octane-mts-program-cand287head-profile` — `emitted main-thread program create`, 3 frames
  - 1:62825 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw e1(`${r} must be a positive safe integer.`)}function e3(e,r){if("string"!=typeof e||0===e.leng`
  - 1:240308 — `(e,r,t){var a;var i=t-r;if(i<2)return null;var o=e[r];if(void 0===o)return null;var s=tm(o);if(void 0===s)return null;var l=s.plan;if(void 0`
  - 1:279889 — `(r,i,o,s,l,d,u,c,v,p,f,h,y,m){var g=t(r);e.setClasses(g,"page");var b=n(r);e.setAttribute(b,"text","Octane UI Benchmark on Lynx · ready"),e.`
- `octane-mts-program-cand287head-profile` — `core/host-driver.ts mountProgram`, 3 frames
  - 1:234715 — `(r){var n,a,i=f[r];var o=G[i.node];if(void 0===o)throw e1(`first-screen program binds an event on node ${i.node}, which it did not number.`)`
  - 1:236305 — `(r,a,i,s,d)=>{var u,c,v,p=function(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, whi`
  - 1:236339 — `(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, which it did not number.`);var o=void`
- `octane-mts-program-cand287head-profile` — `core/host-driver.ts visit`, 1 frame
  - 1:233429 — `r=>{var a=r.denseSpan;if(null!==a)return void((r,n,a,i)=>{var s,d=r.plan;var u=r.count;var c=r.programs;var v=r.firstId;var p=r.stride;var f`
- `octane-mts-program-cand287head-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:37034 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function w(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec`
- `octane-mts-program-cand287head-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:36200 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=u.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-cand287head-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:188177 — `(e){var r;var t=(0,eY.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nD=new Set;function nJ(){throw Error("Octa`
- `octane-mts-program-cand287head-profile` — `core/papi.ts papi facade methods`, 3 frames
  - 1:197070 — `(e,r){S(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){T(e,r,t)},setRefSelector(e,r){T(e,z,r)},setDataset(`
  - 1:197151 — `(e,r,t){T(e,r,t)},setRefSelector(e,r){T(e,z,r)},setDataset(e,r){L(e,r)},setEvent(e,r,t,n){R(e,r,t,n)},setId(e,r){A(e,r)},flush(e,r){_(e,r)}}`
  - 1:197231 — `(e,r,t,n){R(e,r,t,n)},setId(e,r){A(e,r)},flush(e,r){_(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-cand287head-profile` — `core/papi.ts createPage`, 1 frame
  - 1:196575 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nW(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-cand287head-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:224848 — `(e,r={}){var t,n=e[eZ];if(n.disposed||n.disposing||n.faulted||n.applying)throw e1("first tree can only be captured from a stable accepted ro`
- `octane-mts-program-cand287head-profile` — `core/protocol.ts fail`, 1 frame
  - 1:201751 — `e=>{for(var r of function(e,r){if(e.length<=34e3)return[e];if(!Number.isSafeInteger(r)||r<=0)throw TypeError("Octane Lynx transport frame se`

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-base287compact-profile`
  - 9.2 ms at 1:194870 — `(e){var r=performance.now();try{return s(e)}finally{nC(r)}},rawText(e){var r=performance.now();try{return l(e)}finally{nC(r)}}}),createPage(`
  - 7.5 ms at 1:9902 — `(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};var n=Object.keys(t);"function"==typeof Object.getOwnProper`
  - 5.6 ms at 1:273601 — `(r,i,o,s,l,d){var u=0,c=0,v=0;for(var p=0;p<i;p++){var f=o[u];var h=o[u+1];var y=o[u+2];var m=s[c];var g=s[c+1];var b=t(r);var w="string"==t`
- `octane-mts-program-cand287head-profile`
  - 5.9 ms at 1:196436 — `(e){var r=performance.now();try{return s(e)}finally{nW(r)}},rawText(e){var r=performance.now();try{return l(e)}finally{nW(r)}}}),createPage(`
  - 5.2 ms at 1:31533 — `(t,n,a,i,o,s){var l=0;if("program"===t.kind){l+=t.plan.nodes;var d=n&&"hidden"!==t.visibility;t.eventsAt=s.length;var u=t.plan.ranges;var c=`
  - 3.6 ms at 1:10006 — `(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};var n=Object.keys(t);"function"==typeof Object.getOwnProper`
