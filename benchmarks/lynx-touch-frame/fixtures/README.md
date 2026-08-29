# Fixture contract

The three directories beside this file are the published sources required by
#197. Each shape has ReactLynx (`T1`), Octane (`T2`), and MTS-resident/direct
variants (`T3`/`T0`) that render the contract below.

All variants use the same native element tree for a shape:

```text
view.page
  view.header
    text.title
    view.remote-counter
      text.remote-counter-value
  view.interaction-panel
    view.target-row × 16
      text.row-label
  scroll-view.load-scroll
    view.load-content
      view.load-row × 200
        text.load-label
```

The shape may change only the declared response:

- local toggle: one target row background.
- cross component: remote counter integer and its parity background.
- structural delete: removal of target row `target-8`.

The loaded condition calls native `scroll-view.autoScroll` at the recorded
rate. Interaction rows are outside that scroll view so automation coordinates
remain fixed while the platform scroll pipeline is busy.

The per-shape source directories are intentionally kept separate even where
code repeats. That makes the reviewed tree and exact timed response of each
fixture publishable without a generator or hidden build step.
