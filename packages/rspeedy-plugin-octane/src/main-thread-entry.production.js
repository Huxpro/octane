/* global __OCTANE_LYNX_FIRST_SCREEN_RENDER__ */
import { installLynxApplicationMainThread } from '@octanejs/lynx/main-thread-application';

import { installMainThreadProcessData } from './main-thread-process-data.js';

// Production applications compile both peers from this package graph. The
// dedicated entry therefore keeps the trusted envelope ABI without retaining
// the recursive checked validator; development selects main-thread-entry.js.
installMainThreadProcessData();
installLynxApplicationMainThread({
	firstScreen: true,
	firstScreenSync: 'manual',
	firstScreenRender:
		typeof __OCTANE_LYNX_FIRST_SCREEN_RENDER__ === 'string'
			? __OCTANE_LYNX_FIRST_SCREEN_RENDER__
			: 'engine',
});
