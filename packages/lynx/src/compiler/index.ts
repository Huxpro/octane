/**
 * The Lynx compiler backend: what a build emits into the main-thread chunk.
 *
 * Kept separate from `src/core/`, which is what runs on a thread. Nothing here
 * is loaded by an application at runtime — a bundler calls it while building —
 * so it must not import the runtime halves, and the export map points a
 * consuming build at this barrel rather than at a module path that would become
 * part of the surface the first time the backend grows a second file.
 */
export {
	emitLynxMainThreadProgram,
	LynxMainThreadEmitRefusal,
	type LynxMainThreadProgramEmission,
} from './emit-main-thread-program.js';
