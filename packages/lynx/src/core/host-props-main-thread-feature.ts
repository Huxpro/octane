import {
	assertLynxWorkletValue,
	isLynxMainThreadRefDescriptor,
	isLynxMainThreadWorkletDescriptor,
	unwrapThreadFunctionDescriptor,
	type LynxMainThreadRefDescriptor,
	type LynxMainThreadWorkletDescriptor,
} from './worklets.js';
import {
	LYNX_HOST_PROPS_DEVELOPMENT as DEVELOPMENT,
	lynxHostPropError as error,
} from './host-prop-error.js';

export function decodeLynxMainThreadWorklet(
	value: unknown,
	name: string,
): LynxMainThreadWorkletDescriptor | null {
	if (value === null || value === undefined) return null;
	let descriptor = value;
	if (typeof value === 'function') {
		try {
			descriptor = unwrapThreadFunctionDescriptor(value);
		} catch {
			throw error(
				DEVELOPMENT &&
					`${JSON.stringify(name)} must be a main-thread worklet descriptor with a non-empty _wkltId.`,
			);
		}
	}
	assertLynxWorkletValue(descriptor, JSON.stringify(name));
	if (!isLynxMainThreadWorkletDescriptor(descriptor)) {
		throw error(
			DEVELOPMENT &&
				`${JSON.stringify(name)} must be a main-thread worklet descriptor with a non-empty _wkltId.`,
		);
	}
	if (descriptor._owlt !== undefined) {
		throw error(
			DEVELOPMENT && `${JSON.stringify(name)} cannot contain a main-local _owlt activation.`,
		);
	}
	return descriptor;
}

export function decodeLynxMainThreadRef(value: unknown): LynxMainThreadRefDescriptor | null {
	if (value === null || value === undefined) return null;
	assertLynxWorkletValue(value, '"main-thread:ref"');
	if (!isLynxMainThreadRefDescriptor(value)) {
		throw error(
			DEVELOPMENT &&
				'"main-thread:ref" must be a main-thread ref descriptor with a non-empty _wvid.',
		);
	}
	return value;
}
