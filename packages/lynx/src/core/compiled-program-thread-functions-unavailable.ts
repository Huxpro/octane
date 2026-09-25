declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

export function unavailableLynxCompiledProgramThreadFunctions(): never {
	throw new Error(
		typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__
			? 'Octane Lynx compiled thread-function support was removed by application proof.'
			: 'Octane Lynx OL513',
	);
}
