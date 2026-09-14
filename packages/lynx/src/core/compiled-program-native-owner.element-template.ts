declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;

import type { LynxFirstScreenRenderResult } from '../main-renderer-product.js';
import type { InstallLynxCompiledProgramNativeOwnerOptions } from './compiled-program-native-owner-types.js';
import { paintLynxElementTemplateFirstScreen } from './element-template-first-screen.js';
import { createLynxElementTemplateNativeBudget } from './element-template-native-budget.js';
import { createLynxElementTemplatePAPI } from './element-template-papi.js';
import {
	createLynxElementTemplateProgramStore,
	type LynxElementTemplateAddress,
} from './element-template-program-store.js';
import { installLynxCompiledProgramProductReceiver } from './compiled-program-product-receiver.js';
import { resolveUniversalProgram } from './program-registry.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL507';

/** Bind a compiler-proved whole-root application to the Element Template PAPI owner. */
export function installLynxCompiledProgramNativeOwner(
	options: InstallLynxCompiledProgramNativeOwnerOptions,
) {
	const papi = createLynxElementTemplatePAPI(options.target);
	const nativeBudget = createLynxElementTemplateNativeBudget(papi);
	const nativePage = papi.createPage();
	nativeBudget.run(1, () => papi.setAttribute(nativePage, 0, null));
	const page = Object.freeze({ kind: 'page' as const, owner: 1 as const, slot: 0 as const });
	let paintedFirstScreen: ReturnType<typeof paintLynxElementTemplateFirstScreen> | null = null;
	let firstScreenTransferred = false;
	const adoption =
		options.firstScreen === true
			? {
					firstListener: 1,
					verify() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw new Error(
								DEVELOPMENT ? 'Template frame arrived before first-screen paint.' : CODE,
							);
						}
						paintedFirstScreen.verify();
					},
					finish() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw new Error(
								DEVELOPMENT ? 'Template frame finished before first-screen paint.' : CODE,
							);
						}
						paintedFirstScreen.finish();
						paintedFirstScreen = null;
						firstScreenTransferred = true;
					},
					dispose() {
						paintedFirstScreen?.dispose();
						paintedFirstScreen = null;
					},
				}
			: undefined;
	const receiver = installLynxCompiledProgramProductReceiver<LynxElementTemplateAddress>({
		context: options.context,
		page,
		resolveProgram: resolveUniversalProgram,
		adoption,
		pageReady: options.pageReady,
		onDiagnostic: options.onDiagnostic,
		createStore(root) {
			if (root !== 1) {
				throw new Error(DEVELOPMENT ? 'Template first screen requires compact root 1.' : CODE);
			}
			return createLynxElementTemplateProgramStore(
				papi,
				nativePage,
				root,
				adoption?.firstListener,
				(input) => {
					if (firstScreenTransferred) return undefined;
					if (paintedFirstScreen === null) {
						throw new Error(
							DEVELOPMENT ? 'Template frame arrived before first-screen paint.' : CODE,
						);
					}
					return paintedFirstScreen.resolveSeed(input);
				},
				nativeBudget,
			);
		},
		flush: () => nativeBudget.flush({}),
		onReady: options.onReady,
	});
	return {
		receiver,
		paintFirstScreen(result: LynxFirstScreenRenderResult) {
			paintedFirstScreen = paintLynxElementTemplateFirstScreen(
				result,
				papi,
				nativePage,
				nativeBudget,
			);
			// Native owns the serialization boundary. Octane's background already has
			// the compact logical tree, so no second hydration payload is dispatched.
			papi.serialize(nativePage);
		},
		disposeFirstScreen() {
			paintedFirstScreen?.dispose();
			paintedFirstScreen = null;
		},
	};
}
