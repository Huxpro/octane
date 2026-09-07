# Main-thread script attribution — Octane (main-thread program, `ownership-web-control-6993` arm, profile build) vs Octane (main-thread program, `ownership-web-candidate-6993` arm, profile build)

- measured: 2026-09-07T14:46:11.404Z
- host: 32× Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz; linux 5.15.120.bsk.3-amd64; Node v22.22.2
- 1000 rows, 5 profiled first screens per cell, 100 µs sampling interval
- one-minute load 0.68 → 0.87

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
| `octane-mts-program-ownership-web-control-6993-profile` | `app/dist-mtsprogram-ownership-web-control-6993-rows1000-profile/main.web.bundle` | 614416 | `5a4cf354b7cd7877` | 2026-09-07T14:45:42.058Z |
| `octane-mts-program-ownership-web-candidate-6993-profile` | `app/dist-mtsprogram-ownership-web-candidate-6993-rows1000-profile/main.web.bundle` | 614873 | `30587c4f5d34d553` | 2026-09-07T14:45:25.670Z |

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

| main-thread script | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| renderer pre-passes | 2.7 [2.4–3.3] | 2.9 [2.5–3.3] |
| batch preparation | 2.2 [2.1–2.9] | 2.5 [2.2–3.1] |
| applier entry and pre-walk | 1.4 [1.3–1.6] | 1.6 [1.1–1.7] |
| stage instrument | 1.3 [0.8–1.6] | 1.6 [1–1.8] |
| inbound validation | 0.8 [0.6–1] | 0.8 [0.6–1.1] |
| program mount | 0.5 [0.3–1] | 0.6 [0.2–1] |
| papi facade | 0.5 [0.3–0.8] | 0.6 [0.3–1] |
| main-thread receive | 0.5 [0.5–0.6] | 0.2 [0–0.6] |
| first-screen entry | 0.5 [0.3–0.6] | 0.5 [0.3–0.9] |
| event bookkeeping | 0.3 [0.2–0.6] | 0.3 [0.3–0.5] |
| compiled program create | 0.3 [0–0.6] | 0.3 [0.2–0.5] |
| host record building | 0.3 [0–0.5] | 0.2 [0–0.3] |
| applier walk | 0.3 [0–0.5] | 0.2 [0.2–0.6] |
| program index | 0.2 [0–0.3] | — |
| hand-over | 0.2 [0.2–0.3] | 0.2 [0.2–0.3] |
| first-tree comparator | 0.2 [0–0.2] | 0.2 [0–0.2] |
| first tree capture | 0 [0–0.2] | 0 [0–0.2] |
| named total | 12.3 [11.4–13.4] | 12.5 [11.7–13.7] |
| unnamed by the probe table | 25.8 [24.9–27.5] | 14 [13.2–15.3] |
| unnamed share | 67.4% [67.1%–68.7%] | 52.2% [50%–56.7%] |
| **main-thread script, all frames** | 38.3 [36.4–40.9] | 27 [25.6–27.4] |

## The adoption window @1000

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

| adoption window | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| named total | 0 [0–0] | 0 [0–0] |
| unnamed by the probe table | 0 [0–0] | 0 [0–0] |
| unnamed share | 0% [0%–0%] | 0% [0%–0%] |
| **main-thread script, all frames** | 0 [0–0] | 0 [0–0] |

The framework’s own walls for the same three stages, which it measures itself
and this instrument only samples. They are the cross-check: a bucket total far
from its wall is a probe that stopped matching, not a stage that got cheaper.

| framework wall | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `prepareLynxHostBatch` | 4.7 [4.5–5] | 4.8 [4.6–5] |
| `prepared.apply()` | 12.5 [11.9–12.8] | 0.5 [0.5–0.6] |
| hand-over | 0 [0–0.1] | 0 [0–0.1] |
| program manifest runs | 1 [1–1] | 1 [1–1] |
| program manifest matches | 1 [1–1] | 1 [1–1] |
| background program compactions | 1 [1–1] | 1 [1–1] |
| legacy program-node comparisons | 28 [28–28] | 28 [28–28] |
| paint → settled | 0 [0–0] | 0 [0–0] |

- `octane-mts-program-ownership-web-control-6993-profile`: first tree `adopt`.
- `octane-mts-program-ownership-web-candidate-6993-profile`: first tree `adopt`.

### Inside the buckets that fold several functions

A bucket is a probe table entry, not a function, and 11 of the rows above
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

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `main-renderer.ts renderComponent` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts textNode` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.h` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts universalPlan` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts freezePlanNode` | 0 [0–0.2] | 0 [0–0.2] |
| `main-renderer.ts renderTemplate` | 0.5 [0–0.8] | 0.5 [0.3–0.6] |
| `main-renderer.ts recursive prop freeze` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts assignIds` | 0.6 [0.5–1] | 0.8 [0.6–1] |
| `main-renderer.ts assignProgramIds` | 0.3 [0.2–0.5] | 0.2 [0–0.3] |
| `main-renderer.ts collectFirstScreenEvents` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.t` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.s` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts TEMPLATE_ENV.a` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts normalizeProps` | 0 [0–0] | 0 [0–0] |
| `main-renderer.ts materialize` | 1.3 [1–1.4] | 1.1 [0.8–1.6] |
| `main-renderer.ts prop bag builder` | 0.1 [0–0.3] | 0.2 [0–0.3] |
| **renderer pre-passes, all sites** | 2.7 [2.4–3.3] | 2.9 [2.5–3.3] |

**batch preparation**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts prepareLynxHostBatch` | 1.3 [1.1–1.3] | 1.4 [1.1–1.7] |
| `core/host-driver.ts prepareLynxHostBatch command loop` | 1 [0.8–1.6] | 1.3 [1.1–1.4] |
| `core/host-driver.ts prepareLynxHostBatch adoption replay` | 0 [0–0.2] | 0 [0–0] |
| `core/host-driver.ts prepareLynxHostBatch portal pass` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts assertTextProps` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts nodeFor` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts assertNoCycle` | 0 [0–0] | 0 [0–0] |
| **batch preparation, all sites** | 2.2 [2.1–2.9] | 2.5 [2.2–3.1] |

**applier entry and pre-walk**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts applyLynxFirstScreenDirect` | 1.3 [0.9–1.4] | 1.1 [0.9–1.4] |
| `core/host-driver.ts firstScreenTreeHasList` | 0.3 [0–0.3] | 0.3 [0.2–0.5] |
| **applier entry and pre-walk, all sites** | 1.4 [1.3–1.6] | 1.6 [1.1–1.7] |

**inbound validation**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/protocol.ts assertBatch` | 0 [0–0] | 0 [0–0.2] |
| `core/protocol.ts record and the assertBatch command loop` | 0 [0–0.2] · 2 frames | 0 [0–0.2] |
| `core/protocol.ts exactKeys` | 0.2 [0–0.2] | 0.2 [0–0.3] |
| `core/protocol.ts assertProps` | 0.2 [0–0.2] | 0 [0–0.3] |
| `core/protocol.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| `core/protocol.ts fail` | 0.5 [0.5–0.6] | 0.5 [0.5–0.7] · 2 frames |
| **inbound validation, all sites** | 0.8 [0.6–1] | 0.8 [0.6–1.1] |

**program mount**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts mountProgram` | 0.5 [0.3–1] · 3 frames | 0.6 [0.2–0.8] · 3 frames |
| `core/host-driver.ts mountProgram range members` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts mountProgram event-site lookup` | 0 [0–0] | 0 [0–0] |
| `core/first-screen.ts programRunLastId` | 0 [0–0] | 0 [0–0.2] |
| **program mount, all sites** | 0.5 [0.3–1] | 0.6 [0.2–1] |

**papi facade**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/papi.ts papi facade methods` | 0.3 [0.3–0.6] · 3 frames | 0.6 [0.3–1] · 3 frames |
| `core/papi.ts createPage` | 0.2 [0–0.2] | 0 [0–0] |
| **papi facade, all sites** | 0.5 [0.3–0.8] | 0.6 [0.3–1] |

**event bookkeeping**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts nativeEventMap` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodePrevalidatedLynxNativeEventToken` | 0.2 [0–0.5] | 0.2 [0.1–0.3] |
| `core/host-driver.ts installNativeEvent` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts parseLynxNativeEventProp` | 0.2 [0–0.2] | 0.2 [0.2–0.2] |
| `core/native-events.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| `core/native-events.ts encodeCheckedLynxNativeEventToken` | 0 [0–0] | 0 [0–0] |
| **event bookkeeping, all sites** | 0.3 [0.2–0.6] | 0.3 [0.3–0.5] |

**host record building**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts createHandle` | 0.2 [0–0.3] · 2 frames | 0 [0–0] |
| `core/host-driver.ts cloneProps` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts selector install` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts planLynxHostPropPatch` | 0 [0–0.3] | 0.2 [0–0.3] |
| `core/host-driver.ts textValue` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts emitHostNode` | 0 [0–0] | 0 [0–0] |
| `core/nodes-ref.ts assertPositiveSafeInteger` | 0 [0–0] | 0 [0–0] |
| **host record building, all sites** | 0.3 [0–0.5] | 0.2 [0–0.3] |

**applier walk**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts pushChildren` | 0 [0–0] | 0 [0–0] |
| `core/host-driver.ts visit` | 0.3 [0–0.5] | 0.2 [0.2–0.6] |
| **applier walk, all sites** | 0.3 [0–0.5] | 0.2 [0.2–0.6] |

**program index**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/first-screen.ts programRunNode` | 0 [0–0] | — |
| `core/first-screen.ts LynxDisjointProgramIndex.runFor` | 0.2 [0–0.3] | — |
| **program index, all sites** | 0.2 [0–0.3] | — |

**first-tree comparator**

| source site | `octane-mts-program-ownership-web-control-6993-profile` | `octane-mts-program-ownership-web-candidate-6993-profile` |
|---|---:|---:|
| `core/host-driver.ts compareFirstTree` | 0.2 [0–0.2] | 0.2 [0–0.2] |
| `core/host-driver.ts compareFirstTree node walk` | 0 [0–0] | 0 [0–0] |
| **first-tree comparator, all sites** | 0.2 [0–0.2] | 0.2 [0–0.2] |

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

- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:12313 — `(e,r,t){J(e);var n=function e(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universa`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:20843 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:30628 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:30695 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var s=0;var l=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:20361 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===k){var t,n,a,i,o,u=eh(e.value,er(e.key));return 1!==u.length?[ec(u,`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:16543 — `(e,r=P,t=!1,n=!1){if(n)return{$$kind:g,props:Object.freeze(e),key:null,hasKey:!1,hasChildren:!1};var a={};for(var i of e){if("spread"===i[0]`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:236115 — `(e,r,t,a){var i;var o=e[eZ];if(o.disposed||o.disposing||o.faulted||o.applying)throw e1("first-screen container is not accepting an initial t`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:236385 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:235465 — `(e,r,t)=>{if(V)throw Error("Octane Lynx first-screen root rendered after receiver close.");if(ev(),"open"!==Q)throw Error("Octane Lynx first`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts mountProgram`, 3 frames
  - 1:240557 — `(r){var n,a,i=f[r];var o=Y[i.node];if(void 0===o)throw e1(`first-screen program binds an event on node ${i.node}, which it did not number.`)`
  - 1:242147 — `(r,a,i,s,d)=>{var u,c,p,v=function(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, whi`
  - 1:242181 — `(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, which it did not number.`);var o=void`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:37138 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function w(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:36304 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=u.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/papi.ts papi facade methods`, 3 frames
  - 1:202912 — `(e,r){S(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){R(e,r,t)},setRefSelector(e,r){R(e,z,r)},setDataset(`
  - 1:202993 — `(e,r,t){R(e,r,t)},setRefSelector(e,r){R(e,z,r)},setDataset(e,r){T(e,r)},setEvent(e,r,t,n){A(e,r,t,n)},setId(e,r){L(e,r)},flush(e,r){N(e,r)}}`
  - 1:203073 — `(e,r,t,n){A(e,r,t,n)},setId(e,r){L(e,r)},flush(e,r){N(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/papi.ts createPage`, 1 frame
  - 1:202417 — `(e,r){var t=performance.now();try{return n(e,r)}finally{nD(t)}},createElement(e,r,t){var n=performance.now();try{switch(e){case"#text":case"`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts visit`, 1 frame
  - 1:239271 — `r=>{var a=r.denseSpan;if(null!==a)return void((r,n,a,i)=>{var s,d=r.plan;var u=r.count;var c=r.programs;var p=r.firstId;var v=r.stride;var f`
- `octane-mts-program-ownership-web-control-6993-profile` — `emitted main-thread program create`, 3 frames
  - 1:62929 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw e1(`${r} must be a positive safe integer.`)}function e7(e,r){if("string"!=typeof e||0===e.leng`
  - 1:246150 — `(e,r,t){var a;var i=t-r;if(i<2)return null;var o=e[r];if(void 0===o)return null;var s=tg(o);if(void 0===s)return null;var l=s.plan;if(void 0`
  - 1:285580 — `(r,i,o,s,l,d,u,c,p,v,f,h,y,m){var g=t(r);e.setClasses(g,"page");var b=n(r);e.setAttribute(b,"text","Octane UI Benchmark on Lynx · ready"),e.`
- `octane-mts-program-ownership-web-control-6993-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:193628 — `(e){var r;var t=(0,eG.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nJ=new Set;function nV(){throw Error("Octa`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/protocol.ts record and the assertBatch command loop`, 2 frames
  - 1:264811 — `(e,r,t){var n=function(e,r){if(null===e||"object"!=typeof e||Array.isArray(e))return tY(t9,"must be an object.",r);var t=Object.keys(e);var `
  - 1:264833 — `(e,r){if(null===e||"object"!=typeof e||Array.isArray(e))return tY(t9,"must be an object.",r);var t=Object.keys(e);var n=t.length===t6.length`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/protocol.ts exactKeys`, 1 frame
  - 1:175508 — `(e,r,t,n){var a=0;for(var i of r)Object.prototype.hasOwnProperty.call(e,i)?a++:tY(t,`is missing field ${JSON.stringify(i)}.`,n);if(Object.ke`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/protocol.ts assertProps`, 1 frame
  - 1:177549 — `(e,r,t,n,a){if(!((null==a?void 0:a.validatedStaticProps)!==void 0&&null!==e&&"object"==typeof e&&a.validatedStaticProps.has(e))){var i,o=tG(`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/protocol.ts fail`, 1 frame
  - 1:173735 — `(e){if("string"!=typeof e)throw TypeError(`Octane Lynx transport received ${null===e?"null":typeof e} where the wire carries a string. An un`
- `octane-mts-program-ownership-web-control-6993-profile` — `main-thread.ts handleCommitExclusive`, 1 frame
  - 1:250832 — `(e,r)=>{if(W.has(e.root))return void r8(r,Error(`Octane Lynx root ${e.root} was already disposed.`));if(D.delete(tl(r)))return void r8(r,Err`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts prepareLynxHostBatch`, 1 frame
  - 1:103916 — `(e,r,t){var a,i,s,l,d;var u=e[eZ];if(u.disposed)throw e1("cannot prepare a batch for a disposed root.");if(u.disposing)throw e1("cannot prep`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts prepareLynxHostBatch command loop`, 1 frame
  - 1:115485 — `(a){var i=r.commands[a];if(null===i||"object"!=typeof i)throw e1(`command ${a} must be an object.`);if(Q&&"mount-template-range"!==i.op&&"mo`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts prepareLynxHostBatch adoption replay`, 1 frame
  - 1:159337 — `e=>"ensure-public-instance"===e.op):eP)(function(r){if(eo&&o.has(r.id))return"continue";if(null!==el&&("update"===r.op||"recreate"===r.op||"`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/first-screen.ts LynxDisjointProgramIndex.runFor`, 1 frame
  - 1:4174 — `(e){var r=this.runs;if(0!==r.length){var t=this.cursor;if(e>=r[t].firstId&&e<=this.cursorLastId)return r[t];if(t+1<r.length){var n=r[t+1];if`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/native-events.ts decodeLynxNativeEventToken`, 1 frame
  - 1:37211 — `(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec(e);if(null===r)throw m("is malformed.");var t={root:Number(r[1]),id:Numb`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:230690 — `(e,r={}){var t,n=e[eZ];if(n.disposed||n.disposing||n.faulted||n.applying)throw e1("first tree can only be captured from a stable accepted ro`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts createHandle`, 2 frames
  - 1:79569 — `(e){return e.children===e5&&(e.children=[]),e.children}function rg(e,r,t,n){return Object.freeze({$$kind:"octane.lynx.element",renderer:eV,r`
  - 1:79635 — `(e,r,t,n){return Object.freeze({$$kind:"octane.lynx.element",renderer:eV,root:e,id:r,type:t,generation:n,selector:(E(e,"selector root"),E(r,`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts planLynxHostPropPatch`, 1 frame
  - 1:54985 — `(e,r,t,n){var a,i,o,s,l,d,u,c,p=null===t?Object.keys(r):t.names;var v=Object.keys(n);if(("view"===e||"text"===e)&&0===p.length&&(0===v.lengt`
- `octane-mts-program-ownership-web-control-6993-profile` — `core/host-driver.ts compareFirstTree`, 1 frame
  - 1:147114 — `(e,r,t,n,a,i,o,s,l,d){var u=t.snapshot;var c=e[eZ];var p=n[eZ];if(1!==u.format||u.renderer!==eV)return tc(t,"snapshot.format","the snapshot `
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts freezePlanNode`, 1 frame
  - 1:12342 — `(r){if("template"===r.kind){if("function"!=typeof r.create||!Array.isArray(r.slots))throw TypeError("A universal template plan requires a cr`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts renderTemplate`, 1 frame
  - 1:20843 — `(r,t){if("template"===r.kind){var n;return function e(r){for(var t of("host"!==r.kind||Object.isFrozen(r.props)||Object.freeze(r.props),r.ch`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts assignIds`, 1 frame
  - 1:30628 — `(r,t){for(var n of r){if("program"===n.kind){n.id=t.nextId,function(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length)`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts assignProgramIds`, 1 frame
  - 1:30695 — `(r,t){var n=r.plan.ranges;var a=Array(r.plan.nodes);var i=Array(n.length);var o=0;var s=0;var l=0;var d=r.plan.nodes+n.length;for(var u=0;u<`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts materialize`, 1 frame
  - 1:20361 — `(e,r){if(null==e||!1===e||!0===e)return[];if((null==e?void 0:e.$$kind)===k){var t,n,a,i,o,u=eh(e.value,er(e.key));return 1!==u.length?[ec(u,`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-renderer.ts prop bag builder`, 1 frame
  - 1:16543 — `(e,r=P,t=!1,n=!1){if(n)return{$$kind:g,props:Object.freeze(e),key:null,hasKey:!1,hasChildren:!1};var a={};for(var i of e){if("spread"===i[0]`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts applyLynxFirstScreenDirect`, 1 frame
  - 1:236572 — `(e,r,t,a){var i;var o=e[eZ];if(o.disposed||o.disposing||o.faulted||o.applying)throw e1("first-screen container is not accepting an initial t`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts firstScreenTreeHasList`, 1 frame
  - 1:236842 — `(e){var r=[e];for(;0!==r.length;)for(var t of r.pop()){if("host"===t.kind&&("list"===t.type||"list-item"===t.type))return!0;0!==t.children.l`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-thread.ts renderFirstScreenNow`, 1 frame
  - 1:235922 — `(e,r,t)=>{if(V)throw Error("Octane Lynx first-screen root rendered after receiver close.");if(ev(),"open"!==Q)throw Error("Octane Lynx first`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts mountProgram`, 3 frames
  - 1:241014 — `(r){var n,a,i=f[r];var o=Y[i.node];if(void 0===o)throw e1(`first-screen program binds an event on node ${i.node}, which it did not number.`)`
  - 1:242604 — `(r,a,i,s,d)=>{var u,c,p,v=function(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, whi`
  - 1:242638 — `(r){var n,a,i=h[r.node];if(void 0===i)throw e1(`first-screen program binds an event on node ${r.node}, which it did not number.`);var o=void`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/first-screen.ts programRunLastId`, 1 frame
  - 1:2506 — `(e){if(1!==e.count)return e.firstId+(e.count-1)*e.stride+u(e.plan)-1;var r=e.ids[e.ids.length-1];for(var t=e.rangeIds.length-1;t>=0;t--){var`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/native-events.ts encodePrevalidatedLynxNativeEventToken`, 1 frame
  - 1:37138 — `(e,r,t,n,a){return`octane-lynx:event:${e}:${r}:${t}:${n}:${a}`}function w(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/native-events.ts parseLynxNativeEventProp`, 1 frame
  - 1:36304 — `(e){if("string"!=typeof e)return null;var r=e.charCodeAt(0);if(98!==r&&99!==r&&103!==r)return null;var t=u.get(e);if(void 0!==t)return t;var`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/papi.ts papi facade methods`, 3 frames
  - 1:203369 — `(e,r){S(e,r)},setInlineStyles(e,r){E(e,r)},setCssId(e,r,t){P(e,r,t)},setAttribute(e,r,t){R(e,r,t)},setRefSelector(e,r){R(e,z,r)},setDataset(`
  - 1:203450 — `(e,r,t){R(e,r,t)},setRefSelector(e,r){R(e,z,r)},setDataset(e,r){T(e,r)},setEvent(e,r,t,n){L(e,r,t,n)},setId(e,r){A(e,r)},flush(e,r){N(e,r)}}`
  - 1:203530 — `(e,r,t,n){L(e,r,t,n)},setId(e,r){A(e,r)},flush(e,r){N(e,r)}},Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropert`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `emitted main-thread program create`, 3 frames
  - 1:62929 — `(e,r){if(!Number.isSafeInteger(e)||e<=0)throw e1(`${r} must be a positive safe integer.`)}function e7(e,r){if("string"!=typeof e||0===e.leng`
  - 1:246607 — `(e,r,t){var a;var i=t-r;if(i<2)return null;var o=e[r];if(void 0===o)return null;var s=tg(o);if(void 0===s)return null;var l=s.plan;if(void 0`
  - 1:286037 — `(r,i,o,s,l,d,u,c,p,v,f,h,y,m){var g=t(r);e.setClasses(g,"page");var b=n(r);e.setAttribute(b,"text","Octane UI Benchmark on Lynx · ready"),e.`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts visit`, 1 frame
  - 1:239728 — `r=>{var a=r.denseSpan;if(null!==a)return void((r,n,a,i)=>{var s,d=r.plan;var u=r.count;var c=r.programs;var p=r.firstId;var v=r.stride;var f`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `stages/instrument-source.mjs profilePapiCreate`, 1 frame
  - 1:194085 — `(e){var r;var t=(0,eG.Ym)();t.papiCreateMs=(null!=(r=t.papiCreateMs)?r:0)+performance.now()-e}var nJ=new Set;function nV(){throw Error("Octa`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/protocol.ts assertBatch`, 1 frame
  - 1:263050 — `(e,r,t,n){var a=tG(e,"commit.batch");var i=Object.prototype.hasOwnProperty.call(a,"programs");if(tK(a,i?["renderer","version","commands","pr`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/protocol.ts record and the assertBatch command loop`, 1 frame
  - 1:265290 — `(e,r){if(null===e||"object"!=typeof e||Array.isArray(e))return tY(t9,"must be an object.",r);var t=Object.keys(e);var n=t.length===t6.length`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/protocol.ts exactKeys`, 1 frame
  - 1:175965 — `(e,r,t,n){var a=0;for(var i of r)Object.prototype.hasOwnProperty.call(e,i)?a++:tY(t,`is missing field ${JSON.stringify(i)}.`,n);if(Object.ke`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/protocol.ts assertProps`, 1 frame
  - 1:178006 — `(e,r,t,n,a){if(!((null==a?void 0:a.validatedStaticProps)!==void 0&&null!==e&&"object"==typeof e&&a.validatedStaticProps.has(e))){var i,o=tG(`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/protocol.ts fail`, 2 frames
  - 1:174192 — `(e){if("string"!=typeof e)throw TypeError(`Octane Lynx transport received ${null===e?"null":typeof e} where the wire carries a string. An un`
  - 1:259844 — `(e,r){if("string"!=typeof e||!e.startsWith(tE)){if(null!==r.sequence)throw tP(r),TypeError("Octane Lynx transport received an interrupted fr`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `main-thread.ts handleCommitExclusive`, 1 frame
  - 1:251289 — `(e,r)=>{if(W.has(e.root))return void r8(r,Error(`Octane Lynx root ${e.root} was already disposed.`));if(D.delete(tl(r)))return void r8(r,Err`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts prepareLynxHostBatch`, 1 frame
  - 1:104373 — `(e,r,t){var a,i,s,l,d;var u=e[eZ];if(u.disposed)throw e1("cannot prepare a batch for a disposed root.");if(u.disposing)throw e1("cannot prep`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts prepareLynxHostBatch command loop`, 1 frame
  - 1:115942 — `(a){var i=r.commands[a];if(null===i||"object"!=typeof i)throw e1(`command ${a} must be an object.`);if(Q&&"mount-template-range"!==i.op&&"mo`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/native-events.ts decodeLynxNativeEventToken`, 1 frame
  - 1:37211 — `(e){if("string"!=typeof e)throw m("must be a string.");var r=h.exec(e);if(null===r)throw m("is malformed.");var t={root:Number(r[1]),id:Numb`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts compareFirstTree`, 1 frame
  - 1:147571 — `(e,r,t,n,a,i,o,s,l,d){var u=t.snapshot;var c=e[eZ];var p=n[eZ];if(1!==u.format||u.renderer!==eV)return tc(t,"snapshot.format","the snapshot `
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts planLynxHostPropPatch`, 1 frame
  - 1:54985 — `(e,r,t,n){var a,i,o,s,l,d,u,c,p=null===t?Object.keys(r):t.names;var v=Object.keys(n);if(("view"===e||"text"===e)&&0===p.length&&(0===v.lengt`
- `octane-mts-program-ownership-web-candidate-6993-profile` — `core/host-driver.ts captureLynxFirstTree`, 1 frame
  - 1:231147 — `(e,r={}){var t,n=e[eZ];if(n.disposed||n.disposing||n.faulted||n.applying)throw e1("first tree can only be captured from a stable accepted ro`

### The largest frames the probe table did not name

Reported rather than folded away: an unnamed frame is either a function worth a
probe or a bucket whose probe stopped matching, and both are visible here. The
prototype cell is the exception by construction: it runs no Octane code, so no
probe can name it and its whole script is unnamed.

- `octane-mts-program-ownership-web-control-6993-profile`
  - 3 ms at 1:61654 — `(e,r,t){return r in e?Object.defineProperty(e,r,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[r]=t,e}function eX(e){for(var r=1;r<a`
  - 2 ms at 1:153714 — `(t){if("aborted"!==tZ&&"applied"!==tZ){if("faulted"===tZ)throw d;if("prepared"===tZ){if(u.disposed||u.disposing)throw e1("cannot apply a bat`
  - 2 ms at 1:156615 — `(e,r,t,n,a){var i,o,s=e[eZ];var l=t[eZ];var d=r[S.GI];var u=(0,S.wA)(r);var c=null;if(!eG.W7||null===a||s.records instanceof rl||null!=(i=(0`
- `octane-mts-program-ownership-web-candidate-6993-profile`
  - 1.5 ms at 1:284160 — `(r,i,o,s,l,d){var u=0,c=0,p=0;for(var v=0;v<i;v++){var f=o[u];var h=o[u+1];var y=o[u+2];var m=s[c];var g=s[c+1];var b=t(r);var w="string"==t`
  - 1.1 ms at 1:10110 — `(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};var n=Object.keys(t);"function"==typeof Object.getOwnProper`
  - 1 ms at 1:31587 — `(r,t,n,a,i,o){var s=0;for(var l of r)s+=function r(t,n,a,i,o,s){var l=0;if("program"===t.kind){l+=t.plan.nodes;var d=n&&"hidden"!==t.visibil`
