import {
	installLynxCompiledProgramApplicationWithNativeOwner,
	type InstallLynxCompiledProgramApplicationOptions,
	type LynxCompiledProgramApplicationController,
} from './core/compiled-program-application-lifecycle.js';
import { installLynxCompiledProgramNativeOwner } from './core/compiled-program-native-owner.element-template.js';

/** Install the explicit, compiler-proved whole-root Element Template owner. */
export function installLynxElementTemplateCompiledProgramApplicationMainThread(
	input: boolean | InstallLynxCompiledProgramApplicationOptions = false,
): LynxCompiledProgramApplicationController {
	return installLynxCompiledProgramApplicationWithNativeOwner(
		input,
		installLynxCompiledProgramNativeOwner,
	);
}
