/**
 * The Lynx compiler backend: what a build emits into the main-thread chunk.
 *
 * Kept separate from `src/core/`, which is what runs on a thread. Nothing here
 * is loaded by an application at runtime — a bundler calls it while building —
 * and the export map points a consuming build at this barrel rather than at a
 * module path that would become part of the surface the first time the backend
 * grows a second file.
 *
 * It does reach into `src/core/` in one place, deliberately.
 * `derive-main-thread-program.ts` lowers a plan through the renderer's own
 * driver, because a build-time lowering that answered "is this an event, and at
 * what priority" differently from the run-time one would paint a first screen
 * from one derivation and update it against the other. That import costs a
 * bundler nothing — a build tool is not the application bundle — and it is the
 * only thing that makes the two derivations incapable of drifting.
 */
export {
	deriveLynxMainThreadProgram,
	type LynxMainThreadDerivation,
} from './derive-main-thread-program.js';
export {
	emitLynxMainThreadProgram,
	LynxMainThreadEmitRefusal,
	type LynxMainThreadProgramEmission,
} from './emit-main-thread-program.js';
