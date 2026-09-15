import { root } from '@octanejs/lynx';

import { ElementTemplateStructural } from './ElementTemplateStructural.tsrx';

void root.render(ElementTemplateStructural, {
	rows: [
		{ id: 1, label: 'Alpha' },
		{ id: 2, label: 'Bravo' },
	],
});
