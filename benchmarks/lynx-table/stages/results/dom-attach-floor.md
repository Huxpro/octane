# Publication floor — what the platform charges to attach a first screen

- measured: 2026-08-24T04:06:21.470Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37
- host load: start 0.21/0.12/0.33 (1/5/15m), end 1.12/0.42/0.42
- repetitions: n=5 per cell per scale; arms: build, live-incremental, live-bulk, split-incremental, split-bulk; element kinds: inert, upgraded
- protocol: fresh page per sample; cell order rotates across repetitions; no framework, no web-core, and no app bundle is loaded — the page builds the tree itself, and every sample asserts in the page whether its three tags were registered

## What this controls for

#148 W2 resolved publication's share into a swap plus a rate. The swap is exact — a detached first screen pays its insertions inside `papi_flush` where the post-mount path pays the identical insertions inside `papi_topology` — and what survives it is a per-node rate that rises with the tree on the first-screen path while staying flat on the post-mount one. This probe asks whether the browser reproduces that split with no framework in the page.

Nothing measured here belongs to Octane or to web-core. `__AppendElement` is `parent.appendChild(child)` and the first flush publishes with `rootDom.appendChild(page)` on a shadow root, so the arms below are those two calls and nothing else. The tree is built with the tag names, per-row shape, attributes, class names, and scoped stylesheet `createElementAPI.js` produces, so the browser resolves the same styles over the same elements.

Every arm is measured against **both element kinds**, in one window, because the harness page has `x-view`, `x-text`, and `raw-text` registered — `@lynx-js/web-elements` defines all three — so web-core publishes a tree of upgraded custom elements and the insertion runs one reaction per node inside itself. An `inert` cell uses the same tags unregistered; an `upgraded` cell registers them with an empty `connectedCallback`, so the difference is the platform running a reaction and not what web-elements does inside one. Each sample asserts its own registration state in the page, so a cell cannot report a kind it did not run.

| kind | what it measures |
|---|---|
| `inert` | the floor for inserting plain DOM nodes of this shape |
| `upgraded` | the same, plus the platform running one custom-element reaction per node — what web-core actually triggers |

| arm | what it does |
|---|---|
| `build` | every node created and linked within its row, nothing ever attached — the allocation floor every other arm also pays |
| `live-incremental` | rows created and appended one at a time into a container already in the document — the post-mount shape |
| `live-bulk` | rows created and appended one at a time into a detached container, then one `appendChild` publishes the tree — the first-screen shape |
| `split-incremental` | every row built first, then all of them appended into an attached container |
| `split-bulk` | every row built first, then all of them appended into a detached container, then one `appendChild` publishes it |

`frameMs` is the next animation frame with a forced layout read, so style and layout are inside the measurement rather than after it. It is reported beside the command cost and never folded into it: the rate this control has to explain is `papi_topology (+ papi_flush)` self time, which is time inside `appendChild` and contains no style, layout, or paint. The verdict therefore reads command cost, and the reading registered before the run — command plus frame — is printed at the end so the two can be compared.

The two pairs answer the same question at different costs. `live-*` interleaves creation and attachment exactly as the command stream does, so it needs no deviation from what Octane pays and its whole loop is comparable to `papi_topology` — plus `papi_flush` on the bulk side. It cannot separate attachment from creation without a clock read per append, so its rate is the loop plus the frame. `split-*` buys a separable `attachMs` by building first and attaching second, which the command stream never does; it localizes whatever the live pair finds and can never overturn it.

The deciding pair is therefore `upgraded:live-incremental` against `upgraded:live-bulk`, with `upgraded:split-incremental`/`upgraded:split-bulk` reported beside it as corroboration. The upgraded kind decides, because it is the one the harness page holds.

## 1,000 rows — 7,000 nodes

| cell | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `inert:build` | 5.3 | 0 | 7.5 | 12.9 | 0 | 1.07 |
| `inert:live-incremental` | 6.6 | 0 | 24.2 | 30.8 | 0.943 | 3.46 |
| `inert:live-bulk` | 5.7 | 1.1 | 25.4 | 32.4 | 0.971 | 3.63 |
| `inert:split-incremental` | 5.9 | 1.2 | 24.5 | 32.5 | 0.171 | 3.5 |
| `inert:split-bulk` | 6 | 1.3 | 24.7 | 32 | 0.186 | 3.53 |
| `upgraded:build` | 12.7 | 0 | 0.2 | 13.1 | 0 | 0.03 |
| `upgraded:live-incremental` | 16.8 | 0 | 24.4 | 41.8 | 2.4 | 3.49 |
| `upgraded:live-bulk` | 13.5 | 3.8 | 24.3 | 41.5 | 2.471 | 3.47 |
| `upgraded:split-incremental` | 15 | 4.2 | 24.2 | 46.2 | 0.6 | 3.46 |
| `upgraded:split-bulk` | 12.5 | 4.1 | 23.1 | 39.7 | 0.586 | 3.3 |

## 10,000 rows — 70,000 nodes

| cell | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `inert:build` | 50.2 | 0 | 0.3 | 50.5 | 0 | 0 |
| `inert:live-incremental` | 61.3 | 0 | 223.1 | 283.8 | 0.876 | 3.19 |
| `inert:live-bulk` | 50.8 | 10.8 | 226 | 287.4 | 0.88 | 3.23 |
| `inert:split-incremental` | 50.5 | 12.4 | 238.9 | 307.2 | 0.177 | 3.41 |
| `inert:split-bulk` | 51.8 | 13.4 | 229.3 | 294.5 | 0.191 | 3.28 |
| `upgraded:build` | 125.5 | 0 | 0.3 | 125.8 | 0 | 0 |
| `upgraded:live-incremental` | 170.3 | 0 | 246.2 | 419.3 | 2.433 | 3.52 |
| `upgraded:live-bulk` | 126.6 | 45.9 | 229.2 | 401.4 | 2.464 | 3.27 |
| `upgraded:split-incremental` | 127.4 | 39.1 | 232.7 | 401.7 | 0.559 | 3.32 |
| `upgraded:split-bulk` | 120.1 | 47.6 | 226.2 | 394.9 | 0.68 | 3.23 |

## 30,000 rows — 210,000 nodes

| cell | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `inert:build` | 144.2 | 0 | 0.4 | 144.6 | 0 | 0 |
| `inert:live-incremental` | 187.2 | 0 | 773.3 | 957.4 | 0.891 | 3.68 |
| `inert:live-bulk` | 150.9 | 36.9 | 789.1 | 976.9 | 0.894 | 3.76 |
| `inert:split-incremental` | 145.5 | 41.9 | 798.5 | 995.3 | 0.2 | 3.8 |
| `inert:split-bulk` | 151.8 | 44.9 | 780.8 | 982.5 | 0.214 | 3.72 |
| `upgraded:build` | 374.6 | 0 | 0.4 | 374.9 | 0 | 0 |
| `upgraded:live-incremental` | 502.8 | 0 | 690.8 | 1191.4 | 2.394 | 3.29 |
| `upgraded:live-bulk` | 376.3 | 138.6 | 700.3 | 1218.9 | 2.452 | 3.33 |
| `upgraded:split-incremental` | 370.6 | 112.3 | 708.3 | 1198.7 | 0.535 | 3.37 |
| `upgraded:split-bulk` | 370.8 | 149.2 | 697.6 | 1231 | 0.71 | 3.32 |

## Does the platform reproduce the split?

Command cost per node — what the stream pays inside the calls it makes, with the frame held out. `build` is omitted: it attaches nothing, so it has no command rate to compare.

| cell | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node | drift | trend | flat |
|---|---:|---:|---:|---:|---:|---|
| `inert:live-incremental` | 0.943 | 0.876 | 0.891 | 7.7% | -5.5% | yes |
| `inert:live-bulk` | 0.971 | 0.88 | 0.894 | 10.4% | -7.9% | no |
| `inert:split-incremental` | 0.171 | 0.177 | 0.2 | 16.4% | +16.4% | no |
| `inert:split-bulk` | 0.186 | 0.191 | 0.214 | 15.1% | +15.1% | no |
| `upgraded:live-incremental` | 2.4 | 2.433 | 2.394 | 1.6% | -0.2% | yes |
| `upgraded:live-bulk` | 2.471 | 2.464 | 2.452 | 0.8% | -0.8% | yes |
| `upgraded:split-incremental` | 0.6 | 0.559 | 0.535 | 12.2% | -10.9% | no |
| `upgraded:split-bulk` | 0.586 | 0.68 | 0.71 | 21.3% | +21.3% | no |

| pair | 1,000 bulk ÷ incremental | 10,000 bulk ÷ incremental | 30,000 bulk ÷ incremental | gap opens |
|---|---:|---:|---:|---|
| deciding (`upgraded:live-*`) | 1.03× | 1.013× | 1.024× | no |
| localizing (`upgraded:split-*`) | 0.976× | 1.217× | 1.329× | yes |

**Prediction refuted (deciding pair).** The prediction needs `upgraded:live-incremental` flat and `upgraded:live-bulk` rising. Incremental is flat, at 1.6% drift. Bulk does not rise: its trend across the range is -0.8%, against a 10% gate, on a 0.8% drift. The two arms never separate: the widest gap between them is 1.03×.

**Prediction refuted (localizing pair).** The prediction needs `upgraded:split-incremental` flat and `upgraded:split-bulk` rising. Incremental is not flat: it drifts 12.2%, outside the 10% gate. Bulk does rise, by 21.3% across the range. Both arms rise together, which is a cost that grows with the tree on either shape — not a cost the detached shape pays and the attached one does not. The widest gap between them is 1.329×.

Both pairs land the same way, so the deviation the localizing pair carries changes nothing about the answer.

Publication's rise is not the platform's, so it belongs to web-core or to Octane with a named owner. W2 stays open.

### The single publishing call

`live-bulk`'s attach span is one call — every row is appended inside its build loop, into a detached container, so what is left to time is the `appendChild` that publishes the page. That is the same one call `__FlushElementTree` makes, which makes this the only comparison here free of per-call instrument overhead on both sides: one call against the two `papi_flush` calls a first-screen window makes, where every per-element group is thousands of calls read through an instrument costing 0.5–0.7 µs each.

| kind | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node |
|---|---:|---:|---:|
| `inert` | 0.157 | 0.154 | 0.176 |
| `upgraded` | 0.543 | 0.656 | 0.66 |

µs per node. Which kind to read against a measured `papi_flush` is settled by what the harness page holds, not by which number is more convenient: it registers all three tags, so the `upgraded` row is the comparand and the `inert` row is the floor beneath it.

### What registering the tags costs

`upgraded` minus `inert`, per node, same window. This is the platform dispatching one custom-element reaction per inserted node with an empty callback body — irreducible for anyone whose host elements are custom elements at all, which every Lynx web element is.

| arm | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node |
|---|---:|---:|---:|
| `live-incremental` | 1.457 | 1.557 | 1.503 |
| `live-bulk` | 1.5 | 1.584 | 1.558 |
| `split-incremental` | 0.429 | 0.381 | 0.335 |
| `split-bulk` | 0.4 | 0.489 | 0.497 |

Read against the same window's inert floor: `inert:live-bulk` publishes at 0.971 / 0.88 / 0.894 µs/node and `upgraded:live-bulk` at 2.471 / 2.464 / 2.452.

### The reading registered before the run

Command cost plus the frame, which is how the deciding rate was defined when the prediction was registered. It is reported and not used: on this host the frame is the larger part by an order of magnitude, so it decides any verdict it enters, and the rate this control exists to explain — `papi_topology (+ papi_flush)` self time — contains no frame at all. Both readings are shown so the substitution can be checked rather than taken on trust.

| arm | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node | drift |
|---|---:|---:|---:|---:|
| `inert:live-incremental` | 4.4 | 4.06 | 4.57 | 12.6% |
| `inert:live-bulk` | 4.6 | 4.11 | 4.65 | 13.2% |
| `inert:split-incremental` | 3.67 | 3.59 | 4 | 11.5% |
| `inert:split-bulk` | 3.71 | 3.47 | 3.93 | 13.4% |
| `upgraded:live-incremental` | 5.89 | 5.95 | 5.68 | 4.7% |
| `upgraded:live-bulk` | 5.94 | 5.74 | 5.79 | 3.6% |
| `upgraded:split-incremental` | 4.06 | 3.88 | 3.91 | 4.5% |
| `upgraded:split-bulk` | 3.89 | 3.91 | 4.03 | 3.8% |

The frame is measured with a forced layout read on the next animation frame, so the whole tree is laid out inside it. First contentful paint does not require that, so this frame is an upper bound on what a first screen pays before FCP, not a transfer of it.

Milliseconds here are host-bound and belong to this window only. The µs/node rates and the drift across scales are the portable claims.
