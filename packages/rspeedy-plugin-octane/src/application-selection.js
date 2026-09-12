const PLUGIN_NAME = '@octanejs/rspeedy-plugin';
const APPLICATION_SELECTION_REQUEST = /(^|[\\/])(?:main-thread-)?application-selection\.js(?=$|\?)/;
const FIRST_SCREEN_FACADE_REQUEST = /^@octanejs\/lynx\/first-screen$/;
const CLIENT_DRIVER_REQUEST = /(^|[\\/])client-driver\.js(?=$|\?)/;
const MAIN_RENDERER_SELECTION_REQUEST = /(^|[\\/])main-renderer-selection\.js(?=$|\?)/;
const applicationSelectors = new WeakMap();

function replaceSelectedRequest(resource, source, selected) {
	if (selected !== 'compiled-program') return;
	resource.request = resource.request.replace(source, `${source.slice(0, -3)}.compiled-program.js`);
}

/** Consulted lazily by the package-root facade plugin during make and rebuild. */
export function selectedLynxApplication(compiler) {
	return applicationSelectors.get(compiler)?.() ?? 'general';
}

/** Replace the shared source-safe application seam after paired graph proof. */
export function installLynxApplicationSelectionReplacement(compiler, selectedApplication) {
	const NormalModuleReplacementPlugin = compiler.webpack?.NormalModuleReplacementPlugin;
	if (typeof NormalModuleReplacementPlugin !== 'function') {
		throw new TypeError(
			`${PLUGIN_NAME}: this Rspack compiler does not expose webpack.NormalModuleReplacementPlugin.`,
		);
	}
	applicationSelectors.set(compiler, selectedApplication);
	new NormalModuleReplacementPlugin(APPLICATION_SELECTION_REQUEST, (resource) => {
		const source = resource.request.includes('main-thread-application-selection.js')
			? 'main-thread-application-selection.js'
			: 'application-selection.js';
		replaceSelectedRequest(resource, source, selectedApplication());
	}).apply(compiler);
	new NormalModuleReplacementPlugin(FIRST_SCREEN_FACADE_REQUEST, (resource) => {
		if (selectedApplication() === 'compiled-program') {
			resource.request = '@octanejs/lynx/first-screen-compiled-program';
		}
	}).apply(compiler);
	new NormalModuleReplacementPlugin(CLIENT_DRIVER_REQUEST, (resource) => {
		replaceSelectedRequest(resource, 'client-driver.js', selectedApplication());
	}).apply(compiler);
	new NormalModuleReplacementPlugin(MAIN_RENDERER_SELECTION_REQUEST, (resource) => {
		replaceSelectedRequest(resource, 'main-renderer-selection.js', selectedApplication());
	}).apply(compiler);
}
