import { createLynxRoot } from '@octanejs/lynx';

import { BlockEligible } from './BlockEligible.tsrx';

const explicitRoot = createLynxRoot();

void explicitRoot.render(BlockEligible, {
	theme: 'cool',
	items: [
		{ id: 1, image: 'alpha.png', label: 'Alpha', tags: ['new', 'warm'] },
		{ id: 2, image: 'bravo.png', label: 'Bravo', tags: [] },
	],
});
