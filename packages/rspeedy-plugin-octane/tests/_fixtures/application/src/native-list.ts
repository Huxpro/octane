import { root } from '@octanejs/lynx';

import { NativeListApp } from './NativeListApp.tsrx';

void root.render(NativeListApp, {
	items: [
		{ id: 'alpha', label: 'Alpha' },
		{ id: 'bravo', label: 'Bravo' },
		{ id: 'charlie', label: 'Charlie' },
	],
});
