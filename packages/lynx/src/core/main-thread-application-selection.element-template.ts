import type { LynxCompiledProgramApplicationController } from '../compiled-program-application.js';
import { installLynxElementTemplateCompiledProgramApplicationMainThread } from '../compiled-program-application.element-template.js';
import type { InstallLynxMainThreadOptions } from '../main-thread-implementation.js';

/** Generated-main owner selected only for complete whole-root Template Definition coverage. */
export function installSelectedLynxApplicationMainThread(
	options: Omit<InstallLynxMainThreadOptions, 'validation'> = {},
): LynxCompiledProgramApplicationController {
	return installLynxElementTemplateCompiledProgramApplicationMainThread({
		pageReady: options.firstScreenRender === 'immediate',
		firstScreen: options.firstScreen,
		onDiagnostic: options.onDiagnostic,
	});
}
