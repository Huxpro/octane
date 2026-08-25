// The host-boundary instrument's first-screen split, exercised across the realm
// boundary it actually has to cross.
//
// On the web backend the Element PAPI is installed into a separate iframe realm
// (`createIFrameRealm`), so the framework's globalThis is not the page's. What
// makes the framework's profile record reachable from here is that web-core
// performs the install from page-realm code, which puts the framework realm's
// global in hand as Object.assign's target. A test that used one global for both
// would pass while the real thing silently reported every phase as absent, so
// these use two objects on purpose.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { papiInstrumentJs } from '../web/driver-client.mjs';

const nativeAssign = Object.assign;

/** Evaluate a fresh instrument and hand back its snapshot accessor. */
function installInstrument({ timers = true } = {}) {
	new Function(papiInstrumentJs({ timers }))();
	return globalThis.__OCTANE_STAGE_PAPI__;
}

/** A framework realm carrying a profile build's record. */
function profileRealm() {
	return {
		__OCTANE_LYNX_PROF: {
			firstScreenPhase: null,
			firstScreenRenderMs: 4,
			firstScreenPublishMs: 8,
			firstScreenCaptureMs: 2,
			firstScreenAnnounceMs: 1,
		},
	};
}

/** The subset of the Element PAPI these cases drive. */
function papiSource() {
	let uid = 0;
	return {
		__CreatePage: () => ({}),
		__CreateView: () => ({}),
		__GetElementUniqueID: () => ++uid,
		__FlushElementTree: () => undefined,
	};
}

afterEach(() => {
	// The hook retires itself on the install it matches, but a case that never
	// installs would leave it armed for the next one.
	Object.assign = nativeAssign;
	delete globalThis.__OCTANE_STAGE_PAPI__;
	delete globalThis.__OCTANE_STAGE_PAPI_RESET__;
});

describe('papi instrument first-screen split', () => {
	it('attributes host time to the phase the framework had open, across realms', () => {
		const snapshot = installInstrument();
		const realm = profileRealm();
		Object.assign(realm, papiSource());

		const profile = realm.__OCTANE_LYNX_PROF;
		profile.firstScreenPhase = 'publish';
		realm.__CreatePage('entry', 0);
		realm.__CreateView(0);
		realm.__CreateView(0);
		realm.__FlushElementTree();
		profile.firstScreenPhase = 'capture';
		realm.__GetElementUniqueID({});
		realm.__GetElementUniqueID({});
		// Outside the first screen entirely — a later commit, not a phase.
		profile.firstScreenPhase = null;
		realm.__CreateView(0);

		const first = snapshot().firstScreen;
		assert.equal(first.byPhase.publish.calls, 4);
		assert.equal(first.byPhase.capture.calls, 2);
		// A call issued with no phase open belongs to no phase. Attributing it to
		// the last one would quietly charge post-first-screen work to capture.
		assert.equal(
			Object.values(first.byPhase).reduce((sum, bucket) => sum + bucket.calls, 0),
			6,
		);
		assert.equal(first.open, null);
	});

	it('reports the framework wall spans beside the host time it observed', () => {
		// Neither half means anything alone: the difference between a phase's wall
		// span and the host time observed inside it is that phase's off-boundary
		// cost, which is the whole point of the split.
		const snapshot = installInstrument();
		const realm = profileRealm();
		Object.assign(realm, papiSource());
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'publish';
		realm.__CreateView(0);

		const first = snapshot().firstScreen;
		assert.deepEqual(first.wallMs, { render: 4, publish: 8, capture: 2, announce: 1 });
		assert.ok(first.byPhase.publish.selfMs >= 0);
	});

	it('counts phases without inventing host time on a counts-only build', () => {
		// The counts build reads no per-call clock, so its phase buckets must carry
		// calls and a zero selfMs rather than a duration it never measured.
		const snapshot = installInstrument({ timers: false });
		const realm = profileRealm();
		Object.assign(realm, papiSource());
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'render';
		realm.__CreateView(0);

		const first = snapshot().firstScreen;
		assert.equal(first.timers, false);
		assert.equal(first.byPhase.render.calls, 1);
		assert.equal(first.byPhase.render.selfMs, 0);
	});

	it('reports no split for a page that carries no profile build', () => {
		// Every other cell — the shipping octane build, and both vendored reference
		// bundles — goes through this path, so it has to be a clean null rather
		// than an empty split that reads as "measured, and it was zero".
		const snapshot = installInstrument();
		const realm = {};
		Object.assign(realm, papiSource());
		realm.__CreateView(0);

		assert.equal(snapshot().firstScreen, null);
	});

	it('does not carry one window’s phase buckets into the next', () => {
		const snapshot = installInstrument();
		const realm = profileRealm();
		Object.assign(realm, papiSource());
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'publish';
		realm.__CreateView(0);
		assert.equal(snapshot().firstScreen.byPhase.publish.calls, 1);

		globalThis.__OCTANE_STAGE_PAPI_RESET__();

		assert.deepEqual(snapshot().firstScreen.byPhase, {});
	});
	it('credits the phase that issued a call, not one that opened while it ran', () => {
		const snapshot = installInstrument();
		const realm = profileRealm();
		// `__FlushElementTree` publishes the page and dispatches host events, so
		// it is the call most likely to see a phase advance underneath it. Which
		// side of the call the marker is read on decides who pays for it, and the
		// answer has to be the caller.
		Object.assign(realm, {
			...papiSource(),
			__FlushElementTree: () => {
				realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'capture';
			},
		});
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'publish';
		realm.__FlushElementTree();
		realm.__GetElementUniqueID();
		const split = snapshot().firstScreen;
		assert.equal(split.byPhase.publish.calls, 1);
		assert.equal(split.byPhase.capture.calls, 1);
	});
	it('reports only the first-screen time that fell inside the measured window', () => {
		const snapshot = installInstrument();
		const realm = profileRealm();
		Object.assign(realm, papiSource());
		// A first screen at page load, then a window opened for something else —
		// the create click. The framework's spans keep accumulating for the life of
		// the realm, so a window that starts afterwards must report the delta, not
		// the total, or every later window inherits this one's first screen.
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = 'publish';
		realm.__CreateView();
		realm.__OCTANE_LYNX_PROF.firstScreenPhase = null;
		globalThis.__OCTANE_STAGE_PAPI_RESET__();
		realm.__CreateView();
		const split = snapshot().firstScreen;
		assert.deepEqual(split.wallMs, { render: 0, publish: 0, capture: 0, announce: 0 });
		assert.deepEqual(split.byPhase, {});
	});
});
