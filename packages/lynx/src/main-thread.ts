import type { LynxElementRef } from './core/papi.js';
import {
	installLynxMainThreadWithValidator,
	type InstallLynxMainThreadOptions,
	type LynxMainThreadController,
} from './main-thread-implementation.js';
import {
	resolveLynxValidationMode,
	selfCheckLynxBackgroundInboundMessage,
	validateLynxBackgroundOutboundMessage,
} from './core/protocol.js';

export { LYNX_PAINTED_ELEMENT_CEILING } from './main-thread-implementation.js';
export type {
	InstallLynxMainThreadOptions,
	LynxMainThreadCall,
	LynxMainThreadController,
	LynxNativeEventDelivery,
} from './main-thread-implementation.js';
export type { LynxValidationMode } from './core/protocol.js';

/** Install a public receiver whose validation policy is selected at runtime. */
export function installLynxMainThread<Node extends LynxElementRef = LynxElementRef>(
	options: InstallLynxMainThreadOptions = {},
): LynxMainThreadController {
	const validation = resolveLynxValidationMode(options.validation);
	return installLynxMainThreadWithValidator<Node>(
		options,
		(value, resolveProgram) =>
			validateLynxBackgroundOutboundMessage(value, validation, resolveProgram),
		selfCheckLynxBackgroundInboundMessage,
	);
}
