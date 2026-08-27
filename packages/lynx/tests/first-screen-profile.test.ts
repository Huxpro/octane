import { installLynxTestingEnv, uninstallLynxTestingEnv } from '@lynx-js/testing-environment';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `LYNX_PROFILE` is read once when `core/profiling.ts` is evaluated, and every
// module under test imports it, so the build flag has to be set before any of
// those imports run. `vi.hoisted` is what puts this above them. A shipping
// bundle never defines the flag, which is why the marks this file exercises
// cost nothing there and why nothing else in the suite reaches this path.
vi.hoisted(() => {
	(globalThis as unknown as Record<string, unknown>).__OCTANE_LYNX_PROFILE__ = true;
});

import { root as firstScreenRoot } from '../src/first-screen.js';
import {
	defineUniversalComponent as defineFirstScreenComponent,
	renderLynxFirstScreen,
	universalPlan as firstScreenPlan,
	universalProps as firstScreenProps,
	universalValue as firstScreenValue,
} from '../src/main-renderer.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	LYNX_BACKGROUND_TO_MAIN_EVENT,
	LYNX_TRANSPORT_PROTOCOL_VERSION,
	LYNX_TRANSPORT_RENDERER,
	type LynxContextProxy,
} from '../src/core/protocol.js';
import {
	LYNX_PROFILE,
	lynxWireProfile,
	type LynxFirstScreenPhase,
	type LynxWireProfile,
} from '../src/core/profiling.js';

const plan = firstScreenPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });

let installed: { dom: JSDOM; main: LynxMainThreadController } | null = null;

/** The channel a background thread would dispatch its commits down. */
function backgroundContext(): LynxContextProxy {
	return (
		globalThis as typeof globalThis & { lynx: { getCoreContext(): LynxContextProxy } }
	).lynx.getCoreContext();
}

function install(configurePAPI?: (target: Record<string, unknown>) => void): {
	readonly profile: LynxWireProfile;
	readonly dom: JSDOM;
	readonly main: LynxMainThreadController;
} {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	configurePAPI?.(globalThis as unknown as Record<string, unknown>);
	const main = installLynxMainThread({ firstScreen: true, firstScreenSync: 'manual' });
	installed = { dom, main };
	// The record outlives a realm the suite reinstalls per test, so each of these
	// is reset rather than assumed: a counter left over from the previous test
	// would let an assertion below pass on work this test never did.
	const profile = lynxWireProfile();
	profile.firstScreenPhase = null;
	profile.firstScreenRenderMs = 0;
	profile.firstScreenPublishMs = 0;
	profile.firstScreenCaptureMs = 0;
	profile.firstScreenAnnounceMs = 0;
	profile.firstTreeAction = null;
	profile.firstTreeSettled = 0;
	profile.handOverMs = 0;
	return { profile, dom, main };
}

/** One host, so a commit either matches what was painted or plainly does not. */
const Host = defineFirstScreenComponent('lynx', (props: { readonly id: string }) =>
	firstScreenValue(plan, [firstScreenProps([['set', 'id', props.id]])]),
);

/** The message a background sends once it has described the same first screen. */
function commit(batch: unknown): void {
	backgroundContext().dispatchEvent({
		type: LYNX_BACKGROUND_TO_MAIN_EVENT,
		data: {
			protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
			renderer: LYNX_TRANSPORT_RENDERER,
			root: 1,
			version: 1,
			type: 'commit',
			batch,
		},
	});
}

afterEach(() => {
	if (installed !== null) {
		installed.main.close();
		globalThis.lynxTestingEnv.clearGlobal();
		uninstallLynxTestingEnv(globalThis);
		installed.dom.window.close();
	}
	installed = null;
});

describe.sequential('Lynx first-screen phase marker', () => {
	it('is enabled for this file, so the assertions below observe the profile build', () => {
		// Without this the rest of the file would pass vacuously against a folded
		// no-op, which is the one way these tests could lie.
		expect(LYNX_PROFILE).toBe(true);
	});

	it('names the phase that issued each host call, and closes the sequence after announcing', () => {
		// A host-boundary instrument sees every PAPI call but not which part of the
		// first screen issued it, and the first screen is one uninterrupted
		// synchronous run, so reading the marker at call time is the only join
		// between the two. That is exactly what this observes: the marker as seen
		// from inside a component render and from inside a host call.
		// Wrapped the way the real instrument wraps: by name, over the whole
		// boundary, so the test cannot quietly pass by watching a call the first
		// screen does not make.
		const seen = new Map<string, Set<LynxFirstScreenPhase | null>>();
		const { profile } = install((target) => {
			for (const name of [
				'__CreatePage',
				'__CreateView',
				'__AppendElement',
				'__SetAttribute',
				'__FlushElementTree',
				'__GetElementUniqueID',
			]) {
				const original = target[name] as ((...args: unknown[]) => unknown) | undefined;
				if (typeof original !== 'function') continue;
				target[name] = (...args: unknown[]) => {
					const phase = lynxWireProfile().firstScreenPhase;
					const phases = seen.get(name) ?? new Set<LynxFirstScreenPhase | null>();
					phases.add(phase);
					seen.set(name, phases);
					return original(...args);
				};
			}
		});

		let duringRender: LynxFirstScreenPhase | null = 'announce';
		const Scene = defineFirstScreenComponent('lynx', (props: { readonly id: string }) => {
			duringRender = lynxWireProfile().firstScreenPhase;
			return firstScreenValue(plan, [firstScreenProps([['set', 'id', props.id]])]);
		});

		firstScreenRoot.render(Scene, { id: 'probe' });

		expect(duringRender).toBe('render');
		// Creating and flushing the tree belong to publish and to nothing else.
		expect(seen.get('__CreateView')).toEqual(new Set(['publish']));
		expect(seen.get('__FlushElementTree')).toEqual(new Set(['publish']));
		// Native-ID reads span both: publish resolves IDs as it builds, and capture
		// reads one per record to describe the tree. That split is the point of the
		// marker — a boundary instrument sees one `papi_read` group and cannot tell
		// the two apart, so attributing that group to capture alone would overstate
		// what deferring capture's read could recover.
		expect(seen.get('__GetElementUniqueID')).toEqual(new Set(['publish', 'capture']));
		// Nothing is left open for whatever runs next in this realm.
		expect(profile.firstScreenPhase).toBeNull();
		// All four phases ran and accumulated, without pinning what they cost —
		// the milliseconds are an optimization claim and belong to the benchmark.
		for (const span of [
			profile.firstScreenRenderMs,
			profile.firstScreenPublishMs,
			profile.firstScreenCaptureMs,
			profile.firstScreenAnnounceMs,
		]) {
			expect(Number.isFinite(span)).toBe(true);
			expect(span).toBeGreaterThanOrEqual(0);
		}
		expect(profile.firstScreenRenderMs + profile.firstScreenPublishMs).toBeGreaterThan(0);
	});

	it('leaves no phase open when the first screen faults', () => {
		// A fault settles the source through `retireFirstScreen` and rethrows, so it
		// never reaches the announce mark. A marker left open there would silently
		// misattribute every later host call in the realm to a first screen that
		// already failed.
		const { profile } = install();
		const Exploding = defineFirstScreenComponent('lynx', () => {
			throw new Error('scene refused to render');
		});

		expect(() => firstScreenRoot.render(Exploding, {})).toThrow(/refused to render/);

		expect(profile.firstScreenPhase).toBeNull();
	});
});

describe.sequential('Lynx first-tree lifecycle marker', () => {
	it('waits for hand-over before calling an adoption settled', () => {
		// The half of a compiled first screen that no instrument could see. Paint
		// ends, and the tree the main thread painted is still the main thread's:
		// the background has yet to describe it, the comparator has yet to answer,
		// and on an adoption the nodes change hands a message after that. None of
		// it moves a pixel, so a window that closes on paint closes on none of it
		// — which is what this marker exists to let a window not do.
		const { profile, main } = install();
		firstScreenRoot.render(Host, { id: 'painted' });
		main.markFirstScreenSyncReady();

		// Nothing has asked the question yet, so nothing has answered it.
		expect(profile.firstTreeAction).toBeNull();
		expect(profile.firstTreeSettled).toBe(0);

		commit(renderLynxFirstScreen(Host, { id: 'painted' }).batch);

		// The comparator has answered, and the answer is the one that leaves work
		// still to come. A window closing here would close before the hand-over.
		expect(profile.firstTreeAction).toBe('adopt');
		expect(profile.firstTreeSettled).toBe(0);
		expect(profile.handOverMs).toBe(0);

		backgroundContext().dispatchEvent({
			type: LYNX_BACKGROUND_TO_MAIN_EVENT,
			data: {
				protocol: LYNX_TRANSPORT_PROTOCOL_VERSION,
				renderer: LYNX_TRANSPORT_RENDERER,
				root: 1,
				version: 1,
				type: 'adoption-ready',
			},
		});

		expect(profile.firstTreeSettled).toBe(1);
		expect(main.firstScreenSnapshot()).toBeNull();
		expect(main.diagnostics()).toEqual([]);
		// A wall, not a wall of a particular size: what it costs is an
		// optimization claim and belongs to the benchmark.
		expect(Number.isFinite(profile.handOverMs)).toBe(true);
		expect(profile.handOverMs).toBeGreaterThanOrEqual(0);
	});

	it('names a repair as one, and settles it with the commit that decided so', () => {
		// The outcome that ends where it is decided, because there is nothing to
		// hand over: the painted tree was thrown away and the page rebuilt over the
		// command path. It is also why the marker names the action at all — both
		// outcomes end with a correct page, and an instrument that could not tell
		// them apart would price a repaint as an adoption.
		const { profile, main, dom } = install();
		firstScreenRoot.render(Host, { id: 'painted' });
		const painted = dom.window.document.querySelector('#painted');
		main.markFirstScreenSyncReady();

		commit(renderLynxFirstScreen(Host, { id: 'described' }).batch);

		expect(profile.firstTreeAction).toBe('repair');
		expect(profile.firstTreeSettled).toBe(1);
		expect(profile.handOverMs).toBe(0);
		// The repair really happened, so the marker is describing this run rather
		// than agreeing with it by coincidence.
		expect(dom.window.document.querySelector('#described')).not.toBe(painted);
		expect(main.diagnostics()).toEqual([
			expect.objectContaining({ code: 'OCTANE_LYNX_FIRST_SCREEN_MISMATCH' }),
		]);
	});
});
