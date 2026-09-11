import { root } from '@octanejs/lynx';

import { BlockEligible } from './BlockEligible.tsrx';

void root.render(BlockEligible, {
	items: [
		{ id: 1, label: 'Alpha' },
		{ id: 2, label: 'Bravo' },
	],
});
