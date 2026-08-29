import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LynxTemplatePlugin } from '../../../node_modules/.pnpm/@lynx-js+template-webpack-plugin@0.13.0_tslib@2.8.1/node_modules/@lynx-js/template-webpack-plugin/lib/LynxTemplatePlugin.js';
import tasm from '../../../packages/rspeedy-plugin-octane/node_modules/@lynx-js/tasm/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../fixtures');
const cssSourceText = fs.readFileSync(path.join(fixtures, 'app.css'), 'utf8');
const lepusTemplate = fs.readFileSync(path.join(here, 'lepus-root.js'), 'utf8');
const { cssMap, cssSource } = LynxTemplatePlugin.convertCSSChunksToMap([cssSourceText], [], true);

const SHAPES = ['local-toggle', 'cross-component', 'structural-delete'];
const LOADS = ['idle', 'sustained-scroll'];
const EMPTY_APP_SERVICE =
	"(function(){'use strict';function n({tt}){tt.define('/app-service.js',function(e,module){module.exports={};});return tt.require('/app-service.js');}return{init:n}})()";

function encodeOptions(shape, load) {
	return {
		compilerOptions: {
			enableFiberArch: true,
			useLepusNG: true,
			enableReuseContext: true,
			bundleModuleMode: 'ReturnByFunction',
			templateDebugUrl: '',
			debugInfoOutside: false,
			defaultDisplayLinear: true,
			enableCSSInvalidation: true,
			enableCSSSelector: true,
			enableLepusDebug: false,
			enableRemoveCSSScope: true,
			targetSdkVersion: '3.9',
			defaultOverflowVisible: true,
		},
		sourceContent: {
			dsl: 'react_nodiff',
			appType: 'card',
			config: {
				lepusStrict: true,
				useNewSwiper: true,
				enableNewIntersectionObserver: true,
				enableNativeList: true,
				syncXElementRegistry: true,
				enableA11y: true,
				enableAccessibilityElement: false,
				enableCSSInheritance: false,
				enableNewGesture: false,
				removeDescendantSelectorScope: true,
				debugMetadataUrl: '',
			},
		},
		css: { cssMap, cssSource },
		lepusCode: {
			root: lepusTemplate.replaceAll('__SHAPE__', shape).replaceAll('__LOAD__', load),
			lepusChunk: {},
			filename: 'issue197-t0.js',
		},
		manifest: { '/app-service.js': EMPTY_APP_SERVICE },
		customSections: {},
	};
}

for (const load of LOADS) {
	const outputDirectory = path.join(here, 'dist', `T0-${load}`);
	fs.mkdirSync(outputDirectory, { recursive: true });
	for (const shape of SHAPES) {
		const result = await tasm.encode(encodeOptions(shape, load));
		const output = path.join(outputDirectory, `${shape}.lynx.bundle`);
		fs.writeFileSync(output, result.buffer);
		process.stdout.write(`[raw-t0] ${path.relative(here, output)}\n`);
	}
}
