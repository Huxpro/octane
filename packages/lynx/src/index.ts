/** Availability metadata for the private, source/test Milestone 8 renderer. */
export const lynxRootAvailability = {
	available: true,
	implementedMilestone: 8,
	status: 'private-milestone-0-native-gates-blocked',
} as const;

export type LynxRootAvailability = typeof lynxRootAvailability;

export { createLynxRoot, root } from './root.js';
export type { CreateLynxRootOptions, LynxRoot } from './root.js';
// Issue #103 B0: attach a Block-core program to a component. A bundle built
// with the default `core: 'universal'` ignores the attachment and renders the
// component; a bundle built with `core: 'block'` runs the program.
export { withLynxBlockProgram } from './core/block-program.js';
export type { LynxBlockProgram, LynxBlockProgramContext } from './core/block-program.js';
export { useMainThreadRef } from './renderer.js';
export {
	runOnBackground,
	runOnMainThread,
	LynxCrossThreadCallCancelledError,
} from './core/worklets.js';
export type {
	LynxBackgroundFunctionDescriptor,
	LynxCancelablePromise,
	LynxMainThreadRefCell,
	LynxMainThreadRefDescriptor,
	LynxMainThreadWorkletDescriptor,
	LynxWorkletValue,
} from './core/worklets.js';
export type { LynxPublicHandle } from './core/client-driver.js';
export { LynxNodesRefError } from './core/nodes-ref.js';
export { createLynxNativeResource } from './resource.js';
export type { LynxNativeResource } from './resource.js';
export type {
	LynxMeasureOptions,
	LynxMeasureResult,
	LynxNodesRef,
	LynxNodesRefErrorCode,
	LynxNodesRefFieldsOptions,
	LynxNodesRefFieldsResult,
	LynxNodesRefPathEntry,
	LynxNodesRefPathResult,
} from './core/nodes-ref.js';

export type {
	LynxComponent,
	LynxCustomIntrinsicElements,
	LynxElements,
	LynxIntrinsicElements,
	LynxRef,
	LynxRefCallback,
	LynxRefObject,
} from './intrinsics.js';
