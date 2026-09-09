import type { LynxElementRef } from './core/papi.js';
import { validateLynxPairedProductionBackgroundOutboundMessage } from './core/protocol.js';
import {
	installLynxMainThreadWithValidator,
	type InstallLynxMainThreadOptions,
	type LynxMainThreadController,
} from './main-thread-implementation.js';

/**
 * Install the generated half of one paired Rspeedy application build.
 *
 * This is a product-bootstrap boundary rather than a looser public receiver:
 * production still checks routing and message shape, development still walks
 * the complete schema, and only the recursively checked production closure is
 * absent from this same-build path.
 */
export function installLynxApplicationMainThread<Node extends LynxElementRef = LynxElementRef>(
	options: Omit<InstallLynxMainThreadOptions, 'validation'> = {},
): LynxMainThreadController {
	return installLynxMainThreadWithValidator<Node>(
		options,
		validateLynxPairedProductionBackgroundOutboundMessage,
		(message) => message,
	);
}
