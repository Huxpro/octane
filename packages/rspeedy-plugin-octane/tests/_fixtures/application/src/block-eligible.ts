import { root } from '@octanejs/lynx';

import { BlockEligible } from './BlockEligible.tsrx';

void root.render(BlockEligible, {
	theme: 'warm',
	items: [
		{ id: 1, image: 'alpha.png', label: 'Alpha', tags: ['new', 'warm'] },
		{ id: 2, image: 'bravo.png', label: 'Bravo', tags: [] },
	],
});
