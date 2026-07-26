// Misuse must be loud. Metadata that silently does nothing is worse than a
// crash, because nobody notices until a page has been unindexed for weeks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, drainPassiveEffects, flushSync } from 'octane';
import { NoHead, SiblingOwners } from './_fixtures/misuse.tsrx';

function settle(): void {
	flushSync(() => {});
	drainPassiveEffects();
	flushSync(() => {});
}

afterEach(() => {
	document.head.innerHTML = '';
});

describe('misuse diagnostics', () => {
	it('throws a named, actionable error when no <Head> encloses a tag', () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		expect(() => {
			root.render(NoHead);
			settle();
		}).toThrow(/@octanejs\/seo.*Head/s);
		container.remove();
	});

	it('warns when two <Head> blocks each own, naming the fix', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		root.render(SiblingOwners);
		settle();

		const messages = warn.mock.calls.map((call) => String(call[0])).join('\n');
		expect(messages).toContain('@octanejs/seo');
		expect(messages).toContain('Nest them');

		root.unmount();
		container.remove();
		warn.mockRestore();
	});
});
