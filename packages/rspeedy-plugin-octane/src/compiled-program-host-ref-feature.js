const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const COMPILED_PROGRAM_HOST_REF_FEATURE_REQUEST =
	/(^|[\\/])compiled-program-host-ref-feature\.js(?=$|\?)/;
const compiledProgramHostRefFeatureSelectors = new WeakMap();

/** Consult the paired compiler proof after the coverage pass. */
export function selectedLynxCompiledProgramHostRefFeature(compiler) {
	return compiledProgramHostRefFeatureSelectors.get(compiler)?.() ?? 'full';
}

/** Install the host-ref capability seam selected after graph proof. */
export function installLynxCompiledProgramHostRefFeatureReplacement(compiler, selectedFeature) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	compiledProgramHostRefFeatureSelectors.set(compiler, selectedFeature);
	new NormalModuleReplacementPlugin(COMPILED_PROGRAM_HOST_REF_FEATURE_REQUEST, (resource) => {
		if (selectedFeature() !== 'no-host-refs') return;
		resource.request = resource.request.replace(/\.js(?=$|\?)/, '.no-host-refs.js');
	}).apply(compiler);
}
