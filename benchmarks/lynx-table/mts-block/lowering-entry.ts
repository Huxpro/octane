// Issue-#163 C0 — the one TypeScript module `derive.mjs` needs bundled.
//
// The lowering, the Lynx client driver, and the renderer are TypeScript, and
// the spike's build step is a plain `.mjs`. Rather than teach that script to
// run TypeScript, it Vite-builds this file — which does nothing but re-export
// — and imports the result. Everything is re-exported from the *published*
// subpaths where one exists, because the claim C0 prices is that the program
// the framework already derives is the program a main-thread backend would
// emit; reaching past an export map would weaken that.
export {
	compiledUniversalTemplateProgram,
	createUniversalHostEncoder,
	prepareUniversalTemplateProgram,
	universalTemplateProgramWithoutRanges,
} from 'octane/universal/template-program';
export {
	createLynxClientContainer,
	createLynxClientDriver,
	setLynxClientCapabilities,
} from '../../../packages/lynx/src/core/client-driver.js';
export * as Renderer from '../../../packages/lynx/src/renderer.js';
