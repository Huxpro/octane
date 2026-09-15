import type { LynxFirstScreenRenderResult } from '../main-renderer-product.js';
import { paintLynxCompiledProgramFirstScreen } from './compiled-program-first-screen.js';
import type { InstallLynxCompiledProgramNativeOwnerOptions } from './compiled-program-native-owner-types.js';
import { installLynxCompiledProgramProductReceiver } from './compiled-program-product-receiver.js';
import type { LynxCompiledProgramAdoptionSource } from './compiled-program-store.js';
import { createLynxElementPAPI, type LynxElementRef } from './papi.js';
import { resolveUniversalProgram } from './program-registry.js';

const DEVELOPMENT =
	typeof __OCTANE_LYNX_DEVELOPMENT__ === 'undefined' || __OCTANE_LYNX_DEVELOPMENT__;
const CODE = 'Octane Lynx OL506';

function failure(message: string): Error {
	return new Error(DEVELOPMENT ? message : CODE);
}

/** Bind the compiled-program application to the ordinary Element PAPI owner. */
export function installLynxCompiledProgramNativeOwner<Node extends LynxElementRef = LynxElementRef>(
	options: InstallLynxCompiledProgramNativeOwnerOptions,
) {
	const papi = createLynxElementPAPI<Node>(options.target);
	const page = papi.createPage('0', 0);
	let paintedFirstScreen: LynxCompiledProgramAdoptionSource<Node> | null = null;
	let firstScreenTransferred = false;
	const adoption: LynxCompiledProgramAdoptionSource<Node> | undefined =
		options.firstScreen === true
			? {
					firstListener: 1,
					resolveSeed(input) {
						if (firstScreenTransferred) return undefined;
						if (paintedFirstScreen === null) {
							throw failure('Compact frame arrived before first-screen paint.');
						}
						return paintedFirstScreen.resolveSeed(input);
					},
					verify() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw failure('Compact frame verified before first-screen paint.');
						}
						paintedFirstScreen.verify();
					},
					finish() {
						if (firstScreenTransferred) return;
						if (paintedFirstScreen === null) {
							throw failure('Compact frame finished before first-screen paint.');
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
	const receiver = installLynxCompiledProgramProductReceiver({
		context: options.context,
		page,
		papi,
		resolveProgram: resolveUniversalProgram,
		adoption,
		pageReady: options.pageReady,
		onDiagnostic: options.onDiagnostic,
		onReady: options.onReady,
	});
	return {
		receiver,
		paintFirstScreen(result: LynxFirstScreenRenderResult) {
			paintedFirstScreen = paintLynxCompiledProgramFirstScreen(result, papi, page);
		},
		disposeFirstScreen() {
			paintedFirstScreen?.dispose();
			paintedFirstScreen = null;
		},
	};
}
declare const __OCTANE_LYNX_DEVELOPMENT__: boolean | undefined;
