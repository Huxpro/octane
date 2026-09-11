import {
	installLynxCompiledProgramApplicationMainThread,
	type LynxCompiledProgramApplicationController,
} from '../compiled-program-application.js';
import type { InstallLynxMainThreadOptions } from '../main-thread-implementation.js';

/** Generated-main owner selected only for a fully proved compiled-program graph. */
export function installSelectedLynxApplicationMainThread(
	options: Omit<InstallLynxMainThreadOptions, 'validation'> = {},
): LynxCompiledProgramApplicationController {
	return installLynxCompiledProgramApplicationMainThread({
		pageReady: options.firstScreenRender === 'immediate',
		firstScreen: options.firstScreen,
		onDiagnostic: options.onDiagnostic,
	});
}
