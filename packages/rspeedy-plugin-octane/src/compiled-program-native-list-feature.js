const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const COMPILED_PROGRAM_NATIVE_LIST_FEATURE_REQUEST =
	/(^|[\\/])compiled-program-native-list-feature\.js(?=$|\?)/;
const compiledProgramNativeListFeatureSelectors = new WeakMap();

/** Consult the paired compiler proof after the coverage pass. */
export function selectedLynxCompiledProgramNativeListFeature(compiler) {
	return compiledProgramNativeListFeatureSelectors.get(compiler)?.() ?? 'full';
}

/** Install the native-list capability seam selected after graph proof. */
export function installLynxCompiledProgramNativeListFeatureReplacement(compiler, selectedFeature) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	compiledProgramNativeListFeatureSelectors.set(compiler, selectedFeature);
	new NormalModuleReplacementPlugin(COMPILED_PROGRAM_NATIVE_LIST_FEATURE_REQUEST, (resource) => {
		if (selectedFeature() !== 'no-native-list') return;
		resource.request = resource.request.replace(/\.js(?=$|\?)/, '.no-native-list.js');
	}).apply(compiler);
}
