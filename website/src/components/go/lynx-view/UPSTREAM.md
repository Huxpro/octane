# Upstream boundary

This directory is an adaptation of the `<lynx-view>` embedding logic in
[`@lynx-js/go-web`](https://github.com/lynx-community/go-web) 0.8.1, which is
Apache-2.0 licensed:

| Here | Upstream |
| --- | --- |
| `fit.ts` | `src/example-preview/utils/fit-scale.ts`, `src/example-preview/utils/number.ts` |
| `mode.ts` | `src/example-preview/utils/resolve-web-preview.ts` |
| `controller.ts` | `src/example-preview/components/web-iframe.tsx` |

```
Copyright The Lynx Authors and the go-web contributors.
Licensed under the Apache License, Version 2.0.
```

## Why it is a copy at all

`@lynx-js/go-web` publishes its `<Go>` component as React source. Its peer
dependencies are `react`, `react-dom`, `@douyinfe/semi-ui`, `swr` and
`qrcode.react`; this website is an Octane application with no React in it, and
`octane/react` only lets React host Octane, not the reverse. The package's one
React-free entry point, `@lynx-js/go-web/embed`, resolves `embed.html` relative
to its own module URL, so it needs go-web's own built site to be served
alongside it — and the URL its README documents,
`https://go.lynxjs.org/embed.js`, currently 404s.

The chrome around the preview (file strip, code panel, tabs, QR code) is
written for this site and is deliberately not a port: it follows the Octane
site's design system.

The part in *this* directory is the opposite case. Getting `<lynx-view>` right
is fiddly and version-sensitive — `browserConfig` ordering, the fit/responsive
threshold with hysteresis, the container-relative `rpx`/`vw`/`vh` re-basing, and
the fact that there is no public "rendered" event so the page root inside the
shadow tree has to be observed instead. Reimplementing that from scratch would
diverge from go-web for no benefit.

## Upstream intent

This directory has no React import, no framework dependency and no dependency on
anything else in this repository. `mountLynxView(container, options)` owns a
subtree of plain DOM elements and reports state through a callback, and
`loadRuntime` is injected rather than chosen here.

That shape is deliberate: it is what go-web would need in order to expose this
as a framework-neutral entry point (something like
`@lynx-js/go-web/lynx-view`), with go-web's own `WebIframe` becoming a thin
React binding over it, exactly as `LynxPreview.tsrx` is a thin Octane binding
here. Changes made here should stay portable back to go-web — keep the DOM and
the state machine free of Octane, and keep the ported maths behaviourally equal
to upstream so a diff against it stays readable.

## Known divergences from upstream

- The overlay, its labels and the "can refresh" affordance are not ported; this
  site renders its own status UI from `onStateChange`.
- The `?simulateError=` development hook is not ported.
- Upstream's static preview image and `<img>` cover path belong to its own
  chrome, not to the view, and are not ported.
