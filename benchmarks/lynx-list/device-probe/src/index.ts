import { root } from '@octanejs/lynx';

import { App } from './App.lynx.tsrx';
import './app.css';

declare const lynx: {
	getCoreContext(): {
		addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
	};
};

lynx.getCoreContext().addEventListener('octane-issue-195-probe', (event) => {
	console.log(String(event.data));
});
void root.render(App);
