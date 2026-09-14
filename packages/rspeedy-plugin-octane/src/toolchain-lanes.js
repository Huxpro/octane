const SHARED_PACKAGES = Object.freeze({
	'@emnapi/core': '1.11.2',
	'@emnapi/runtime': '1.11.2',
	'@lynx-js/cache-events-webpack-plugin': '0.2.1',
	'@lynx-js/chunk-loading-webpack-plugin': '0.4.2',
	'@lynx-js/css-extract-webpack-plugin': '0.11.0',
	'@lynx-js/debug-metadata': '0.1.0',
	'@lynx-js/debug-metadata-rsbuild-plugin': '0.2.3',
	'@lynx-js/rspeedy': '0.17.1',
	'@lynx-js/rsbuild-plugin': '0.1.1',
	'@lynx-js/runtime-wrapper-webpack-plugin': '0.2.4',
	'@lynx-js/tasm': '0.0.49',
	'@lynx-js/template-webpack-plugin': '0.16.0',
	'@lynx-js/testing-environment': '0.3.0',
	'@lynx-js/types': '4.1.0',
	'@lynx-js/web-core': '0.26.0',
	'@lynx-js/web-rsbuild-server-middleware': '0.26.0',
	'@lynx-js/webpack-dev-transport': '0.4.0',
	'@lynx-js/webpack-runtime-globals': '0.0.8',
	'@lynx-js/websocket': '0.0.4',
	'@napi-rs/wasm-runtime': '1.1.6',
	'@rsbuild/core': '2.2.3',
	'@rsbuild/plugin-css-minimizer': '2.0.1',
	'@rsdoctor/rspack-plugin': '1.6.4',
	typescript: '5.9.3',
	webpack: '5.108.4',
});

function lane(description, rspack) {
	return Object.freeze({
		description,
		lynxSdk: '3.9.0',
		targetSdk: '3.9',
		elementTemplateTargetSdk: '3.2',
		packages: Object.freeze({ ...SHARED_PACKAGES, '@rspack/core': rspack }),
	});
}

/**
 * Exact, indivisible Lynx build graphs covered by the compatibility smoke.
 *
 * Rspeedy 0.17.1 requires Rsbuild 2.2.3 exactly, which in turn accepts Rspack
 * ~2.2.2. Element Template encoding requires this entire Rspeedy generation
 * together with template 0.16.0 / tasm 0.0.49 / web-core 0.26.0; mixing that
 * encoder into the former Rspeedy 0.16 graph produces unreadable headers.
 */
export const LYNX_TOOLCHAIN_LANES = Object.freeze({
	minimum: lane('Audited Element Template-capable Lynx Stack release graph', '2.2.2'),
	current: lane('Current registry graph within Rspeedy/Rsbuild constraints', '2.2.3'),
});
