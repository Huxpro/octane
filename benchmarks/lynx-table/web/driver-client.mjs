// Page-side driver toolkit (runs in the browser page, installed on
// `globalThis.__x`): the shadow-piercing composed-DOM walk, arm/until/settle
// measurement primitives, and the FCP probe.
//
// Ported from the cross-framework harness in Huxpro/vue-lynx
// `packages/benchmark/core/driver-client.mjs` (branch
// claude/lynx-implementation-review-n2r0ie) so every framework cell — octane
// and the vendored references — is measured by the byte-identical instrument.
// Do not fork the predicates for one framework; that breaks the comparison.
import fs from 'node:fs';

export const DRIVER_CLIENT_JS = `(() => {
  const x = (globalThis.__x = {});

  // -- composed-tree walk (pierces shadow roots) -----------------------------
  const classOf = (el) => (el.getAttribute && el.getAttribute('class')) || '';
  const hasClass = (el, cls) => classOf(el).split(/\\s+/).includes(cls);

  const findByClass = (cls) => {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        if (hasClass(node, cls)) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
      for (const child of node.childNodes || []) walk(child);
    };
    walk(document.body);
    return out;
  };
  x.findByClass = findByClass;

  // Count nodes carrying an attribute, over the same composed tree. A timing
  // number for a change that installs or skips a per-node attribute is
  // unreadable without it: it says which regime the arm actually ran in, so a
  // run where both arms behave identically cannot be read as a null result.
  x.countAttribute = (name) => {
    let n = 0;
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        if (node.hasAttribute && node.hasAttribute(name)) n += 1;
        if (node.shadowRoot) walk(node.shadowRoot);
      }
      for (const child of node.childNodes || []) walk(child);
    };
    walk(document.body);
    return n;
  };

  x.findText = (needle) => {
    const walk = (node) => {
      if (!node) return false;
      if (node.nodeType === 3 && node.textContent.includes(needle)) return true;
      if (node.shadowRoot && walk(node.shadowRoot)) return true;
      for (const child of node.childNodes || []) if (walk(child)) return true;
      return false;
    };
    return walk(document.body);
  };

  // -- lynx-view attach ------------------------------------------------------
  x.createView = (bundleUrl, w = 800, h = 640) => {
    const view = document.createElement('lynx-view');
    view.setAttribute('url', bundleUrl);
    view.style.cssText = 'display:block;width:' + w + 'px;height:' + h + 'px;';
    x.viewAttachTime = performance.now();
    document.body.appendChild(view);
    return true;
  };

  // -- content count: workload-agnostic FCP signal ---------------------------
  const CONTENT_CLASSES = ['row', 'card', 'card-title', 'feed-title', 'col-label'];
  x.contentCount = () => {
    let n = 0;
    for (const cls of CONTENT_CLASSES) n += findByClass(cls).length;
    return n;
  };

  // -- shell count: the pre-workload first screen every cell renders ---------
  // The button row is the only content the apps paint before any rows exist,
  // so it is the workload-agnostic signal for "the shell reached the composed
  // tree" — the startup counterpart to contentCount.
  x.shellCount = () => findByClass('btn-text').length;

  // -- table predicates ------------------------------------------------------
  let rowsEl = null;
  const rows = () => {
    if (!rowsEl || !rowsEl.isConnected) rowsEl = findByClass('rows')[0] ?? null;
    return rowsEl;
  };
  const rowEls = () => {
    const container = rows();
    if (!container) return [];
    const out = [];
    // Element Templates mount keyed content into layout-transparent <wrapper>
    // placeholders — rows are then grandchildren of the container. Descend
    // through wrapper tags only, so per-frame polling stays a shallow walk.
    const walk = (parent) => {
      for (const child of parent.children) {
        if (hasClass(child, 'row')) out.push(child);
        else if (/wrapper/i.test(child.tagName || '')) walk(child);
      }
    };
    walk(container);
    return out;
  };
  x.rowCount = () => (rows() ? rowEls().length : -1);
  const cellOf = (rowEl, cls) => {
    for (const child of rowEl.children) if (hasClass(child, cls)) return child;
    return null;
  };
  x.labelAt = (i) => {
    const r = rowEls()[i];
    return r ? cellOf(r, 'col-label')?.textContent ?? null : null;
  };
  x.dangerAt = (i) => {
    const r = rowEls()[i];
    return r ? hasClass(r, 'danger') : false;
  };

  // -- semantic checksum ----------------------------------------------------
  const hashText = (seed, text) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  };
  x.tableOracle = () => {
    const current = rowEls();
    let checksum = 2166136261;
    for (const row of current) {
      const id = cellOf(row, 'col-id')?.textContent ?? '';
      const label = cellOf(row, 'col-label')?.textContent ?? '';
      checksum = hashText(checksum, id + '\\u0000' + label + '\\u0000' + classOf(row));
    }
    return { rows: current.length, checksum };
  };

  // -- click geometry --------------------------------------------------------
  x.buttonRect = (label) => {
    for (const el of findByClass('btn-text')) {
      if (el.textContent === label) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  };
  x.cellRect = (rowIndex, cls) => {
    const r = rowEls()[rowIndex];
    const cell = r && cellOf(r, cls);
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    return { x: rect.x + Math.min(20, rect.width / 2), y: rect.y + rect.height / 2 };
  };

  // -- predicates ------------------------------------------------------------
  const checkPredicate = (spec) => {
    switch (spec.type) {
      case 'rowCount': return x.rowCount() === spec.value;
      case 'labelAt': return x.labelAt(spec.index) === spec.equals;
      case 'dangerAt': return x.dangerAt(spec.index);
      case 'checksumNot': return x.tableOracle().checksum !== spec.value;
      case 'contentAtLeast': return x.contentCount() >= spec.value;
      case 'shellAtLeast': return x.shellCount() >= spec.value;
      default: throw new Error('unknown predicate ' + spec.type);
    }
  };

  // -- measurement primitives ------------------------------------------------
  x.arm = (spec, timeoutMs) =>
    new Promise((resolve, reject) => {
      let t0 = null;
      const onDown = () => { t0 = performance.now(); };
      window.addEventListener('pointerdown', onDown, { capture: true, once: true });
      const deadline = performance.now() + (timeoutMs ?? 120000);
      const tick = () => {
        if (t0 != null && checkPredicate(spec)) {
          const done = performance.now();
          resolve({
            ms: done - t0,
            startEpoch: performance.timeOrigin + t0,
            endEpoch: performance.timeOrigin + done,
            papiAtDone: papiSnapshot(),
          });
          return;
        }
        if (performance.now() > deadline) {
          window.removeEventListener('pointerdown', onDown, { capture: true });
          reject(new Error('predicate timeout: ' + JSON.stringify(spec) + ' rowCount=' + x.rowCount()));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  x.until = (spec, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      const deadline = performance.now() + timeoutMs;
      const tick = () => {
        if (checkPredicate(spec)) return resolve(true);
        if (performance.now() > deadline) return reject(new Error('until timeout: ' + JSON.stringify(spec)));
        requestAnimationFrame(tick);
      };
      tick();
    });

  x.settle = (extraMs = 30) =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, extraMs))));

  // -- host-boundary snapshot -------------------------------------------------
  // Reads the host-boundary probe when the page carries one (papiInstrumentJs).
  // The call is byte-identical for every framework cell and yields null on a
  // control page, so control and probe pages run the same driver code.
  const papiSnapshot = () =>
    typeof globalThis.__OCTANE_STAGE_PAPI__ === 'function' ? globalThis.__OCTANE_STAGE_PAPI__() : null;
  x.papiSnapshot = papiSnapshot;

  // -- FCP + settled ---------------------------------------------------------
  // From viewAttachTime, poll the composed tree per animation frame. FCP =
  // first frame satisfying the paint predicate — contentCount >= minContent by
  // default, or an explicit spec for a first screen that carries no rows;
  // settled = content count then stable for idleMs. Hard timeout aborts as DNF.
  x.fcp = (opts = {}) => {
    const minContent = opts.minContent ?? 5;
    // Default paint check reuses the content count this tick already walked;
    // an explicit spec is for a first screen that carries no row content.
    const spec = opts.spec ?? null;
    const idleMs = opts.idleMs ?? 400;
    const timeoutMs = opts.timeoutMs ?? 120000;
    return new Promise((resolve) => {
      const t0 = x.viewAttachTime ?? performance.now();
      const deadline = performance.now() + timeoutMs;
      let fcp = null;
      let fcpEpoch = null;
      let papiAtFcp = null;
      let lastCount = -1;
      let lastChange = performance.now();
      const tick = () => {
        const now = performance.now();
        const c = x.contentCount();
        if (fcp == null && (spec === null ? c >= minContent : checkPredicate(spec))) {
          fcp = now - t0;
          fcpEpoch = performance.timeOrigin + now;
          // Same-realm read on the observing frame: the host-boundary counters
          // are exact as of first paint, not as of a later cross-realm poll.
          papiAtFcp = papiSnapshot();
        }
        if (c !== lastCount) { lastCount = c; lastChange = now; }
        if (fcp != null && now - lastChange >= idleMs) {
          resolve({ fcp, fcpEpoch, papiAtFcp, settled: lastChange - t0, finalCount: c, dnf: false });
          return;
        }
        if (now > deadline) {
          resolve({ fcp, fcpEpoch, papiAtFcp, settled: null, finalCount: c, dnf: true });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
})()`;

// Page-side MessagePort accounting. It observes the same Web Core RPC boundary
// as the shared cross-framework runner and records only JSON-equivalent bytes;
// no payload is cloned, retained, or rewritten by the probe.
export const WIRE_INSTRUMENT_JS = `(() => {
  const stats = {
    // Web Core direction names: page/main-thread-script -> background thread,
    // then background thread -> page/main-thread-script.
    toBts: { messages: 0, bytes: 0, byName: {} },
    toMts: { messages: 0, bytes: 0, byName: {} },
  };
  const encoder = new TextEncoder();
  const sizeOf = (data) => {
    try {
      const json = JSON.stringify(data, (_key, value) => {
        if (value instanceof ArrayBuffer) return { $arrayBuffer: value.byteLength };
        if (ArrayBuffer.isView(value)) return { $arrayBufferView: value.byteLength };
        if (typeof value === 'function') return '$function';
        return value;
      });
      return json ? encoder.encode(json).length : 0;
    } catch {
      return -1;
    }
  };
  const record = (side, data) => {
    const bytes = sizeOf(data);
    const name = data && typeof data === 'object' && 'name' in data ? String(data.name) : '$raw';
    side.messages++;
    if (bytes > 0) side.bytes += bytes;
    const endpoint = side.byName[name] ?? (side.byName[name] = { messages: 0, bytes: 0 });
    endpoint.messages++;
    if (bytes > 0) endpoint.bytes += bytes;
  };
  globalThis.__OCTANE_STAGE_WIRE__ = () => structuredClone(stats);
  const postMessage = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (data, ...rest) {
    record(stats.toBts, data);
    return postMessage.call(this, data, ...rest);
  };
  const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  if (descriptor?.get && descriptor.set) {
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(listener) {
        if (typeof listener !== 'function') return descriptor.set.call(this, listener);
        return descriptor.set.call(this, function (event) {
          record(stats.toMts, event.data);
          return listener.call(this, event);
        });
      },
    });
  }
})()`;

// Host-side Element PAPI boundary probe.
//
// @lynx-js/web-core runs the main-thread script in a hidden same-origin iframe
// realm and installs every Element PAPI entry point onto that realm's global
// object with one `Object.assign` issued from this page's realm
// (`LynxViewInstance.onPageConfigReady`). Wrapping that single assignment is
// the whole interception: the probe observes the host boundary, so the
// identical instrument applies to Octane, ReactLynx, and the Vue cells by
// construction — no framework code, bundle, or vendored reference artifact is
// modified, rebuilt, or re-hashed to measure any of them.
//
// The wrappers become own data properties of the main-thread realm's global
// object, so PAPI lookups stay plain global reads; only the call itself is
// wrapped. Timers are exclusive: a call reports its wall time minus time spent
// inside nested wrapped calls, so a host call re-entered through a framework
// callback (a list's `componentAtIndex`) is never counted twice.
//
// Wall time inside `__FlushElementTree` covers the synchronous publication
// Web Core performs there; the browser's own style, layout, and paint run
// afterwards and stay in the analyzer's residual rather than being guessed
// apart.
export function papiInstrumentJs({ timers = true } = {}) {
	return PAPI_INSTRUMENT_TEMPLATE.replace('__PAPI_TIMERS__', timers ? 'true' : 'false');
}

const PAPI_INSTRUMENT_TEMPLATE = `(() => {
  // Timing every host call costs a clock read per call, which on a host with a
  // slow performance.now() is a large share of a cheap call. The counts build
  // reads the clock only on the first call and on each flush, so op counts,
  // flush cadence, and start delay come from a window whose wall clock is
  // still representative; the timed build adds the per-call brackets that
  // exclusive host time needs. Both builds count identically, so agreement
  // between them is the control on the timed build's cost.
  var TIMERS = __PAPI_TIMERS__;
  var FLUSH_DETAIL_LIMIT = 64;
  var CORE = ['__CreatePage', '__CreateElement', '__FlushElementTree'];
  var origin = performance.timeOrigin;
  var kinds = Object.create(null);
  var flushes = [];
  var childStack = [];
  var childDepth = 0;
  var state = {
    attached: false,
    attachEpoch: null,
    wrapped: [],
    calls: 0,
    selfMs: 0,
    firstCallEpoch: null,
    lastCallEpoch: null,
    flushCount: 0,
    flushSelfMs: 0,
  };

  var bucketOf = function (name) {
    var bucket = kinds[name];
    if (bucket === undefined) {
      bucket = kinds[name] = { calls: 0, selfMs: 0, firstEpoch: null, lastEpoch: null };
    }
    return bucket;
  };

  // Flush records are the per-commit cadence trace. They are bounded: beyond
  // FLUSH_DETAIL_LIMIT only the aggregate counters keep growing, and the
  // snapshot reports both the limit and the true flush count, so a truncated
  // trace can never read as a complete one.
  var recordFlush = function (startEpoch, endEpoch, self, callsBefore, selfMsBefore) {
    state.flushCount++;
    state.flushSelfMs += self;
    if (flushes.length < FLUSH_DETAIL_LIMIT) {
      flushes.push({
        index: state.flushCount - 1,
        startEpoch: startEpoch,
        endEpoch: endEpoch,
        selfMs: self,
        callsBefore: callsBefore,
        selfMsBefore: selfMsBefore,
      });
    }
  };

  var wrapTimed = function (name, fn) {
    var bucket = bucketOf(name);
    var isFlush = name === '__FlushElementTree';
    return function () {
      var callsBefore = isFlush ? state.calls : 0;
      var selfMsBefore = isFlush ? state.selfMs : 0;
      var start = performance.now();
      childStack[childDepth++] = 0;
      try {
        return fn.apply(this, arguments);
      } finally {
        var end = performance.now();
        var child = childStack[--childDepth];
        var gross = end - start;
        var self = gross - child;
        if (self < 0) self = 0;
        if (childDepth > 0) childStack[childDepth - 1] += gross;
        bucket.calls++;
        bucket.selfMs += self;
        if (bucket.firstEpoch === null) bucket.firstEpoch = origin + start;
        bucket.lastEpoch = origin + end;
        state.calls++;
        state.selfMs += self;
        if (state.firstCallEpoch === null) state.firstCallEpoch = origin + start;
        state.lastCallEpoch = origin + end;
        if (isFlush) recordFlush(origin + start, origin + end, self, callsBefore, selfMsBefore);
      }
    };
  };

  var wrapCounted = function (name, fn) {
    var bucket = bucketOf(name);
    if (name === '__FlushElementTree') return wrapTimed(name, fn);
    return function () {
      // One clock read for the whole window: the first host call is the start
      // boundary the report needs, and every later call is counted only. This
      // build leaves the per-kind first and last epochs null rather than
      // stamping them with the window's first call, so an unobserved timestamp
      // never reads as an observed one.
      if (state.firstCallEpoch === null) state.firstCallEpoch = origin + performance.now();
      bucket.calls++;
      state.calls++;
      return fn.apply(this, arguments);
    };
  };

  var wrap = TIMERS ? wrapTimed : wrapCounted;

  var wrapSource = function (source) {
    if (source === null || source === undefined) return source;
    if (typeof source !== 'object' && typeof source !== 'function') return source;
    // Object.assign copies enumerable own string and symbol keys; the
    // substitute copy reproduces exactly that set so the assignment the host
    // performs is unchanged apart from the wrapped functions.
    var copy = {};
    var names = Object.keys(source);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var value = source[name];
      if (name.indexOf('__') === 0 && typeof value === 'function') {
        copy[name] = wrap(name, value);
        state.wrapped.push(name);
      } else {
        copy[name] = value;
      }
    }
    var symbols = Object.getOwnPropertySymbols(source);
    for (var s = 0; s < symbols.length; s++) {
      if (Object.prototype.propertyIsEnumerable.call(source, symbols[s])) {
        copy[symbols[s]] = source[symbols[s]];
      }
    }
    return copy;
  };

  var hasCore = function (source) {
    if (source === null || source === undefined) return false;
    if (typeof source !== 'object' && typeof source !== 'function') return false;
    for (var i = 0; i < CORE.length; i++) {
      if (typeof source[CORE[i]] === 'function') return true;
    }
    return false;
  };

  var nativeAssign = Object.assign;
  Object.assign = function (target) {
    var sources = Array.prototype.slice.call(arguments, 1);
    var found = false;
    for (var i = 0; i < sources.length; i++) {
      if (hasCore(sources[i])) { found = true; break; }
    }
    if (!found) return nativeAssign.apply(Object, arguments);
    // One-shot: the Element PAPI install is a single assignment, so the hook
    // retires itself and leaves no residual cost on any later Object.assign.
    Object.assign = nativeAssign;
    state.attached = true;
    state.attachEpoch = origin + performance.now();
    return nativeAssign.apply(Object, [target].concat(sources.map(wrapSource)));
  };

  globalThis.__OCTANE_STAGE_PAPI__ = function () {
    var byKind = {};
    var names = Object.keys(kinds);
    for (var i = 0; i < names.length; i++) {
      var bucket = kinds[names[i]];
      byKind[names[i]] = {
        calls: bucket.calls,
        selfMs: bucket.selfMs,
        firstEpoch: bucket.firstEpoch,
        lastEpoch: bucket.lastEpoch,
      };
    }
    return {
      timers: TIMERS,
      attached: state.attached,
      attachEpoch: state.attachEpoch,
      wrapped: state.wrapped.slice(),
      calls: state.calls,
      selfMs: state.selfMs,
      firstCallEpoch: state.firstCallEpoch,
      lastCallEpoch: state.lastCallEpoch,
      flushCount: state.flushCount,
      flushSelfMs: state.flushSelfMs,
      flushDetailLimit: FLUSH_DETAIL_LIMIT,
      flushes: flushes.slice(),
      kinds: byKind,
    };
  };

  // Zeroes the counters so one driven operation can be attributed on its own.
  // The wrappers stay installed, so a reset never changes what is measured —
  // only the window it is measured over.
  globalThis.__OCTANE_STAGE_PAPI_RESET__ = function () {
    // Zero the buckets in place: each wrapper closed over its bucket when the
    // boundary was wrapped, so replacing or dropping them would leave the
    // installed wrappers counting into detached objects and report an empty
    // window as if the framework had issued no host calls at all.
    var names = Object.keys(kinds);
    for (var i = 0; i < names.length; i++) {
      var bucket = kinds[names[i]];
      bucket.calls = 0;
      bucket.selfMs = 0;
      bucket.firstEpoch = null;
      bucket.lastEpoch = null;
    }
    flushes.length = 0;
    state.calls = 0;
    state.selfMs = 0;
    state.firstCallEpoch = null;
    state.lastCallEpoch = null;
    state.flushCount = 0;
    state.flushSelfMs = 0;
    return true;
  };
})()`;

/** Build the bench host HTML that loads web-core and installs the driver. */
export function makeBenchHtml({
	clientJs = '/webcore/static/js/client.js',
	clientCss = '/webcore/static/css/client.css',
	instrumentJs = '',
} = {}) {
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script>${instrumentJs}</script>
  <script type="module" src="${clientJs}"></script>
  <link rel="stylesheet" href="${clientCss}">
  <style>html,body{margin:0;padding:0}</style>
</head>
<body>
<script>${DRIVER_CLIENT_JS}</script>
</body>
</html>`;
}

// Neutralize @lynx-js/web-core's always-on lynx.profile shim, for native
// parity. On native Lynx the profiling API is a no-op unless a tracing session
// is active; web-core's shim instead maps every call onto performance.mark()/
// measure() and never clears the measure entries, so the timeline grows without
// bound and frameworks that profile per rendered snapshot (ReactLynx does)
// degrade superlinearly in a way that does not exist on native runtimes. The
// patch no-ops only `lynx.profile:`-prefixed entries and is applied identically
// to every framework cell.
export const NEUTRALIZE_LYNX_PROFILE = `(() => {
  const P = globalThis.Performance && globalThis.Performance.prototype;
  if (!P || P.__lynxProfileNeutralized) return;
  P.__lynxProfileNeutralized = true;
  const isProf = (n) => typeof n === 'string' && n.startsWith('lynx.profile:');
  for (const k of ['mark', 'clearMarks']) {
    const orig = P[k];
    P[k] = function (name, ...rest) {
      if (isProf(name)) return undefined;
      return orig.call(this, name, ...rest);
    };
  }
  const origMeasure = P.measure;
  P.measure = function (name, ...rest) {
    if (isProf(name) || (typeof rest[0] === 'string' && isProf(rest[0]))
      || (rest[0] && typeof rest[0] === 'object' && isProf(rest[0].start))) {
      return undefined;
    }
    return origMeasure.call(this, name, ...rest);
  };
})()`;

/** Apply the neutralization to a Playwright page and its (future) workers. */
export async function applyNeutralize(page) {
	await page.addInitScript(NEUTRALIZE_LYNX_PROFILE);
	page.on('worker', (w) => w.evaluate(NEUTRALIZE_LYNX_PROFILE).catch(() => {}));
}

export const OBSERVE_LYNX_MT_SLICE_LOAD = `(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (!descriptor?.get || !descriptor?.set) return;
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      if (
        globalThis.location?.href === 'about:srcdoc'
        && typeof value === 'string'
        && value.startsWith('blob:')
        && globalThis.__OCTANE_LYNX_MT_SLICE_LOAD_START_EPOCH__ === undefined
      ) {
        globalThis.__OCTANE_LYNX_MT_SLICE_LOAD_START_EPOCH__ =
          performance.timeOrigin + performance.now();
      }
      return descriptor.set.call(this, value);
    },
  });
})()`;

export async function applyStageClock(page) {
	await page.addInitScript(OBSERVE_LYNX_MT_SLICE_LOAD);
}

/**
 * Chromium launch options shared by every harness in this benchmark, so each
 * cell — octane and the vendored references — is driven by the same browser
 * binary in the same configuration. Falls back to the image-provided Chromium
 * when the Playwright-pinned build was never downloaded; the harnesses record
 * `browser.version()` in their reports either way.
 */
export function chromiumLaunchOptions({ headless = true } = {}) {
	const provided = '/opt/pw-browsers/chromium';
	return {
		headless,
		...(fs.existsSync(provided) ? { executablePath: provided } : null),
		args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
	};
}

/** min/max/mean/median/std/ci95 over a numeric array (nulls/NaN dropped). */
export function stats(values) {
	const clean = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
	if (clean.length === 0) return null;
	const sorted = [...clean].sort((a, b) => a - b);
	const n = sorted.length;
	const mean = sorted.reduce((a, b) => a + b, 0) / n;
	const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
	const std = Math.sqrt(sorted.map((v) => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n);
	return {
		n,
		min: sorted[0],
		max: sorted[n - 1],
		mean,
		median,
		std,
		ci95: 1.96 * (std / Math.sqrt(n)),
	};
}
