# Publication floor — what the platform charges to attach a first screen

- measured: 2026-08-24T03:42:36.944Z
- host: 4× Intel(R) Xeon(R) Processor @ 2.10GHz; linux 6.18.44-fc-v21; Node v22.22.2; Chromium 141.0.7390.37
- host load: start 0.03/0.18/1.13 (1/5/15m), end 0.78/0.35/1.15
- repetitions: n=5 per arm per scale; arms: build, live-incremental, live-bulk, split-incremental, split-bulk
- protocol: fresh page per sample; arm order rotates across repetitions; no framework, no web-core, and no app bundle is loaded — the page builds the tree itself

## What this controls for

#148 W2 resolved publication's share into a swap plus a rate. The swap is exact — a detached first screen pays its insertions inside `papi_flush` where the post-mount path pays the identical insertions inside `papi_topology` — and what survives it is a per-node rate that rises with the tree on the first-screen path while staying flat on the post-mount one. This probe asks whether the browser reproduces that split with no framework in the page.

Nothing measured here belongs to Octane or to web-core. `__AppendElement` is `parent.appendChild(child)` and the first flush publishes with `rootDom.appendChild(page)` on a shadow root, so the arms below are those two calls and nothing else. The tree is built with the tag names, per-row shape, attributes, class names, and scoped stylesheet `createElementAPI.js` produces, so the browser resolves the same styles over the same unregistered elements.

| arm | what it does |
|---|---|
| `build` | every node created and linked within its row, nothing ever attached — the allocation floor every other arm also pays |
| `live-incremental` | rows created and appended one at a time into a container already in the document — the post-mount shape |
| `live-bulk` | rows created and appended one at a time into a detached container, then one `appendChild` publishes the tree — the first-screen shape |
| `split-incremental` | every row built first, then all of them appended into an attached container |
| `split-bulk` | every row built first, then all of them appended into a detached container, then one `appendChild` publishes it |

`frameMs` is the next animation frame with a forced layout read, so style and layout are inside the measurement rather than after it. It is reported beside the command cost and never folded into it: the rate this control has to explain is `papi_topology (+ papi_flush)` self time, which is time inside `appendChild` and contains no style, layout, or paint. The verdict therefore reads command cost, and the reading registered before the run — command plus frame — is printed at the end so the two can be compared.

The two pairs answer the same question at different costs. `live-*` interleaves creation and attachment exactly as the command stream does, so it needs no deviation from what Octane pays and its whole loop is comparable to `papi_topology` — plus `papi_flush` on the bulk side. It cannot separate attachment from creation without a clock read per append, so its rate is the loop plus the frame. `split-*` buys a separable `attachMs` by building first and attaching second, which the command stream never does; it localizes whatever the live pair finds and can never overturn it.

The deciding pair is therefore `live-incremental` against `live-bulk`, with `split-incremental`/`split-bulk` reported beside it as corroboration.

## 1,000 rows — 7,000 nodes

| arm | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `build` | 5.3 | 0 | 6.1 | 11.2 | 0 | 0.87 |
| `live-incremental` | 6.7 | 0 | 25.5 | 33 | 0.957 | 3.64 |
| `live-bulk` | 5.5 | 1.1 | 27.1 | 33.8 | 0.943 | 3.87 |
| `split-incremental` | 5.8 | 1.1 | 24.3 | 31 | 0.157 | 3.47 |
| `split-bulk` | 5.6 | 1.2 | 26.5 | 33.1 | 0.171 | 3.79 |

## 10,000 rows — 70,000 nodes

| arm | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `build` | 47.6 | 0 | 0.4 | 47.8 | 0 | 0.01 |
| `live-incremental` | 62.1 | 0 | 215.7 | 276.4 | 0.887 | 3.08 |
| `live-bulk` | 49.8 | 10.4 | 216.8 | 280.4 | 0.86 | 3.1 |
| `split-incremental` | 47.8 | 12.7 | 215.4 | 273.2 | 0.181 | 3.08 |
| `split-bulk` | 50.4 | 12.6 | 216 | 279.7 | 0.18 | 3.09 |

## 30,000 rows — 210,000 nodes

| arm | build ms | attach ms | frame ms | total ms | command µs/node | frame µs/node |
|---|---:|---:|---:|---:|---:|---:|
| `build` | 141.3 | 0 | 0.3 | 141.6 | 0 | 0 |
| `live-incremental` | 184.9 | 0 | 756.7 | 936.8 | 0.88 | 3.6 |
| `live-bulk` | 142.9 | 35.6 | 752.9 | 932.7 | 0.85 | 3.59 |
| `split-incremental` | 138.8 | 38.3 | 745.1 | 915.6 | 0.182 | 3.55 |
| `split-bulk` | 139.6 | 43 | 759 | 940 | 0.205 | 3.61 |

## Does the platform reproduce the split?

Command cost per node — what the stream pays inside the calls it makes, with the frame held out. `build` is omitted: it attaches nothing, so it has no command rate to compare.

| arm | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node | drift | trend | flat |
|---|---:|---:|---:|---:|---:|---|
| `live-incremental` | 0.957 | 0.887 | 0.88 | 8.7% | -8% | yes |
| `live-bulk` | 0.943 | 0.86 | 0.85 | 10.9% | -9.8% | no |
| `split-incremental` | 0.157 | 0.181 | 0.182 | 16.1% | +16.1% | no |
| `split-bulk` | 0.171 | 0.18 | 0.205 | 19.4% | +19.4% | no |

| pair | 1,000 bulk ÷ incremental | 10,000 bulk ÷ incremental | 30,000 bulk ÷ incremental | gap opens |
|---|---:|---:|---:|---|
| deciding (`live-*`) | 0.985× | 0.969× | 0.965× | no |
| localizing (`split-*`) | 1.091× | 0.992× | 1.123× | yes |

**Prediction refuted (deciding pair).** The prediction needs `live-incremental` flat and `live-bulk` rising. Incremental is flat, at 8.7% drift. Bulk does not rise: its trend across the range is -9.8%, against a 10% gate, on a 10.9% drift. The two arms never separate: the widest gap between them is 0.985×.

**Prediction refuted (localizing pair).** The prediction needs `split-incremental` flat and `split-bulk` rising. Incremental is not flat: it drifts 16.1%, outside the 10% gate. Bulk does rise, by 19.4% across the range. Both arms rise together, which is a cost that grows with the tree on either shape — not a cost the detached shape pays and the attached one does not. The widest gap between them is 1.123×.

Both pairs land the same way, so the deviation the localizing pair carries changes nothing about the answer.

Publication's rise is not the platform's, so it belongs to web-core or to Octane with a named owner. W2 stays open.

### The reading registered before the run

Command cost plus the frame, which is how the deciding rate was defined when the prediction was registered. It is reported and not used: on this host the frame is the larger part by an order of magnitude, so it decides any verdict it enters, and the rate this control exists to explain — `papi_topology (+ papi_flush)` self time — contains no frame at all. Both readings are shown so the substitution can be checked rather than taken on trust.

| arm | 1,000 µs/node | 10,000 µs/node | 30,000 µs/node | drift |
|---|---:|---:|---:|---:|
| `live-incremental` | 4.6 | 3.97 | 4.48 | 15.9% |
| `live-bulk` | 4.81 | 3.96 | 4.44 | 21.7% |
| `split-incremental` | 3.63 | 3.26 | 3.73 | 14.5% |
| `split-bulk` | 3.96 | 3.27 | 3.82 | 21.2% |

The frame is measured with a forced layout read on the next animation frame, so the whole tree is laid out inside it. First contentful paint does not require that, so this frame is an upper bound on what a first screen pays before FCP, not a transfer of it.

Milliseconds here are host-bound and belong to this window only. The µs/node rates and the drift across scales are the portable claims.
