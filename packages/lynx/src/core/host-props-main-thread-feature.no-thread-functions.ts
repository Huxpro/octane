import type { LynxMainThreadRefDescriptor, LynxMainThreadWorkletDescriptor } from './worklets.js';
import {
	LYNX_HOST_PROPS_DEVELOPMENT as DEVELOPMENT,
	lynxHostPropError as error,
} from './host-prop-error.js';

function unexpected(name: string): never {
	throw error(
		DEVELOPMENT && `${JSON.stringify(name)} contradicts the compiled no-thread-functions proof.`,
	);
}

export function decodeLynxMainThreadWorklet(
	value: unknown,
	name: string,
): LynxMainThreadWorkletDescriptor | null {
	return value === null || value === undefined ? null : unexpected(name);
}

export function decodeLynxMainThreadRef(value: unknown): LynxMainThreadRefDescriptor | null {
	return value === null || value === undefined ? null : unexpected('main-thread:ref');
}
