declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

// This helper cannot suppress JavaScript's eager argument evaluation. Each
// caller guards its diagnostic so production neither constructs nor retains it.
export const LYNX_HOST_PROPS_DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;

export function lynxHostPropError(message: string | false): Error {
	return new TypeError(
		LYNX_HOST_PROPS_DEVELOPMENT ? `Octane Lynx host prop: ${message}` : 'Octane Lynx OL100',
	);
}
