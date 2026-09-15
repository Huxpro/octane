/**
 * Compiler-facing Lynx renderer ABI.
 *
 * Components compile against Octane's host-neutral universal component core;
 * the background root connects that output to the Milestone 3 async host.
 */
export * from 'octane/universal/native';
export {
	isLynxCompilerProgram,
	isLynxCompilerProgramValue,
	lynxProgram,
	lynxProgramValue,
	LYNX_COMPILER_PROGRAM_VERSION,
	type LynxCompilerProgram,
	type LynxCompilerProgramDefinition,
	type LynxCompilerProgramComputation,
	type LynxCompilerProgramValue,
} from './core/compiler-program.js';
export { enableLynxCompilerProgramRefs } from './core/compact-host-refs.js';

export {
	attachThreadFunction,
	bindThreadFunction,
	invokeThreadFunction,
	registerThreadFunction,
	runOnBackground,
	runOnMainThread,
	unregisterThreadFunction,
	useMainThreadRef,
} from './renderer-thread-function-feature.js';
export type {
	LynxBackgroundFunctionDescriptor,
	LynxCancelablePromise,
	LynxMainThreadRefDescriptor,
	LynxMainThreadWorkletDescriptor,
	LynxWorkletValue,
} from './core/worklets.js';

export type {
	LynxCustomIntrinsicElements,
	LynxElements,
	LynxIntrinsicElements,
} from './intrinsics.js';
