/**
 * Lazy seam between the main-thread receiver and the worklet runtime.
 *
 * The receiver (`main-thread.ts`) never imports `worklets.ts` for values.
 * Instead, the bridge below is provided by `main-renderer.ts`'s thread-function
 * entry points — the modules compiled worklet output and `useMainThreadRef`
 * actually import — so the ~2k-line registry and call-bridge machinery is
 * retained in a production main-thread bundle only when the application
 * compiled at least one worklet feature. The receiver reads the slot once per
 * install and treats an absent bridge as "this bundle compiled no worklets":
 * worklet-addressed messages and host dispatches report cleanly instead of
 * resolving.
 *
 * This module must stay side-effect-free and must not import `worklets.ts`
 * for values, or the boundary collapses back into a static dependency.
 */

import type {
	CreateLynxMainThreadWorkletRegistryOptions,
	LynxBackgroundFunctionDescriptor,
	LynxMainThreadCallBridge,
	LynxMainThreadWorkletRegistry,
	LynxWorkletValue,
} from './worklets.js';

export interface LynxMainThreadWorkletBridge {
	createRegistry(
		options: CreateLynxMainThreadWorkletRegistryOptions,
	): LynxMainThreadWorkletRegistry;
	installRegistry(registry: LynxMainThreadWorkletRegistry): () => void;
	installCallBridge(bridge: LynxMainThreadCallBridge): () => void;
	isolateWorkletValue<T extends LynxWorkletValue>(value: T, label?: string): T;
	isBackgroundFunctionDescriptor(value: unknown): value is LynxBackgroundFunctionDescriptor;
}

let installedBridge: LynxMainThreadWorkletBridge | null = null;

/**
 * First provider wins; every provider supplies the same members from
 * `worklets.ts`, so later calls are idempotent re-provisions.
 */
export function provideLynxMainThreadWorkletBridge(bridge: LynxMainThreadWorkletBridge): void {
	if (installedBridge === null) installedBridge = bridge;
}

export function installedLynxMainThreadWorkletBridge(): LynxMainThreadWorkletBridge | null {
	return installedBridge;
}
