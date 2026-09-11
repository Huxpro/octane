import { createLynxRoot } from '@octanejs/lynx';

import { BlockEligible } from './BlockEligible.tsrx';

const explicitRoot = createLynxRoot();

void explicitRoot.render(BlockEligible, {
	items: [
		{ id: 1, label: 'Alpha' },
		{ id: 2, label: 'Bravo' },
	],
});
