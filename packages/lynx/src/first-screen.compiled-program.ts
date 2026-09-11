import type { UniversalComponent } from 'octane/universal/native';
import type { LynxComponent } from './intrinsics.js';
import type { LynxFirstScreenRenderResult } from './main-renderer-product.js';
import {
	currentLynxFirstScreenHost,
	installLynxFirstScreenHost,
	requireLynxFirstScreenHost,
	type LynxFirstScreenHost,
} from './core/first-screen-host.js';

export { installLynxFirstScreenHost, type LynxFirstScreenHost };

export interface LynxFirstScreenRoot {
	readonly renderer: 'lynx';
	readonly ready: Promise<void>;
	render<Props>(component: LynxComponent<Props>, props?: Props): LynxFirstScreenRenderResult | null;
	flushTransport(): Promise<void>;
	unmount(): Promise<void>;
}

const ready = Promise.resolve();

/** Capability-minimal facade selected only after paired compiled-program proof. */
export const root: LynxFirstScreenRoot = Object.freeze({
	renderer: 'lynx' as const,
	ready,
	render<Props>(component: LynxComponent<Props>, props?: Props) {
		if (typeof component !== 'function') {
			throw new TypeError('Lynx first-screen root.render() requires a component function.');
		}
		return requireLynxFirstScreenHost().render(
			component as UniversalComponent<Props>,
			props === undefined ? ({} as Props) : props,
		);
	},
	flushTransport() {
		return ready;
	},
	unmount() {
		currentLynxFirstScreenHost()?.unmount();
		return ready;
	},
});

export function createLynxRoot(): LynxFirstScreenRoot {
	return root;
}

export function markFirstScreenSyncReady(): void {
	requireLynxFirstScreenHost().markSyncReady();
}

export const lynxRootAvailability = {
	available: true,
	implementedMilestone: 8,
	status: 'private-milestone-0-native-gates-blocked',
} as const;

export type { LynxNativeResource } from './resource.js';
export type {
	LynxBackgroundFunctionDescriptor,
	LynxCancelablePromise,
	LynxMainThreadRefCell,
	LynxMainThreadRefDescriptor,
	LynxMainThreadWorkletDescriptor,
	LynxWorkletValue,
} from './main-worklets.js';
export type {
	LynxCustomIntrinsicElements,
	LynxElements,
	LynxIntrinsicElements,
	LynxRef,
	LynxRefCallback,
	LynxRefObject,
} from './intrinsics.js';
