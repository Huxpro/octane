const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const BLOCK_COMPONENT_FEATURES_REQUEST = /(^|[\\/])block-component-features\.js(?=$|\?)/;
const blockComponentFeatureSelectors = new WeakMap();

/** Consult the paired application-graph proof after the coverage pass. */
export function selectedLynxBlockComponentFeatures(compiler) {
	return blockComponentFeatureSelectors.get(compiler)?.() ?? 'full';
}

/** Install the static Block-component capability seam selected after graph proof. */
export function installLynxBlockComponentFeatureReplacement(compiler, selectedFeatures) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	blockComponentFeatureSelectors.set(compiler, selectedFeatures);
	new NormalModuleReplacementPlugin(BLOCK_COMPONENT_FEATURES_REQUEST, (resource) => {
		if (selectedFeatures() !== 'structural') return;
		resource.request = resource.request.replace(
			'block-component-features.js',
			'block-component-features.structural.js',
		);
	}).apply(compiler);
}
