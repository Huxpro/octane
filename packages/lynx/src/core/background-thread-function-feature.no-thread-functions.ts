import type { LynxBackgroundCallBridge, LynxBackgroundFunctionRegistry } from './worklets.js';
import { unavailableLynxCompiledProgramThreadFunctions as unavailable } from './compiled-program-thread-functions-unavailable.js';

export function createLynxBackgroundFunctionRegistry(): LynxBackgroundFunctionRegistry {
	return unavailable();
}

export function installBackgroundCallBridge(_bridge: LynxBackgroundCallBridge): () => void {
	return unavailable();
}
