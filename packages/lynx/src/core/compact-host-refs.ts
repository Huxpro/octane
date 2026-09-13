import { provideLynxCompactHostRefFeature } from './compact-host-ref-feature.js';
import { createLynxNodesRef } from './nodes-ref.js';

const FEATURE = Object.freeze({
	createBinding: createLynxNodesRef,
});

/** Compiler-emitted once in a module that contains at least one resident ref site. */
export function enableLynxCompilerProgramRefs(): void {
	provideLynxCompactHostRefFeature(FEATURE);
}
