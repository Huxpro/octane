import { unavailableLynxCompiledProgramThreadFunctions } from './compiled-program-thread-functions-unavailable.js';

export function isLynxMainThreadWorkletDescriptor(_value: unknown): boolean {
	return false;
}

export function isolateLynxWorkletValue(_value: unknown): never {
	return unavailableLynxCompiledProgramThreadFunctions();
}
