import { installLynxApplicationMainThread } from '../main-thread-application.js';
import type {
	InstallLynxMainThreadOptions,
	LynxMainThreadController,
} from '../main-thread-implementation.js';

/** Conservative generated-main owner outside a proved compiled-program graph. */
export function installSelectedLynxApplicationMainThread(
	options: Omit<InstallLynxMainThreadOptions, 'validation'> = {},
): LynxMainThreadController {
	return installLynxApplicationMainThread(options);
}
