// `<Head>` is grouping sugar, not a requirement. What a tag needs is an
// enclosing `<SeoProvider>`. These pin that so the answer never becomes folklore.
import { describe, it, expect } from 'vitest';
import { prerender } from 'octane/static';
import { Grouped, Nested, RawScript, Standalone } from '../_fixtures/head-block.tsrx';

async function render(Component: any) {
	const { html, head } = await prerender(Component, undefined, { headChannel: 'separate' });
	return { html, head: head ?? '' };
}

describe('<Head> grouping', () => {
	it('needs no provider or root wrapper: a lone <Head> owns its metadata', async () => {
		const grouped = await render(Grouped);
		// The same tags in a page deep in the tree, with nothing wrapping it.
		const standalone = await render(Standalone);
		expect(standalone.head).toBe(grouped.head);
		expect(grouped.head).toContain('<title>Grouped</title>');
		expect(grouped.head).toContain('content="grouped description"');
		expect(grouped.head).toContain('rel="canonical"');
	});

	it('renders the grouped JSON-LD script', async () => {
		const { html } = await render(Grouped);
		expect(html).toContain('application/ld+json');
		expect(html).toContain('"headline":"Grouped"');
	});

	it('treats a nested <Head> as grouping, emitting one merged set', async () => {
		const { head } = await render(Nested);
		// A page's own <Head> block beats the app-level one it renders under.
		expect(head).toContain('<title>Deep</title>');
		expect(head).not.toContain('Outer');
		// The app-level block's other tag is untouched.
		expect(head).toContain('content="outer"');
		// One merged set, not one per <Head>.
		expect(head.match(/<title/g)).toHaveLength(1);
		expect(head.match(/rel="canonical"/g)).toHaveLength(1);
	});

	it('renders a raw script body escaped by the renderer', async () => {
		const { html } = await render(RawScript);
		expect(html).toContain('type="text/plain"');
		expect(html).toContain('hello');
	});
});
