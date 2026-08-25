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
	universalPlan as firstScreenPlan,
	universalProps as firstScreenProps,
	universalValue as firstScreenValue,
} from '../src/main-renderer.js';
import { installLynxMainThread, type LynxMainThreadController } from '../src/main-thread.js';
import {
	LYNX_PROFILE,
	lynxWireProfile,
	type LynxFirstScreenPhase,
	type LynxWireProfile,
} from '../src/core/profiling.js';

const plan = firstScreenPlan('lynx', { kind: 'host', type: 'view', propsSlot: 0 });

let installed: { dom: JSDOM; main: LynxMainThreadController } | null = null;

function install(configurePAPI?: (target: Record<string, unknown>) => void): LynxWireProfile {
	const dom = new JSDOM('<!doctype html><html><body></body></html>');
	installLynxTestingEnv(globalThis, {
		window: dom.window as unknown as Window & typeof globalThis,
	});
	globalThis.lynxTestingEnv.switchToMainThread();
	configurePAPI?.(globalThis as unknown as Record<string, unknown>);
	const main = installLynxMainThread({ firstScreen: true, firstScreenSync: 'manual' });
	installed = { dom, main };
	const profile = lynxWireProfile();
	profile.firstScreenPhase = null;
	profile.firstScreenRenderMs = 0;
	profile.firstScreenPublishMs = 0;
	profile.firstScreenCaptureMs = 0;
	profile.firstScreenAnnounceMs = 0;
	return profile;
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
		const profile = install((target) => {
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
		const profile = install();
		const Exploding = defineFirstScreenComponent('lynx', () => {
			throw new Error('scene refused to render');
		});

		expect(() => firstScreenRoot.render(Exploding, {})).toThrow(/refused to render/);

		expect(profile.firstScreenPhase).toBeNull();
	});
});
