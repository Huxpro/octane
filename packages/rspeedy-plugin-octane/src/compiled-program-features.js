const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const COMPILED_PROGRAM_FEATURES_REQUEST =
	/(^|[\\/])(?:background-thread-function-feature|compiled-program-features|host-props-main-thread-feature|renderer-thread-function-feature|transport-thread-function-feature)\.js(?=$|\?)/;
const compiledProgramFeatureSelectors = new WeakMap();

/** Consult the paired compiler proof after the coverage pass. */
export function selectedLynxCompiledProgramFeatures(compiler) {
	return compiledProgramFeatureSelectors.get(compiler)?.() ?? 'full';
}

/** Install the compact-product capability seam selected after graph proof. */
export function installLynxCompiledProgramFeatureReplacement(compiler, selectedFeatures) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	compiledProgramFeatureSelectors.set(compiler, selectedFeatures);
	new NormalModuleReplacementPlugin(COMPILED_PROGRAM_FEATURES_REQUEST, (resource) => {
		if (selectedFeatures() !== 'no-thread-functions') return;
		resource.request = resource.request.replace(/\.js(?=$|\?)/, '.no-thread-functions.js');
	}).apply(compiler);
}
