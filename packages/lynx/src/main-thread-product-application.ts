import { installSelectedLynxApplicationMainThread } from './core/main-thread-application-selection.js';
import type { LynxCompiledProgramApplicationController } from './compiled-program-application.js';
import type {
	InstallLynxMainThreadOptions,
	LynxMainThreadController,
} from './main-thread-implementation.js';

export type LynxProductApplicationController =
	LynxCompiledProgramApplicationController | LynxMainThreadController;

/** Build-selected generated main-thread owner; source consumers stay on the general receiver. */
export function installLynxProductApplicationMainThread(
	options: Omit<InstallLynxMainThreadOptions, 'validation'> = {},
): LynxProductApplicationController {
	return installSelectedLynxApplicationMainThread(options);
}
