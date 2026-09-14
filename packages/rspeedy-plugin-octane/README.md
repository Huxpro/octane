# `@octanejs/rspeedy-plugin` (private R10 native application release candidate)

This private package turns an Octane Lynx application entry into the two
programs required by a Lynx template:

- the generated development main-thread graph installs the public checked
  `installLynxMainThread()` receiver, while a production application selects a
  paired-build receiver that keeps protocol/renderer/root/version/type/arity
  checks without retaining the recursive command validator; both then evaluate
  the authored entry with Octane's render-only first-screen runtime;
  and
- the same authored entry runs in the background runtime with the build-selected
  Lynx renderer. An eligible one-shot production graph uses the Block core and
  compact program transport; other graphs retain the Universal core. Either
  path adopts or deterministically repairs the first tree it owns.

The plugin configures the framework-neutral Lynx template, CSS extraction,
runtime-wrapper, and native encoding packages and emits one `.lynx.bundle` per
authored entry. CSS, CSS Modules, referenced assets, source maps, lazy dynamic
imports, and Rspeedy's debug metadata remain in Rspeedy's normal build graph.
Development builds wire the pinned Lynx dev transport when Rspeedy enables HMR
or live reload.

This is a **private native-application milestone**, not a published technical
preview. The repository proves graph specialization, bundle construction,
decoding, dual-layer lazy-chunk emission, and one visible first paint in the
official macOS Explorer 3.9 arm64 asset. It does not prove adopted-node
identity, automated native interaction, dynamic chunk execution on Lynx Web,
general Android Explorer or iOS Explorer behavior, or state-preserving HMR on
those targets. The opt-in Element Template slice has separate, narrowly scoped
Android table evidence described below.

## One-command repository demo

On macOS arm64 or x64, the native acceptance path is one command:

```bash
pnpm lynx:demo:native
```

The launcher selects the matching official Lynx 3.9.0 macOS Explorer artifact,
downloads its archive from the release only when absent, verifies the pinned
SHA-256 digest on every launch, and builds a per-run application lease under
`~/Library/Caches/octane/lynx-explorer/3.9.0`. The verified archive persists;
the isolated extraction is removed after Explorer's process group stops. The
launcher then starts the existing demo server on an available strict localhost
port, verifies the Lynx binary response, and directly launches the Explorer
executable with that exact `main.lynx.bundle` URL. Closing Explorer or pressing
Ctrl-C terminates both Explorer and the development server.

Use `OCTANE_LYNX_EXPLORER_CACHE_DIR` to move the cache,
`OCTANE_LYNX_EXPLORER_EXECUTABLE` to use an already-installed executable, or
`OCTANE_LYNX_DEMO_PORT` to request a particular free port. The launcher does not
run `codesign`; integrity comes from the pinned release URL and checksum.

For an Android/iOS device, simulator, or a separately installed Explorer, run:

```bash
pnpm lynx:demo
```

The command starts the pinned Rspeedy development server, builds
`main.lynx.bundle`, and prints its LAN URL and a QR code. Open that URL with the
official
[Lynx 3.9.0 Explorer](https://github.com/lynx-family/lynx/releases/tag/3.9.0)
on a device that can reach the development computer. The demo exercises native
layout and CSS, dual-thread startup, and a background-owned state update through
`bindtap`. See the
[demo README](./examples/demo/README.md) for prerequisites and non-interactive
checks.

The repository's automated gate starts the development command on an isolated
port, fetches and decodes this exact bundle, and verifies server teardown.
Launcher unit tests do not download Explorer or open a native window.
The qualified native evidence records a visible `Count 0` first screen and
clean Octane main/background transport logs. It does not claim the native tap,
because synthetic input required macOS accessibility permission during capture.

## Application mode

Omit `thread` for the production application path:

```js
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginOctane } from '@octanejs/rspeedy-plugin';

export default defineConfig({
	source: { entry: './src/index.ts' },
	plugins: [pluginOctane()],
});
```

```ts
// src/index.ts — evaluated by both specialized thread graphs
import { root } from '@octanejs/lynx';
import { App } from './App.lynx.tsrx';

void root.render(App);
```

Each authored entry is split into an Octane background graph and an internal
main-thread graph. The main graph always installs the receiver in manual
first-screen synchronization mode, resolves the exact `@octanejs/lynx` package
root to the first-screen facade, and then evaluates the authored imports in
their original order. A generated tail module marks the first screen ready only
after synchronous authored initialization returns. Subpath imports are not
rewritten. The compiler selects the render-only main renderer and main-thread
runtime metadata by Rspack layer; unconfigured layers retain the background
configuration.

Application builds also load the renderer-owned main-thread program backend by
default. The backend travels to Rspack workers as a serializable absolute module
request plus its cache signature; each worker loads and verifies the module, and
the main compilation cross-checks the positional program digest produced by both
thread layers. Eligible host-only plans therefore use compiled resident programs
and addresses from one versioned, compiler-owned Lynx IR: the background compile
uses it for eligibility and addressing, while the main-thread compile also emits
the resident create function from it. No config-file import is needed. Plans the
create-function emitter
cannot reproduce stay on the command path. Use `programAddressing: false` to
keep compiled programs while comparing descriptor transport, or
`mainThreadProgramBackend: false` for a full command-path control. Pass another
backend explicitly only when developing its renderer/compiler integration.

Set `experimentalElementTemplate: true` to require the matching whole-root
Element Template backend:

```js
pluginOctane({ experimentalElementTemplate: true });
```

The option is valid only for the two-layer application build. It keeps the
ordinary Block/application eligibility proof, then additionally requires every
selected main-thread plan to lower to the public Template Definition schema.
The build fails when coverage is incomplete; it never emits a tree that mixes
opaque template handles with ordinary Element refs. The selected native bundle
uses target SDK `3.2`, while ordinary application bundles retain target `3.9`.
The default remains the ordinary compiled-program Element owner.

The current lowering admits static native host topology, scalar value/event
slots, root visibility, and one element slot for each proved structural range.
It rejects refs, native lists, `main-thread:*` bindings, text-polymorphic ranges,
and unsupported native attribute composition. At runtime, pending template work
is drained in 8,192-node chunks; synchronous first screens above 8,192 plan
nodes defer to the background store; and live ownership is capped at 32,768
template instances and 40,960 resident plan nodes. Oversized eager trees reject
with `Octane Lynx OL512` before native creation and must use the virtualized
native-list backend.

One pinned Android Explorer 4.1.0 cohort accepted the final 10,000-row native
create and startup samples and rejected a 30,000-row startup without a JNI/fatal
marker or process death. This qualifies only that workload and those recorded
boundaries. See
[`docs/lynx-block-semantics.md`](../../docs/lynx-block-semantics.md#experimental-whole-root-element-template-backend)
and
[`android-element-template-evidence.json`](../lynx/audit/android-element-template-evidence.json).

Compatible Rspack entry metadata is copied to both generated graphs so they see
the same entry initialization inputs. Development-only CSS HMR setup runs after
the receiver install and before the authored imports.

Standalone `.tsrx` application components use a leading
`/** @jsxImportSource @octanejs/lynx/intrinsics */` pragma for editor and
`tsrx-tsc` typing. The Rspeedy plugin independently selects Lynx as the default
compiler renderer for the application build.

An authored `lazy(() => import('./Card.tsrx'))` remains a real Rspack dynamic
import. The pinned production fixture emits a content-hashed async `.bundle`;
its module is specialized independently in the `octane:main-thread` and
`octane:background` layers. The synchronous first-screen renderer may commit an
authored pending arm and prewarm independent imports, while the retained
background root owns later reveal or rejection. This is decoded artifact and
graph evidence, not proof that a native runtime fetches or executes the chunk.

Explicit `thread: 'background'` and `thread: 'main-thread'` are retained as
isolated compiler-graph diagnostic modes. They stamp and compile the supplied
entry for one thread, but they are not the normal application bundle path:

```js
pluginOctane({ thread: 'main-thread' });
```

### Static Block selection

Application builds attach an `octane:lynx-block-selection` report to the
generated main-thread asset metadata. Selection version 1 with support-matrix
version 13 is eligible only when paired
background/main-thread resident-program coverage is complete, semantic and
feature facts cover the same module set, and the graph stays within this
independently proven Block subset:

- authored Octane runtime uses or named re-exports are limited to `createContext`,
  `memo`, `useCallback`, `useContext`, `useEffect`, `useRef`, `useState`, and
  `useSyncExternalStore`; opaque Octane module access is not eligible;
- background/main-thread functions and `main-thread:*` props are supported;
- the authored template may use compiler-proved local component boundaries,
  inline render props, component holes, `@if`, `@switch`, and fixed-shape keyed
  rows below native `list`/`list-item`; fragments, `@try`, Activity, generic
  renderable holes, ordinary host refs, and template-root events are not
  eligible;
- keyed ranges may have an `@empty` arm and one retained static sibling after
  them, but not a nested or second sibling range under the same host. Rows use
  an inline host or local component and may own the supported hooks above;
  their scopes are retained and disposed by key.

The report retains source module, thread, line, and column for unsupported
facts, as well as the underlying reason from an incomplete proof. A one-shot
production application with no explicit `core` selects Block only when every
authored entry is eligible. Selection happens after the complete first module
graph and before optimization: the plugin rebuilds the background root's tiny
selection dependency and every proved background source module with the
independent compiler-program renderer. Production output therefore contains
one core and BTS program definitions derived directly from the same shared IR
as the resident MTS programs; it does not create Universal plans and lower them
at runtime. Asset metadata also carries the versioned
`octane:lynx-background-core-selection` decision.

The plugin verifies the rebuilt background root's exact dependency edge before
publishing that decision. A replacement or rebuild that does not resolve the
selected module fails the build instead of emitting metadata that claims a core
the artifact does not contain.

Any incomplete/unsupported entry, a non-production or watch build, or an
unavailable application root keeps the universal module. `core: 'universal'`
is the explicit product opt-out; `core: 'block'` retains the existing explicit
development/benchmark override. An explicit override is reported as such and
is not presented as an automatic eligibility decision.

## Compatibility lanes
### Ordinary compiled-program receipt

The production fixture
`tests/_fixtures/application/src/BlockEligible.tsrx` is a normal authored
application: a stateful page renders a keyed local row component with its own
`useState`, `view`/`text`/`image` props, and a native `bindtap` handler.
The real Rspeedy/Rspack production test requires complete paired coverage and
checks this selected import graph:

```text
authored entry -> @octanejs/lynx package root
  -> application-selection.compiled-program
  -> compiled-program-block-transport -> block-background -> block-component

generated main entry -> main-thread-product-application
  -> main-thread-application-selection.compiled-program
  -> compiled-program-application
     -> first-screen.compiled-program + main-renderer.compiled-program
     -> compiled-program-product-receiver -> compiled-program-store
```

It also checks the decoded production artifact uses only the compiled-program
event channel, that the general event channel is absent, and that both compiled
layers contain the image program (the main layer emits its direct
`papi.createElement("image", ...)` body). Automatic development/watch
selection remains Universal by design; `core: 'block'` is the explicit
development/benchmark override and is not reported as an automatic product
decision.

The fixture imports an ordinary TypeScript custom hook. Its background-owned
effect and pure module-local helper chain are present in decoded BTS and absent
from decoded MTS. The compiler preserves helpers that remain reachable from
main-thread setup, module initializers, imports, worklets, and lazy chunks; this
is a capability-scoped source transform, not a second minifier or an assumption
that all setup is background-only.

The packed external-consumer gate installs only generated package archives and
then rebuilds production and development applications. It covers the complex
Block fixture, a fixed-shape native list with extracted CSS/CSS Modules and an
emitted SVG, a real content-hashed lazy bundle, explicit whole-root Universal
opt-out, and HMR/live-reload configuration. The native-list product contains
paired `list`/`list-item` resident programs and compact transport without the
general Universal application renderer. The lazy fixture deliberately keeps
the whole entry on the Universal compatibility product because its pending and
resolved ownership is not yet in the Block support matrix; its async chunk is
still emitted and is never silently folded into the main bundle.

The
`packages/lynx/tests/compiled-program-product-application.test.ts` suite joins
those module contracts against the official JavaScript host without replacing
the compiler output with hand-written plans or frames:

| Phase | Observed contract |
| --- | --- |
| IFR | The compiled main renderer synchronously creates `view`, `text`, and `image` nodes and installs native event tokens. |
| Readiness/adoption | The background compact reply is held; the same painted nodes are adopted, scalar differences are repaired in place, and no command-array adapter is produced. |
| First interaction | A native tap before ACK is queued, then reaches the correct row closure exactly once; its independent row state updates through a direct slot delta. |
| Keyed update | `[1,2,3]` becomes `[3,1,4]` through direct set/remove/run/move operations; surviving row identities and row 1 state remain. |
| Teardown | Root unmount removes the tree and a late native event is inert. |

The compact store, transport, and native-list integration suites separately
prove that a paired fixed-shape `list-item` program is declared logically,
materialized only through Lynx list callbacks, recycled with scalar and event
identity rebound, and removed with late enqueue callbacks inert. List deltas
are prepared before the accepting page flush, and asynchronous callback
failures cross the compact fault wire. Native-list first-screen paint is
deliberately deferred to the first compact frame; this is an explicit
limitation rather than a generic host mirror or a silent Universal fallback.
Rows containing nested structural ranges remain ineligible until compact cells
can retain that nested ownership.

The adoption store separately proves that scalar repairs roll back to the
painted values if the enclosing attempt aborts. These are compiler, Rspack
artifact, and JavaScript-host observations—not Explorer, Android, or iOS
interaction/performance evidence.


R10 covers two exact, indivisible source/build graphs. Registry
metadata was checked on 2026-09-14:

| Component | Minimum | Current |
| --- | ---: | ---: |
| Lynx SDK / ordinary target / Element Template target | `3.9.0` / `3.9` / `3.2` | `3.9.0` / `3.9` / `3.2` |
| `@lynx-js/rspeedy` | `0.17.1` | `0.17.1` |
| `@lynx-js/rsbuild-plugin` | `0.1.1` | `0.1.1` |
| `@lynx-js/cache-events-webpack-plugin` | `0.2.1` | `0.2.1` |
| `@lynx-js/chunk-loading-webpack-plugin` | `0.4.2` | `0.4.2` |
| `@lynx-js/debug-metadata-rsbuild-plugin` | `0.2.3` | `0.2.3` |
| `@lynx-js/debug-metadata` | `0.1.0` | `0.1.0` |
| `@lynx-js/web-rsbuild-server-middleware` | `0.26.0` | `0.26.0` |
| `@lynx-js/websocket` | `0.0.4` | `0.0.4` |
| `@rsbuild/core` | `2.2.3` | `2.2.3` |
| `@rsbuild/plugin-css-minimizer` | `2.0.1` | `2.0.1` |
| `@rsdoctor/rspack-plugin` | `1.6.4` | `1.6.4` |
| `@rspack/core` | `2.2.2` | `2.2.3` |
| `@lynx-js/template-webpack-plugin` | `0.16.0` | `0.16.0` |
| `@lynx-js/css-extract-webpack-plugin` | `0.11.0` | `0.11.0` |
| `@lynx-js/runtime-wrapper-webpack-plugin` | `0.2.4` | `0.2.4` |
| `@lynx-js/webpack-dev-transport` | `0.4.0` | `0.4.0` |
| `@lynx-js/webpack-runtime-globals` | `0.0.8` | `0.0.8` |
| `@lynx-js/tasm` | `0.0.49` | `0.0.49` |
| `@lynx-js/testing-environment` | `0.3.0` | `0.3.0` |
| `@lynx-js/types` | `4.1.0` | `4.1.0` |
| `@lynx-js/web-core` | `0.26.0` | `0.26.0` |
| TypeScript | `5.9.3` | `5.9.3` |
| Webpack (tooling peer only) | `5.108.4` | `5.108.4` |

Rspeedy `0.17.1` requires Rsbuild `2.2.3` and its framework-neutral
`@lynx-js/rsbuild-plugin@0.1.1` exactly. Rsbuild accepts Rspack `~2.2.2`, so the
current lane advances only that declared-compatible patch edge. Element Template
encoding requires the matching template `0.16.0`, tasm `0.0.49`, CSS extract
`0.11.0`, runtime wrapper `0.2.4`, runtime globals `0.0.8`, and web-core `0.26.0`
graph; the compatibility smoke rejects a cross-generation encoder graph. The
Element Template application targets SDK `3.2`, matching the public encoder's
native compatibility lane, while ordinary applications retain target `3.9`.
`@octanejs/lynx` is pinned to `@lynx-js/types@4.1.0`. The lane also pins every direct Rspeedy dependency
selected through a caret or tilde range, the debug-metadata payload, runtime
globals, and the required Webpack 5 tooling peer. Webpack remains an audited
tooling pin rather than a moving current-lane edge; the strict external install
and production builds prove that peer is compatible. The current registry check
recomputes the newest versions selected by the upstream build graph before
accepting the recorded graph.

`pnpm test:compat` packs Octane, the Lynx renderer, and both compiler plugins,
then installs each lane into an external temporary consumer without creating a
lockfile. It checks exact versions and dependency edges, one physical core
graph, strict build-tool peer satisfaction, the absence of DOM and
React/Preact/ReactLynx code in decoded programs, deterministic repeated
production builds, and a decoded ordinary-application engine target of `3.9`.
The Element Template build tests separately decode and validate target `3.2`.
CI also checks registry
drift for the current lane. These remain source/build checks, not Android or iOS
runtime evidence.

The exact sets are available to tooling as `LYNX_TOOLCHAIN_LANES`.
`assertLynxToolchain(root)` validates the build-relevant packages in either
set; the packed smoke additionally validates the testing, TypeScript, and
Webpack tooling packages. Pass `"minimum"` or `"current"` as the optional
second argument when a build must prove a specific lane:

```js
import {
	assertLynxToolchain,
	LYNX_TOOLCHAIN_LANES,
} from '@octanejs/rspeedy-plugin';

const expected = LYNX_TOOLCHAIN_LANES.current;
const installed = assertLynxToolchain(process.cwd(), 'current');
```

The plugin rejects incompatible, cross-lane, or duplicated Rspeedy, Rsbuild,
or Rspack cores before registering compiler hooks. Production graph tests also
reject React, Preact, and ReactLynx runtime dependencies.

Application mode owns each entry's generated filename and background layer,
and rejects authored `filename`, a conflicting `layer`, and `dependOn` (every
native bundle must contain its complete background graph). Other compatible
Rspack entry loading metadata is preserved. Explicit single-thread diagnostic
mode continues to preserve the supplied entry descriptors.

The renderer's native event spelling, lifecycle qualifications, list contract,
Native Module boundary, and remaining engine gates are documented in
[`packages/lynx/README.md`](../lynx/README.md).
