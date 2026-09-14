import {
	installLynxCompiledProgramApplicationWithNativeOwner,
	type InstallLynxCompiledProgramApplicationOptions,
	type LynxCompiledProgramApplicationController,
} from './core/compiled-program-application-lifecycle.js';
import { installLynxCompiledProgramNativeOwner } from './core/compiled-program-native-owner.js';
import type { LynxElementRef } from './core/papi.js';

export type {
	InstallLynxCompiledProgramApplicationOptions,
	LynxCompiledProgramApplicationController,
} from './core/compiled-program-application-lifecycle.js';

/** Install the generated-product main owner with the ordinary Element PAPI. */
export function installLynxCompiledProgramApplicationMainThread<
	Node extends LynxElementRef = LynxElementRef,
>(
	input: boolean | InstallLynxCompiledProgramApplicationOptions = false,
): LynxCompiledProgramApplicationController {
	return installLynxCompiledProgramApplicationWithNativeOwner(
		input,
		installLynxCompiledProgramNativeOwner<Node>,
	);
}
