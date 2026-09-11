const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const CORE_SELECTION_REQUEST = /(^|[\\/])background-core-selection\.js(?=$|\?)/;

/** Install the static module seam consumed by `@octanejs/lynx/src/root.ts`. */
export function installLynxBackgroundCoreReplacement(compiler, selectedCore) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	new NormalModuleReplacementPlugin(CORE_SELECTION_REQUEST, (resource) => {
		if (selectedCore() !== 'block') return;
		resource.request = resource.request.replace(
			'background-core-selection.js',
			'background-core-selection.block.js',
		);
	}).apply(compiler);
}
